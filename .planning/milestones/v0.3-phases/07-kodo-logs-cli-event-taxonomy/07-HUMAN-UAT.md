---
status: superseded
superseded_by: phase-17-uat-automation
phase: 07-kodo-logs-cli-event-taxonomy
source: [07-VERIFICATION.md]
started: 2026-04-16T13:27:00Z
updated: 2026-05-10T16:09:53Z
---

# Superseded — UATs automatizados en Phase 17

Los 3 UATs humanos pendientes de Phase 7 se convirtieron en integration tests automatizados durante Phase 17 (v0.5 milestone).

## Reemplazos 1:1

- **UAT #1 (live `--follow` tail behaviour)** → `test/logs-follow-integration.test.js`
- **UAT #2 (`session.start` real con campos D-10)** → `test/session-start-event.test.js`
- **UAT #3 (`--session-of` end-to-end)** → `test/session-of-resolver.test.js`

Ver `.planning/phases/17-phase-7-uat-automation/` para spec, decisiones (D-01..D-16) y SUMMARYs por plan.

## Estado original

Los 3 UATs originalmente requerían sesión Plane viva + sesión real Claude Code. Phase 17 reemplaza ambas dependencias con fixtures sintéticos (`state.json` + logs NDJSON pre-poblados) y subprocess spawn de `bin/kodo` / `src/hooks/session-start.js`. Cobertura equivalente sin coste humano recurrente.

## Cambio mecánico vs cambio de contrato

- **UAT #1 (`--follow`)**: el integration test escribe 3 batches NDJSON con `setInterval ~250ms` y verifica orden estricto vía `awaitLine` + SIGINT cleanup en <2s. Ejerce el path real de `src/logs/follow.js` (FOLLOW_INTERVAL_MS=200, watcher fs.watchFile, SIGINT handler).
- **UAT #2 (`session.start`)**: el integration test spawna `src/hooks/session-start.js` con stdin JSON canónico, lee `<HOME>/.kodo/logs/<sid>.ndjson` post-exit y assertea contra `EVENTS.SESSION_START` + las 6 keys D-10. Cambiar el contrato del helper rompe el test (objetivo SC#2).
- **UAT #3 (`--session-of`)**: 4 escenarios E2E (step-1 hit / step-2 hit / not-found / state-points-to-missing-log) con exit codes deterministas observados del CLI actual (D-13 — descubrir, no rediseñar).
