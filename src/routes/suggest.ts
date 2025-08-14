// src/routes/suggest.ts
import { Router } from 'express';
import fetch from 'node-fetch'; // npm i node-fetch@3
export const suggest = Router();

/**
 * NPM: /api/suggest/npm?name=express[&version=4.18.2]
 * Renvoie: { name, version, dependencies: [{name, range}] }
 */
suggest.get('/npm', async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    const want = String(req.query.version || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (!r.ok) return res.status(404).json({ error: `npm package not found: ${name}` });
    const meta: any = await r.json();

    const version = want || meta['dist-tags']?.latest || Object.keys(meta.versions || {}).pop();
    const manifest = meta.versions?.[version];
    if (!manifest) return res.status(404).json({ error: `version not found: ${version}` });

    const deps = Object.entries(manifest.dependencies || {}).map(([n, range]) => ({ name: n, range }));
    return res.json({ name, version, dependencies: deps });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

/**
 * PIP: /api/suggest/pip?name=flask[&version=2.2.5]
 * Renvoie: { name, version, dependencies: [{name, spec}] }
 * Parse 'requires_dist' depuis PyPI, filtre les marqueurs env.
 */
suggest.get('/pip', async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    const want = String(req.query.version || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const r = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (!r.ok) return res.status(404).json({ error: `pypi package not found: ${name}` });
    const meta: any = await r.json();

    const version = want || meta.info?.version;
    const dataForVersion = meta.releases?.[version]?.length ? meta.releases[version][0] : null;
    const requiresDist: string[] =
      meta.info?.requires_dist ||
      meta.releases?.[version]?.[0]?.requires_dist ||
      [];

    // Parse minimal : "pkgA (>=1.0); python_version>='3.8'"
    const deps = requiresDist
      .map(line => line.split(';')[0].trim()) // ignore markers
      .filter(Boolean)
      .map(line => {
        const m = line.match(/^([A-Za-z0-9_.\-]+)\s*(\(.+\))?\s*$/);
        const pkg = m?.[1] || line;
        const spec = (m?.[2] || '').replace(/^\(|\)$/g, '');
        return { name: pkg, spec };
      });

    return res.json({ name, version, dependencies: deps });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});
