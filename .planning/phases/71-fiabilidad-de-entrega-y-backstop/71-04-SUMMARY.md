---
phase: 71-fiabilidad-de-entrega-y-backstop
plan: 04
subsystem: cli
tags: [adopt, plane, idempotency, recovery, commander]

# Dependency graph
requires:
  - phase: 71-fiabilidad-de-entrega-y-backstop (71-02)
    provides: "Mecanismo de idempotencia por task_url en adoptSession (bloque (c2), src/adopt.js:271) — correcto en aislamiento pero inalcanzable desde el CLI"
provides:
  - "Flags opcionales --task-url/--task-id en el comando kodo adopt (src/cli.js)"
  - "Reenvío de opts.taskUrl → task_url y opts.taskId → task_id en runAdoptCli (src/cli/adopt.js)"
  - "El gate (c2) de reconciliación de adoptSession es ahora ALCANZABLE end-to-end desde el CLI"
  - "Test end-to-end de recuperación vía runAdoptCli: un re-run tras PERSIST_FAILED produce UN SOLO createTask"
affects: [adopt, dashboard adopt (tecla a), DELIV-03, recuperación PERSIST_FAILED]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reenvío de flags de identidad con idioma spread-when-present (ausentes cuando no se pasan, nunca undefined)"
    - "Test end-to-end que ejercita la ruta real (runAdoptCli con adoptSession real + state inyectado), no el core directo"

key-files:
  created: []
  modified:
    - src/cli.js
    - src/cli/adopt.js
    - test/adopt-cli.test.js

key-decisions:
  - "NO se añade --task-ref: el detalle de PERSIST_FAILED no lo expone, así que el operador no tiene de dónde sacarlo (coherente con el test unitario que reconcilia solo con task_url+task_id)"
  - "task_url/task_id son DATOS DE IDENTIDAD: se reenvían tal cual como campos del objeto JS a adoptSession, nunca a un shell ni por sanitizeAdoptionData"
  - "Cambio puramente aditivo: el guard sessionId, los 5 discriminantes y src/adopt.js quedan intactos (git diff src/adopt.js vacío)"

patterns-established:
  - "Spread-when-present para flags opcionales de identidad: ...(opts.taskUrl ? { task_url: opts.taskUrl } : {})"
  - "Test de alcanzabilidad end-to-end: disparar el core real desde el handler del CLI para cerrar la brecha que un test unitario del core no detecta"

requirements-completed: [DELIV-03]

coverage:
  - id: D1
    description: "El comando kodo adopt acepta flags opcionales --task-url/--task-id y runAdoptCli los reenvía a adoptSession como task_url/task_id (spread-when-present)"
    requirement: "DELIV-03"
    verification:
      - kind: unit
        ref: "test/adopt-cli.test.js#R1: con --task-url/--task-id, el objeto pasado a adoptSessionFn incluye task_url/task_id"
        status: pass
      - kind: unit
        ref: "test/adopt-cli.test.js#R2: SIN los flags, el objeto NO contiene las claves task_url/task_id"
        status: pass
    human_judgment: false
  - id: D2
    description: "Un re-run tras PERSIST_FAILED con --task-url/--task-id, vía runAdoptCli, dispara el gate (c2) y produce UN SOLO createTask; devuelve {ok:true, reused:true}"
    requirement: "DELIV-03"
    verification:
      - kind: e2e
        ref: "test/adopt-cli.test.js#E2E: run inicial → PERSIST_FAILED (createTask 1x); re-run con --task-url/--task-id → reused:true SIN segundo createTask"
        status: pass
    human_judgment: false
  - id: D3
    description: "Un kodo adopt normal SIN los flags de recuperación se comporta exactamente como hoy (rama (d) createTask); los flags son opcionales y aditivos"
    requirement: "DELIV-03"
    verification:
      - kind: unit
        ref: "test/adopt-cli.test.js (suite completa 34 tests) + npm test (1910 pass, 0 fail)"
        status: pass
    human_judgment: false

# Metrics
duration: 3min
completed: 2026-07-07
status: complete
---

# Fase 71 Plan 04: Cableado de la recuperación idempotente de adopt en el CLI Summary

**El comando `kodo adopt` gana flags opcionales `--task-url`/`--task-id` que `runAdoptCli` reenvía a `adoptSession`, haciendo ALCANZABLE end-to-end el gate `(c2)` de reconciliación: un re-run tras `PERSIST_FAILED` reconcilia sin un segundo `createTask` (DELIV-03, cierra el bug M11).**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-07T09:10:48Z
- **Completed:** 2026-07-07T09:13:33Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Flags opcionales de recuperación `--task-url <url>` y `--task-id <id>` en el comando `kodo adopt` (`src/cli.js`)
- `runAdoptCli` reenvía `opts.taskUrl → task_url` y `opts.taskId → task_id` a `adoptSessionFn` con el idioma spread-when-present del propio fichero
- El bloque `(c2)` de idempotencia por `task_url` de `src/adopt.js:271` — antes código muerto en producción — es ahora disparable por un operador real desde el CLI
- Test end-to-end que ejercita la recuperación VÍA `runAdoptCli` (no `adoptSession` directo) con el `adoptSession` real y state inyectado: run inicial → `PERSIST_FAILED` (1 `createTask`), re-run con los flags → `reused:true` con el contador de `createTask` aún en 1
- El hint «recoverable via idempotent re-run» del `PERSIST_FAILED` pasa a ser VERDADERO end-to-end

## Task Commits

Cada task se commiteó atómicamente:

1. **Task 1: Flags `--task-url`/`--task-id` + reenvío en `runAdoptCli`** - `951b966` (feat)
2. **Task 2: Test end-to-end de recuperación vía `runAdoptCli`** - `6d131b4` (test)

_Nota: en este plan la Task 1 (tdd) mezcla implementación y test de reenvío en un solo commit feat, porque el test de reenvío es inseparable del cableado; la Task 2 es puramente un test end-to-end._

## Files Created/Modified
- `src/cli.js` - Dos `.option(...)` nuevas (`--task-url <url>`, `--task-id <id>`) en el comando `adopt` y su paso a `runAdoptCli` como `taskUrl`/`taskId`
- `src/cli/adopt.js` - Typedef `RunAdoptCliOpts` extendido con `taskUrl?`/`taskId?`; reenvío spread-when-present de `task_url`/`task_id` al objeto pasado a `adoptSessionFn`
- `test/adopt-cli.test.js` - Tests R1/R2 (reenvío con y sin flags) + test E2E (recuperación vía el handler, un solo `createTask`)

## Decisions Made
- **NO añadir `--task-ref`:** el detalle de `PERSIST_FAILED` solo expone `task_id`/`task_url`, así que el operador no tiene de dónde sacar un `task_ref`; mantenerse en los dos campos que sí devuelve el discriminante, coherente con el test unitario de `src/adopt.js` que reconcilia solo con `task_url`+`task_id`.
- **`task_url`/`task_id` como identidad:** se reenvían tal cual como campos del objeto JS a `adoptSession` (nunca a un shell/ruta, nunca por `sanitizeAdoptionData`); `adoptSession` los compara por igualdad de strings (T-71-13/T-71-14).
- **Cambio puramente aditivo:** el guard `sessionId` (`adopt.js:257`), los 5 discriminantes y `src/adopt.js` entero quedan intactos (`git diff src/adopt.js` vacío).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. La suite completa (`npm test`) pasó a la primera: 1910 pass, 0 fail, 1 skip preexistente ajeno. El test flaky conocido (`gsd lock steal race`, Fase 70) no salió rojo en esta ejecución.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DELIV-03 (gap 1 de `71-VERIFICATION.md`) cerrado end-to-end: un operador que sufre un `PERSIST_FAILED` puede re-correr `kodo adopt … --task-url <url> --task-id <id>` y reconciliar sin duplicar la tarea en Plane.
- Queda pendiente el plan 71-05 (gap 2 / DELIV-04): el gate de estado no-terminal del backstop para no cerrar issues de GitHub.
- Verificación manual opcional (no bloqueante): reproducir un `PERSIST_FAILED` real contra Plane y confirmar que el re-run con los flags reconcilia.

## Self-Check: PASSED

- Ficheros verificados en disco: `src/cli.js`, `src/cli/adopt.js`, `test/adopt-cli.test.js`, `71-04-SUMMARY.md` — todos presentes.
- Commits verificados en git: `951b966` (Task 1), `6d131b4` (Task 2) — ambos presentes.

---
*Phase: 71-fiabilidad-de-entrega-y-backstop*
*Completed: 2026-07-07*
