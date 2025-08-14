import { createHash } from 'crypto';
import { readFileSync } from 'fs';

export function sha256File(path: string) {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
}