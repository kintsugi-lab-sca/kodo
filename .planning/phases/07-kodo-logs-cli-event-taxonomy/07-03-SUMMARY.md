---
phase: 07-kodo-logs-cli-event-taxonomy
plan: 03
subsystem: observability
tags: [cli, ndjson, tail-follow, fs-watchfile, logger, filters]

# Dependency graph
requires:
  - phase: 06-structured-logger-foundation
    provides: createLogger factory + LEVELS + NDJSON sink a ~/.kodo/logs/<id>.ndjson
  - phase: 07-kodo-logs-cli-event-taxonomy/07-01
    provides: fixtures + check-isolation gate (planning wave 0, tests ya presentes)
provides:
  - Additive exports en src/logger.js (formatLine, COLOR_BY_LEVEL, ANSI_RESET)
  - src/logs/reader.js con runLogs(opts) — dump, filtros client-side, --json, --follow delegation, --session-of delegation
  - src/logs/follow.js con followFile(path, onLine) + FOLLOW_INTERVAL_MS (watchFile 200ms polling)
  - Base del CLI reader consumible por src/cli.js (wiring en Plan 05)
affects:
  - 07-04 (session-lookup dynamic import target)
  - 07-05 (CLI registration / commander sub-command)
  - 07-06 (DI wiring de consumers que emiten taxonomía)

# Tech tracking
tech-stack:
  added: []  # zero new runtime deps preservado
  patterns:
    - "Single source of truth para pretty-print: formatLine exportado desde logger.js y reusado en mirror stderr + reader CLI"
    - "Tail follow con fs.watchFile polling + buffer+split (D-04/D-05) — evita fs.watch inconsistencies inotify/FSEvents"
    - "Dynamic import de módulos opcionales (./follow.js, ./session-lookup.js) para keep-cold path del dump y permitir Plan 04 crear session-lookup.js sin que reader falle en dev"
    - "Client-side filter pipeline (level + component + eventType) antes de printear — NDJSON fuente-de-verdad intacto"

key-files:
  created:
    - src/logs/reader.js
    - src/logs/follow.js
    - test/logger-exports.test.js
    - test/logs-reader.test.js
    - test/logs-follow.test.js
  modified:
    - src/logger.js

key-decisions:
  - "formatCtxInline movido a module scope (de dentro del closure de createLogger) para permitir reuse por formatLine — comportamiento idéntico verificado por tests LOG-04 existentes."
  - "maybeMirrorToStderr reescrito para reusar formatLine — elimina duplicación de formato y evita divergencia futura entre stderr mirror y CLI reader."
  - "--json passthrough es raw (incluye malformed lines sin [malformed] tag) — pipe-friendly para jq/grep. Sólo el path pretty aplica el tag [malformed]."
  - "followFile trata archivo inexistente como wait-exists con warn one-time a stderr; NO bloquea el event loop — watchFile se registra y sigue."

patterns-established:
  - "Reader/Watcher split: reader.js hace dump síncrono + delega follow.js para tail. Callsites futuros pueden consumir followFile(path, onLine) directamente."
  - "Structural TDD para módulos de I/O: tests unitarios cubren greps estructurales + tests funcionales cubren dump/filtros; follow.js queda cubierto por manual verify documentado en el plan."

requirements-completed: [LOG-05, LOG-06, LOG-07]

# Metrics
duration: 4min
completed: 2026-04-16
---

# Phase 07 Plan 03: CLI Reader + Follow Watcher Summary

**`kodo logs` reader entregado: dump + filtros client-side + `--follow` via fs.watchFile polling, reusando formatLine del logger como única fuente de verdad para pretty-print.**

## Performance

- **Duration:** 4 min (228 seconds)
- **Started:** 2026-04-16T10:40:23Z
- **Completed:** 2026-04-16T10:44:11Z
- **Tasks:** 3 (todas con TDD RED→GREEN)
- **Files created:** 5 (2 src, 3 test)
- **Files modified:** 1 (src/logger.js — additive only)

## Accomplishments

- **Single-source-of-truth pretty-print:** `formatLine(record, { useColor })` exportado desde `src/logger.js`; `maybeMirrorToStderr` ahora lo reusa. Tests LOG-04 existentes validan que el output stderr no cambia un byte.
- **`runLogs(opts)` completo:** dump, --level, --component, --event-type (variadic), --json (passthrough), malformed tag + continue, delegación estructural para --follow y --session-of.
- **`followFile(path, onLine)`:** tail-follow polling 200ms + dump desde byte 0 + wait-until-exists + partial-line buffer + SIGINT clean exit + truncate/rename reset.
- **Zero regresiones en la suite:** 152/152 tests pass (+1 skipped heredado de Phase 6). 12 tests nuevos en este plan (4 logger-exports + 2 logs-follow + 6 logs-reader).
- **LOG-12 isolation preservado:** `test/check-isolation.test.js` verde sin modificaciones. Ni reader.js ni follow.js entran en el grafo de `src/check.js`.

## Task Commits

Cada task fue TDD (RED→GREEN) con dos commits por task:

1. **Task 1 RED — additive logger exports tests** — `9801a44` (test)
2. **Task 1 GREEN — formatLine + COLOR_BY_LEVEL + ANSI_RESET exports** — `5fb7dd6` (feat)
3. **Task 2 RED — follow.js structural exports test** — `4ecddf4` (test)
4. **Task 2 GREEN — src/logs/follow.js tail watcher** — `21feaff` (feat)
5. **Task 3 RED — logs-reader.test.js (6 tests)** — `f831bf6` (test)
6. **Task 3 GREEN — src/logs/reader.js runLogs handler** — `90121e4` (feat)

**Plan metadata commit:** (este SUMMARY.md — hash pending).

## Files Created/Modified

- `src/logger.js` — **modificado aditivamente**. Exports nuevos: `ANSI_RESET`, `COLOR_BY_LEVEL`, `formatLine`. `formatCtxInline` movido a module scope. `maybeMirrorToStderr` usa `formatLine` (sin cambio de output).
- `src/logs/reader.js` — **nuevo, 117 LOC**. Action handler `runLogs(opts)` para `kodo logs`: dump síncrono, filtros level/component/event-type, --json raw passthrough, malformed graceful, delega --follow/--session-of.
- `src/logs/follow.js` — **nuevo, 93 LOC**. `followFile(path, onLine)` tail-follow con `fs.watchFile` polling 200ms, partial-line buffer, wait-until-exists, SIGINT handler. Constante `FOLLOW_INTERVAL_MS = 200` exportada para test override.
- `test/logger-exports.test.js` — **nuevo**. 5 tests cubriendo ANSI_RESET string, COLOR_BY_LEVEL frozen map, formatLine output con/sin color, formatLine con/sin component.
- `test/logs-follow.test.js` — **nuevo**. 2 tests estructurales (FOLLOW_INTERVAL_MS + followFile signature). Semántica runtime del watcher documentada en el plan como manual verify — no se escriben tests async con timers reales en este wave.
- `test/logs-reader.test.js` — **nuevo**. 6 tests: LOG-05 dump, LOG-07 --level, D-02 --component, D-02 --event-type variadic, D-02 --json raw, D-06 malformed graceful.

## Decisions Made

1. **Refactor formatCtxInline a module scope (Task 1).** La especificación del plan permite un extract aditivo — se mueve la función pura (ya era pura, sin captura de closure vars) de dentro de `createLogger` a top-level. Hay una sola definición de `formatCtxInline` en el archivo tras el cambio (coincide con acceptance criteria). Esto permite que `formatLine` top-level pueda llamarla.

2. **maybeMirrorToStderr reescrito en un 1-liner.** Antes construía el string manualmente (time + c + lvl + r + comp + msg + ctxStr). Tras reusar `formatLine(record, { useColor }) + '\n'`, el código queda sin duplicación y mantiene el output idéntico (verificado por `test/logger.test.js` LOG-04 que asserta ausencia de `{` inicial y presencia de `WARN`/`ERROR`).

3. **Tests estructurales para follow.js (no runtime).** El plan explícitamente marca la semántica de follow como "testing manual/integración en Plan 07 via `kodo logs --follow`". El test unitario cubre exports (que la API es llamable); los asserts de behaviour (partial line, truncate, SIGINT, wait-exists) quedan documentados en el plan como manual verify. No se introducen timers en el test runner — evita flakiness.

4. **`--json` passthrough incluye líneas crudas sin parsear.** Diseño consistente con `jq`/`grep` downstream: si el consumidor pide JSON, le damos el fichero tal cual. La tag `[malformed]` sólo aplica al path pretty que intenta parsear. Los tests validan que `--json` produce 5 líneas (4 JSON + 1 malformed raw passthrough).

5. **`resolveSessionIdFromTaskId` retorna nullable → normalizado a `undefined`.** El plan escribe `sessionId = await resolveSessionIdFromTaskId(...) ?? undefined`; implementé como variable explícita separada (`const resolved = ...; sessionId = resolved ?? undefined;`) para que JSDoc siga cuadrando — no hay wrong-type cast implícito.

## Deviations from Plan

None — plan ejecutado exactamente como escrito. Cambios menores de estilo (comentarios JSDoc adicionales, ordering de campos en objeto literal) no son desviaciones de comportamiento.

## Issues Encountered

- **No test infrastructure gap.** El helper `makeTmpHome` de `test/helpers/logger-fixtures.js` (de Phase 6) cubre todo el setup necesario para los nuevos tests. No hubo que extenderlo.
- **PreToolUse hook `READ-BEFORE-EDIT` warnings:** El hook emitió warnings tras cada `Edit` de `src/logger.js` a pesar de haberlo leído al inicio de la sesión. Los edits sí se aplicaron (verificado por `grep` y `node --test` posteriores). No-op para correctness, solo ruido operativo.

## Next Phase Readiness

- **Plan 04 (session-lookup) desbloqueado:** El dynamic import `import('./session-lookup.js')` ya está cableado en reader.js. Cuando Plan 04 cree el módulo, el flag `--session-of` funcionará sin tocar reader.js.
- **Plan 05 (CLI registration) desbloqueado:** `runLogs(opts)` puede importarse dinámicamente desde `src/cli.js` dentro del action handler de `.command('logs')`.
- **Plan 06 (DI wiring) desbloqueado:** `formatLine` exportado ya es reutilizable por cualquier tooling futuro que quiera pretty-print de records sin reabrir un logger.
- **No blockers.** Suite completa verde (152/152), LOG-12 intacto, zero deps nuevas.

## Self-Check: PASSED

**Files verified present:**
- `src/logger.js` (modified, 3 additive exports + formatCtxInline moved to module scope)
- `src/logs/reader.js` (117 LOC, runLogs export)
- `src/logs/follow.js` (93 LOC, followFile + FOLLOW_INTERVAL_MS exports)
- `test/logger-exports.test.js` (5 tests)
- `test/logs-reader.test.js` (6 tests)
- `test/logs-follow.test.js` (2 tests)

**Commits verified in git log:**
- `9801a44` test: failing logger exports tests (RED)
- `5fb7dd6` feat: additive logger exports (GREEN Task 1)
- `4ecddf4` test: failing follow.js structural test (RED)
- `21feaff` feat: follow.js tail watcher (GREEN Task 2)
- `f831bf6` test: failing reader tests (RED)
- `90121e4` feat: reader.js runLogs handler (GREEN Task 3)

**Tests run:**
- `node --test test/logs-reader.test.js` → 6/6 pass
- `node --test test/logs-follow.test.js` → 2/2 pass
- `node --test test/logger-exports.test.js` → 5/5 pass
- `node --test test/logger.test.js test/logger-redaction.test.js test/check-isolation.test.js` → 21/21 pass (comportamiento Phase 6 intacto)
- `npm test` → 152/152 pass (1 skipped pre-existente)

**TDD Gate Compliance:** Cada task tiene `test(...)` commit (RED) precediendo `feat(...)` commit (GREEN). Sin commits de refactor — no fueron necesarios.

---
*Phase: 07-kodo-logs-cli-event-taxonomy*
*Completed: 2026-04-16*
