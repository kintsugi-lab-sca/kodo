---
phase: 71-fiabilidad-de-entrega-y-backstop
plan: 03
subsystem: infra
tags: [session-lifecycle, hooks, ndjson, logging, plane-provider, capability-gating, fail-open]

# Dependency graph
requires:
  - phase: 58-daemon-lifecycle (SessionEnd hook)
    provides: runSessionEndHook con DI (findSessionFn/loggerFactory/gitFn), guards de idempotencia y performTerminalCleanup
  - phase: 16-gsd-verify
    provides: patrón vivo de transición a review (getTask → addComment → updateTaskState) y resolución de reviewState (Pitfall #1)
  - phase: 40-provider-state
    provides: provider.getTaskState opcional (mapea a in_progress/in_review/done) detectado por typeof
provides:
  - "EVENTS.SESSION_BACKSTOP_REVIEW ('session.backstop.review') — evento NDJSON tipado del cierre automático"
  - "sessionBackstopReview(logger, fields) — helper con whitelist de 4 campos (T-25-02)"
  - "runReviewBackstop({session, input, provider, config, log}) — backstop mecánico de In Review en SessionEnd"
  - "provider/config como deps nuevas de runSessionEndHook con defaults perezosos vía await import"
affects: [phase-72-hyg-04, session-lifecycle, plane-provider, backstop, deliverability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Backstop capability-gated por typeof con guard null-first (GitHub degrada a no-op)"
    - "Fail-open por paso: cada llamada de red en su try/catch + el bloque envuelto en el suyo, sobre el outer never-throws"
    - "Gate de idempotencia sobre el estado VIVO (getTaskState) en vez del session.status local"
    - "TaskItem mínimo reconstruido desde la SessionRecord (0-red, sin getTask)"

key-files:
  created: []
  modified:
    - src/logger-events.js
    - src/hooks/session-end.js
    - test/hooks/session-end.test.js
    - test/logger-events.test.js

key-decisions:
  - "El backstop resuelve provider/config vía await import perezoso: el cleanup mecánico sigue estáticamente desacoplado del registry (hygiene test acotado a imports estáticos)"
  - "El evento NDJSON usa whitelist explícito de 4 campos (sin spread) para blindar el guardrail T-25-02 de fuga de contenido"
  - "reason tratado como enum cerrado y nunca interpolado (V5 ASVS, T-71-12); D-12 fail-open: se transiciona salvo un futuro reason de fallo explícito"

patterns-established:
  - "Backstop mecánico como bloque autónomo tras los guards y antes del cleanup terminal, dejando sitio a HYG-04 (Fase 72)"
  - "Helper NDJSON con from/to como nombres de estado y level info"

requirements-completed: [DELIV-04]

coverage:
  - id: D1
    description: "Evento NDJSON tipado session.backstop.review que emite SOLO {event, session_id, task_id, from, to} y descarta campos extra (guardrail T-25-02)"
    requirement: DELIV-04
    verification:
      - kind: unit
        ref: "test/hooks/session-end.test.js#sessionBackstopReview — emite SOLO {event, session_id, task_id, from, to} y descarta campos extra"
        status: pass
      - kind: unit
        ref: "test/logger-events.test.js#EVENTS is frozen and contains the 31 canonical types"
        status: pass
    human_judgment: false
  - id: D2
    description: "runReviewBackstop transiciona a review + comenta «cierre automático» + emite el evento cuando getTaskState==='in_progress' y la sesión terminó limpia; el cleanup terminal corre después"
    requirement: DELIV-04
    verification:
      - kind: unit
        ref: "test/hooks/session-end.test.js#tarea in_progress + reason limpio → transiciona a review + comenta + emite session.backstop.review; cleanup sigue"
        status: pass
    human_judgment: false
  - id: D3
    description: "No-op idempotente frente al LLM (tarea ya en in_review/done) y capability-gate (provider sin métodos → GitHub degrada)"
    requirement: DELIV-04
    verification:
      - kind: unit
        ref: "test/hooks/session-end.test.js#tarea ya en in_review → no-op idempotente (D-11)"
        status: pass
      - kind: unit
        ref: "test/hooks/session-end.test.js#provider sin getTaskState/updateTaskState (GitHub) → no-op por capability-gate"
        status: pass
    human_judgment: false
  - id: D4
    description: "Fail-open por paso: un fallo de red en getTaskState/updateTaskState NO crashea el hook ni bloquea performTerminalCleanup"
    requirement: DELIV-04
    verification:
      - kind: unit
        ref: "test/hooks/session-end.test.js#updateTaskState que lanza (fallo de red) → el hook NO crashea, warn emitido, cleanup corre (fail-open)"
        status: pass
      - kind: unit
        ref: "test/hooks/session-end.test.js#getTaskState que lanza → fail-open: no transiciona, warn, cleanup corre"
        status: pass
    human_judgment: false
  - id: D5
    description: "reviewState resuelto desde config.providers[provider].states.review (Pitfall #1), no top-level ni default"
    requirement: DELIV-04
    verification:
      - kind: unit
        ref: "test/hooks/session-end.test.js#reviewState resuelto desde config.providers[provider].states.review custom (Pitfall #1)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Backstop end-to-end contra Plane real: matar una sesión kodo sin transición limpia del LLM → tarea pasa a «In Review» + comentario «cierre automático»"
    requirement: DELIV-04
    verification:
      - kind: manual_procedural
        ref: "VALIDATION.md — verificación manual diferida contra Plane real"
        status: unknown
    human_judgment: true
    rationale: "Requiere un provider Plane real y observar la transición de estado en la UI; no automatizable en la suite unitaria (mocks). Diferida en VALIDATION.md."

# Metrics
duration: 25min
completed: 2026-07-07
status: complete
---

# Phase 71 Plan 03: Fiabilidad de Entrega — Backstop de In Review Summary

**Backstop mecánico en SessionEnd que transiciona a «In Review» + comenta «cierre automático» cuando la tarea sigue viva en `in_progress`, capability-gated por `typeof`, idempotente frente al LLM y fail-open por paso, con evento NDJSON tipado `session.backstop.review`.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-07T07:42:00Z (aprox.)
- **Completed:** 2026-07-07T08:07:04Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `runReviewBackstop` cierra la causa raíz T5: la tarea nunca queda colgada en «In Progress» si el LLM no la transiciona antes del cierre real de la sesión. La transición del LLM pasa a ser optimización, no única vía.
- Evento NDJSON tipado `session.backstop.review` con whitelist estricto de 4 campos (`{session_id, task_id, from, to}`) — mitigación explícita del guardrail de fuga de contenido T-25-02.
- Insertado como bloque autónomo tras los guards de idempotencia y ANTES de `performTerminalCleanup`, dejando sitio al movimiento de HYG-04 en Fase 72 (Pitfall #7).
- Cobertura completa: transición feliz, no-op idempotente (ya en review), capability-gate (GitHub), fail-open (getTaskState/updateTaskState lanzan), y resolución de reviewState custom.

## Task Commits

Cada task se commiteó atómicamente:

1. **Task 1: Evento NDJSON tipado del cierre automático** — `89b3cfa` (feat)
2. **Task 2: runReviewBackstop capability-gated + fail-open en SessionEnd** — `ab2b856` (feat)

_Nota TDD: cada task siguió RED→GREEN; el helper y su contract test forman una unidad atómica (Task 1), igual que el backstop y sus escenarios (Task 2)._

## Files Created/Modified
- `src/logger-events.js` — nueva clave `SESSION_BACKSTOP_REVIEW` en la taxonomía congelada `EVENTS` + helper `sessionBackstopReview` (whitelist de 4 campos, pure transform, sin I/O).
- `src/hooks/session-end.js` — función `runReviewBackstop` + bloque autónomo en `runSessionEndHook` con deps nuevas `provider`/`config` (defaults perezosos vía `await import`).
- `test/hooks/session-end.test.js` — contract test del helper + 6 escenarios del backstop (mock de provider con spies/contadores) + hygiene test acotado a imports estáticos.
- `test/logger-events.test.js` — count canónico de `EVENTS` actualizado (30 → 31) y set incluye `session.backstop.review`.

## Decisions Made
- **Resolución perezosa del provider/config vía `await import`:** el cleanup mecánico de SessionEnd sigue estáticamente desacoplado del registry/config (never-throws preservado); solo el backstop los resuelve, y un fallo de resolución degrada a no-op. El hygiene test de Phase 58 se acotó a imports estáticos para reflejar este contrato (antes prohibía el string `initRegistry` en todo el fichero).
- **`input.reason` como enum cerrado (D-12, fail-open):** se transiciona salvo un futuro reason de fallo explícito; nunca se interpola en comandos ni rutas (V5 ASVS, T-71-12). Actualmente ningún reason conocido de Claude Code representa un crash.
- **`provider.addComment` (contrato), NO `createComment`** (nombre del cliente) — confirmado contra `provider.js:223`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Actualizar el hygiene test de source de session-end.js**
- **Found during:** Task 2 (runReviewBackstop)
- **Issue:** El test `session-end.js source hygiene` (Phase 58) asertaba `!src.includes('initRegistry')` sobre TODO el fichero. El backstop, por diseño (D-13, plan), resuelve el provider vía `await import('../providers/registry.js')`, introduciendo el string `initRegistry` en un import dinámico. La aserción global era demasiado estricta para el nuevo contrato.
- **Fix:** Reemplazada la aserción global por una acotada a imports ESTÁTICOS (regex sobre `import { ... } from '.../registry.js'`), preservando la invariante real (el cleanup mecánico no se acopla estáticamente al registry) y permitiendo el import dinámico perezoso del backstop. `!src.includes('PlaneClient')` se mantiene intacto.
- **Files modified:** test/hooks/session-end.test.js
- **Verification:** `node --test test/hooks/session-end.test.js` en verde (12/12).
- **Committed in:** `ab2b856` (Task 2 commit)

**2. [Rule 1 - Bug] Actualizar el count canónico de EVENTS (30 → 31)**
- **Found during:** Task 2 (suite completa)
- **Issue:** El contract test `EVENTS is frozen and contains the 30 canonical types` (test/logger-events.test.js) verifica el set exacto de eventos. La clave nueva `session.backstop.review` (Task 1) lo rompió (esperaba 30).
- **Fix:** Añadido `'session.backstop.review'` en la posición ordenada del array esperado y bumpeado el count a 31 (label y aserción).
- **Files modified:** test/logger-events.test.js
- **Verification:** `npm test` en verde (1907 pass, 0 fail).
- **Committed in:** `ab2b856` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 test-contract fixes por cambio de contrato del plan)
**Impact on plan:** Ambos fixes son consecuencia directa del contrato que el plan pide (evento nuevo + acoplamiento del backstop al provider). Sin scope creep; el código de producción es exactamente el diseñado.

## Issues Encountered
- Ninguno. El único test flaky preexistente conocido (`gsd lock steal race — concurrent dead-holder steal`, Fase 70) no apareció en esta corrida; la suite completa quedó en verde salvo 1 test `skipped` preexistente ajeno a esta fase.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- El backstop deja el bloque autónomo posicionado para que HYG-04 (Fase 72) mueva/reordene el cleanup sin entrelazarse con `session.end`/lock release.
- Verificación manual diferida (VALIDATION.md, D6): backstop end-to-end contra Plane real — matar una sesión kodo sin `/exit` limpio del LLM y confirmar la transición a «In Review» + comentario «cierre automático».

## Self-Check: PASSED

Todos los ficheros creados/modificados existen en disco y ambos commits de task (`89b3cfa`, `ab2b856`) están en el historial. Suite completa `npm test` en verde (1907 pass, 0 fail, 1 skipped preexistente).

---
*Phase: 71-fiabilidad-de-entrega-y-backstop*
*Completed: 2026-07-07*
