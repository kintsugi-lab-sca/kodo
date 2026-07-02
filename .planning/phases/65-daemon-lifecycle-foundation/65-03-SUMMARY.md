---
phase: 65-daemon-lifecycle-foundation
plan: 03
subsystem: daemon
tags: [daemon, lifecycle, signals, compose, polling, pid, dependency-injection, node-test]

# Dependency graph
requires:
  - phase: 65-daemon-lifecycle-foundation (Plan 01)
    provides: name-parametrized PID primitives (readPidFile/writePidFile/removePidFile 'kodo') + providerUsesPolling
  - phase: 65-daemon-lifecycle-foundation (Plan 02)
    provides: startServer({managed:true}) → { server, stopReconcile } closeable handle
provides:
  - "src/daemon/lifecycle.js: generic startDaemon(name, argv, deps)/stopDaemon(name, deps)/statusDaemon(name, deps) templated on the mature polling daemon"
  - "src/daemon/run.js: runDaemon(deps) compose funnel — server + conditional polling in ONE process with ONE kodo.pid, single-owner SIGTERM/SIGINT teardown + exit (D-05)"
affects: [66-kodo-up, 66-stop-status, launchd, brew-services, daemon]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Name-parametrized daemon plumbing: argv kept a parameter (not hardcoded 'daemon run') so the Phase 66 consumer passes ['daemon','run']"
    - "do-while bounded wait: always ≥1 PID read before yielding to deadline (covers instant-spawn happy path under an aggressive injected clock)"
    - "Handlers-FIRST compose: signal handlers registered on outer mutable vars before the startServer await (early-signal safe)"
    - "Idempotent single-owner teardown via a tornDown flag — second signal (SIGINT after SIGTERM) is a no-op, no double teardown/exit"
    - "Full DI seam (underscore deps) drives compose + teardown fully in-process with fakes — no real ports/spawn/blocking"

key-files:
  created:
    - src/daemon/lifecycle.js
    - src/daemon/run.js
    - test/daemon/lifecycle.test.js
    - test/daemon/run.test.js
  modified: []

key-decisions:
  - "lifecycle.startDaemon default stdio is 'ignore' with an injectable _logFd seam — keeps the module generic (D-02) without pulling in polling's logfile lifecycle; Phase 66 can supply an fd"
  - "runDaemon fail path calls teardown(1) (non-zero) so launchd/brew services see a failed start; the signal path calls teardown(0) — run.js is the single owner of the exit on both paths (D-05)"
  - "Bounded wait restructured to do-while so a single mandatory read happens before the deadline check (an injected step-clock must not skip the read)"

patterns-established:
  - "Pattern: generic name-parametrized lifecycle templated line-by-line on the mature polling CLI (Windows refuse-first, pre-flight liveness, detached exec+unref, bounded wait, SIGTERM→5s→SIGKILL)"
  - "Pattern: compose funnel owns teardown once; the managed server installs no handlers (Plan 02 gate 4) so there is exactly one owner"

requirements-completed: [UP-04]

coverage:
  - id: L1
    description: "startDaemon: already-running short-circuit, stale cleanup+proceed, detached spawn (execPath+abs KODO_BIN, argv array form)+unref+bounded wait, timeout, Windows refuse"
    requirement: "UP-04"
    verification:
      - kind: unit
        ref: "test/daemon/lifecycle.test.js#startDaemon (5 subtests)"
        status: pass
    human_judgment: false
  - id: L2
    description: "stopDaemon: SIGTERM→5s→SIGKILL escalation + removePidFile; graceful (no SIGKILL); ESRCH stale success; notRunning (no kill)"
    requirement: "UP-04"
    verification:
      - kind: unit
        ref: "test/daemon/lifecycle.test.js#stopDaemon (4 subtests)"
        status: pass
    human_judgment: false
  - id: L3
    description: "statusDaemon: running (pid) vs idle (missing/stale→idle)"
    requirement: "UP-04"
    verification:
      - kind: unit
        ref: "test/daemon/lifecycle.test.js#statusDaemon (3 subtests)"
        status: pass
    human_judgment: false
  - id: R1
    description: "runDaemon composes startServer({managed}) + conditional startPolling in one process; github→server+polling+kodo.pid, plane→server only+kodo.pid (D-01/D-06)"
    requirement: "UP-04"
    verification:
      - kind: unit
        ref: "test/daemon/run.test.js#compose funnel (2 subtests)"
        status: pass
    human_judgment: false
  - id: R2
    description: "SIGTERM teardown: stop()+stopReconcile()+server.close()+removePidFile('kodo') once, exit(0) once; second signal idempotent (D-05 single owner)"
    requirement: "UP-04"
    verification:
      - kind: unit
        ref: "test/daemon/run.test.js#single-owner teardown"
        status: pass
    human_judgment: false
  - id: R3
    description: "startServer throw (managed misconfig) → logged '[kodo] daemon start failed' + teardown, no polling started, no uncaught crash (Pitfall 4)"
    requirement: "UP-04"
    verification:
      - kind: unit
        ref: "test/daemon/run.test.js#startServer throw"
        status: pass
    human_judgment: false

# Metrics
duration: ~5min
completed: 2026-07-02
status: complete
---

# Phase 65 Plan 03: Daemon lifecycle + compose funnel Summary

Delivers the two `src/daemon/` modules on the Wave-1 primitives: generic name-parametrized `lifecycle.js` (start/stop/status templated on the mature polling daemon, shaped for its Phase 66 `kodo up`/`stop`/`status` consumer) and the `run.js` compose funnel (`runDaemon()` — server + conditional polling in ONE process with ONE `~/.kodo/kodo.pid`, single-owner SIGTERM/SIGINT teardown and exit).

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-02T00:14:06Z
- **Completed:** 2026-07-02T00:19:10Z
- **Tasks:** 2 (both TDD RED→GREEN)
- **Files:** 4 (all created; zero source modifications outside `src/daemon/`)

## What Was Built

### Task 1 — `src/daemon/lifecycle.js` (generic start/stop/status, D-02)
Name-parametrized daemon plumbing templated **line-by-line on the mature polling CLI** (`src/cli/polling.js`), NOT the naive `server.js` pattern (Pitfall 1):
- `startDaemon(name, argv, deps)` — (1) **Windows refuse-with-guidance FIRST** (no detached spawn, mirror polling.js:236-240); (2) **pre-flight** `readPidFile(name)`+`isPidAlive` → already-running short-circuit, stale (file present, dead) → `removePidFile(name)` then proceed (polling.js:259-268); (3) **detached spawn** `process.execPath` + absolute `KODO_BIN` + argv **array form** + `child.unref()` (polling.js:283-303 — T-65-10 EOP: zero shell/PATH lookup); (4) **bounded wait** polling `readPidFile(name)`+`isPidAlive` to the deadline (polling.js:315-323). `argv` is a parameter, NOT hardcoded `'daemon run'` — Phase 66's `kodo up` passes `['daemon','run']` (D-02 generic).
- `stopDaemon(name, deps)` — no PID file → not-running; else SIGTERM → 5s `isPidAlive` loop → SIGKILL fallback → `removePidFile(name)`; ESRCH → stale cleanup success (mirror runPollingStopCli, polling.js:492-519).
- `statusDaemon(name, deps)` — `readPidFile(name)`+`isPidAlive` → running (pid) | idle (missing/stale).
- Full DI seam (`_spawn`/`_kill`/`_isPidAlive`/`_readPidFile`/`_removePidFile`/`_now`/`_sleep`/`_platform`/`_kodoBin`/`_execPath`) — 12 unit subtests drive every branch without real processes/FS. never-throws (discriminated result objects, no throws).

### Task 2 — `src/daemon/run.js` (`runDaemon()` compose funnel, D-01/D-05/D-06)
The single foreground funnel `kodo up` and launchd/`brew services` will invoke:
- Declares outer mutable `server`/`stopReconcile`/`polling`; registers `SIGTERM`/`SIGINT` handlers **FIRST** (before the startServer await — early-signal safe).
- `startServer({managed:true})` wrapped in try/catch: throw (KODO_SETUP_REQUIRED / provider.init) → `log('[kodo] daemon start failed: …')` + `teardown(1)` — a clean logged surface, never an uncaught crash (**Pitfall 4**; real setup-mode deferred to Phase 68).
- **Conditional** `startPolling` only when `providerUsesPolling(config)` (**D-06**: github pull; plane webhook push → server only). `startPolling` is an **in-process timer (D-01)** — no child spawn.
- Writes ONE `~/.kodo/kodo.pid` via `writePidFile({pid, started_at, kind:'daemon'}, 'kodo')` (Plan 01 signature: payload first, name trailing) for the ONE composed process, then `await block()` (blocks forever).
- **Single-owner teardown (D-05):** idempotent `teardown` (via `tornDown` flag) → `polling.stop()` + `stopReconcile()` + `server.close()` + `removePidFile('kodo')` + `exit` — exactly once; a second signal is a no-op (no double teardown). The managed server installs no handlers (Plan 02 gate 4), so there is exactly one owner.

## Verification

- `node --test test/daemon/lifecycle.test.js test/daemon/run.test.js` → 16 tests / 6 suites, all green (UP-04).
- `npm test` (full suite) → **1672 pass / 0 fail / 1 pre-existing skip** (was 1656 at Wave-1 merge; +16 new, **zero regression** on polling.test.js / stop.test.js / shared PID+HOME primitives).
- `package.json` unchanged (zero-new-deps invariant LOCKED).

## TDD Gate Compliance

Each task followed RED → GREEN:
- Task 1: `test(65-03)` `1d57c29` (RED, module missing) → `feat(65-03)` `a01de1d` (GREEN, 12/12).
- Task 2: `test(65-03)` `0c1b48c` (RED, module missing) → `feat(65-03)` `7ffc206` (GREEN, 4/4).
- No REFACTOR commit needed (implementations minimal/surgical).

## Threat Mitigations Applied

- **T-65-07 (DoS / double teardown):** run.js is the SOLE owner of SIGTERM/SIGINT/exit (D-05); idempotent `tornDown` flag guards against double teardown; managed server installs no handlers.
- **T-65-08 (stale PID kill):** `stopDaemon` reads PID + `isPidAlive` before SIGTERM; stale → `removePidFile`, not a blind kill; ESRCH → stale cleanup.
- **T-65-09 (kodo.pid perms):** `writePidFile('kodo')` inherits chmod 0o600 pre-rename (Plan 01); daemon payload carries only pid/started_at/kind — no secrets.
- **T-65-10 (detached spawn PATH lookup):** `startDaemon` spawns `process.execPath` + absolute `KODO_BIN`, argv array form (no shell/PATH lookup) — inherited from polling.js:283-303.
- **T-65-SC:** zero package installs — invariant held.

## Deviations from Plan

None affecting behavior. Two design refinements within the plan's latitude:
1. **[Rule 3 — Blocking] Bounded wait restructured to do-while.** The initial `while (now() < deadline)` skipped the PID read entirely under an injected step-clock (deadline crossed before the first read), so the instant-spawn happy path reported `timedOut`. Changed to do-while so exactly one mandatory read precedes the deadline check. Behaviorally identical under a real clock; fixed within Task 1 GREEN (`a01de1d`).
2. **stdio default `'ignore'` + injectable `_logFd`.** The plan's spawn snippet shows `stdio:['ignore', fd, fd]`; keeping lifecycle.js generic (D-02) I defaulted stdio to `'ignore'` with a `_logFd` DI seam rather than importing polling's logfile lifecycle — the Phase 66 consumer can supply an fd.

## Known Stubs

None. Both modules are fully wired against the real Wave-1 primitives (`readPidFile`/`writePidFile`/`removePidFile` with `'kodo'`, `providerUsesPolling`, `startServer({managed})`, `startPolling`). Not yet wired into `cli.js` — that is Plan 04 by design (this plan explicitly must NOT wire `kodo daemon run`).

## Self-Check: PASSED

- FOUND: src/daemon/lifecycle.js
- FOUND: src/daemon/run.js
- FOUND: test/daemon/lifecycle.test.js
- FOUND: test/daemon/run.test.js
- FOUND commit: 1d57c29 (Task 1 RED)
- FOUND commit: a01de1d (Task 1 GREEN)
- FOUND commit: 0c1b48c (Task 2 RED)
- FOUND commit: 7ffc206 (Task 2 GREEN)

---
*Phase: 65-daemon-lifecycle-foundation*
*Completed: 2026-07-02*
