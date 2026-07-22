---
phase: 76-convergencia-del-conteo-pending
plan: 01
subsystem: api
tags: [pending, ttl-cache, freshness, fail-open, leaf-module, orchestrator]

# Dependency graph
requires:
  - phase: 40-provider-state
    provides: factory+DI+TTL+fail-open resolver pattern (src/server/provider-state.js)
  - phase: 74-handoff
    provides: zero-import leaf precedent (src/session/handoff.js) + check-isolation guard
provides:
  - "src/tasks/pending.js — single source of truth for the pending read lane (fetch + TTL cache + discriminated freshness)"
  - "fetchFreshPending(fn) — the ONE convergence fetch point (ORCH-05), propagates throw raw for check.js (D-07)"
  - "createPendingResolver({listPendingTasksFn, ttlMs, now}) — never-throws resolver, labels staleness (ORCH-06)"
  - "buildPendingStatusFields({tasks, fetched_at, stale}) — /status payload shaper, pending_count from same tasks"
  - "check-isolation guard extended: pending.js blindado como hoja de cero imports (D-02)"
affects: [76-02, server.js /status wiring, check.js checkPendingTasks]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zero-import leaf module shared by server.js and check.js (convergence without graph contamination)"
    - "Discriminated freshness: {tasks, fetched_at, stale} — failure labeled, never collapsed to a single error value"
    - "Frozen fetched_at on failure — stale data never carries a fresh-looking timestamp (Pitfall 3)"

key-files:
  created:
    - src/tasks/pending.js
    - test/tasks/pending.test.js
  modified:
    - test/check-isolation.test.js

key-decisions:
  - "src/tasks/ (neutral) elegido sobre src/server/ para no sugerir acoplamiento al server que check.js no tiene (A3)"
  - "fetchFreshPending se exporta aparte del resolver: check.js lo consume crudo (throw propaga, D-07); el resolver lo envuelve (never-throws, D-04)"
  - "In-flight dedup del analog omitido (Claude's Discretion): pending es slot único, no keyed; no aporta sobre un fetch de lista completa"
  - "El módulo NO loguea: cero imports, sin console.*; el caller (Plan 02) inspecciona stale y emite el warn (D-02 / Pitfall 1)"

patterns-established:
  - "Hoja de cero imports como punto de convergencia: dos consumidores (server/check) comparten un módulo sin arrastrar deps al grafo de kodo check (LOG-12)"
  - "Frescura discriminada con fetched_at congelado en fallo: last-known-good etiquetado stale sin falsear la antigüedad"

requirements-completed: [ORCH-05, ORCH-06]

coverage:
  - id: D1
    description: "fetchFreshPending es el punto único de fetch (ORCH-05) y propaga el throw sin capturarlo (D-07)"
    requirement: "ORCH-05"
    verification:
      - kind: unit
        ref: "test/tasks/pending.test.js#propagates the throw (raw mode for check.js, D-07)"
        status: pass
      - kind: unit
        ref: "test/tasks/pending.test.js#returns the list verbatim when listPendingTasksFn resolves"
        status: pass
    human_judgment: false
  - id: D2
    description: "createPendingResolver sirve caché dentro de TTL sin re-fetch y re-fetcha al expirar"
    requirement: "ORCH-05"
    verification:
      - kind: unit
        ref: "test/tasks/pending.test.js#TTL fresh hit: two resolves within ttlMs → single fetch, second is {stale:false}"
        status: pass
      - kind: unit
        ref: "test/tasks/pending.test.js#TTL expired: a resolve after ttlMs re-fetches"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fallo con caché previa → last-known-good etiquetado stale, fetched_at congelado al último éxito (ORCH-06, Pitfall 3)"
    requirement: "ORCH-06"
    verification:
      - kind: unit
        ref: "test/tasks/pending.test.js#catch with prior cache: fail → last-known-good LABELED stale, fetched_at FROZEN (Pitfall 3)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Cold-start con provider caído → {tasks:[], fetched_at:null, stale:true}; nunca [] presentado como fresco (ORCH-06, D-04)"
    requirement: "ORCH-06"
    verification:
      - kind: unit
        ref: "test/tasks/pending.test.js#cold-start down: never succeeded → {tasks:[], fetched_at:null, stale:true}"
        status: pass
    human_judgment: false
  - id: D5
    description: "buildPendingStatusFields deriva pending y pending_count del mismo tasks en ambas ramas (Pitfall 4, D-05)"
    verification:
      - kind: unit
        ref: "test/tasks/pending.test.js#fresh branch: maps tasks and derives pending_count === pending.length"
        status: pass
      - kind: unit
        ref: "test/tasks/pending.test.js#stale/cold branch: empty tasks → {pending:[], pending_count:0, pending_stale:true, pending_fetched_at:null}"
        status: pass
    human_judgment: false
  - id: D6
    description: "src/tasks/pending.js es hoja de cero imports, blindado por el guard extendido en check-isolation (D-02, D-09)"
    verification:
      - kind: unit
        ref: "test/check-isolation.test.js#src/tasks/pending.js exists and has zero imports"
        status: pass
    human_judgment: false

# Metrics
duration: 9min
completed: 2026-07-17
status: complete
---

# Phase 76 Plan 01: Convergencia del conteo pending — hoja de lectura Summary

**`src/tasks/pending.js`: hoja de cero imports que unifica el carril de lectura de `pending` (fetch + caché TTL + frescura discriminada), con fallo etiquetado `stale` y `fetched_at` congelado al último éxito — el productor del que server.js y check.js convergerán en el Plan 02.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-17T12:52:00Z
- **Completed:** 2026-07-17
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `src/tasks/pending.js` creado como fuente única del carril pending, hoja de CERO imports (mismo contrato que `handoff.js` / `logger-noop.js`).
- Política de frescura discriminada que cumple ORCH-06: fallo con caché → last-known-good etiquetado `stale:true` con `fetched_at` congelado (nunca `now()`); cold-start caído → `{tasks:[], fetched_at:null, stale:true}` (nunca `[]` presentado como fresco).
- `fetchFreshPending` es el punto único de convergencia (ORCH-05) y propaga el throw crudo para que check.js conserve su red-line byte-idéntica (D-07).
- Guard de aislamiento extendido: `test/check-isolation.test.js` blinda pending.js como hoja, evitando que un import futuro (p. ej. logger-events) rompa LOG-12 en silencio.

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1: Test scaffold RED** — `22b5bad` (test) — 8 casos, falla por ausencia del módulo (RED verificado)
2. **Task 2: Implementar src/tasks/pending.js (GREEN)** — `b373262` (feat) — 3 funciones puras, 8/8 verde, cero imports
3. **Task 3: Extender check-isolation guard** — `ff11a21` (test) — bloque D-02, 9/9 verde, preexistentes intactos

_Note: TDD plan — RED (test) precede a GREEN (feat)._

## Files Created/Modified
- `src/tasks/pending.js` — Hoja de cero imports: `fetchFreshPending`, `createPendingResolver`, `buildPendingStatusFields`.
- `test/tasks/pending.test.js` — Unit completo (8 casos): fetch propaga/resuelve; resolver TTL fresh/expired/stale-labeled/cold-start; shaper fresh/stale.
- `test/check-isolation.test.js` — Nuevo bloque `describe('D-02: pending contract isolation ...')` con `extractImports` reutilizado.

## Decisions Made
- **Ubicación `src/tasks/` (neutral):** elegida sobre `src/server/` para no sugerir acoplamiento al server que check.js no tiene (A3). Ambas pasan check-isolation si son hoja.
- **`fetchFreshPending` exportado aparte:** check.js lo consume crudo (throw propaga, D-07); el resolver lo envuelve (never-throws, D-04). Un solo punto de fetch para ambos modos.
- **In-flight dedup omitido:** el analog (provider-state.js) usa un `Map` de promesas por task_id; pending es un slot único de lista completa, así que el dedup era Claude's Discretion y no se replicó (simplicidad).
- **TTL por parámetro:** el literal `30s` NO vive en el módulo (`ttlMs` entra por DI, D-03); el módulo tampoco loguea (D-02 / Pitfall 1).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. Cero dependencias npm nuevas (constraint LOCKED).

## Next Phase Readiness
- Plan 02 puede converger: server.js (`/status` + wiring en `startServer`) y check.js (`checkPendingTasks`) importarán desde `src/tasks/pending.js`.
- El guard de check-isolation ya está en su sitio; cuando el Plan 02 haga que check.js importe `fetchFreshPending`, el módulo aparecerá en el grafo como hoja (convergencia probada) sin romper LOG-12.
- Sin blockers.

## Self-Check: PASSED

---
*Phase: 76-convergencia-del-conteo-pending*
*Completed: 2026-07-17*
