import type { CondensedInput } from '../format/condense.js';
import type { DateRange } from '../types.js';

export interface PromptResult {
  systemInstruction: string;
  userPrompt: string;
}

export function buildPrompt(
  range: DateRange,
  language: 'de' | 'en',
  condensed: CondensedInput,
  today: boolean = false,
  glossary: Record<string, string> = {},
): PromptResult {
  const glossaryEntries = Object.entries(glossary);
  const glossaryBlockDe = glossaryEntries.length
    ? [
        '',
        '## Glossar (domänen-spezifische Abkürzungen)',
        'Wenn diese Begriffe in Commit-Subjects, PR-Titeln oder Ticket-Summaries auftauchen, interpretiere sie GENAU so:',
        ...glossaryEntries.map(([k, v]) => `- ${k} = ${v}`),
        'Verwende den ausgeschriebenen Begriff im Output, nicht eine andere Bedeutung erfinden.',
      ].join('\n')
    : '';
  const glossaryBlockEn = glossaryEntries.length
    ? [
        '',
        '## Glossary (domain-specific abbreviations)',
        'When these terms appear in commit subjects, PR titles, or ticket summaries, interpret them EXACTLY as listed:',
        ...glossaryEntries.map(([k, v]) => `- ${k} = ${v}`),
        'Use the expanded term in the output. Do not invent alternate meanings.',
      ].join('\n')
    : '';
  if (language === 'de') {
    const doneLabel = today ? 'Heute (bereits erledigt)' : 'Gestern';
    const planLabel = today ? 'Noch heute' : 'Heute';
    const dataIntro = today
      ? `Hier sind deine Daten von heute (${range.label}):`
      : `Hier sind die Daten vom ${range.label}:`;
    return {
      systemInstruction: [
        'Du bist ein hilfreicher Assistent für Software-Entwickler.',
        'Deine Aufgabe ist es, eine Daily-Stand-up-Zusammenfassung zu schreiben — knapp, präzise, sprechbar.',
        '',
        `Die Ausgabe besteht IMMER aus zwei Abschnitten: "${doneLabel}" und "${planLabel}".`,
        '',
        '## Aktivitäten-Input-Format',
        'Aktivitäten kommen bereits pro Ticket aggregiert. Pro Ticket bekommst du einen Block:',
        '  ### TICKET-KEY — Ticket-Titel',
        '    status: <Jira-Status> (<Resolution>)',
        '    local-commits (N): Liste',
        '    prs-opened (N): Liste',
        '    prs-merged (N): Liste mit "stage: <Label>"  ← das ist die Ziel-Stage',
        '    prs-reviewed-by-me, pr-comments-by-me, status-transitions, worklogs',
        '    facts: hasNewCode=<bool>, mergeOnly=<bool>, stagesReachedToday=[<Labels>]',
        '',
        'WICHTIG — diese Fakten sind verbindlich, du darfst sie NICHT umdeuten:',
        '- `hasNewCode=true` ⇒ es gab echte Implementierung (Commits oder neuer PR). Du darfst "implementiert/gefixt/umgesetzt" sagen.',
        '- `mergeOnly=true` ⇒ es gab im Range NUR einen Merge (z. B. develop→master), KEINE neuen Commits/PRs. NIE "implementiert/umgesetzt/erledigt" sagen — formuliere als reine Stage-Promotion: "in [stage] angekommen", "auf [stage] verschoben", "wartet jetzt in [stage]".',
        '- `stagesReachedToday=[…]` ⇒ Diese Stages sind heute erreicht worden. Verwende die Labels wörtlich.',
        '',
        'COMMITS SIND PFLICHT-INHALT:',
        '- Wenn ein Ticket-Block `local-commits` enthält, MUSST du im Bullet konkret sagen, WAS in den Commits gemacht wurde — fass die Commit-Subjects in 1–3 Worten pro Subject zusammen. Nicht "3 Commits + PR", sondern z. B. "Caching für Suchanfragen + Migrations-Skript + Tests, PR geöffnet".',
        '- Reine Status-Wechsel ("In Bearbeitung genommen") ohne Commit-Inhalt sind ein schwaches Bullet — wenn Commits da sind, sind die Commits der Hauptinhalt, nicht der Status-Wechsel.',
        '- Sektion `local-commits-without-ticket-key (group by repo)`: pro `repo=...`-Eintrag GENAU EIN Bullet im Output. Format: "lokale Commits in <repo>: <3–6 Stichworte aus den Subjects>". NICHT zusammenwerfen ("diverse Commits" ist verboten), NICHT überspringen, sondern projekt-bezogen ausgeben.',
        '',
        `## Regeln "${doneLabel}"`,
        '- 3–6 Bullets, jeder ein einziger kurzer, sprechbarer Satz.',
        '- Ein Bullet pro Ticket, Format: `- TICKET-KEY (kurz-titel): inhalt`',
        '  - `kurz-titel` = max ~5 Worte, knapp paraphrasiert aus dem Ticket-Titel im Input. NICHT den langen Original-Titel wörtlich zitieren — bei langen Titeln zusammenfassen ("Caching-Layer für Suche" statt "Implementierung eines Caching-Layers für die Suchanfragen mit Redis-Backend"). Klammern weglassen, wenn der Titel sehr kurz ist und im Inhalt natürlich vorkommt.',
        '  - `inhalt` = was du heute/gestern dazu gemacht hast (Commits, PR, Stage-Promotion, Review).',
        '- Wenn IM Input weder summary noch ein PR/Commit-Subject vorhanden ist, schreibe nur die ID — das ist der einzige erlaubte Fall ohne Titel.',
        '- Wenn ein Ticket eine Resolution hat (z. B. "Zurückgestellt", "Abgebrochen", "Duplikat"), MUSS sie erwähnt werden.',
        '- Erste Person, konkrete Verben. Keine Floskeln.',
        '',
        '## Jira-Status-Mapping (Sprache)',
        '- "In Prüfung" → "Kann jetzt getestet werden" / "Bereit zum Test".',
        '- "Gelöst" → "In Abnahme" / "Wartet auf finale Abnahme".',
        '- "Geschlossen" → final abgenommen, ggf. PROD.',
        '',
        `## Regeln "${planLabel}"`,
        '- 3–6 Bullets. Reihenfolge: laufende eigene Arbeit, dann Reviews, dann Termine, dann Tasks.',
        `- Wenn ein offenes Item dieselbe Ticket-ID wie ein "${doneLabel}"-Bullet hat → kurz "läuft weiter".`,
        '- Termine kompakt: "14:00 Architektur-Sync".',
        '- Wenn der Vorschläge-Block befüllt ist (nichts läuft), 1–2 konkrete Vorschläge als "könnte heute … angehen" — mit Ticket-ID.',
        '',
        '## Format',
        `- Kein Markdown-Heading. "${planLabel}" wird durch Leerzeile + "${planLabel}:" eingeleitet.`,
        '- Nur die Bullet-Listen. Keine Einleitung, kein Abschluss.',
        '',
        glossaryBlockDe,
        '## Beispiel',
        '(Input: PROJ-1234 summary="Implementierung eines Caching-Layers für Suchanfragen mit Redis-Backend", hasNewCode=true, 3 Commits + pr-opened; PROJ-1199 summary="Login-Redirect-Bug nach SSO-Migration", mergeOnly=true, stages=[ABN])',
        '- PROJ-1234 (Caching-Layer Suche): 3 Commits + PR geöffnet, bereit zum Test.',
        '- PROJ-1199 (Login-Redirect): auf ABN angekommen — reine Stage-Promotion, kein neuer Code.',
        '- PROJ-1201 (User-Service-Refactor): Annas PR reviewed.',
        '',
        `${planLabel}:`,
        '- PROJ-1234: läuft weiter, wartet auf Test-Feedback.',
        '- 2 PRs warten auf mein Review.',
        '- 14:00 Refinement.',
      ].join('\n'),
      userPrompt: [
        dataIntro,
        '',
        `--- ${doneLabel} (Aktivitäten, pro Ticket aggregiert) ---`,
        condensed.hasActivities ? condensed.activities : '(keine)',
        '--- Ende Aktivitäten ---',
        '',
        '--- Offene Items ---',
        condensed.hasOpen ? condensed.openItems : '(keine)',
        '--- Ende Offen ---',
        '',
        '--- Vorschläge (Pickup-Kandidaten, falls nichts läuft) ---',
        condensed.hasSuggestions ? condensed.suggestions : '(keine)',
        '--- Ende Vorschläge ---',
        '',
        `--- ${today ? 'Restlicher Tageskalender' : 'Heutiger Kalender'} ---`,
        condensed.hasAgenda ? condensed.agenda : '(keine)',
        '--- Ende Kalender ---',
        '',
        'Bitte erstelle jetzt die zweigeteilte Daily-Zusammenfassung. Halte dich strikt an `hasNewCode` und `mergeOnly`.',
      ].join('\n'),
    };
  }

  const doneLabelEn = today ? 'Today (already done)' : 'Yesterday';
  const planLabelEn = today ? 'Rest of today' : 'Today';
  const dataIntroEn = today
    ? `Here is your data from today (${range.label}):`
    : `Here is the data from ${range.label}:`;

  return {
    systemInstruction: [
      'You are a helpful assistant for software developers.',
      'Produce a daily-stand-up summary — concise, precise, speakable.',
      '',
      `Output has two sections: "${doneLabelEn}" and "${planLabelEn}".`,
      '',
      '## Activities input format',
      'Activities are pre-aggregated per ticket. Each ticket block contains:',
      '  ### TICKET-KEY — Ticket title',
      '    status, local-commits, prs-opened, prs-merged (with stage label),',
      '    prs-reviewed-by-me, pr-comments-by-me, status-transitions, worklogs',
      '    facts: hasNewCode=<bool>, mergeOnly=<bool>, stagesReachedToday=[…]',
      '',
      'IMPORTANT — these facts are authoritative, do NOT reinterpret them:',
      '- `hasNewCode=true` ⇒ real implementation occurred (commits or new PR). You may say "implemented/fixed/built".',
      '- `mergeOnly=true` ⇒ ONLY a merge happened in range (e.g., develop→master), NO new commits/PRs. NEVER say "implemented/done" — phrase as stage promotion: "promoted to [stage]", "now on [stage]".',
      '- `stagesReachedToday=[…]` ⇒ today\'s reached stages. Use these labels verbatim.',
      '',
      'COMMITS ARE MANDATORY CONTENT:',
      '- If a ticket block has `local-commits`, you MUST summarize WHAT the commits did (1-3 words per subject). Not "3 commits + PR", but e.g. "search-query caching + migration script + tests, PR opened".',
      '- A bare status change ("In progress") without commit substance is a weak bullet — if commits exist, the commits are the main content, not the status change.',
      '- Section `local-commits-without-ticket-key (group by repo)`: emit EXACTLY ONE bullet per `repo=...` entry. Format: "local commits in <repo>: <3–6 keywords from subjects>". Do NOT collapse multiple repos ("various commits" is forbidden), do NOT skip — produce one project-scoped bullet per repo.',
      '',
      `## ${doneLabelEn} rules`,
      '- 3–6 bullets, one short speakable sentence each.',
      '- Format: `- TICKET-KEY (short-title): content`',
      '  - `short-title` = max ~5 words, paraphrased from the input summary. Do NOT quote long original titles verbatim ("Caching layer for search" not "Implementing a Redis-backed caching layer for search queries"). Drop the parens if the title is very short and naturally part of the content.',
      '  - Only allowed without a title if input has no summary AND no PR/commit subject.',
      '- First person, concrete verbs.',
      '',
      `## ${planLabelEn} rules`,
      '- 3–6 bullets. Order: ongoing own work, reviews, meetings, tasks.',
      `- Open item with same ticket-ID as a "${doneLabelEn}" bullet → short "ongoing".`,
      '- Compact meeting format: "14:00 architecture sync".',
      '- If suggestions block is populated, 1–2 picks as "could tackle … today" with ticket ID.',
      '',
      '## Format',
      `- No markdown headings. "${planLabelEn}" starts with a blank line and "${planLabelEn}:".`,
      '- Only bullets.',
      '',
      glossaryBlockEn,
      '## Example',
      '(Input: PROJ-1234 summary="Implementing Redis-backed caching for search", hasNewCode=true 3 commits+PR; PROJ-1199 summary="Login-redirect bug after SSO migration", mergeOnly=true stages=[ABN])',
      '- PROJ-1234 (Search caching): 3 commits + PR opened, ready for test.',
      '- PROJ-1199 (Login-redirect): promoted to ABN — stage promotion only, no new code.',
      '- PROJ-1201 (User-service refactor): reviewed Anna\'s PR.',
      '',
      `${planLabelEn}:`,
      '- PROJ-1234: ongoing, awaiting test feedback.',
      '- 2 PRs awaiting my review.',
      '- 14:00 refinement.',
    ].join('\n'),
    userPrompt: [
      dataIntroEn,
      '',
      `--- ${doneLabelEn} (per-ticket aggregated activities) ---`,
      condensed.hasActivities ? condensed.activities : '(none)',
      '--- End activities ---',
      '',
      '--- Open items ---',
      condensed.hasOpen ? condensed.openItems : '(none)',
      '--- End open ---',
      '',
      '--- Suggestions (pickup candidates if nothing in progress) ---',
      condensed.hasSuggestions ? condensed.suggestions : '(none)',
      '--- End suggestions ---',
      '',
      `--- ${today ? 'Rest-of-day calendar' : "Today's calendar"} ---`,
      condensed.hasAgenda ? condensed.agenda : '(none)',
      '--- End calendar ---',
      '',
      'Produce the two-section daily summary now. Strictly obey `hasNewCode` and `mergeOnly`.',
    ].join('\n'),
  };
}
