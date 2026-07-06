---
phase: 70-concurrencia-y-ciclo-de-vida-de-procesos
plan: 02
subsystem: session / state coordination
tags: [concurrency, state.json, advisory-lock, anti-clobber, reconcile, Pitfall-1]
requires:
  - "src/session/state-lock.js#withFileLock (D-01 primitive from Plan 01)"
provides:
  - "src/session/state.js: withStateLock(mutator) + runUnderStateLock(fn) — the 3 mutators wrapped"
  - "src/session/reconcile.js: runReconcileTick save participates in the same state lock (snapshot-outside / apply-inside)"
affects:
  - "Plan 04 (polling start lock D-12; non-GSD dedup D-13 — same primitive)"
tech-stack:
  added: []
  patterns:
    - "load→mutate→save under one O_EXCL lock with a FRESH re-read inside the lock (anti-clobber, D-02)"
    - "snapshot slow host I/O (pgrep/listWorkspaces) OUTSIDE the lock; apply pure derivation + conditional save INSIDE (Pitfall 1)"
    - "injectable lock-runner default = passthrough (keeps FS-free unit tests) — production injects runUnderStateLock"
key-files:
  created:
    - test/state/state-writers-concurrency.test.js
    - test/session/reconcile-lock.test.js
  modified:
    - src/session/state.js
    - src/session/reconcile.js
    - src/server.js
    - test/helpers/lock-race-child.mjs
decisions:
  - "reconcile uses runUnderStateLock (raw lock-runner) + its own conditional save, NOT the always-saving withStateLock(mutator) — routing reconcile through the always-save mutator would write state.json every 2.5s and break the tested no-write optimization. Same STATE_LOCK_PATH → same mutual exclusion (the must_have), without the regression."
  - "reconcile's lock-runner is an injectable dep with a passthrough default so the existing in-memory reconciliation.test.js stays FS-free; server.js wires the real runUnderStateLock at the composition root."
  - "STATE_LOCK_PATH = STATE_PATH + '.lock' = ~/.kodo/state.json.lock — one global lock for the single state file (RESEARCH Open Question 3)."
metrics:
  duration_min: 15
  tasks: 3
  files_changed: 6
  completed: 2026-07-06
status: complete
---

# Phase 70 Plan 02: state.json write coordination (withStateLock) — Summary

Wrapped the complete set of `state.json` write points in the Plan-01 `O_EXCL`
advisory lock so cross-process mutations stop clobbering each other (audit T1):
the 3 `state.js` mutators (`addSession`/`updateSession`/`removeSession`) now route
through `withStateLock`, which re-reads state FRESH under the lock before
mutate+save (the anti-clobber key, D-02); and `runReconcileTick`'s save
participates in the SAME lock without holding it across the host's async I/O
(Pitfall 1). Proven by a real 10-process writer race with zero lost writes. The
false "único escritor de state.json" claim in `server.js` (and two stale copies in
`reconcile.js`) is corrected to the truth — N coordinated writers serialized by
`withStateLock` (D-04). Zero new npm dependencies.

## What was built

- **`src/session/state.js`** (CONC-01, D-02):
  - `STATE_LOCK_PATH = STATE_PATH + '.lock'` (one global lock for the single
    state file) and `import { withFileLock } from './state-lock.js'` — the Plan-01
    primitive reused, never reimplemented.
  - `runUnderStateLock(fn)` — the raw lock-runner (`withFileLock(STATE_LOCK_PATH, fn)`);
    does not load or save, so a caller with its own conditional-save logic (reconcile)
    can participate in the same lock.
  - `withStateLock(mutator)` — layers `loadState()` FRESH inside the lock, runs
    `mutator(state)`, `saveState(next ?? state)`, releases in `finally`. The
    re-read under the lock is the anti-clobber key. On lock-timeout returns the
    primitive's fail-safe `{ok:false}` + warn (no throw, no partial write, D-03).
  - `addSession`/`removeSession`/`updateSession` bodies moved into `withStateLock`
    callbacks operating on the freshly-loaded state; existing logger calls and
    return shapes preserved (`saveState` tmp+rename unchanged as the write step).

- **`src/session/reconcile.js`** (CONC-01, Pitfall 1):
  - `runReconcileTick` refactored to snapshot-outside / apply-inside. The
    `await host.listWorkspaces()` and the `pgrep` process_alive derivation run
    OUTSIDE any lock (host snapshot keyed by `session_id`). The pure
    `reconcileTick` derivation + a CONDITIONAL save (`if (newState !== state)`)
    run INSIDE an injected lock-runner, re-reading state FRESH so a concurrent
    hook write is not clobbered. No `await` inside the lock callback.
  - `withStateLock` (lock-runner) is an injectable dep threaded through
    `startReconcileLoop`; default is a passthrough so in-memory unit tests stay
    FS-free. `reconcileTick` remains the sole writer of `alive` (unchanged).

- **`src/server.js`** (D-04): the reconcile loop wiring injects
  `withStateLock: runUnderStateLock` so the tick's save serializes with the
  mutators in production. The false "el ÚNICO escritor de state.json" comment is
  replaced with the truth (N writers coordinated by `withStateLock` over
  `state.json.lock`; dashboard stays read-only), naming `withStateLock` so the
  corrected claim is greppable.

## STATE_LOCK_PATH

`STATE_LOCK_PATH = STATE_PATH + '.lock'` → `~/.kodo/state.json.lock` (HOME-isolated
to the sandbox in every test). One lock for the single state file.

## reconcile keeps `alive` as its sole writer

Confirmed: `applyLiveFields`/`deriveTarget` were not touched; `alive` is still set
only inside `reconcileTick`. The reconcile refactor changed only WHERE the save
happens (inside the shared lock) and WHEN the pgrep snapshot is taken (outside),
never the state machine. The true claim "reconcileTick sigue siendo el ÚNICO
escritor de `alive`" was preserved verbatim.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — avoid regressing a tested optimization] reconcile uses `runUnderStateLock` + conditional save, not `withStateLock(mutator)`**
- **Found during:** Task 3.
- **Issue:** The plan action said "replace the tail with a `withStateLock(state => {...})` call." But `withStateLock(mutator)` ALWAYS saves (`saveState(next ?? state)`), whereas `runReconcileTick` deliberately skips the save when nothing changed — the reconcile loop runs every 2.5s and the no-write optimization is load-bearing and explicitly tested (`reconciliation.test.js`: `saved === null` on an unchanged tick; reconcile.js comment: writing every tick "kills the no-write optimization"). Routing reconcile through the always-saving mutator would write `state.json` ~34k times/day and break that test.
- **Fix:** Added `runUnderStateLock(fn)` (raw lock-runner) that `withStateLock` itself now reuses. reconcile applies its derivation + CONDITIONAL save inside `runUnderStateLock` — the SAME `STATE_LOCK_PATH`, so mutual exclusion with the mutators holds (the actual must_have: "participates in the same lock"), without the always-save regression.
- **Files modified:** src/session/state.js, src/session/reconcile.js, src/server.js
- **Commit:** a05709c

**2. [Rule 1 — accuracy] Corrected two more stale "único escritor de state.json" claims in reconcile.js (D-04 extension)**
- **Found during:** final verification of D-04.
- **Issue:** D-04 scoped the comment fix to server.js, but `reconcile.js` carried the same now-false claim in its module header and `startReconcileLoop` JSDoc. Since this plan edits reconcile.js, leaving the false claim would be inconsistent.
- **Fix:** Reworded both to name the shared state lock; left the TRUE "reconcileTick sigue siendo el ÚNICO escritor de `alive`" untouched.
- **Files modified:** src/session/reconcile.js
- **Commit:** cad8eb2

**3. [Rule 3 — testability] reconcile lock-runner is injectable with a passthrough default**
- **Found during:** Task 3.
- **Issue:** Existing `reconciliation.test.js` injects in-memory `loadState`/`saveState` and is NOT HOME-isolated. A hard-wired real lock would create `~/.kodo/state.json.lock` in the real home during those tests.
- **Fix:** `withStateLock` is a `deps` param (default passthrough, no lockfile). Production (server.js) injects `runUnderStateLock`; the new `reconcile-lock.test.js` injects it under an isolated HOME to prove the real lock lifecycle.
- **Files modified:** src/session/reconcile.js, src/server.js
- **Commit:** a05709c

## Verification

- `node --test test/state/state-writers-concurrency.test.js test/session/reconcile-lock.test.js` — green, non-flaky over 3 consecutive runs (4 pass / 0 fail each).
- 10-process writer race: RED before Task 2 (only ~4/10 sessions survived — lost writes), GREEN after (all 10 present, zero clobbered).
- `reconcile-lock.test.js`: lock file FREE during host snapshot, HELD during save, dead session → idle preserved; source guard confirms no `await` inside the lock callback (Pitfall 1).
- `grep 'withStateLock' src/server.js` → corrected comment names `withStateLock`; no remaining "ÚNICO escritor de state.json" claim in server.js.
- Existing `save-state-atomic` / `migration` / `reconciliation` / `server-reconcile-logger` suites still green.
- `npm test` — **1877 pass + 1 skip, 0 fail** (baseline 1872 pass; +5 new tests; the pre-existing flaky failure did not recur).
- `git diff package.json` — no dependency change (milestone invariant held).

## Success criteria

- [x] CONC-01: the 3 state.js mutators + reconcile's save all go through the shared state lock; N concurrent writers lose no writes; the false server.js comment corrected in the same commit as the mutator wrapping (D-04).
- [x] D-02: `withStateLock` re-reads state FRESH inside the lock (unit-proven).
- [x] Pitfall 1: reconcile never holds the lock across `listWorkspaces`/pgrep.

## Self-Check: PASSED

Both created files present on disk; all 4 commits (5aaeb58, 9592405, a05709c, cad8eb2) present in git log.
