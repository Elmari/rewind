import type { BitbucketConfig } from '../config.js';
import { atlassianAuthHeader, request } from '../http.js';
import { rangeContains } from '../range.js';
import type { Activity, DateRange, FetchContext, OpenItem, SourceResult } from '../types.js';

interface BbDashboardResponse {
  values: BbPullRequest[];
  isLastPage: boolean;
  nextPageStart?: number;
  size: number;
}

interface BbPullRequest {
  id: number;
  title: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED';
  createdDate: number;
  updatedDate: number;
  closedDate?: number;
  fromRef: { repository: { slug: string; project: { key: string }; name: string } };
  toRef: { repository: { slug: string; project: { key: string } } };
  author: { user: { name: string; slug: string } };
  reviewers: Array<{ user: { name: string; slug: string }; status?: string }>;
  links: { self?: Array<{ href: string }> };
}

interface BbActivityResponse {
  values: BbActivity[];
  isLastPage: boolean;
  nextPageStart?: number;
}

interface BbActivity {
  id: number;
  createdDate: number;
  user: { name: string; slug: string };
  action: string;
  comment?: { text: string; id: number };
  commentAction?: string;
}

export async function fetchBitbucket(
  range: DateRange,
  cfg: BitbucketConfig,
  pat: string,
  user: string | undefined,
  ctx: FetchContext,
): Promise<SourceResult> {
  const headers = { ...atlassianAuthHeader(cfg.auth_method, pat, user), accept: 'application/json' };

  const prs = new Map<string, BbPullRequest>();
  for (const role of ['AUTHOR', 'REVIEWER'] as const) {
    try {
      const list = await fetchDashboardPRs(cfg.base_url, headers, role, range);
      for (const pr of list) prs.set(prKey(pr), pr);
    } catch (err) {
      ctx.warn(`bitbucket: dashboard fetch (${role}) failed`, err);
    }
  }

  ctx.log(`bitbucket: ${prs.size} relevant PRs`);

  const activities: Activity[] = [];

  for (const pr of prs.values()) {
    const repoFull = `${pr.toRef.repository.project.key}/${pr.toRef.repository.slug}`;
    const url = pr.links.self?.[0]?.href;
    const createdIso = new Date(pr.createdDate).toISOString();
    const updatedIso = new Date(pr.updatedDate).toISOString();
    const closedIso = pr.closedDate ? new Date(pr.closedDate).toISOString() : undefined;

    if (rangeContains(range, createdIso) && (!user || pr.author.user.slug === user || pr.author.user.name === user)) {
      activities.push({
        source: 'bitbucket',
        type: 'pr-opened',
        timestamp: createdIso,
        title: `${repoFull} #${pr.id}: ${pr.title}`,
        url,
        details: { repo: repoFull, prId: pr.id, state: pr.state },
      });
    }

    if (closedIso && rangeContains(range, closedIso) && pr.state !== 'OPEN') {
      activities.push({
        source: 'bitbucket',
        type: pr.state === 'MERGED' ? 'pr-merged' : 'pr-declined',
        timestamp: closedIso,
        title: `${repoFull} #${pr.id}: ${pr.title}`,
        url,
        details: { repo: repoFull, prId: pr.id, state: pr.state, mineAsAuthor: pr.author.user.slug === user },
      });
    }

    try {
      const acts = await fetchPRActivities(cfg.base_url, headers, pr);
      for (const a of acts) {
        const ts = new Date(a.createdDate).toISOString();
        if (!rangeContains(range, ts)) continue;
        if (user && a.user.slug !== user && a.user.name !== user) continue;
        if (a.action === 'COMMENTED' && a.comment) {
          activities.push({
            source: 'bitbucket',
            type: 'pr-comment',
            timestamp: ts,
            title: `${repoFull} #${pr.id}: ${a.comment.text.slice(0, 140)}`,
            url,
            details: { repo: repoFull, prId: pr.id, prTitle: pr.title },
          });
        } else if (a.action === 'APPROVED' || a.action === 'UNAPPROVED' || a.action === 'REVIEWED') {
          activities.push({
            source: 'bitbucket',
            type: 'pr-review',
            timestamp: ts,
            title: `${repoFull} #${pr.id}: ${a.action.toLowerCase()} — ${pr.title}`,
            url,
            details: { repo: repoFull, prId: pr.id, action: a.action },
          });
        }
      }
    } catch (err) {
      ctx.warn(`bitbucket: activity fetch failed for ${repoFull} #${pr.id}`, err);
    }
  }

  activities.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const open = await fetchBitbucketOpen(cfg, headers, ctx);
  return { source: 'bitbucket', activities, open };
}

async function fetchBitbucketOpen(
  cfg: BitbucketConfig,
  headers: Record<string, string>,
  ctx: FetchContext,
): Promise<OpenItem[]> {
  const ignored = new Set(cfg.ignored_authors.map((a) => a.toLowerCase()));
  const out: OpenItem[] = [];
  for (const role of ['AUTHOR', 'REVIEWER'] as const) {
    try {
      const res = await request<BbDashboardResponse>(`${cfg.base_url}/rest/api/1.0/dashboard/pull-requests`, {
        headers,
        query: { state: 'OPEN', role, order: 'NEWEST', limit: 25 },
      });
      for (const pr of res.values) {
        const authorSlug = pr.author.user.slug?.toLowerCase();
        const authorName = pr.author.user.name?.toLowerCase();
        if ((authorSlug && ignored.has(authorSlug)) || (authorName && ignored.has(authorName))) continue;
        const repoFull = `${pr.toRef.repository.project.key}/${pr.toRef.repository.slug}`;
        out.push({
          source: 'bitbucket',
          type: role === 'AUTHOR' ? 'open-pr-mine' : 'open-pr-review',
          title: `${repoFull} #${pr.id}: ${pr.title}`,
          url: pr.links.self?.[0]?.href,
          status: role === 'AUTHOR' ? 'open' : 'awaits my review',
          updated: new Date(pr.updatedDate).toISOString(),
          details: { repo: repoFull, prId: pr.id, author: pr.author.user.slug },
        });
      }
    } catch (err) {
      ctx.warn(`bitbucket: open-pr fetch (${role}) failed`, err);
    }
  }
  return out;
}

function prKey(pr: BbPullRequest): string {
  return `${pr.toRef.repository.project.key}/${pr.toRef.repository.slug}#${pr.id}`;
}

async function fetchDashboardPRs(
  baseUrl: string,
  headers: Record<string, string>,
  role: 'AUTHOR' | 'REVIEWER',
  range: DateRange,
): Promise<BbPullRequest[]> {
  const states: Array<'OPEN' | 'MERGED' | 'DECLINED'> = ['OPEN', 'MERGED', 'DECLINED'];
  const allPrs = new Map<number, BbPullRequest>();
  const sinceMs = range.since.getTime();

  for (const state of states) {
    let start = 0;
    while (true) {
      const res = await request<BbDashboardResponse>(`${baseUrl}/rest/api/1.0/dashboard/pull-requests`, {
        headers,
        query: { state, role, order: 'NEWEST', start, limit: 50 },
      });
      for (const pr of res.values) {
        if (pr.updatedDate >= sinceMs) {
          allPrs.set(pr.id, pr);
        }
      }
      const oldest = res.values[res.values.length - 1];
      if (!oldest || oldest.updatedDate < sinceMs) break;
      if (res.isLastPage || res.nextPageStart === undefined) break;
      start = res.nextPageStart;
    }
  }
  return Array.from(allPrs.values());
}

async function fetchPRActivities(
  baseUrl: string,
  headers: Record<string, string>,
  pr: BbPullRequest,
): Promise<BbActivity[]> {
  const project = pr.toRef.repository.project.key;
  const repo = pr.toRef.repository.slug;
  const out: BbActivity[] = [];
  let start = 0;
  while (true) {
    const res = await request<BbActivityResponse>(
      `${baseUrl}/rest/api/1.0/projects/${project}/repos/${repo}/pull-requests/${pr.id}/activities`,
      { headers, query: { start, limit: 50 } },
    );
    out.push(...res.values);
    if (res.isLastPage || res.nextPageStart === undefined) break;
    start = res.nextPageStart;
  }
  return out;
}
