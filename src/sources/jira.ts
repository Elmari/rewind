import { format } from 'date-fns';
import type { JiraConfig } from '../config.js';
import { atlassianAuthHeader, request } from '../http.js';
import { rangeContains } from '../range.js';
import type { Activity, DateRange, FetchContext, OpenItem, SourceResult } from '../types.js';

interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
  startAt: number;
  maxResults: number;
}

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    updated: string;
    project: { key: string; name: string };
    resolution?: { name: string };
  };
  changelog?: {
    histories: Array<{
      author: { name?: string; key?: string; emailAddress?: string; displayName?: string };
      created: string;
      items: Array<{ field: string; fromString?: string; toString?: string }>;
    }>;
  };
}

interface JiraWorklogResponse {
  worklogs: Array<{
    author: { name?: string; key?: string; emailAddress?: string };
    started: string;
    timeSpent: string;
    timeSpentSeconds: number;
    comment?: string;
  }>;
}

export async function fetchJira(
  range: DateRange,
  cfg: JiraConfig,
  pat: string,
  user: string | undefined,
  ctx: FetchContext,
): Promise<SourceResult> {
  const since = format(range.since, 'yyyy-MM-dd HH:mm');
  const until = format(range.until, 'yyyy-MM-dd HH:mm');
  const userClause = user
    ? `(assignee = "${user}" OR reporter = "${user}" OR creator = "${user}")`
    : '(assignee = currentUser() OR reporter = currentUser() OR creator = currentUser())';
  const jql = `${userClause} AND ((updated >= "${since}" AND updated <= "${until}") OR (created >= "${since}" AND created <= "${until}")) ORDER BY updated DESC`;

  ctx.log(`jira: searching with JQL: ${jql}`);
  const authHeader = atlassianAuthHeader(cfg.auth_method, pat, user);

  const search = await request<JiraSearchResponse>(`${cfg.base_url}/rest/api/2/search`, {
    headers: { ...authHeader, accept: 'application/json' },
    query: {
      jql,
      fields: 'summary,status,updated,project,resolution',
      expand: 'changelog',
      maxResults: 100,
    },
  });

  const activities: Activity[] = [];
  const browseBase = `${cfg.base_url}/browse`;

  for (const issue of search.issues) {
    const rawRes = issue.fields.resolution;
    const resolution = typeof rawRes === 'string' ? rawRes : rawRes?.name;
    const resLabel = resolution ? ` [${resolution}]` : '';

    if (!resolution && issue.fields.status.name.toLowerCase() === 'done') {
      ctx.log(`jira: issue ${issue.key} is 'Done' but has no resolution field in API response`);
    }

    activities.push({
      source: 'jira',
      type: 'issue-touched',
      timestamp: issue.fields.updated,
      title: `${issue.key}: ${issue.fields.summary}${resLabel}`,
      url: `${browseBase}/${issue.key}`,
      details: {
        issue: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        project: issue.fields.project.key,
        ...(resolution ? { resolution } : {}),
      },
    });

    for (const history of issue.changelog?.histories ?? []) {
      if (!rangeContains(range, history.created)) continue;
      if (!matchesUser(history.author, user)) continue;

      const statusItem = history.items.find((i) => i.field.toLowerCase() === 'status');
      const resolutionItem = history.items.find((i) => i.field.toLowerCase() === 'resolution');

      if (statusItem) {
        // If resolution changed in the same history entry, use it; otherwise fallback to current resolution
        const res = resolutionItem?.toString || resolution;
        const resSuffix = res ? ` [${res}]` : '';
        activities.push({
          source: 'jira',
          type: 'status-transition',
          timestamp: history.created,
          title: `${issue.key} — ${issue.fields.summary}: ${statusItem.fromString} → ${statusItem.toString}${resSuffix}`,
          url: `${browseBase}/${issue.key}`,
          details: { issue: issue.key, summary: issue.fields.summary, from: statusItem.fromString, to: statusItem.toString, resolution: res },
        });
      } else if (resolutionItem) {
        activities.push({
          source: 'jira',
          type: 'status-transition',
          timestamp: history.created,
          title: `${issue.key} — ${issue.fields.summary}: Lösungsweg -> ${resolutionItem.toString || 'Keiner'}`,
          url: `${browseBase}/${issue.key}`,
          details: { issue: issue.key, summary: issue.fields.summary, resolution: resolutionItem.toString },
        });
      }
    }

    try {
      const worklogs = await request<JiraWorklogResponse>(
        `${cfg.base_url}/rest/api/2/issue/${issue.key}/worklog`,
        { headers: { ...authHeader, accept: 'application/json' } },
      );
      for (const wl of worklogs.worklogs) {
        if (!rangeContains(range, wl.started)) continue;
        if (!matchesUser(wl.author, user)) continue;
        activities.push({
          source: 'jira',
          type: 'worklog',
          timestamp: wl.started,
          title: `${issue.key} — ${issue.fields.summary}: ${wl.timeSpent}${wl.comment ? ` — ${wl.comment.slice(0, 120)}` : ''}`,
          url: `${browseBase}/${issue.key}`,
          details: { issue: issue.key, summary: issue.fields.summary, seconds: wl.timeSpentSeconds },
        });
      }
    } catch (err) {
      ctx.warn(`jira: worklog fetch failed for ${issue.key}`, err);
    }
  }

  activities.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const open = await fetchJiraOpen(cfg, authHeader, user, ctx);

  let suggestions: OpenItem[] = [];
  if (cfg.in_progress_jql && cfg.suggestions_jql) {
    const inProgressCount = await fetchJiraCount(cfg, cfg.in_progress_jql, authHeader, ctx);
    if (inProgressCount === 0) {
      ctx.log('jira: nothing in progress, fetching suggestions');
      suggestions = await fetchJiraSuggestions(cfg, authHeader, ctx);
    }
  }

  return { source: 'jira', activities, open, suggestions };
}

async function fetchJiraCount(
  cfg: JiraConfig,
  jql: string,
  authHeader: Record<string, string>,
  ctx: FetchContext,
): Promise<number> {
  try {
    const search = await request<JiraSearchResponse>(`${cfg.base_url}/rest/api/2/search`, {
      headers: { ...authHeader, accept: 'application/json' },
      query: { jql, fields: 'summary', maxResults: 0 },
    });
    return search.total;
  } catch (err) {
    ctx.warn('jira: in-progress count fetch failed', err);
    return 1; // fail-safe: assume something is in progress, skip suggestions
  }
}

async function fetchJiraSuggestions(
  cfg: JiraConfig,
  authHeader: Record<string, string>,
  ctx: FetchContext,
): Promise<OpenItem[]> {
  if (!cfg.suggestions_jql) return [];
  try {
    const search = await request<JiraSearchResponse>(`${cfg.base_url}/rest/api/2/search`, {
      headers: { ...authHeader, accept: 'application/json' },
      query: { jql: cfg.suggestions_jql, fields: 'summary,status,updated,project', maxResults: 10 },
    });
    return search.issues.map((issue) => ({
      source: 'jira' as const,
      type: 'suggested-issue',
      title: `${issue.key}: ${issue.fields.summary}`,
      url: `${cfg.base_url}/browse/${issue.key}`,
      status: issue.fields.status.name,
      updated: issue.fields.updated,
      details: { project: issue.fields.project.key, key: issue.key },
    }));
  } catch (err) {
    ctx.warn('jira: suggestions fetch failed', err);
    return [];
  }
}

async function fetchJiraOpen(
  cfg: JiraConfig,
  authHeader: Record<string, string>,
  user: string | undefined,
  ctx: FetchContext,
): Promise<OpenItem[]> {
  const userClause = user ? `assignee = "${user}"` : 'assignee = currentUser()';
  const jql = `${userClause} AND statusCategory != Done ORDER BY updated DESC`;
  try {
    const search = await request<JiraSearchResponse>(`${cfg.base_url}/rest/api/2/search`, {
      headers: { ...authHeader, accept: 'application/json' },
      query: { jql, fields: 'summary,status,updated,project,resolution', maxResults: 30 },
    });
    return search.issues.map((issue) => {
      const resolution = issue.fields.resolution?.name;
      return {
        source: 'jira' as const,
        type: 'open-issue',
        title: `${issue.key}: ${issue.fields.summary}`,
        url: `${cfg.base_url}/browse/${issue.key}`,
        status: resolution ? `${issue.fields.status.name} (${resolution})` : issue.fields.status.name,
        updated: issue.fields.updated,
        details: { project: issue.fields.project.key, key: issue.key },
      };
    });
  } catch (err) {
    ctx.warn('jira: open-issue fetch failed', err);
    return [];
  }
}

function matchesUser(author: { name?: string; key?: string; emailAddress?: string }, user?: string): boolean {
  if (!user) return true;
  return author.name === user || author.key === user || author.emailAddress === user;
}
