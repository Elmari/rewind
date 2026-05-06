import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { atlassianAuthHeader, basic, request } from './http.js';
import { acquireGraphToken } from './auth/msal.js';
import { resolveCustomHeaders } from './llm/gemini.js';
import { expandHome } from './path.js';
import type { SourceName } from './types.js';
import { SOURCE_EMOJI, banner, c, footer, isTty } from './ui.js';

export interface DoctorResult {
  source: SourceName;
  status: 'ok' | 'fail' | 'disabled' | 'skipped';
  message: string;
  identity?: string;
}

export async function runDoctor(cfg: Config): Promise<DoctorResult[]> {
  return Promise.all([
    pingJira(cfg),
    pingConfluence(cfg),
    pingBitbucket(cfg),
    pingGitlab(cfg),
    pingGithub(cfg),
    pingGit(cfg),
    pingJenkins(cfg),
    pingTodoist(cfg),
    pingOutlook(cfg),
    pingTeams(cfg),
    pingLlm(cfg),
  ]);
}

async function safe(source: SourceName, fn: () => Promise<DoctorResult>): Promise<DoctorResult> {
  try {
    return await fn();
  } catch (err) {
    return { source, status: 'fail', message: err instanceof Error ? err.message : String(err) };
  }
}

function envValue(name: string): string | null {
  const v = process.env[name];
  return v && v.length > 0 ? v : null;
}

async function pingJira(cfg: Config): Promise<DoctorResult> {
  const c = cfg.sources.jira;
  if (!c?.enabled) return { source: 'jira', status: 'disabled', message: 'disabled in config' };
  const pat = envValue(c.pat_env);
  if (!pat) return { source: 'jira', status: 'fail', message: `missing env ${c.pat_env}` };
  const user = cfg.identity.jira_user ?? cfg.identity.atlassian_user;
  return safe('jira', async () => {
    const me = await request<{ name?: string; key?: string; displayName?: string; emailAddress?: string }>(
      `${c.base_url}/rest/api/2/myself`,
      { headers: { ...atlassianAuthHeader(c.auth_method, pat, user), accept: 'application/json' } },
    );
    return {
      source: 'jira',
      status: 'ok',
      message: `auth ${c.auth_method}`,
      identity: me.name ?? me.key ?? me.displayName ?? '?',
    };
  });
}

async function pingConfluence(cfg: Config): Promise<DoctorResult> {
  const c = cfg.sources.confluence;
  if (!c?.enabled) return { source: 'confluence', status: 'disabled', message: 'disabled in config' };
  const pat = envValue(c.pat_env);
  if (!pat) return { source: 'confluence', status: 'fail', message: `missing env ${c.pat_env}` };
  const user = cfg.identity.confluence_user ?? cfg.identity.atlassian_user;
  return safe('confluence', async () => {
    const me = await request<{ username?: string; userKey?: string; displayName?: string }>(
      `${c.base_url}/rest/api/user/current`,
      { headers: { ...atlassianAuthHeader(c.auth_method, pat, user), accept: 'application/json' } },
    );
    return {
      source: 'confluence',
      status: 'ok',
      message: `auth ${c.auth_method}`,
      identity: me.username ?? me.userKey ?? me.displayName ?? '?',
    };
  });
}

async function pingBitbucket(cfg: Config): Promise<DoctorResult> {
  const c = cfg.sources.bitbucket;
  if (!c?.enabled) return { source: 'bitbucket', status: 'disabled', message: 'disabled in config' };
  const pat = envValue(c.pat_env);
  if (!pat) return { source: 'bitbucket', status: 'fail', message: `missing env ${c.pat_env}` };
  const user = cfg.identity.bitbucket_user ?? cfg.identity.atlassian_user;
  return safe('bitbucket', async () => {
    const me = await request<{ name?: string; slug?: string; displayName?: string }>(
      `${c.base_url}/rest/api/1.0/application-properties`,
      { headers: { ...atlassianAuthHeader(c.auth_method, pat, user), accept: 'application/json' } },
    );
    // application-properties does not return user; do a 1-result dashboard call instead
    const dash = await request<{ size: number }>(
      `${c.base_url}/rest/api/1.0/dashboard/pull-requests`,
      {
        headers: { ...atlassianAuthHeader(c.auth_method, pat, user), accept: 'application/json' },
        query: { limit: 1, state: 'OPEN', role: 'AUTHOR' },
      },
    );
    return {
      source: 'bitbucket',
      status: 'ok',
      message: `auth ${c.auth_method} (${dash.size} open authored PRs visible)`,
      identity: user ?? '(no user configured)',
    };
  });
}

async function pingGitlab(cfg: Config): Promise<DoctorResult> {
  const c = cfg.sources.gitlab;
  if (!c?.enabled) return { source: 'gitlab', status: 'disabled', message: 'disabled in config' };
  const pat = envValue(c.pat_env);
  if (!pat) return { source: 'gitlab', status: 'fail', message: `missing env ${c.pat_env}` };
  return safe('gitlab', async () => {
    const me = await request<{ username: string; id: number }>(`${c.base_url}/api/v4/user`, {
      headers: { authorization: `Bearer ${pat}`, accept: 'application/json' },
    });
    return { source: 'gitlab', status: 'ok', message: `id=${me.id}`, identity: me.username };
  });
}

async function pingGithub(cfg: Config): Promise<DoctorResult> {
  const c = cfg.sources.github;
  if (!c?.enabled) return { source: 'github', status: 'disabled', message: 'disabled in config' };
  const pat = envValue(c.pat_env);
  if (!pat) return { source: 'github', status: 'fail', message: `missing env ${c.pat_env}` };
  return safe('github', async () => {
    const me = await request<{ login: string }>(`${c.base_url}/user`, {
      headers: { authorization: `Bearer ${pat}`, accept: 'application/vnd.github+json' },
    });
    const reposNote = c.repos.length ? `, repo whitelist: ${c.repos.length}` : '';
    return { source: 'github', status: 'ok', message: `token valid${reposNote}`, identity: me.login };
  });
}

async function pingGit(cfg: Config): Promise<DoctorResult> {
  const c = cfg.sources.git;
  if (!c?.enabled) return { source: 'git', status: 'disabled', message: 'disabled in config' };
  const reposDir = expandHome(c.repos_dir);
  if (!existsSync(reposDir)) {
    return { source: 'git', status: 'fail', message: `repos_dir does not exist: ${reposDir}` };
  }
  let count = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > c.max_depth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes('.git')) {
      count++;
      return;
    }
    for (const e of entries) {
      if (e.startsWith('.')) continue;
      const p = join(dir, e);
      try {
        if (statSync(p).isDirectory()) walk(p, depth + 1);
      } catch {
        // ignore
      }
    }
  };
  walk(reposDir, 0);
  const emails = cfg.identity.git_emails;
  return {
    source: 'git',
    status: 'ok',
    message: `${count} repos found in ${reposDir} (max_depth=${c.max_depth}, ${emails.length === 0 ? 'no email filter' : `${emails.length} email filter(s)`})`,
    identity: emails.join(', ') || '(any)',
  };
}

async function pingJenkins(cfg: Config): Promise<DoctorResult> {
  const c = cfg.sources.jenkins;
  if (!c?.enabled) return { source: 'jenkins', status: 'disabled', message: 'disabled in config' };
  const token = envValue(c.api_token_env);
  if (!token) return { source: 'jenkins', status: 'fail', message: `missing env ${c.api_token_env}` };
  if (c.jobs.length === 0) {
    return { source: 'jenkins', status: 'fail', message: 'no jobs configured (sources.jenkins.jobs is empty)' };
  }
  return safe('jenkins', async () => {
    const root = await request<{ nodeName?: string }>(`${c.base_url}/api/json`, {
      headers: { ...basic(c.username, token), accept: 'application/json' },
    });
    return {
      source: 'jenkins',
      status: 'ok',
      message: `${c.jobs.length} job(s) configured, server reachable${root.nodeName ? ` (${root.nodeName})` : ''}`,
      identity: c.username,
    };
  });
}

async function pingTodoist(cfg: Config): Promise<DoctorResult> {
  const c = cfg.sources.todoist;
  if (!c?.enabled) return { source: 'todoist', status: 'disabled', message: 'disabled in config' };
  const token = envValue(c.api_token_env);
  if (!token) return { source: 'todoist', status: 'fail', message: `missing env ${c.api_token_env}` };
  return safe('todoist', async () => {
    const projectsUrl = `${c.base_url.replace(/\/$/, '')}${c.paths.projects}`;
    const projects = await request<Array<{ name: string; id: string }>>(projectsUrl, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (c.projects.length) {
      const names = new Set(c.projects.map((p) => p.toLowerCase()));
      const matched = projects.filter((p) => names.has(p.name.toLowerCase()));
      const missing = c.projects.filter((p) => !projects.some((q) => q.name.toLowerCase() === p.toLowerCase()));
      const msg = missing.length
        ? `${matched.length}/${c.projects.length} matched, missing: ${missing.join(', ')}`
        : `${matched.length} project(s) matched`;
      return {
        source: 'todoist',
        status: missing.length ? 'fail' : 'ok',
        message: msg,
      };
    }
    return { source: 'todoist', status: 'ok', message: `${projects.length} project(s) accessible (no whitelist)` };
  });
}

async function pingOutlook(cfg: Config): Promise<DoctorResult> {
  const c = cfg.sources.outlook;
  if (!c?.enabled) return { source: 'outlook', status: 'disabled', message: 'disabled in config' };
  return safe('outlook', async () => {
    const token = await acquireGraphToken(c, ['User.Read', 'Calendars.Read', 'Mail.Read']);
    const me = await request<{ userPrincipalName: string; displayName: string }>(
      'https://graph.microsoft.com/v1.0/me',
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
    );
    return { source: 'outlook', status: 'ok', message: 'silent token OK', identity: me.userPrincipalName };
  });
}

async function pingTeams(cfg: Config): Promise<DoctorResult> {
  const c = cfg.sources.teams;
  if (!c?.enabled) return { source: 'teams', status: 'disabled', message: 'disabled in config' };
  return safe('teams', async () => {
    const scopes = ['User.Read', 'Chat.Read', ...(c.include_online_meetings ? ['OnlineMeetings.Read'] : [])];
    const token = await acquireGraphToken(c, scopes);
    const me = await request<{ userPrincipalName: string }>('https://graph.microsoft.com/v1.0/me', {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    return { source: 'teams', status: 'ok', message: 'silent token OK', identity: me.userPrincipalName };
  });
}

async function pingLlm(cfg: Config): Promise<DoctorResult> {
  const c = cfg.llm;
  if (!c) return { source: 'llm', status: 'disabled', message: 'no llm config' };

  return safe('llm', async () => {
    // Minimal "hello" call to verify connectivity + auth
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Respond with exactly OK' }] }],
      generationConfig: { maxOutputTokens: 5 },
    });
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      ...resolveCustomHeaders(c.custom_headers),
    };
    const res = await request<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>(
      c.endpoint,
      { method: 'POST', headers, body },
    );
    const text = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    const headerCount = c.custom_headers ? Object.keys(c.custom_headers).length : 0;
    return {
      source: 'llm',
      status: 'ok',
      message: `endpoint reachable, model: ${c.model}${headerCount ? ` (${headerCount} custom header(s))` : ''}`,
      identity: text || '(empty response)',
    };
  });
}

export function renderDoctorReport(results: DoctorResult[]): string {
  const tty = isTty();
  const wrap = (status: DoctorResult['status'], s: string): string => {
    if (!tty) return s;
    if (status === 'ok') return c.green(s);
    if (status === 'fail') return c.red(s);
    return c.dim(s);
  };
  const symbol: Record<DoctorResult['status'], string> = {
    ok: '✓',
    fail: '✗',
    disabled: '─',
    skipped: '·',
  };

  const lines: string[] = [];
  if (tty) lines.push(banner('rewind doctor'));
  const maxName = Math.max(...results.map((r) => r.source.length));
  for (const r of results) {
    const emoji = SOURCE_EMOJI[r.source] ?? ' ';
    const name = r.source.padEnd(maxName);
    const sym = wrap(r.status, symbol[r.status]);
    const msg = wrap(r.status, r.message);
    const id = r.identity ? `  ${tty ? c.gray('[' + r.identity + ']') : '[' + r.identity + ']'}` : '';
    lines.push(`  ${sym} ${emoji} ${name}  ${msg}${id}`);
  }
  const failed = results.filter((r) => r.status === 'fail').length;
  const ok = results.filter((r) => r.status === 'ok').length;
  const disabled = results.filter((r) => r.status === 'disabled').length;
  const summary = `${ok} ok · ${failed} failed · ${disabled} disabled`;
  lines.push('');
  lines.push(tty ? footer(summary) : summary);
  return lines.join('\n');
}
