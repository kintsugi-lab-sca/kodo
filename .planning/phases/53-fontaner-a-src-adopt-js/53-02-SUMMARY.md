---
phase: 53-fontaner-a-src-adopt-js
plan: 02
subsystem: adoption-core
tags: [adoption, sesion-a-tarea, never-throws, sanitization, BIDIR-03, BIDIR-04, BIDIR-05, BIDIR-08]
requires:
  - "src/session/state.js findSession (idempotency guard, fresh read) + addSession (seed row)"
  - "Plan 53-01 atomic saveState (tmp+rename) — addSession inherits durability for the PERSIST_FAILED path"
  - "provider.createTask (Phase 52, typeof-detected, returns canonical TaskItem)"
provides:
  - "src/adopt.js — adoptSession (async orchestrator, 5-state never-throws discriminant)"
  - "buildSessionFromAdoption (pure SessionRecord builder; omits reconcile-owned + GSD fields)"
  - "sanitizeAdoptionData (pure backstop; title default + home→~ redaction + abs-path strip + no transcript param)"
affects:
  - "The single base reused (not owned) by the three future consumers: CLI (Phase 54), dashboard key (Phase 56), orchestrator (Phase 57)"
  - "reconcileTick remains sole writer of alive — seeded adoption row carries no lifecycle fields"
tech-stack:
  added: []
  patterns:
    - "5-state never-throws discriminant {ok:true,...} | {ok:false,code,detail} (mirrors dismiss.js / markSessionStatus)"
    - "DI default-param deps ({addSession,findSession}=real) for testable PERSIST_FAILED injection"
    - "pure redaction via homedir-prefix split + conservative POSIX abs-path regex with ~/./URL lookbehind"
    - "structural transcript backstop — no transcript parameter exists (defense by construction)"
key-files:
  created:
    - "src/adopt.js"
    - "test/adopt.test.js"
  modified: []
decisions:
  - "Redaction order: home→~ FIRST, then abs-path strip; lookbehind excludes ~ / . / \\w / : / so '~/secret', './x', and http(s) URL paths survive (D-06 mechanics = Claude's Discretion)"
  - "abs-path placeholder is the literal '<path>' (conservative — only /-rooted whitespace-free runs match; ordinary prose untouched)"
  - "DI via second deps arg (deps.addSession/deps.findSession) rather than HOME-only isolation — lets PERSIST_FAILED inject a throwing addSession without making the real state.json unwritable"
  - "buildSessionFromAdoption accepts cwd for signature parity with buildSessionFromTask but persists projectPath (the guard keys on project_path)"
metrics:
  duration: "~9 min"
  completed: "2026-06-16"
  tasks: 2
  files: 2
---

# Phase 53 Plan 02: Adoption core (src/adopt.js) Summary

`src/adopt.js` is the deterministic 0-token adoption core — the exact inverse of `manager.launchWorkItem` minus the cmux branch. Three functions: `adoptSession` (async orchestrator returning the 5-state never-throws discriminant), `buildSessionFromAdoption` (pure SessionRecord builder mirroring `buildSessionFromTask` but omitting reconcile-owned + GSD fields), and `sanitizeAdoptionData` (pure backstop that defaults the title, redacts the home dir to `~`, strips absolute paths, and structurally cannot forward a transcript). Provider-agnostic and host-agnostic: it imports only `state.js` + `node:` builtins, never cmux/host/logger.js.

## What Was Built

### Task 1 — `test/adopt.test.js` (RED gate)
- HOME-isolation dynamic-import scaffold (mirror `test/session/find-session.test.js:76-103`): `process.env.HOME = tmpHome` set BEFORE `await import('../src/adopt.js')` so the transitively-imported `state.js` caches an isolated `STATE_PATH` (Pitfall 5). `afterEach` rewrites a clean `{schema_version:3, sessions:{}, history:[]}`.
- 11 `it()` cases covering all six required behaviors plus the pure-shape invariant: UNSUPPORTED (createTask never reached), ok:true seeds row + reconcile/GSD omission invariant, ALREADY_ADOPTED (createTask call-counter === 1), PERSIST_FAILED (DI-injected throwing addSession, asserts `detail.task_id` + `detail.task_url`), CREATE_FAILED (provider throws), and four `sanitizeAdoptionData` cases (title default = `basename(cwd)`, `${home}/secret → ~/secret`, non-home abs-path stripped, structural no-transcript).
- Ran RED before Task 2 (module-missing). Commit: `8b84496`

### Task 2 — `src/adopt.js` (GREEN gate)
- `adoptSession({...}, deps={})`: order is typeof-gate → `sanitizeAdoptionData` → `findSession({workspaceRef,cwd})` guard (fresh read, internal `loadState()`) → `createTask` (try/catch → CREATE_FAILED) → `buildSessionFromAdoption` → `addSession` (try/catch → PERSIST_FAILED) → `{ok:true,task,session}`. The only try/catch-to-code conversions are around `createTask` and `addSession`; nothing else throws.
- `buildSessionFromAdoption`: the 12-field SessionRecord (status literal `'running'`, `started_at` now), OMITTING reconcile-owned (`dead_since`/`last_seen_alive`/`alive`/`tab_alive`/`process_alive`/`needs_input`/`state`) and GSD (`gsd`/`gsd_mode`/`phase_id`/`brief`/`worktree_path`).
- `sanitizeAdoptionData({cwd,title,description}, homedirFn=homedir)`: pure. `title = title ?? basename(cwd)`. `redactPaths` helper: replace home prefix with `~`, then strip remaining POSIX absolute paths to the literal `<path>` via `/(?<![\w:/~.])\/[^\s/]+(?:\/[^\s]*)?/g`. No transcript parameter (structural).
- Imports: `findSession, addSession` from `./session/state.js`, `basename` from `node:path`, `homedir` from `node:os` — nothing else. Commit: `674af22`

## Verification Results

- `node --test test/adopt.test.js` → 11/11 pass.
- `npm test` (full suite, canonical runner) → **1349 pass, 0 fail, 1 skip** (the pre-existing startup-budget Decisión B skip carried from 53-01). +11 net vs the 1338 baseline of 53-01 — confirms adopt.js + the 53-01 saveState upgrade are jointly non-regressive.
- Acceptance greps: `export` count 4 (3 named exports: `sanitizeAdoptionData`, `buildSessionFromAdoption`, `adoptSession`); no `host`/`cmux`/`logger.js` IMPORT line (the only grep hits are prose in comments, not `import … from`); omission-invariant + status-literal node one-liner exits 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Absolute-path regex over-redacted the home-relative tail**
- **Found during:** Task 2 (first GREEN run — 9/11 pass, 2 sanitizer cases failing).
- **Issue:** After step (1) redacted `/Users/alex → ~`, the step-(2) abs-path strip matched the remaining `/secret` segment, producing `~<path>` instead of `~/secret`. The initial lookbehind `(?<![\w:/])` did not exclude the `~` (or `.`) we had just emitted.
- **Fix:** Extended the negative lookbehind to `(?<![\w:/~.])` so a `/segment` immediately following `~` (home-relative) or `.` (`./x`, `../x`) survives, while genuine standalone absolute paths and URL paths stay handled.
- **Files modified:** src/adopt.js (regex in `redactPaths`)
- **Commit:** `674af22` (folded into the GREEN implementation commit — the fix landed before the first passing commit).

No test assertions were weakened — the tests assert the correct D-06 behavior (`~/secret` must survive) and the regex was corrected to satisfy them.

### Note (not a deviation)
The plan's `<read_first>` references `53-PATTERNS.md`, which does not exist in the phase directory. `53-RESEARCH.md` (§Code Examples + §Common Pitfalls) supplied the full per-function pattern, field shapes, and sanitization mechanics, so no information was missing. No action warranted.

## TDD Gate Compliance

- RED gate: `test(53-02): add failing test/adopt.test.js …` → `8b84496` (ran module-missing before implementation).
- GREEN gate: `feat(53-02): implement src/adopt.js …` → `674af22` (after the RED commit).
- REFACTOR gate: none needed — the implementation is already minimal; no behavior-preserving cleanup commit was warranted.

## Threat Surface

The plan's threat register is satisfied with no new surface introduced beyond it:
- **T-53-03 (Information Disclosure — title/description → external POST):** mitigated by `sanitizeAdoptionData` (home→`~`, abs-path strip) applied BEFORE `createTask`. Core backstop — fires even if a downstream consumer fails to sanitize.
- **T-53-04 (transcript exfiltration):** mitigated structurally — `sanitizeAdoptionData` has no transcript parameter; it cannot forward a transcript body (test asserts a passed `transcript` key never appears in the output).
- **T-53-05 (provider orphan — task created, no local row):** mitigated by the LOUD `PERSIST_FAILED` discriminant carrying `task_id` + `task_url` + re-run hint; never thrown, never swallowed.
- **T-53-SC (package installs):** N/A — zero new runtime dependencies (`node:path`/`node:os` builtins + existing `state.js` exports only).

## Self-Check: PASSED

- FOUND: src/adopt.js (created — 3 exports, only state.js + node: imports)
- FOUND: test/adopt.test.js (created — 11 passing cases)
- FOUND commit 8b84496 (Task 1 — RED)
- FOUND commit 674af22 (Task 2 — GREEN)
