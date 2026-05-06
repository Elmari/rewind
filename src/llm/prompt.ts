import type { DateRange, SourceResult } from '../types.js';

export interface PromptResult {
  systemInstruction: string;
  userPrompt: string;
}

export function buildPrompt(
  range: DateRange,
  results: SourceResult[],
  language: 'de' | 'en',
  condensed: string,
): PromptResult {
  if (language === 'de') {
    return {
      systemInstruction: [
        'Du bist ein hilfreicher Assistent für Software-Entwickler.',
        'Deine Aufgabe ist es, aus einer Liste von Aktivitäten eine Daily-Stand-up-Zusammenfassung zu schreiben — so wie man sie im Daily mündlich vorträgt: knapp, präzise, auf den Punkt.',
        '',
        'Regeln:',
        '- 3–6 Bullets, jeder ein einziger kurzer Satz.',
        '- **Strukturiere nach Ticket**, wenn möglich: ein Bullet pro Ticket, mit Ticket-ID vorne (z. B. "PROJ-1234: …"). Aktivitäten ohne Ticket-Bezug danach.',
        '- Fasse mehrere Commits / PR-Aktionen / Worklogs zum selben Ticket zu **einem** Bullet zusammen.',
        '- Erste Person, konkrete Verben (implementiert, gefixt, reviewed, dokumentiert). Keine Floskeln, keine Adjektive, keine Wertungen.',
        '- Keine Detail-Aufzählung von Commit-Messages oder Dateinamen — nur das *Was* auf einer Ebene drüber.',
        '- Termine nur erwähnen, wenn sie inhaltlich relevant waren (z. B. Refinement, Architektur-Abstimmung); Routine-Meetings weglassen.',
        '- Reine Mail-Kommunikation und Confluence-Edits nur, wenn sie das Bild ergänzen.',
        '- Nur die Bullet-Liste ausgeben. Keine Überschrift, keine Einleitung, kein Schlusssatz.',
        '',
        'Beispiel für den gewünschten Stil:',
        '- PROJ-1234: Caching-Layer für die Suchanfragen implementiert und PR aufgemacht.',
        '- PROJ-1199: Bug im Login-Redirect gefixt, gemerged.',
        '- PROJ-1201: PR von Anna reviewed.',
        '- Architektur-Abstimmung mit Backend-Team zum neuen Event-Bus.',
      ].join('\n'),
      userPrompt: [
        `Hier sind die Aktivitäten eines Software-Entwicklers vom ${range.label}:`,
        '',
        '--- Aktivitäten ---',
        condensed,
        '--- Ende ---',
        '',
        'Bitte erstelle jetzt die Daily-Zusammenfassung.',
      ].join('\n'),
    };
  }

  return {
    systemInstruction: [
      'You are a helpful assistant for software developers.',
      'Your task is to produce a daily-stand-up summary from a list of activities — the way one would say it out loud in a daily: concise, precise, to the point.',
      '',
      'Rules:',
      '- 3–6 bullets, each a single short sentence.',
      '- **Group by ticket** where possible: one bullet per ticket, ticket ID first (e.g. "PROJ-1234: …"). Non-ticket items go after.',
      '- Collapse multiple commits / PR actions / worklogs on the same ticket into a single bullet.',
      '- First person, concrete verbs (implemented, fixed, reviewed, documented). No filler, no adjectives, no value judgments.',
      '- Do not enumerate commit messages or file names — describe what was done one level above.',
      '- Mention meetings only if substantive (refinement, architecture alignment); skip routine ones.',
      '- Mail and Confluence edits only if they round out the picture.',
      '- Output the bullet list only. No heading, no preamble, no closing.',
      '',
      'Example of the desired style:',
      '- PROJ-1234: implemented caching for search queries and opened the PR.',
      '- PROJ-1199: fixed the login-redirect bug, merged.',
      '- PROJ-1201: reviewed Anna\'s PR.',
      '- Architecture sync with backend team on the new event bus.',
    ].join('\n'),
    userPrompt: [
      `Here is a software developer's activity from ${range.label}:`,
      '',
      '--- Activity ---',
      condensed,
      '--- End ---',
      '',
      'Please create the daily summary now.',
    ].join('\n'),
  };
}
