import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SourceName, SourceResult } from './types.js';

export function cacheRoot(): string {
  const dir = join(homedir(), '.cache', 'rewind');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function dayDir(label: string): string {
  const dir = join(cacheRoot(), label);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function sourcePath(label: string, source: SourceName): string {
  return join(dayDir(label), `${source}.json`);
}

export function readSourceCache(label: string, source: SourceName): SourceResult | null {
  const p = sourcePath(label, source);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as SourceResult;
  } catch {
    return null;
  }
}

export function writeSourceCache(label: string, result: SourceResult): void {
  if (result.error) return; // don't cache failures
  writeFileSync(sourcePath(label, result.source), JSON.stringify(result, null, 2), 'utf8');
}

export function readAllCachedSources(label: string): SourceResult[] {
  const dir = join(cacheRoot(), label);
  if (!existsSync(dir)) return [];
  const out: SourceResult[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')) as SourceResult);
    } catch {
      // ignore corrupt cache entry
    }
  }
  return out;
}
