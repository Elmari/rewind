# TODO

## Erledigt

### Bitbucket: dashboard fetch (AUTHOR / REVIEWER) 400
- Fehler: `state: 'ALL'` ist kein gültiger Wert (Bitbucket Server akzeptiert nur `OPEN | MERGED | DECLINED`).
- Fix: Dashboard-Call auf mehrere States gesplittet (commit 12f255d).

### Confluence: "cannot read properties of undefined (reading version)"
- Fehler: Absturz beim Parsen von Suchergebnissen, wenn `content` oder `version` fehlte.
- Fix: Safety-Checks und Logging hinzugefügt.

### Gemini: Antworten wurden immer kürzer / leer
- Problem: Möglicherweise Prompt-Bloat oder Compliance-Druck durch "knapp"-Instruktion.
- Fix: Truncation von langen Titeln in `condenseForLlm` und verbesserte Fehlerdiagnose in `gemini.ts`.
