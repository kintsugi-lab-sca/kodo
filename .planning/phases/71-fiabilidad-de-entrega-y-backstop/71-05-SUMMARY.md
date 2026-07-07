---
phase: 71-fiabilidad-de-entrega-y-backstop
plan: 05
subsystem: infra
tags: [session-end-hook, backstop, github, plane, provider-state, deliv-04, gap-closure]

# Dependency graph
requires:
  - phase: 71-fiabilidad-de-entrega-y-backstop (71-03)
    provides: runReviewBackstop (backstop mecánico «In Review» en SessionEnd)
provides:
  - "Gate de estado no-terminal en runReviewBackstop: el backstop NUNCA transiciona a un estado terminal/de cierre"
  - "Predicado puro never-throws isTerminalReviewState(reviewState, providerCfg) (provider-agnostic vía states.done + token nativo 'closed')"
  - "GitHub (states.review:'closed') queda no-op — NUNCA cierra el issue; Plane ('In review') transiciona como hoy"
  - "Log estructurado session.backstop.skipped_terminal con SOLO {session_id, task_id, state}"
  - "Corrección de la premisa falsa D-13 en 71-CONTEXT.md y 71-RESEARCH.md"
affects: [72-hygiene-hooks, deliv-04, session-end, github-provider]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gate de estado no-terminal: comparar reviewState contra states.done + token nativo 'closed' antes de transicionar (never-throws)"

key-files:
  created: []
  modified:
    - src/hooks/session-end.js
    - test/hooks/session-end.test.js
    - .planning/phases/71-fiabilidad-de-entrega-y-backstop/71-CONTEXT.md
    - .planning/phases/71-fiabilidad-de-entrega-y-backstop/71-RESEARCH.md

key-decisions:
  - "Fix LOCKED por el operador: «no cerrar nunca» — gate de estado no-terminal (NO el gate verdict.action==='pass', descartado)"
  - "El gate es provider-agnostic vía providerCfg.states.done MÁS el token nativo de cierre 'closed' (modelo binario open/closed de GitHub, cuya config no declara states.done)"
  - "El log de skip usa una línea de log estructurado (session.backstop.skipped_terminal), NO una entrada de la taxonomía congelada EVENTS"

patterns-established:
  - "Gate de estado no-terminal: predicado puro never-throws que decide si un reviewState cierra/termina la tarea, insertado tras resolver reviewState y antes de updateTaskState"

requirements-completed: [DELIV-04]

coverage:
  - id: D1
    description: "runReviewBackstop NO llama updateTaskState/addComment cuando reviewState es terminal ('closed' de GitHub o coincide con states.done); emite log de skip con solo {session_id, task_id, state}"
    requirement: DELIV-04
    verification:
      - kind: unit
        ref: "test/hooks/session-end.test.js#GitHub REAL (3 capacidades) + states.review:\"closed\" → no-op por gate de estado terminal"
        status: pass
      - kind: unit
        ref: "test/hooks/session-end.test.js#states.done captura un review terminal por vía agnóstica"
        status: pass
    human_judgment: false
  - id: D2
    description: "Para Plane ('In review', no-terminal) el backstop transiciona + comenta + emite el evento NDJSON (comportamiento de hoy preservado)"
    requirement: DELIV-04
    verification:
      - kind: unit
        ref: "test/hooks/session-end.test.js#Plane (states.review:\"In review\", no-terminal) → transiciona + comenta + evento"
        status: pass
    human_judgment: false
  - id: D3
    description: "El gate isTerminalReviewState es puro/never-throws sobre config basura (states/done ausentes o no-string)"
    requirement: DELIV-04
    verification:
      - kind: unit
        ref: "test/hooks/session-end.test.js#gate never-throws sobre config basura (states.done no-string)"
        status: pass
    human_judgment: false
  - id: D4
    description: "La documentación (71-CONTEXT.md D-13 y 71-RESEARCH.md) corrige la premisa falsa: GitHub SÍ implementa las 3 capacidades; su no-op deriva del «gate de estado no-terminal»"
    requirement: DELIV-04
    verification:
      - kind: automated
        ref: "grep -q 'gate de estado no-terminal' 71-CONTEXT.md && grep -q 'gate de estado no-terminal' 71-RESEARCH.md"
        status: pass
    human_judgment: false
  - id: D5
    description: "Validación manual diferida: backstop end-to-end contra Plane real (transición a «In Review» + «cierre automático») y confirmar que sobre un repo GitHub el issue NO se cierra"
    verification: []
    human_judgment: true
    rationale: "Requiere un runtime real de Plane y de GitHub con una sesión matada sin /exit limpio; no automatizable en la suite unitaria (VALIDATION.md)"

# Metrics
duration: 5min
completed: 2026-07-07
status: complete
---

# Phase 71 Plan 05: Gate de estado no-terminal en el backstop de SessionEnd Summary

**El backstop mecánico de «In Review» ya NUNCA cierra issues de GitHub: un gate de estado no-terminal (provider-agnostic vía `states.done` + token nativo `'closed'`) impide transicionar a un estado terminal, dejando GitHub en no-op y Plane transicionando como hoy.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-07T09:18:03Z
- **Completed:** 2026-07-07T09:23:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Nuevo predicado puro y never-throws `isTerminalReviewState(reviewState, providerCfg)` en `src/hooks/session-end.js`: decide si un `reviewState` cierra/termina la tarea comparándolo (case-insensitive) con `providerCfg.states.done` y con el token nativo `'closed'`.
- Gate insertado en `runReviewBackstop` justo tras resolver `reviewState` y antes de `updateTaskState`: para GitHub (`states.review:'closed'`, terminal) el backstop es no-op con log de skip — NUNCA cierra el issue; para Plane (`'In review'`, no-terminal) transiciona y comenta como hoy.
- Log estructurado `session.backstop.skipped_terminal` con SOLO `{session_id, task_id, state}` (sin contenido de usuario, guardrail T-71-18).
- Tests reproducen el escenario REAL de GitHub (mock con las 3 capacidades reales, antes mal etiquetado) y el de Plane; re-etiquetado el test de capability-gate genérico.
- Corregida la premisa falsa D-13 en `71-CONTEXT.md` y `71-RESEARCH.md`: GitHub SÍ implementa las 3 capacidades; el no-op deriva del «gate de estado no-terminal».

## Task Commits

Cada task se commiteó atómicamente (Task 1 es TDD → test → feat):

1. **Task 1 (RED): tests del gate de estado no-terminal** - `c93573b` (test)
2. **Task 1 (GREEN): gate de estado no-terminal en runReviewBackstop** - `99f12dd` (feat)
3. **Task 2: corrección de la premisa falsa del no-op de GitHub (D-13)** - `57b4cd4` (docs)

## Files Created/Modified
- `src/hooks/session-end.js` - Predicado `isTerminalReviewState` + gate en `runReviewBackstop` (5b); comentarios de la premisa falsa corregidos.
- `test/hooks/session-end.test.js` - 4 tests nuevos (GitHub real no-op, Plane transiciona, `states.done` agnóstico, never-throws sobre config basura) + re-etiquetado del test de capability-gate genérico.
- `.planning/phases/71-fiabilidad-de-entrega-y-backstop/71-CONTEXT.md` - D-13 reescrito con la causa real del no-op de GitHub.
- `.planning/phases/71-fiabilidad-de-entrega-y-backstop/71-RESEARCH.md` - D-13, Pattern 2, code-example, Dependencies y test-map corregidos.

## Decisions Made
- **Fix LOCKED por el operador («no cerrar nunca» — gate de estado no-terminal):** el backstop solo transiciona cuando el estado resuelto NO es terminal. Se descartó explícitamente la alternativa del gate `verdict.action === 'pass'`.
- **Gate provider-agnostic con fallback pragmático documentado:** igualdad con `providerCfg.states.done` (vía agnóstica) MÁS el token nativo `'closed'`. Justificación en el código: GitHub tiene un modelo binario open/closed sin columna de review no-terminal, su `states.review` por defecto es `'closed'` y su config no declara `states.done`, así que la comparación con `states.done` no lo captura — el token `'closed'` es el mínimo pragmático necesario.
- **Log de skip como línea de log, no evento congelado:** `session.backstop.skipped_terminal` es un `log.info` estructurado, no una entrada de la taxonomía `EVENTS`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Corrección de comentarios de código que sostenían la premisa falsa**
- **Found during:** Task 1 (implementación del gate)
- **Issue:** Dos comentarios en `src/hooks/session-end.js` (el docstring de `runReviewBackstop` y el comentario del capability-gate paso 1) afirmaban que «GitHub degrada a no-op» por el `typeof` gate — la misma premisa falsa que Task 2 corrige en los `.md`. Dejarlos habría perpetuado la premisa incorrecta en el propio código modificado.
- **Fix:** Reescritos ambos comentarios para reflejar que GitHub SÍ implementa las 3 capacidades y que su no-op proviene del gate de estado no-terminal.
- **Files modified:** src/hooks/session-end.js
- **Verification:** `node --test test/hooks/session-end.test.js` en verde; el cambio es de comentarios.
- **Committed in:** `99f12dd` (commit de Task 1 GREEN)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** El auto-fix es coherente con el objetivo de Task 2 (corregir la premisa falsa) — se extendió a los comentarios del código tocado. Sin scope creep.

## Issues Encountered
- **Test flaky preexistente ajeno:** en `npm test` (suite completa) falló de forma intermitente `gsd lock steal race — concurrent dead-holder steal (CR-01)` en `test/gsd-lock-race.test.js` (Fase 70). Confirmado como flaky (pasa 3/3 en aislamiento) y ajeno a este plan — mi cambio solo toca `session-end.js`. No es una regresión.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- El backstop sigue siendo un bloque autónomo tras los guards de idempotencia y antes de `performTerminalCleanup` (deja sitio a HYG-04 de Fase 72).
- Validación manual diferida (VALIDATION.md): backstop end-to-end contra Plane real y confirmación de que sobre GitHub el issue NO se cierra.

## Self-Check: PASSED

- Ficheros verificados en disco: `src/hooks/session-end.js`, `test/hooks/session-end.test.js`, `71-05-SUMMARY.md`, `71-CONTEXT.md`, `71-RESEARCH.md`.
- Commits verificados en el historial: `c93573b` (test), `99f12dd` (feat), `57b4cd4` (docs).

---
*Phase: 71-fiabilidad-de-entrega-y-backstop*
*Completed: 2026-07-07*
