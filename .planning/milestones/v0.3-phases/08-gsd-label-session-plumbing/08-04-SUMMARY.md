---
phase: 08-gsd-label-session-plumbing
plan: 04
subsystem: test
tags: [gsd, concurrency, integration-test, lock, dispatcher, di]

# Dependency graph
requires:
  - phase: 08-gsd-label-session-plumbing
    plan: 01
    provides: acquireGsdLock + releaseGsdLock with realpath/PID/TTL semantics
  - phase: 08-gsd-label-session-plumbing
    plan: 02
    provides: dispatcher gsd_locked action with holder echo + DI surface
provides:
  - Integration test validating ROADMAP Success Criterion 3
  - Reusable per-test mkdtempSync pattern proven for lock-bearing integration tests
  - End-to-end coverage of dispatcher → GSD lock guard → real FS lock interaction
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Integration test: real FS lock module + DI for everything else (provider, launch, sessions)"
    - "Per-test tmpdir isolation via mkdtempSync(join(tmpdir(), 'kodo-concurrency-')) + rmSync afterEach"
    - "Release-by-pending-id pattern (releaseGsdLock(repoDir, `pending-${task.id}`)) mirrors dispatcher's lock acquisition session_id"

key-files:
  created:
    - test/gsd-concurrency.test.js
  modified: []

key-decisions:
  - "Test file matches plan example verbatim — 3 it() blocks covering the three behaviors mandated by Success Criterion 3 (block, release-then-acquire, non-GSD bypass)"
  - "Real acquireGsdLock/releaseGsdLock used (not stubbed) — the whole point is to validate the dispatcher↔lock module integration; stubbing the lock would only re-test what dispatcher.test.js already covers"
  - "Each test gets its own tmpdir via mkdtempSync — guarantees no lock leakage between tests; rmSync(force:true) in afterEach cleans up even if a test fails mid-run"

patterns-established:
  - "Integration test layering: real FS module + DI mocks for everything else — applicable to any future per-repo state file (e.g. phase resolver, bootstrap markers in Phase 9)"
  - "releaseGsdLock(repoDir, `pending-${task.id}`) is the canonical release call when the lock was acquired by the dispatcher's pre-launch guard (vs. by a real session that already has its UUID)"

requirements-completed: [GSD-10]

# Metrics
duration: ~1min
completed: 2026-04-20
---

# Phase 8 Plan 04: GSD Concurrency Integration Test Summary

**Integration test exercises the full dispatcher → GSD lock guard chain against real filesystem locks, validating ROADMAP Success Criterion 3: two webhooks resolving to the same repo realpath cannot start concurrent GSD sessions. 3 new tests, full suite at 198 pass / 1 skip / 0 fail (199 total).**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-04-20T06:52:09Z (after worktree base reset from `8e1bcd3` → `292e920`)
- **Completed:** 2026-04-20T06:53:34Z
- **Tasks:** 1
- **Files created:** 1
- **Commits:** 1 (`29658a6`)

## Accomplishments

- **GSD-10 satisfied (validation track):** Plan 01 implemented the lock module, Plan 02 wired the dispatcher guard, and Plan 04 now provides the automated integration test that proves they work together against real lock files on disk.
- **Test 1 — Lock contention path:** First GSD task on `tmpdir/...` launches successfully. Second GSD task on the same `tmpdir` is rejected with `action: 'gsd_locked'` and `holder.task_ref === 'KL-50'` (echoes the first task per D-09 LockContent shape).
- **Test 2 — Release + re-acquire path:** After `releaseGsdLock(repoDir, `pending-${task1.id}`)` (mirroring the dispatcher's pre-launch session_id placeholder from Plan 02), a second dispatch on the same repo successfully launches.
- **Test 3 — Non-GSD bypass path:** A task with only `['kodo']` (no `kodo:gsd` label) on the same repo as a GSD-locked task launches without the lock function being called at all (`lockCalled === false`). This is the cheap-then-expensive guard ordering from Plan 02 working correctly.
- **Full suite green:** 199 tests / 198 pass / 1 intentional skip / 0 fail (`startup-budget.test.js` skip is unrelated and pre-existing).

## Task Commits

1. **Task 1: Create GSD concurrency integration test** — `29658a6` (test)

## Files Created/Modified

- `test/gsd-concurrency.test.js` *(created, 198 lines)* — Integration test with 3 `it(` cases inside one `describe('GSD concurrency — integration (Success Criterion 3)', ...)`. Uses real `acquireGsdLock`/`releaseGsdLock` from `../src/gsd/lock.js` against a per-test `mkdtempSync(join(tmpdir(), 'kodo-concurrency-'))` directory; mocks provider, `launchWorkItemFn`, `listSessionsFn`, `listWorkspacesFn`, `removeSessionFn`, and `resolveProjectPathFn` via the DI surface from Plan 02. `afterEach` calls `rmSync(repoDir, { recursive: true, force: true })` for guaranteed cleanup.

## Decisions Made

- **Verbatim plan example** — The plan provided a complete, well-formed test file. Adding more variations (e.g. PID-dead steal during dispatch, TTL-expiry steal during dispatch) would belong in `test/gsd-lock.test.js` (unit-level), not in the integration test, which exclusively validates Success Criterion 3 (concurrent webhook handling). Followed the plan literally.
- **Real lock + DI for everything else** — Stubbing `acquireGsdLock`/`releaseGsdLock` would only re-test `test/dispatcher.test.js` (which already mocks the lock function). Stubbing the dispatcher would only re-test `test/gsd-lock.test.js`. The integration value is exactly the seam between these two modules: dispatcher writes/reads the same `.planning/.kodo.lock` file that the lock module manages, with `realpathSync` collapsing macOS `/var/folders/.../tmp` correctly. That seam is now covered.
- **Per-test `mkdtempSync` + `rmSync({force:true})`** — Each test gets its own tmpdir, guaranteeing no lock-file leakage between tests even if assertions fail mid-run. `force:true` swallows ENOENT so cleanup is idempotent.
- **`pending-${task1.id}` session_id in Test 2's release call** — This matches the placeholder the dispatcher writes in Plan 02 (`src/triggers/dispatcher.js:112`). When the real session takes ownership in Plan 03's stop-hook flow, the same pattern (`releaseGsdLock(project_path, session_id)`) will work because `releaseGsdLock` is keyed by whatever session_id the lock currently holds — Test 2 proves the contract.

## Deviations from Plan

### None

The plan provided a complete, executable test specification. Followed it line-for-line. No Rule 1/2/3 auto-fixes were needed because no source files were modified — the test exercises existing, already-working code from Plans 01 and 02.

**Total deviations:** 0
**Rule 1/2/3 auto-fixes applied:** 0

## Issues Encountered

- **Worktree base mismatch on agent startup** — HEAD was at `8e1bcd3` (a downstream commit unrelated to Phase 8), expected base `292e920`. Resolved per `<worktree_branch_check>` protocol via `git reset --hard 292e92079bb377f9411bfd755a391a69fcc2b58b`. Verified target SHA matches before any work. This was the same class of base-mismatch reported by the Plan 01 and Plan 02 SUMMARY files — orchestrator's worktree creation is currently dropping agents on the wrong commit; the per-agent guard reliably corrects it.

## User Setup Required

None — pure test addition, no new configuration, no external service contracts, no runtime dependencies.

## Threat Model Compliance

The plan's `<threat_model>` declared one threat with `accept` disposition:

| Threat ID | Mitigation Required | Implementation |
|-----------|---------------------|----------------|
| T-08-11 (Test isolation) | accept — test-only file uses tmpdir for isolation, no production trust boundaries | Per-test `mkdtempSync` + `afterEach rmSync({force:true})` provides full filesystem isolation. No test reads or writes outside its own tmpdir. |

No new threat surface introduced.

## Verification Results

- `node --test test/gsd-concurrency.test.js` → 3 pass / 0 fail / 0 skip / 0 todo (106ms)
- `node --test test/**/*.test.js` → 199 tests / 198 pass / 1 skip (intentional `it.skip()` in `startup-budget.test.js`, pre-existing) / 0 fail (410ms)
- `head -1 test/gsd-concurrency.test.js` → `// @ts-check` ✓
- `grep "acquireGsdLock\|releaseGsdLock" test/gsd-concurrency.test.js` → matches in import + 3 acquire calls + 1 release call ✓
- `grep -c "  it(" test/gsd-concurrency.test.js` → 3 ✓
- `grep -c "gsd_locked" test/gsd-concurrency.test.js` → 2 (assert + comment) ✓
- `grep -c "holder.task_ref" test/gsd-concurrency.test.js` → 1 ✓
- `grep -c "releaseGsdLock(" test/gsd-concurrency.test.js` → 1 ✓
- `wc -l test/gsd-concurrency.test.js` → 198 lines (≥ 60 minimum from must_haves.artifacts) ✓

## Next Phase Readiness

- **Plan 03 (stop hook lock release, parallel sibling):** This test only validates the *acquire* side of the contract. Plan 03 will modify `src/hooks/stop.js` and `src/hooks/session-start.js` to call `releaseGsdLock` on real session shutdown; that change is invisible to this test (which mocks all session lifecycle). Once Plan 03 lands, an end-to-end test that runs an actual session through stop-hook → release → re-acquire would belong as a follow-up integration test (out of scope for this plan).
- **Phase 9 (phase resolver / bootstrap):** The `pending-${task.id}` placeholder pattern documented and tested here will need extension when Phase 9's bootstrap injects the real `session_id` into the lock content. The `releaseGsdLock(project_path, session_id)` call site is stable because release is keyed by current lock holder, not by who originally acquired it.

## Self-Check: PASSED

Verified files and commits exist on disk:

- `test/gsd-concurrency.test.js` → FOUND (198 lines, all required assertions present)
- Commit `29658a6` → FOUND in `git log` (`test(08-04): add GSD concurrency integration tests (Success Criterion 3)`)
- All acceptance criteria from `<acceptance_criteria>` in 08-04-PLAN.md verified via grep + test runner

---
*Phase: 08-gsd-label-session-plumbing*
*Completed: 2026-04-20*
