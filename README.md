# rewind

> Was hab ich gestern eigentlich gemacht — woran bin ich aktuell dran — und was steht heute an?

`rewind` sammelt aus Jira, Confluence, Bitbucket, GitLab, GitHub, lokalen Git-Repos, Jenkins, Todoist, Outlook und Teams **drei** Sichten zusammen: (a) Aktivitäten vom Vortag, (b) aktuell offene Tickets/PRs/Tasks und (c) den heutigen Kalender. Alles geht an einen (Unternehmens-)Gemini, der eine **zweigeteilte** Daily-Standup-Zusammenfassung erzeugt: "Gestern …" + "Heute …" (mit smartem Merge aus offener Arbeit + Terminen).

Gedacht für die fünf Minuten vor dem Daily, in denen man sich sonst durch sieben Tabs klickt.

## Wie es funktioniert

```
┌──────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌─────┐ ┌────────┐ ┌───────┐
│ Jira │ │Confluence│ │Bitbucket │ │ GitLab │ │ Git │ │Outlook │ │ Teams │
└──┬───┘ └────┬─────┘ └────┬─────┘ └───┬────┘ └──┬──┘ └───┬────┘ └───┬───┘
   └──────────┴───────────┴────────────┼─────────┴────────┴───────────┘
                                       ▼
                              ┌─────────────────┐
                              │  normalisierte  │
                              │   Activity[]    │
                              └────────┬────────┘
                                       ▼
                              ┌─────────────────┐
                              │  Gemini-Prompt  │
                              │   (Corp-Proxy)  │
                              └────────┬────────┘
                                       ▼
                              ┌─────────────────┐
                              │ Daily-Markdown  │
                              │  → stdout/Clip  │
                              └─────────────────┘
```

Jede Quelle wird parallel angefragt; eine fehlerhafte Quelle bricht den Lauf nicht ab. Roh-Aktivitäten werden pro Tag in `~/.cache/rewind/<YYYY-MM-DD>.json` gecacht — das LLM-Ergebnis nicht (Re-Runs am Prompt sind so billig).

## Quick Start

```bash
git clone <repo> rewind && cd rewind
npm install                           # KEIN script-execution (siehe .npmrc), reine Dep-Installation
npm run prepare                       # baut dist/ + installiert Husky-Hooks (nur unsere eigenen Scripts)
npm link                              # macht `rewind` global verfügbar

rewind config init                    # legt ~/.config/rewind/config.yaml an
cp .env.example .env                  # PATs + GEMINI_API_KEY eintragen

# Config anpassen, dann
rewind --no-llm --sources git         # erstmal git allein testen
rewind                                # voller Lauf für gestern (Mo holt Freitag)
```

### Von überall ausführen

`npm link` registriert `rewind` global, aber Secrets werden standardmäßig nur in der aktuellen Arbeits-Directory gesucht (`./.env`). Damit du `rewind` in jedem beliebigen Verzeichnis aufrufen kannst, leg deine `.env` an einem **globalen** Ort ab — `rewind` lädt sie in dieser Reihenfolge (erster Treffer pro Variable gewinnt):

1. `$REWIND_ENV` (Pfad in dieser Env-Variable)
2. `~/.config/rewind/.env` (empfohlen — analog zur `config.yaml`)
3. `./.env` (Fallback fürs Repo-Verzeichnis)

```bash
# einmalig
mkdir -p ~/.config/rewind
mv .env ~/.config/rewind/.env

# danach läuft rewind aus jedem Verzeichnis
cd ~/Downloads && rewind doctor
```

Die `config.yaml` lebt sowieso schon global unter `~/.config/rewind/config.yaml` (oder über `$REWIND_CONFIG`).

> **Hinweis zur Sicherheit**: Das Repo enthält ein `.npmrc` mit `ignore-scripts=true`.
> Dadurch laufen beim `npm install` **keine** `pre`/`post`/`install`-Scripts von Dependencies — die häufigste Einfallstür für npm-Supply-Chain-Angriffe (shai-hulud, es5-ext, …). Unser eigener Build läuft dann manuell via `npm run prepare`. Wenn du dem Repo selbst absolut traust, kannst du das setting in `.npmrc` lockern.

## CLI

| Aufruf | Effekt |
|---|---|
| `rewind` | Gestern (smart: Mo holt Freitag) |
| `rewind --date 2026-05-04` | Spezifischer Tag |
| `rewind --since 2026-05-01 --until 2026-05-04` | Zeitraum |
| `rewind --sources jira,git` | **Opt-in**: nur ausgewählte Quellen |
| `rewind --exclude outlook,teams` | **Opt-out**: alles außer den genannten |
| `rewind --no-llm` | Rohes Markdown ohne LLM-Zusammenfassung |
| `rewind --json` | Roh-JSON statt Markdown |
| `rewind --copy` | Ergebnis ins Clipboard |
| `rewind --refresh` | Cache ignorieren, neu fetchen |
| `rewind --config <pfad>` | Andere Config-Datei (sonst `$REWIND_CONFIG` oder Default) |
| `rewind doctor` | Pro aktivierte Quelle: Auth-Test + Identitäts-Check |
| `rewind login outlook` / `rewind login teams` | MS Graph Device-Code-Flow |
| `rewind config init` | Beispiel-Config schreiben |

Quellen lassen sich auf zwei Wegen ausschalten:

- **Dauerhaft**: `enabled: false` im `config.yaml` unter der Quelle.
- **Pro Lauf**: `--exclude <name1,name2>` (oder `--sources <name>` als Whitelist).

## Setup verifizieren — `rewind doctor`

Nachdem du eine Quelle eingerichtet hast, prüf sie mit:

```bash
rewind doctor
```

Pro aktivierter Quelle wird ein leichter Test-Call gemacht — der **dich** auf der Gegenseite identifiziert und sagt, ob Auth + URL + (für Atlassian) `auth_method` zusammenpassen. Beispiel-Output:

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

**Symbolik:**
- `✓` (grün): Quelle ist erreichbar, Auth klappt, optional steht in `[…]` der Identifier (so siehst du, ob du wirklich der bist, für den du dich hältst — wichtig bei mehreren Accounts oder Tippfehlern in `identity`).
- `✗` (rot): Quelle ist enabled, aber Test-Call failed. Die Meldung sagt warum (fehlendes Env, 401, fehlende Projekte, …).
- `─` (grau): Quelle ist via `enabled: false` aus.

Exit-Code ist `1`, wenn mindestens eine Quelle fehlschlägt — gut für CI/Skripte.

**Was die Test-Calls konkret tun:**

| Quelle | Endpoint | Was bestätigt wird |
|---|---|---|
| Jira | `/rest/api/2/myself` | PAT + auth_method, gibt deinen Username zurück |
| Confluence | `/rest/api/user/current` | dito |
| Bitbucket | `/dashboard/pull-requests?limit=1` | PAT + Auth + Sichtbarkeit |
| GitLab | `/api/v4/user` | PAT, gibt User + ID zurück |
| GitHub | `/user` | PAT, gibt Login zurück |
| Git | nur lokal | dass `repos_dir` existiert + Anzahl Repos |
| Jenkins | `/api/json` | API-Token + Server erreichbar |
| Todoist | `/projects` | Token + ob konfigurierte Projekt-Namen existieren |
| Outlook/Teams | `/me` mit silent token | dass MSAL-Cache gültig ist (sonst: erst `rewind login`) |
| LLM (Gemini) | `POST <endpoint>` mit `Respond with exactly OK` | Endpoint, `x-api-key`, `custom_headers`, Body-Format und Modell-Erreichbarkeit |

Faustregel: **immer `rewind doctor` laufen lassen, bevor du das erste Mal `rewind` für gestern startest** — dann findest du Konfig-Probleme auf der Stelle, statt mit einem stillen leeren Bullet-Output dazustehen.

## Setup pro Quelle

Jede Quelle braucht ihre eigenen Credentials. Below: wo du sie herkriegst, was in die Config kommt, was in die `.env`.

### Jira (on-prem / Server / Data Center)

1. Personal Access Token erstellen:
   - Jira aufrufen → oben rechts auf dein Profil → **Profile**.
   - Linke Spalte **Personal Access Tokens** → **Create token**.
   - Name: z. B. `rewind`. Expiry nach Belieben (oder nach Firmenpolicy).
   - Token kopieren (wird nur einmal angezeigt!).
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
     auth_method: bearer        # falls 401 zurückkommt, auf 'basic' umstellen
     in_progress_jql: 'assignee = currentUser() AND project = PROJ AND status = "In Bearbeitung"'
     suggestions_jql: 'project = PROJ AND status = "Ready for Dev" ORDER BY priority DESC'
     # ↑ Wenn `in_progress_jql` 0 Treffer liefert, werden bis zu 10 Tickets aus
     #   `suggestions_jql` als Pickup-Vorschläge ausgegeben. Beide leer = Fallback aus.
   identity:
     atlassian_user: e.fischer  # dein Jira-Username (für JQL-Filter)
   ```
4. Test:
   ```bash
   rewind --no-llm --sources jira --date 2026-05-05
   ```

**Falls Bearer abgelehnt wird** (manche älteren Server / Reverse-Proxy-Setups): `auth_method: basic` setzen. Dann wird der PAT als Passwort in HTTP-Basic-Auth verwendet (mit `identity.jira_user` / `atlassian_user` als Username).

### Confluence (on-prem)

1. PAT erstellen: Confluence → Profil → **Personal Access Tokens** → **Create token**. (Gleiches UI-Pattern wie Jira.)
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
     spaces: []                 # leer = alle; oder z.B. ['DEV', 'TEAM']
     auth_method: bearer
   ```

`identity.atlassian_user` (oder `confluence_user`) wird als CQL-Filter benutzt: `lastModifier = "<user>"`.

### Bitbucket (Server / Data Center, on-prem)

> **Hinweis zum Scope:** Die Bitbucket-Quelle erfasst ausschließlich Pull-Request-Aktivität (öffnen, mergen, Kommentare, Reviews). Direkte Commits ohne PR werden hier **nicht** erfasst — sie kommen über die `git`-Quelle aus deinen lokalen Repos (sofern dort `enabled: true`).

1. PAT erstellen: oben rechts auf Avatar → **Manage account** → **Personal access tokens** → **Create**.
   - Permissions: mindestens **Repository read** und **Project read**. Die Dashboard-Endpoints brauchen kein write.
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
     ignored_authors:                      # PRs von diesen Usern werden komplett rausgefiltert
       - renovate                          # — typischer Bot-Spam fürs Daily ungefiltert ist Lärm
       - dependabot
   identity:
     bitbucket_user: efischer   # oft anders als Jira-Username
   ```

### GitHub (github.com oder Enterprise)

1. PAT erstellen:
   - github.com → Settings → Developer settings → **Personal access tokens** → **Fine-grained tokens** (oder klassisch).
   - Scopes: `repo` (read), `read:user`. Bei feingranular: Read-Only auf den relevanten Repos.
2. `.env`:
   ```
   GITHUB_PAT=<token>
   ```
3. `config.yaml`:
   ```yaml
   github:
     enabled: true
     base_url: https://api.github.com
     # web_url: https://github.com           # auto-derived; nur für Enterprise nötig
     pat_env: GITHUB_PAT
     # username: efischer                    # optional, sonst aus dem Token gezogen
     repos:                                  # optional: Whitelist (sonst alle)
       - owner/repo-a
       - owner/repo-b
     ignored_authors:                        # PRs von diesen Usern rausfiltern
       - renovate[bot]
       - dependabot[bot]
   ```

Für **GitHub Enterprise** beide URLs setzen:
```yaml
base_url: https://github.firma.de/api/v3
web_url: https://github.firma.de
```

### GitLab (on-prem)

1. PAT erstellen: oben rechts → **Edit profile** → linke Spalte **Access Tokens** → **Add new token**.
   - Scopes: **`read_api`** reicht; alternativ **`api`** falls auch Schreibvorgänge gewünscht (für rewind nicht nötig).
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
     ignored_authors:                        # MRs von diesen Usern rausfiltern
       - renovate-bot
       - dependabot
   ```

GitLab identifiziert dich automatisch über das Token (`/api/v4/user`), du musst keinen Username konfigurieren.

### Lokale Git-Repos

Keine Auth nötig. Die Source läuft rekursiv (default `max_depth: 2`) durch ein Verzeichnis und macht in jedem Repo `git log --since --until --all`.

```yaml
git:
  enabled: true
  repos_dir: C:/Users/elias/IdeaProjects
  max_depth: 2
identity:
  git_emails:                  # Author-Emails — leer = alle Commits
    - elias@firma.de
    - elias@privat.de          # mehrere möglich
```

Commits werden als `unpushed: true` markiert, wenn sie lokal aber nicht im Remote sind (über `git log --branches --not --remotes`).

### Jenkins

1. **API-Token** (nicht Passwort!) erstellen:
   - Jenkins → oben rechts auf deinen Namen → **Configure** → **API Token** → **Add new Token** → kopieren.
2. `.env`:
   ```
   JENKINS_TOKEN=<api-token>
   ```
3. `config.yaml`:
   ```yaml
   jenkins:
     enabled: true
     base_url: https://jenkins.firma.de
     username: efischer                      # Jenkins-Username (NICHT Email)
     api_token_env: JENKINS_TOKEN
     jobs:                                   # Whitelist von Job-Pfaden — Pflicht (sonst leer)
       - team-x/api-service                  # Folders mit '/' separieren
       - team-x/web-app
     alt_user_ids: []                        # Falls du andere Jenkins-IDs hattest
     scm_emails:                             # Match auf SCM-Push-Trigger ("Started by GitHub push by …")
       - elias@firma.de
   ```

**Filterung**: Quelle holt nur Builds aus Jobs in der `jobs`-Liste. Pro Build wird gefiltert auf:
- **Triggered by user**: Cause hat deine `username` (oder eine `alt_user_ids`-Variante)
- **Triggered by SCM**: Cause-Beschreibung enthält eine deiner `scm_emails` (für automatische Builds nach Push)

Builds ohne Match werden verworfen — d. h. das Mega-Build-Log eures Master-Jobs landet nicht im Output, nur deine eigenen.

**Auth**: HTTP-Basic mit `username:api_token`.

### Todoist

1. API-Token holen:
   - Todoist Web → Settings → **Integrations** → Tab **Developer** → **API token** kopieren.
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
     paths:                                  # endpoints — defaults zur v1 unified API
       projects: /api/v1/projects
       tasks: /api/v1/tasks
       completed: /api/v1/tasks/completed/by_completion_date
     projects:                               # Whitelist nach Projekt-NAME (case-insensitive)
       - Work                                # leer = alle Projekte
     include_created: false                  # true = auch Tasks zählen, die du gestern angelegt hast
   ```

**Was die Source liefert:**
- **Erledigte Tasks** im Zeitraum (über `paths.completed`).
- Optional: in dem Zeitraum **angelegte** Tasks, falls `include_created: true`.

**API-Endpoints sind konfigurierbar.** Defaults zeigen auf die v1 unified API (`/api/v1/...`). Falls Todoist die wieder ändert oder dein Tenant noch alte Endpoints braucht: `paths` überschreiben — z. B. mit den Legacy-Pfaden `/rest/v2/projects`, `/rest/v2/tasks`, `/sync/v9/completed/get_all`.

Projekte werden über den Namen aufgelöst (kein Project-ID-Hardcoding). Falls ein Projektname nicht gefunden wird, gibt's eine Warnung im Log, der Rest läuft.

### Outlook (Microsoft 365 / Graph API) — ⚠️ braucht Azure-App-Registration

> **Voraussetzung**: Eine Azure-App-Registration muss in eurem Tenant existieren. Die kannst du dir nicht selbst anlegen, falls die IT das in eurem Tenant gesperrt hat (häufig der Fall in Großunternehmen). Sprich mit deiner IT/Azure-Admin-Crew darüber.

**Was die IT konfigurieren muss:**
- Eine **App-Registration** (kein Service Principal nötig) mit:
  - **Name**: `rewind` (oder beliebig)
  - **Supported account types**: Single tenant
  - **Public client** = ja (wichtig: aktiviere unter **Authentication → Allow public client flows: Yes**)
  - **API Permissions** (delegated, *nicht* application):
    - `User.Read`
    - `Calendars.Read`
    - `Mail.Read`
  - **Redirect URI**: nicht nötig für Device-Code-Flow

Du brauchst danach: **Tenant ID** und **Client ID** (= "Application (client) ID"). Beides aus dem Azure Portal kopieren.

**Setup:**

1. `config.yaml`:
   ```yaml
   outlook:
     enabled: true
     tenant_id: <tenant-uuid>
     client_id: <app-client-uuid>
     include_calendar: true
     include_sent_mail: true
   ```
2. Login:
   ```bash
   rewind login outlook
   ```
   Es wird ein Code in der Konsole gedruckt. Im Browser `https://microsoft.com/devicelogin` öffnen, Code eintippen, einloggen, Berechtigungen bestätigen.
3. Token landet in `~/.config/rewind/msal-cache.json` und wird danach automatisch silent refreshed.

**Wenn du keine App-Registration bekommst**: Outlook-Quelle deaktivieren (`enabled: false`) — der Rest des Tools funktioniert unabhängig davon.

### Teams (Microsoft 365 / Graph API) — ⚠️ gleiche Voraussetzung wie Outlook

Teilt sich die App-Registration mit Outlook. Die IT muss zusätzlich diese **Delegated Permissions** zur bestehenden App-Registration hinzufügen:
- `Chat.Read`
- `OnlineMeetings.Read` (optional, nur wenn `include_online_meetings: true`)

**Setup:**

```yaml
teams:
  enabled: true
  tenant_id: <selber-tenant-wie-outlook>
  client_id: <selbe-app-wie-outlook>
  include_chats: true
  include_online_meetings: false   # Teams-Calls die als Kalender-Termin existieren, holt schon Outlook
  max_chats: 50                    # wie viele zuletzt aktiven Chats gescannt werden
```

```bash
rewind login teams
```

(Falls schon Outlook-Login existiert, wird nur das Scope-Set erweitert.)

**Was Teams als Source liefert:**
- Aggregierte Chat-Aktivität: pro Chat ein Eintrag mit *"Chat mit X — N eigene Nachrichten"* (Inhalt der Nachrichten wird **nicht** an das LLM geschickt).
- Optional: Online-Meetings, die du selbst organisiert hast.

**Was Teams *nicht* liefert:**
- **Reine Telefonate / PSTN-Calls** (CDR-Daten). Die liegen hinter `CallRecords.Read.All` (App-Permission, Admin-Consent-pflichtig). Dafür brauchst du Tenant-Admin-Rechte oder einen Service-User mit Application-Auth — ist ohne IT-Support nicht erreichbar.
- Channel-Posts (also Posts in Teams-Kanälen, nicht Chats) — das wäre `ChannelMessage.Read.All`, was ebenfalls heikel ist.

### Gemini (LLM hinter Corp-Proxy)

```yaml
llm:
  endpoint: https://corp-llm-proxy.firma.de/projects/PROJECT/locations/europe-west1/publishers/google/models/gemini-2.5-flash:generateContent
  model: gemini-2.5-flash
  prompt_language: de            # 'en' für englische Bullet-Liste
  custom_headers:                # auth läuft komplett hierüber
    x-api-key: '${GEMINI_API_KEY}'   # ${ENV_VAR} wird zur Laufzeit aus dem Environment substituiert
    # x-tenant-id: team-x        # zusätzliche Header nach Bedarf
```

```
GEMINI_API_KEY=<key>
```

**Auth-Modell**: `rewind` setzt **keinen** Header automatisch — alles läuft über `custom_headers`. Region, Project-ID, Location, Modellname leben in der `endpoint`-URL. Welcher Header für die Auth genutzt wird, entscheidest du: `x-api-key`, `Authorization: Bearer …`, was auch immer dein Proxy verlangt.

**Env-Var-Substitution**: In `custom_headers`-Werten wird `${ENV_VAR_NAME}` zur Laufzeit aus dem Environment ersetzt. Wenn die Variable nicht gesetzt ist → Fehler mit klarem Hinweis. So bleiben Secrets in `.env` und nicht in der Config-Datei.

**Body-Shape**: Standard-Gemini-Format mit getrennter `systemInstruction` (Daily-Style-Anweisungen + Few-Shot-Beispiel) und `contents` (deine Aktivitäten). Falls dein Proxy ein anderes Body-Schema erwartet (z. B. OpenAI-kompatibel statt Gemini), ist `src/llm/gemini.ts` die einzige Stelle, an der das angepasst werden muss.

Verifiziere die Anbindung mit:
```bash
rewind doctor
```
— der LLM-Check macht einen minimalen `Respond with exactly OK`-Call und zeigt dir, ob Endpoint, Auth, Header und Modell zusammenpassen.

### Corp-Proxy & Custom-CA

Alle HTTP-Calls (Atlassian, Bitbucket, GitLab, Graph, Gemini) gehen durch denselben `undici`-Dispatcher. Wenn `HTTPS_PROXY` (oder `HTTP_PROXY`) gesetzt ist, wird automatisch ein `ProxyAgent` verwendet:

```
HTTPS_PROXY=http://proxy.firma.de:8080
NO_PROXY=localhost,127.0.0.1
```

Internes CA-Bundle:
```
NODE_EXTRA_CA_CERTS=C:/path/to/corp-ca-bundle.pem
```

Beides aus der `.env` (oder shell environment) lesbar.

## Architektur

### Tech-Stack

- **Node.js ≥ 20** mit **TypeScript** (ESM)
- **commander** für die CLI
- **undici** für HTTP, mit `ProxyAgent` für `HTTPS_PROXY`
- **simple-git** für lokale Repos
- **@azure/msal-node** für Outlook/Teams-Auth (Public Client + Device-Code-Flow, kein Client-Secret)
- **zod** für Config-Validierung
- **js-yaml** + **dotenv** für Config & Secrets
- **pino** für Logging

### Source-Plugin-Pattern

Jede Quelle ist ein Modul mit einer `fetch…`-Funktion, die eine `Promise<SourceResult>` liefert. Alle Quellen produzieren denselben normalisierten Typ:

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

Die Pipeline in `src/sources/index.ts` ruft alle aktivierten Quellen parallel auf (`Promise.all` mit Per-Source try/catch), sodass eine fehlerhafte Quelle nur ihren eigenen Block leer/mit Fehlermeldung lässt.

### Datei-Übersicht

```
src/
├── index.ts                  CLI (commander) + Pipeline-Orchestrierung
├── config.ts                 zod-validiertes YAML-Loading + Sample-Generator
├── range.ts                  "gestern"-Logik mit Mo→Fr-Sprung
├── http.ts                   undici-Setup + Bearer/Basic-Helpers
├── cache.ts                  JSON-Cache pro Tag in ~/.cache/rewind/
├── log.ts                    pino-pretty
├── types.ts                  Activity, DateRange, SourceResult
├── auth/
│   └── msal.ts               Shared MSAL Public Client (Outlook + Teams)
├── sources/
│   ├── index.ts              Source-Registry, runSources() mit graceful degradation
│   ├── jira.ts               REST v2: /search (JQL) + /issue/{key}/worklog + changelog
│   ├── confluence.ts         REST: /content/search (CQL)
│   ├── bitbucket.ts          REST 1.0: /dashboard/pull-requests + /activities
│   ├── gitlab.ts             REST v4: /events + /merge_requests
│   ├── github.ts             REST v3: /users/<u>/events
│   ├── git.ts                Repo-Walk + simple-git log mit unpushed-Marker
│   ├── jenkins.ts            REST: per-job builds[*] mit Cause-Filter
│   ├── todoist.ts            REST + Sync-API für completed
│   ├── outlook.ts            MSAL + /me/calendarView + /sentitems
│   └── teams.ts              MSAL + /me/chats + Messages-Filter auf eigene
├── llm/
│   ├── gemini.ts             POST mit x-api-key, Standard-Gemini-Body
│   └── prompt.ts             Daily-Style-Prompt (DE/EN), few-shot ticketzentriert
└── format/
    ├── markdown.ts           Roh-Output für --no-llm
    └── condense.ts           Vorbereitung für LLM-Prompt
```

### "Smart yesterday"

Standard ist nicht `today - 1`, sondern:

| Heute | "gestern" |
|---|---|
| Mo | letzter Freitag |
| Sa | Freitag |
| So | Freitag |
| sonst | gestern |

Mit `defaults.weekend_skip: false` schaltest du das aus.

## Daily-Style des LLM-Outputs

Der Prompt (in `src/llm/prompt.ts`) erzwingt einen zweigeteilten Output:

**Abschnitt 1 — "Was ich gestern gemacht habe":**
- 3–6 Bullets, ein Bullet pro Ticket
- Ticket-ID vorn (`PROJ-1234: …`)
- Mehrere Commits / PR-Aktionen / Worklogs zum gleichen Ticket = ein Bullet
- Erste Person, konkrete Verben (implementiert, gefixt, reviewed)
- Routine-Meetings raus, substantielle Termine als eigenes Bullet

**Abschnitt 2 — "Heute":** verschmilzt offene Arbeit + heute anstehende Termine.
- 3–6 Bullets, gruppiert: laufende eigene Arbeit (offene Tickets/PRs) zuerst, dann anstehende Reviews, dann Termine, dann Tasks
- Wenn ein offenes Item dieselbe Ticket-ID wie ein Gestern-Bullet hat, **nicht doppelt nennen** — nur kurz "läuft weiter"
- Termine kompakt: `14:00 Architektur-Sync mit Backend`
- Hinweise auf alte unangetastete Items ("PR liegt seit 5 Tagen") nur wenn auffällig
- Wenn aktuell **nichts in Bearbeitung** ist (`in_progress_jql` liefert 0 Treffer) und ein `suggestions_jql` konfiguriert ist, werden 1–2 konkrete Pickup-Vorschläge als "könnte heute … angehen" formuliert

Beispiel-Output:

```
- PROJ-1234: Caching-Layer für die Suchanfragen implementiert und PR aufgemacht.
- PROJ-1199: Bug im Login-Redirect gefixt, gemerged.
- PROJ-1201: PR von Anna reviewed.
- Architektur-Abstimmung mit Backend-Team zum neuen Event-Bus.

Heute:
- PROJ-1234: Caching-Layer (In Progress) — läuft weiter.
- 2 PRs warten auf mein Review (#42, #44).
- 14:00 Refinement, 15:30 Architektur-Sync.
- Todoist: Spec für Migrationspfad fertigstellen (fällig morgen).
```

### Welche Quellen liefern was?

| Quelle | Aktivitäten (gestern) | Offene Items | Heutiger Kalender |
|---|---|---|---|
| Jira | Issues + Status-Transitions + Worklogs | Tickets mit `assignee = du AND statusCategory != Done` (+ optional Vorschläge via `suggestions_jql`, falls `in_progress_jql` 0 Treffer hat) | – |
| Confluence | Pages + Comments | – | – |
| Bitbucket | PRs + Reviews + Comments | Eigene offene PRs + Review-Inbox | – |
| GitLab | Pushes + MRs + Reviews + Comments | Eigene offene MRs + Review-Inbox | – |
| GitHub | Pushes + PRs + Reviews + Comments | Eigene offene PRs + `review-requested:me` | – |
| Git (lokal) | Commits | – | – |
| Jenkins | Builds | – | – |
| Todoist | Completed Tasks | Offene Tasks (Projekt-Whitelist) | – |
| Outlook | Termine gestern + gesendete Mails | – | Termine heute (ab jetzt) |
| Teams | Chat-Aktivität + Meetings | – | Online-Meetings heute (falls aktiviert) |

**Bot-PRs ausfiltern**: Bitbucket/GitLab/GitHub haben jeweils ein `ignored_authors`-Feld (siehe Setup-Sektionen). Standardmäßig leer; gängige Werte: `renovate`, `dependabot`, `renovate-bot`, `renovate[bot]`. Damit landen Renovate-PRs nicht in der Open-Liste.

## Eigene Quelle hinzufügen

1. `src/sources/<name>.ts` mit einer Funktion, die `Promise<SourceResult>` liefert.
2. Schema in `src/config.ts` ergänzen (zod), Type exportieren.
3. In `src/sources/index.ts` in `SOURCES` und `ALL_SOURCES` registrieren.
4. Eintrag in `SourceName` (`src/types.ts`) und ggf. ein Label in `src/format/markdown.ts:typeLabel`.

## Entwicklung

```bash
npm run dev -- --no-llm --sources git    # ohne Build laufen lassen (tsx)
npm run typecheck
npm test                                  # Unit-Tests für range.ts
npm run build
```

## Out of Scope

- **PSTN-Telefonate** (Teams-Calls als Phone-Records) — braucht Admin-Permissions
- **Browser-Historie**
- **Shell-/IDE-Historie** (kommt evtl. später als optionale Source)
- **HTML-Output / Web-UI**
- **On-prem Exchange via EWS** — Outlook setzt M365/Graph voraus

## Lizenz

Privates Tool, keine Lizenz angegeben.
