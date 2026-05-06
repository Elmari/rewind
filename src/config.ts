import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';

const AuthMethodSchema = z.enum(['bearer', 'basic']).default('bearer');

const JiraSchema = z.object({
  enabled: z.boolean().default(true),
  base_url: z.string().url(),
  pat_env: z.string().default('JIRA_PAT'),
  auth_method: AuthMethodSchema,
});

const ConfluenceSchema = z.object({
  enabled: z.boolean().default(true),
  base_url: z.string().url(),
  pat_env: z.string().default('CONFLUENCE_PAT'),
  spaces: z.array(z.string()).default([]),
  auth_method: AuthMethodSchema,
});

const BitbucketSchema = z.object({
  enabled: z.boolean().default(true),
  base_url: z.string().url(),
  pat_env: z.string().default('BITBUCKET_PAT'),
  auth_method: AuthMethodSchema,
});

const GitlabSchema = z.object({
  enabled: z.boolean().default(true),
  base_url: z.string().url(),
  pat_env: z.string().default('GITLAB_PAT'),
});

const GithubSchema = z.object({
  enabled: z.boolean().default(false),
  base_url: z.string().url().default('https://api.github.com'),
  web_url: z.string().url().optional(),
  pat_env: z.string().default('GITHUB_PAT'),
  username: z.string().optional(),
  repos: z.array(z.string()).default([]),
});

const JenkinsSchema = z.object({
  enabled: z.boolean().default(false),
  base_url: z.string().url(),
  username: z.string(),
  api_token_env: z.string().default('JENKINS_TOKEN'),
  jobs: z.array(z.string()).default([]),
  alt_user_ids: z.array(z.string()).default([]),
  scm_emails: z.array(z.string()).default([]),
});

const TodoistSchema = z.object({
  enabled: z.boolean().default(false),
  api_token_env: z.string().default('TODOIST_TOKEN'),
  projects: z.array(z.string()).default([]),
  include_created: z.boolean().default(false),
});

const GitSchema = z.object({
  enabled: z.boolean().default(true),
  repos_dir: z.string(),
  max_depth: z.number().int().min(1).max(5).default(2),
});

const OutlookSchema = z.object({
  enabled: z.boolean().default(true),
  tenant_id: z.string(),
  client_id: z.string(),
  include_calendar: z.boolean().default(true),
  include_sent_mail: z.boolean().default(true),
});

const TeamsSchema = z.object({
  enabled: z.boolean().default(false),
  tenant_id: z.string(),
  client_id: z.string(),
  include_chats: z.boolean().default(true),
  include_online_meetings: z.boolean().default(false),
  max_chats: z.number().int().min(1).max(200).default(50),
});

const LlmSchema = z.object({
  endpoint: z.string().url(),
  api_key_env: z.string().default('GEMINI_API_KEY'),
  model: z.string().default('gemini-2.5-flash'),
  prompt_language: z.enum(['de', 'en']).default('de'),
  custom_headers: z.record(z.string()).optional(),
});

const OutputSchema = z.object({
  format: z.enum(['markdown', 'json', 'text']).default('markdown'),
  clipboard: z.boolean().default(false),
  save_to_cache: z.boolean().default(true),
});

const DefaultsSchema = z.object({
  weekend_skip: z.boolean().default(true),
  timezone: z.string().default('Europe/Berlin'),
});

const IdentitySchema = z.object({
  atlassian_user: z.string().optional(),
  jira_user: z.string().optional(),
  confluence_user: z.string().optional(),
  bitbucket_user: z.string().optional(),
  git_emails: z.array(z.string()).default([]),
});

export const ConfigSchema = z.object({
  identity: IdentitySchema.default({ git_emails: [] }),
  sources: z
    .object({
      jira: JiraSchema.optional(),
      confluence: ConfluenceSchema.optional(),
      bitbucket: BitbucketSchema.optional(),
      gitlab: GitlabSchema.optional(),
      github: GithubSchema.optional(),
      git: GitSchema.optional(),
      jenkins: JenkinsSchema.optional(),
      todoist: TodoistSchema.optional(),
      outlook: OutlookSchema.optional(),
      teams: TeamsSchema.optional(),
    })
    .default({}),
  llm: LlmSchema.optional(),
  output: OutputSchema.default({ format: 'markdown', clipboard: false, save_to_cache: true }),
  defaults: DefaultsSchema.default({ weekend_skip: true, timezone: 'Europe/Berlin' }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type JiraConfig = z.infer<typeof JiraSchema>;
export type ConfluenceConfig = z.infer<typeof ConfluenceSchema>;
export type BitbucketConfig = z.infer<typeof BitbucketSchema>;
export type GitlabConfig = z.infer<typeof GitlabSchema>;
export type GithubConfig = z.infer<typeof GithubSchema>;
export type GitConfig = z.infer<typeof GitSchema>;
export type JenkinsConfig = z.infer<typeof JenkinsSchema>;
export type TodoistConfig = z.infer<typeof TodoistSchema>;
export type OutlookConfig = z.infer<typeof OutlookSchema>;
export type TeamsConfig = z.infer<typeof TeamsSchema>;
export type LlmConfig = z.infer<typeof LlmSchema>;

export function defaultConfigPath(): string {
  if (process.env.REWIND_CONFIG) return process.env.REWIND_CONFIG;
  return join(homedir(), '.config', 'rewind', 'config.yaml');
}

export function loadConfig(path?: string): { config: Config; path: string } {
  const p = path ?? defaultConfigPath();
  if (!existsSync(p)) {
    throw new Error(`Config not found at ${p}. Run \`rewind config init\` to create one.`);
  }
  const raw = readFileSync(p, 'utf8');
  const parsed = yaml.load(raw);
  const config = ConfigSchema.parse(parsed);
  return { config, path: p };
}

export function writeSampleConfig(path?: string): string {
  const p = path ?? defaultConfigPath();
  if (existsSync(p)) {
    throw new Error(`Config already exists at ${p}`);
  }
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, SAMPLE_CONFIG, 'utf8');
  return p;
}

export function readEnvSecret(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const SAMPLE_CONFIG = `# rewind config — see README.md
identity:
  # Used as fallback for all Atlassian sources (Jira/Confluence/Bitbucket).
  # Override per-source below if usernames differ.
  atlassian_user: your.username
  # jira_user: your.username
  # confluence_user: your.username
  # bitbucket_user: your.username
  git_emails:
    - you@firma.de

sources:
  jira:
    enabled: true
    base_url: https://jira.firma.de
    pat_env: JIRA_PAT
    auth_method: bearer        # bearer (default) | basic — switch to basic if your server rejects Bearer PATs

  confluence:
    enabled: true
    base_url: https://confluence.firma.de
    pat_env: CONFLUENCE_PAT
    spaces: []
    auth_method: bearer

  bitbucket:
    enabled: true
    base_url: https://bitbucket.firma.de
    pat_env: BITBUCKET_PAT
    auth_method: bearer

  gitlab:
    enabled: false                     # flip on once you migrate
    base_url: https://gitlab.firma.de
    pat_env: GITLAB_PAT

  github:
    enabled: false
    base_url: https://api.github.com
    # web_url: https://github.com      # auto-derived for github.com; set explicitly for Enterprise
    pat_env: GITHUB_PAT
    # username: efischer               # optional; resolved from token if omitted
    repos: []                          # optional whitelist (e.g. ['owner/repo'])

  git:
    enabled: true
    repos_dir: C:/Users/elias/IdeaProjects
    max_depth: 2

  jenkins:
    enabled: false
    base_url: https://jenkins.firma.de
    username: efischer                 # Jenkins username (NOT email)
    api_token_env: JENKINS_TOKEN
    jobs:                              # whitelist of job paths, slash-separated for folders
      - team-x/api-service
      - team-x/web-app
    alt_user_ids: []                   # other Jenkins user IDs that are also you (e.g. legacy)
    scm_emails:                        # SCM-trigger causes mention author email; matches your pushes
      - elias@firma.de

  todoist:
    enabled: false
    api_token_env: TODOIST_TOKEN
    projects:                          # whitelist by project NAME (case-insensitive); empty = all
      - Work
    include_created: false             # also include tasks created in range (not just completed)

  outlook:
    enabled: false
    tenant_id: 00000000-0000-0000-0000-000000000000
    client_id: 00000000-0000-0000-0000-000000000000
    include_calendar: true
    include_sent_mail: true

  teams:
    enabled: false                     # shares Azure App Registration with outlook
    tenant_id: 00000000-0000-0000-0000-000000000000
    client_id: 00000000-0000-0000-0000-000000000000
    include_chats: true                # 1:1 + group chats with own messages
    include_online_meetings: false     # usually already in Outlook calendar
    max_chats: 50                      # how many recent chats to scan

llm:
  endpoint: https://corp-llm-proxy.firma.de/v1/models/gemini-2.5-flash:generateContent
  api_key_env: GEMINI_API_KEY
  model: gemini-2.5-flash
  prompt_language: de
  # custom_headers:
  #   X-Company-Source: rewind
  #   Authorization: Bearer some-other-token

output:
  format: markdown
  clipboard: false
  save_to_cache: true

defaults:
  weekend_skip: true
  timezone: Europe/Berlin
`;
