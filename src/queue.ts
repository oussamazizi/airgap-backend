import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config.js';

export type BundleSpec = {
  target: 'docker' | 'host';
  images?: { name: string; tag?: string }[];
  npm?: { name: string; version: string }[];
  pip?: { name: string; version?: string }[];
  apt?: { name: string; version?: string }[];
  platform?: 'linux/amd64' | 'linux/arm64';
};

// ✅ Connexion Redis partagée avec l’option requise par BullMQ
export const redisConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,   // <— IMPORTANT
  // enableReadyCheck: false,   // (optionnel, utile si Redis managé)
});

export const bundleQueue = new Queue<BundleSpec>('bundles', {
  connection: redisConnection,
});
