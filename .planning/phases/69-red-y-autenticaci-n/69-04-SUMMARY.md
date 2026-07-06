---
phase: 69-red-y-autenticaci-n
plan: 04
subsystem: red-y-autenticacion
tags: [security, path-traversal, logging, cli, docs, network-topology]
requires:
  - "src/logs/reader.js runLogs CLI edge (kodo logs <session-id>)"
  - "src/logger.js createLogger disk sink"
provides:
  - "SESSION_ID_RE allowlist guard at the logs CLI edge (hard reject, exit 2)"
  - "soft non-throwing sessionId guard in logger.js (disk sink off for hostile ids)"
  - "README 'Topología multi-nodo' section"
affects:
  - src/logs/reader.js
  - src/logger.js
  - test/logs-reader.test.js
  - README.md
tech-stack:
  added: []
  patterns:
    - "Positive allowlist /^[A-Za-z0-9_-]+$/ — hard reject at untrusted edge, soft defense-in-depth internally (Pitfall 3)"
key-files:
  created: []
  modified:
    - src/logs/reader.js
    - src/logger.js
    - test/logs-reader.test.js
    - README.md
decisions:
  - "reader.js reject is HARD (exit 2) — untrusted CLI input; logger.js guard is SOFT (no throw) to avoid killing the reconcile loop that runs createLogger with synthetic/UUID ids"
  - "Hostile id in logger.js disables the disk sink (writeNdjson no-op) rather than throwing — logger stays functional, stderr mirror preserved"
  - "README section placed after Configuración, before Uso — config/deployment topic; scoped to a single section per D-11 (full README pass is HYG-08, Phase 72)"
metrics:
  duration: 18min
  completed: 2026-07-06
  tasks: 2
  files: 4
status: complete
---

# Phase 69 Plan 04: sessionId validation + multi-node topology docs Summary

Path-traversal vector B6 closed: a `sessionId` outside `/^[A-Za-z0-9_-]+$/` is now hard-rejected (exit 2, "Invalid session id") at the `kodo logs` CLI edge before any path is built, and soft-guarded (non-throwing, disk sink disabled) inside `createLogger` so the reconcile loop and normal loggers keep working; README gains a single "Topología multi-nodo" section documenting the loopback default and the deliberate `config.server.bind` + ACL exposure path for the Plane webhook.

## What Was Built

### Task 1 — sessionId path-traversal guard (NET-05, D-10) [TDD]
- **reader.js (hard edge):** module-scope `SESSION_ID_RE = /^[A-Za-z0-9_-]+$/`; a reject added immediately after the empty-id usage guard and before the `join(KODO_DIR, 'logs', ...)` — a traversal/separator id writes `Invalid session id` to stderr and `process.exit(2)`, mirroring the existing exits, before any `readFileSync`/path join.
- **logger.js (soft defense-in-depth, Pitfall 3):** same allowlist at module scope; `createLogger` computes `diskSinkEnabled = SESSION_ID_RE.test(sessionId)`. A hostile id logs a redacted `console.warn` (never the raw id) and makes `writeNdjson` a no-op, so a hostile id can never resolve into a traversal path. No throw — `'reconcile'` and UUID ids pass the allowlist unaffected; the existing empty-sessionId throw at 241-243 is untouched.
- **Tests:** added an in-process exit-capture harness (stubs `process.exit`→throw + `process.stderr.write`) plus cases for traversal/separator/empty ids → exit 2, a valid id still dumping its log, `createLogger('reconcile')`/UUID working loggers, a hostile id not throwing and not writing outside the logs dir, and the empty-sessionId throw contract.

### Task 2 — multi-node topology README section (NET-06, D-11)
- One new `## Topología multi-nodo` section: loopback `127.0.0.1` default (unreachable from other nodes), explicit opt-in exposure via `config.server.bind` to a tailscale IP paired with an ACL/firewall, and retained auth semantics — bearer on the non-webhook rail (`401` without token), `/webhook` keeps HMAC, `/health` stays open. No broader README restructuring (deferred to HYG-08, Phase 72).

## Verification
- `node --test test/logs-reader.test.js` → 18 pass, 0 fail (was 8; +10 new/guard tests).
- Acceptance greps: `A-Za-z0-9_-` present in reader.js (1) and logger.js (2); `sessionId is required` throw intact (1); reconcile smoke `node -e "...createLogger({sessionId:'reconcile'})"` prints `ok`.
- README greps: `Topología multi-nodo` = 1, `config.server.bind` = 2, `127.0.0.1` = 1, `bearer` = 1.
- Full suite: `npm test` → 1820 pass, 1 skip, 0 fail (no regression; baseline 1788+1 grew with prior plans + this plan's tests).

## Deviations from Plan
None — plan executed exactly as written. Zero new npm dependencies (node:fs/node:path built-ins only), consistent with the T-69-SC accept disposition.

## TDD Gate Compliance
Task 1 followed RED → GREEN: `test(69-04)` commit (891876b, 5 failing guard tests) precedes `feat(69-04)` commit (35c08e4). No REFACTOR needed.

## Self-Check: PASSED
- Files exist: src/logs/reader.js, src/logger.js, test/logs-reader.test.js, README.md (all modified & committed).
- Commits present: 891876b (test), 35c08e4 (feat), 817cdb2 (docs).
