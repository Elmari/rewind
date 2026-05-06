import type { Config } from '../config.js';
import { readEnvSecret } from '../config.js';
import { readSourceCache, writeSourceCache } from '../cache.js';
import type { DateRange, FetchContext, SourceName, SourceResult } from '../types.js';
import { fetchBitbucket } from './bitbucket.js';
import { fetchConfluence } from './confluence.js';
import { fetchGit } from './git.js';
import { fetchGithub } from './github.js';
import { fetchGitlab } from './gitlab.js';
import { fetchJenkins } from './jenkins.js';
import { fetchJira } from './jira.js';
import { fetchOutlook } from './outlook.js';
import { fetchTeams } from './teams.js';
import { fetchTodoist } from './todoist.js';

export type SourceFetcher = (range: DateRange, cfg: Config, ctx: FetchContext) => Promise<SourceResult>;

export const SOURCES: Record<SourceName, SourceFetcher> = {
  jira: async (range, cfg, ctx) => {
    if (!cfg.sources.jira?.enabled) return skipped('jira');
    return fetchJira(
      range,
      cfg.sources.jira,
      readEnvSecret(cfg.sources.jira.pat_env),
      cfg.identity.jira_user ?? cfg.identity.atlassian_user,
      ctx,
    );
  },
  confluence: async (range, cfg, ctx) => {
    if (!cfg.sources.confluence?.enabled) return skipped('confluence');
    return fetchConfluence(
      range,
      cfg.sources.confluence,
      readEnvSecret(cfg.sources.confluence.pat_env),
      cfg.identity.confluence_user ?? cfg.identity.atlassian_user,
      ctx,
    );
  },
  bitbucket: async (range, cfg, ctx) => {
    if (!cfg.sources.bitbucket?.enabled) return skipped('bitbucket');
    return fetchBitbucket(
      range,
      cfg.sources.bitbucket,
      readEnvSecret(cfg.sources.bitbucket.pat_env),
      cfg.identity.bitbucket_user ?? cfg.identity.atlassian_user,
      ctx,
    );
  },
  gitlab: async (range, cfg, ctx) => {
    if (!cfg.sources.gitlab?.enabled) return skipped('gitlab');
    return fetchGitlab(range, cfg.sources.gitlab, readEnvSecret(cfg.sources.gitlab.pat_env), ctx);
  },
  github: async (range, cfg, ctx) => {
    if (!cfg.sources.github?.enabled) return skipped('github');
    return fetchGithub(range, cfg.sources.github, readEnvSecret(cfg.sources.github.pat_env), ctx);
  },
  git: async (range, cfg, ctx) => {
    if (!cfg.sources.git?.enabled) return skipped('git');
    return fetchGit(range, cfg.sources.git, cfg.identity.git_emails, ctx);
  },
  jenkins: async (range, cfg, ctx) => {
    if (!cfg.sources.jenkins?.enabled) return skipped('jenkins');
    return fetchJenkins(
      range,
      cfg.sources.jenkins,
      cfg.sources.jenkins.username,
      readEnvSecret(cfg.sources.jenkins.api_token_env),
      ctx,
    );
  },
  todoist: async (range, cfg, ctx) => {
    if (!cfg.sources.todoist?.enabled) return skipped('todoist');
    return fetchTodoist(range, cfg.sources.todoist, readEnvSecret(cfg.sources.todoist.api_token_env), ctx);
  },
  outlook: async (range, cfg, ctx) => {
    if (!cfg.sources.outlook?.enabled) return skipped('outlook');
    return fetchOutlook(range, cfg.sources.outlook, ctx);
  },
  teams: async (range, cfg, ctx) => {
    if (!cfg.sources.teams?.enabled) return skipped('teams');
    return fetchTeams(range, cfg.sources.teams, ctx);
  },
  llm: async () => skipped('llm'),
};

export const ALL_SOURCES: SourceName[] = [
  'jira',
  'confluence',
  'bitbucket',
  'gitlab',
  'github',
  'git',
  'jenkins',
  'todoist',
  'outlook',
  'teams',
];

function skipped(source: SourceName): SourceResult {
  return { source, activities: [] };
}

export async function runSources(
  range: DateRange,
  cfg: Config,
  selected: SourceName[],
  ctx: FetchContext,
  options?: { useCache?: boolean; saveCache?: boolean; cacheLabel?: string },
): Promise<SourceResult[]> {
  const { useCache = false, saveCache = false, cacheLabel } = options ?? {};
  const tasks = selected.map(async (name) => {
    if (useCache && cacheLabel) {
      const cached = readSourceCache(cacheLabel, name);
      if (cached) {
        ctx.log(`${name}: cache hit (${cached.activities.length} entries)`);
        return cached;
      }
    }
    try {
      const result = await SOURCES[name](range, cfg, ctx);
      if (saveCache && cacheLabel) writeSourceCache(cacheLabel, result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.warn(`${name}: ${msg}`);
      return { source: name, activities: [], error: msg } satisfies SourceResult;
    }
  });
  return Promise.all(tasks);
}
