import { format } from 'date-fns';
import type { SourceResult } from '../types.js';

const MAX_PER_SOURCE = 60;
const MAX_OPEN_PER_SOURCE = 30;
const MAX_AGENDA_PER_SOURCE = 30;

export interface CondensedInput {
  activities: string;
  openItems: string;
  agenda: string;
  hasActivities: boolean;
  hasOpen: boolean;
  hasAgenda: boolean;
}

export function condenseForLlm(results: SourceResult[]): CondensedInput {
  const activityBlocks: string[] = [];
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
    activityBlocks.push(lines.join('\n'));
  }

  const openBlocks: string[] = [];
  for (const r of results) {
    const open = r.open ?? [];
    if (open.length === 0) continue;
    const lines: string[] = [];
    lines.push(`## ${r.source}`);
    for (const o of open.slice(0, MAX_OPEN_PER_SOURCE)) {
      const status = o.status ? ` [${o.status}]` : '';
      lines.push(`- [${o.type}] ${o.title}${status}`);
    }
    if (open.length > MAX_OPEN_PER_SOURCE) {
      lines.push(`- (… ${open.length - MAX_OPEN_PER_SOURCE} weitere ${r.source}-Einträge ausgelassen)`);
    }
    openBlocks.push(lines.join('\n'));
  }

  const agendaBlocks: string[] = [];
  for (const r of results) {
    const agenda = r.agenda ?? [];
    if (agenda.length === 0) continue;
    const lines: string[] = [];
    lines.push(`## ${r.source}`);
    for (const a of agenda.slice(0, MAX_AGENDA_PER_SOURCE)) {
      const time = format(new Date(a.start), 'HH:mm');
      const endTime = a.end ? `–${format(new Date(a.end), 'HH:mm')}` : '';
      lines.push(`- ${time}${endTime} [${a.type}] ${a.title}`);
    }
    if (agenda.length > MAX_AGENDA_PER_SOURCE) {
      lines.push(`- (… ${agenda.length - MAX_AGENDA_PER_SOURCE} weitere ${r.source}-Einträge ausgelassen)`);
    }
    agendaBlocks.push(lines.join('\n'));
  }

  return {
    activities: activityBlocks.join('\n\n'),
    openItems: openBlocks.join('\n\n'),
    agenda: agendaBlocks.join('\n\n'),
    hasActivities: activityBlocks.length > 0,
    hasOpen: openBlocks.length > 0,
    hasAgenda: agendaBlocks.length > 0,
  };
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
