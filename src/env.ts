import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Swallow the experimental-API warning that undici's EnvHttpProxyAgent emits on first use.
// All other warnings stay visible.
const origEmit = process.emit.bind(process);
process.emit = function (name: string | symbol, ...args: unknown[]): boolean {
  if (name === 'warning') {
    const w = args[0] as { code?: string; message?: string } | undefined;
    if (w?.code === 'UNDICI-EHPA' || /EnvHttpProxyAgent/i.test(w?.message ?? '')) {
      return false;
    }
  }
  return (origEmit as (n: string | symbol, ...a: unknown[]) => boolean)(name, ...args);
} as typeof process.emit;

// Priority order: first match wins per-var (dotenv default doesn't override).
const candidates: (string | undefined)[] = [
  process.env.REWIND_ENV,
  join(homedir(), '.config', 'rewind', '.env'),
  join(process.cwd(), '.env'),
];

for (const path of candidates) {
  if (path && existsSync(path)) config({ path });
}
