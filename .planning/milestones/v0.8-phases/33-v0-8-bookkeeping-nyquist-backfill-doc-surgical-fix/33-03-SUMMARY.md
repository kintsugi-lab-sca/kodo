---
phase: 33-v0-8-bookkeeping-nyquist-backfill-doc-surgical-fix
plan: 03
subsystem: session-lifecycle
tags: [markSessionStatus, ndjson, observability, discriminated-union, log-and-continue, verify, stop-hook]

# Dependency graph
requires:
  - phase: 30-sessionrecord-lifecycle
    provides: "markSessionStatus discriminated-union return {ok,from,to} | {ok,reason:'missing-task-id'} (LIFE-02, contrato inmutable)"
provides:
  - "Callsite #1 (verify.js#finalize rama pass) consume el return discriminado y emite log.warn('markSessionStatus.skipped', {reason, session_id}) cuando !result?.ok"
  - "Callsite #2 (stop.js#runStopHook) consume el return simétricamente dentro del try WR-03, cero throws nuevos"
  - "Observabilidad NDJSON del drift 'missing-task-id' en runtime sin cambio E2E (task_id siempre presente hoy)"
affects: [session-lifecycle, observability, v0.8-milestone-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "log+continue simétrico (D-01): ambos callers consumen el union con if (!result?.ok) log.warn(...) y continúan"
    - "optional chaining defensivo (result?.ok / result?.reason) contra mocks que retornan undefined"
    - "event name <componente>.<situacion>: markSessionStatus.skipped (espeja worktree.cleanup.dirty, markSessionStatus.failed)"

key-files:
  created: []
  modified:
    - src/gsd/verify.js
    - src/hooks/stop.js
    - test/gsd-verify-integration.test.js
    - test/stop.test.js

key-decisions:
  - "Forzar ok:false en tests vía session.task_id falsy ('') en vez de mockear markSessionStatus — el early-return de manager.js#371 no toca state.json, evita contaminación y respeta el contrato inmutable"
  - "verify.js: el fix vive DENTRO del try CR-01 existente (no try/catch nuevo) — markSessionStatus es non-throwing por contrato, el warn no dispara el catch"
  - "stop.js: el fix vive DENTRO del try WR-03 existente; catch console.error y bloque sessionEnd intactos"

patterns-established:
  - "Pattern: consumo log+continue del discriminated-union de una función no-throwing — capturar const result, if (!result?.ok) emitir warn observable, continuar"

requirements-completed: []

# Metrics
duration: 18min
completed: 2026-05-25
---

# Phase 33 Plan 03: Bloque C — Surgical Fix markSessionStatus Consumers Summary

**Los 2 callers de `markSessionStatus` (verify.js#finalize rama pass + stop.js#runStopHook) ahora consumen el return discriminado `{ok, reason}` y emiten `log.warn('markSessionStatus.skipped', {reason, session_id})` cuando `!result?.ok`, haciendo observable en NDJSON el drift `missing-task-id` sin cambiar el comportamiento E2E.**

## Performance

- **Duration:** ~18 min
- **Completed:** 2026-05-25
- **Tasks:** 2 (ambas TDD-style: test RED → impl GREEN)
- **Files modified:** 4 (2 src + 2 test)

## Accomplishments
- verify.js#finalize: callsite de la rama pass captura `const result = markSessionStatus(...)` DENTRO del try CR-01 existente y emite warn observable cuando ok===false (cero try/catch nuevos)
- stop.js#runStopHook: callsite captura el return DENTRO del try WR-03 existente, log+continue simétrico (D-01), fail-open preservado
- +4 tests netos (2 por callsite): aseveran el evento NDJSON `markSessionStatus.skipped` con `{reason: 'missing-task-id', session_id}` cuando ok===false, y su ausencia cuando ok===true
- Contrato `markSessionStatus` (manager.js, Phase 30 LIFE-02) intacto — el fix CONSUME, no muta

## Task Commits

Cada tarea fue commiteada atómicamente (TDD: test + impl en un mismo commit por callsite):

1. **Task 1: Consumir return en verify.js:267 + tests** - `4405b0e` (feat)
2. **Task 2: Consumir return en stop.js:197 + tests simétricos** - `838eb42` (feat)

**Plan metadata:** (commit docs final con SUMMARY + STATE + ROADMAP)

## Files Created/Modified
- `src/gsd/verify.js` - rama pass: `const result = markSessionStatus(...)` + `if (!result?.ok) log.warn('markSessionStatus.skipped', {reason, session_id})` dentro del try CR-01
- `src/hooks/stop.js` - runStopHook: mismo patrón dentro del try WR-03; catch console.error + sessionEnd sin tocar
- `test/gsd-verify-integration.test.js` - +2 tests (ok:false emite evento via session.task_id=''; ok:true no-regresión happy path)
- `test/stop.test.js` - +2 tests (nuevo describe con DI runStopHook + HOME override, patrón de stop-state-transition.test.js)

## Decisions Made
- **Forzar ok:false con task_id falsy:** usar `session.task_id = ''` dispara el early-return de `markSessionStatus` (manager.js#371) que retorna `{ok:false, reason:'missing-task-id'}` SIN tocar state.json. Esto evita mockear la función (preservando el contrato inmutable) y no contamina el state.json real del desarrollador.
- **Fix dentro de los try existentes:** CONTEXT.md afirmaba erróneamente que verify.js:267 no estaba envuelto en try/catch; el PLAN lo corrigió. Confirmado leyendo el archivo: el callsite YA vive en un try CR-01 (silencia fs failures, preserva D-17). El fix se añadió ahí mismo, no en un wrapper nuevo. `markSessionStatus` es non-throwing por contrato, así que el `log.warn` no puede disparar el catch.
- **Happy-path stop test usa addSession persistido:** para ok:true, la sesión se persiste vía `addSession` bajo HOME override (tmpdir aislado) para que `markSessionStatus` lea el `from` real y emita `state.transition` — sanity-check de que el happy path sigue funcionando y NO emite `markSessionStatus.skipped`.

## Deviations from Plan

None - plan executed exactly as written. Los 4 archivos del plan fueron los únicos tocados; `src/session/manager.js` NO fue modificado (contrato Phase 30 LIFE-02 inmutable verificado vía `git diff`).

## Issues Encountered
- El reporter de `node --test` usa el prefijo `ℹ` (no `#`) en este entorno, así que el grep `'^# (pass|fail)'` del `<verify>` del plan retorna vacío. Se verificó con `grep -E '^ℹ (tests|pass|fail)'` en su lugar — equivalente funcional, mismo resultado.

## Verification (gate del plan)

Gate ejecutado SOLO sobre los archivos modificados (no la suite global), per el plan:
- `node --test test/gsd-verify-integration.test.js` → **13 pass / 0 fail** (era 11, +2)
- `node --test test/stop.test.js` → **22 pass / 0 fail** (era 20, +2)
- Regresión adyacente (mismo callsite): `node --test test/stop-state-transition.test.js` → **4 pass / 0 fail**

Delta neto: **+4 tests** (dentro del rango +2 a +4 del plan). Cero throws nuevos. `src/session/manager.js` sin modificar.

## Known Stubs
None.

## Next Phase Readiness
- Bloque C cerrado: LIFE-02-FOLLOWUP resuelto. Phase 33 completa (3/3 plans).
- v0.8 milestone listo para audit final / archivado — los ~14 items de tech debt del audit están cerrados (A doc-drift + B nyquist backfill + C surgical fix).

## Self-Check: PASSED

- FOUND: src/gsd/verify.js (contiene `const result = markSessionStatus(` + `markSessionStatus.skipped`)
- FOUND: src/hooks/stop.js (contiene `const result = markSessionStatus(` + `markSessionStatus.skipped`)
- FOUND: commit 4405b0e (Task 1)
- FOUND: commit 838eb42 (Task 2)
- VERIFIED: src/session/manager.js untouched (git diff vacío)

---
*Phase: 33-v0-8-bookkeeping-nyquist-backfill-doc-surgical-fix*
*Completed: 2026-05-25*
