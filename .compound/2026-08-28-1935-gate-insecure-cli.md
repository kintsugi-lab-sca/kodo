---
fecha: 2026-08-28
proyecto: kodo
slug: gate-insecure-cli
---

## Resumen
`kodo start --insecure` pasa a exigir dos señales de canales distintos (flag CLI + `KODO_ALLOW_INSECURE=1`), con exit 1 accionable si falta la env var y warning visible si está.
La lógica quedó en `src/cli/insecure-gate.js` como función pura, con 8 tests nuevos y suite completa verde (3384 pass / 0 fail).

## Reto
Decidir la capa del gate: ponerlo en `startServer()` habría roto los 7 ficheros de test que llaman `startServer({insecure:true})` directamente; ponerlo en la capa CLI resuelve el riesgo real (el flag) sin tocar nada más, pero deja sin cubrir a un consumidor programático futuro. Queda abierto si `KODO_DEV=1` — el otro bypass del mismo gate — merece el mismo blindaje.

## Propuesta de skill
Una skill `cli-flag-gate` que, dado un flag peligroso de un CLI commander, genere el módulo puro `check*/enforce*`, el enganche de una línea, el par de tests (unit puro + spawnSync sobre el exit code) y el bloque de README — el andamiaje fue idéntico en las cuatro piezas y es lo que más tiempo consumió.
