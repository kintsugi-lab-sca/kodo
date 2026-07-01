---
phase: 65-daemon-lifecycle-foundation
plan: 01
subsystem: daemon
tags: [pid, daemon, polling, provider, primitives]
status: complete
requires: []
provides:
  - "getPidPath/writePidFile/readPidFile/removePidFile with optional trailing name param (default 'polling')"
  - "providerUsesPolling(config) pure helper"
affects:
  - "src/daemon/run.js (Plan 03) — imports PID primitives with 'kodo' + providerUsesPolling"
tech-stack:
  added: []
  patterns:
    - "Additive generalization via optional trailing param (payload stays first, name last)"
    - "Never-throws / fail-open (malformed config → false)"
    - "chmod 0o600 PRE-rename atomic write (preserved verbatim)"
key-files:
  created:
    - src/daemon/provider-uses-polling.js
    - test/daemon/pid-name-param.test.js
    - test/daemon/provider-uses-polling.test.js
  modified:
    - src/cli/polling-daemon.js
decisions:
  - "D-04: name is optional TRAILING param defaulting to 'polling' — every existing zero/one-arg caller stays byte-identical"
  - "D-06: providerUsesPolling = allowlist config?.provider === 'github', fail-safe false (plane uses webhook)"
metrics:
  duration: "~3 min"
  completed: 2026-07-01
  tasks: 2
  files: 4
---

# Phase 65 Plan 01: Daemon PID + Polling Primitives Summary

Two leaf primitives for the composed daemon: a name-parametrized PID module (back-compat) and the pure `providerUsesPolling(config)` polling-gate helper.

## What Was Built

### Task 1 — PID module generalized by `name` (additive, back-compat)
Added an optional TRAILING `name` parameter (default `'polling'`) to all four primitives in `src/cli/polling-daemon.js`:
- `getPidPath(name = 'polling')` — replaces the hardcoded `'polling.pid'` with `` `${name}.pid` ``. `getPidPath('kodo')` → `~/.kodo/kodo.pid`, distinct from `server.pid` and `polling.pid`.
- `writePidFile(payload, name = 'polling')` — `payload` stays FIRST so the single existing caller (`src/cli/polling.js:374`) and the single-arg test both keep passing an object as the only positional and get `name='polling'`. Atomic write recipe (writeFileSync tmp → chmodSync 0o600 PRE-rename → renameSync) preserved verbatim — did NOT switch to config.js `writeFileAtomic` (no chmod).
- `readPidFile(name = 'polling')` — defensive shape-check (pid:number + started_at:string) unchanged. The `PidFilePayload` typedef made `repos` optional and added optional `kind`, so a daemon payload `{pid, started_at, kind:'daemon'}` (no `repos`) passes the same guard without relaxing it.
- `removePidFile(name = 'polling')` — idempotent, delegates to `getPidPath(name)`.
- `PID_PATH` legacy alias untouched; exports unrenamed.

### Task 2 — `providerUsesPolling(config)` pure helper
Created `src/daemon/provider-uses-polling.js` (`// @ts-check`) exporting `providerUsesPolling(config)` returning `config?.provider === 'github'`. Explicit allowlist against the only polling-based provider of the two registered today (github has repos[] + poll_interval; plane uses webhook ingress). Never-throws / fail-open: `undefined`, `null`, `{}`, `{provider:42}` all → `false` (not starting polling is the safe failure — the server keeps serving webhooks). Pure, no imports, no FS/network.

## Verification

- `node --test test/daemon/pid-name-param.test.js test/daemon/provider-uses-polling.test.js` → green
- `node --test test/cli/polling-daemon.test.js test/cli/polling.test.js` → green (zero regression — proves the `name='polling'` default is byte-compatible for existing callers)
- Combined run: 42 tests / 9 suites, all pass.
- `package.json` unchanged (zero-new-deps invariant LOCKED).

## TDD Gate Compliance

Each task followed RED → GREEN:
- Task 1: `test(65-01)` c2e8cd2 (RED, 3 subtests failing) → `feat(65-01)` 58c6854 (GREEN).
- Task 2: `test(65-01)` ed487b0 (RED, import fails) → `feat(65-01)` de2d6eb (GREEN).
No REFACTOR commit needed (implementations minimal).

## Threat Mitigations Applied

- **T-65-01 (Info Disclosure):** chmod 0o600 PRE-rename preserved; daemon payload carries only pid/started_at/kind — no secrets.
- **T-65-02 (Tampering):** readPidFile shape-check unchanged; corrupt/injected payloads → null.
- **T-65-03 (DoS):** providerUsesPolling never-throws, fail-safe false on malformed config.
- **T-65-SC:** Zero package installs — invariant held.

## Deviations from Plan

None — plan executed exactly as written. The `PidFilePayload` typedef was widened (`repos` → optional, added optional `kind`) purely to keep `// @ts-check` accurate for the daemon payload shape the plan explicitly requires; the runtime shape-check guard was NOT changed.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/cli/polling-daemon.js
- FOUND: src/daemon/provider-uses-polling.js
- FOUND: test/daemon/pid-name-param.test.js
- FOUND: test/daemon/provider-uses-polling.test.js
- Commits verified: c2e8cd2, 58c6854, ed487b0, de2d6eb
