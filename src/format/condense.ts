import { format } from 'date-fns';
import type { SourceResult } from '../types.js';

const MAX_PER_SOURCE = 60;

export function condenseForLlm(results: SourceResult[]): string {
  const blocks: string[] = [];
  for (const r of results) {
    if (r.activities.length === 0) continue;
    const lines: string[] = [];
    lines.push(`## ${r.source}`);
    for (const a of r.activities.slice(0, MAX_PER_SOURCE)) {
      const time = format(new Date(a.timestamp), 'HH:mm');
      lines.push(`- ${time} [${a.type}] ${a.title}${detailSuffix(a.details)}`);
    }
    if (r.activities.length > MAX_PER_SOURCE) {
      lines.push(`- (… ${r.activities.length - MAX_PER_SOURCE} weitere ${r.source}-Einträge ausgelassen)`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

function detailSuffix(details: Record<string, unknown> | undefined): string {
  if (!details) return '';
  const parts: string[] = [];
  if (typeof details.repo === 'string') parts.push(`repo=${details.repo}`);
  if (typeof details.status === 'string') parts.push(`status=${details.status}`);
  if (typeof details.project === 'string') parts.push(`project=${details.project}`);
  if (details.unpushed === true) parts.push('unpushed');
  return parts.length ? `  (${parts.join(', ')})` : '';
}
