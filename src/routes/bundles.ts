import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { bundleQueue, BundleSpec } from '../queue.js';

const postSchema = z.object({
  target: z.enum(['docker', 'host']).default('docker'),
  images: z.array(z.object({ name: z.string().min(1), tag: z.string().optional() })).optional(),
  npm: z.array(z.object({ name: z.string().min(1), version: z.string().min(1) })).optional(),
  pip: z.array(z.object({ name: z.string().min(1), version: z.string().min(1).optional() })).optional(),
  apt: z.array(z.object({ name: z.string().min(1), version: z.string().min(1).optional() })).optional(),
  platform: z.enum(['linux/amd64', 'linux/arm64']).optional()
}).refine((d) => d.target === 'docker' ? (d.images && d.images.length > 0) : (((d.npm?.length || 0) + (d.pip?.length || 0) + (d.apt?.length || 0)) > 0), {
  message: 'Provide images[] for target=docker OR at least one of npm/pip/apt for target=host.'
});

export const bundlesRouter = Router();

// Create a bundle job
bundlesRouter.post('/', async (req, res) => {
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const spec = parsed.data as BundleSpec;
  const job = await prisma.bundleJob.create({ data: { spec, platform: spec.platform ?? 'linux/amd64' } });
  await bundleQueue.add('build', spec, { jobId: job.id });
  res.status(202).json({ id: job.id, status: 'QUEUED' });
});

// Get job status + artifacts
bundlesRouter.get('/:id', async (req, res) => {
  const job = await prisma.bundleJob.findUnique({ where: { id: req.params.id }, include: { artifacts: true } });
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json(job);
});