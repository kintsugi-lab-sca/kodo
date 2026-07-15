---
phase: 70-concurrencia-y-ciclo-de-vida-de-procesos
plan: 04
subsystem: daemon start-lock / dispatch dedup / worktree-path reconciliation
tags: [o-excl-lock, polling-start, cross-process-dedup, task-id-lock, worktree-path, conc-09, deferred]
requires:
  - "src/session/state-lock.js#acquireLock/releaseLock (Plan 01 primitive — reused by import)"
  - "src/cli/polling-daemon.js#writePidFile/readPidFile/removePidFile (reused)"
  - "src/config.js#KODO_DIR (reused for the dispatch-lock dir)"
provides:
  - "src/daemon/lifecycle.js: startDaemon acquires ~/.kodo/{name}.start.lock (O_EXCL) around pre-flight+spawn; loser → {ok,alreadyStarting} (D-12)"
  - "src/triggers/dispatcher.js: non-GSD lane acquires ~/.kodo/locks/dispatch-<task_id>.lock (retries:0) before launch; loser → already_active (D-13)"
  - "70-WORKTREE-VERIFICATION.md: .bg-shell vs .claude/worktrees consumer map + M13 analysis (D-15)"
affects:
  - "kodo up / polling start (two concurrent starts now converge on one daemon)"
  - "non-GSD dispatch (rapid webhook + poll no longer double-launch one task)"
  - "kodo gsd doctor orphan scan (discrepancy documented in-code; scan path unchanged, deferred)"
tech-stack:
  added: []
  patterns:
    - "O_EXCL start-lock around the check-then-spawn window; released in finally (D-12)"
    - "per-task_id cross-process dedup lock, retries:0 = immediate already_active mirror of the in-process inFlight guard (D-13)"
    - "documented-but-deferred correction for a destructive path change requiring live-session confirmation (D-15 / Phase 50.1 precedent)"
key-files:
  created:
    - test/daemon/polling-start-race.test.js
    - test/dispatcher-dedup-crossproc.test.js
    - .planning/phases/70-concurrencia-y-ciclo-de-vida-de-procesos/70-WORKTREE-VERIFICATION.md
  modified:
    - src/daemon/lifecycle.js
    - src/triggers/dispatcher.js
    - src/gsd/doctor.js
    - src/session/state.js
    - test/helpers/lock-race-child.mjs
decisions:
  - "Start-lock path is ~/.kodo/{name}.start.lock (alongside the PID files); homedir() resolved lazily so HOME-isolated tests point at the sandbox."
  - "Start-lock acquire uses retries:5/backoffMs:20 — a slightly-later start either blocks (already_starting) or acquires after release and sees the daemon alive (already_running); both converge on ONE spawn."
  - "Dispatch dedup lock uses retries:0 (NOT the primitive default) — a concurrent loser must return already_active IMMEDIATELY; waiting for the winner to finish would let it launch a duplicate after release."
  - "CONC-09 correction DEFERRED, not applied: doctor --fix deletes directories and the real path is Claude-Code-version-dependent (decided by `claude --worktree`), so a scan flip needs a fresh live-session confirmation (D-15). Only in-code discrepancy comments were added; scan path unchanged."
  - "The false '.bg-shell garantiza' comment at manager.js:342-345 was left untouched (out of Task 3 file scope) and logged as a follow-up in 70-WORKTREE-VERIFICATION.md."
metrics:
  duration_min: 16
  tasks: 4
  files_changed: 8
  completed: 2026-07-06
status: complete
---

# Phase 70 Plan 04: Start-lock, cross-process dispatch dedup, worktree-path reconciliation — Summary

Wires the two remaining consumers of the Plan-01 lock primitive and closes the
worktree-location analysis. `polling start` (startDaemon) now takes an O_EXCL
start-lock so two concurrent starts spawn exactly ONE daemon (CONC-06/D-12); the
non-GSD dispatch lane takes a per-`task_id` file lock so two processes launch a
task exactly ONCE (CONC-08/D-13); and the `.bg-shell` vs `.claude/worktrees`
discrepancy (CONC-09/M13) is fully analysed and annotated in-code, with the
destructive doctor-scan correction deferred pending a live-session sign-off
(D-15, Phase 50.1 precedent). Zero new npm dependencies; both new consumers are
proven by real multi-process race tests.

## What was built

- **`src/daemon/lifecycle.js` — O_EXCL start-lock (CONC-06 / D-12).** `startDaemon`
  now acquires `~/.kodo/{name}.start.lock` via the Plan-01 primitive
  (`acquireLock` from `state-lock.js`) immediately after the Windows-refuse guard
  and BEFORE the pre-flight+spawn. If another starter holds it, it returns a clean
  `{ ok:true, alreadyStarting:true }` without spawning. The existing pre-flight
  (readPid→isAlive→alreadyRunning, stale→removePid), the detached spawn, and the
  bounded wait now run INSIDE the lock, which is released in a `finally` (success,
  already-running, timeout, or throw). This closes the check-then-spawn TOCTOU
  where two starts both see "not alive" and both spawn. Injectable
  `_acquireLock`/`_releaseLock`/`_startLockPath`/`_lockOpts` deps mirror the
  existing DI. The lock is stealable if a prior starter died mid-spawn
  (primitive's steal-if-dead).

- **`src/triggers/dispatcher.js` — per-task_id cross-process dedup (CONC-08 / D-13).**
  The NON-GSD lane (step 5, launch) now acquires
  `~/.kodo/locks/dispatch-<task_id>.lock` via the primitive with `retries:0`
  before `inFlight.add`, and releases it in the EXISTING finally alongside
  `inFlight.delete`. A concurrent loser gets `null` immediately and returns
  `{ action: 'already_active' }` without launching — the cross-process mirror of
  the in-process `inFlight` guard (audit M17). `retries:0` is deliberate: waiting
  for the winner would let the loser launch a duplicate after release. The GSD
  lane is completely untouched — GSD tasks stay serialized by `acquireGsdLock` on
  `projectPath` (WT-03 invariant intact). `acquireLockFn`/`releaseLockFn`/
  `dispatchLockDir` are injectable via `deps`, mirroring the GSD-lane DI.

- **`src/gsd/doctor.js` + `src/session/state.js` — CONC-09/M13 discrepancy documented (D-15).**
  `defaultListWorktreeDirs` (the `.bg-shell` orphan scan) and the
  `computeWorktreePath` docstring gained CONC-09 comments documenting that the
  live worktree actually lands at `.claude/worktrees/<sid>` (per Phase 50.1's
  empirical finding and `computeRealWorktreePath`), so this scan targets a likely
  dead directory. The scan path was **not** changed (D-15 forbids inference-based
  changes to a destructive `doctor --fix` path). Full analysis in
  `70-WORKTREE-VERIFICATION.md`.

- **`test/helpers/lock-race-child.mjs` — two new race modes.** `--kind polling`
  (startDaemon against an isolated `~/.kodo`, injected `_spawn` records one line
  per real spawn + writes a live PID) and `--kind dispatch` (dispatchTrigger for
  the same non-GSD task_id, stubbed `launchWorkItemFn` records a launch marker and
  holds the lock). Both use the shared `go` barrier for real contention.

## Lock paths (recorded per <output>)

| Lock | Path | Acquire opts | Loser result |
|------|------|--------------|--------------|
| polling start (D-12) | `~/.kodo/{name}.start.lock` | `{ retries:5, backoffMs:20 }` | `{ ok:true, alreadyStarting:true }` (or `alreadyRunning` if acquired post-release) |
| non-GSD dispatch (D-13) | `~/.kodo/locks/dispatch-<task_id>.lock` | `{ retries:0 }` | `{ action:'already_active' }` |

## CONC-09 decision

**DOCUMENTED + DEFERRED.** Code analysis delivered in `70-WORKTREE-VERIFICATION.md`
(both path helpers, all 5 consumers, the concrete M13 bug — doctor scans
`.bg-shell` while real worktrees live in `.claude/worktrees`). Most-likely real
path from the code: `.claude/worktrees/<sid>`. The doctor-scan correction is
deferred because it is destructive (`--fix` deletes dirs) and the real path is
Claude-Code-version-dependent (`claude --worktree` decides it), requiring a fresh
live-GSD-session confirmation. Human empirical sign-off DEFERRED (Task 4
checkpoint), same precedent as the Phase 50.1 progress display. Task 4
(`checkpoint:human-verify`, deferrable) is satisfied by the delivered analysis +
deferral under this `--auto` run — no interactive block.

## Tests

- **`test/daemon/polling-start-race.test.js`** (new): 2 and 5 real children race
  `startDaemon` against one isolated `~/.kodo` via the `go` barrier → asserts
  exactly one spawn line and exactly one `started` verdict (losers are
  `already_starting`/`already_running`). Non-flaky over 3 runs.
- **`test/dispatcher-dedup-crossproc.test.js`** (new): 2 and 5 real children
  dispatch the SAME non-GSD `task_id` → asserts exactly one launch marker and one
  `launched` verdict; losers are `already_active`. Non-flaky over 3 runs.
- Existing `test/daemon/lifecycle.test.js` (19) and `test/dispatcher.test.js` +
  `test/dispatcher-isolation.test.js` (55) remain green — the in-process guard and
  GSD lane are preserved.

## Verification

- `node --test test/daemon/polling-start-race.test.js test/daemon/lifecycle.test.js` — green.
- `node --test test/dispatcher-dedup-crossproc.test.js` — green; existing dispatcher suites green.
- Both race tests non-flaky over 3 consecutive runs each.
- `test -f 70-WORKTREE-VERIFICATION.md && grep -Eq 'claude/worktrees|bg-shell' …` → DOC-OK.
- `npm test` full suite: **1882 tests, 1881 pass, 0 fail, 1 skip** (up from the 1873+1 Plan 03 baseline).

## Deviations from Plan

- **[Rule N/A — TDD gate]** For the two concurrency features, the RED phase was
  not committed as a separate `test(...)` commit: a real-process race assertion is
  non-deterministic WITHOUT the lock (it may pass or fail by timing), so a
  guaranteed-failing RED is not meaningful. Each feature was implemented and its
  race test committed together as one atomic `feat(...)` commit (plan `type:
  execute`, so the plan-level TDD gate does not apply). The passing, non-flaky
  race test is the real acceptance gate and is green.
- Otherwise the plan executed as written. Two Claude's-discretion choices:
  start-lock `retries:5` and dispatch-lock `retries:0` (rationale in Decisions).

## Threat mitigations applied

- T-70-10 (startDaemon check-then-spawn TOCTOU): O_EXCL start-lock → exactly one daemon.
- T-70-11 (duplicate non-GSD dispatch): per-task_id lock → exactly one launch; GSD lane untouched.
- T-70-12 (doctor cleaning the wrong worktree dir): discrepancy documented; correction deferred with analysis delivered (D-15).
- T-70-SC (npm installs): zero new deps — milestone invariant held.

## Known Stubs

None. The two new consumers are fully wired to the real primitive; no placeholder
data. The only intentionally-unchanged surface is the doctor `.bg-shell` scan
path, which is a documented deferral (CONC-09), not a stub.

## Follow-ups surfaced (out of scope)

- False `.bg-shell "garantiza"` comment at `manager.js:342-345` — correct alongside the doctor flip.
- Dispatcher collision-check (`dispatcher.js:212`) still probes `.bg-shell` — repoint when CONC-09 is confirmed.

## Self-Check: PASSED

- FOUND: src/daemon/lifecycle.js, src/triggers/dispatcher.js, src/gsd/doctor.js, src/session/state.js
- FOUND: test/daemon/polling-start-race.test.js, test/dispatcher-dedup-crossproc.test.js, test/helpers/lock-race-child.mjs
- FOUND: .planning/phases/70-concurrencia-y-ciclo-de-vida-de-procesos/70-WORKTREE-VERIFICATION.md
- FOUND commits: b792660 (Task 1), 3d8b635 (Task 2), 5ec6f33 (Task 3)
