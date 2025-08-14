// src/workers/hostWorker.ts
import { Job, Worker } from 'bullmq';
import { execa } from 'execa';
import fg from 'fast-glob';
import { statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import which from 'which';
import { prisma } from '../src/db.js';
import { redisConnection } from '../src/queue.js';
import { sha256File } from '../utils/checksum.js';
import { ensureDir } from '../utils/fs.js';
import { zipFolder } from '../utils/zip.js';

type HostSpec = {
  target: 'host';
  npm?: { name: string; version: string }[];
  pip?: { name: string; version?: string }[];
  apt?: { name: string; version?: string }[];
  distroImage?: string; // ex: "ubuntu:22.04" (default)
};

async function hasCmd(cmd: string) {
  try { await which(cmd); return true; } catch { return false; }
}

async function ensureDocker(): Promise<boolean> {
  if (!(await hasCmd('docker'))) return false;
  try {
    await execa('docker', ['version'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

async function runInDocker(image: string, outDir: string, shellCmd: string) {
  ensureDir(outDir);
  const outAbs = resolve(outDir);                     // ← chemin ABSOLU
  await execa(
    'docker',
    ['run', '--rm', '-v', `${outAbs}:/out`, image, 'bash', '-lc', shellCmd],
    { stdio: 'inherit' }
  );
}

/* =========================
   Fetchers : Docker-first
   ========================= */

async function fetchNpmDocker(outDir: string, list: { name: string; version: string }[]) {
  if (!list?.length) return;
  for (const p of list) {
    const ref = `${p.name}@${p.version}`;
    await runInDocker('node:20-bullseye', outDir, `cd /out && npm pack ${ref}`);
  }
  writeFileSync(join(outDir, 'npmrc-template'), 'cache=./host/npm\nprefer-offline=true\n');
  writeFileSync(join(outDir, 'README.txt'), 'Use: npm install --offline --cache ./host/npm --prefer-offline <pkg>@<version>\n');
}

async function fetchPipDocker(outDir: string, list: { name: string; version?: string }[]) {
  if (!list?.length) return;
  for (const p of list) {
    const ref = p.version ? `${p.name}==${p.version}` : p.name;
    await runInDocker('python:3.11-slim', outDir, `pip download ${ref} -d /out`);
  }
  writeFileSync(join(outDir, 'README.txt'), 'Use: pip install --no-index --find-links ./host/pip <pkg>==<version>\n');
}

async function fetchAptDocker(outDir: string, list: { name: string; version?: string }[], distroImage: string) {
  if (!list?.length) return;
  const pkgs = list.map(p => (p.version ? `${p.name}=${p.version}` : p.name)).join(' ');
  const cmd = `
    set -e
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends dpkg-dev ca-certificates
    apt-get download ${pkgs}
    cd /out
    dpkg-scanpackages . /dev/null | gzip -9c > Packages.gz
  `.trim();
  await runInDocker(distroImage, outDir, cmd);
  writeFileSync(join(outDir, 'README.txt'),
    'Use: sudo apt install ./host/apt/<package>.deb  OR configure file:// repo with Packages.gz\n');
}

/* ================
   Fallback natif
   ================ */

async function fetchNpmNative(outDir: string, list: { name: string; version: string }[]) {
  if (!list?.length) return;
  ensureDir(outDir);
  for (const p of list) {
    const ref = `${p.name}@${p.version}`;
    await execa('npm', ['pack', ref], { cwd: outDir, stdio: 'inherit' });
  }
  writeFileSync(join(outDir, 'npmrc-template'), 'cache=./host/npm\nprefer-offline=true\n');
  writeFileSync(join(outDir, 'README.txt'), 'Use: npm install --offline --cache ./host/npm --prefer-offline <pkg>@<version>\n');
}

async function fetchPipNative(outDir: string, list: { name: string; version?: string }[]) {
  if (!list?.length) return;
  ensureDir(outDir);
  const pipCmd = (await hasCmd('pip')) ? 'pip' : 'pip3';
  for (const p of list) {
    const ref = p.version ? `${p.name}==${p.version}` : p.name;
    await execa(pipCmd, ['download', ref, '-d', outDir], { stdio: 'inherit' });
  }
  writeFileSync(join(outDir, 'README.txt'), 'Use: pip install --no-index --find-links ./host/pip <pkg>==<version>\n');
}

async function fetchAptNative(outDir: string, list: { name: string; version?: string }[]) {
  if (!list?.length) return;
  ensureDir(outDir);
  for (const p of list) {
    const ref = p.version ? `${p.name}=${p.version}` : p.name;
    await execa('bash', ['-lc', `apt-get update && apt-get download ${ref}`], { cwd: outDir, stdio: 'inherit' });
  }
  try {
    await execa('bash', ['-lc', 'dpkg-scanpackages . /dev/null | gzip -9c > Packages.gz'], { cwd: outDir, stdio: 'inherit' });
  } catch {
    // pas bloquant : on peut quand même installer via .deb direct
  }
  writeFileSync(join(outDir, 'README.txt'),
    'Use: sudo apt install ./host/apt/<package>.deb  OR configure file:// repo with Packages.gz\n');
}

/* =====================
   Scripts & compliance
   ===================== */

function installHostSh() {
  return `#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"

# npm offline
if command -v npm >/dev/null && [ -d "$DIR/host/npm" ]; then
  echo "[npm] configuring offline cache..."
  mkdir -p ~/.npm && cp "$DIR/host/npm/npmrc-template" ~/.npmrc || true
  echo "[npm] ready: npm will use local cache in $DIR/host/npm"
fi

# pip offline
if command -v pip >/dev/null || command -v pip3 >/dev/null; then
  if [ -d "$DIR/host/pip" ]; then
    echo "[pip] ready: use --no-index --find-links $DIR/host/pip"
  fi
fi

# apt offline
if command -v apt >/dev/null && [ -d "$DIR/host/apt" ]; then
  echo "[apt] ready: install .deb in $DIR/host/apt or add a file:// repo with Packages.gz"
fi

echo "Done."
`;
}

async function writeChecksumsAndZip(baseDir: string, zipOut: string) {
  const files = await fg(['host/**/*', 'scripts/install.sh'], { cwd: baseDir, dot: false });
  const lines = files.map((f) => `${sha256File(join(baseDir, f))}  ${f}`);
  ensureDir(join(baseDir, 'compliance'));
  writeFileSync(join(baseDir, 'compliance', 'checksums.txt'), lines.join('\n') + '\n');
  await zipFolder(baseDir, zipOut);
}

/* ============
   Le worker
   ============ */

export function startHostWorker() {
  console.log('[HOST WORKER] starting…');

  const w = new Worker('bundles', async (job: Job) => {
    const jobId = job.id as string;
    console.log('[HOST WORKER] got job', jobId, job.data);

    // Lire le spec (Postgres: JSON ; SQLite: string)
    const rec = await prisma.bundleJob.findUnique({ where: { id: jobId } });
    if (!rec) { console.error('[HOST] BundleJob not found', jobId); return; }
    const spec: HostSpec = typeof (rec as any).spec === 'string'
      ? JSON.parse((rec as any).spec)
      : (rec as any).spec;

    if (spec.target !== 'host') {
      console.log('[HOST] ignore non-host job', jobId);
      return;
    }

    await prisma.bundleJob.update({ where: { id: jobId }, data: { status: 'RUNNING' } });

    const baseDir = join(process.env.STORAGE_DIR ?? './storage', jobId);
    const npmOut  = join(baseDir, 'host', 'npm');
    const pipOut  = join(baseDir, 'host', 'pip');
    const aptOut  = join(baseDir, 'host', 'apt');
    const scripts = join(baseDir, 'scripts');
    ensureDir(baseDir); ensureDir(scripts);

    try {
      const dockerOK = await ensureDocker();
      const distroImage = spec.distroImage || 'ubuntu:22.04';

      // npm
      if (spec.npm?.length) {
        if (dockerOK) await fetchNpmDocker(npmOut, spec.npm);
        else          await fetchNpmNative(npmOut, spec.npm);
      }

      // pip
      if (spec.pip?.length) {
        if (dockerOK) await fetchPipDocker(pipOut, spec.pip);
        else          await fetchPipNative(pipOut, spec.pip);
      }

      // apt
      if (spec.apt?.length) {
        if (dockerOK) await fetchAptDocker(aptOut, spec.apt, distroImage);
        else          await fetchAptNative(aptOut, spec.apt);
      }

      // scripts + compliance + zip
      writeFileSync(join(scripts, 'install.sh'), installHostSh());
      const zipOut = join(process.env.STORAGE_DIR ?? './storage', `${jobId}.zip`);
      await writeChecksumsAndZip(baseDir, zipOut);

      const size = statSync(zipOut).size;
      await prisma.artifact.create({
        data: { jobId, kind: 'zip', filename: `${jobId}.zip`, size, checksum: sha256File(zipOut) }
      });

      await prisma.bundleJob.update({
        where: { id: jobId },
        data: { status: 'SUCCEEDED', finishedAt: new Date() }
      });
      console.log('[HOST] completed', jobId);

    } catch (err: any) {
      console.error('[HOST] failed', jobId, err?.message || err);
      await prisma.bundleJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', error: String(err?.message || err) }
      });
      throw err;
    }
  }, { connection: redisConnection });

  w.on('active',    j => console.log('[HOST]', j.id, 'active'));
  w.on('completed', j => console.log('[HOST]', j.id, 'completed'));
  w.on('failed',   (j,err) => console.error('[HOST]', j?.id, 'failed:', err?.message));
}
