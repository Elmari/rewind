import { format } from 'date-fns';
import type { SourceResult } from '../types.js';
import type { AggregateResult } from './aggregate.js';
import { renderAggregateForPrompt } from './aggregate.js';

const MAX_OPEN_PER_SOURCE = 25;
const MAX_SUGGESTIONS_PER_SOURCE = 10;
const MAX_AGENDA_PER_SOURCE = 25;
const MAX_TITLE_LEN = 150;

export interface CondensedInput {
  activities: string;
  openItems: string;
  suggestions: string;
  agenda: string;
  hasActivities: boolean;
  hasOpen: boolean;
  hasSuggestions: boolean;
  hasAgenda: boolean;
}

export function condenseForLlm(aggregate: AggregateResult, results: SourceResult[]): CondensedInput {
  const activityText = renderAggregateForPrompt(aggregate);
  const hasActivities = aggregate.tickets.length > 0 || aggregate.misc.length > 0;

  const openBlocks: string[] = [];
  for (const r of results) {
    const open = r.open ?? [];
    if (open.length === 0) continue;
    const lines: string[] = [];
    lines.push(`## ${r.source}`);
    for (const o of open.slice(0, MAX_OPEN_PER_SOURCE)) {
      const status = o.status ? ` [${o.status}]` : '';
      const title = o.title.length > MAX_TITLE_LEN ? o.title.slice(0, MAX_TITLE_LEN) + '…' : o.title;
      lines.push(`- [${o.type}] ${title}${status}`);
    }
    if (open.length > MAX_OPEN_PER_SOURCE) {
      lines.push(`- (… ${open.length - MAX_OPEN_PER_SOURCE} weitere ${r.source}-Einträge ausgelassen)`);
    }
    openBlocks.push(lines.join('\n'));
  }

  const suggestionBlocks: string[] = [];
  for (const r of results) {
    const sugg = r.suggestions ?? [];
    if (sugg.length === 0) continue;
    const lines: string[] = [];
    lines.push(`## ${r.source}`);
    for (const s of sugg.slice(0, MAX_SUGGESTIONS_PER_SOURCE)) {
      const status = s.status ? ` [${s.status}]` : '';
      const title = s.title.length > MAX_TITLE_LEN ? s.title.slice(0, MAX_TITLE_LEN) + '…' : s.title;
      lines.push(`- [${s.type}] ${title}${status}`);
    }
    if (sugg.length > MAX_SUGGESTIONS_PER_SOURCE) {
      lines.push(`- (… ${sugg.length - MAX_SUGGESTIONS_PER_SOURCE} weitere ${r.source}-Einträge ausgelassen)`);
    }
    suggestionBlocks.push(lines.join('\n'));
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
      const title = a.title.length > MAX_TITLE_LEN ? a.title.slice(0, MAX_TITLE_LEN) + '…' : a.title;
      lines.push(`- ${time}${endTime} [${a.type}] ${title}`);
    }
    if (agenda.length > MAX_AGENDA_PER_SOURCE) {
      lines.push(`- (… ${agenda.length - MAX_AGENDA_PER_SOURCE} weitere ${r.source}-Einträge ausgelassen)`);
    }
    agendaBlocks.push(lines.join('\n'));
  }

  return {
    activities: activityText,
    openItems: openBlocks.join('\n\n'),
    suggestions: suggestionBlocks.join('\n\n'),
    agenda: agendaBlocks.join('\n\n'),
    hasActivities,
    hasOpen: openBlocks.length > 0,
    hasSuggestions: suggestionBlocks.length > 0,
    hasAgenda: agendaBlocks.length > 0,
  };
}
