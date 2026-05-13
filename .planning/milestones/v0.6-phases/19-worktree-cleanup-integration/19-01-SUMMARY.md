---
phase: 19-worktree-cleanup-integration
plan: 01
subsystem: observability
tags:
  - logger-events
  - ndjson
  - worktree-cleanup
  - phase-19
  - D-10
requires:
  - src/logger.js (createLogger, level routing)
  - src/logger-events.js (existing EVENTS frozen object + 8 helpers as analogs)
provides:
  - "EVENTS.WORKTREE_CLEANUP_OK = 'worktree.cleanup.ok'"
  - "EVENTS.WORKTREE_CLEANUP_DIRTY = 'worktree.cleanup.dirty'"
  - "EVENTS.WORKTREE_CLEANUP_ERROR = 'worktree.cleanup.error'"
  - "worktreeCleanupOk(logger, {session_id, worktree_path, branch_deleted}) → info"
  - "worktreeCleanupDirty(logger, {session_id, worktree_path, moved_to}) → warn"
  - "worktreeCleanupError(logger, {session_id, worktree_path, phase, reason}) → error"
affects:
  - test/logger-events.test.js (inventory test → 11 strings, +3 contract tests)
tech-stack:
  added: []
  patterns:
    - "Mirror verbatim pattern from sessionEnd / orchestratorReview / planeApiCallFailed"
    - "logger[level](EVENT, { event: EVENT, ...fields }) — event-name + level invariant"
key-files:
  created: []
  modified:
    - src/logger-events.js
    - test/logger-events.test.js
decisions:
  - "D-10 mapped to 3 level-typed helpers (info/warn/error) — no .ok/.dirty/.error overloading"
  - "Helpers stay pure transforms (campos → record); no I/O, no git ops — Plan 02 wires them in stop.js"
  - "LOG-12 invariant preserved: src/check.js + src/cli/format.js have 0 imports of logger-events"
metrics:
  duration: "~3m"
  completed: "2026-05-12T11:21:51Z"
  tests_added: 4
  tests_total_after: 15
  global_suite: "550 tests / 549 pass + 1 skip pre-existing"
requirements:
  - WT-04 (partial — helpers ready; stop.js wiring in Plan 02)
---

# Phase 19 Plan 01: Logger Events Scaffolding for Worktree Cleanup — Summary

One-liner: Phase 19 D-10 cierra el scaffolding NDJSON del cleanup del worktree con 3 helpers tipados (`worktreeCleanupOk`/`Dirty`/`Error`) y 3 strings nuevos en `EVENTS`, espejando verbatim el patrón de `sessionEnd` (info), `orchestratorReview` (warn) y `planeApiCallFailed` (error); Plan 02 los consume desde `stop.js` sin redefinir.

## Decisions Applied

- **D-10 — Eventos NDJSON del cleanup**: tres eventos cerrados en la taxonomía con level mapping fijo: `.ok → info` (espejo de `sessionEnd`), `.dirty → warn` (espejo de `orchestratorReview` blocked), `.error → error` (espejo de `planeApiCallFailed`). El level vive dentro del helper, no se decide en el callsite.
- **Pure transform invariant preservado**: `src/logger-events.js` sigue sin abrir archivos ni ejecutar I/O. Los 3 helpers nuevos sólo construyen el record y delegan en `logger.info/warn/error`.
- **`Object.freeze` preservado**: el `EVENTS` extendido sigue siendo inmutable y enumerado en el JSDoc `@type`.

## Helper Shapes (exact)

```javascript
worktreeCleanupOk(logger, {
  session_id: string,
  worktree_path: string,
  branch_deleted: boolean,
}) // → logger.info, event='worktree.cleanup.ok'

worktreeCleanupDirty(logger, {
  session_id: string,
  worktree_path: string,
  moved_to: string,
}) // → logger.warn, event='worktree.cleanup.dirty'

worktreeCleanupError(logger, {
  session_id: string,
  worktree_path: string,
  phase: 'status' | 'remove' | 'move' | 'branch' | 'prune',
  reason: string,
}) // → logger.error, event='worktree.cleanup.error'
```

## Tasks Executed

| # | Task | RED commit | GREEN commit |
| - | ---- | ---------- | ------------ |
| 1 | Extender `EVENTS` con 3 strings worktree.cleanup.* + actualizar inventory test a 11 | `485c72f` | `63e52a6` |
| 2 | Añadir 3 helpers tipados + tests de contrato (level + shape) | `1ebcffd` | `d172118` |

Both tasks followed strict TDD: RED first (test fails by design), then GREEN with the minimal implementation needed to flip it.

## Tests Added

1. `EVENTS is frozen and contains the 11 canonical types` — inventory updated from 8 to 11, ordered alphabetically.
2. `worktreeCleanupOk emits event=worktree.cleanup.ok at info level` — asserts `level==='info'`, event string, and 3 payload fields.
3. `worktreeCleanupDirty emits event=worktree.cleanup.dirty at warn level with moved_to` — asserts `level==='warn'`, event string, and 3 payload fields.
4. `worktreeCleanupError emits event=worktree.cleanup.error at error level with phase+reason` — asserts `level==='error'`, event string, and 4 payload fields.

Net delta: file went from 12 tests (8 helpers + 1 D-10 fallback + 2 quick-mode variants + 1 frozen check) to 15 tests. All pre-existing tests untouched.

## Verification Results

- `node --test test/logger-events.test.js` → **15/15 pass** (was 12/12).
- `npm test` → **550 tests / 549 pass + 1 skip pre-existing**. Sin regresiones.
- `node -e "import('./src/logger-events.js').then(m => Object.values(m.EVENTS).length === 11 && typeof m.worktreeCleanupOk === 'function' && ...)"` → `true`.
- LOG-12 invariant: `grep -r "logger-events" src/check.js src/cli/format.js` → **0 matches**.

## Acceptance Criteria

Task 1 (8/8) y Task 2 (10/10) verdes — todos los `grep`/`node`/`node --test` del plan retornan los códigos esperados.

## Deviations from Plan

None — plan ejecutado verbatim. La única observación menor:
- El header comment cambió "Taxonomía cerrada de 7 eventos" → "11 eventos" (el header ya estaba a 8 antes del plan; el plan pedía 11 — aplicado tal cual).

## Auth Gates

None.

## Known Stubs

None — los 3 helpers son completos y testeados; Plan 02 los cablea en `stop.js` con el git worktree remove fail-open.

## Threat Flags

None — el módulo sigue siendo pure transform sin I/O. No introduce nueva superficie de red, fs, ni auth.

## Handoff to Plan 02

`src/hooks/stop.js` ya puede `import { worktreeCleanupOk, worktreeCleanupDirty, worktreeCleanupError, EVENTS } from '../logger-events.js'` y emitir cada evento con el shape exacto declarado arriba. Plan 02 NO debe re-definir los helpers; cualquier mismatch en los campos se asserta por el test de contrato de este plan.

LOG-12 invariant: si Plan 02 importa `logger-events.js` desde `stop.js` mantiene el invariant porque `stop.js` no es parte del grafo de `src/check.js`.

## TDD Gate Compliance

- RED commit Task 1: `485c72f` (test pre-extension fails) ✓
- GREEN commit Task 1: `63e52a6` (extension lands, 12/12 pass) ✓
- RED commit Task 2: `1ebcffd` (3 new helper tests fail by `TypeError: ... is not a function`) ✓
- GREEN commit Task 2: `d172118` (3 helpers exported, 15/15 pass) ✓

Gate sequence RED → GREEN respected for both tasks. No REFACTOR pass needed (helpers minimal by design).

## Self-Check: PASSED

- `src/logger-events.js` — modified, FOUND.
- `test/logger-events.test.js` — modified, FOUND.
- Commit `485c72f` — FOUND in `git log`.
- Commit `63e52a6` — FOUND in `git log`.
- Commit `1ebcffd` — FOUND in `git log`.
- Commit `d172118` — FOUND in `git log`.
