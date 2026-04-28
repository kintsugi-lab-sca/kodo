---
phase: 08-gsd-label-session-plumbing
plan: 03
subsystem: hooks
tags: [gsd, session-start, stop, lock, lifecycle, context-injection, logger-events]

# Dependency graph
requires:
  - phase: 08-gsd-label-session-plumbing
    plan: 01
    provides: releaseGsdLock + Session.gsd?/phase_id? typedef fields
  - phase: 08-gsd-label-session-plumbing
    plan: 02
    provides: session.gsd = true on Session record (D-12) when label kodo:gsd is present
provides:
  - buildGsdContext(session) — English GSD-mode context (D-01/D-02/D-03/D-04)
  - main() bifurcation in session-start.js based on session.gsd
  - releaseGsdLock invocation in stop.js cleanup chain (D-09)
  - gsdPhaseResolved / gsdBootstrap event emission from session-start hook
affects: [08-04, 09-phase-resolver, 09-bootstrap, 10-orchestrator-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure context builder mirroring buildSessionContext (no I/O, no globals — fully testable)"
    - "Conditional dynamic import for cold-path modules (gsd/lock.js, logger-events.js GSD subset)"
    - "Lazy-load logger via dynamic import inside try/catch to keep stop/start hooks crash-proof"

key-files:
  created:
    - test/gsd-context.test.js
  modified:
    - src/hooks/session-start.js
    - src/hooks/stop.js
    - test/stop.test.js

key-decisions:
  - "buildGsdContext skips loadConfig() entirely on the GSD branch — D-03 says GSD context replaces generic context, so provider config (mcp_hint, review state) is irrelevant to GSD sessions"
  - "GSD event emission lives in a SECOND try/catch separate from sessionStart — keeps the generic event path unchanged and guarantees a failure of one block does not poison the other"
  - "Single createLogger call shared across the gsd_phase_resolved / gsd_bootstrap branches inside the GSD block — avoids two logger instantiations per session"
  - "stop.js uses dynamic await import('../gsd/lock.js') (mirroring the existing dynamic logger import on line 86) so non-GSD sessions never load the lock module"
  - "Lock release placed AFTER session.end event emission and BEFORE removeSession(id) — keeps observer order intact (event captured first, then state cleanup, then in-memory removal)"

patterns-established:
  - "Pure context builder pattern: separate context-building functions exported for unit tests, with main() responsible only for dispatch"
  - "Two-stage GSD event emission: session.start (always) + gsd.{phase_resolved|bootstrap} (only when session.gsd) — preserves taxonomy ordering and lets non-GSD consumers skip GSD-specific filters"
  - "Hygiene tests assert source-level invariants (grep-style assertions on file contents) when behavior depends on textual code structure (e.g., release order) — same pattern as session-start.test.js source invariants"

requirements-completed: [GSD-04, GSD-10]

# Metrics
duration: ~6min
completed: 2026-04-20
---

# Phase 8 Plan 03: GSD Context Injection + Stop-Hook Lock Release Summary

**Closes the GSD session lifecycle: session-start hook injects English /gsd-plan-phase + /gsd-execute-phase + /gsd-verify-work instructions for GSD sessions (or /gsd-new-project bootstrap fallback), and the stop hook releases the per-repo GSD lock via the idempotent releaseGsdLock from Plan 01.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-20T06:50:49Z
- **Completed:** 2026-04-20T06:56:30Z
- **Tasks:** 2
- **Files modified:** 4 (2 source, 1 new test, 1 test extension)
- **Commits:** 2 (`4177f43`, `f303fbf`)

## Accomplishments

- **GSD-04 satisfied:** session-start hook injects English GSD-mode context (D-04) replacing the generic Spanish task context (D-03) when `session.gsd === true`. Phase-aware path emits the canonical 3-step command sequence `/gsd-plan-phase <id>` → `/gsd-execute-phase <id>` → `/gsd-verify-work` (D-01); fallback path emits `/gsd-new-project` for sessions without a resolved phase. All commands use the hyphen form per D-02 — no colon variants leak.
- **GSD-10 (release side) satisfied:** stop hook calls `releaseGsdLock(session.project_path, session.session_id)` for GSD sessions, completing the acquire/release contract opened in Plan 02 (dispatcher) and Plan 01 (lock module). Idempotent semantics from `releaseGsdLock` make the call safe regardless of holder identity drift.
- **GSD lifecycle observability:** session-start emits `gsd.phase.resolved` (when `phase_id` is present) or `gsd.bootstrap` (when absent) via the typed event helpers from Phase 7's `logger-events.js`. This is the FIRST consumer of those two events — Phase 9's resolver and bootstrap will populate `phase_id` upstream.
- **Zero regressions:** full suite stays at **209 tests / 208 pass / 1 intentional skip / 0 fail**. The bifurcation does not touch the legacy `buildSessionContext` path nor its 6 existing tests.
- **13 new tests:** 9 in `test/gsd-context.test.js` covering the pure context builder, 4 in `test/stop.test.js` covering the source-level lock-release invariants.

## Task Commits

1. **Task 1: Add buildGsdContext and bifurcate session-start.js main()** — `4177f43` (feat)
2. **Task 2: Release GSD lock from stop hook (D-09)** — `f303fbf` (feat)

## Files Created/Modified

- `src/hooks/session-start.js` *(modified)* — three additive changes inside the existing module: (1) new exported `buildGsdContext(session)` pure function (lines 69-117) building a 9–14-line GSD-mode block in English; (2) bifurcation in `main()` replacing the unconditional `buildSessionContext(session, config)` with a ternary on `session.gsd` that calls `buildGsdContext(session)` for GSD sessions and `buildSessionContext(session, loadConfig())` otherwise — `loadConfig` is now invoked lazily inside the false branch; (3) GSD-specific event emission block (lines 170-189) running AFTER the existing `sessionStart` block and BEFORE `process.stdout.write`, gated by `if (session.gsd)`, dispatching to `gsdPhaseResolved` or `gsdBootstrap` based on `phase_id` presence, all wrapped in try/catch that silences logger failures.
- `src/hooks/stop.js` *(modified)* — single additive block (lines 102-110) inserted between the existing `sessionEnd` event try/catch and the `removeSession(id)` call. Guarded by `if (session.gsd)`, performs `await import('../gsd/lock.js')` and calls `releaseGsdLock(session.project_path, session.session_id)`. Errors caught and logged to stderr, never crash the stop hook.
- `test/gsd-context.test.js` *(created)* — 9 tests in a single `describe('session-start.js — buildGsdContext', ...)` block. Covers: GSD Mode header with task_ref, common data (project_path/session_id/task_id), command sequence with phase_id (D-01), hyphen-vs-colon enforcement (D-02), bootstrap fallback without phase_id, English-only language constraint (D-04), absence of generic Spanish/MCP instructions (D-03), and summary inclusion. Uses local `makeSession()` helper mirroring `test/session-start.test.js` conventions.
- `test/stop.test.js` *(modified)* — added 4 hygiene tests to the existing `describe('stop.js source hygiene', ...)` block. Reads `STOP_SOURCE_PATH` (already declared at file top) and asserts: (1) `releaseGsdLock` reference exists; (2) `session.gsd` guard exists; (3) `releaseGsdLock` text appears BEFORE `removeSession(id)` text (order check via `indexOf`); (4) dynamic import pattern `await import\(.*gsd/lock` is used.

## Decisions Made

- **Skip `loadConfig()` on the GSD branch** — Plan 03 Part B example wrote `buildSessionContext(session, loadConfig())` only inside the false branch of the ternary. Preserved literally: GSD context never reads provider config (no `mcp_hint`, no `review` state needed) so loading the file is wasted I/O for GSD sessions. Side effect: tests of GSD context don't need to mock config loading.
- **GSD events emitted in a SECOND try/catch, not folded into the existing sessionStart block** — Cleaner failure isolation: a logger import failure in the GSD branch must not affect the (already-emitted) generic `session.start` event. Plan example used this structure verbatim; preserved.
- **Single `createLogger` instantiation inside the GSD block** — Plan example called `createLogger` once and then conditionally imported `gsdPhaseResolved` or `gsdBootstrap`. Preserved — alternative (two separate try/catch blocks for the two GSD events) would duplicate the createLogger call. Trade-off: the two events share the same component/task_id child — correct for our taxonomy.
- **Dynamic `await import('../gsd/lock.js')` instead of static import in stop.js** — Mirrors the existing dynamic `await import('../logger.js')` pattern (line 86) for the same reason: keeps the lock module out of the hot path for non-GSD sessions and isolates module-load failures inside the GSD-only try/catch.
- **Lock release positioned AFTER `sessionEnd` and BEFORE `removeSession(id)`** — Plan instructed "before removeSession(id)" but did not specify relative to `sessionEnd`. Chose AFTER `sessionEnd` because the typed event captures the lifecycle transition first, then the lock cleanup is a side effect. This matches the established cleanup pattern (event emission → resource cleanup → state removal).
- **Source-level hygiene tests over runtime tests for stop.js** — Mirrors the existing `test/stop.test.js` style (all existing tests grep `STOP_SOURCE_PATH`). Lock release is impure (filesystem + dynamic import) — running it in a unit test would require a temp lock + temp project_path setup that Plan 04 (concurrency integration test) is designed to cover. Source-level tests catch the regression cheaply.

## Deviations from Plan

### None

Plan was followed line-for-line on both tasks. Every code block in the plan was applied verbatim except for trivial whitespace.

**Total deviations:** 0
**Rule 1/2/3 auto-fixes applied:** 0

## Issues Encountered

- **Worktree base mismatch on agent startup** — HEAD was at `8e1bcd3` (downstream commit), expected base `292e9207`. Resolved per `<worktree_branch_check>` protocol via `git reset --hard 292e920`. Verified target SHA matches before any work.
- **PreToolUse hook re-issued READ-BEFORE-EDIT reminders** — informational only; the file had already been read at session start as part of the parallel context-load batch. All edits were accepted by the runtime. No action required.

## User Setup Required

None — pure code changes, no new configuration, no external service contracts.

## Threat Model Compliance

All `mitigate` dispositions from the plan's `<threat_model>` are satisfied:

| Threat ID | Mitigation Required | Implementation |
|-----------|---------------------|----------------|
| T-08-08 (Injection — buildGsdContext) | Template literals only, no user-controlled format strings | `buildGsdContext` uses template literals interpolating `session.task_ref`, `session.summary`, `session.project_path`, `session.session_id`, `session.task_id`, `session.project_id`, `session.phase_id` — all internal Session fields. `phase_id` is interpolated into the literal `/gsd-plan-phase ${session.phase_id}` only when present, with no shell or eval downstream. |
| T-08-09 (DoS — stop.js lock release failure) | try/catch + stderr log; never crash | Lock release wrapped in `try { ... } catch (err) { console.error(`[kodo:stop] Error releasing GSD lock: ${err.message}`); }` (src/hooks/stop.js:103-109). TTL auto-release from Plan 01 covers permanent release failures. |

`accept`-disposition threats:
- **T-08-10 (Information Disclosure — GSD context)**: accept — context only contains data already present in the legacy generic context (project_path, session_id, task_id, task_ref, summary). No new disclosure surface.

## Verification Results

- `node --test test/gsd-context.test.js` → 9 pass / 0 fail / 0 skip / 0 todo (98ms)
- `node --test test/session-start.test.js` → 9 pass / 0 fail / 0 skip (no regressions on legacy buildSessionContext) (96ms)
- `node --test test/stop.test.js` → 7 pass / 0 fail / 0 skip (3 original + 4 new) (95ms)
- `node --test test/**/*.test.js` → 209 tests / 208 pass / 1 skip (intentional `it.skip()` in `startup-budget.test.js`) / 0 fail (399ms)
- `grep 'buildGsdContext' src/hooks/session-start.js` → 2 matches (export + main() ternary)
- `grep 'releaseGsdLock' src/hooks/stop.js` → 2 matches (destructure + call)
- `grep 'gsd-new-project' src/hooks/session-start.js` → 1 match (D-02 hyphen form ✓)
- `grep 'gsd:new-project' src/hooks/session-start.js` → 0 matches (forbidden colon form absent ✓)

## Next Phase Readiness

- **Plan 04 (concurrency integration test):** the full label → dispatcher → guard → session.gsd → session-start.context → stop.releaseLock loop is now in place. Plan 04 can drive two concurrent kodo:gsd-labeled tasks against the same project_path and assert that (a) the second receives `gsd_locked`, (b) the first session-start hook emits `gsd.phase.resolved` or `gsd.bootstrap`, and (c) the lock file disappears after the first session's stop hook fires.
- **Phase 9 (phase resolver + bootstrap):** the resolver must populate `session.phase_id` BEFORE the session-start hook runs (i.e., in `manager.js` or `dispatcher.js`). When it does, `buildGsdContext` will route to the phase-aware branch automatically — no further changes to session-start.js needed.
- **Phase 9 (bootstrap):** the `/gsd-new-project` fallback path is wired and ready to receive sessions where `.planning/` is absent. The bootstrap detector itself lives in Phase 9.
- **Phase 10 (orchestrator verification):** the typed `gsd.phase.resolved` event is now emitted from the hook layer; orchestrator can consume it via the structured logger sink to gate verification.

## Self-Check: PASSED

Verified files and commits exist on disk:

- `src/hooks/session-start.js` → contains `export function buildGsdContext(session)` and `session.gsd ? buildGsdContext(session)` ternary
- `src/hooks/stop.js` → contains `if (session.gsd)` guard and `await import('../gsd/lock.js')` + `releaseGsdLock(session.project_path, session.session_id)` BEFORE `removeSession(id)`
- `test/gsd-context.test.js` → FOUND (9 `it(` test cases ≥ min_lines 60)
- `test/stop.test.js` → contains 4 new tests (`releaseGsdLock`, `session.gsd` guard, order check, dynamic import)
- Commit `4177f43` → FOUND in `git log` (`feat(08-03): add buildGsdContext and bifurcate session-start main()`)
- Commit `f303fbf` → FOUND in `git log` (`feat(08-03): release GSD lock from stop hook (D-09)`)

---
*Phase: 08-gsd-label-session-plumbing*
*Completed: 2026-04-20*
