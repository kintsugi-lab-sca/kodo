---
phase: 42-dismiss-tui-read-write-server-amplification
plan: 01
subsystem: server
tags: [dismiss, destructive-mutation, toctou, doctor, http-server, di-extraction]
requires:
  - "src/gsd/doctor.js execute({taskId, fix:true}) (Phase 41)"
  - "src/session/state.js loadState (by-task_id key)"
  - "src/server/provider-state.js (Phase 40 DI extraction precedent)"
provides:
  - "DELETE /sessions/{id} amplified: 409 alive guard + doctor.execute(fix:true) + actions[] body"
  - "src/server/dismiss.js createDismissHandler(deps) + translateToActions(result)"
  - "src/logger-events.js SESSION_DISMISSED event + sessionDismissed helper"
affects:
  - "Plan 02 (TUI) consumes the {ok, removed, actions:[{type,result}]} HTTP contract this plan defines"
tech-stack:
  added: []
  patterns:
    - "Pure DI factory mirroring createProviderStateResolver (server-lifetime, mockable)"
    - "Counter→shape synthesis (DoctorResult aggregate counters → actions[])"
    - "Authoritative server-side TOCTOU re-check (fresh loadState by task_id)"
key-files:
  created:
    - src/server/dismiss.js
    - test/server/dismiss.test.js
  modified:
    - src/server.js
    - src/logger-events.js
    - test/logger-events.test.js
decisions:
  - "409 guard re-reads loadState().sessions[taskId] directly (NOT findSession — Pitfall 6: findSession does not key by task_id)"
  - "fix:true locked in dismiss.js (DRIFT #2: execute is a silent no-op without it)"
  - "Server synthesizes actions[] from DoctorResult counters (DRIFT #1: doctor returns counters, not actions[])"
  - "No removeSession call in dismiss.js — executeFn already archives the zombie (anti double-archive)"
  - "EVENTS taxonomy test updated 29→30 (session.dismissed) — Rule 3 blocking deviation"
metrics:
  duration_min: 14
  completed: 2026-06-05
  tasks: 2
  files_created: 2
  files_modified: 3
  tests_added: 15
---

# Phase 42 Plan 01: Dismiss Server Amplification Summary

DELETE /sessions/{id} amplified from a 3-line static `removeSession` no-op into a defense-in-depth destructive-mutation endpoint that delegates real sanitization to `doctor.execute({taskId, fix:true})` through a pure, unit-testable DI module (`src/server/dismiss.js`), with an authoritative server-side 409 TOCTOU guard and a `DoctorResult`→`actions[]` synthesis layer.

## What Was Built

- **`src/server/dismiss.js`** (new pure DI module, mirrors Phase 40 `provider-state.js`):
  - `translateToActions(result)` — pure, byte-deterministic mapping of `DoctorResult` aggregate counters → the D-06 `actions:[{type,result}]` body (DRIFT #1: the actions[] shape does NOT exist in doctor's return; the server synthesizes it). One action per non-zero counter; one `{type:<category>,result:'error'}` per `errors[]` element; `worktrees.skipped` emits no action.
  - `createDismissHandler(deps)` — DI factory returning `async dismiss(taskId)`:
    1. Fresh re-read via `loadState().sessions[taskId]` — the authoritative TOCTOU re-check (D-07/D-08, SC#3). If `alive===true` → `{status:409, body:{ok:false, error:'alive'}}` and `executeFn` is NEVER called.
    2. Otherwise `executeFn({}, {taskId, fix:true})` (DRIFT #2: `fix:true` is mandatory or execute is a silent no-op), translate counters, optionally emit `SESSION_DISMISSED`, return `{status:200, body:{ok:true, removed, actions}}`.
    3. Never-throws: a thrown `loadState`/`executeFn` collapses to `{status:500, body:{ok:false, error}}`.
  - Does NOT call `removeSession` — `executeFn` already archives the zombie (doctor.js:527 double-archive anti-pattern).
- **`src/logger-events.js`**: added `SESSION_DISMISSED: 'session.dismissed'` to the frozen `EVENTS` registry + `sessionDismissed(logger, {task_id, actions_count})` helper with explicit whitelist (LOG-12, no `...fields` spread).
- **`src/server.js`**: imported `createDismissHandler`, constructed it once per server lifetime (mirroring the `providerStateResolver` wiring, logger child `component:'dismiss'`), and replaced the 3-line DELETE handler with a thin adapter: decode `taskId` (T-39-01 path-traversal control retained) → `await dismissHandler(taskId)` → write `status`+`body` verbatim. No try/catch (dismiss is never-throws by construction).
- **`test/server/dismiss.test.js`** (new, 15 unit tests, mirrors `provider-state.test.js`): translate mappings (removed/moved-dirty/pruned/state/lock/error/skipped/empty), 409 TOCTOU determinism (executeFn spy never called), `fix:true` assertion, never-throws (executeFn AND loadState reject), SESSION_DISMISSED emission (and non-emission on 409), optional logger.

## How To Verify

- `node --test test/server/dismiss.test.js` → 15/15 pass.
- `npm test` → full suite green (1158 pass, 0 fail, 1 pre-existing skip).
- Grep gates: `grep -cE 'fix:\s*true' src/server/dismiss.js` = 4 (≥1, anti-Pitfall 2); `grep -c removeSession src/server/dismiss.js` = 0 (anti double-archive).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] EVENTS taxonomy test broke on the new required event**
- **Found during:** Task 2 (full-suite run)
- **Issue:** `test/logger-events.test.js` asserts the EVENTS registry by exact-match against a 29-entry canonical list. Adding the plan-mandated `SESSION_DISMISSED` event (Task 1) grew the registry to 30, failing `EVENTS is frozen and contains the 29 canonical types`.
- **Fix:** Inserted `'session.dismissed'` into the sorted expected list, bumped the count assertion 29→30, and updated the test name/description to reference Phase 42.
- **Files modified:** `test/logger-events.test.js`
- **Commit:** f957812

### Plan-Honored Reality (not deviations — the plan already encoded these)

The three HIGH RESEARCH drifts were honored exactly: (1) `actions[]` synthesized from counters; (2) `fix:true` locked; (3) 409 guard via `loadState().sessions[taskId]`, confirmed `findSession` does NOT key by task_id (read state.js:319-364). No `removeSession` double-archive.

### Note: dead import retained per plan instruction

After the DELETE handler stopped calling `removeSession`, the symbol is now imported-but-unused in `src/server.js:7`. The plan explicitly instructed: "if unused after this change, leave the import, do not chase unrelated cleanup." The project has no lint script (only `npm test`), so the dead import is inert. Left as-is per plan.

## Authentication Gates

None — no auth flows in this plan.

## Known Stubs

None. The endpoint is fully wired to `doctor.execute`; no placeholder/empty data paths.

## Threat Flags

None — no new security surface beyond the plan's `<threat_model>` (T-42-01..T-42-SC). The 409 guard (T-42-01/02), `fix:true` lock (T-42-03), retained `decodeURIComponent` (T-42-04), and moved-dirty translation (T-42-05) are all implemented as specified.

## TDD Gate Compliance

- RED: `73d9025 test(42-01): add failing tests for pure dismiss handler` (test commit before implementation).
- GREEN: `a7525f8 feat(42-01): pure dismiss handler` (implementation after RED).
- No REFACTOR commit needed — implementation was clean on first GREEN.
Gate sequence satisfied.

## Self-Check: PASSED

- FOUND: src/server/dismiss.js
- FOUND: test/server/dismiss.test.js
- FOUND: src/server.js (modified — imports createDismissHandler, thin DELETE adapter)
- FOUND: src/logger-events.js (modified — SESSION_DISMISSED + sessionDismissed)
- FOUND: commit 73d9025 (RED), a7525f8 (GREEN Task 1), f957812 (Task 2)
