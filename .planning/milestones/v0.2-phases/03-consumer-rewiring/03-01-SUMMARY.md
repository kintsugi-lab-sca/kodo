---
phase: 03-consumer-rewiring
plan: 01
subsystem: provider-abstraction
tags: [taskprovider, registry, check, session-start, ansi, mcp-hint]

requires:
  - phase: 02-plane-adapter
    provides: initRegistry, getProvider, PlaneProvider factory, TaskItem contract
  - phase: 01-interface-foundation
    provides: TaskProvider interface, Session schema v2 (task_id/task_ref/provider)
provides:
  - check.js uses provider.listPendingTasks() via registry (no PlaneClient)
  - checkPendingTasks() pure helper for dependency-injected pending-task checks
  - session-start.js uses generic task_ref/task_id fields (no plane_identifier/plane_id)
  - buildSessionContext() pure helper for provider-agnostic context injection
  - Dynamic MCP hint derived from config.providers[name].mcp_hint with fallback
affects: [phase-03-02, phase-04-triggers, future-providers]

tech-stack:
  added: []
  patterns:
    - "Pure function extraction for testability (checkPendingTasks, buildSessionContext)"
    - "Dependency injection via function parameter (getProviderFn) instead of module mocking"
    - "Entry-point guard (import.meta.url === file://process.argv[1]) to make hooks importable"
    - "ANSI color constants (\\x1b[33m yellow, \\x1b[31m red, \\x1b[0m reset) for terminal output"

key-files:
  created:
    - test/check.test.js
    - test/session-start.test.js
  modified:
    - src/check.js
    - src/hooks/session-start.js

key-decisions:
  - "Extracted checkPendingTasks() as pure helper with getProviderFn injection instead of using node:test mock.module (requires experimental flag)"
  - "Guarded main() in session-start.js behind entry-point check so the hook module is importable without executing readStdin"
  - "Fallback mcp_hint format is 'MCP de {providerName}' when config lacks providers[name].mcp_hint"
  - "session.provider takes precedence over config.provider when resolving which provider config to use"
  - "check.js initRegistry() is always called (not gated on getPlaneApiKey) — errors caught and reported"

patterns-established:
  - "Consumer rewiring shape: pure helper accepting { config, ...deps } returning { lines, reasons } — runCheck() composes these helpers"
  - "Hook module shape: export pure buildSessionContext(session, config) + guard main() behind entry-point check"
  - "Test invariants via readFileSync + regex — enforces 'no PlaneClient', 'no plane_identifier' at source level"

requirements-completed: [REWI-01, REWI-05]

duration: 6min
completed: 2026-04-10
---

# Phase 03 Plan 01: Consumer Rewiring — check.js & session-start.js Summary

**check.js and session-start.js rewired to the TaskProvider abstraction with pure testable helpers, dynamic MCP hints, and generic task_ref/task_id fields — zero PlaneClient imports in either consumer.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-10T07:38:53Z
- **Completed:** 2026-04-10T07:45:00Z (approx)
- **Tasks:** 2 (TDD RED + GREEN each)
- **Files modified:** 2 source files, 2 new test files

## Accomplishments

- **check.js**: Replaced ~40 lines of direct PlaneClient querying (`countPendingKodoTasks`) with a single `provider.listPendingTasks()` call behind a pure helper (`checkPendingTasks`) that injects its provider for testability.
- **session-start.js**: Extracted `buildSessionContext(session, config)` as a pure, exported helper so context generation is now unit-testable. Generic `task_ref`/`task_id` fields replace legacy `plane_identifier`/`plane_id`. The MCP hint is read from `config.providers[providerName].mcp_hint` with a `"MCP de {providerName}"` fallback.
- **Test coverage**: 18 new tests total (9 per consumer), covering pending-count paths, error handling, missing-provider paths, ANSI colors, field rename invariants, and provider-agnostic instructions.
- **Full regression**: 96/96 tests pass. Manager.js tests (Plan 03-02) also pass since manager.js was already rewired in an unstaged state and was committed separately as part of Plan 03-02.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing tests for check.js** — `5e4bc86` (test)
2. **Task 1 GREEN: rewire check.js to TaskProvider** — `79e08fa` (feat)
3. **Task 2 RED: failing tests for session-start.js** — `b381249` (test)
4. **Task 2 GREEN: rewire session-start.js to generic fields** — `2787d20` (feat)

## Files Created/Modified

**Created:**
- `test/check.test.js` — 9 tests covering `checkPendingTasks` pure helper (pending count, slot availability, error handling, missing provider, ANSI colors) and source-file invariants (no PlaneClient, imports registry).
- `test/session-start.test.js` — 9 tests covering `buildSessionContext` (task_ref, task_id, mcp_hint lookup, fallback, provider precedence) and source-file invariants (no plane_identifier, no `.plane_id`, no hardcoded "Plane").

**Modified:**
- `src/check.js` — Removed imports of `PlaneClient`, `parseKodoLabels`, `resolveLabels`, `getPlaneApiKey`. Added `initRegistry`, `getProvider`. Exported new `checkPendingTasks()` pure helper. Deleted 40-line `countPendingKodoTasks()` function. Fixed `session.plane_identifier` → `session.task_ref` in review lines (bug fix beyond the plan's stated must-haves).
- `src/hooks/session-start.js` — Exported new `buildSessionContext(session, config)` pure function. Replaced all `session.plane_identifier`/`plane_id` with `task_ref`/`task_id`. Made "Plane"-specific strings provider-agnostic. Added `loadConfig` import. Guarded `main()` behind entry-point check so the module is importable in tests.

## Decisions Made

- **Pure helper extraction over module mocking**: Node 24's `node:test` `mock.module()` requires `--experimental-test-module-mocks` flag; rather than modify the test script, I extracted the provider-dependent logic into pure functions (`checkPendingTasks`, `buildSessionContext`) with dependency injection. This improves testability and keeps tests flag-free.
- **Entry-point guard for hook module**: `session-start.js` used to call `main()` at top-level on import. I wrapped it in `if (import.meta.url === \`file://${process.argv[1]}\`)` so importing the module in tests does not try to read stdin.
- **`session.provider` > `config.provider`**: When a session was started with a specific provider, its recorded `provider` field takes precedence over the current `config.provider`. This makes in-flight sessions survive provider config changes.
- **`initRegistry()` is always called**: Unlike the old code that gated the Plane query on `getPlaneApiKey()`, the new flow always initializes the registry and attempts `getProvider`. Errors (including "Unknown provider") are caught and reported via ANSI red, then execution continues.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `session.plane_identifier` still used in check.js review lines**
- **Found during:** Task 1 (check.js rewiring)
- **Issue:** Line 50 of old check.js mapped `inReview.map((s) => s.plane_identifier)`, but the v2 `Session` schema uses `task_ref`. This would produce `undefined, undefined` when sessions were in review.
- **Fix:** Replaced with `s.task_ref` inline.
- **Files modified:** `src/check.js`
- **Verification:** Full suite still green (96/96); field name matches Session typedef.
- **Committed in:** `79e08fa` (Task 1 GREEN commit)

**2. [Rule 2 — Missing critical] `session-start.js` `main()` called unconditionally on import**
- **Found during:** Task 2 (writing tests that import `buildSessionContext`)
- **Issue:** The file had `main();` at module level, which would attempt to read stdin whenever the module was imported (including from tests), hanging or producing test noise.
- **Fix:** Guarded with `if (import.meta.url === \`file://${process.argv[1]}\`)` entry-point check.
- **Files modified:** `src/hooks/session-start.js`
- **Verification:** Tests import the module cleanly and `buildSessionContext` is called without side effects.
- **Committed in:** `2787d20` (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical).
**Impact on plan:** Both fixes are required for correctness (first) and test infrastructure (second). No scope creep.

## Issues Encountered

- **Mock strategy pivot**: Initial test draft used `node:test` `mock.module()` which is behind an experimental flag in Node 24. Rewrote tests to use dependency injection via function parameter instead — simpler, flag-free, and encouraged better factoring of the production code (pure helpers).
- **Work-in-progress state from prior session**: When I started, `src/session/manager.js` was already rewired but uncommitted (leftover from a previous 03-02 execution attempt), and `.planning/phases/03-consumer-rewiring/deferred-items.md` was untracked. These files belonged to Plan 03-02 and I left them untouched. Manager.js was committed separately by an external process (commit `4e5f5e6`) during my run. These did not affect Plan 03-01 scope.
- **Pre-existing `.planning/config.json` modification**: An unrelated `_auto_chain_active: false` toggle was already modified and not committed. Left in place — belongs to workflow config, not this plan.

## Next Phase Readiness

- Plan 03-02 work is partially in place (stop.js and manager.js commits exist); the RED-only `test/manager.test.js` commit is already satisfied by the committed `manager.js` rewiring. Plan 03-02 should verify/close out that work and create its own SUMMARY.
- Phase 03 requirements REWI-01 and REWI-05 are complete. Remaining consumer rewiring (stop.js, manager.js) is tracked by Plan 03-02.

## Self-Check

Files claimed created:
- `test/check.test.js` — FOUND
- `test/session-start.test.js` — FOUND

Files claimed modified:
- `src/check.js` — FOUND (modified)
- `src/hooks/session-start.js` — FOUND (modified)

Commits claimed:
- `5e4bc86` test(03-01) — FOUND
- `79e08fa` feat(03-01) check.js — FOUND
- `b381249` test(03-01) session-start — FOUND
- `2787d20` feat(03-01) session-start — FOUND

Verification:
- `node --test test/check.test.js test/session-start.test.js` → 18/18 pass
- `node --test test/**/*.test.js` → 96/96 pass
- `grep -l PlaneClient src/check.js src/hooks/session-start.js` → no matches
- `grep -E "plane_identifier|\.plane_id\b" src/hooks/session-start.js` → no matches

## Self-Check: PASSED

---
*Phase: 03-consumer-rewiring*
*Completed: 2026-04-10*
