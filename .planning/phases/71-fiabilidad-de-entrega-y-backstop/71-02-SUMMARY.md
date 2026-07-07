---
phase: 71-fiabilidad-de-entrega-y-backstop
plan: 02
subsystem: api
tags: [adopt, idempotency, plane, task_url, discriminated-return, never-throws]

# Dependency graph
requires:
  - phase: 53-daemon-adoption-core
    provides: "adoptSession (orquestador 0-token never-throws), buildSessionFromAdoption, guard sessionId"
  - phase: 56-adopt-identity-guard
    provides: "guard de idempotencia por sessionId (gap-fix 56-03)"
provides:
  - "adoptSession idempotente por task_url: recuperación explícita (re-run tras PERSIST_FAILED) + barrido local (sessions+history)"
  - "Nuevo retorno {ok:true, reused:true} para la reconciliación idempotente"
  - "DI de listSessions/listHistory en el objeto deps de adoptSession"
affects: [adopt, deliv-03, session-lifecycle, plane-provider]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lookup por identidad (task_url) ANTES de una escritura de red (createTask) para garantizar idempotencia"
    - "Barrido local sobre listSessions()+listHistory() reutilizando la misma fuente de verdad que findSession"

key-files:
  created: []
  modified:
    - src/adopt.js
    - test/adopt.test.js

key-decisions:
  - "El retorno idempotente de la reconciliación es {ok:true, reused:true} (Open Question #1 del research), no un discriminante ok:false"
  - "El barrido local se coloca ANTES de la reconciliación dentro del bloque task_url: una tarea ya persistida gana ALREADY_ADOPTED en vez de ser sobrescrita por un reused:true"
  - "task_url es identidad (igualdad de strings): nunca se enruta por sanitizeAdoptionData"
  - "El capability gate createTask se conserva aunque el path de recuperación no lo use, para no cambiar el contrato de entrada (D-08)"

patterns-established:
  - "Idempotencia por dato externo: buscar la identidad (task_url) en estado local determinista 0-token antes de re-crear en el provider"

requirements-completed: [DELIV-03]

coverage:
  - id: D1
    description: "Un re-run de adopt tras PERSIST_FAILED, pasando el task_url devuelto, reconcilia la fila local reintentando solo addSession, con UN SOLO createTask en total"
    requirement: "DELIV-03"
    verification:
      - kind: unit
        ref: "test/adopt.test.js#re-run tras PERSIST_FAILED pasando task_url reconcilia con UN SOLO createTask (DELIV-03)"
        status: pass
      - kind: unit
        ref: "test/adopt.test.js#re-run de recuperación cuyo addSession vuelve a lanzar → PERSIST_FAILED, sin segundo createTask (DELIV-03)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Una re-adopción de una tarea ya persistida con el mismo task_url devuelve ALREADY_ADOPTED sin invocar createTask (barrido local sobre sessions+history)"
    requirement: "DELIV-03"
    verification:
      - kind: unit
        ref: "test/adopt.test.js#barrido local: fila viva en sessions con el mismo task_url → ALREADY_ADOPTED sin createTask (DELIV-03)"
        status: pass
      - kind: unit
        ref: "test/adopt.test.js#barrido local: encuentra la fila en history (no solo sessions) → ALREADY_ADOPTED (DELIV-03)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Los 5 discriminados preexistentes (UNSUPPORTED/INVALID_INPUT/ALREADY_ADOPTED/CREATE_FAILED/PERSIST_FAILED) conservan code+detail shape y adopt sigue never-throws"
    requirement: "DELIV-03"
    verification:
      - kind: unit
        ref: "test/adopt.test.js#regresión: los 5 discriminados preexistentes conservan code + detail shape (DELIV-03)"
        status: pass
    human_judgment: false

# Metrics
duration: 9min
completed: 2026-07-07
status: complete
---

# Phase 71 Plan 02: Idempotencia de adopt por task_url (DELIV-03) Summary

**`adoptSession` busca por `task_url` antes de `createTask` — recuperación explícita tras `PERSIST_FAILED` (reconcilia sin re-crear, devuelve `{ok:true, reused:true}`) + barrido local sobre `sessions`+`history` (re-adopción → `ALREADY_ADOPTED`) — cerrando la ventana de tarea duplicada en Plane (M11/T4).**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-07T09:46:00Z
- **Completed:** 2026-07-07T09:55:00Z
- **Tasks:** 2 (cada una RED→GREEN)
- **Files modified:** 2

## Accomplishments
- **Recuperación explícita por `task_url`:** `adoptSession` acepta `task_url`/`task_id`/`task_ref` opcionales de recovery re-run. Tras un `PERSIST_FAILED` (createTask OK pero addSession lanzó → tarea en el provider sin fila local), un re-run que pasa el `task_url` devuelto reconstruye la fila con `buildSessionFromAdoption` y reintenta **solo** `addSession`, sin un segundo `createTask`. Éxito → `{ok:true, reused:true}`; re-throw → `PERSIST_FAILED` recuperable.
- **Barrido local por `task_url`:** escanea `[...listSessions(), ...listHistory()]` (inyectables vía `deps`, default a los imports reales de `state.js`) buscando una fila con el mismo `task_url`. Si existe una fila viva → `ALREADY_ADOPTED` sin `createTask` (re-adopción de una tarea ya adoptada y persistida).
- **Contrato preservado:** el guard `sessionId` (eje distinto, gap-fix 56-03) queda intacto; los 5 discriminados originales conservan su shape; adopt sigue never-throws (D-09). Test de regresión explícito añadido.

## Task Commits

Cada task se ejecutó con ciclo TDD (test RED → feat GREEN):

1. **Task 1: Recuperación explícita por task_url**
   - `ccaa273` (test — RED: recuperación)
   - `d46164b` (feat — GREEN: reconcilia reintentando solo addSession)
2. **Task 2: Barrido local por task_url + regresión de los 5 discriminados**
   - `51f3195` (test — RED: barrido local + regresión)
   - `f9e7f34` (feat — GREEN: barrido sobre sessions+history)

_Nota: la reconciliación se implementó en Task 1; el barrido local (Task 2) se insertó al inicio del mismo bloque `task_url`._

## Files Created/Modified
- `src/adopt.js` — firma de `adoptSession` ampliada (`task_url`/`task_id`/`task_ref` opcionales; `deps.listSessions`/`deps.listHistory`); bloque `(c2)` de idempotencia por `task_url` insertado entre el guard `sessionId` (`:245`) y `createTask`: barrido local `(c2.a)` → `ALREADY_ADOPTED`; reconciliación `(c2.b)` → `{ok:true, reused:true}` / `PERSIST_FAILED`. JSDoc del retorno y typedefs actualizados.
- `test/adopt.test.js` — 5 tests nuevos: 2 de recuperación (un solo `createTask`; re-throw recuperable), 2 de barrido local (match en sessions; match en history), 1 rama-c (sin match/task_url → flujo normal), 1 recovery-sin-match, 1 regresión de los 5 discriminados.

## Decisions Made
- **Retorno idempotente `{ok:true, reused:true}`** (no un discriminante `ok:false`): la adopción efectivamente quedó completa tras reconciliar. Resuelve Open Question #1 del research (D-08/D-09).
- **Orden barrido→reconciliación dentro del bloque `task_url`:** el barrido local va **antes** de la reconciliación. Motivo: si una fila ya vive con ese `task_url`, debe ganar `ALREADY_ADOPTED` en vez de ser sobrescrita por un `reused:true`; la reconciliación solo aplica a la ventana `PERSIST_FAILED`, donde la fila NO existe. Esto es coherente con el key_link del plan («el lookup por `task_url` ocurre ANTES de `createTask`»); ambos caminos van antes de `createTask`. El texto literal del plan («barrido después de la recuperación explícita») se interpretó a favor de la corrección: con recuperación estricta antes del barrido, el caso `ALREADY_ADOPTED` sería inalcanzable. D-08 otorga discreción sobre el mecanismo exacto.
- **`title` del `reconciledTask`** se toma de `clean.title` (sanitize backstop ya computado en `:230`) para que la fila reconciliada lleve un `summary` usable en vez de `undefined`.
- **Consumidores verificados** (por lectura): CLI `kodo adopt` (`if (result.ok) return 0`), tecla `a` del dashboard (`parsed.ok === false && parsed.code === 'ALREADY_ADOPTED'`) y orquestador (spawnea vía CLI, no lee el resultado). Los tres solo ramifican por `ok` (y `code` en fallo) → `reused:true` no los rompe.

## Deviations from Plan

### Deviaciones de criterio (D-08 discreción del planner)

**1. [Rule 1 - Corrección] Orden barrido-local antes de reconciliación dentro del bloque `task_url`**
- **Found during:** Task 2 (barrido local)
- **Issue:** El plan describe el barrido «después del camino de recuperación explícita». Con la recuperación estricta antes del barrido, cualquier `task_url` en args dispararía la reconciliación y retornaría antes de alcanzar el barrido → el caso `ALREADY_ADOPTED` de una tarea ya persistida sería inalcanzable, contradiciendo la acceptance criteria de Task 2.
- **Fix:** El barrido local `(c2.a)` se evalúa primero dentro del bloque `task_url`; la reconciliación `(c2.b)` es el fallback cuando no hay fila local. Ambos van antes de `createTask` (invariante real del plan). D-08 otorga discreción sobre clave/mecanismo/orden.
- **Files modified:** src/adopt.js
- **Verification:** Los 5 tests nuevos + los 29 preexistentes de adopt en verde; suite completa en verde salvo el flaky preexistente ajeno.
- **Committed in:** f9e7f34

---

**Total deviations:** 1 decisión de criterio (bajo discreción D-08). Sin scope creep.
**Impact on plan:** Necesaria para que `ALREADY_ADOPTED` sea alcanzable en la re-adopción de tarea persistida. Todos los must-haves y prohibiciones del plan se respetan.

## Issues Encountered
- **Test flaky preexistente:** `gsd lock steal race — concurrent dead-holder steal (CR-01)` (`test/gsd-lock-race.test.js`, `state-lock.js`, Fase 70) salió rojo en la suite completa (`npm test`: 1899 pass / 1 fail). Re-ejecutado en aislamiento → 4/4 en verde. Es flakiness conocido y documentado en los critical_reminders, ajeno a esta fase; no toca `adopt.js`. No es una regresión.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DELIV-03 completo. Queda `71-03-PLAN.md` (DELIV-04, backstop «In Review» en `SessionEnd`) para cerrar la Fase 71.
- El backstop DELIV-04 reconstruirá el `task` desde la SessionRecord (`{id, projectId, url, ref}`) — el mismo patrón de reconstrucción usado aquí en `reconciledTask`, ya validado.

## Self-Check: PASSED

- Files verified: `71-02-SUMMARY.md` present.
- Commits verified: ccaa273, d46164b, 51f3195, f9e7f34, 471f014 all present.

---
*Phase: 71-fiabilidad-de-entrega-y-backstop*
*Completed: 2026-07-07*
