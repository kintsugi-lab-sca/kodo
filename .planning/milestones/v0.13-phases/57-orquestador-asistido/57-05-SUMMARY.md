---
phase: 57-orquestador-asistido
plan: 57-05
gap_closure: true
source: 57-HUMAN-UAT.md  # "Module-placement gap"
subsystem: adopt / plane-provider
tags: [adopt, plane, modules, bidir, fail-open]
requires:
  - 53-02  # adoptSession deterministic core
  - 56-05  # createTask description_html omission
  - 56-01  # resolveProjectId cwd reverse-lookup pattern (mirrored)
provides:
  - kodo-adopt-module-placement
affects:
  - src/providers/plane/client.js
  - src/providers/plane/provider.js
  - src/adopt.js
  - src/cli.js
  - src/cli/adopt.js
tech-stack:
  added: []
  patterns:
    - "fail-open module association (mirror label-409 idempotent posture)"
    - "pure nearest-ancestor reverse-lookup (mirror resolveProjectId longest-match)"
key-files:
  created:
    - .planning/phases/57-orquestador-asistido/57-05-SUMMARY.md
  modified:
    - src/providers/plane/client.js
    - src/providers/plane/provider.js
    - src/adopt.js
    - src/cli.js
    - src/cli/adopt.js
    - test/plane-provider.test.js
    - test/adopt.test.js
    - test/adopt-cli.test.js
decisions:
  - "module is a config/cwd-DERIVED name, NOT user free-text → NOT routed through sanitizeAdoptionData; only string-guarded"
  - "FAIL-OPEN is non-negotiable: a module resolve/assoc failure degrades (item in project, not module board) but NEVER becomes CREATE_FAILED"
  - "auto-derive lives in the CLI (single point); all three consumers shell `kodo adopt --cwd …` so they inherit it for free"
  - "explicit --module wins over cwd-derived; flat-string project entry → no module; non-match → no module"
commits:
  - 6ea4f39  # feat(57-05): Plane addWorkItemToModule + createTask module association (fail-open)
  - 660d8c3  # feat(57-05): kodo adopt --module + auto-derive from cwd
metrics:
  tasks: 2
  files_changed: 8
---

# Phase 57 Plan 05: Module Placement for Adopted Sessions Summary

Adopted Plane work items now land in the correct MODULE board (not just the project), with the module auto-derived from `--cwd` so the CLI, dashboard, and orchestrator (all of which shell `kodo adopt --cwd …`) inherit placement for free. Module resolution/association is strictly fail-open: a missing or unresolvable module degrades to "item created in project, not on the module board" and NEVER turns a successful create into `CREATE_FAILED`.

## The gap (Phase 57 UAT)

`kodo adopt` created the work item in the right project but never associated it to a Plane MODULE, so adopted sessions were invisible on the module board the human actually watches. Root cause: `createTask` had no module concept and no consumer passed one.

## What changed

**1. Plane client (`src/providers/plane/client.js`)** — new `addWorkItemToModule(projectId, moduleId, workItemId)`: POSTs `/projects/<id>/modules/<id>/module-issues/` with body `{ issues: [workItemId] }`, reusing the centralized `request()` POST (X-API-Key, 10s timeout, rate-limit retry, LOUD error throw). The endpoint shape is the exact one the existing module-cache build / `getWorkItemModule` already GET (client.js:161), confirming the collection path.

**2. Plane provider `createTask` (`src/providers/plane/provider.js`)** — accepts an optional `module` NAME. After `createWorkItem` succeeds (work item already exists), if `module` is a non-empty string it resolves name→id via `listModules` (case-insensitive, cached in a new `moduleByName` map mirroring `stateByName`) and calls `addWorkItemToModule`. The whole resolve+associate block is wrapped in try/catch — on an unresolvable name OR a failed POST it `console.warn`s and returns the created task anyway (fail-open, mirroring the label-409 idempotent posture). GitHub provider left unchanged (no modules concept — ignores the key).

**3. `adoptSession` (`src/adopt.js`)** — `module` added to the destructured args and threaded into the `createTask({ … })` payload using the same optional-field idiom as `description` (`...(typeof module === 'string' && module.length > 0 ? { module } : {})`). It is string-guarded but deliberately NOT passed through `sanitizeAdoptionData` (a config-derived name, not free-text). Absent/empty → key omitted, behavior unchanged.

**4. `kodo adopt` CLI (`src/cli.js` + `src/cli/adopt.js`)** —
   - `cli.js`: new `--module <name>` option, passed into `runAdoptCli` as `module: opts.module`.
   - `runAdoptCli`: explicit `--module` wins; otherwise AUTO-DERIVE via the new pure `deriveModuleFromCwd(cwd, entry)` helper — a nearest-ancestor reverse-lookup of `cwd` against the resolved project entry's `modules: Record<name, path>` (longest matching path wins; `norm(cwd) === norm(p)` || `norm(cwd).startsWith(norm(p) + '/')`, the `+ '/'` enforces a separator boundary so `fvf-sibling` never matches `fvf`). Same semantics as `resolveProjectId` (select.js). A flat-string project entry (no modules) → no module; non-matching cwd → no module; a garbage/non-string modules map is filtered before `norm` → never throws. `module` is omitted from the adoptSession call when undefined (unchanged behavior).

## Tests

- `test/plane-provider.test.js` (new `PlaneProvider.createTask module placement` + `PlaneClient.addWorkItemToModule` suites): name→id resolution + `{ issues: [<id>] }` POST shape; case-insensitive match; no-module → no listModules/no assoc; FAIL-OPEN for name-not-found, module-issues 500, and listModules 500 (task still returned, no throw); raw client POST path/body assertion. (Counters reset after `init()` to discount the module-cache warm-up.)
- `test/adopt.test.js`: adoptSession threads `module` into createTask when provided; omits the key when absent or empty-string.
- `test/adopt-cli.test.js` (new `module auto-derive from cwd` suite): nearest-ancestor derive, explicit-flag override, flat-string entry → none, non-match → none, nested longest-match wins, garbage map never throws, sibling separator boundary; plus a static `--module` wiring assertion.

## Deviations from Plan

None — implemented exactly as specified in `<the_fix>`. The only test-mechanics adjustment (not a plan deviation): the module-placement provider tests reset the stub's `modulesGet` counter after `provider.init()` because `init()` legitimately warms the work-item→module cache via `listModules`; the assertions count only the `createTask`-driven calls.

## Assumptions to confirm in live UAT

- **Plane `module-issues` association API shape.** Assumed `POST /projects/<id>/modules/<id>/module-issues/` with body `{ issues: [<workItemId>] }`. This mirrors the GET collection the code already uses (client.js:161) and Plane's batch-array convention, but the POST request/response was not exercised against a live Plane instance. If the live API rejects the body shape, the fail-open guard means the work item is still created (degraded, no board placement) — surfaced via the `console.warn`, not a hard failure.

## Self-Check: PASSED

- src/providers/plane/client.js — FOUND (addWorkItemToModule)
- src/providers/plane/provider.js — FOUND (createTask module + moduleByName)
- src/adopt.js — FOUND (module threaded)
- src/cli.js — FOUND (--module option)
- src/cli/adopt.js — FOUND (deriveModuleFromCwd + wiring)
- commit 6ea4f39 — FOUND
- commit 660d8c3 — FOUND
- Scoped tests (plane-provider, adopt, adopt-cli): 77 pass, 0 fail
- Full suite: 1454 pass, 0 fail, 1 skip (pre-existing)
