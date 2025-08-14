import { Job, Worker } from 'bullmq';
import { execa } from 'execa';
import fg from 'fast-glob';
import { statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { redisConnection } from '../src/queue.js';
import { sha256File } from '../utils/checksum.js';
import { ensureDir } from '../utils/fs.js';
import { zipFolder } from '../utils/zip.js';

async function dockerSaveImages(baseDir: string, images: { name: string; tag?: string }[], platform: string) {
  const imagesDir = join(baseDir, 'docker', 'images');
  ensureDir(imagesDir);

  if (config.dockerDisabled) {
    // Create dummy .tar files for testing without docker installed
    for (const img of images) {
      const fname = `${img.name.replace(/[\/:]/g, '_')}_${img.tag ?? 'latest'}.tar`;
      writeFileSync(join(imagesDir, fname), Buffer.from('dummy'));
    }
    return;
  }

  for (const img of images) {
    const ref = `${img.name}${img.tag ? ':' + img.tag : ''}`;
    await execa('docker', ['pull', '--platform', platform, ref]);
    const out = join(imagesDir, `${img.name.replace(/[\/:]/g, '_')}_${img.tag ?? 'latest'}.tar`);
    await execa('docker', ['save', '-o', out, ref]);
  }
}

function composeYml(images: { name: string; tag?: string }[]) {
  const services = images.map((img, i) => {
    const svc = img.name.split('/').pop()?.split(':')[0] ?? `svc${i}`;
    const tag = img.tag ?? 'latest';
    return `  ${svc}:\n    image: ${img.name}:${tag}\n    restart: unless-stopped\n`;
  }).join('\n');
  return `version: "3"\nservices:\n${services}`;
}

function installSh() {
  return `#!/usr/bin/env bash\nset -euo pipefail\nif ! command -v docker >/dev/null; then echo "Docker not installed"; exit 1; fi\nif ! docker compose version >/dev/null 2>&1; then echo "Docker Compose V2 required"; exit 1; fi\ncd "$(dirname "$0")/../docker"\nfor f in images/*.tar; do [ -f "$f" ] && docker load -i "$f"; done\nDOCKER_BUILDKIT=0 COMPOSE_DOCKER_CLI_BUILD=0 docker compose up -d\necho "\nDone. Containers running:" && docker ps --format '{{.Names}}  ->  {{.Image}}'\n`;
}

async function assembleBundle(bundleDir: string, images: { name: string; tag?: string }[]) {
  const compose = composeYml(images);
  const scriptsDir = join(bundleDir, 'scripts');
  const dockerDir = join(bundleDir, 'docker');
  ensureDir(join(dockerDir, 'images'));
  ensureDir(scriptsDir);

  writeFileSync(join(dockerDir, 'docker-compose.yml'), compose);
  writeFileSync(join(dockerDir, 'load-images.sh'), '#!/usr/bin/env bash\nset -e\nfor f in images/*.tar; do docker load -i "$f"; done\n');
  writeFileSync(join(scriptsDir, 'install.sh'), installSh());
  writeFileSync(join(bundleDir, 'README.md'), '# AirGap Bundle (Docker)\n\n1) Ensure Docker + Compose v2 installed.\n2) Run scripts/install.sh\n');
}

async function sbomImages(bundleDir: string) {
  const files = await fg('docker/images/*.tar', { cwd: bundleDir });
  const entries = files.map((f) => {
    const s = statSync(join(bundleDir, f));
    return { file: f, size: s.size };
  });
  const path = join(bundleDir, 'compliance');
  ensureDir(path);
  const out = join(path, 'sbom-images.json');
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), images: entries }, null, 2));
  return out;
}

export function startDockerWorker() {
  new Worker('bundles', async (job: Job) => {
    const jobId = job.id as string;
    const record = await prisma.bundleJob.findUnique({ where: { id: jobId } });
    if (!record) return;
    const spec: any = record.spec;
    if (spec.target !== 'docker') return; // ignore non-docker jobs

    await prisma.bundleJob.update({ where: { id: jobId }, data: { status: 'RUNNING' } });

    const platform = spec.platform ?? process.env.DEFAULT_PLATFORM ?? 'linux/amd64';
    const baseDir = join(process.env.STORAGE_DIR ?? './storage', jobId);
    ensureDir(baseDir);

    await assembleBundle(baseDir, spec.images);
    await dockerSaveImages(baseDir, spec.images, platform);

    const complianceDir = join(baseDir, 'compliance');
    ensureDir(complianceDir);

    const imageFiles = await fg('docker/images/*.tar', { cwd: baseDir });
    const lines = imageFiles.map((f) => `${sha256File(join(baseDir, f))}  ${f}`);
    const checksumsPath = join(complianceDir, 'checksums.txt');
    writeFileSync(checksumsPath, lines.join('\n') + '\n');

    const sbomPath = await sbomImages(baseDir);

    const zipOut = join(process.env.STORAGE_DIR ?? './storage', `${jobId}.zip`);
    await zipFolder(baseDir, zipOut);

    const artifacts = [
      { kind: 'zip', filename: `${jobId}.zip`, path: zipOut },
      { kind: 'checksum', filename: 'compliance/checksums.txt', path: checksumsPath },
      { kind: 'sbom', filename: 'compliance/sbom-images.json', path: sbomPath }
    ];

    for (const a of artifacts) {
      const size = statSync(a.path).size;
      const checksum = sha256File(a.path);
      await prisma.artifact.create({ data: { jobId, kind: a.kind, filename: a.filename, size, checksum } });
    }

    await prisma.bundleJob.update({ where: { id: jobId }, data: { status: 'SUCCEEDED', finishedAt: new Date() } });
  }, { connection: redisConnection });
}