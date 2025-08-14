import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  storageDir: process.env.STORAGE_DIR ?? './storage',
  defaultPlatform: (process.env.DEFAULT_PLATFORM as 'linux/amd64' | 'linux/arm64') ?? 'linux/amd64',
  cronSecret: process.env.INTERNAL_CRON_SECRET ?? 'change-me',
  dockerDisabled: (process.env.DOCKER_DISABLED ?? 'false').toLowerCase() === 'true'
};