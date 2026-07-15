---
phase: 70-concurrencia-y-ciclo-de-vida-de-procesos
plan: 01
subsystem: session / gsd lock
tags: [concurrency, advisory-lock, O_EXCL, tmp-rename, TOCTOU]
requires:
  - "src/gsd/lock.js#isPidAlive (reused by import)"
provides:
  - "src/session/state-lock.js: acquireLock / releaseLock / withFileLock (D-01 primitive)"
  - "src/gsd/lock.js: atomic acquireGsdLock (flag:'wx') + stealLock tmp+rename (CONC-02)"
affects:
  - "Plan 02 (withStateLock consumes withFileLock)"
  - "Plan 04 (polling start lock D-12; non-GSD dedup D-13)"
tech-stack:
  added: []
  patterns:
    - "advisory lockfile via node:fs O_EXCL (flag:'wx') — zero new deps"
    - "atomic replace via tmp+rename (steal)"
    - "synchronous backoff via Atomics.wait (no CPU spin)"
key-files:
  created:
    - src/session/state-lock.js
    - test/state/state-lock.test.js
    - test/state/state-lock-concurrency.test.js
    - test/gsd-lock-race.test.js
    - test/helpers/lock-race-child.mjs
  modified:
    - src/gsd/lock.js
decisions:
  - "state-lock corrupt/partial read → retry (never steal within the loop); steal only on parseable-but-stale (dead pid / TTL). Prevents the O_EXCL create window from yielding two winners."
  - "Race tests model a holder: winner keeps its PID alive (--hold) during the contention window so siblings see a LIVE owner and block, instead of stealing a lock abandoned by the winner's immediate exit."
metrics:
  duration_min: 6
  tasks: 3
  files_changed: 6
  completed: 2026-07-06
status: complete
---

# Phase 70 Plan 01: Advisory-lock primitive + atomic GSD lock — Summary

Delivered a reusable `node:fs` `O_EXCL` advisory-lock primitive (`state-lock.js`: `acquireLock`/`releaseLock`/`withFileLock`) and hardened the existing per-repo GSD lock so `acquireGsdLock` creates atomically (`flag:'wx'`) and `stealLock` replaces via tmp+rename — both proven by real multi-process race tests asserting exactly one `{acquired:true}` (Criterion 1). Zero new npm dependencies.

## What was built

- **`src/session/state-lock.js`** (D-01) — the shared primitive that Plan 02 (`withStateLock`) and Plan 04 (polling-start lock D-12, non-GSD dedup D-13) will consume:
  - `acquireLock(lockPath, { retries=8, backoffMs=20, ttlMs=10_000 })` → `{ token }` or `null`. Creates via `writeFileSync(path, content, {flag:'wx'})`; on EEXIST reads the holder and steals **only** if `!isPidAlive(pid)` or TTL exceeded, via tmp+rename (D-08). Backoff sleeps synchronously through `Atomics.wait` (no CPU spin), keeping the loop synchronous to match the sync state mutators.
  - `releaseLock(lockPath, token)` — ownership-checked (unlinks only when stored `token` matches), idempotent, never throws; corrupt lock is cleaned up.
  - `withFileLock(lockPath, fn, opts)` — `{ ok:true, value: fn() }` on success (releases in `finally`); on acquire timeout returns the fail-safe `{ ok:false, reason:'lock-timeout' }` + a `lock.timeout` warn (injectable logger, else `console.warn`). Never throws, never blocks indefinitely (D-03).
  - Liveness is **reused by import** (`import { isPidAlive } from '../gsd/lock.js'`) — grep confirms one import, zero reimplementation.

- **`src/gsd/lock.js`** hardened (CONC-02):
  - `writeLockFile` now writes with `{ flag: 'wx' }` (O_EXCL) — content extracted into `serializeLockContent`.
  - `acquireGsdLock` Case 1 TOCTOU removed: `try { writeLockFile(...); return {acquired:true} } catch(EEXIST) { fall through }`. Existing read-existing logic (Cases 2–5: dead-pid steal / TTL steal / corrupt steal / alive+TTL reject) preserved verbatim and now also handles the lost create race.
  - `stealLock` no longer calls `writeLockFile` (would EEXIST); writes to a unique tmp path then `renameSync` over the lock (atomic replace, D-08), with best-effort tmp cleanup on failure.

## Exported signatures (for Plan 02 / Plan 04 consumers)

```js
// src/session/state-lock.js
acquireLock(lockPath: string, opts?: { retries?, backoffMs?, ttlMs?, logger? }): { token: string } | null
releaseLock(lockPath: string, token: string): void
withFileLock<T>(lockPath: string, fn: () => T, opts?): { ok: true, value: T } | { ok: false, reason: 'lock-timeout' }
// Lock content shape on disk: { pid: number, acquired_at: number, token: string }
```

## decideLock mirror check (D-08 / D-13 consistency)

`decideLock` (`src/gsd/doctor.js:230`) is a pure mirror of `acquireGsdLock`'s steal/keep decision (dead pid → steal; TTL exceeded → steal; alive + TTL ok → keep). This plan did **not** change the GSD lock's content shape (`acquired_at` still ISO string, `ttl_hours` preserved) nor its Cases 2–5 semantics — only the *create* path (Case 1) and the *write mechanism* of steal (tmp+rename) changed. **decideLock still agrees; no edit made.**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Test scaffold bug] Race tests needed a holder to model mutual exclusion**
- **Found during:** Task 2 (state concurrency test failed 2-acquired).
- **Issue:** The RED harness had each child acquire then exit immediately. The winner's PID died on exit, so a barrier-synchronized sibling read a dead-PID lock and legitimately **stole** it — yielding two `acquired`. This was correct primitive behavior (steal dead-owner locks), but the test modeled contention without the winner holding its critical section.
- **Fix:** Added `--hold <ms>` to `test/helpers/lock-race-child.mjs`; the winning child stays alive (via `Atomics.wait`) for 500 ms so all siblings observe a **live** owner and block. Applied to both the state and GSD race tests. This models real usage (`withFileLock` holds during `fn`, releases in `finally`).
- **Files modified:** test/helpers/lock-race-child.mjs, test/state/state-lock-concurrency.test.js, test/gsd-lock-race.test.js
- **Commits:** 17979ca (state), ce330c8 (gsd)

**2. [Design decision — not a deviation from intent] Corrupt/partial read is not stealable in state-lock**
- The reference impl comments "treat corrupt as stale next turn". To keep the O_EXCL create race single-winner (a just-created empty file is momentarily unparseable), `acquireLock` steals **only** on a parseable-but-stale holder (dead pid / TTL); an unparseable read falls through to backoff+retry and returns `null` on exhaustion. GSD's `acquireGsdLock` keeps its original corrupt→steal (single-shot, different semantics) unchanged.

## Verification

- `node --test test/state/state-lock.test.js test/state/state-lock-concurrency.test.js test/gsd-lock-race.test.js` — green, 3 consecutive runs (non-flaky).
- `npm test` — **1853 pass + 1 skip, 0 fail** (baseline 1843+1 after Phase 69; +10 new lock tests).
- `git diff package.json` — no dependency change (milestone invariant held).
- Existing `test/gsd-lock.test.js` steal/corrupt/TTL suite still green after the tmp+rename change.

## Success criteria

- [x] CONC-02: `acquireGsdLock` atomic (`flag:'wx'`, EEXIST→read-existing); `stealLock` tmp+rename; 2 (and 5) concurrent processes → exactly one `{acquired:true}` (Criterion 1).
- [x] D-01 primitive: `state-lock.js` exports acquire/release/withFileLock, reuses `isPidAlive` by import, steal-if-dead + TTL, fail-safe on exhaustion (D-03), zero new deps.

## Self-Check: PASSED

All 6 files present on disk; all 3 task commits (32b61ed, 17979ca, ce330c8) present in git log.
