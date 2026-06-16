---
phase: 53-fontaner-a-src-adopt-js
verified: 2026-06-16T11:22:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 53: Fontanería `src/adopt.js` — Verification Report

**Phase Goal:** Existe la base determinista 0-token de la adopción — el inverso exacto de `manager.launchWorkItem` (`createTask → addSession`). Módulo top-level provider-agnostic que los tres consumidores reusan sin poseer; nunca usa LLM, nunca rompe la invariante "reconcileTick único escritor de `alive`".
**Verified:** 2026-06-16T11:22:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | BIDIR-03: `src/adopt.js` exists top-level, exports `adoptSession` + `buildSessionFromAdoption` + `sanitizeAdoptionData`; returns 5-state never-throws discriminant; seeds row via `addSession`; imports only `state.js` + `node:` builtins | ✓ VERIFIED | File at `src/adopt.js` (252 lines). `grep "^export" src/adopt.js` → 3 named exports confirmed. `grep "^import"` → only `./session/state.js`, `node:path`, `node:os`. Discriminant documented and exercised across 5 codes. |
| 2 | `buildSessionFromAdoption` omits reconcile-owned fields (`dead_since`/`last_seen_alive`/`alive`) and all GSD-only fields — `reconcileTick` remains sole writer of `alive` | ✓ VERIFIED | `node -e "import('./src/adopt.js')..."` one-liner exits 0 confirming omission invariant. Test at line 344 asserts absence of 12 reconcile/GSD fields by name. `status: 'running'` literal confirmed. |
| 3 | BIDIR-04: Idempotency guard via `findSession({workspaceRef,cwd})` with fresh `loadState` BEFORE the POST; re-run returns `ALREADY_ADOPTED` without creating a second task | ✓ VERIFIED | `adoptSession` line 203: `findSessionFn({ workspaceRef, cwd })` executes before line 217 `createTask`. Test case at line 136 uses a call-counter and asserts `calls === 1` after two sequential adopts. |
| 4 | BIDIR-05: POST-first / local-write-last; `saveState` is atomic (tmp+rename with unique tmp name); `PERSIST_FAILED` returned as discriminant code carrying `task_id` + `task_url`; `.bak` migration path unaffected | ✓ VERIFIED | `state.js:242-257`: saveState writes to `STATE_PATH + '.tmp.' + pid + '.' + randomUUID()` then `renameSync`. PERSIST_FAILED at adopt.js:238-246 carries `task_id`, `task_url`, `hint`. `save-state-atomic.test.js` 3/3 pass: no `.tmp` residue, round-trip deepEqual, one `.bak.*` snapshot. |
| 5 | BIDIR-08: `sanitizeAdoptionData` defaults title to `basename(cwd)`, redacts home→`~` with boundary anchor (CR-01 fix), strips absolute paths, never embeds transcript (structural); CR-01 regression tests exist and pass | ✓ VERIFIED | `sanitizeAdoptionData` uses `new RegExp(esc + '(?=$|\/|\\s)', 'g')` for boundary-anchored home redaction (not naive split). Abs-path regex `(?<lead>^|[\s([{=,:])(?:...url...|...path...)` with URL-first alternation. `test/adopt.test.js` contains 6 CR-01-tagged cases; `node --test test/adopt.test.js` → 20/20 pass. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/adopt.js` | `adoptSession` + `buildSessionFromAdoption` + `sanitizeAdoptionData` exports; ≥60 lines | ✓ VERIFIED | 252 lines, 3 named exports, all substantive |
| `src/session/state.js` | `saveState` upgraded to tmp+rename atomic write; `renameSync` in import + body | ✓ VERIFIED | Line 2: `renameSync` in import. Lines 249-252: unique tmp name + `renameSync(tmp, STATE_PATH)`. |
| `test/adopt.test.js` | BIDIR-03/04/05/08 coverage; `ALREADY_ADOPTED` asserted; HOME-isolated dynamic import | ✓ VERIFIED | 20 it() cases; `process.env.HOME = tmpHome` at line 67 precedes `await import('../src/adopt.js')` at line 70. Contains `ALREADY_ADOPTED`, `PERSIST_FAILED`, `CREATE_FAILED`, `UNSUPPORTED`, sanitizer and omission-invariant cases. |
| `test/state/save-state-atomic.test.js` | Atomicity + .bak-independence regression; ≥3 it() cases | ✓ VERIFIED | 3 cases: no-.tmp-residue, durable round-trip, .bak-independence. All 3/3 pass. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/adopt.js` | `src/session/state.js` findSession/addSession | `from './session/state.js'` import | ✓ WIRED | Line 23: `import { findSession, addSession } from './session/state.js'` |
| `adoptSession` | `provider.createTask` | `typeof provider.createTask !== 'function'` gate then POST | ✓ WIRED | Lines 174 + 217 |
| `adoptSession` PERSIST_FAILED | orphan recovery | detail carries `task_id` + `task_url` + re-run hint | ✓ WIRED | Lines 239-244 |
| `saveState` | `node:fs renameSync` | tmp sibling write then atomic rename | ✓ WIRED | `state.js:249-252` |
| `saveState` → `migrateStateIfNeeded` `.bak` path | independent `writeFileSync` | separate inline call at state.js:203 | ✓ WIRED | `.bak` path uses own `writeFileSync(STATE_PATH + '.bak.' + ts, ...)` never routed through `saveState` |

---

### Data-Flow Trace (Level 4)

Not applicable — `src/adopt.js` is an orchestrator/I/O module, not a rendering component. Data flow is verified through unit tests: `adoptSession` seeds state via `addSession` (confirmed by the `ok:true` case reading back the state.json row in `save-state-atomic.test.js` case 1) and returns `{ ok, task, session }` to the caller.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `adoptSession` discriminant never-throws + omission invariant | `node -e "import('./src/adopt.js').then(m=>{const s=m.buildSessionFromAdoption({...}); if(s.dead_since!==undefined...)process.exit(1); ..."` | `OMISSION_INVARIANT_OK` | ✓ PASS |
| Full adopt test suite | `node --test test/adopt.test.js` | 20 pass, 0 fail | ✓ PASS |
| Atomic state test suite | `node --test test/state/save-state-atomic.test.js` | 3 pass, 0 fail | ✓ PASS |
| Full npm test suite | `npm test` | 1358 pass, 0 fail, 1 skip | ✓ PASS |

---

### Probe Execution

No probes declared in PLAN files and no `scripts/*/tests/probe-*.sh` found for this phase. Step 7c: SKIPPED (no probes).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| BIDIR-03 | 53-02 | `src/adopt.js` fontanería + discriminante never-throws 5-state | ✓ SATISFIED | `adoptSession` exports verified, 5-state discriminant confirmed in code and tested (UNSUPPORTED, ALREADY_ADOPTED, CREATE_FAILED, PERSIST_FAILED, ok:true). Top-level, not under `src/gsd/`. |
| BIDIR-04 | 53-02 | Guard idempotencia — `findSession({workspaceRef,cwd})` BEFORE POST; ALREADY_ADOPTED without second createTask | ✓ SATISFIED | Lines 203-205 in `adoptSession`; test call-counter asserts `calls === 1` after re-adopt. |
| BIDIR-05 | 53-01 + 53-02 | Atomicidad: POST-first/local-write-last; tmp+rename atomic `saveState`; PERSIST_FAILED LOUD with task_id+task_url | ✓ SATISFIED | `saveState` tmp+rename with unique pid+UUID suffix (WR-01 fix). PERSIST_FAILED detail shape verified. 3-case regression test green. |
| BIDIR-08 | 53-02 | Sanitización: title default `basename(cwd)`, home→`~`, abs-path strip, no transcript | ✓ SATISFIED | `sanitizeAdoptionData` boundary-anchored regex (CR-01 fix). 6 CR-01 regression tests pass. No transcript parameter (structural backstop confirmed by test at line 311). |

All 4 requirement IDs claimed in PLAN frontmatter verified. No orphaned requirements for this phase.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No blockers or warnings found |

**Noted/deferred items (per phase instructions — not phase failures):**

- **WR-05** (pre-existing `loadState` corruption fallback in `state.js`) — pre-existing behavior, not introduced in Phase 53. Deliberately deferred as out of scope.
- **Info findings** (3 minor) from post-execution code review — deferred by the reviewer as non-blocking and out of scope.

No `TBD`, `FIXME`, or `XXX` debt markers found in files modified by this phase (`src/adopt.js`, `src/session/state.js`, `test/adopt.test.js`, `test/state/save-state-atomic.test.js`).

---

### Human Verification Required

None. All must-haves are verifiable programmatically. No visual, real-time, or external service behaviors in scope for this phase.

---

### Gaps Summary

No gaps. All 5 observable truths are VERIFIED, all 4 artifacts are WIRED and substantive, all 4 requirement IDs are satisfied, the full test suite is green (1358/1359 pass, 1 pre-existing skip), and no debt markers are present in phase-modified files.

The CR-01 fix (boundary-anchored `redactPaths` regex replacing the naive `split/join`) and the WR-01/WR-02 improvements (unique tmp name per write, explicit `.tmp` cleanup on failure) landed in the post-execution commits referenced in the phase instructions and are fully reflected in the verified codebase.

---

_Verified: 2026-06-16T11:22:00Z_
_Verifier: Claude (gsd-verifier)_
