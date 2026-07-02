---
phase: 65-daemon-lifecycle-foundation
plan: 04
subsystem: daemon
tags: [daemon, cli, commander, foreground, sigterm, integration-test, node-test, hidden-subcommand]

# Dependency graph
requires:
  - phase: 65-daemon-lifecycle-foundation (Plan 03)
    provides: "runDaemon() compose funnel exported from src/daemon/run.js (server + conditional polling in ONE process, single-owner SIGTERM/SIGINT teardown + exit)"
  - phase: 65-daemon-lifecycle-foundation (Plan 01)
    provides: "name-parametrized PID primitives (getPidPath/writePidFile/removePidFile 'kodo')"
  - phase: 65-daemon-lifecycle-foundation (Plan 02)
    provides: "startServer({managed:true}) — throws KODO_SETUP_REQUIRED instead of process.exit; KODO_DEV=1 bypasses the webhook-secret gate"
provides:
  - "src/cli.js: hidden `kodo daemon run` subcommand under an internal `daemon` group; action lazy-imports and awaits runDaemon() (no process.exit — runDaemon owns the exit, D-05)"
  - "test/daemon/daemon-run-integration.test.js: process-level proof of UP-04 (spawn real binary, foreground blocks + writes kodo.pid, clean SIGTERM exit 0 + kodo.pid removed)"
affects: [66-kodo-up, 66-stop-status, launchd, brew-services, daemon]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hidden internal entrypoint: commander 13.1.0 `{ hidden: true }` options-object form keeps `daemon run` out of operator help while remaining invokable by kodo up / launchd (Phase 66)"
    - "Lazy `await import('./daemon/run.js')` inside the action (mirror polling group at cli.js:442) — parent CLI does not pay the daemon stack cost for unrelated commands"
    - "Action awaits runDaemon and NEVER calls process.exit — the foreground funnel is the single owner of the exit (D-05); a process.exit would defeat foreground supervisability"
    - "Process-level integration test: free ephemeral port injected into fixture config.server.port to avoid EADDRINUSE with a real kodo on :9090 (which under managed → teardown(1) → false RED)"
    - "github provider chosen for the offline test because its init() is a complete no-op (D-19); plane's init() hits the network"

key-files:
  created:
    - test/daemon/daemon-run-integration.test.js
  modified:
    - src/cli.js

key-decisions:
  - "Test provider = github: github init() is a no-op (providers/github/provider.js:118, D-19) so startServer({managed}) resolves fully offline; plane would require a network warm-cache init"
  - "Inject a free ephemeral port into the fixture config.server.port (findFreePort via net.createServer(0)) so the composed server's listen never collides with a real daemon on :9090 — a collision under managed would teardown(1) and never write kodo.pid, faking a RED"
  - "early-exit guard in the poll loop: if the child dies before writing kodo.pid, fail fast with captured stderr instead of hanging the 3s poll until timeout"
  - "Direct join(tmpHome,'.kodo','kodo.pid') for the expected PID path (equals getPidPath('kodo') under HOME=tmpHome) — mirrors the polling.test.js molde and keeps the assertion hermetic without mutating the parent process HOME"

patterns-established:
  - "Pattern: hidden commander subcommand as an internal machine-only entrypoint (visible group, hidden action) — the Phase 66 detach/supervisor target"
  - "Pattern: full-process spawn integration test as the load-bearing proof that a foreground daemon blocks and tears down cleanly (the one behavior DI unit tests cannot prove)"

requirements-completed: [UP-04]

coverage:
  - id: I1
    description: "kodo daemon run spawned HOME-isolated writes ~/.kodo/kodo.pid and the child stays alive (foreground blocks, no self-detach)"
    requirement: "UP-04"
    verification:
      - kind: integration
        ref: "test/daemon/daemon-run-integration.test.js#foreground supervisable"
        status: pass
    human_judgment: false
  - id: I2
    description: "SIGTERM to the spawned daemon → clean exit 0 within 5s AND ~/.kodo/kodo.pid removed (single-owner teardown, D-05)"
    requirement: "UP-04"
    verification:
      - kind: integration
        ref: "test/daemon/daemon-run-integration.test.js#foreground supervisable"
        status: pass
    human_judgment: false

# Metrics
duration: ~2min
completed: 2026-07-02
status: complete
---

# Phase 65 Plan 04: Wire `kodo daemon run` (hidden foreground entrypoint) Summary

Wires the internal `kodo daemon run` entrypoint (D-02) — a hidden commander subcommand whose action lazy-imports and awaits `runDaemon()` (Plan 03) with no `process.exit` — and proves UP-04 end to end with a process-level integration test that spawns the real binary, confirms the daemon blocks in the foreground (writes `~/.kodo/kodo.pid`, stays alive), and shuts down cleanly on SIGTERM (exit 0 ≤5s, `kodo.pid` removed).

## Performance

- **Duration:** ~2 min (execution window; recorded start 2026-07-02T00:23:08Z → 00:24:53Z)
- **Tasks:** 2 (test-first: Task 1 RED, Task 2 GREEN)
- **Files:** 2 (1 created test, 1 surgical additive edit to `src/cli.js`)

## What Was Built

### Task 1 — `test/daemon/daemon-run-integration.test.js` (process-level, RED until wired)
Process-level test mirroring the spawn HOME-isolation molde of `test/cli/polling.test.js:12-27` + `:177-197`:
- Seeds an isolated `HOME` (`mkdtempSync`) with `~/.kodo/config.json` (**provider github**, a **free ephemeral port** injected into `server.port`) + `~/.kodo/.env` with a fake `GITHUB_TOKEN`. github chosen because its `init()` is a **complete no-op** (D-19, `providers/github/provider.js:118`) so `startServer({managed})` resolves **offline** — plane's `init()` warms a cache over the network.
- `spawn(process.execPath, [KODO_BIN,'daemon','run'], { env:{ ...process.env, HOME:tmpHome, KODO_DEV:'1', GITHUB_TOKEN:'' } })`. `KODO_DEV=1` clears the managed webhook-secret gate (`server.js:427`).
- Polls ≤3s for `tmpHome/.kodo/kodo.pid` (== `getPidPath('kodo')` under the isolated HOME); an **early-exit guard** fails fast with captured stderr if the child dies before writing the PID (instead of hanging until the poll timeout).
- Asserts the child is **still alive** after a 300ms delay (`exitCode`/`signalCode` both `null`) — the foreground funnel blocks and does NOT self-detach (UP-04).
- `child.kill('SIGTERM')` → waits for `'exit'` with a bounded ≤5s timeout → asserts **exit 0** AND that `kodo.pid` was **removed** by the single-owner teardown.
- Hermetic: `afterEach` always SIGKILLs a surviving child and `rmSync`s the tmp HOME even on assertion failure.
- **Free-port rationale:** the composed server does `server.listen(config.server.port)` (default `:9090`); injecting a free port avoids EADDRINUSE with a real running kodo which, under managed, would `teardown(1)` and never write `kodo.pid` — a false RED.
- Under current code the test failed with `unknown command 'daemon'` — the expected RED for Task 2.

### Task 2 — `src/cli.js` (hidden `kodo daemon run` wired to runDaemon)
Surgical, additive edit mirroring the polling group shape (`cli.js:442`):
- `const daemon = program.command('daemon').description('Internal daemon lifecycle');`
- `daemon.command('run', { hidden: true }).description('Run the composed daemon (server + polling) in the foreground').action(async () => { const { runDaemon } = await import('./daemon/run.js'); await runDaemon(); });`
- commander 13.1.0 `{ hidden: true }` options-object form keeps `run` out of `kodo daemon --help` while remaining invokable (verified: `daemon` shows in top-level help; `run` absent from the `daemon` subhelp).
- The action **only awaits runDaemon** — NO `process.exit`: runDaemon blocks forever and is the single owner of the exit (D-05); a `process.exit` here would defeat the foreground funnel.
- Lazy `await import('./daemon/run.js')` so the parent CLI does not pay the daemon stack cost for unrelated commands.
- No `kodo up`/detach/stop/status introduced — correctly deferred to Phase 66. start/stop/polling wiring untouched.

## Verification

- `node --test test/daemon/daemon-run-integration.test.js` → **1 test / 1 suite green** (UP-04 process-level proof; RED→GREEN across the two commits).
- `npm test` (full suite) → **1673 pass / 0 fail / 1 pre-existing skip** (was 1672 at the Wave-1/Plan-03 merge; +1 new integration test, **zero regression** on polling/stop/server suites).
- `kodo daemon --help` confirms `run` is hidden; `kodo --help` shows the `daemon` group.
- `package.json` unchanged (zero-new-deps invariant LOCKED).

## TDD Gate Compliance

Test-first RED → GREEN:
- Task 1: `test(65-04)` `954ea8e` (RED — `unknown command 'daemon'`).
- Task 2: `feat(65-04)` `648b607` (GREEN — integration test passes, full suite green).
- No REFACTOR commit needed (wiring minimal/surgical).

## Threat Mitigations Applied

- **T-65-11 (EOP / self-detach):** the action awaits `runDaemon()` with no spawn/PATH-lookup — foreground-only this phase; detach is Phase 66. `run` is hidden, reducing accidental direct operator invocation.
- **T-65-12 (DoS / crash-loop):** the integration test asserts the child stays ALIVE in the foreground (does not self-detach/exit), which is the load-bearing proof against the launchd crash-loop pitfall for Phase 66.
- **T-65-13 (Windows non-POSIX detach/SIGTERM):** accepted/deferred — the Phase 65 foreground path is cross-platform; the launchd/detach Windows guard is Phase 66.
- **T-65-SC (package installs):** zero package installs — invariant held.

## Deviations from Plan

None affecting behavior. Two test-hardening refinements within the plan's latitude:
1. **[Rule 2 — Robustness] Free ephemeral port injected into the fixture.** The plan's fixture did not pin a port; the composed server listens on `config.server.port` (default `:9090`). Without a free port the test would EADDRINUSE against a developer's running kodo, producing `teardown(1)` and a false RED. Added `findFreePort()` (net.createServer(0)) and seeded `server.port` in the fixture config for hermeticity.
2. **[Rule 2 — Robustness] Early-exit guard in the PID poll loop.** If the child dies before writing `kodo.pid`, the poll now fails fast with the captured child stderr instead of spinning to the 3s timeout with an opaque message — sharper diagnostics on future regressions.

## Known Stubs

None. `kodo daemon run` is fully wired to the real `runDaemon()` funnel; the integration test exercises the full Wave 1→3 stack (server compose + conditional polling + name-parametrized PID primitives) against a real child process.

## Self-Check: PASSED

- FOUND: test/daemon/daemon-run-integration.test.js
- FOUND: src/cli.js
- FOUND: .planning/phases/65-daemon-lifecycle-foundation/65-04-SUMMARY.md
- FOUND commit: 954ea8e (Task 1 RED)
- FOUND commit: 648b607 (Task 2 GREEN)

---
*Phase: 65-daemon-lifecycle-foundation*
*Completed: 2026-07-02*
