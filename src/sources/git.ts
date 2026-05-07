import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import type { GitConfig } from '../config.js';
import { expandHome } from '../path.js';
import type { Activity, DateRange, FetchContext, SourceResult } from '../types.js';

export async function fetchGit(
  range: DateRange,
  cfg: GitConfig,
  identityEmails: string[],
  ctx: FetchContext,
): Promise<SourceResult> {
  const reposDir = expandHome(cfg.repos_dir);
  const repos = findRepos(reposDir, cfg.max_depth);
  ctx.log(`git: scanning ${repos.length} repos under ${reposDir} (email filter: ${identityEmails.length ? identityEmails.join(',') : '(none — all authors)'})`);

  const activities: Activity[] = [];
  let totalRawCommits = 0;
  const seenEmails = new Set<string>();
  for (const repo of repos) {
    try {
      const { matched, raw, emails } = await fetchRepo(repo, range, identityEmails);
      activities.push(...matched);
      totalRawCommits += raw;
      emails.forEach((e) => seenEmails.add(e));
    } catch (err) {
      ctx.warn(`git: failed to read ${repo}`, err);
    }
  }

  if (identityEmails.length && totalRawCommits > 0 && activities.length === 0) {
    ctx.warn(
      `git: ${totalRawCommits} commits in range but 0 matched git_emails ${JSON.stringify(identityEmails)}; emails seen: ${JSON.stringify([...seenEmails])}`,
    );
  } else {
    ctx.log(`git: ${activities.length}/${totalRawCommits} commits matched (emails seen: ${[...seenEmails].join(',') || '—'})`);
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

async function fetchRepo(
  repoPath: string,
  range: DateRange,
  emails: string[],
): Promise<{ matched: Activity[]; raw: number; emails: Set<string> }> {
  const git = simpleGit(repoPath);
  const since = range.since.toISOString();
  const until = range.until.toISOString();

  const args = ['log', `--since=${since}`, `--until=${until}`, '--all', '--pretty=format:%H%x1f%aI%x1f%ae%x1f%s'];
  const raw = await git.raw(args);
  if (!raw.trim()) return { matched: [], raw: 0, emails: new Set() };

  const repoName = repoPath.split(/[\\/]/).pop() ?? repoPath;
  const ahead = await unpushedCommits(git);

  const matched: Activity[] = [];
  const seenEmails = new Set<string>();
  let rawCount = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const [hash, isoDate, email, subject] = line.split('\x1f');
    rawCount++;
    seenEmails.add(email);
    if (emails.length > 0 && !emails.includes(email)) continue;
    matched.push({
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
  return { matched, raw: rawCount, emails: seenEmails };
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
