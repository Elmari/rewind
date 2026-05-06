# TODO

## Geparkt — brauchen mehr Info / weiteren Schritt

### Bitbucket: dashboard fetch (AUTHOR / REVIEWER) failed
- Fehler: 400 beim Call gegen `/rest/api/1.0/dashboard/pull-requests` für Rollen AUTHOR und REVIEWER.
- Vermutete Ursache: `state: 'ALL'` ist kein gültiger Wert (Bitbucket Server akzeptiert nur `OPEN | MERGED | DECLINED`). Wahrscheinlich auf 2 Calls splitten (`OPEN` + `MERGED`) und Ergebnisse zusammenführen.
- Blockiert durch: aktuell kein `--verbose`-Flag in rewind, daher kein voller Error-Body sichtbar. `LOG_LEVEL=debug rewind …` würde mehr zeigen, ist aber nicht dokumentiert.
- Nächster Schritt: entweder `--verbose`-Flag bauen (mappt auf `LOG_LEVEL=debug`) oder Fix blind anwenden und gegen die Live-API testen.
- Datei: [src/sources/bitbucket.ts:182](src/sources/bitbucket.ts:182)
