---
phase: 41-doctor-m-dulo-puro-de-saneo-cli
plan: 01
subsystem: hooks / observability
tags: [worktree-cleanup, refactor, fail-open, logger-events, doctor]
requires:
  - src/hooks/stop.js (Phase 19 WT-04 cleanup block — source factored)
  - src/logger-events.js (EVENTS registry + worktreeCleanup* helper shape)
provides:
  - cleanupWorktree (shared fail-open worktree saneo helper)
  - doctor.* events + helpers (doctorScan/doctorFixWorktree/doctorFixLock/doctorFixLog/doctorFixError)
affects:
  - src/hooks/stop.js (now delegates cleanup to the helper)
  - Plan 02 doctor.js (will consume cleanupWorktree + doctor.* helpers)
tech-stack:
  added: []
  patterns:
    - "DI + pure + never-throws helper (mirror reconcile.js convention)"
    - "logger injected, logger-events.js static import OK (LOG-12 hook lane)"
    - "doctor.* helpers: whitelist fields, no spread, token-free (mirror worktreeCleanup*)"
key-files:
  created:
    - src/hooks/worktree-cleanup.js
    - test/worktree-cleanup.test.js
  modified:
    - src/hooks/stop.js
    - src/logger-events.js
    - test/stop.test.js
    - test/logger-events.test.js
decisions:
  - "D-11 implemented: worktree cleanup mirrors stop.js:251-402 verbatim (branch-before-remove, no --force, dirty->.dirty, no rm -rf)"
  - "Helper imports logger-events.js statically + node:fs; never imports logger.js (LOG-12 preserved)"
  - "cleanupWorktree returns structured {removed, moved_to, branch_deleted} for doctor per-item reporting (D-08)"
  - "stop.js keeps dynamic-import style for the helper (matches sibling lazy-DI convention)"
metrics:
  duration: ~25min
  completed: 2026-06-04
  tasks: 2
  files: 4
---

# Phase 41 Plan 01: Doctor — worktree cleanup helper + doctor.* events Summary

Extracted the hardened Phase 19 worktree-cleanup block from `stop.js` into a shared, DI'd, fail-open helper `cleanupWorktree` consumed by `stop.js` (and Plan 02's doctor.js), and registered the 5 `doctor.*` observability events — the "una sola fuente de saneo" mandated by D-11, with byte-equivalent stop.js behavior proven by the contractual test staying green with zero assertion edits.

## What was built

**Task 1 — `cleanupWorktree()` helper (commit 9744e87)**
- New `src/hooks/worktree-cleanup.js` (194 lines): `async cleanupWorktree({ project, worktree, sessionId, gitFn, logger })`.
- Sequence factored VERBATIM from `stop.js:272-397`: (1) branch read via `gitFn(project, ['-C', worktree, 'branch', '--show-current'])` BEFORE remove (Pitfall #2, fail-open silent); (2) `status --porcelain` dirty check (failure → `cleanupError{phase:status}`, isDirty=null, skip remove/move but still prune); (3) CLEAN path: `worktree remove` WITHOUT `--force` → `branch -D` fail-open (Pitfall #3 → ok with branch_deleted=false) → `cleanupOk`; (4) DIRTY path: move-aside to `${worktree}.dirty` with `lstatSync` collision pre-check forcing suffixed variant (Pitfall #1 / CR-03), `renameSync`+`worktree repair` fallback, `cleanupDirty`, NEVER deletes; (5) opportunistic `worktree prune` fail-open.
- Returns `{ removed, moved_to, branch_deleted }` so doctor (Plan 02) reports exact per-item action (D-08).
- Static imports `node:fs` + `logger-events.js`; never imports `logger.js` (LOG-12). No `rm -rf`, no `unlinkSync`.
- New `test/worktree-cleanup.test.js`: 10 direct unit tests (clean/dirty/error/status-fail/prune-fail/branch-D-fail/collision/dangling-symlink/regular-file/never-throws).

**Task 2 — rewire stop.js + register doctor.* events (commit eb30c97)**
- `stop.js` cleanup block (~150 lines) replaced with a single `await cleanupWorktree({...})` call. Preserved: `if (session.worktree_path)` guard, legacy-session silent skip (D-09), `cleanupLog` construction (loggerFactory DI or lazy createLogger child), outer defensive try/catch (runStopHook never crashes), cleanup-after-releaseGsdLock order (D-07).
- `src/logger-events.js`: added `DOCTOR_SCAN`, `DOCTOR_FIX_WORKTREE`, `DOCTOR_FIX_LOCK`, `DOCTOR_FIX_LOG`, `DOCTOR_FIX_ERROR` to the frozen `EVENTS` object, plus token-free helpers `doctorScan/doctorFixWorktree/doctorFixLock/doctorFixLog/doctorFixError` (whitelist fields, no spread, mirror worktreeCleanup* shape; `doctorFixLock` levels by decision stolen=warn/kept=info).

## Verification

- `node --test test/worktree-cleanup.test.js` → 10/10 pass (helper covered directly).
- `node --test test/stop-worktree-cleanup.test.js` → 10/10 pass UNCHANGED (regression gate / T-41-01 — proves verbatim behavior).
- `grep -c "rm -rf" src/hooks/worktree-cleanup.js` → 0.
- `grep -c "worktree.*remove\|worktree.*move\|worktree.*prune" src/hooks/stop.js` → 0 (tokens now live only in the helper).
- EVENTS registry contains all 5 doctor.* keys; all 5 helpers exported.
- Full suite: **1113 pass / 0 fail / 1 skip** (pre-existing startup-budget skip).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Redirected 3 stop.js source-hygiene guards to the helper**
- **Found during:** Task 2 (running the full suite after the rewire).
- **Issue:** `test/stop.test.js` had 3 source-hygiene assertions reading the cleanup invariants from `stop.js` inline source (`worktreeCleanupOk` marker for D-07 order, `--show-current` before `worktree remove` for D-08, `lstatSync(target)` + no `existsSync` for CR-03). Factoring the code to the helper moved those literals out of stop.js, so the assertions failed.
- **Fix:** Pointed the D-08 and CR-03 guards at `src/hooks/worktree-cleanup.js` (where the code now lives — same intent, follows the code), and kept the D-07 order guard in stop.js but switched its marker to the `cleanupWorktree({` call site. Intent and coverage preserved; behavior unchanged.
- **Files modified:** test/stop.test.js
- **Commit:** eb30c97

**2. [Rule 3 - Blocking] Updated the EVENTS taxonomy contract test 24 → 29**
- **Found during:** Task 2 (full suite).
- **Issue:** `test/logger-events.test.js` asserts the exact set + count of canonical EVENTS types (was 24). Adding the 5 doctor.* events broke the deep-equal and count assertions.
- **Fix:** Extended the expected sorted list with the 5 `doctor.*` entries and bumped the count to 29.
- **Files modified:** test/logger-events.test.js
- **Commit:** eb30c97

Both are mechanical test-follows-code updates required by the deliberate factorization/registration this plan mandates — not behavior changes. The contractual regression gate (`stop-worktree-cleanup.test.js`) was NOT touched and stayed green, satisfying T-41-01.

## Threat Surface

No new threat surface introduced. The helper preserves the Phase 19 hardening verbatim: no `rm -rf`, `git worktree remove` without `--force`, dirty worktrees moved aside (never deleted), all git I/O via injected `gitFn`. doctor.* helpers are token-free with explicit field whitelists (no spread) — every future destructive doctor action is auditable in NDJSON (T-41-03).

## Self-Check: PASSED

- FOUND: src/hooks/worktree-cleanup.js
- FOUND: test/worktree-cleanup.test.js
- FOUND: commit 9744e87
- FOUND: commit eb30c97
