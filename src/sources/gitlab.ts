import { format } from 'date-fns';
import type { GitlabConfig } from '../config.js';
import { bearer, request } from '../http.js';
import { rangeContains } from '../range.js';
import type { Activity, DateRange, FetchContext, SourceResult } from '../types.js';

interface GlUser {
  id: number;
  username: string;
  name: string;
}

interface GlEvent {
  id: number;
  action_name: string;
  target_type: string | null;
  target_title: string | null;
  target_iid: number | null;
  created_at: string;
  author_id: number;
  project_id: number;
  push_data?: { commit_count: number; ref: string; commit_title?: string };
  note?: { body?: string; noteable_type?: string };
}

interface GlProject {
  id: number;
  path_with_namespace: string;
  web_url: string;
}

interface GlMergeRequest {
  iid: number;
  project_id: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  web_url: string;
  author: { id: number; username: string };
}

export async function fetchGitlab(
  range: DateRange,
  cfg: GitlabConfig,
  pat: string,
  ctx: FetchContext,
): Promise<SourceResult> {
  const headers = { ...bearer(pat), accept: 'application/json' };

  const me = await request<GlUser>(`${cfg.base_url}/api/v4/user`, { headers });
  ctx.log(`gitlab: identified as ${me.username} (id=${me.id})`);

  const after = format(new Date(range.since.getTime() - 1), 'yyyy-MM-dd');
  const before = format(new Date(range.until.getTime() + 24 * 3600 * 1000), 'yyyy-MM-dd');

  const events = await fetchAllPages<GlEvent>(`${cfg.base_url}/api/v4/users/${me.id}/events`, headers, {
    after,
    before,
    per_page: 100,
  });
  ctx.log(`gitlab: ${events.length} events in window, filtering to range`);

  const projectCache = new Map<number, GlProject>();
  const projectFor = async (id: number): Promise<GlProject | null> => {
    if (projectCache.has(id)) return projectCache.get(id)!;
    try {
      const p = await request<GlProject>(`${cfg.base_url}/api/v4/projects/${id}`, { headers });
      projectCache.set(id, p);
      return p;
    } catch {
      return null;
    }
  };

  const activities: Activity[] = [];

  for (const ev of events) {
    if (!rangeContains(range, ev.created_at)) continue;
    const proj = await projectFor(ev.project_id);
    const repo = proj?.path_with_namespace ?? `project#${ev.project_id}`;
    const projectUrl = proj?.web_url;

    const a = mapEvent(ev, repo, projectUrl);
    if (a) activities.push(a);
  }

  // own MRs touched in range — catches merges/closes that don't always show as events
  try {
    const mrs = await fetchAllPages<GlMergeRequest>(`${cfg.base_url}/api/v4/merge_requests`, headers, {
      author_id: me.id,
      updated_after: range.since.toISOString(),
      updated_before: range.until.toISOString(),
      scope: 'all',
      per_page: 50,
    });
    for (const mr of mrs) {
      if (mr.merged_at && rangeContains(range, mr.merged_at)) {
        activities.push({
          source: 'gitlab',
          type: 'mr-merged',
          timestamp: mr.merged_at,
          title: `!${mr.iid}: ${mr.title}`,
          url: mr.web_url,
          details: { mrIid: mr.iid, project: mr.project_id },
        });
      } else if (mr.created_at && rangeContains(range, mr.created_at)) {
        activities.push({
          source: 'gitlab',
          type: 'mr-opened',
          timestamp: mr.created_at,
          title: `!${mr.iid}: ${mr.title}`,
          url: mr.web_url,
          details: { mrIid: mr.iid, project: mr.project_id, state: mr.state },
        });
      }
    }
  } catch (err) {
    ctx.warn('gitlab: own MR fetch failed', err);
  }

  // dedupe (events + MR-list can both produce mr-opened/mr-merged for same MR)
  const dedup = new Map<string, Activity>();
  for (const a of activities) {
    const k = `${a.type}|${a.url ?? a.title}|${a.timestamp.slice(0, 10)}`;
    if (!dedup.has(k)) dedup.set(k, a);
  }

  const out = [...dedup.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { source: 'gitlab', activities: out };
}

function mapEvent(ev: GlEvent, repo: string, projectUrl?: string): Activity | null {
  const ts = ev.created_at;
  const baseUrl = projectUrl;

  switch (ev.action_name) {
    case 'pushed to':
    case 'pushed new': {
      const ref = ev.push_data?.ref;
      const count = ev.push_data?.commit_count ?? 0;
      const title = ev.push_data?.commit_title ?? '(no commit title)';
      return {
        source: 'gitlab',
        type: 'push',
        timestamp: ts,
        title: `${repo}${ref ? ` [${ref}]` : ''}: ${count} commit(s) — ${title}`,
        url: baseUrl,
        details: { repo, ref, commits: count },
      };
    }
    case 'opened':
      if (ev.target_type === 'MergeRequest') {
        return {
          source: 'gitlab',
          type: 'mr-opened',
          timestamp: ts,
          title: `${repo} !${ev.target_iid}: ${ev.target_title ?? ''}`,
          url: baseUrl ? `${baseUrl}/-/merge_requests/${ev.target_iid}` : undefined,
          details: { repo, mrIid: ev.target_iid },
        };
      }
      if (ev.target_type === 'Issue') {
        return {
          source: 'gitlab',
          type: 'issue-opened',
          timestamp: ts,
          title: `${repo} #${ev.target_iid}: ${ev.target_title ?? ''}`,
          url: baseUrl ? `${baseUrl}/-/issues/${ev.target_iid}` : undefined,
          details: { repo, issueIid: ev.target_iid },
        };
      }
      return null;
    case 'merged':
      return {
        source: 'gitlab',
        type: 'mr-merged',
        timestamp: ts,
        title: `${repo} !${ev.target_iid}: ${ev.target_title ?? ''}`,
        url: baseUrl ? `${baseUrl}/-/merge_requests/${ev.target_iid}` : undefined,
        details: { repo, mrIid: ev.target_iid },
      };
    case 'approved':
      return {
        source: 'gitlab',
        type: 'mr-review',
        timestamp: ts,
        title: `${repo} !${ev.target_iid}: approved — ${ev.target_title ?? ''}`,
        url: baseUrl ? `${baseUrl}/-/merge_requests/${ev.target_iid}` : undefined,
        details: { repo, mrIid: ev.target_iid, action: 'approved' },
      };
    case 'commented on': {
      const noteableType = ev.note?.noteable_type;
      const body = ev.note?.body?.slice(0, 140) ?? '(empty)';
      const isMr = noteableType === 'MergeRequest';
      return {
        source: 'gitlab',
        type: isMr ? 'mr-comment' : 'comment',
        timestamp: ts,
        title: `${repo}${ev.target_iid ? (isMr ? ` !${ev.target_iid}` : ` #${ev.target_iid}`) : ''}: ${body}`,
        url: baseUrl,
        details: { repo, target: noteableType, iid: ev.target_iid },
      };
    }
    default:
      return null;
  }
}

async function fetchAllPages<T>(
  url: string,
  headers: Record<string, string>,
  query: Record<string, string | number | boolean | undefined>,
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  while (true) {
    const res = await request<T[]>(url, { headers, query: { ...query, page } });
    if (!Array.isArray(res) || res.length === 0) break;
    out.push(...res);
    if (res.length < (Number(query.per_page) || 20)) break;
    page += 1;
    if (page > 20) break; // safety brake
  }
  return out;
}
