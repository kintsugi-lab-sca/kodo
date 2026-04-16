---
phase: 07-kodo-logs-cli-event-taxonomy
plan: 02
subsystem: logging
tags: [logging, ndjson, event-taxonomy, jsdoc, pure-module, node-stdlib]

# Dependency graph
requires:
  - phase: 06-structured-logger-foundation
    provides: createLogger factory, Logger typedef, redactor pipeline, NDJSON sink
  - phase: 07-kodo-logs-cli-event-taxonomy
    provides: test scaffolding (Plan 01) — logger-events.test.js + transcript-path.test.js
provides:
  - src/logger-events.js — módulo puro con EVENTS frozen (7 tipos) + 7 helpers tipados + resolveTranscriptPath
  - EVENTS constants exportados (SESSION_START, SESSION_END, STATE_TRANSITION, ORCHESTRATOR_REVIEW, GSD_PHASE_RESOLVED, GSD_BOOTSTRAP, PLANE_API_CALL)
  - resolveTranscriptPath(projectPath, sessionId) — pure, deterministic, Claude Code directory convention
  - Contrato D-10 para session.start (6 campos obligatorios con auto-resolve de transcript_path)
affects: [07-logs-reader, 07-session-lookup, 07-cli-logs-command, 08-gsd-label, 09-phase-resolver, 10-orchestrator-verifier]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-module helpers que delegan en logger.info/warn/error (no duplicar redacción ni sink)"
    - "Object.freeze para enums cerrados (estilo LEVELS en logger.js)"
    - "JSDoc @typedef import pattern: import('./logger.js').Logger sin import real"
    - "stdlib-only imports (node:os + node:path) — preserva LOG-12 invariant"

key-files:
  created:
    - src/logger-events.js
  modified: []

key-decisions:
  - "EVENTS es Object.freeze con 7 tipos — lista cerrada por contrato ROADMAP Phase 7"
  - "orchestratorReview usa warn cuando verdict !== 'approved' (espejo a stderr vía logger pretty-print) — alineado con golden fixture line 6"
  - "sessionStart auto-resuelve transcript_path con resolveTranscriptPath si el caller no lo proporciona (D-10 fallback)"
  - "Helpers NO validan campos con throw — el contrato se audita por tests, no por runtime checks (reducimos superficie de error del caller)"
  - "@typedef import('./logger.js').Logger via JSDoc en lugar de import real — preserva stdlib-only imports y LOG-12 indirecto"

patterns-established:
  - "Event helper shape: logger[level](EVENTS.<X>, { event: EVENTS.<X>, ...fields }) — msg y event string son iguales, coherente con el golden fixture"
  - "Pure transform module: fields → record, sin I/O ni side effects — consume el sink del logger ya redactor-seguro"

requirements-completed: [LOG-09, LOG-10]

# Metrics
duration: ~5min
completed: 2026-04-16
---

# Phase 7 Plan 2: logger-events taxonomy Summary

**Módulo puro `src/logger-events.js` con EVENTS frozen (7 tipos de ciclo de vida), 7 helpers tipados que delegan en logger.* y resolveTranscriptPath determinista — cierra el contrato LOG-09 + LOG-10 sin tocar el sink de Fase 6**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-16T10:36:00Z
- **Completed:** 2026-04-16T10:41:35Z
- **Tasks:** 1 / 1
- **Files created:** 1

## Accomplishments

- `src/logger-events.js` (174 líneas) creado con la taxonomía cerrada de 7 eventos
- `EVENTS` const con `Object.freeze` — robusto ante typos, descubrible desde IDE
- `resolveTranscriptPath(projectPath, sessionId)` puro — reproduce la convención `~/.claude/projects/<encoded>/<id>.jsonl` verificada empíricamente
- `sessionStart(logger, fields)` implementa el contrato D-10 con auto-resolve de `transcript_path` cuando el caller no lo proporciona
- `orchestratorReview` selecciona dinámicamente `info`/`warn` según `verdict` — alineado con el golden fixture (blocked → warn)
- Todos los demás 6 helpers (`sessionEnd`, `stateTransition`, `gsdPhaseResolved`, `gsdBootstrap`, `planeApiCall`) siguen el shape uniforme `logger.info(EVENTS.X, { event: EVENTS.X, ...fields })`
- Invariant LOG-12 preservado: `test/check-isolation.test.js` sigue en verde, solo se importa `node:os` + `node:path`

## Task Commits

1. **Task 1: Crear src/logger-events.js** — `a9073f2` (feat)

_Note: Plan 07-02 declara una única task atomic; no aplica TDD RED/GREEN aquí porque los tests que lo validan se crean en Plan 07-01 (wave 0, paralelo)._

## Files Created/Modified

- `src/logger-events.js` — Módulo nuevo; EVENTS const + 7 helpers + resolveTranscriptPath. 174 líneas, 8 named exports + `EVENTS` const, 2 imports de stdlib.

## Decisions Made

- **EVENTS como const Object.freeze (no class, no enum):** consistente con `LEVELS` de `logger.js` (Fase 6). JSDoc `@type {Readonly<{...}>}` da el autocompletado sin añadir build step.
- **Helpers como funciones top-level (no class Emitter):** cada helper es pure transform — construye `ctx` y llama `logger.info/warn/error`. Dejar al logger la responsabilidad del sink NDJSON y la redacción.
- **`@typedef Logger` vía JSDoc import, no `import { Logger }`:** evita crear una dependencia real sobre `logger.js` a nivel de módulo. La forma `import('./logger.js').Logger` es solo tipos y no añade el módulo al grafo. Esto deja `logger-events.js` con solo 2 imports runtime (stdlib) — preserva robustez ante cambios futuros en el invariant de aislamiento.
- **`sessionStart` auto-resuelve `transcript_path` con `??` operator:** mínima fricción para el consumer del hook (Fase 9). Si Claude Code envía el path en el payload, se usa; si no, se deriva.
- **`orchestratorReview` switchea level por verdict:** re-usa el pretty-print stderr mirror del logger para que "blocked" se vea en tiempo real durante la sesión sin añadir otro sink.

## Deviations from Plan

None — plan executed exactly as written. El bloque `<action>` del PLAN.md contiene el código verbatim; no hubo necesidad de auto-fixes (Rule 1/2/3) ni de decisiones arquitectónicas (Rule 4).

## Issues Encountered

Ninguno en el código del plan. Nota contextual: los tests de aceptación del plan (`test/logger-events.test.js`, `test/transcript-path.test.js`) se crean en Plan 07-01 (wave 0, paralelo). Al ejecutarse esta wave 1 en worktree paralelo, esos tests aún no existen en el checkout — pero el módulo creado aquí está diseñado para satisfacer su contrato cuando el orquestador merge las dos waves. Verificación funcional manual hecha:

```text
EVENTS frozen: true
EVENTS values (sorted): ['gsd.bootstrap','gsd.phase.resolved','orchestrator.review','plane.api.call','session.end','session.start','state.transition']
sessionStart (no transcript_path) auto-resuelve a /Users/alex/.claude/projects/-tmp-kodo/sess-1.jsonl ✓
orchestratorReview verdict=blocked → level=warn ✓
orchestratorReview verdict=approved → level=info ✓
```

## User Setup Required

None — módulo puro sin config ni secrets.

## Next Phase Readiness

- **Plan 07-03 (Wave 1) `src/logger.js` formatLine extract:** queda libre para ejecutarse; no depende de 07-02 pero comparte wave.
- **Plan 07-04 (Wave 2) `src/logs/reader.js`:** consumidor potencial de `EVENTS` para validar `--event-type` aunque no es obligatorio.
- **Plan 07-05 (Wave 2) `src/logs/session-lookup.js`:** escanea `session.start` en head-line; el campo `event: 'session.start'` que emite `sessionStart()` es la señal que busca.
- **Plan 07-06 (Wave 3) `src/cli.js` + consumers:** cada hook/consumer va a importar helpers desde aquí (`sessionStart`, `sessionEnd`, `stateTransition`, `planeApiCall`, `gsdBootstrap`, `gsdPhaseResolved`, `orchestratorReview`).
- **Fase 8 label `kodo:gsd`:** el hook `session-start.js` llamará a `sessionStart(log, fields)` con el `plane_task_id` ya resuelto por el label trigger.
- **Fase 9 phase resolver:** emite `gsdPhaseResolved` y `gsdBootstrap` desde los nuevos callsites.
- **Fase 10 verifier gate:** emite `orchestratorReview` al abrir/cerrar el VERIFICATION check.

**Blockers:** ninguno.

## Self-Check: PASSED

- `src/logger-events.js` exists: FOUND
- Commit `a9073f2` exists in git log: FOUND (feat(07-02): add src/logger-events.js — 7-event taxonomy + helpers)
- `node --check src/logger-events.js`: PASS
- `node --test test/check-isolation.test.js`: PASS (4/4)
- `node --test test/logger.test.js test/logger-redaction.test.js`: PASS (12/12)
- Import count check: 2 (node:os + node:path) ✓
- Export count check: 1 EVENTS const + 8 functions ✓
- `grep "from 'node:fs'" src/logger-events.js`: 0 matches ✓
- `grep "from './logger" src/logger-events.js`: 0 matches ✓

---
*Phase: 07-kodo-logs-cli-event-taxonomy*
*Plan: 02*
*Completed: 2026-04-16*
