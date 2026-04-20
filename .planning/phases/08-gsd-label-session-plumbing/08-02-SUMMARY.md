---
phase: 08-gsd-label-session-plumbing
plan: 02
subsystem: dispatch
tags: [gsd, dispatcher, session, flag-propagation, lock, di]

# Dependency graph
requires:
  - phase: 08-gsd-label-session-plumbing
    plan: 01
    provides: acquireGsdLock + LockContent typedef + Session.gsd? field
provides:
  - buildSessionFromTask flags param + gsd: true on Session record (D-12)
  - launchWorkItem wires combinedFlags into the Session record
  - dispatcher gsd_locked action with holder echo (D-08)
  - DispatchDeps extended with acquireGsdLockFn + resolveProjectPathFn for DI
affects: [08-03, 08-04, 09-phase-resolver, 09-bootstrap]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional spread for optional Session fields (...(cond ? { k: v } : {}))"
    - "Two-step DI default in dispatcher: deps.fn || ((args) => realFn(args, runtimeIO()))"
    - "Lock guard placement after inFlight check, before persisted-session check (cheap-then-expensive ordering)"
    - "Fail-open guard: resolveProjectPath errors swallowed so launch surfaces the real error"

key-files:
  created: []
  modified:
    - src/session/manager.js
    - src/triggers/dispatcher.js
    - test/manager.test.js
    - test/dispatcher.test.js

key-decisions:
  - "Conditional spread (D-12 implementation): omit gsd field entirely when false instead of writing gsd: false — keeps state.json clean and aligns with existing optional Session fields (task_url?, project_name?)"
  - "Lock guard slot 3b (between inFlight and session-active): only GSD-flagged tasks pay any cost; non-GSD tasks short-circuit out of the if-statement immediately"
  - "pending-${task.id} as session_id in lock content: the real session_id is generated inside launchWorkItem AFTER the guard. The pending placeholder is replaced by the real session_id when the actual session takes ownership in Plan 03's stop-hook flow."
  - "resolveProjectPath errors are swallowed (fail-open): plan said 'launch will fail later with same error' — if we fail-closed here we would emit gsd_locked with no holder for what is actually a config error, masking the real problem"
  - "Defensive `inFlight` clear isn't needed: the lock guard runs BEFORE the inFlight.add() call, so a gsd_locked return cannot leak inFlight state"

patterns-established:
  - "Optional flags param with `flags?.includes('gsd')` — pattern reusable for future per-flag conditional behavior in Session record"
  - "DI lambda for IO-bound default: `deps.fn || ((task) => resolveProjectPath(task, loadProjects()))` — preserves pure-function shape of resolveProjectPath while letting tests inject without a fake config file"

requirements-completed: [GSD-01, GSD-10]

# Metrics
duration: ~10min
completed: 2026-04-20
---

# Phase 8 Plan 02: GSD Flag Propagation + Dispatcher Lock Guard Summary

**Wires the GSD flag from `kodo:gsd` label through dispatcher into `Session.gsd = true` (D-12) and inserts the per-repo lock guard in the dispatch chain (D-08). 6 new unit tests, full suite stays at 195 pass / 1 skip / 0 fail.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-20T07:05:00Z (worktree base reset to 836a33d after initial mismatch)
- **Completed:** 2026-04-20T07:15:00Z
- **Tasks:** 2
- **Files modified:** 4 (2 source, 2 test)
- **Commits:** 2 (`c63bc5f`, `d4a00f1`)

## Accomplishments

- **GSD-01 satisfied:** `buildSessionFromTask` accepts `flags?: string[]` and stamps `gsd: true` on the Session when `flags.includes('gsd')`. `launchWorkItem` passes `combinedFlags` (already computed at line 175 from `opts.flags ∪ labelFlags`) so the label-derived GSD flag reaches state without further changes upstream.
- **GSD-10 satisfied:** dispatcher gains a 3b guard between the in-flight check and the persisted-session check that calls `acquireGsdLock(projectPath, sessionInfo)` only for GSD-flagged tasks. On lock contention, returns `{ action: 'gsd_locked', holder }` with the lock holder's session info (matching D-09 read semantics from Plan 01's `LockContent` shape).
- **DI surface kept consistent:** `DispatchDeps` extended with `acquireGsdLockFn` and `resolveProjectPathFn`. Defaults wire to `acquireGsdLock` from `../gsd/lock.js` and a `resolveProjectPath(task, loadProjects())` lambda — same pattern as the other 5 deps.
- **6 new unit tests:**
  - 3 in `test/manager.test.js` covering `flags=['gsd']`, `flags=['yolo']`, `flags=undefined`
  - 3 in `test/dispatcher.test.js` covering locked-by-other / acquired / non-GSD-bypass paths
- **Full suite remains green:** 195 pass / 1 intentional skip / 0 fail across 196 tests.

## Task Commits

1. **Task 1: Extend buildSessionFromTask with flags and wire launchWorkItem** — `c63bc5f` (feat)
2. **Task 2: Add GSD lock guard to dispatcher with DI support** — `d4a00f1` (feat)

## Files Created/Modified

- `src/session/manager.js` *(modified)* — `buildSessionFromTask` JSDoc + destructure now includes `flags?: string[]`; conditional spread `...(flags?.includes('gsd') ? { gsd: true } : {})` appended to the return object after `project_name`. `launchWorkItem`'s call to `buildSessionFromTask` passes `flags: combinedFlags` (the already-computed deduped union of opts + label flags from line 175).
- `src/triggers/dispatcher.js` *(modified)* — three additive changes: (1) imports for `loadProjects`, `resolveProjectPath`, `acquireGsdLock`; (2) `DispatchDeps` typedef extended with `acquireGsdLockFn` + `resolveProjectPathFn`; (3) new section "3b. GSD repo lock guard" between the inFlight check (line 95-98) and the session-active check (line 123). Guard returns `{ action: 'gsd_locked', holder }` on contention. `@returns` JSDoc union extended with `'gsd_locked'` and `holder?: object`.
- `test/manager.test.js` *(modified)* — new nested `describe('GSD flag propagation (D-12)', ...)` inside the existing `describe('buildSessionFromTask', ...)` with 3 tests.
- `test/dispatcher.test.js` *(modified)* — new top-level `describe('dispatchTrigger — GSD lock guard (D-08)', ...)` with 3 tests using the existing `createFakeProvider` helper.

## Decisions Made

- **Conditional spread instead of `gsd: false` field** — The plan's example used `...(flags?.includes('gsd') ? { gsd: true } : {})`, which omits the field entirely when not GSD. This was preserved literally because (a) it matches the `gsd?: boolean` typedef from Plan 01 (optional, not required false), (b) state.json stays smaller for the 99% non-GSD case, and (c) `session.gsd` semantics are "truthy = GSD" so `undefined` and `false` are equivalent for consumers.
- **Lock guard placement (slot 3b, between inFlight and session-active)** — Plan was explicit. Rationale: the inFlight check is O(1) Set lookup so it stays cheapest. The lock guard does I/O (reads `.planning/.kodo.lock`) so it should run before the persisted-session check (which also does I/O via `listSessions()`). Non-GSD tasks pay zero cost (the `if` short-circuits immediately).
- **`pending-${task.id}` placeholder for `session_id` in the guard's lock acquire** — The real `session_id = randomUUID()` is generated inside `launchWorkItem` AFTER the dispatcher's guard runs. The plan's example used this placeholder verbatim. Plan 03 (stop-hook) will release locks by their holder's `session_id`; the placeholder convention `pending-${task.id}` is unique-per-task and stable across the dispatch+launch boundary, so a future "claim lock" step in Plan 03 can swap it for the real session_id once it's known.
- **Fail-open on `resolveProjectPath` errors** — Plan instructed `try/catch` with `projectPath = null` to skip the guard. Rationale spelled out: if path resolution fails (no project mapping, missing module), `launchWorkItem` will throw the same error with a helpful message (`Run: kodo config --map-project`). Returning `gsd_locked` with no holder for a config error would mask the real problem.
- **Local `let projectPath = null` initialization (minor stylistic addition)** — Plan example had `let projectPath;` then assigned in try, then checked `if (projectPath)`. Initialized to `null` explicitly so the type stays `string | null` consistently and the `if` check is clearer. Pure stylistic — same behavior.

## Deviations from Plan

### None

Plan was followed line-for-line. The only stylistic addition is `let projectPath = null;` initialization (vs. plan's `let projectPath;`) which is semantically equivalent — both yield falsy initial value and pass `if (projectPath)` only when assigned a string.

**Total deviations:** 0
**Rule 1/2/3 auto-fixes applied:** 0

## Issues Encountered

- **Worktree base mismatch on agent startup** — HEAD was at `8e1bcd3` (a downstream commit), expected base `836a33d`. Resolved per `<worktree_branch_check>` protocol via `git reset --hard 836a33d`. Verified target SHA matches before any work.

## User Setup Required

None — pure code changes, no new configuration, no external service contracts.

## Threat Model Compliance

All `mitigate` dispositions from the plan's `<threat_model>` are satisfied:

| Threat ID | Mitigation Required | Implementation |
|-----------|---------------------|----------------|
| T-08-05 (Spoofing — label check) | `parseKodoLabels` validates label format; GSD guard only activates from parsed labels, not raw webhook input | Guard reads `kodoConfig.flags.includes('gsd')` (src/triggers/dispatcher.js:102), where `kodoConfig` is the result of `parseKodoLabels` already executed at line 61. Webhook payload never reaches the guard directly. |
| T-08-06 (DoS — lock guard error path) | `resolveProjectPath` errors caught with try/catch; lock acquisition is O(1) file I/O | try/catch on `resolveProjectPathFn(task)` at src/triggers/dispatcher.js:104-109 sets `projectPath = null` on error, which falls through to skip the guard. Plan 01's `acquireGsdLock` is single `readFileSync` + optional `writeFileSync`. |
| T-08-07 (Info Disclosure — gsd_locked holder) | accept disposition — holder contains session_id/task_ref, not secrets | No code change required. Holder object echoes Plan 01's `LockContent` shape (`session_id`, `task_id`, `task_ref`, `pid`, `acquired_at`, `ttl_hours`) — none are secret material. |

## Verification Results

- `node --test test/manager.test.js` → 20 pass / 0 fail / 0 skip (107ms)
- `node --test test/dispatcher.test.js` → 11 pass / 0 fail / 0 skip (101ms)
- `node --test test/**/*.test.js` → 196 tests / 195 pass / 1 skip (intentional `it.skip()` in `startup-budget.test.js`) / 0 fail (415ms)
- `grep "flags?.includes('gsd')" src/session/manager.js` → 1 match (≥1 ✓)
- `grep "gsd_locked" src/triggers/dispatcher.js` → 3 matches (JSDoc + log + return) (≥1 ✓)
- `grep "import { acquireGsdLock } from '../gsd/lock.js'" src/triggers/dispatcher.js` → 1 match (≥1 ✓)
- `grep "acquireGsdLockFn" src/triggers/dispatcher.js` → 3 matches (typedef + default + usage) (≥1 ✓)
- `grep "sets gsd: true when flags include gsd" test/manager.test.js` → 1 match (≥1 ✓)
- `grep "skips lock guard for non-GSD tasks" test/dispatcher.test.js` → 1 match (≥1 ✓)

## Next Phase Readiness

- **Plan 03 (stop hook lock release):** can now rely on `Session.gsd === true` to decide whether to call `releaseGsdLock(session.project_path, session.session_id)` from the stop hook. Idempotent release (Plan 01) means the call is safe to make unconditionally too if the gsd field check is skipped.
- **Plan 04 (concurrency integration test):** can drive the full path label → dispatcher → guard → session.gsd against the real `acquireGsdLock` (no DI) by setting up two concurrent dispatches against the same project_path and asserting the second returns `gsd_locked` with the first's holder echoed.
- **Phase 9 (phase resolver / bootstrap):** the resolver will read `session.gsd` to decide whether to inject GSD-mode context into the session-start hook. The `gsd: true` Session field is now present from launch onward.

## Self-Check: PASSED

Verified files and commits exist on disk:

- `src/session/manager.js` → contains `flags?.includes('gsd')` and `flags: combinedFlags`
- `src/triggers/dispatcher.js` → contains `import { acquireGsdLock }`, `acquireGsdLockFn`, `kodoConfig.flags.includes('gsd')`, `action: 'gsd_locked'`
- `test/manager.test.js` → contains `'sets gsd: true when flags include gsd'` (3 GSD tests in nested describe)
- `test/dispatcher.test.js` → contains `'returns gsd_locked when lock is held'` and `'skips lock guard for non-GSD tasks'` (3 GSD lock guard tests)
- Commit `c63bc5f` → FOUND in `git log` (`feat(08-02): propagate GSD flag through buildSessionFromTask (D-12)`)
- Commit `d4a00f1` → FOUND in `git log` (`feat(08-02): add GSD lock guard to dispatcher (D-08)`)

---
*Phase: 08-gsd-label-session-plumbing*
*Completed: 2026-04-20*
