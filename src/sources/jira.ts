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
    ? `(assignee = "${user}" OR reporter = "${user}")`
    : '(assignee = currentUser() OR reporter = currentUser())';
  const jql = `${userClause} AND updated >= "${since}" AND updated <= "${until}" ORDER BY updated DESC`;

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
    const resolution = issue.fields.resolution?.name;
    activities.push({
      source: 'jira',
      type: 'issue-touched',
      timestamp: issue.fields.updated,
      title: `${issue.key}: ${issue.fields.summary}`,
      url: `${browseBase}/${issue.key}`,
      details: {
        status: issue.fields.status.name,
        project: issue.fields.project.key,
        ...(resolution ? { resolution } : {}),
      },
    });

    for (const history of issue.changelog?.histories ?? []) {
      if (!rangeContains(range, history.created)) continue;
      if (!matchesUser(history.author, user)) continue;
      for (const item of history.items) {
        if (item.field !== 'status') continue;
        activities.push({
          source: 'jira',
          type: 'status-transition',
          timestamp: history.created,
          title: `${issue.key}: ${item.fromString} → ${item.toString}`,
          url: `${browseBase}/${issue.key}`,
          details: { issue: issue.key, from: item.fromString, to: item.toString },
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
          title: `${issue.key}: ${wl.timeSpent}${wl.comment ? ` — ${wl.comment.slice(0, 120)}` : ''}`,
          url: `${browseBase}/${issue.key}`,
          details: { issue: issue.key, seconds: wl.timeSpentSeconds },
        });
      }
    } catch (err) {
      ctx.warn(`jira: worklog fetch failed for ${issue.key}`, err);
    }
  }

  activities.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const open = await fetchJiraOpen(cfg, authHeader, user, ctx);
  return { source: 'jira', activities, open };
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
