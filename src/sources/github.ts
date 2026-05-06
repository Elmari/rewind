import type { GithubConfig } from '../config.js';
import { request } from '../http.js';
import { rangeContains } from '../range.js';
import type { Activity, DateRange, FetchContext, OpenItem, SourceResult } from '../types.js';

interface GhUser {
  login: string;
  id: number;
}

interface GhEvent {
  id: string;
  type: string;
  created_at: string;
  repo: { name: string };
  payload: Record<string, unknown>;
}

export async function fetchGithub(
  range: DateRange,
  cfg: GithubConfig,
  pat: string,
  ctx: FetchContext,
): Promise<SourceResult> {
  const apiBase = cfg.base_url.replace(/\/$/, '');
  const webBase = cfg.web_url?.replace(/\/$/, '') ?? apiBase.replace(/^https:\/\/api\.github\.com$/, 'https://github.com');
  const headers = {
    authorization: `Bearer ${pat}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };

  let username = cfg.username;
  if (!username) {
    const me = await request<GhUser>(`${apiBase}/user`, { headers });
    username = me.login;
  }
  ctx.log(`github: identified as ${username}`);

  const repoFilter = cfg.repos.length ? new Set(cfg.repos.map((r) => r.toLowerCase())) : null;
  const events = await fetchEvents(apiBase, headers, username, range, ctx);
  ctx.log(`github: ${events.length} events fetched`);

  const activities: Activity[] = [];

  for (const ev of events) {
    if (!rangeContains(range, ev.created_at)) continue;
    if (repoFilter && !repoFilter.has(ev.repo.name.toLowerCase())) continue;
    const a = mapEvent(ev, webBase);
    if (a) activities.push(a);
  }

  activities.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const open = await fetchGithubOpen(apiBase, headers, username, cfg.ignored_authors, ctx);
  return { source: 'github', activities, open };
}

interface GhSearchIssuesResponse {
  items: Array<{
    number: number;
    title: string;
    html_url: string;
    repository_url: string;
    state: string;
    updated_at: string;
    user: { login: string };
    pull_request?: unknown;
  }>;
}

async function fetchGithubOpen(
  apiBase: string,
  headers: Record<string, string>,
  username: string,
  ignoredAuthors: string[],
  ctx: FetchContext,
): Promise<OpenItem[]> {
  const ignored = new Set(ignoredAuthors.map((a) => a.toLowerCase()));
  const out: OpenItem[] = [];
  const cases: Array<{ role: 'mine' | 'review'; q: string }> = [
    { role: 'mine', q: `is:open is:pr author:${username}` },
    { role: 'review', q: `is:open is:pr review-requested:${username}` },
  ];
  for (const { role, q } of cases) {
    try {
      const res = await request<GhSearchIssuesResponse>(`${apiBase}/search/issues`, {
        headers,
        query: { q, per_page: 30 },
      });
      for (const item of res.items) {
        if (ignored.has(item.user.login.toLowerCase())) continue;
        const repo = item.repository_url.replace(/^.*\/repos\//, '');
        out.push({
          source: 'github',
          type: role === 'mine' ? 'open-pr-mine' : 'open-pr-review',
          title: `${repo} #${item.number}: ${item.title}`,
          url: item.html_url,
          status: role === 'mine' ? 'open' : 'awaits my review',
          updated: item.updated_at,
          details: { repo, number: item.number, author: item.user.login },
        });
      }
    } catch (err) {
      ctx.warn(`github: open-pr fetch (${role}) failed`, err);
    }
  }
  return out;
}

async function fetchEvents(
  apiBase: string,
  headers: Record<string, string>,
  username: string,
  range: DateRange,
  ctx: FetchContext,
): Promise<GhEvent[]> {
  const out: GhEvent[] = [];
  for (let page = 1; page <= 5; page++) {
    const events = await request<GhEvent[]>(`${apiBase}/users/${username}/events`, {
      headers,
      query: { per_page: 100, page },
    });
    if (!events.length) break;
    out.push(...events);
    const oldest = events[events.length - 1];
    if (oldest && new Date(oldest.created_at).getTime() < range.since.getTime()) break;
  }
  return out;
}

function mapEvent(ev: GhEvent, webBase: string): Activity | null {
  const repo = ev.repo.name;
  const repoUrl = `${webBase}/${repo}`;
  const ts = ev.created_at;
  const p = ev.payload as Record<string, any>;

  switch (ev.type) {
    case 'PushEvent': {
      const branch = (p.ref as string | undefined)?.replace('refs/heads/', '');
      const commits = (p.commits as Array<{ message: string }> | undefined) ?? [];
      const subject = commits[0]?.message?.split('\n')[0] ?? '(no commit subject)';
      return {
        source: 'github',
        type: 'push',
        timestamp: ts,
        title: `${repo}${branch ? ` [${branch}]` : ''}: ${commits.length} commit(s) — ${subject}`,
        url: repoUrl,
        details: { repo, branch, commits: commits.length },
      };
    }
    case 'PullRequestEvent': {
      const action = p.action as string;
      const pr = p.pull_request as { number: number; title: string; html_url: string; merged?: boolean };
      const isMerge = action === 'closed' && pr.merged;
      const type = action === 'opened' ? 'pr-opened' : isMerge ? 'pr-merged' : action === 'closed' ? 'pr-declined' : null;
      if (!type) return null;
      return {
        source: 'github',
        type,
        timestamp: ts,
        title: `${repo} #${pr.number}: ${pr.title}`,
        url: pr.html_url,
        details: { repo, prNumber: pr.number },
      };
    }
    case 'PullRequestReviewEvent': {
      const pr = p.pull_request as { number: number; title: string; html_url: string };
      const review = p.review as { state: string };
      return {
        source: 'github',
        type: 'pr-review',
        timestamp: ts,
        title: `${repo} #${pr.number}: ${review.state.toLowerCase()} — ${pr.title}`,
        url: pr.html_url,
        details: { repo, prNumber: pr.number, state: review.state },
      };
    }
    case 'PullRequestReviewCommentEvent':
    case 'IssueCommentEvent': {
      const comment = p.comment as { body: string; html_url: string };
      const issue = (p.issue ?? p.pull_request) as { number: number; title: string } | undefined;
      const isPr = ev.type === 'PullRequestReviewCommentEvent' || Boolean((p.issue as any)?.pull_request);
      return {
        source: 'github',
        type: isPr ? 'pr-comment' : 'comment',
        timestamp: ts,
        title: `${repo}${issue ? ` #${issue.number}` : ''}: ${comment.body.slice(0, 140)}`,
        url: comment.html_url,
        details: { repo, issueNumber: issue?.number },
      };
    }
    case 'IssuesEvent': {
      const action = p.action as string;
      if (action !== 'opened' && action !== 'closed') return null;
      const issue = p.issue as { number: number; title: string; html_url: string };
      return {
        source: 'github',
        type: action === 'opened' ? 'issue-opened' : 'issue-closed',
        timestamp: ts,
        title: `${repo} #${issue.number}: ${issue.title}`,
        url: issue.html_url,
        details: { repo, issueNumber: issue.number },
      };
    }
    default:
      return null;
  }
}
