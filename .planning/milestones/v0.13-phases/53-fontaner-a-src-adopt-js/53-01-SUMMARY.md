---
phase: 53-fontaner-a-src-adopt-js
plan: 01
subsystem: session-state
tags: [durability, atomic-write, state-persistence, BIDIR-05]
requires:
  - "src/session/state.js saveState write chokepoint (pre-existing)"
  - "node:fs renameSync (Node builtin)"
provides:
  - "saveState atomic tmp+rename — torn writes structurally impossible"
  - "Atomicity + .bak-independence regression coverage"
affects:
  - "All state writers (addSession/updateSession/removeSession) inherit atomic durability"
  - "Plan 53-02 PERSIST_FAILED LOUD path depends on this durable write"
tech-stack:
  added: []
  patterns:
    - "tmp+rename atomic write (POSIX rename on same filesystem), inlined per-callsite (mirrors src/triggers/polling.js:149-153)"
key-files:
  created:
    - "test/state/save-state-atomic.test.js"
  modified:
    - "src/session/state.js"
decisions:
  - "Inlined tmp+rename in saveState (no shared helper) — D-05 chose in-place; matches polling.js which also inlines it"
  - "No fsync, no mkdirSync — D-05 specifies the what not the byte-for-byte how; STATE_PATH dir already exists by write time"
  - "migrateStateIfNeeded .bak path left untouched — it uses its own inline writeFileSync, never saveState (T-53-02 accept disposition)"
metrics:
  duration: "~6 min"
  completed: "2026-06-16"
  tasks: 2
  files: 2
---

# Phase 53 Plan 01: Atomic saveState (tmp+rename) Summary

saveState upgraded from a plain `writeFileSync` to an atomic `${STATE_PATH}.tmp` write + `renameSync`, making torn `state.json` writes structurally impossible (BIDIR-05 / D-05); every state writer inherits the durability transparently and the migration `.bak` snapshot path is proven unaffected.

## What Was Built

### Task 1 — saveState atomic upgrade (`src/session/state.js`)
- Added `renameSync` to the existing `import { readFileSync, writeFileSync, existsSync } from 'node:fs'` (single source — same module `polling.js` imports from).
- `saveState` body now: `const tmp = STATE_PATH + '.tmp'` → `writeFileSync(tmp, ...)` → `renameSync(tmp, STATE_PATH)`.
- Serialization byte-identical: `JSON.stringify(state, null, 2) + '\n'` (no shape change).
- Surgical: ONLY `saveState` modified. `migrateStateIfNeeded` (state.js:189-227) and its two inline `writeFileSync` calls (`.bak.<ts>` at :202, migrated write at :208) untouched.
- Commit: `c4374d9`

### Task 2 — Regression test (`test/state/save-state-atomic.test.js`)
- HOME-isolation dynamic-import scaffold (`process.env.HOME = tmpHome` before `await import('../../src/session/state.js')`) so STATE_PATH resolves to an isolated tmpdir, never the real `~/.kodo`.
- Three `it()` cases, all green:
  1. **no .tmp residue** — after `addSession` (→ `saveState`), `readdirSync` the `.kodo` dir shows no `.tmp` sibling.
  2. **durable round-trip** — `saveState` an object, `loadState`, `deepEqual` on sessions.
  3. **.bak independence** — write a v2 `state.json`, `loadState` triggers migration, exactly one file matches `/^state\.json\.bak\.\d{8}T\d{6}$/`.
- Commit: `165c924`

## Verification Results

- `node --test test/state/save-state-atomic.test.js` → 3/3 pass.
- `node --test test/state/*.test.js` (canonical glob form) → 3 suites, 11 tests, 0 fail.
- `node --test test/state/migration-backup.test.js` → 2/2 pass (`.bak` path unaffected).
- `npm test` (full suite) → **1338 pass, 0 fail, 1 skip** (pre-existing startup-budget Decisión B skip). Confirms the upgrade is signature-transparent to all consumers (reconcile, server, addSession).
- Acceptance greps: `renameSync` present in import + body; `process.env.HOME =` precedes `await import`; `.bak` regex present.

## Deviations from Plan

None — plan executed exactly as written. No bugs, no missing functionality, no blocking issues, no architectural changes.

### Note on an acceptance-criteria invocation form (not a deviation)
Two acceptance criteria phrase the runner as `node --test test/state/` (directory path). On the installed Node (v22.22.3) that form throws `MODULE_NOT_FOUND` — this Node version does not treat a bare directory argument as a recursive glob. It is **not** a test failure: the repo's own canonical runner is `node --test $(find test -name '*.test.js' -type f)` (package.json `test` script), and the glob form `node --test test/state/*.test.js` passes 11/11. The directory-path phrasing in the plan is a runner-invocation artifact, not a code regression. No source or test change was warranted.

## Threat Surface

No new security-relevant surface introduced. The plan's threat register (T-53-01 mitigate, T-53-02 accept, T-53-SC accept) is satisfied: tmp+rename mitigates the torn-write tampering boundary; the `.bak` path independence is guarded by Task 2 case 3 + the existing migration-backup test; zero new runtime dependencies (node:fs builtin only).

## Self-Check: PASSED

- FOUND: src/session/state.js (modified — renameSync in import line 2 + saveState body lines 242-244)
- FOUND: test/state/save-state-atomic.test.js (created, 3 passing cases)
- FOUND commit c4374d9 (Task 1)
- FOUND commit 165c924 (Task 2)
