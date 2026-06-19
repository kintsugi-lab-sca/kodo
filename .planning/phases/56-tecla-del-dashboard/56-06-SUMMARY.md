---
phase: 56-tecla-del-dashboard
plan: 06
subsystem: host/cmux + cli/dashboard
gap_closure: true
tags: [adopt, cmux-title, workspace-title, fail-open, never-throws, color-isolation, execfile-no-shell, additive-contract]
requires:
  - "Phase 55 (DETECT-01): listAgentSurfaces enumerates cmux agent surfaces as AgentSurface[]"
  - "Phase 56-01 (DETECT-02): computeAdoptable + resolveProjectId + select.js derives"
  - "Phase 56-02/03: App.js `a` handler, picker, double-confirm, runAdopt --json discriminant"
  - "Phase 53/54: kodo adopt CLI exposes --title (core falls back to basename(cwd) when absent)"
provides:
  - "AgentSurface.title (optional, additive): cmux auto-derived workspace title carried from listAgentSurfaces all the way to `kodo adopt --title`"
  - "Dashboard `a` adopt names the adopted session with cmux's readable workspace name instead of basename(cwd), 0-token / deterministic (NO LLM)"
affects:
  - "Live adoption: a surface whose cmux workspace has a custom_title now adopts with that title; a workspace without one is unchanged (basename fallback)"
  - "AgentSurface consumers: title is now an optional field (absent when no custom_title) — purely additive, HOST_METHODS unchanged"
tech-stack:
  added: []
  patterns:
    - "fail-open enrichment: a secondary fetch (workspace list --json) decorates discovery results, but its failure NEVER breaks the primary never-throws contract — surfaces return without title"
    - "join within a single enumeration snapshot: workspace_ref -> custom_title map built+consumed in one listAgentSurfaces call (workspace_ref recycling is a cross-time concern, not within one call)"
    - "literal argv pair gated on a non-empty string (...(cond ? ['--flag', val] : [])) — injection-safe via execFile-no-shell, no quoting"
    - "additive optional typedef field: title? extends AgentSurface without touching the frozen 4-method HOST_METHODS or the 4 existing required fields"
key-files:
  created:
    - .planning/phases/56-tecla-del-dashboard/56-06-SUMMARY.md
  modified:
    - src/host/interface.js
    - src/host/cmux.js
    - src/cli/dashboard/adopt.js
    - src/cli/dashboard/App.js
    - src/cli/dashboard/index.js
    - test/host/contract.test.js
    - test/fixtures/cmux/list-workspaces.json
    - test/dashboard/adopt.test.js
    - test/dashboard/app-adopt.test.js
    - test/dashboard/select-adopt.test.js
decisions:
  - "title source: cmux's `workspace list --json` custom_title, taken ONLY when has_custom_title===true AND custom_title is a non-empty string. A workspace without a custom title must NOT inherit an auto/empty title — that would shadow the core's basename(cwd) fallback. buildTitleMap enforces this; auto titles (e.g. WorkspaceInfo.title for reconcile) are deliberately not reused for adopt."
  - "fetch reuse: listAgentSurfaces reuses the same `run(['workspace','list','--json'])` command listWorkspaces already issues (same `run` DI), wrapped in its own try/catch. FAIL-OPEN: any fetch/parse error logs host.list_agent_surfaces.title_fetch_fail and returns surfaces WITHOUT title — the existing never-throws discovery contract is absolute. The enrichment only runs when out.length>0 (skip the extra cmux roundtrip when there is nothing to decorate)."
  - "join scope: the workspace_ref -> custom_title join happens within the SAME enumeration snapshot (one listAgentSurfaces call). cmux recycles workspace:N across time, but within a single call the snapshot is internally consistent — keyed by workspaceRef, which is correct here (the cross-time recycling defense is the downstream sessionId-keyed dedup of computeAdoptable, untouched)."
  - "cmux-specific confinement: all custom_title extraction lives in src/host/cmux.js (buildTitleMap + the join). interface.js only gains an optional typedef field; select.js/App.js/index.js/adopt.js treat title as an opaque optional string. Regla transversal (cmux confined to src/host/cmux.js) preserved."
  - "runAdopt --title: inserted as a literal argv pair (`'--title', title`) after --project, before --json, ONLY when title is a non-empty string. execFile is invoked with a literal argv and NO shell, so the title is one literal argument and is injection-safe automatically — no shell-quoting added (that was an orchestrator concern, not applicable here). When title is absent/empty the pair is omitted and the core falls back to basename(cwd) — behavior unchanged. The core's sanitizeAdoptionData still redacts paths/home in the title downstream."
  - "computeAdoptable needed NO change: it returns the filtered surface objects as-is (Array.prototype.filter does not reconstruct), so title rides along. Confirmed by a dedicated select-adopt test rather than a code change (YAGNI)."
metrics:
  duration: ~25m
  completed: 2026-06-19
---

# Phase 56 Plan 06: Adopt passes cmux workspace title as --title Summary

Closes the gap where the dashboard `a` adopt let the core fall back to `basename(cwd)` for the adopted session's title even though cmux already auto-derives a readable workspace name. Now `listAgentSurfaces` carries cmux's `custom_title` (from the same `workspace list --json` that `listWorkspaces` already issues) onto each `AgentSurface.title`, and the `a` adopt flow threads that title — App.js armed surface -> index.js onAdopt -> runAdopt -> `kodo adopt --title <title>`. Deterministic, 0-token, NO LLM: the dashboard stays a 0-token deterministic rail. Done via TDD (failing tests -> implementation -> green), atomically committed.

## What changed

1. **`src/host/interface.js`** — added optional `title?: string` to the `AgentSurface` typedef (cmux auto-derived workspace title; absent when the workspace has no custom title). Purely additive — `HOST_METHODS` stays frozen at 4 and the 4 existing required fields are untouched.

2. **`src/host/cmux.js`** — new pure `buildTitleMap(listJson)` helper (workspace_ref -> custom_title, only `has_custom_title===true` + non-empty `custom_title`). `listAgentSurfaces` now, after building the surface array and only when it is non-empty, fetches `workspace list --json` via the existing `run` DI, builds the title map, and sets `surface.title` by joining on `workspaceRef`. FAIL-OPEN: any fetch/parse failure logs and returns surfaces without titles — never throws.

3. **`src/cli/dashboard/adopt.js`** — `runAdopt` accepts optional `title`; inserts `'--title', title` as a literal argv pair (after `--project`, before `--json`) only when title is a non-empty string; omits it otherwise. execFile-no-shell, so injection-safe with no quoting.

4. **`src/cli/dashboard/App.js`** — the armed adopt object now includes `title: surface.title`.

5. **`src/cli/dashboard/index.js`** — `onAdopt` wiring destructures and forwards `title` to `runAdopt`.

6. **`src/cli/dashboard/select.js`** — no change needed; `computeAdoptable` passes surfaces through unchanged (title rides along). Confirmed by test.

## Tests

- `test/host/contract.test.js` + `test/fixtures/cmux/list-workspaces.json`: surface gets `title` from `custom_title` (workspace:1, `has_custom_title:true`); surface whose workspace has no custom_title -> `title` undefined; workspace-list fetch failure -> surfaces still returned without title (fail-open).
- `test/dashboard/adopt.test.js`: `--title <t>` inserted as literal pair when title given (incl. a `-`-prefixed title passed as a literal argument); omitted when absent or empty.
- `test/dashboard/app-adopt.test.js`: armed adopt forwards the surface title (and `undefined` when the surface has none) through to onAdopt.
- `test/dashboard/select-adopt.test.js`: `computeAdoptable` preserves `title` on surfaces.

## Deviations from Plan

None - plan executed exactly as written. `computeAdoptable` required no code change (confirmed via test, as anticipated by the plan).

## Verification

- Scoped tests (host/contract + 3 dashboard suites): 77 pass, 0 fail.
- Full suite `node --test $(find test -name '*.test.js' -type f)`: 1464 pass, 0 fail, 1 pre-existing skip.
- Color-isolation walker `test/format-isolation.test.js`: 8 pass, 0 fail (no picocolors / format.js leaked into src/cli/dashboard/*).

## Invariants preserved

- Dashboard = 0-token deterministic rail (NO LLM): title is read deterministically from cmux JSON.
- never-throws: both `listAgentSurfaces` (title-fetch wrapped in try/catch, fail-open) and `runAdopt` (literal argv, unchanged never-throws contract).
- ZERO new server endpoints; runAdopt stays execFile-no-shell.
- AgentSurface change additive (title optional); HOST_METHODS frozen at 4; cmux extraction confined to src/host/cmux.js.

## Self-Check: PASSED
