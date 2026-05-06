import type { JenkinsConfig } from '../config.js';
import { basic, request } from '../http.js';
import { rangeContains } from '../range.js';
import type { Activity, DateRange, FetchContext, SourceResult } from '../types.js';

interface JenkinsJob {
  name: string;
  url: string;
  builds: JenkinsBuild[];
}

interface JenkinsBuild {
  number: number;
  url: string;
  timestamp: number;
  duration: number;
  result: string | null;
  actions?: Array<{
    causes?: Array<{
      _class?: string;
      userId?: string;
      userName?: string;
      shortDescription?: string;
    }>;
  }>;
}

export async function fetchJenkins(
  range: DateRange,
  cfg: JenkinsConfig,
  username: string,
  apiToken: string,
  ctx: FetchContext,
): Promise<SourceResult> {
  if (cfg.jobs.length === 0) {
    ctx.warn('jenkins: no jobs configured — set sources.jenkins.jobs to a list of paths to monitor');
    return { source: 'jenkins', activities: [] };
  }

  const headers = { ...basic(username, apiToken), accept: 'application/json' };
  const activities: Activity[] = [];
  const userIds = new Set([username, ...cfg.alt_user_ids].map((u) => u.toLowerCase()));
  const scmEmails = cfg.scm_emails.map((e) => e.toLowerCase());

  for (const path of cfg.jobs) {
    try {
      const jobUrl = jobApiUrl(cfg.base_url, path);
      const job = await request<JenkinsJob>(jobUrl, {
        headers,
        query: {
          tree: 'name,url,builds[number,url,timestamp,duration,result,actions[causes[userId,userName,shortDescription]]]',
          depth: 2,
        },
      });

      for (const build of job.builds) {
        const ts = new Date(build.timestamp).toISOString();
        if (!rangeContains(range, ts)) continue;

        const causes = (build.actions ?? []).flatMap((a) => a.causes ?? []);
        const triggeredByUser = causes.some(
          (c) => (c.userId && userIds.has(c.userId.toLowerCase())) || (c.userName && userIds.has(c.userName.toLowerCase())),
        );
        const triggeredByScm = causes.some((c) => {
          const desc = c.shortDescription?.toLowerCase() ?? '';
          return scmEmails.some((email) => desc.includes(email));
        });

        if (!triggeredByUser && !triggeredByScm) continue;

        activities.push({
          source: 'jenkins',
          type: 'build',
          timestamp: ts,
          title: `${path} #${build.number}: ${build.result ?? 'RUNNING'}`,
          url: build.url,
          details: {
            job: path,
            buildNumber: build.number,
            result: build.result,
            durationMs: build.duration,
            triggeredBy: triggeredByUser ? 'user' : 'scm',
          },
        });
      }
    } catch (err) {
      ctx.warn(`jenkins: job fetch failed for ${path}`, err);
    }
  }

  activities.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { source: 'jenkins', activities };
}

function jobApiUrl(baseUrl: string, path: string): string {
  const segments = path.split('/').filter(Boolean).map((s) => `job/${encodeURIComponent(s)}`);
  return `${baseUrl.replace(/\/$/, '')}/${segments.join('/')}/api/json`;
}
