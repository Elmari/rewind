import { format } from 'date-fns';
import type { JiraConfig } from '../config.js';
import { atlassianAuthHeader, request } from '../http.js';
import { rangeContains } from '../range.js';
import type { Activity, DateRange, FetchContext, SourceResult } from '../types.js';

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
  const userClause = user ? `(assignee = "${user}" OR worklogAuthor = "${user}" OR updatedBy = "${user}")` : 'updatedBy = currentUser()';
  const jql = `${userClause} AND updated >= "${since}" AND updated <= "${until}" ORDER BY updated DESC`;

  ctx.log(`jira: searching with JQL: ${jql}`);
  const authHeader = atlassianAuthHeader(cfg.auth_method, pat, user);

  const search = await request<JiraSearchResponse>(`${cfg.base_url}/rest/api/2/search`, {
    headers: { ...authHeader, accept: 'application/json' },
    query: {
      jql,
      fields: 'summary,status,updated,project',
      expand: 'changelog',
      maxResults: 100,
    },
  });

  const activities: Activity[] = [];
  const browseBase = `${cfg.base_url}/browse`;

  for (const issue of search.issues) {
    activities.push({
      source: 'jira',
      type: 'issue-touched',
      timestamp: issue.fields.updated,
      title: `${issue.key}: ${issue.fields.summary}`,
      url: `${browseBase}/${issue.key}`,
      details: {
        status: issue.fields.status.name,
        project: issue.fields.project.key,
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
  return { source: 'jira', activities };
}

function matchesUser(author: { name?: string; key?: string; emailAddress?: string }, user?: string): boolean {
  if (!user) return true;
  return author.name === user || author.key === user || author.emailAddress === user;
}
