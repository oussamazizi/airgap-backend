import { existsSync, mkdirSync } from 'fs';

export function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}