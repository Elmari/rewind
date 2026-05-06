import { format } from 'date-fns';
import type { DateRange, SourceResult } from '../types.js';

const SOURCE_LABELS: Record<string, string> = {
  jira: 'Jira',
  confluence: 'Confluence',
  bitbucket: 'Bitbucket',
  gitlab: 'GitLab',
  github: 'GitHub',
  git: 'Git (lokal)',
  jenkins: 'Jenkins',
  todoist: 'Todoist',
  outlook: 'Outlook',
  teams: 'Teams',
};

export function renderMarkdown(range: DateRange, results: SourceResult[]): string {
  return `# rewind — ${range.label}\n\n${renderMarkdownBody(range, results)}`;
}

export function renderMarkdownBody(_range: DateRange, results: SourceResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    const label = SOURCE_LABELS[r.source] ?? r.source;
    if (r.error) {
      lines.push(`## ${label}`);
      lines.push(`> Fehler: ${r.error}`);
      lines.push('');
      continue;
    }
    if (r.activities.length === 0) continue;
    lines.push(`## ${label}`);
    for (const a of r.activities) {
      const time = format(new Date(a.timestamp), 'HH:mm');
      const title = a.url ? `[${a.title}](${a.url})` : a.title;
      lines.push(`- \`${time}\` ${typeLabel(a.type)} — ${title}`);
    }
    lines.push('');
  }

  const openLines: string[] = [];
  for (const r of results) {
    const open = r.open ?? [];
    if (open.length === 0) continue;
    const label = SOURCE_LABELS[r.source] ?? r.source;
    openLines.push(`### ${label}`);
    for (const o of open) {
      const title = o.url ? `[${o.title}](${o.url})` : o.title;
      const status = o.status ? ` *(${o.status})*` : '';
      openLines.push(`- ${typeLabel(o.type)} — ${title}${status}`);
    }
    openLines.push('');
  }
  if (openLines.length) {
    lines.push('## Aktuell offen');
    lines.push('');
    lines.push(...openLines);
  }

  return lines.join('\n');
}

function typeLabel(t: string): string {
  switch (t) {
    case 'commit': return 'Commit';
    case 'issue-touched': return 'Ticket';
    case 'status-transition': return 'Status';
    case 'worklog': return 'Worklog';
    case 'page-created': return 'Seite (neu)';
    case 'page-updated': return 'Seite (Update)';
    case 'comment': return 'Kommentar';
    case 'pr-opened': return 'PR (auf)';
    case 'pr-merged': return 'PR (merge)';
    case 'pr-declined': return 'PR (decline)';
    case 'pr-comment': return 'PR-Kommentar';
    case 'pr-review': return 'PR-Review';
    case 'mr-opened': return 'MR (auf)';
    case 'mr-merged': return 'MR (merge)';
    case 'mr-comment': return 'MR-Kommentar';
    case 'mr-review': return 'MR-Review';
    case 'push': return 'Push';
    case 'issue-opened': return 'Issue (auf)';
    case 'meeting': return 'Termin';
    case 'mail-sent': return 'Mail';
    case 'chat-activity': return 'Chat';
    case 'build': return 'Build';
    case 'task-completed': return 'Task ✓';
    case 'task-created': return 'Task (neu)';
    case 'issue-closed': return 'Issue (zu)';
    case 'open-issue': return 'Ticket';
    case 'open-pr-mine': return 'PR (mein)';
    case 'open-pr-review': return 'PR-Review nötig';
    case 'open-mr-mine': return 'MR (mein)';
    case 'open-mr-review': return 'MR-Review nötig';
    case 'open-task': return 'Task';
    default: return t;
  }
}
