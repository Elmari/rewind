# TODO

## Geparkt — brauchen mehr Info / weiteren Schritt

### Bitbucket: dashboard fetch (AUTHOR / REVIEWER) failed
- Fehler: 400 beim Call gegen `/rest/api/1.0/dashboard/pull-requests` für Rollen AUTHOR und REVIEWER.
- Vermutete Ursache: `state: 'ALL'` ist kein gültiger Wert (Bitbucket Server akzeptiert nur `OPEN | MERGED | DECLINED`). Wahrscheinlich auf 2 Calls splitten (`OPEN` + `MERGED`) und Ergebnisse zusammenführen.
- Status: Ursache bestätigt (API docs). Fix steht noch aus.

## Erledigt

### Confluence: "cannot read properties of undefined (reading version)"
- Fehler: Absturz beim Parsen von Suchergebnissen, wenn `content` oder `version` fehlte.
- Fix: Safety-Checks und Logging hinzugefügt.

### Gemini: Antworten wurden immer kürzer / leer
- Problem: Möglicherweise Prompt-Bloat oder Compliance-Druck durch "knapp"-Instruktion.
- Fix: Truncation von langen Titeln in `condenseForLlm` und verbesserte Fehlerdiagnose in `gemini.ts`.
