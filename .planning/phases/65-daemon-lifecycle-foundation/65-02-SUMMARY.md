---
phase: 65-daemon-lifecycle-foundation
plan: 02
subsystem: infra
tags: [daemon, http-server, pid, signals, eaddrinuse, dependency-injection, node-test]

# Dependency graph
requires:
  - phase: 65-daemon-lifecycle-foundation (Plan 01)
    provides: name-parametrized PID primitives (getPidPath/writePidFile 'kodo') + providerUsesPolling
provides:
  - "startServer({ managed:true }) opt-in mode with four load-bearing points gated behind if(opts.managed)"
  - "Managed returns { server, stopReconcile } closeable handle for run.js single-owner teardown (D-05)"
  - "Discriminated errors: KODO_SETUP_REQUIRED (misconfig) + EADDRINUSE (port collision) — no process.exit, no uncaught throw"
  - "Optional DI seam startServer({ _loadConfig, _provider }) — managed path unit-testable offline"
  - "UP-06 legacy regression golden locking kodo start byte-identical behavior"
affects: [66-kodo-up, 66-stop-status, 68-setup-mode, run.js, daemon]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gated-refactor: opt-in mode flag (managed) with every behavior change behind if(opts.managed); default falsy = byte-identical legacy"
    - "DI seam mirror of config.js:233 isReportToProviderEnabled(_loadConfig) — optional _loadConfig/_provider for offline unit tests"
    - "Discriminated errors via Object.assign(new Error(msg), { code }) instead of process.exit — makes fail paths assert.rejects-testable"
    - "server.on('error') registered BEFORE server.listen, wrapped in a Promise resolving on 'listening' / rejecting on 'error'"

key-files:
  created:
    - test/cli/kodo-start-regression.test.js
    - test/server-managed.test.js
  modified:
    - src/server.js

key-decisions:
  - "Managed misconfig throws { code:'KODO_SETUP_REQUIRED' }; Phase 65 only guarantees no in-process exit — setup mode is deferred to Phase 68"
  - "Managed EADDRINUSE mapped to a typed error carrying node's err.code, surfaced via server.on('error') before listen"
  - "Legacy branch left entirely untouched (separate if/else branch for the listen block) rather than editing it — zero regression risk"
  - "EADDRINUSE test blocker binds all interfaces (no host) to match server.listen(port)'s 0.0.0.0 bind for deterministic collision on macOS"

patterns-established:
  - "Pattern: opt-in mode gate keeps legacy byte-identical while adding managed behavior (UP-06 safety criterion)"
  - "Pattern: DI seam lets a network-touching startup path (provider.init) run offline in unit tests"

requirements-completed: [UP-04, UP-06]

coverage:
  - id: D1
    description: "startServer({managed:true}) on missing webhook secret throws KODO_SETUP_REQUIRED without process.exit (runner survives)"
    requirement: "UP-04"
    verification:
      - kind: unit
        ref: "test/server-managed.test.js#(1) missing secret → throws KODO_SETUP_REQUIRED without process.exit"
        status: pass
    human_judgment: false
  - id: D2
    description: "startServer({managed:true}) on a bound port rejects a typed EADDRINUSE error via server.on('error') — no uncaught exception"
    requirement: "UP-04"
    verification:
      - kind: unit
        ref: "test/server-managed.test.js#(2) port already bound → rejects EADDRINUSE via server.on(error)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Managed returns { server, stopReconcile }, writes no server.pid, and installs no self SIGTERM/SIGINT handlers"
    requirement: "UP-04"
    verification:
      - kind: unit
        ref: "test/server-managed.test.js#(3+4) happy path → { server, stopReconcile }, no server.pid, no self signal handlers"
        status: pass
    human_judgment: false
  - id: D4
    description: "Legacy kodo start (managed:false) byte-identical: writes server.pid, exits 1 on missing secret, never writes kodo.pid"
    requirement: "UP-06"
    verification:
      - kind: unit
        ref: "test/cli/kodo-start-regression.test.js#(1) writes ~/.kodo/server.pid — legacy self-PID intact"
        status: pass
      - kind: integration
        ref: "test/cli/kodo-start-regression.test.js#(2) exits with code 1 when no webhook secret — fail-fast legacy intact"
        status: pass
      - kind: unit
        ref: "test/cli/kodo-start-regression.test.js#(3) never writes ~/.kodo/kodo.pid — daemon PID isolation"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-02
status: complete
---

# Phase 65 Plan 02: startServer({managed}) Refactor Summary

**startServer gains an opt-in `managed` mode gating four load-bearing points (throw KODO_SETUP_REQUIRED instead of process.exit, typed EADDRINUSE via server.on('error'), no self server.pid, no self SIGTERM/SIGINT), returns { server, stopReconcile }, and adds a _loadConfig/_provider DI seam — while `kodo start` legacy stays byte-identical (UP-06 golden green before and after).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-02T01:57:00Z
- **Completed:** 2026-07-02T02:09:00Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- UP-06 regression golden written FIRST against current code and proven green (server.pid present, exit-1 on missing secret, kodo.pid absent) — the load-bearing safety net for the risky refactor.
- `startServer({ managed:true })` implemented with all four points gated behind `if (opts.managed)`: (1) misconfig throws `KODO_SETUP_REQUIRED` (no `process.exit`), (2) `server.on('error')` before `listen` maps EADDRINUSE to a typed reject, (3) no self `server.pid`, (4) no self `SIGTERM`/`SIGINT` handlers.
- Managed returns `{ server, stopReconcile }` so run.js (Plan 03) can compose a single-owner teardown (D-05).
- Optional DI seam `_loadConfig`/`_provider` (mirror `isReportToProviderEnabled(_loadConfig)`) makes the managed path unit-testable offline — no `provider.init()` network hit.
- Full suite green (1656 pass / 0 fail / 1 pre-existing skip) — zero collateral regression.

## Task Commits

Each task was committed atomically:

1. **Task 1: UP-06 legacy regression golden** - `ef14c6f` (test)
2. **Task 2 (RED): failing managed-mode unit** - `6aba2cd` (test)
3. **Task 2 (GREEN): startServer({managed}) refactor** - `96234b4` (feat)

_TDD Task 2: RED (`6aba2cd`) → GREEN (`96234b4`). No REFACTOR commit needed — implementation was already surgical/clean._

## Files Created/Modified
- `test/cli/kodo-start-regression.test.js` - UP-06 golden: 3 assertions (in-process server.pid present + kodo.pid absent; spawnSync exit-1 on missing secret), HOME-isolated.
- `test/server-managed.test.js` - UP-04 managed unit: KODO_SETUP_REQUIRED, EADDRINUSE, no server.pid, no self signal handlers, returns { server, stopReconcile }; DI seam for offline run.
- `src/server.js` - `startServer(opts)` extended with `managed` + `_loadConfig`/`_provider`; four gated points; managed return handle.

## Decisions Made
- Managed misconfig throws `KODO_SETUP_REQUIRED` (discriminated error, code-only, no secret value leaked — T-65-06); Phase 65 guarantees only "no in-process exit", setup mode deferred to Phase 68.
- Managed EADDRINUSE surfaced via `server.on('error')` registered before `listen`, wrapped in a Promise (resolves on `'listening'`, rejects on `'error'`), propagating node's `err.code`.
- Legacy `server.listen` block kept in its own untouched `else` branch (rather than editing it in place) so the legacy path is provably byte-identical.
- Managed return shape `{ server, stopReconcile }` (server is the http.Server with `.close()`; stopReconcile from server.js:605) per D-03/D-05.

## Deviations from Plan

None - plan executed exactly as written. Both tasks landed with the specified gates, DI seam, return shape, and test coverage.

## Issues Encountered
- **Managed EADDRINUSE test initially did not reject (and leaked a server → file hang/timeout).** Root cause: the test's blocker socket bound `127.0.0.1` while `server.listen(port)` in server.js binds all interfaces (0.0.0.0), so on macOS the collision was not triggered and startServer resolved, leaving an un-closed listening server that kept the test file's event loop alive. Fix: the blocker now `listen(port)` with no host (all interfaces), matching the server bind → deterministic EADDRINUSE. Resolved within Task 2 GREEN (`96234b4`); this is a test-harness correction, not a src behavior change.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `startServer({ managed:true })` is ready for `src/daemon/run.js` (Plan 03) to consume: catch `KODO_SETUP_REQUIRED`/`EADDRINUSE`, compose `{ server, stopReconcile }` into a single-owner SIGTERM teardown, and own `kodo.pid` + the process exit (D-04/D-05).
- Legacy `kodo start` proven intact (UP-06 golden) — safe base for Plan 03/04 to build on.

## Self-Check: PASSED

- FOUND: src/server.js (modified, managed branch present)
- FOUND: test/cli/kodo-start-regression.test.js
- FOUND: test/server-managed.test.js
- FOUND commit: ef14c6f (Task 1 golden)
- FOUND commit: 6aba2cd (Task 2 RED)
- FOUND commit: 96234b4 (Task 2 GREEN)

---
*Phase: 65-daemon-lifecycle-foundation*
*Completed: 2026-07-02*
