import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import { ensureDir } from '../utils/fs.js';
import { startDockerWorker } from '../workers/dockerWorker.js';
import { startHostWorker } from '../workers/hostWorker.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { autocomplete } from './routes/autocomplete.js';
import { bundlesRouter } from './routes/bundles.js';
import { suggest } from './routes/suggest.js';

async function main() {
  ensureDir(config.storageDir);
  // Start both workers; each ignores jobs that aren't for it
  startDockerWorker();
  startHostWorker();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/bundles', bundlesRouter);
  app.use('/api/suggest', suggest);
  app.use('/api/autocomplete', autocomplete);
  app.use('/api/versions', autocomplete); 

  app.get('/api/bundles/:id/artifacts', async (req, res) => {
    const items = await prisma.artifact.findMany({ where: { jobId: req.params.id } });
    res.json(items);
  });

  app.listen(config.port, () => console.log(`API on :${config.port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});