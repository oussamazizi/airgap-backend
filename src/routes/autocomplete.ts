import { execa } from 'execa';
import { Router } from 'express';
import fetch from 'node-fetch';

export const autocomplete = Router();

/** ---------- NPM ---------- */
// /api/autocomplete/npm?q=express
autocomplete.get('/npm', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ items: [] });
  try {
    const r = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=20`);
    const j: any = await r.json();
    const items = (j.objects || []).map((o: any) => o.package?.name).filter(Boolean);
    res.json({ items });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// /api/versions/npm?name=express
autocomplete.get('/versions/npm', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.json({ versions: [] });
  try {
    const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (!r.ok) return res.status(404).json({ error: 'not found' });
    const j: any = await r.json();
    const versions = Object.keys(j.versions || {}).sort((a, b) => (a > b ? -1 : 1));
    res.json({ versions });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/** ---------- PIP ---------- */
// /api/autocomplete/pip?q=flas   (parse résultats HTML de la recherche PyPI)
autocomplete.get('/pip', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ items: [] });
  try {
    const r = await fetch(`https://pypi.org/search/?q=${encodeURIComponent(q)}`);
    const html = await r.text();
    const re = /<a class="package-snippet" href="\/project\/([^/]+)\//gi;
    const items: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && items.length < 30) items.push(m[1]);
    res.json({ items: Array.from(new Set(items)) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// /api/versions/pip?name=Flask
autocomplete.get('/versions/pip', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.json({ versions: [] });
  try {
    const r = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (!r.ok) return res.status(404).json({ error: 'not found' });
    const j: any = await r.json();
    const versions = Object.keys(j.releases || {}).sort((a, b) => (a > b ? -1 : 1));
    res.json({ versions });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/** ---------- APT ---------- */
// util: map ubuntu:tag -> suite
function ubuntuSuiteFromTag(tag: string) {
  if (tag.includes('24.04')) return 'noble';
  if (tag.includes('22.04')) return 'jammy';
  if (tag.includes('20.04')) return 'focal';
  return 'jammy';
}

// /api/autocomplete/apt?q=curl&image=ubuntu:22.04  (rapide via packages.ubuntu.com)
autocomplete.get('/apt', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const image = String(req.query.image || 'ubuntu:22.04');
  if (!q) return res.json({ items: [] });
  const suite = ubuntuSuiteFromTag(image);
  try {
    const url = `https://packages.ubuntu.com/${suite}/search?keywords=${encodeURIComponent(q)}&searchon=names&suite=${suite}&section=all`;
    const r = await fetch(url);
    const html = await r.text();
    const re = /<a href="\/${suite}\/[^"]+">([^<]+)<\/a>/gi;
    const items: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && items.length < 50) items.push(m[1]);
    res.json({ items: Array.from(new Set(items)) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// /api/versions/apt?name=curl&image=ubuntu:22.04  (exact via docker apt-cache)
autocomplete.get('/versions/apt', async (req, res) => {
  const name = String(req.query.name || '').trim();
  const image = String(req.query.image || 'ubuntu:22.04');
  if (!name) return res.json({ versions: [] });
  try {
    const script = `
      set -e
      apt-get update -qq
      apt-cache madison ${name} | awk '{print $3}' | head -n 50
    `;
    const { stdout } = await execa('docker', ['run', '--rm', image, 'bash', '-lc', script], { timeout: 25000 });
    const versions = stdout.split('\n').map(s => s.trim()).filter(Boolean);
    res.json({ versions });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
