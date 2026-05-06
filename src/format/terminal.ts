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

  lines.push(footer(`${total} Aktivitäten · ${activeSources} Quellen`));
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
  for (const line of llmText.split('\n')) {
    lines.push(line.startsWith('-') ? `  ${c.cyan('•')}${line.slice(1)}` : `  ${line}`);
  }
  lines.push('');
  const total = results.reduce((n, r) => n + r.activities.length, 0);
  const sources = results.filter((r) => r.activities.length > 0).length;
  lines.push(
    footer(`${total} Aktivitäten · ${sources} Quellen · fetch ${fetchSeconds.toFixed(1)}s · llm ${llmSeconds.toFixed(1)}s`),
  );
  return lines.join('\n');
}
