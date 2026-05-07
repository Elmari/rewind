# rewind

> What did I actually do yesterday — what am I currently working on — and what's on for today?

`rewind` is the five-minute pre-standup tool. It pulls activity from Jira, Confluence, Bitbucket, GitLab, GitHub, local Git, Jenkins, Todoist, Outlook and Teams, then asks a (corporate) Gemini to fold it all into a two-part summary.

## What it produces

```
- PROJ-1234: implemented caching layer for search queries and opened a PR.
- PROJ-1199: fixed login redirect bug, merged.
- PROJ-1201: reviewed Anna's PR.
- Architecture sync with backend team on the new event bus.

Today:
- PROJ-1234: caching layer (in progress) — still in flight.
- 2 PRs waiting on my review (#42, #44).
- 14:00 refinement, 15:30 architecture sync.
- Todoist: finish migration-path spec (due tomorrow).
```

That's the full output of `rewind` (German variant available via `prompt_language: de`). It's deliberately compact — designed to be pasted, scanned, or read aloud.

## How it works

```
┌──────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌─────┐ ┌────────┐ ┌───────┐
│ Jira │ │Confluence│ │Bitbucket │ │ GitLab │ │ Git │ │Outlook │ │ Teams │
└──┬───┘ └────┬─────┘ └────┬─────┘ └───┬────┘ └──┬──┘ └───┬────┘ └───┬───┘
   └──────────┴───────────┴────────────┼─────────┴────────┴───────────┘
                                       ▼
                              ┌─────────────────┐
                              │   normalized    │
                              │   Activity[]    │
                              └────────┬────────┘
                                       ▼
                              ┌─────────────────┐
                              │  Gemini prompt  │
                              │  (corp proxy)   │
                              └────────┬────────┘
                                       ▼
                              ┌─────────────────┐
                              │ daily markdown  │
                              │  → stdout/clip  │
                              └─────────────────┘
```

Each source runs in parallel; a failing source doesn't abort the run. Raw activities are cached per day in `~/.cache/rewind/<YYYY-MM-DD>.json` — the LLM result isn't cached (re-running the prompt is cheap).

## What gets sent where

The Gemini prompt receives normalized activity metadata: ticket IDs, titles, statuses, PR titles, commit messages, calendar event titles, file paths from commits. It does **not** receive: chat message contents (Teams sends only aggregate counts), email bodies (Outlook sends sent-mail subjects only), Confluence page bodies, or any secrets. All HTTP calls go through `HTTPS_PROXY` if set, and through the same `undici` dispatcher with `NODE_EXTRA_CA_CERTS` honored. If you'd rather not involve an LLM at all, run with `--no-llm` and you get raw structured markdown.

## Quick Start

```bash
git clone <repo> rewind && cd rewind
npm install                           # NO script execution (see .npmrc), pure dep install
npm run prepare                       # builds dist/ + installs Husky hooks (only our own scripts)
npm link                              # makes `rewind` globally available

rewind config init                    # creates ~/.config/rewind/config.yaml
cp .env.example .env                  # fill in PATs + GEMINI_API_KEY

# tweak config, then
rewind doctor                         # validate every enabled source
rewind --no-llm --sources git         # try git alone first
rewind                                # full run for yesterday (Mon picks up Friday)
```

### Run from anywhere

`npm link` registers `rewind` globally, but secrets are by default only looked up in the current working directory (`./.env`). To call `rewind` from any directory, put your `.env` in a **global** location — `rewind` loads them in this order (first hit per variable wins):

1. `$REWIND_ENV` (path stored in this env var)
2. `~/.config/rewind/.env` (recommended — analogous to `config.yaml`)
3. `./.env` (fallback for the repo directory)

```bash
# one-time
mkdir -p ~/.config/rewind
mv .env ~/.config/rewind/.env

# from now on rewind runs from any directory
cd ~/Downloads && rewind doctor
```

`config.yaml` already lives globally under `~/.config/rewind/config.yaml` (or via `$REWIND_CONFIG`).

> **Security note**: the repo ships with `.npmrc` containing `ignore-scripts=true`, so `npm install` runs no `pre`/`post`/`install` scripts of dependencies — the most common entry point for npm supply-chain attacks (shai-hulud, es5-ext, …). The build runs manually via `npm run prepare`. If you fully trust the repo, you can relax that setting in `.npmrc`.

### Corp proxy & custom CA

```
HTTPS_PROXY=http://proxy.firma.de:8080
NO_PROXY=localhost,127.0.0.1
NODE_EXTRA_CA_CERTS=C:/path/to/corp-ca-bundle.pem
```

All HTTP calls (Atlassian, Bitbucket, GitLab, Graph, Gemini) share the same `undici` dispatcher; the `ProxyAgent` is wired up automatically when `HTTPS_PROXY` is present.

## CLI

| Invocation | Effect |
|---|---|
| `rewind` | Yesterday (smart: Mon picks up Friday) |
| `rewind --date 2026-05-04` | Specific day |
| `rewind --since 2026-05-01 --until 2026-05-04` | Range |
| `rewind --sources jira,git` | **Opt-in**: only the listed sources |
| `rewind --exclude outlook,teams` | **Opt-out**: everything except the listed |
| `rewind --no-llm` | Raw markdown, no LLM summary |
| `rewind --json` | Raw JSON instead of markdown |
| `rewind --copy` | Copy result to clipboard |
| `rewind --refresh` | Ignore cache, re-fetch |
| `rewind --config <path>` | Different config file (else `$REWIND_CONFIG` or default) |
| `rewind doctor` | Per enabled source: auth test + identity check |
| `rewind login outlook` / `rewind login teams` | MS Graph device-code flow |
| `rewind config init` | Write a sample config |

Sources can be turned off in two ways: permanently via `enabled: false` in `config.yaml`, or per run via `--exclude <names>` / `--sources <names>`.

## Verify your setup — `rewind doctor`

After configuring a source, validate it:

```bash
rewind doctor
```

For each enabled source a lightweight test call identifies **you** on the other end and tells you whether auth + URL + (for Atlassian) `auth_method` line up.

```
  ⏪ rewind doctor
  ────────────────────────────────────

  ✓ 🎫 jira         auth bearer                                   [e.fischer]
  ✗ 📘 confluence   missing env CONFLUENCE_PAT
  ✗ 🪣 bitbucket    401 — try auth_method: basic?
  ─ 🦊 gitlab       disabled in config
  ✓ 🐙 github       token valid                                   [efischer]
  ✓ 💻 git          22 repos found (max_depth=2)                  [(any)]
  ✓ 🤖 jenkins      2 job(s) configured, server reachable         [efischer]
  ✓ ✅ todoist      1 project(s) matched
  ✓ 📧 outlook      silent token OK                               [e.fischer@firma.de]
  ─ 💬 teams        disabled in config
  ✓ 🧠 llm          endpoint reachable, model: gemini-2.5-flash   [OK]

  7 ok · 2 failed · 2 disabled
```

`✓` green = reachable, auth works, the `[…]` shows the resolved identifier (handy for catching typos in `identity` or wrong accounts). `✗` red = enabled but the test call failed; the message says why. `─` grey = disabled.

Exit code is `1` if at least one source fails — handy for CI/scripts.

| Source | Endpoint | What it confirms |
|---|---|---|
| Jira | `/rest/api/2/myself` | PAT + auth_method, returns your username |
| Confluence | `/rest/api/user/current` | same |
| Bitbucket | `/dashboard/pull-requests?limit=1` | PAT + auth + visibility |
| GitLab | `/api/v4/user` | PAT, returns user + ID |
| GitHub | `/user` | PAT, returns login |
| Git | local only | that `repos_dir` exists + repo count |
| Jenkins | `/api/json` | API token + server reachable |
| Todoist | `/projects` | token + that configured project names exist |
| Outlook/Teams | `/me` with silent token | that the MSAL cache is valid (otherwise: run `rewind login` first) |
| LLM (Gemini) | `POST <endpoint>` with `Respond with exactly OK` | endpoint, headers, body shape, model reachability |

Rule of thumb: **always run `rewind doctor` before your first real `rewind` run** — find config issues immediately instead of staring at a silent empty output.

## Per-source setup

Each source needs its own credentials. Below: where to get them, what goes in `config.yaml`, what goes in `.env`.

### Jira (on-prem / Server / Data Center)

1. Create a personal access token: Jira → top right click your profile → **Profile** → left column **Personal Access Tokens** → **Create token**. Copy it (only shown once).
2. `.env`:
   ```
   JIRA_PAT=<token>
   ```
3. `config.yaml` → `sources.jira`:
   ```yaml
   jira:
     enabled: true
     base_url: https://jira.firma.de
     pat_env: JIRA_PAT
     auth_method: bearer        # if you get 401 back, switch to 'basic'
     in_progress_jql: 'assignee = currentUser() AND project = PROJ AND status = "In Progress"'
     suggestions_jql: 'project = PROJ AND status = "Ready for Dev" ORDER BY priority DESC'
     # ↑ If `in_progress_jql` returns 0 hits, up to 10 tickets from
     #   `suggestions_jql` are emitted as pickup suggestions. Both empty = fallback off.
   identity:
     atlassian_user: e.fischer  # your Jira username (used for JQL filters)
   ```
4. Test:
   ```bash
   rewind --no-llm --sources jira --date 2026-05-05
   ```

**If Bearer is rejected** (some older servers / reverse-proxy setups): set `auth_method: basic`. The PAT is then used as the password in HTTP Basic auth, with `identity.jira_user` / `atlassian_user` as the username.

### Confluence (on-prem)

1. Create a PAT: Confluence → profile → **Personal Access Tokens** → **Create token**. (Same UI pattern as Jira.)
2. `.env`:
   ```
   CONFLUENCE_PAT=<token>
   ```
3. `config.yaml`:
   ```yaml
   confluence:
     enabled: true
     base_url: https://confluence.firma.de
     pat_env: CONFLUENCE_PAT
     spaces: []                 # empty = all; or e.g. ['DEV', 'TEAM']
     auth_method: bearer
   ```

`identity.atlassian_user` (or `confluence_user`) is used as a CQL filter: `lastModifier = "<user>"`.

### Bitbucket (Server / Data Center, on-prem)

> **Scope:** the Bitbucket source captures pull-request activity only (open, merge, comments, reviews). Direct commits without a PR come in via the `git` source from your local repos.

1. Create a PAT: top right click your avatar → **Manage account** → **Personal access tokens** → **Create**. Permissions: **Repository read** + **Project read**.
2. `.env`:
   ```
   BITBUCKET_PAT=<token>
   ```
3. `config.yaml`:
   ```yaml
   bitbucket:
     enabled: true
     base_url: https://bitbucket.firma.de
     pat_env: BITBUCKET_PAT
     auth_method: bearer
     ignored_authors:                      # PRs from these users are filtered out entirely
       - renovate
       - dependabot
   identity:
     bitbucket_user: efischer   # often different from the Jira username
   ```

### GitHub (github.com or Enterprise)

1. Create a PAT at GitHub Settings → Developer settings → **Personal access tokens** → **Fine-grained** (or classic). Scopes: `repo` (read), `read:user`.
2. `.env`:
   ```
   GITHUB_PAT=<token>
   ```
3. `config.yaml`:
   ```yaml
   github:
     enabled: true
     base_url: https://api.github.com
     # web_url: https://github.com           # auto-derived; only needed for Enterprise
     pat_env: GITHUB_PAT
     # username: efischer                    # optional, otherwise read from the token
     repos:                                  # optional whitelist (otherwise all)
       - owner/repo-a
       - owner/repo-b
     ignored_authors:
       - renovate[bot]
       - dependabot[bot]
   ```

For **GitHub Enterprise** set both URLs:
```yaml
base_url: https://github.firma.de/api/v3
web_url: https://github.firma.de
```

### GitLab (on-prem)

1. Create a PAT: top right → **Edit profile** → **Access Tokens** → **Add new token**. Scope: `read_api`.
2. `.env`:
   ```
   GITLAB_PAT=<token>
   ```
3. `config.yaml`:
   ```yaml
   gitlab:
     enabled: true
     base_url: https://gitlab.firma.de
     pat_env: GITLAB_PAT
     ignored_authors:
       - renovate-bot
       - dependabot
   ```

GitLab identifies you automatically via the token (`/api/v4/user`); no username needed.

### Local Git repos

No auth required. The source recursively walks (default `max_depth: 2`) through a directory and runs `git log --since --until --all` in each repo.

```yaml
git:
  enabled: true
  repos_dir: C:/Users/elias/IdeaProjects
  max_depth: 2
identity:
  git_emails:                  # author emails — empty = all commits
    - elias@firma.de
    - elias@privat.de          # multiple allowed
```

Commits are flagged `unpushed: true` if they exist locally but not on the remote (via `git log --branches --not --remotes`).

### Jenkins

1. Create an **API token** (not your password): Jenkins → top right click your name → **Configure** → **API Token** → **Add new Token** → copy.
2. `.env`:
   ```
   JENKINS_TOKEN=<api-token>
   ```
3. `config.yaml`:
   ```yaml
   jenkins:
     enabled: true
     base_url: https://jenkins.firma.de
     username: efischer                      # Jenkins username (NOT email)
     api_token_env: JENKINS_TOKEN
     jobs:                                   # whitelist of multibranch container paths
       - team-x/api-service                  # ↑ point at the multibranch *container*, not a single branch
       - team-x/web-app                      #   the source recurses into per-branch sub-jobs automatically
     alt_user_ids: []                        # if you've had other Jenkins IDs
     scm_emails:                             # match on SCM push triggers ("Started by GitHub push by …")
       - elias@firma.de
   ```

> **Multibranch only.** `jobs` entries must point at the multibranch pipeline *container* (`<team>/<project>`); the source recurses into the per-branch sub-jobs. Branches starting with `renovate` are skipped automatically.

**Filtering**: the source only fetches builds from jobs in the `jobs` list. Per build it filters on:
- **Triggered by user**: cause has your `username` (or one of `alt_user_ids`)
- **Triggered by SCM**: cause description contains one of your `scm_emails` (for automatic builds after a push)

Builds without a match are dropped — i.e. the giant build log of the master job won't show up, only your own runs.

**Auth**: HTTP Basic with `username:api_token`.

### Todoist

1. Get the API token: Todoist Web → Settings → **Integrations** → tab **Developer** → **API token**.
2. `.env`:
   ```
   TODOIST_TOKEN=<token>
   ```
3. `config.yaml`:
   ```yaml
   todoist:
     enabled: true
     api_token_env: TODOIST_TOKEN
     base_url: https://api.todoist.com
     paths:                                  # endpoints — defaults are the v1 unified API
       projects: /api/v1/projects
       tasks: /api/v1/tasks
       completed: /api/v1/tasks/completed/by_completion_date
     projects:                               # whitelist by project NAME (case-insensitive)
       - Work                                # empty = all projects
     include_created: false                  # true = also count tasks you created yesterday
   ```

The source returns completed tasks in the range, and optionally tasks created in the range (if `include_created: true`).

**API endpoints are configurable.** If Todoist changes them again, override `paths` — e.g. with the legacy paths `/rest/v2/projects`, `/rest/v2/tasks`, `/sync/v9/completed/get_all`.

Projects are resolved by name (no project-ID hardcoding). If a project name isn't found, you get a warning and the rest still runs.

### Outlook (Microsoft 365 / Graph) — ⚠️ requires an Azure app registration

> **Prerequisite**: an Azure app registration must exist in your tenant. If IT has locked that down (often the case at large companies), you can't create one yourself — talk to your Azure admin.

**What IT needs to configure:**
- **App registration** (no service principal) with:
  - **Supported account types**: single tenant
  - **Authentication → Allow public client flows: Yes**
  - **API Permissions** (delegated, *not* application): `User.Read`, `Calendars.Read`, `Mail.Read`
  - No redirect URI needed (device-code flow)

You'll need: **Tenant ID** and **Client ID** (= "Application (client) ID"), both from the Azure portal.

```yaml
outlook:
  enabled: true
  tenant_id: <tenant-uuid>
  client_id: <app-client-uuid>
  include_calendar: true
  include_sent_mail: true
```

```bash
rewind login outlook
```

A code is printed — open `https://microsoft.com/devicelogin`, enter it, sign in, accept the permissions. The token lands in `~/.config/rewind/msal-cache.json` and is silently refreshed afterwards.

**No app registration available?** Disable the source (`enabled: false`) — the rest of the tool works without it.

### Teams (Microsoft 365 / Graph) — ⚠️ same prerequisite as Outlook

Shares the app registration with Outlook. IT needs to add these **delegated** permissions to the existing registration:
- `Chat.Read`
- `OnlineMeetings.Read` (optional, only if `include_online_meetings: true`)

```yaml
teams:
  enabled: true
  tenant_id: <same-tenant-as-outlook>
  client_id: <same-app-as-outlook>
  include_chats: true
  include_online_meetings: false   # Teams calls that exist as calendar events are already pulled by Outlook
  max_chats: 50                    # how many recently-active chats to scan
```

```bash
rewind login teams
```

(If an Outlook login already exists, only the scope set is extended.)

**What Teams provides:** aggregated chat activity per chat (`"Chat with X — N own messages"` — message contents are **not** sent to the LLM); optionally online meetings you organized.

**What Teams does *not* provide:** PSTN/phone calls (CDR data behind `CallRecords.Read.All` — application permission, admin consent required) and channel posts (`ChannelMessage.Read.All`, similarly tricky). Both unreachable without IT support.

### Gemini (LLM behind a corp proxy)

```yaml
llm:
  endpoint: https://corp-llm-proxy.firma.de/projects/PROJECT/locations/europe-west1/publishers/google/models/gemini-2.5-flash:generateContent
  model: gemini-2.5-flash
  prompt_language: en            # 'de' for a German bullet list
  custom_headers:                # auth flows entirely through here
    x-api-key: '${GEMINI_API_KEY}'   # ${ENV_VAR} is substituted at runtime
    # x-tenant-id: team-x        # additional headers as needed
```

```
GEMINI_API_KEY=<key>
```

`rewind` sets **no** auth header automatically — everything goes through `custom_headers`. Region, project ID, location and model name live in the `endpoint` URL. Pick whatever auth header your proxy expects: `x-api-key`, `Authorization: Bearer …`, etc.

`${ENV_VAR_NAME}` in `custom_headers` values is substituted at runtime; missing variables produce a clear error. Secrets stay in `.env`, never in the config file.

**Body shape:** standard Gemini format with separate `systemInstruction` and `contents`. If your proxy expects a different body schema (e.g. OpenAI-compatible), `src/llm/gemini.ts` is the only place that needs adjusting.

Verify with `rewind doctor` — the LLM check makes a minimal `Respond with exactly OK` call.

## Daily-style of the LLM output

The prompt enforces a two-part output (sample at the top of this README). The structure:

**Section 1 — yesterday:** 3–6 bullets, one per ticket, ticket ID up front. Multiple commits/PR-actions/worklogs on the same ticket collapse into one bullet. First person, concrete verbs (implemented, fixed, reviewed). Routine meetings dropped, substantive ones get their own bullet.

**Section 2 — today:** merges open work + meetings. Grouped: own ongoing work first, then pending reviews, meetings, tasks. Items sharing a ticket ID with a yesterday-bullet aren't repeated, just noted as "still in flight". Meetings stay compact (`14:00 architecture sync with backend`). Hints about old untouched items ("PR has been sitting for 5 days") only when notable. If `in_progress_jql` returns 0 hits and `suggestions_jql` is set, 1–2 pickup suggestions appear instead.

### Which source provides what?

| Source | Activity (yesterday) | Open items | Today's calendar |
|---|---|---|---|
| Jira | issues + status transitions + worklogs | tickets with `assignee = you AND statusCategory != Done` (+ `suggestions_jql` if `in_progress_jql` is empty) | – |
| Confluence | pages + comments | – | – |
| Bitbucket | PRs + reviews + comments | own open PRs + review inbox | – |
| GitLab | pushes + MRs + reviews + comments | own open MRs + review inbox | – |
| GitHub | pushes + PRs + reviews + comments | own open PRs + `review-requested:me` | – |
| Git (local) | commits | – | – |
| Jenkins | builds | – | – |
| Todoist | completed tasks | open tasks (project whitelist) | – |
| Outlook | meetings yesterday + sent mails | – | meetings today (from now on) |
| Teams | chat activity + meetings | – | online meetings today (if enabled) |

## "Smart yesterday"

The default for `rewind` (no args) isn't `today - 1`:

| Today | "yesterday" |
|---|---|
| Mon | last Friday |
| Sat | Friday |
| Sun | Friday |
| else | yesterday |

Disable with `defaults.weekend_skip: false`.

## Architecture

### Tech stack
**Node.js ≥ 20** + **TypeScript** (ESM); **commander** (CLI); **undici** (HTTP, `ProxyAgent`); **simple-git**; **@azure/msal-node** (Outlook/Teams, public-client device-code flow); **zod** (config validation); **js-yaml** + **dotenv**; **pino**.

### Source-plugin pattern

Each source is a module exporting a `fetch…` function returning `Promise<SourceResult>`. All sources produce the same normalized type:

```ts
interface Activity {
  source: 'jira' | 'confluence' | 'bitbucket' | 'gitlab' | 'git' | 'outlook' | 'teams';
  type: string;            // 'commit', 'pr-merged', 'mr-opened', 'meeting', 'chat-activity', ...
  timestamp: string;       // ISO
  title: string;
  url?: string;
  details?: Record<string, unknown>;
}
```

The pipeline in `src/sources/index.ts` calls all enabled sources via `Promise.all` with per-source try/catch — a failing source only leaves its own block empty.

### File overview

```
src/
├── index.ts                  CLI (commander) + pipeline orchestration
├── config.ts                 zod-validated YAML loading + sample generator
├── range.ts                  "yesterday" logic with Mon→Fri jump
├── http.ts                   undici setup + bearer/basic helpers
├── cache.ts                  per-day JSON cache in ~/.cache/rewind/
├── log.ts                    pino-pretty
├── types.ts                  Activity, DateRange, SourceResult
├── auth/msal.ts              shared MSAL public client (Outlook + Teams)
├── sources/
│   ├── index.ts              source registry + runSources() with graceful degradation
│   ├── jira.ts               REST v2: /search (JQL) + /issue/{key}/worklog + changelog
│   ├── confluence.ts         REST: /content/search (CQL)
│   ├── bitbucket.ts          REST 1.0: /dashboard/pull-requests + /activities
│   ├── gitlab.ts             REST v4: /events + /merge_requests
│   ├── github.ts             REST v3: /users/<u>/events
│   ├── git.ts                repo walk + simple-git log with unpushed marker
│   ├── jenkins.ts            REST: per-job builds[*] with cause filter
│   ├── todoist.ts            REST + sync API for completed
│   ├── outlook.ts            MSAL + /me/calendarView + /sentitems
│   └── teams.ts              MSAL + /me/chats + own-message filter
├── llm/
│   ├── gemini.ts             POST with custom_headers, standard Gemini body
│   └── prompt.ts             daily-style prompt (DE/EN), ticket-centric few-shot
└── format/
    ├── markdown.ts           raw output for --no-llm
    └── condense.ts           preparation for the LLM prompt
```

### Adding your own source

1. Create `src/sources/<name>.ts` with a function returning `Promise<SourceResult>`.
2. Extend the schema in `src/config.ts` (zod), export the type.
3. Register in `SOURCES` and `ALL_SOURCES` in `src/sources/index.ts`.
4. Add to `SourceName` (`src/types.ts`) and, if needed, a label in `src/format/markdown.ts:typeLabel`.

## Development

```bash
npm run dev -- --no-llm --sources git    # run without build (tsx)
npm run typecheck
npm test                                  # unit tests for range.ts
npm run build
```

## Out of scope

- **PSTN phone calls** (Teams calls as phone records) — needs admin permissions
- **Browser history**
- **Shell / IDE history** (might come later as an optional source)
- **HTML output / web UI**
- **On-prem Exchange via EWS** — Outlook requires M365/Graph

## License

Private tool. All rights reserved.
