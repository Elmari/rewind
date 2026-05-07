import type { StageRule } from '../config.js';
import type { Activity, SourceResult } from '../types.js';

const TICKET_KEY_RE = /\b([A-Z][A-Z0-9_]+-\d+)\b/;

export interface TicketAggregate {
  key: string;
  summary?: string;
  status?: string;
  resolution?: string;

  localCommits: Array<{ repo: string; hash: string; subject: string; ts: string; unpushed?: boolean }>;
  prsOpened: Array<{ repo: string; id: number; title: string; fromBranch?: string; toBranch?: string; url?: string }>;
  prsMerged: Array<{ repo: string; id: number; title: string; fromBranch?: string; toBranch?: string; stageReached?: string; url?: string }>;
  prsDeclined: Array<{ repo: string; id: number; title: string; url?: string }>;
  prsReviewed: Array<{ repo: string; id: number; title: string; action: string }>;
  prCommentsCount: number;
  statusTransitions: Array<{ from?: string; to?: string; ts: string; resolution?: string }>;
  worklogs: Array<{ timeSpent?: string; comment?: string; ts: string }>;

  // derived
  hasNewCode: boolean;
  stagesReachedToday: string[];
  mergeOnly: boolean; // true ⇒ only stage promotion happened, no new code in range
}

export interface MiscEntry {
  source: string;
  type: string;
  ts: string;
  title: string;
  details?: Record<string, unknown>;
}

export interface AggregateResult {
  tickets: TicketAggregate[];
  misc: MiscEntry[];
}

export function extractTicketKey(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(TICKET_KEY_RE);
  return m ? m[1] : undefined;
}

function stripKey(text: string, key: string): string {
  // Remove the ticket key + common separators from the front of a title
  // so we don't end up with "PROJ-1234 — PROJ-1234: add cache".
  return text
    .replace(new RegExp(`^\\s*\\[?${key}\\]?[:\\s\\-—]*`, 'i'), '')
    .replace(new RegExp(`\\b${key}\\b[:\\s\\-—]*`, 'i'), '')
    .trim();
}

export function matchStage(branch: string | undefined, rules: StageRule[]): string | undefined {
  if (!branch) return undefined;
  for (const r of rules) {
    if (r.match.endsWith('/*')) {
      const prefix = r.match.slice(0, -1); // keep trailing slash
      if (branch.startsWith(prefix)) return r.label;
    } else if (branch === r.match) {
      return r.label;
    }
  }
  return undefined;
}

export function aggregateByTicket(results: SourceResult[], stages: StageRule[]): AggregateResult {
  const tickets = new Map<string, TicketAggregate>();
  const misc: MiscEntry[] = [];

  const ensure = (key: string): TicketAggregate => {
    let t = tickets.get(key);
    if (!t) {
      t = {
        key,
        localCommits: [],
        prsOpened: [],
        prsMerged: [],
        prsDeclined: [],
        prsReviewed: [],
        prCommentsCount: 0,
        statusTransitions: [],
        worklogs: [],
        hasNewCode: false,
        stagesReachedToday: [],
        mergeOnly: false,
      };
      tickets.set(key, t);
    }
    return t;
  };

  const pushMisc = (a: Activity) => {
    misc.push({ source: a.source, type: a.type, ts: a.timestamp, title: a.title, details: a.details });
  };

  for (const r of results) {
    for (const a of r.activities) {
      switch (a.source) {
        case 'jira':
          handleJira(a, ensure);
          break;
        case 'bitbucket':
          handleBitbucket(a, ensure, stages, pushMisc);
          break;
        case 'gitlab':
        case 'github':
          handleForeignPr(a, ensure, stages, pushMisc);
          break;
        case 'git':
          handleGitCommit(a, ensure, pushMisc);
          break;
        default:
          pushMisc(a);
      }
    }
  }

  // derive booleans + title fallback
  for (const t of tickets.values()) {
    t.hasNewCode = t.localCommits.length > 0 || t.prsOpened.length > 0;
    const stageSet = new Set<string>();
    for (const m of t.prsMerged) {
      if (m.stageReached) stageSet.add(m.stageReached);
    }
    t.stagesReachedToday = [...stageSet];
    t.mergeOnly = !t.hasNewCode && t.prsMerged.length > 0;
    if (!t.summary) {
      const fallback =
        t.prsOpened[0]?.title ||
        t.localCommits[0]?.subject ||
        t.prsMerged[0]?.title;
      if (fallback) t.summary = stripKey(fallback, t.key);
    }
  }

  // stable order: tickets sorted by key, misc by timestamp
  const sortedTickets = [...tickets.values()].sort((a, b) => a.key.localeCompare(b.key));
  misc.sort((a, b) => a.ts.localeCompare(b.ts));

  return { tickets: sortedTickets, misc };
}

function handleJira(a: Activity, ensure: (k: string) => TicketAggregate): void {
  const issueKey = (a.details?.issue as string | undefined) ?? extractTicketKey(a.title);
  if (!issueKey) return;
  const t = ensure(issueKey);
  const summary = a.details?.summary as string | undefined;
  if (summary && !t.summary) t.summary = summary;
  if (a.type === 'issue-touched') {
    if (!t.summary) {
      // title format "PROJ-1234: Summary [Resolution]"
      const m = a.title.match(/^[A-Z][A-Z0-9_]+-\d+:\s*(.+?)(?:\s*\[[^\]]+\])?$/);
      if (m) t.summary = m[1];
    }
    if (typeof a.details?.status === 'string') t.status = a.details.status;
    if (typeof a.details?.resolution === 'string') t.resolution = a.details.resolution;
  } else if (a.type === 'status-transition') {
    t.statusTransitions.push({
      from: a.details?.from as string | undefined,
      to: a.details?.to as string | undefined,
      ts: a.timestamp,
      resolution: a.details?.resolution as string | undefined,
    });
  } else if (a.type === 'worklog') {
    const seconds = a.details?.seconds as number | undefined;
    const timeSpent = seconds ? `${Math.round(seconds / 60)}m` : undefined;
    t.worklogs.push({ timeSpent, ts: a.timestamp });
  }
}

function handleBitbucket(
  a: Activity,
  ensure: (k: string) => TicketAggregate,
  stages: StageRule[],
  pushMisc: (a: Activity) => void,
): void {
  const fromBranch = a.details?.from as string | undefined;
  const toBranch = a.details?.to as string | undefined;
  const repo = (a.details?.repo as string | undefined) ?? '';
  const prId = (a.details?.prId as number | undefined) ?? 0;
  // ticket key may be in PR title or in source branch name
  const titleOnly = a.title.replace(/^[^:]+:\s*/, '').replace(/\s*\[[^\]]+\]$/, '');
  const key = extractTicketKey(titleOnly) ?? extractTicketKey(fromBranch);
  if (!key) {
    pushMisc(a);
    return;
  }
  const t = ensure(key);
  switch (a.type) {
    case 'pr-opened':
      t.prsOpened.push({ repo, id: prId, title: titleOnly, fromBranch, toBranch });
      break;
    case 'pr-merged':
      t.prsMerged.push({
        repo,
        id: prId,
        title: titleOnly,
        fromBranch,
        toBranch,
        stageReached: matchStage(toBranch, stages),
      });
      break;
    case 'pr-declined':
      t.prsDeclined.push({ repo, id: prId, title: titleOnly });
      break;
    case 'pr-review':
      t.prsReviewed.push({ repo, id: prId, title: titleOnly, action: (a.details?.action as string | undefined) ?? 'reviewed' });
      break;
    case 'pr-comment':
      t.prCommentsCount++;
      break;
    default:
      pushMisc(a);
  }
}

function handleForeignPr(
  a: Activity,
  ensure: (k: string) => TicketAggregate,
  stages: StageRule[],
  pushMisc: (a: Activity) => void,
): void {
  const fromBranch = a.details?.from as string | undefined;
  const toBranch = a.details?.to as string | undefined;
  const key = extractTicketKey(a.title) ?? extractTicketKey(fromBranch);
  if (!key) {
    pushMisc(a);
    return;
  }
  const t = ensure(key);
  const repo = (a.details?.repo as string | undefined) ?? '';
  const prId = (a.details?.prId as number | undefined) ?? (a.details?.mrId as number | undefined) ?? 0;
  if (a.type === 'pr-opened' || a.type === 'mr-opened') {
    t.prsOpened.push({ repo, id: prId, title: a.title, fromBranch, toBranch });
  } else if (a.type === 'pr-merged' || a.type === 'mr-merged') {
    t.prsMerged.push({
      repo,
      id: prId,
      title: a.title,
      fromBranch,
      toBranch,
      stageReached: matchStage(toBranch, stages),
    });
  } else {
    pushMisc(a);
  }
}

function handleGitCommit(
  a: Activity,
  ensure: (k: string) => TicketAggregate,
  pushMisc: (a: Activity) => void,
): void {
  const key = extractTicketKey(a.title);
  if (!key) {
    pushMisc(a);
    return;
  }
  const t = ensure(key);
  t.localCommits.push({
    repo: (a.details?.repo as string | undefined) ?? '',
    hash: (a.details?.hash as string | undefined) ?? '',
    subject: a.title,
    ts: a.timestamp,
    unpushed: a.details?.unpushed === true,
  });
}

export function renderAggregateForPrompt(agg: AggregateResult): string {
  const lines: string[] = [];
  for (const t of agg.tickets) {
    lines.push(`### ${t.key}${t.summary ? ` — ${t.summary}` : ''}`);
    if (t.status) lines.push(`  status: ${t.status}${t.resolution ? ` (${t.resolution})` : ''}`);
    if (t.localCommits.length) {
      lines.push(`  local-commits (${t.localCommits.length}):`);
      for (const c of t.localCommits) {
        lines.push(`    - [${c.repo}@${c.hash}] ${c.subject}${c.unpushed ? ' (unpushed)' : ''}`);
      }
    }
    if (t.prsOpened.length) {
      lines.push(`  prs-opened (${t.prsOpened.length}):`);
      for (const p of t.prsOpened) {
        lines.push(`    - ${p.repo}#${p.id}: ${p.title} [${p.fromBranch ?? '?'} → ${p.toBranch ?? '?'}]`);
      }
    }
    if (t.prsMerged.length) {
      lines.push(`  prs-merged (${t.prsMerged.length}):`);
      for (const p of t.prsMerged) {
        const stage = p.stageReached ? ` ⇒ stage: ${p.stageReached}` : '';
        lines.push(`    - ${p.repo}#${p.id}: ${p.title} [${p.fromBranch ?? '?'} → ${p.toBranch ?? '?'}]${stage}`);
      }
    }
    if (t.prsDeclined.length) lines.push(`  prs-declined: ${t.prsDeclined.length}`);
    if (t.prsReviewed.length) {
      lines.push(`  prs-reviewed-by-me (${t.prsReviewed.length}):`);
      for (const r of t.prsReviewed) {
        lines.push(`    - ${r.repo}#${r.id}: ${r.title} (${r.action})`);
      }
    }
    if (t.prCommentsCount) lines.push(`  pr-comments-by-me: ${t.prCommentsCount}`);
    if (t.statusTransitions.length) {
      const trs = t.statusTransitions.map((s) => `${s.from ?? '?'}→${s.to ?? '?'}${s.resolution ? ` [${s.resolution}]` : ''}`).join(', ');
      lines.push(`  status-transitions: ${trs}`);
    }
    if (t.worklogs.length) {
      const total = t.worklogs.map((w) => w.timeSpent).filter(Boolean).join('+') || `${t.worklogs.length} entries`;
      lines.push(`  worklogs: ${total}`);
    }
    // facts the LLM should not need to derive
    lines.push(`  facts: hasNewCode=${t.hasNewCode}, mergeOnly=${t.mergeOnly}, stagesReachedToday=[${t.stagesReachedToday.join(', ')}]`);
    lines.push('');
  }
  // Group ticketless git commits by repo so the LLM produces one bullet per repo
  // ("lokale Commits in <repo>: …") instead of a flat undifferentiated list.
  const gitMisc = agg.misc.filter((m) => m.source === 'git' && m.type === 'commit');
  const otherMisc = agg.misc.filter((m) => !(m.source === 'git' && m.type === 'commit'));
  if (gitMisc.length) {
    const byRepo = new Map<string, string[]>();
    for (const m of gitMisc) {
      const repo = (m.details?.repo as string | undefined) ?? 'unknown';
      const list = byRepo.get(repo) ?? [];
      list.push(m.title);
      byRepo.set(repo, list);
    }
    lines.push('### local-commits-without-ticket-key (group by repo)');
    lines.push('  Render ONE bullet per repo. Summarize the subjects in keywords (3-6 words).');
    for (const [repo, subjects] of byRepo) {
      lines.push(`- repo=${repo} (${subjects.length} commits):`);
      for (const s of subjects) lines.push(`    - ${s}`);
    }
    lines.push('');
  }
  if (otherMisc.length) {
    lines.push('### misc (other ticketless activity)');
    for (const m of otherMisc) {
      lines.push(`- ${m.ts.slice(11, 16)} [${m.source}/${m.type}] ${m.title}`);
    }
  }
  return lines.join('\n').trimEnd();
}
