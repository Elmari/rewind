import type { JenkinsConfig } from '../config.js';
import { basic, request } from '../http.js';
import { rangeContains } from '../range.js';
import type { Activity, DateRange, FetchContext, SourceResult } from '../types.js';

interface JenkinsContainer {
  _class?: string;
  name: string;
  url: string;
  jobs?: JenkinsJobRef[];
}

interface JenkinsJobRef {
  _class?: string;
  name: string;
  url: string;
}

interface JenkinsJobWithBuilds {
  _class?: string;
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

const BUILDS_TREE =
  'name,_class,url,builds[number,url,timestamp,duration,result,actions[causes[userId,userName,shortDescription]]]';

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
      const leaves = await resolveLeafJobs(cfg.base_url, headers, path, ctx);
      for (const leaf of leaves) {
        const job = await request<JenkinsJobWithBuilds>(`${leaf.url.replace(/\/$/, '')}/api/json`, {
          headers,
          query: { tree: BUILDS_TREE, depth: 2 },
        });

        for (const build of job.builds ?? []) {
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

          const branchLabel = leaf.branch ?? leaf.name;
          activities.push({
            source: 'jenkins',
            type: 'build',
            timestamp: ts,
            title: `${path}/${branchLabel} #${build.number}: ${build.result ?? 'RUNNING'}`,
            url: build.url,
            details: {
              job: path,
              branch: branchLabel,
              buildNumber: build.number,
              result: build.result,
              durationMs: build.duration,
              triggeredBy: triggeredByUser ? 'user' : 'scm',
            },
          });
        }
      }
    } catch (err) {
      ctx.warn(`jenkins: job fetch failed for ${path}`, err);
    }
  }

  activities.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { source: 'jenkins', activities };
}

interface LeafJob {
  url: string;
  name: string;
  branch?: string;
}

async function resolveLeafJobs(
  baseUrl: string,
  headers: Record<string, string>,
  path: string,
  ctx: FetchContext,
): Promise<LeafJob[]> {
  const containerUrl = jobApiUrl(baseUrl, path);
  const container = await request<JenkinsContainer>(containerUrl, {
    headers,
    query: { tree: 'name,_class,url,jobs[name,_class,url]' },
  });

  if (!isContainer(container._class) || !container.jobs?.length) {
    return [{ url: container.url, name: container.name }];
  }

  const branches = container.jobs.filter((child) => {
    const name = decodeBranchName(child.name);
    if (name.toLowerCase().startsWith('renovate')) return false;
    return true;
  });
  ctx.log(
    `jenkins: ${path} is a container (${container._class ?? 'unknown'}); ${branches.length}/${container.jobs.length} branches after filter`,
  );
  return branches.map((child) => ({
    url: child.url,
    name: child.name,
    branch: decodeBranchName(child.name),
  }));
}

function isContainer(cls?: string): boolean {
  if (!cls) return false;
  return cls.includes('MultiBranch') || cls.includes('Folder');
}

function decodeBranchName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function jobApiUrl(baseUrl: string, path: string): string {
  const segments = path.split('/').filter(Boolean).map((s) => `job/${encodeURIComponent(s)}`);
  return `${baseUrl.replace(/\/$/, '')}/${segments.join('/')}/api/json`;
}
