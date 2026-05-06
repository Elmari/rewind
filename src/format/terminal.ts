import { format } from 'date-fns';
import type { DateRange, SourceResult } from '../types.js';
import { SOURCE_COLOR, SOURCE_EMOJI, banner, c, footer } from '../ui.js';

const SOURCE_LABELS: Record<string, string> = {
  jira: 'Jira',
  confluence: 'Confluence',
  bitbucket: 'Bitbucket',
  gitlab: 'GitLab',
  github: 'GitHub',
  git: 'Git',
  jenkins: 'Jenkins',
  todoist: 'Todoist',
  outlook: 'Outlook',
  teams: 'Teams',
};

export function renderTerminal(range: DateRange, results: SourceResult[]): string {
  const lines: string[] = [];
  lines.push(banner('rewind', range.label));

  let total = 0;
  let activeSources = 0;

  for (const r of results) {
    const label = SOURCE_LABELS[r.source] ?? r.source;
    const emoji = SOURCE_EMOJI[r.source] ?? '·';
    const color = SOURCE_COLOR[r.source] ?? c.gray;

    if (r.error) {
      lines.push(`  ${emoji} ${color(c.bold(label))}  ${c.red('· ' + r.error)}`);
      lines.push('');
      continue;
    }
    if (r.activities.length === 0) continue;

    activeSources += 1;
    total += r.activities.length;

    lines.push(`  ${emoji} ${color(c.bold(label))} ${c.dim(`(${r.activities.length})`)}`);
    for (const a of r.activities) {
      const time = c.dim(format(new Date(a.timestamp), 'HH:mm'));
      const title = a.title.length > 90 ? a.title.slice(0, 87) + '…' : a.title;
      lines.push(`     ${time}  ${title}`);
    }
    lines.push('');
  }

  if (total === 0) {
    lines.push(`  ${c.dim('(keine Aktivitäten gefunden)')}`);
    lines.push('');
  }

  let openTotal = 0;
  const openLines: string[] = [];
  for (const r of results) {
    const open = r.open ?? [];
    if (open.length === 0) continue;
    const label = SOURCE_LABELS[r.source] ?? r.source;
    const emoji = SOURCE_EMOJI[r.source] ?? '·';
    const color = SOURCE_COLOR[r.source] ?? c.gray;
    openTotal += open.length;
    openLines.push(`  ${emoji} ${color(c.bold(label))} ${c.dim(`(${open.length})`)}`);
    for (const o of open) {
      const title = o.title.length > 90 ? o.title.slice(0, 87) + '…' : o.title;
      const status = o.status ? c.dim(` [${o.status}]`) : '';
      openLines.push(`     ${title}${status}`);
    }
    openLines.push('');
  }
  if (openLines.length) {
    lines.push(`  ${c.bold(c.yellow('— Aktuell offen —'))}`);
    lines.push('');
    lines.push(...openLines);
  }

  let agendaTotal = 0;
  const agendaLines: string[] = [];
  for (const r of results) {
    const agenda = r.agenda ?? [];
    if (agenda.length === 0) continue;
    const label = SOURCE_LABELS[r.source] ?? r.source;
    const emoji = SOURCE_EMOJI[r.source] ?? '·';
    const color = SOURCE_COLOR[r.source] ?? c.gray;
    agendaTotal += agenda.length;
    agendaLines.push(`  ${emoji} ${color(c.bold(label))} ${c.dim(`(${agenda.length})`)}`);
    for (const a of agenda) {
      const time = c.dim(format(new Date(a.start), 'HH:mm'));
      const endTime = a.end ? c.dim(`–${format(new Date(a.end), 'HH:mm')}`) : '';
      const title = a.title.length > 80 ? a.title.slice(0, 77) + '…' : a.title;
      agendaLines.push(`     ${time}${endTime}  ${title}`);
    }
    agendaLines.push('');
  }
  if (agendaLines.length) {
    lines.push(`  ${c.bold(c.cyan('— Heute —'))}`);
    lines.push('');
    lines.push(...agendaLines);
  }

  const stats = [`${total} Aktivitäten`, `${activeSources} Quellen`];
  if (openTotal) stats.push(`${openTotal} offen`);
  if (agendaTotal) stats.push(`${agendaTotal} heute`);
  lines.push(footer(stats.join(' · ')));
  return lines.join('\n');
}

export function renderTerminalSummary(
  range: DateRange,
  llmText: string,
  results: SourceResult[],
  fetchSeconds: number,
  llmSeconds: number,
): string {
  const lines: string[] = [];
  lines.push(banner('rewind', range.label));
  for (const raw of llmText.split('\n')) {
    const trimmed = raw.trim();
    if (/^heute|^today/i.test(trimmed)) {
      lines.push('');
      lines.push(`  ${c.bold(c.cyan('— ' + trimmed.replace(/:$/, '') + ' —'))}`);
      lines.push('');
    } else if (/^aktuell offen|^currently open/i.test(trimmed)) {
      lines.push('');
      lines.push(`  ${c.bold(c.yellow('— ' + trimmed.replace(/:$/, '') + ' —'))}`);
      lines.push('');
    } else if (raw.startsWith('-')) {
      lines.push(`  ${c.cyan('•')}${raw.slice(1)}`);
    } else {
      lines.push(`  ${raw}`);
    }
  }
  lines.push('');
  const total = results.reduce((n, r) => n + r.activities.length, 0);
  const open = results.reduce((n, r) => n + (r.open?.length ?? 0), 0);
  const agenda = results.reduce((n, r) => n + (r.agenda?.length ?? 0), 0);
  const sources = results.filter(
    (r) => r.activities.length > 0 || (r.open?.length ?? 0) > 0 || (r.agenda?.length ?? 0) > 0,
  ).length;
  const stats = [`${total} Aktivitäten`];
  if (open) stats.push(`${open} offen`);
  if (agenda) stats.push(`${agenda} heute`);
  stats.push(`${sources} Quellen`);
  stats.push(`fetch ${fetchSeconds.toFixed(1)}s`);
  stats.push(`llm ${llmSeconds.toFixed(1)}s`);
  lines.push(footer(stats.join(' · ')));
  return lines.join('\n');
}
