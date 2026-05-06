import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Priority order: first match wins per-var (dotenv default doesn't override).
const candidates: (string | undefined)[] = [
  process.env.REWIND_ENV,
  join(homedir(), '.config', 'rewind', '.env'),
  join(process.cwd(), '.env'),
];

for (const path of candidates) {
  if (path && existsSync(path)) config({ path });
}
