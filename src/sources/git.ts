import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import type { GitConfig } from '../config.js';
import type { Activity, DateRange, FetchContext, SourceResult } from '../types.js';

export async function fetchGit(
  range: DateRange,
  cfg: GitConfig,
  identityEmails: string[],
  ctx: FetchContext,
): Promise<SourceResult> {
  const repos = findRepos(cfg.repos_dir, cfg.max_depth);
  ctx.log(`git: scanning ${repos.length} repos under ${cfg.repos_dir}`);

  const activities: Activity[] = [];
  for (const repo of repos) {
    try {
      const repoActivities = await fetchRepo(repo, range, identityEmails);
      activities.push(...repoActivities);
    } catch (err) {
      ctx.warn(`git: failed to read ${repo}`, err);
    }
  }

  activities.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { source: 'git', activities };
}

function findRepos(root: string, maxDepth: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes('.git')) {
      out.push(dir);
      return;
    }
    for (const e of entries) {
      if (e.startsWith('.')) continue;
      const p = join(dir, e);
      try {
        if (statSync(p).isDirectory()) walk(p, depth + 1);
      } catch {
        // unreadable, skip
      }
    }
  };
  if (existsSync(root)) walk(root, 0);
  return out;
}

async function fetchRepo(repoPath: string, range: DateRange, emails: string[]): Promise<Activity[]> {
  const git = simpleGit(repoPath);
  const since = range.since.toISOString();
  const until = range.until.toISOString();

  const args = ['log', `--since=${since}`, `--until=${until}`, '--all', '--pretty=format:%H%x1f%aI%x1f%ae%x1f%s'];
  const raw = await git.raw(args);
  if (!raw.trim()) return [];

  const repoName = repoPath.split(/[\\/]/).pop() ?? repoPath;
  const ahead = await unpushedCommits(git);

  const activities: Activity[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const [hash, isoDate, email, subject] = line.split('\x1f');
    if (emails.length > 0 && !emails.includes(email)) continue;
    activities.push({
      source: 'git',
      type: 'commit',
      timestamp: isoDate,
      title: subject,
      details: {
        repo: repoName,
        hash: hash.slice(0, 8),
        email,
        unpushed: ahead.has(hash),
      },
    });
  }
  return activities;
}

async function unpushedCommits(git: ReturnType<typeof simpleGit>): Promise<Set<string>> {
  try {
    const out = await git.raw(['log', '--branches', '--not', '--remotes', '--pretty=format:%H']);
    return new Set(
      out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}
