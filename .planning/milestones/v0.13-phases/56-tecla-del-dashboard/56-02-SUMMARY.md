---
phase: 56-tecla-del-dashboard
plan: 02
subsystem: cli/dashboard
tags: [adopt, ink-tui, state-machine, never-throws, color-isolation, in-process-host, zero-endpoints]
requires:
  - "Plan 56-01: runAdopt + computeAdoptable + resolveProjectId (the three contracts wired here)"
  - "Phase 55: host.listAgentSurfaces() seam (typeof-detected, fail-open)"
  - "Phase 42: dismiss double-confirm machine (mode:'confirm', armed-by-identity mold)"
  - "Phase 39/44: mode:'overlay' c/l/p machinery (picker mold)"
provides:
  - "App.js `a` adopt handler: discover on-demand → picker → double-confirm → shell, never-throws"
  - "adopt picker overlay (overlaySnapshot.kind==='adopt') with a SELECTABLE cursor (Pitfall 3)"
  - "confirm-key routing by armed-id (armedSessionId vs armedTaskId) — Pitfall 2 resolution"
  - "index.js in-process cmux host wiring + onAdoptDiscover/onAdopt/projects props (D-01)"
  - "ADOPT_NONE/ADOPT_CONFIRM/ADOPT_OK/ADOPT_NO_PROJECT/ADOPT_ERR_ENOENT/adoptErrFailed footer copies"
affects:
  - "Closes the operator-side sesión→tarea loop (DETECT-02); next /status tick shows the adopted row"
tech-stack:
  added: []
  patterns:
    - "selectable picker cursor on a frozen overlay snapshot (clamp [0,len-1], no wrap)"
    - "armed-id-routed double-confirm (two consumers, one mode:'confirm', no key collision)"
    - "in-process getHost('cmux') wiring (zero new server endpoints)"
    - "execFile via process.execPath + 3-dotdot kodoBin (shebang-script binary, polling.js mold)"
key-files:
  created:
    - test/dashboard/app-adopt.test.js
  modified:
    - src/cli/dashboard/App.js
    - src/cli/dashboard/SessionTable.js
    - src/cli/dashboard/index.js
    - test/dashboard/app-focus.test.js
    - test/dashboard-render.test.js
decisions:
  - "D-Claude: `projects` is a DI prop on App (injected from loadProjects() in index.js), not read inline — keeps the `a` handler pure-DI and testable, mirrors onFocus/onOpen"
  - "Pitfall 2: confirm branch routes the 2nd key by armedSessionId!=null (adopt, `a`) BEFORE the dismiss armedTaskId branch (`d`) — disjoint armed-id states, never collide"
  - "Pitfall 3: ↑/↓ move adoptCursor (not scrollOffset) when overlaySnapshot.kind==='adopt'; mode typedef stays at 4 states (D-08)"
  - "ADOPT_OK/ADOPT_CONFIRM ref = workspaceRef (the ad-hoc surface has no task_ref yet)"
metrics:
  duration: ~18m
  completed: 2026-06-17
  tasks: 3
  files: 6
---

# Phase 56 Plan 02: Adopt Key Wiring (`a` handler + picker + double-confirm) Summary

Wired the Plan 01 helpers into the ink TUI: the `a` key now discovers ad-hoc cmux surfaces in-process (typeof-gated host seam, fail-open), diffs them against the live `/status` snapshot (`computeAdoptable`, keyed by sessionId), opens a selectable-cursor picker overlay, double-confirms by sessionId, and shells `kodo adopt` via `runAdopt` — never-throws end-to-end. The two flagged state-machine pitfalls are resolved with the minimal-diff approach: confirm-key collision routed by armed-id, picker cursor on a frozen snapshot. Zero new server endpoints; mode typedef stays at 4 states; color isolation preserved.

## What Was Built

- **`src/cli/dashboard/App.js` (modified)** — Imported `computeAdoptable`/`resolveProjectId`. Added `onAdoptDiscover`/`onAdopt`/`projects` props (JSDoc + destructure, projects defaulting to `{}`). Exported the six adopt footer copies. Added state: `armedSessionId`, `armedSurface` (stashed `{workspaceRef,cwd,sessionId,projectId}`), `adoptCursor`. The `a` list handler discovers on-demand (reqId-guarded around the await, mold of c/l), `computeAdoptable(surfaces, sessions)`, empty → `ADOPT_NONE` (yellow) staying in list, else opens the picker (`overlaySnapshot.kind:'adopt'` carrying `adoptable[]`, cursor 0). Inside the overlay branch, when kind==='adopt': ↑/↓ move `adoptCursor` (clamp, no wrap — Pitfall 3), `a` resolves projectId (none/ambiguous → `ADOPT_NO_PROJECT` + close, no arm — D-05) else arms by sessionId. The confirm branch routes by armed-id (Pitfall 2): `armedSessionId != null` → only `a` executes `onAdopt`, mapping the never-throws result to a green `ADOPT_OK` / red `ADOPT_ERR_ENOENT` / red `adoptErrFailed(code)` footer; the existing dismiss `armedTaskId`/`d` branch is left intact below it. Help line extended with `· a adopt`.
- **`src/cli/dashboard/SessionTable.js` (modified)** — Added `renderAdoptPicker(adoptable, cursor)`: a cursor-marked list (`› ` gutter + bold, fzf/vim pattern) of `cwd · <8-char sessionId> · kind`, routed before `renderOverlay` when `overlaySnapshot.kind==='adopt'`. The `confirmLine` now routes the copy by armed-id: `armedSessionId != null` → `ADOPT_CONFIRM(workspaceRef)`, else `DISMISS_CONFIRM(taskRef)` (same cyan). New props: `armedSessionId`, `armedSurfaceRef`, `adoptCursor` (JSDoc added). Color isolation intact (all color via `<Text color>` ink names).
- **`src/cli/dashboard/index.js` (modified)** — Lazy-imported `runAdopt` + `getHost`; instantiated the cmux host in-process (`getHost('cmux', { exec: execImpl, binary: cmuxBin })`, reusing the already-resolved execImpl/cmuxBin — D-01, no endpoint). Resolved `projects` via `loadProjects()` and `kodoBin` via THREE `..` (dashboard/index.js is one level deeper than cli/polling.js). Added three render props: `onAdoptDiscover` (typeof-gated fail-open to `[]`), `onAdopt` (runAdopt via `process.execPath` + kodoBin), `projects`. The non-TTY guard, alt-screen toggle, and SIGTERM handler are untouched (additive DI only).
- **`test/dashboard/app-adopt.test.js` (new)** — 6 integration-light scenarios cloned from app-dismiss.test.js (injectProps + fake clock + 80ms `drain()`, Pitfall 1): (a) `a` opens the picker showing the adoptable surface, non-claude/tracked filtered out; (g) empty discovery → `ADOPT_NONE`, no overlay; (b/c/d) ↑/↓ move the cursor + `a` arms `ADOPT_CONFIRM` + 2nd `a` shells `onAdopt` exactly once with the cursor's sessionId/projectId/cwd/workspaceRef + `ADOPT_OK`; (e) Esc cancels (zero onAdopt); (f) no-project surface → `ADOPT_NO_PROJECT`, zero onAdopt (D-05); (h) Pitfall 2 — a `d` in an adopt confirm cancels (does not shell, does not trigger dismiss).

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Scaffold failing integration test (RED) | 811dd3b | test/dashboard/app-adopt.test.js |
| 2 | `a` handler + picker + double-confirm + footer copies (GREEN) | f413044 | src/cli/dashboard/App.js, src/cli/dashboard/SessionTable.js |
| 3 | Wire cmux host + onAdoptDiscover/onAdopt/projects in index.js (GREEN) | ba13d70 | src/cli/dashboard/index.js, test/dashboard/app-focus.test.js, test/dashboard-render.test.js |

## Verification

- `node --test test/dashboard/app-adopt.test.js` → 6/6 pass (picker, cursor, double-confirm, cancel, no-project, empty-discovery, key isolation).
- `node --test test/dashboard/app-dismiss.test.js` → 7/7 pass (Pitfall 2 regression guard: dismiss `d` path NOT broken by the armed-id routing).
- `node --test 'test/dashboard/*.test.js'` → 61/61 pass.
- `node --test test/format-isolation.test.js` → 8/8 pass (App.js + SessionTable.js + index.js import zero picocolors/format.js — D-08).
- `node --test 'test/**/*.test.js'` → 1410/1410 pass (full suite, zero regressions).
- `git diff --stat src/server.js` (vs base) → EMPTY — SERVER-CLEAN (zero-endpoints invariant).
- `grep "'list' | 'filter' | 'overlay' | 'confirm'" src/cli/dashboard/App.js` → unchanged (4 states, no 5th mode — D-08).
- `grep "'..', '..', '..', 'bin', 'kodo'"` in index.js → present (3-dotdot kodoBin, Pattern 3).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `projects` source for resolveProjectId was under-specified**
- **Found during:** Task 2 / Task 3
- **Issue:** The plan's `<interfaces>` and the Task 3 wiring text specify `resolveProjectId(surface.cwd, projects)` and `onAdopt(...projectId)`, but never say how `projects` reaches App.js. The Task 1 instructions explicitly say to inject "a `loadProjects`-style projects map", confirming a DI prop is intended.
- **Fix:** Added a `projects` DI prop to App (default `{}`), wired from `loadProjects()` in index.js. This mirrors the onFocus/onOpen DI molds, keeps the `a` handler pure-DI and unit-testable, and keeps App.js color-isolated (loadProjects is `node:fs`-only, no picocolors). `loadProjects` is the same map src/cli/adopt.js reads.
- **Files modified:** src/cli/dashboard/App.js, src/cli/dashboard/index.js
- **Commits:** f413044 (prop), ba13d70 (wiring)

**2. [Rule 1 - Bug] Two pre-existing footer-hint assertions broke when the help line was extended**
- **Found during:** Task 3
- **Issue:** Extending the help line with `· a adopt` (a Task 2 acceptance criterion) pushed the footer past the test terminal width, so ink wraps it to two lines. `test/dashboard/app-focus.test.js` and `test/dashboard-render.test.js` asserted the footer hint as a contiguous regex (`…o open · q quit` / `q quit`), which the wrap split across the box border.
- **Fix:** Updated both assertions to tolerate the wrap — collapse box borders (`│`) + whitespace before matching the hint segments. The assertions still prove the footer is restored / present; they no longer depend on a single un-wrapped line. No source behavior changed; only the stale expected-string in the tests.
- **Files modified:** test/dashboard/app-focus.test.js, test/dashboard-render.test.js
- **Commit:** ba13d70

## Threat Model Coverage

- **T-56-05 (DoS UX, `a` async handler):** mitigated — `onAdoptDiscover` is typeof-gated and fails open to `[]` (host without the method → `ADOPT_NONE`); the handler never re-throws (await of never-throws `onAdoptDiscover`/`onAdopt`), so the ink panel stays mounted.
- **T-56-06 (Tampering, confirm-key routing):** mitigated — the 2nd key is routed by which armed-id is set (`armedSessionId` vs `armedTaskId`); an `a` cannot trigger a dismiss and a `d` cannot trigger an adopt. app-dismiss.test.js (7/7) regression-guards the dismiss path; app-adopt (h) guards the adopt path.
- **T-56-07 (EoP, kodo binary):** mitigated — `kodoBin` is an absolute 3-dotdot join (no PATH lookup) and the spawn binary is `process.execPath` (mirror of polling.js).
- **T-56-08 (Info Disclosure, ADOPT_NO_PROJECT echoes cwd):** accepted — local cwd shown to the local operator on their own TTY; the escape-hatch message is intentional (D-05).
- **T-56-09 (Spoofing/Tampering, no/ambiguous project → no shell):** mitigated — `resolveProjectId` returning `{error}` blocks `onAdopt` entirely (asserted by app-adopt (f)); a surface that cannot be unambiguously mapped never shells `kodo adopt`.

## Known Stubs

None — the `a` flow is fully wired: discover (host seam) → diff (computeAdoptable) → picker (selectable cursor) → resolve project (reverse-lookup) → double-confirm → shell (runAdopt) → footer. The only host-absence path (typeof fails) is the intended fail-open to `[]` → `ADOPT_NONE`, not a stub.

## Self-Check: PASSED

- FOUND: src/cli/dashboard/App.js (onAdoptDiscover, onAdopt, armedSessionId, ADOPT_* exports)
- FOUND: src/cli/dashboard/SessionTable.js (renderAdoptPicker + ADOPT_CONFIRM routing)
- FOUND: src/cli/dashboard/index.js (getHost('cmux'), typeof host.listAgentSurfaces, process.execPath, 3-dotdot kodoBin)
- FOUND: test/dashboard/app-adopt.test.js
- FOUND commit: 811dd3b (test RED)
- FOUND commit: f413044 (feat App.js + SessionTable.js)
- FOUND commit: ba13d70 (feat index.js + test fixups)
