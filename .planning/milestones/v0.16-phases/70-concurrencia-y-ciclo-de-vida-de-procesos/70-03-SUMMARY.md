---
phase: 70-concurrencia-y-ciclo-de-vida-de-procesos
plan: 03
subsystem: daemon lifecycle / session gate / config
tags: [pid-ownership, sigkill-safety, pid-reuse, max-parallel, atomic-config, lstart]
requires:
  - "src/cli/polling-daemon.js#readPidFile/removePidFile (reused by import)"
  - "src/config.js#writeFileAtomic (reused, config.js:100)"
  - "src/session/reconcile.js#reconcileTick (sole writer of alive — read by the gate)"
provides:
  - "src/daemon/run.js: teardown removes kodo.pid only if payload.pid === selfPid (D-09)"
  - "src/daemon/lifecycle.js: processStartMatches(pid, startedAtISO, {toleranceMs,_exec}) + SIGKILL guard (D-11)"
  - "src/session/manager.js: exported isSchedulable(s) — max_parallel gate filters alive!==false (D-05)"
  - "src/config.js: migrateConfigIfNeeded persists via writeFileAtomic (D-14)"
affects:
  - "kodo up/stop/status PID lifecycle (Phase 66 consumers of lifecycle.js)"
  - "launchWorkItem capacity gate (any zombie session no longer holds a slot)"
tech-stack:
  added: []
  patterns:
    - "PID-ownership guard: read payload, act only if payload.pid === self (D-09)"
    - "anti-PID-reuse: ps -o lstart= with LC_ALL=C compared to started_at before SIGKILL, degrade-safe (D-11)"
    - "atomic config migration via tmp+rename (writeFileAtomic reuse, D-14)"
    - "liveness gate reads alive; reconcile stays sole writer (D-05/D-06)"
key-files:
  created:
    - test/session/max-parallel-alive.test.js
    - test/config-migration-atomic.test.js
  modified:
    - src/daemon/run.js
    - src/daemon/lifecycle.js
    - src/session/manager.js
    - src/config.js
    - test/daemon/run.test.js
    - test/daemon/lifecycle.test.js
decisions:
  - "SIGKILL start-time tolerance = 8000ms (absorbs lstart's 1s resolution + started_at write skew; Claude's discretion per D-11)."
  - "Pre-bind writePidFile ordering (run.js) was NOT changed (D-10 REVISED) — the no-lying-PID invariant is guaranteed by the fail-path teardown(1) ownership removal, not by post-bind ordering. Regressing to post-bind would break 66-07 cold-spawn PID-wait."
  - "Gate extracted to an exported isSchedulable(s) helper (D-06 permits Claude's discretion) so the predicate is unit-testable in isolation; the gate only READS alive."
  - "Ownership compares payload.pid === selfPid where selfPid = proc.pid ?? process.pid — the same value written to the payload, keeping the happy path unchanged."
  - "Degrade-safe warn is emitted as NDJSON to stderr via an injectable _warn dep so the visible-degradation contract (D-11) holds without coupling lifecycle.js to a logger."
metrics:
  duration_min: 9
  tasks: 3
  files_changed: 8
  completed: 2026-07-06
status: complete
---

# Phase 70 Plan 03: Process/PID/config lifecycle guards — Summary

Four surgical lifecycle guards, none depending on the new lock primitive: a zombie session no longer holds a `max_parallel` slot (CONC-03/D-05), a process deletes only its own PID file (CONC-04/D-09), a recycled PID is never SIGKILLed (CONC-05/D-11), and config migration is atomic (CONC-07/D-14). The deliberate pre-bind PID write (gap-closure 66-07) was preserved verbatim (D-10 REVISED). Zero new npm dependencies.

## What was built

- **`src/daemon/run.js` — teardown PID ownership (CONC-04 / D-09).** The unconditional `removePidFile('kodo')` in `teardown` is now ownership-guarded: it reads the on-disk payload (new injected `_readPidFile` dep, default `readPidFile` from polling-daemon.js) and removes `~/.kodo/kodo.pid` **only** when `payload.pid === selfPid` (`selfPid = proc.pid ?? process.pid`, the same value written to the payload). A foreign daemon's PID file is never touched (no-op, never throws). The happy path is unchanged (the daemon wrote its own PID). The pre-bind `writePidFile` at run.js was **not moved** (D-10 REVISED); its comment now documents that the "no lying PID on bind failure" invariant (audit A5) is guaranteed by the fail-path `teardown(1)` removal, not by write ordering, and that moving it post-bind would regress 66-07's cold-spawn PID-wait timeout.

- **`src/daemon/lifecycle.js` — anti-PID-reuse before SIGKILL (CONC-05 / D-11).** New exported helper `processStartMatches(pid, payloadStartedAtISO, { toleranceMs = 8000, _exec })` runs `ps -o lstart= -p <pid>` with `LC_ALL=C` (Pitfall 4 locale stabilization), `Date.parse`s it, and returns `{ verifiable, match }`; any throw or non-finite parse → `{ verifiable:false }` (degrade safe). `stopDaemon` guards the SIGKILL fallback: `verifiable && match` → SIGKILL; `verifiable && !match` (PID recycled) → skip + `daemon.sigkill.aborted` warn; `!verifiable` (ps absent/NaN) → skip + `daemon.sigkill.unverifiable` warn. Never kills by default when unverifiable. Injectable `_exec`/`_warn` deps mirror the existing `_kill`/`_isPidAlive` DI. The SIGTERM path and ESRCH stale-cleanup are unchanged.

- **`src/session/manager.js` — zombie frees its slot (CONC-03 / D-05).** The `max_parallel` gate now filters via an exported `isSchedulable(s) = s.status === 'running' && s.alive !== false`. A reconcile-dead session (`alive:false`) no longer consumes a slot (audit A4 — the most damaging capacity leak). `!== false` (not `=== true`) keeps legacy no-`alive` sessions counting. The gate only READS `alive`; `reconcileTick` remains the sole writer (invariant v0.9/v0.10) — no new field, no reconcile state-machine change (D-06).

- **`src/config.js` — atomic config migration (CONC-07 / D-14).** `migrateConfigIfNeeded` persists the migrated config via the existing `writeFileAtomic` (tmp+rename, config.js:100) instead of a direct `writeFileSync` — a crash mid-migration can no longer truncate `config.json`. One-line swap; the `.bak` write is left as-is (the truncation risk is the live file, not the backup).

## Exported signatures

```js
// src/daemon/lifecycle.js
export function processStartMatches(pid, payloadStartedAtISO, { toleranceMs = 8000, _exec } = {})
  // → { verifiable: boolean, match?: boolean }

// src/session/manager.js
export function isSchedulable(session) // → status === 'running' && alive !== false
```

## Tests

- **`test/daemon/run.test.js`** (extended): foreign pid → teardown does NOT remove; own pid → removes; bind-fail → `teardown(1)` removes own PID (write pre-bind + fail-path cleanup, D-10 REVISED). Three existing teardown tests updated to inject `_readPidFile` (matching pid) for the new ownership guard.
- **`test/daemon/lifecycle.test.js`** (extended): match→SIGKILL, mismatch→abort+`daemon.sigkill.aborted`, ps-absent→skip+`daemon.sigkill.unverifiable`; plus direct `processStartMatches` tests (forces `LC_ALL=C`; degrades safe on throw / NaN output / NaN started_at). The existing SIGKILL-escalation test updated to inject a matching `_exec`.
- **`test/session/max-parallel-alive.test.js`** (new): `isSchedulable` unit matrix (alive:true counts, alive:false zombie excluded, legacy no-alive counts, non-running excluded); gate simulation frees the zombie's slot; **D-06b** drives `alive:false` the REAL way — `reconcileTick` with a `liveRefs` snapshot that OMITS the zombie's `workspace_ref` (tab death) across `DEBOUNCE_TICKS`, and documents the contra-case that a `kill -9` with the tab still alive keeps `alive:true` → still counted.
- **`test/config-migration-atomic.test.js`** (new): HOME-isolated (`mkdtemp` + dynamic import POST-HOME) proof that migration produces valid JSON, `.bak` present, and no `.tmp` residue (the atomic tmp+rename signature); idempotent second load leaves no residue.

## Verification

- `node --test test/daemon/run.test.js test/daemon/lifecycle.test.js test/session/max-parallel-alive.test.js test/config-migration-atomic.test.js` — all green.
- `grep -n "alive !== false" src/session/manager.js` → present (isSchedulable, line 187).
- `grep -n "writeFileAtomic" src/config.js` → present in migrateConfigIfNeeded (line 155).
- `grep -n "LC_ALL" src/daemon/lifecycle.js` → present (env of the `ps` exec).
- writePidFile in run.js still precedes `await startServerFn` (line 167 before line 178) — pre-bind ordering preserved.
- `npm test` full suite: **1873 pass, 1 skip, 0 fail** (up from the 1843+1 Phase 69 baseline; ~30 new tests).

## Deviations from Plan

None — plan executed exactly as written. The optional `isSchedulable(s)` helper (D-06 Claude's discretion) was extracted for isolated unit-testing; the SIGKILL tolerance was set to 8000ms (D-11 Claude's discretion).

## Threat mitigations applied

- T-70-06 (SIGKILL vs recycled PID): `processStartMatches` guard in `stopDaemon`.
- T-70-07 (teardown removing a foreign PID file): ownership check `payload.pid === selfPid`.
- T-70-08 (truncated config.json): `writeFileAtomic` in `migrateConfigIfNeeded`.
- T-70-09 (zombie holding a slot): `isSchedulable` gate filter.
- T-70-SC (npm installs): zero new deps — milestone invariant held.

## Self-Check: PASSED

- FOUND: src/daemon/run.js, src/daemon/lifecycle.js, src/session/manager.js, src/config.js
- FOUND: test/session/max-parallel-alive.test.js, test/config-migration-atomic.test.js
- FOUND commits: c5ead5b (Task 1), 5e9d0ef (Task 2), 03a696e (Task 3)
