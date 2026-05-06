import { homedir } from 'node:os';

/**
 * Expand a leading `~` or `~/` to the user's home directory.
 * Cross-platform: handles `~/foo` and `~\foo` on Windows.
 * Returns the path unchanged if it doesn't start with `~`.
 */
export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return homedir() + p.slice(1);
  return p;
}
