---
phase: 56-tecla-del-dashboard
verified: 2026-06-18T15:40:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
human_uat: "3/4 pass (Tests 1,3,4). Test 1 confirmed end-to-end (KODO-7 adopted via dashboard). Test 2 is an ISSUE whose root cause (reconcile liveness identifies sessions by workspace-title→task_ref; adopted sessions are titled by cmux/user) is OUT OF SCOPE for Phase 56's 3 success criteria (all met) and routed to a dedicated follow-up phase (operator decision 2026-06-18). See 56-HUMAN-UAT.md ## Cross-cutting gap — LIVENESS."
acknowledged_gaps:
  - "Adopted ad-hoc sessions show dead/zombie + get re-offered in the picker because reconcile.liveForSession keys liveness by titleIdentifiesSession(workspace.title, task_ref), which adopted sessions (user-titled cmux workspaces) never satisfy. Deferred to a dedicated phase: listWorkspaces exposes session_id → reconcile matches by stable identity with title fallback. Phase 56 success criteria (adopt key, on-demand+double-confirm, zero-endpoints+never-throws) are unaffected and met."
human_verification:
  - test: "Press `a` in the live dashboard with at least one ad-hoc cmux claude session running (not yet in state.json). Verify the picker overlay opens listing the surface(s), the cursor starts at 0, ↑/↓ move it, pressing `a` shows ADOPT_CONFIRM, a second `a` shells `kodo adopt` and on success the footer shows green `adopted <ref>…`."
    expected: "Picker opens; cursor moves; second `a` shells `kodo adopt` via execFile; green footer confirms; the adopted session appears in the next /status tick."
    why_human: "Requires a live cmux session + TTY. The full end-to-end path (host.listAgentSurfaces() → real cmux socket → real `kodo adopt` spawn) cannot be exercised without a running cmux instance. Mirror of Phase 42 dismiss double-confirm UAT."
  - test: "Press `a` when no ad-hoc claude sessions exist (all surfaces already in state.json or no claude sessions running). Verify the footer shows `no adoptable sessions found` and no picker overlay opens."
    expected: "ADOPT_NONE footer (yellow), mode stays `list`, no overlay."
    why_human: "Requires confirming live cmux + /status state combination."
  - test: "In the picker, navigate to a surface whose cwd does not map to any project in ~/.kodo/projects.json. Press `a`. Verify footer shows `[!] no/ambiguous project for <cwd>`, no onAdopt is called, and the picker closes."
    expected: "ADOPT_NO_PROJECT footer (red), picker closes, zero `kodo adopt` spawns."
    why_human: "Requires a live surface whose cwd is genuinely outside any configured project path."
  - test: "In the adopt double-confirm, press `d` (instead of the second `a`) and verify it cancels the adopt without triggering a dismiss. Then separately arm a dismiss (`d` on a dead session) and press `a` — verify it cancels the dismiss without triggering an adopt."
    expected: "Pitfall 2 (confirm-key collision) does not occur: `a` and `d` remain isolated in their respective confirm flows."
    why_human: "While app-dismiss.test.js + app-adopt.test.js (h) cover this with stubs, verifying it in a live TTY with real state confirms the isolation is perceptible to the operator."
---

# Phase 56: Tecla del Dashboard — Verification Report

**Phase Goal:** El operador descubre y adopta sesiones ad-hoc desde el dashboard con una tecla. Sesiones adoptables = surfaces con `kind == "claude"` cuyo `sessionId` no está ya en `state.json`. Success criteria (ROADMAP): (1) una tecla dedicada `a` sobre una sesión ad-hoc descubierta vía listAgentSurfaces() shellea `kodo adopt` vía execFile sin shell (argv literal, espejo de focus.js/runOpen); (2) descubrimiento on-demand al pulsar la tecla (NO poll loop) + double-confirm espejo del dismiss de Phase 42; (3) CERO endpoints nuevos en src/server.js (preserva el invariante "cero endpoints nuevos desde v0.10") y never-throws (el panel ink permanece montado).
**Verified:** 2026-06-17T11:42:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Tecla `a` shellea `kodo adopt` vía execFile sin shell con argv literal (8 elems) via process.execPath + resolved kodoBin | VERIFIED | `adopt.js:95-107` — argv literal `[kodoBin, 'adopt', '--workspace', ref, '--cwd', cwd, '--session-id', sid, '--project', pid]`; `exec(execPath, argv, ...)`. `adopt.test.js` asserts `cmd === process.execPath`, `args[0] === kodoBin`, exact ordering. 5/5 tests pass. |
| 2  | Descubrimiento on-demand al pulsar `a` (NO poll loop); double-confirm armado por sessionId espejo de Phase 42 | VERIFIED | `App.js:822-845` — handler `a` in list mode awaits `onAdoptDiscover?.()` on keypress only; no usePoll involvement. `armedSessionId` set at `App.js:523` (by sessionId identity). `app-adopt.test.js` scenarios (c)+(d) pass. |
| 3  | CERO endpoints nuevos en src/server.js | VERIFIED | `git log --since=2026-06-17 -- src/server.js` returns empty. Discovery wired in-process via `getHost('cmux')` in `index.js:136`. |
| 4  | never-throws — el panel ink permanece montado | VERIFIED | `runAdopt` wraps the entire body in `new Promise((resolve) => { try { ... } catch (err) { resolve({ok:false,...}) } })`. Never rejects. Adopted in `App.js:574` via `await onAdopt?.(armedSurface)` with no outer try/catch needed. CR-01 fix in `select.js:389` ensures `resolveProjectId` never throws synchronously on malformed projects.json. |
| 5  | computeAdoptable: kind==='claude' filter + set-difference keyed by sessionId (never workspaceRef) | VERIFIED | `select.js:342-345` — `tracked = new Set(statusSessions[].session_id)`; filter: `s.kind === 'claude' && s.sessionId && !tracked.has(s.sessionId)`. 24/24 unit tests pass including workspaceRef-ignored scenario. |
| 6  | resolveProjectId never-throws; CR-01 fix (non-string values filtered) | VERIFIED | `select.js:385-389` — `typeof cwd === 'string' ? norm(cwd) : ''` + `.filter(([, path]) => typeof path === 'string')`. Prevents sync TypeError into React from corrupted projects.json. |
| 7  | Dismiss confirm and adopt confirm never collide (Pitfall 2); mode typedef stays at 4 states | VERIFIED | `App.js:556-631` — confirm branch routes `armedSessionId != null` FIRST (line 562) before `if (input === 'd')` dismiss path (line 601). `app-dismiss.test.js` 7/7 pass; `app-adopt.test.js` scenario (h) pass. `App.js:333` typedef is `'list' \| 'filter' \| 'overlay' \| 'confirm'` — unchanged. |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/dashboard/adopt.js` | runAdopt never-throws execFile orchestrator | VERIFIED | 133 lines; exports `runAdopt`; leak guard present; argv 10-element array via process.execPath |
| `src/cli/dashboard/select.js` | computeAdoptable + resolveProjectId pure derives added | VERIFIED | Lines 341-402; existing exports untouched |
| `src/cli/dashboard/App.js` | `a` handler, adopt picker, double-confirm, footer copies, help line | VERIFIED | `onAdoptDiscover`/`onAdopt`/`projects` props; ADOPT_* exports; `armedSessionId`; help line includes `a adopt` (line 943) |
| `src/cli/dashboard/index.js` | getHost('cmux') wiring + onAdoptDiscover/onAdopt/projects props | VERIFIED | Lines 119-178; `typeof host.listAgentSurfaces === 'function'`; 3-dotdot kodoBin at line 149; `process.execPath` at line 176 |
| `test/dashboard/adopt.test.js` | 5 never-throws scenarios | VERIFIED | 24 tests total (3 suites), 24/24 pass |
| `test/dashboard/select-adopt.test.js` | computeAdoptable + resolveProjectId unit coverage | VERIFIED | Included in same 24-test run |
| `test/dashboard/app-adopt.test.js` | Integration-light 6-scenario flow test | VERIFIED | 6/6 pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `App.js` `a` handler | `onAdoptDiscover` + `computeAdoptable` | `await onAdoptDiscover?.()` then `computeAdoptable(surfaces, sessions)` | WIRED | `App.js:830-832` |
| `App.js` confirm branch | `onAdopt` | `armedSessionId`-routed second `a` invokes `await onAdopt?.(armedSurface)` | WIRED | `App.js:562-593` |
| `index.js` | `host.listAgentSurfaces` | `typeof`-gated `getHost('cmux')` wiring | WIRED | `index.js:136,172` |
| `index.js` | `runAdopt` via `process.execPath` + kodoBin | `onAdopt` prop | WIRED | `index.js:175-176` |
| `adopt.js` | execFile call | `exec(execPath, [kodoBin, 'adopt', ...literal argv], ...)` | WIRED | `adopt.js:107` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `App.js` adopt handler | `surfaces` | `onAdoptDiscover?.()` → `host.listAgentSurfaces()` → live cmux socket (in tests: stub returning fixed AgentSurface[]) | Yes (typeof-gated, fail-open to []) | FLOWING |
| `App.js` computeAdoptable | `sessions` | Live `/status` poll kept in `sessions` state via `setSessions` in `onResult` | Yes — real poll data | FLOWING |
| `App.js` resolveProjectId | `projects` | `loadProjects()` in index.js, passed as DI prop | Yes — reads `~/.kodo/projects.json` | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| adopt.test.js: 5 never-throws scenarios | `node --test test/dashboard/adopt.test.js` | 24/24 pass | PASS |
| select-adopt.test.js: computeAdoptable + resolveProjectId | `node --test test/dashboard/select-adopt.test.js` | Included in 24/24 | PASS |
| app-adopt.test.js: full a→picker→confirm→adopt flow | `node --test test/dashboard/app-adopt.test.js` | 6/6 pass | PASS |
| app-dismiss.test.js: Pitfall 2 regression (dismiss path not broken) | `node --test test/dashboard/app-dismiss.test.js` | 7/7 pass | PASS |
| format-isolation.test.js: color isolation walker | `node --test test/format-isolation.test.js` | 8/8 pass | PASS |
| Full dashboard suite | `node --test "test/dashboard/*.test.js"` | 65/65 pass | PASS |
| Full test suite (regression) | `node --test "test/**/*.test.js"` | 1414/1415 pass (1 pre-existing skip) | PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes declared or found for this phase. Test suite substitutes.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| DETECT-02 | 56-01-PLAN.md, 56-02-PLAN.md | Tecla `a` descubre surfaces ad-hoc, shellea `kodo adopt` via execFile, on-demand, double-confirm, never-throws, cero endpoints nuevos | SATISFIED | All 7 truths verified above; full test suite green |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `App.js` | 574 | `const result = await onAdopt?.(armedSurface)` — `result` is `undefined` when `onAdopt` is absent; `!result` branch shows green ADOPT_OK (WR-03 from 56-REVIEW.md) | INFO (advisory) | In production `onAdopt` is always wired (index.js:175); only affects degraded/no-DI test context. Mirrors pre-existing `onOpen`/`onFocus` pattern. Non-blocking. |
| `App.js` | 829-845 | `a` handler: `overlayReqRef` reqId guard does not re-check current `mode` after the await; a mode change during `onAdoptDiscover` could clobber an armed dismiss (WR-01 from 56-REVIEW.md) | WARNING (advisory) | Narrow race window; onAdoptDiscover is the longest-await overlay opener. Non-blocking for phase goal; flagged for follow-up. |
| `App.js` | 832 | `computeAdoptable(surfaces, sessions)` diffs against keep-last-good snapshot; if server is down, stale sessions may re-offer an already-adopted surface (WR-02 from 56-REVIEW.md) | WARNING (advisory) | Not a data-loss bug (kodo adopt exit 1/2 → footer); misleading picker entry only when banner already shows stale data. Non-blocking. |

No TBD/FIXME/XXX/HACK/PLACEHOLDER markers found in any of the four phase files. No blocker anti-patterns.

### Human Verification Required

#### 1. Live adoption flow (happy path)

**Test:** With at least one ad-hoc cmux `claude` session running (not yet in `state.json`), press `a` in the live dashboard. Navigate to the surface, press `a` again to confirm.
**Expected:** Picker overlay opens with the surface listed; cursor at position 0; ↑/↓ move the cursor. Pressing `a` shows the cyan `adopt <ref>? press a again · Esc cancel` prompt. Second `a` shells `kodo adopt`, returns green `adopted <ref>…` footer. The adopted session appears as a tracked row in the next `/status` tick.
**Why human:** Requires a live cmux socket + TTY. The full path host.listAgentSurfaces() → real cmux process → real `kodo adopt` child spawn cannot be exercised without a running environment. Mirror of Phase 42 dismiss double-confirm UAT.

#### 2. Empty discovery path (all surfaces already tracked)

**Test:** Press `a` when all claude surfaces are already tracked in `/status`.
**Expected:** Footer shows `no adoptable sessions found` (yellow), mode stays `list`, no overlay opens.
**Why human:** Requires confirming live cmux + /status state combination.

#### 3. No/ambiguous project surface

**Test:** In the picker, navigate to a surface whose `cwd` does not match any entry in `~/.kodo/projects.json`. Press `a`.
**Expected:** Footer shows `[!] no/ambiguous project for <cwd> — use kodo adopt --project <id>` (red), picker closes, zero `kodo adopt` spawns.
**Why human:** Requires a live surface with a genuinely unmapped cwd.

#### 4. Pitfall 2 confirm-key isolation in live TTY

**Test:** Arm an adopt confirm (picker → `a`), then press `d`. Verify it cancels without dismiss. Separately arm a dismiss (`d` on a dead session), then press `a`. Verify it cancels without adopting.
**Expected:** `a` and `d` stay isolated in their respective confirm flows. The `app-dismiss.test.js` regression (h) already covers this with stubs; live TTY confirms operator-visible isolation.
**Why human:** Subjective operator-experience confirmation, not purely mechanical.

### Gaps Summary

No gaps found. All 7 observable truths are verified. The three advisory warnings (WR-01, WR-02, WR-03) from 56-REVIEW.md are documented above as INFO/WARNING severity and do not block the phase goal — they were already flagged in the code review and are non-blocking by design.

---

_Verified: 2026-06-17T11:42:00Z_
_Verifier: Claude (gsd-verifier)_
