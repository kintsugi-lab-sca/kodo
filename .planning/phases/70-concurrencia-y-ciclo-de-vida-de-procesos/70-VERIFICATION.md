---
phase: 70-concurrencia-y-ciclo-de-vida-de-procesos
verified: 2026-07-06T13:20:00Z
status: passed
score: 9/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
deferred:
  - truth: "CONC-09 — real worktree location confirmed via a live GSD session with a human sign-off"
    addressed_in: "Deferred by design (D-15), same precedent as Phase 50.1 progress display"
    evidence: "70-WORKTREE-VERIFICATION.md delivers the full code analysis (both path helpers, all 5 consumers, the concrete .bg-shell vs .claude/worktrees discrepancy) and documents that the empirical human sign-off requires a live GSD session, which cannot be mounted from an --auto executor context. Explicitly accepted as a known deferral per phase instructions, not a gap."
---

# Phase 70: Concurrencia y ciclo de vida de procesos Verification Report

**Phase Goal:** Hacer segura la concurrencia multiproceso sobre `state.json` y el ciclo de vida de PID/procesos — locks reales donde hoy hay escrituras a ciegas, ownership del PID antes de matar nada, y liberación del slot de `max_parallel` cuando una sesión muere (causas raíz T1 y T2).
**Verified:** 2026-07-06T13:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Real 2-process race on `acquireGsdLock` → exactly one `{acquired:true}`; `polling start` O_EXCL, one daemon | ✓ VERIFIED | `test/gsd-lock-race.test.js` (2 and 5 concurrent) green; `writeLockFile` uses `{flag:'wx'}` (`src/gsd/lock.js:207`); Case 1 TOCTOU removed (try/catch EEXIST fallthrough, `lock.js:116-122`). `test/daemon/polling-start-race.test.js` green (O_EXCL start-lock, `src/daemon/lifecycle.js:180-184`). |
| 1b | CR-01 fix: stale-lock steal is atomic (compare-and-swap), not last-writer-wins | ✓ VERIFIED | `src/gsd/lock.js` `stealLock` (237-351) and `src/session/state-lock.js` `acquireLock` steal branch (87-163) both do move-aside rename + ABA guard + O_EXCL re-create. Dedicated dead-holder double-steal race tests pass: `gsd lock steal race — concurrent dead-holder steal (CR-01)` and `state-lock steal race — concurrent dead-holder steal (CR-01)`, both asserting exactly one steal across 2/5 processes. |
| 2 | ~6 `state.json` writers go through `withStateLock`; false "ÚNICO escritor" comment corrected; reconcile does not hold the lock across async host I/O and stays sole writer of `alive` | ✓ VERIFIED | `addSession`/`removeSession`/`updateSession` route through `withStateLock` (`src/session/state.js:317-412`), re-reading `loadState()` fresh inside the lock. 10-process writer race (`test/state/state-writers-concurrency.test.js`) green: zero lost writes. `src/server.js:844/866/869` names `withStateLock`/`runUnderStateLock`; no remaining sole-writer claim. `test/session/reconcile-lock.test.js` proves the lock file is absent during `host.listWorkspaces()` and present during save, plus a source guard asserting no `await` inside the `runLocked(() => {...})` callback. `reconcileTick` remains the only writer of `alive` (unchanged `applyLiveFields`/`deriveTarget`; gate only reads it). |
| 3 | `kill -9`/TAB death → next tick reconcile frees the `max_parallel` slot | ✓ VERIFIED | `isSchedulable(s) = status==='running' && alive!==false` (`src/session/manager.js:186-187`), gate only reads `alive`. `test/session/max-parallel-alive.test.js` drives `alive:false` the real way — a `reconcileTick` fixture whose `listWorkspaces` omits the zombie's `workspace_ref` (TAB death, D-06b) — and separately proves a bare `kill -9` with the tab still alive leaves `alive:true` and still counts (the correct contra-case). |
| 4 | `teardown` deletes `kodo.pid` only if `payload.pid===process.pid`; pre-bind PID write kept (66-07 preserved); `ps -o lstart=` (LC_ALL=C) compared before SIGKILL, abort/degrade-safe on mismatch | ✓ VERIFIED | `src/daemon/run.js:136` guards `removePidFileFn` on `payload.pid === selfPid`; pre-bind write unmoved (comment at run.js:130-136 documents fail-path `teardown(1)` as the actual A5 guarantee, matching 70-CONTEXT.md's D-10 REVISED decision). `processStartMatches` (`src/daemon/lifecycle.js:101-119`) forces `LC_ALL=C`, degrades safe (`verifiable:false`) on throw/NaN; `stopDaemon` (244-303) only SIGKILLs on `verifiable && match`, else warns and skips. WR-03 fix confirmed: on `stillAlive` the PID file is left intact and `{ok:false, stillAlive:true}` is returned instead of a false `stopped:true`; `src/cli/stop-status.js:75-82` surfaces this to the user and returns exit code 1. |
| 5 | Migration v1→v2 via `writeFileAtomic`; non-GSD dedup cross-process (per-task_id lock, GSD lane untouched); worktree location analyzed/documented | ✓ VERIFIED (worktree human sign-off deferred, see Deferred Items) | `migrateConfigIfNeeded` calls `writeFileAtomic` (`src/config.js:155`); `test/config-migration-atomic.test.js` proves no `.tmp` residue / valid JSON. `src/triggers/dispatcher.js:458` acquires `~/.kodo/locks/dispatch-<task_id>.lock` (`retries:0, ttlMs:120_000` — WR-02 fix) before the non-GSD launch, releases in the existing finally (504); the GSD lane's `acquireGsdLockFn` on `projectPath` is untouched (dispatcher.js:169). `test/dispatcher-dedup-crossproc.test.js` green (2 and 5 processes → exactly one launch). `70-WORKTREE-VERIFICATION.md` delivers the full consumer map and discrepancy analysis; doctor.js and state.js both carry CONC-09 in-code annotations. |
| 6 | Code-review fixes WR-01/WR-02/WR-03 wired end-to-end | ✓ VERIFIED | WR-01: `addSession`/`removeSession`/`updateSession` return `{ok:false,...}` on lock-timeout and gate telemetry on it (`state.js:339-411`); `manager.js:299-304` (`launchWorkItem`) throws before `cmux.send` on a dropped write; `manager.js:459-467` (`markSessionStatus`) propagates the failure. WR-02: dispatch dedup lock TTL raised to `120_000`ms (`dispatcher.js:458`). WR-03: `stopDaemon` no longer removes the PID file / claims `stopped:true` on an unverifiable-but-alive SIGKILL skip (`lifecycle.js:280-291`); CLI surfaces `stillAlive` (`stop-status.js:75-82`). |

**Score:** 9/9 must-haves verified (0 present-but-behavior-unverified)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | CONC-09 empirical human sign-off on a live GSD session | Deferred by design (D-15) | `70-WORKTREE-VERIFICATION.md` §5-6: code analysis is conclusive that `.bg-shell` (legacy) is the likely-dead path and `.claude/worktrees` (Phase 50.1's `computeRealWorktreePath`) is the live one, but the destructive `doctor --fix` scan path is left unchanged pending a live-session confirmation, matching the accepted Phase 50.1 precedent for exactly this kind of deferral. Treated as an accepted known-deferred item per phase verification instructions, not a gap. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/session/state-lock.js` | acquireLock/releaseLock/withFileLock primitive | ✓ VERIFIED | Exports all three; imports `isPidAlive` from `../gsd/lock.js` (no reimplementation); CAS steal (CR-01) present. |
| `src/gsd/lock.js` | Atomic `acquireGsdLock` + CAS `stealLock` | ✓ VERIFIED | `flag:'wx'` create, EEXIST fallthrough, CAS steal with move-aside + ABA guard + O_EXCL re-create. |
| `src/session/state.js` | `withStateLock`/`runUnderStateLock` + wrapped mutators | ✓ VERIFIED | All 3 mutators route through `withStateLock`; fresh `loadState()` inside the lock. |
| `src/session/reconcile.js` | Snapshot-outside/apply-inside `runReconcileTick` | ✓ VERIFIED | No `await` inside the `runLocked` callback (test-proven); `alive` still sole-writer. |
| `src/session/manager.js` | `isSchedulable` gate + WR-01 propagation | ✓ VERIFIED | Gate filters `alive!==false`; `launchWorkItem`/`markSessionStatus` react to lock-timeout. |
| `src/daemon/run.js` | Ownership-guarded teardown, pre-bind PID kept | ✓ VERIFIED | `payload.pid === selfPid` guard; pre-bind write unmoved with documented rationale. |
| `src/daemon/lifecycle.js` | `processStartMatches` + O_EXCL start-lock + WR-03 | ✓ VERIFIED | `LC_ALL=C`, degrade-safe; start-lock around pre-flight+spawn; `stillAlive` outcome. |
| `src/config.js` | Atomic `migrateConfigIfNeeded` | ✓ VERIFIED | `writeFileAtomic` swap confirmed at line 155. |
| `src/triggers/dispatcher.js` | Per-task_id dedup lock (non-GSD lane only) + WR-02 | ✓ VERIFIED | `ttlMs:120_000`; GSD lane untouched. |
| `src/gsd/doctor.js` + `src/session/state.js` | CONC-09 discrepancy documented | ✓ VERIFIED | In-code CONC-09/M13 comments present at both consumer sites; scan path deliberately unchanged. |
| `70-WORKTREE-VERIFICATION.md` | CONC-09 analysis + deferral | ✓ VERIFIED | Complete consumer map, discrepancy, human-verification steps for future confirmation. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `state-lock.js` | `gsd/lock.js` | `import { isPidAlive }` | ✓ WIRED | Single import, zero reimplementation. |
| `gsd/lock.js acquireGsdLock` | `writeLockFile` | `{flag:'wx'}` atomic create | ✓ WIRED | EEXIST falls through to read-existing. |
| `state.js withStateLock` | `state-lock.js` | `import { withFileLock }` | ✓ WIRED | `runUnderStateLock` wraps `withFileLock(STATE_LOCK_PATH, fn)`. |
| `reconcile.js runReconcileTick` | `state.js withStateLock` | injected `deps.withStateLock` (= `runUnderStateLock`) | ✓ WIRED | `server.js:869` wires the real lock-runner at the composition root. |
| `manager.js gate` | reconcile-written `alive` | `alive !== false` | ✓ WIRED | Gate reads only; reconcile remains sole writer. |
| `daemon/lifecycle.js stopDaemon` | `ps -o lstart=` | `execFileSync` with `LC_ALL:'C'` | ✓ WIRED | Guards SIGKILL on `verifiable && match`. |
| `daemon/lifecycle.js startDaemon` | `state-lock.js` | `acquireLock`/`releaseLock` around pre-flight+spawn | ✓ WIRED | Released in `finally`; loser returns `alreadyStarting`. |
| `dispatcher.js non-GSD lane` | `state-lock.js` | per-task_id `acquireLock`/`releaseLock` | ✓ WIRED | GSD lane (`acquireGsdLockFn` on `projectPath`) confirmed untouched. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 2-process GSD lock race → exactly one acquired | `node --test test/gsd-lock-race.test.js` | `ok 1..2` (2 and 5 procs) | ✓ PASS |
| Concurrent dead-holder steal (CR-01) → exactly one steals | `node --test test/gsd-lock-race.test.js test/state/state-lock-concurrency.test.js` | 4/4 suites pass | ✓ PASS |
| 10-process state.json writer race → zero lost writes | `node --test test/state/state-writers-concurrency.test.js` | pass | ✓ PASS |
| Reconcile lock free during snapshot / held during save | `node --test test/session/reconcile-lock.test.js` | pass | ✓ PASS |
| Zombie (TAB death) frees `max_parallel` slot; bare kill -9 does not | `node --test test/session/max-parallel-alive.test.js` | pass | ✓ PASS |
| Atomic config migration (no `.tmp` residue) | `node --test test/config-migration-atomic.test.js` | pass | ✓ PASS |
| Teardown PID ownership + pre-bind preserved | `node --test test/daemon/run.test.js` | pass | ✓ PASS |
| Anti-PID-reuse SIGKILL guard + WR-03 `stillAlive` | `node --test test/daemon/lifecycle.test.js` | pass | ✓ PASS |
| 2/5-process polling-start race → one daemon | `node --test test/daemon/polling-start-race.test.js` | pass | ✓ PASS |
| 2/5-process non-GSD dispatch dedup race → one launch | `node --test test/dispatcher-dedup-crossproc.test.js` | pass | ✓ PASS |
| Full workspace suite | `npm test` (run once) | 1886 tests, 1885 pass, 0 fail, 1 skip | ✓ PASS |
| No new npm dependency | `cat package.json` (dependencies unchanged: commander/ink/picocolors/react) | matches pre-phase baseline | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CONC-01 | 70-01, 70-02 | `state.json` writers coordinated by `withStateLock`; false comment corrected | ✓ SATISFIED | `state.js` mutators + `server.js`/`reconcile.js` comments. |
| CONC-02 | 70-01 | `acquireGsdLock` atomic; `stealLock` tmp+rename (CAS after CR-01) | ✓ SATISFIED | `src/gsd/lock.js`. |
| CONC-03 | 70-03 | Zombie frees `max_parallel` slot | ✓ SATISFIED | `isSchedulable` gate, `max-parallel-alive.test.js`. |
| CONC-04 | 70-03 | Teardown ownership-guarded PID removal | ✓ SATISFIED | `run.js` teardown; note: PID write stays pre-bind per D-10 REVISED (documented, deliberate deviation from earlier phrasing, preserves gap-closure 66-07). |
| CONC-05 | 70-03 | Anti-PID-reuse before SIGKILL | ✓ SATISFIED | `processStartMatches`, `lifecycle.js`. |
| CONC-06 | 70-04 | Two `polling start` → one daemon | ✓ SATISFIED | O_EXCL start-lock, `polling-start-race.test.js`. |
| CONC-07 | 70-03 | Atomic config migration | ✓ SATISFIED | `writeFileAtomic` in `migrateConfigIfNeeded`. |
| CONC-08 | 70-04 | Cross-process non-GSD dedup by `task_id` | ✓ SATISFIED | `dispatcher.js` dedup lock, `dispatcher-dedup-crossproc.test.js`. |
| CONC-09 | 70-04 | Worktree location verified/documented | ✓ SATISFIED (analysis); human empirical sign-off explicitly deferred per D-15 | `70-WORKTREE-VERIFICATION.md`. |

No orphaned requirements — all 9 IDs mapped to REQUIREMENTS.md and claimed across the 4 plans.

### Anti-Patterns Found

None. Scanned all 12 phase-touched files (`state-lock.js`, `gsd/lock.js`, `state.js`, `reconcile.js`, `manager.js`, `run.js`, `lifecycle.js`, `config.js`, `dispatcher.js`, `doctor.js`, `server.js`, `stop-status.js`) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER`. Two grep hits were false positives — Spanish "TODO" (= "all/every"), not English debt markers:
- `src/daemon/run.js:27` — "TODO efecto (config/server/...)" = "every effect"
- `src/triggers/dispatcher.js:225` — "ante TODO error" = "on every error"

No stub returns, no empty handlers, no hardcoded-empty data flowing to rendering/decision paths found in the reviewed files.

### Human Verification Required

None required to consider this phase complete. The one item that would ordinarily require human action — CONC-09's empirical live-session confirmation (Task 4, `checkpoint:human-verify`, `gate="blocking"` in 70-04-PLAN.md) — is an explicitly deferrable checkpoint per D-15 and the established Phase 50.1 precedent, and the phase verification instructions direct treating it as an accepted known-deferred item (not a gap) given the delivered code analysis in `70-WORKTREE-VERIFICATION.md`. It is recorded above under Deferred Items for traceability, not as a blocking human-verification item.

### Gaps Summary

No gaps found. All 9 CONC-01..09 requirements are implemented and evidenced in the codebase (not just claimed in SUMMARY.md), the code-review blocker (CR-01) and all 3 warnings (WR-01/02/03) from `70-REVIEW.md` are fixed and independently confirmed present and wired (not just asserted in the review's own resolution section), the targeted concurrency test suite (60 tests across the 11 new/extended test files) is green, and the full workspace suite is green at 1885 pass + 1 skip with zero new npm dependencies. The single deferred item (CONC-09 human sign-off) is a legitimate, documented, precedented deferral with the required code analysis delivered — not an actionable gap.

---

_Verified: 2026-07-06T13:20:00Z_
_Verifier: Claude (gsd-verifier)_
