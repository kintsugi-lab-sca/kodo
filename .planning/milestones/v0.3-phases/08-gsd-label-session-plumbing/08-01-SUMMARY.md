---
phase: 08-gsd-label-session-plumbing
plan: 01
subsystem: infra
tags: [gsd, lock, concurrency, fs, pid, ttl, session, typedef]

# Dependency graph
requires:
  - phase: 08-gsd-label-session-plumbing
    provides: CONTEXT.md decisions D-05..D-11, RESEARCH.md lock semantics, PATTERNS.md analog mapping
provides:
  - GSD per-repo lock module (acquireGsdLock, releaseGsdLock, readLock, isPidAlive)
  - Lock content typedef (LockContent) and exported constants (LOCK_FILE, DEFAULT_TTL_HOURS)
  - Extended Session typedef with optional gsd?: boolean and phase_id?: string
  - Test fixtures and conventions for filesystem-isolated lock tests (mkdtempSync + afterEach)
affects: [08-02, 08-03, 09-phase-resolver, 09-bootstrap]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "File-based mutual exclusion with PID-liveness + TTL fallback (no runtime deps)"
    - "Per-repo sentinel files at .planning/.kodo.lock (D-05)"
    - "Symlink-safe path resolution via realpathSync before all FS operations"

key-files:
  created:
    - src/gsd/lock.js
    - test/gsd-lock.test.js
  modified:
    - src/session/state.js

key-decisions:
  - "Module location: src/gsd/lock.js (Claude discretion — matches PATTERNS.md analog to state.js)"
  - "DEFAULT_TTL_HOURS = 4 (per CONTEXT.md D-06 default)"
  - "isPidAlive treats EPERM as alive (conservative — only ESRCH means dead)"
  - "Corrupt lock files are cleaned up by both acquire (steal) and release (delete)"
  - "stealLock helper logs reason to stderr; TTL-expired path adds an extra warning before stealing"
  - "Session typedef extension also documents pre-existing task_url? and project_name? fields populated by manager.js"

patterns-established:
  - "Pure JSON file I/O module mirroring src/session/state.js (read with try/catch, write with mkdirSync recursive)"
  - "Lock reuse via writeLockFile/stealLock private helpers — single source of truth for lock content shape"
  - "Tests use mkdtempSync(join(tmpdir(), 'kodo-lock-')) per-test isolation with rmSync afterEach cleanup"
  - "writeLockDirect test helper bypasses acquire to simulate stale/corrupt/concurrent scenarios deterministically"

requirements-completed: [GSD-10]

# Metrics
duration: ~12min
completed: 2026-04-20
---

# Phase 8 Plan 01: GSD Lock Foundation + Session Typedef Extension Summary

**GSD per-repo file lock with PID liveness + TTL semantics (no runtime deps) and Session typedef extended with optional gsd/phase_id fields, fully covered by 15 unit tests.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-20T06:28:00Z
- **Completed:** 2026-04-20T06:40:30Z
- **Tasks:** 2
- **Files modified:** 3 (1 created module, 1 created test, 1 typedef extension)

## Accomplishments

- `src/gsd/lock.js` implements the four-case acquisition semantics from D-07 (create / steal-dead-PID / steal-expired-TTL+warn / reject) plus corrupt-file recovery as a fifth case.
- `releaseGsdLock` is fully idempotent (D-09): no-op on missing lock, no-op on session_id mismatch, deletes on match, deletes on corrupt.
- `realpathSync(projectPath)` collapses symlink divergence before every FS operation (Pitfall 3 mitigation, T-08-03).
- `mkdirSync({recursive:true})` creates `.planning/` on demand (Pitfall 4 mitigation).
- Session typedef gains optional `gsd?: boolean` (D-10) and `phase_id?: string` (D-11) — pure typedef change, sessions without the fields treated as `gsd=false` per legacy behavior.
- 15 unit tests cover every acquire/release/read/PID path; full project suite remains green (189 pass / 1 skipped intentional / 0 fail).

## Task Commits

1. **Task 1: Create src/gsd/lock.js with acquire/release/read logic** — `c5f6a3d` (feat)
2. **Task 2: Extend Session typedef and create lock unit tests** — `a463b38` (feat)

## Files Created/Modified

- `src/gsd/lock.js` *(created)* — Lock module: `acquireGsdLock`, `releaseGsdLock`, `readLock`, `isPidAlive`, plus `LockContent` typedef and exported `LOCK_FILE`/`DEFAULT_TTL_HOURS` constants. Zero runtime deps; uses only `node:fs`, `node:path`, `process`.
- `src/session/state.js` *(modified)* — Session typedef extended with four optional fields: `task_url?`, `project_name?` (already populated by `manager.js` but previously undocumented), `gsd?: boolean`, `phase_id?: string`. No functional change.
- `test/gsd-lock.test.js` *(created)* — 15 isolated unit tests across four `describe` groups (acquire / release / readLock / isPidAlive), using `mkdtempSync` per-test temp directories with `afterEach` cleanup.

## Decisions Made

- **Module path `src/gsd/lock.js`** — Plan left this to Claude's discretion; chose the structure recommended by RESEARCH.md and PATTERNS.md (utility role, JSON file I/O analog of `state.js`).
- **`isPidAlive` returns true on EPERM** — conservatively treats permission errors as "process exists, lock holder is alive". Only `ESRCH` (no such process) signals death. Documented in JSDoc.
- **TTL warning emitted before stealing** — Plan said "warn"; chose to emit two log lines for the TTL-expired case: a contextual `Stealing expired lock from <task_ref> (acquired ..., TTL Xh exceeded)` line plus the generic `Lock stolen: TTL expired`. Operators see both the human reason and the steal action.
- **Corrupt lock cleanup also in `releaseGsdLock`** — D-09 only mandates idempotency; chose to delete corrupt files on release as well so that a stuck corrupt file does not require a separate acquire to recover. Verified by dedicated test.
- **Typedef also documents `task_url?` and `project_name?`** — manager.js already writes these but they were missing from the typedef, causing TS hints to flag them. This is a Rule 2 mini-fix bundled with the planned `gsd?`/`phase_id?` additions; pure type-only change, no runtime impact.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Documented pre-existing optional fields in Session typedef**

- **Found during:** Task 2 (Part A typedef extension)
- **Issue:** Plan instructed adding `gsd?` and `phase_id?` after `project_path`, with a note that `task_url` and `project_name` "may already be present". On reading `manager.js` lines 36-37 they are already written to every session, but the typedef did not declare them — a stale typedef is a silent correctness bug for any future TypeScript-aware tool.
- **Fix:** Added all four optional fields together in the same edit, with comments distinguishing pre-existing data from Phase 8/9 additions.
- **Files modified:** `src/session/state.js`
- **Verification:** `grep -c 'gsd.*boolean'` and `grep -c 'phase_id.*string'` both return 1; full test suite still green.
- **Committed in:** `a463b38` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical / typedef hygiene)
**Impact on plan:** Zero scope creep — plan already invited this update via the "may already be present" note. Pure documentation/type-safety improvement.

## Issues Encountered

- Worktree base mismatch on agent startup (HEAD was at `8e1bcd3`, expected `0efd2af`). Resolved per `<worktree_branch_check>` protocol via `git reset --hard 0efd2af`. Verified target SHA matches before proceeding.

## User Setup Required

None — no external service configuration required for the lock module.

## Threat Model Compliance

All `mitigate` dispositions from the plan's `<threat_model>` are satisfied:

| Threat ID | Mitigation Required | Implementation |
|-----------|---------------------|----------------|
| T-08-03 (Tampering — symlink) | `realpathSync` resolves symlinks before lock path | `lockPathFor()` calls `realpathSync(projectPath)` (src/gsd/lock.js:180) |
| T-08-04 (DoS — corrupt JSON) | Corrupt lock treated as stale | `acquireGsdLock` try/catch around `JSON.parse` calls `stealLock(_, _, 'corrupt lock file')` (src/gsd/lock.js:114-116); `releaseGsdLock` mirror-cleans corrupt files |

`accept`-disposition threats (T-08-01 lock tampering inside `.planning/`, T-08-02 PID reuse) require no code changes per plan.

## Verification Results

- `node --test test/gsd-lock.test.js` → 15 pass / 0 fail / 0 skip / 0 todo (115ms)
- `node --test test/**/*.test.js` → 190 tests / 189 pass / 1 skip (intentional `it.skip()` in `startup-budget.test.js`) / 0 fail (419ms)
- `grep -c 'gsd.*boolean' src/session/state.js` → 1 (≥1 ✓)
- `grep -c 'phase_id.*string' src/session/state.js` → 1 (≥1 ✓)

## Next Phase Readiness

- Plan 02 (dispatcher GSD lock guard) can import `acquireGsdLock` from `../gsd/lock.js` and inject it via `DispatchDeps.acquireGsdLockFn`.
- Plan 03 (stop hook lock release) can import `releaseGsdLock` from `../gsd/lock.js`. Idempotency guarantees mean the call can be made unconditionally on session shutdown without checking holder identity.
- Plan 04 (concurrency integration test) has stable acquire/release contract to test against.
- Phase 9 phase resolver can populate the new `phase_id?` field on Session records without further typedef changes.

## Self-Check: PASSED

Verified files and commits exist on disk:

- `src/gsd/lock.js` → FOUND (222 lines, all required exports + constants present)
- `test/gsd-lock.test.js` → FOUND (15 `it(` tests across 4 `describe` blocks)
- `src/session/state.js` → contains `gsd?: boolean` and `phase_id?: string`
- Commit `c5f6a3d` → FOUND in `git log` (`feat(08-01): add GSD lock module with PID + TTL semantics`)
- Commit `a463b38` → FOUND in `git log` (`feat(08-01): extend Session typedef with gsd/phase_id and add lock tests`)

---
*Phase: 08-gsd-label-session-plumbing*
*Completed: 2026-04-20*
