import { format } from 'date-fns';
import type { ConfluenceConfig } from '../config.js';
import { atlassianAuthHeader, request } from '../http.js';
import type { Activity, DateRange, FetchContext, SourceResult } from '../types.js';

interface ConfluenceSearchResponse {
  results: Array<{
    content: {
      id: string;
      type: 'page' | 'blogpost' | 'comment';
      title: string;
      space: { key: string; name: string };
      history: {
        createdDate: string;
        createdBy: { username?: string; userKey?: string; email?: string };
      };
      version: { when: string; by: { username?: string; userKey?: string; email?: string }; number: number };
      _links: { webui?: string };
    };
    lastModified?: string;
  }>;
  _links: { base?: string; context?: string };
}

export async function fetchConfluence(
  range: DateRange,
  cfg: ConfluenceConfig,
  pat: string,
  user: string | undefined,
  ctx: FetchContext,
): Promise<SourceResult> {
  const since = format(range.since, 'yyyy-MM-dd');
  const until = format(range.until, 'yyyy-MM-dd');

  const userClause = user
    ? `contributor = "${user}"`
    : 'contributor = currentUser()';
  const spaceClause = cfg.spaces.length ? ` AND space in (${cfg.spaces.map((s) => `"${s}"`).join(',')})` : '';
  const cql = `${userClause} AND lastModified >= "${since}" AND lastModified <= "${until}"${spaceClause} AND type in (page, blogpost, comment)`;

  ctx.log(`confluence: CQL: ${cql}`);

  const res = await request<ConfluenceSearchResponse>(`${cfg.base_url}/rest/api/content/search`, {
    headers: { ...atlassianAuthHeader(cfg.auth_method, pat, user), accept: 'application/json' },
    query: {
      cql,
      expand: 'version,history,space',
      limit: 100,
    },
  });

  const baseUrl = (res._links?.base ?? cfg.base_url).replace(/\/$/, '');
  const activities: Activity[] = [];

  for (const r of res.results) {
    const c = r.content;
    if (!c) {
      ctx.warn(`confluence: search result missing 'content' property: ${JSON.stringify(r).slice(0, 200)}`);
      continue;
    }
    if (!c.version) {
      ctx.warn(`confluence: content ${c.id} missing 'version' property`);
      continue;
    }

    const isCreated = c.version.number === 1;
    const url = c._links?.webui ? `${baseUrl}${c._links.webui}` : undefined;
    activities.push({
      source: 'confluence',
      type: c.type === 'comment' ? 'comment' : isCreated ? 'page-created' : 'page-updated',
      timestamp: c.version.when,
      title: c.title,
      url,
      details: {
        space: c.space.key,
        contentType: c.type,
        version: c.version.number,
      },
    });
  }

  activities.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { source: 'confluence', activities };
}
