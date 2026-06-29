---
phase: 56-tecla-del-dashboard
plan: 04
subsystem: cli/dashboard + providers/plane
gap_closure: true
tags: [adopt, uat-gap-fix, projects-shape, plane-label, idempotency, never-throws, color-isolation, fail-loud]
requires:
  - "Phase 56-03: adoptSession guard keyed by sessionId + runAdopt --json discriminant (Test 1 blocker closed)"
  - "Phase 56-01 (DETECT-02): resolveProjectId reverse-lookup cwd->projectId in select.js"
  - "Phase 53/54: adoptSession core + kodo adopt CLI (createTask reached only after projectId resolves)"
  - "BIDIR-01 / Open Q1: provider.createTask lookup-or-create of the kodo:adopted marker label"
provides:
  - "resolveProjectId resolves the REAL projects.json shape Record<projectId, string | {default, modules}> — closes UAT blocker for ~all real (object-shaped) projects (fvf live-confirmed)"
  - "PlaneClient.createLabel idempotent on the 'label already exists' 409 — closes UAT blocker where createTask died with CREATE_FAILED on a pre-existing kodo:adopted label (kodo project live-confirmed)"
affects:
  - "Live adoption: a surface whose cwd maps to an object-shaped project (via default or a modules path) now resolves --project instead of footer 'no/ambiguous project'"
  - "kodo adopt -> createTask now succeeds when the kodo:adopted label already exists in the Plane project (re-uses it) instead of failing transient CREATE_FAILED"
tech-stack:
  added: []
  patterns:
    - "normalize a mixed operator-editable config value (string | {default, modules}) to candidate paths, keep only string candidates (never-throws over hand-edited garbage)"
    - "scoped idempotency: catch ONE specific provider error (name-conflict 409), recover by re-list+reuse, re-throw everything else LOUD (D-08 fail-loud preserved)"
    - "nearest-ancestor match across multiple candidate paths per project; longest matching path wins; ties between distinct projectIds -> ambiguous"
key-files:
  created:
    - .planning/phases/56-tecla-del-dashboard/56-04-SUMMARY.md
  modified:
    - src/cli/dashboard/select.js
    - src/providers/plane/client.js
    - test/dashboard/select-adopt.test.js
    - test/plane-provider.test.js
decisions:
  - "FIX 1: resolveProjectId derives candidate paths per entry — string -> [value]; object -> [default, ...Object.values(modules)] — keeps only string candidates, matches cwd by nearest-ancestor across all of them, longest path wins. Aligns with src/cli/adopt.js PASO 2 which already reads entry.default. The prior CR-01 fix only matched string-valued entries, which masked the real mixed shape (7/8 entries are objects)."
  - "FIX 1 stays import-free of path/picocolors/format.js (color isolation D-12 intact — verified by test/format-isolation.test.js) and never-throws: non-string default/modules values and a non-string cwd collapse to no match, never a TypeError inside the synchronous React `a` handler (CR-01 posture preserved)."
  - "FIX 2: createLabel wraps the POST in try/catch and recovers ONLY for the name-conflict 409 (message contains 'Plane API 409' AND ('already exists' OR 'labels/')). Recovery re-lists the project's labels and returns the one matching `name` case-insensitively. If no match after re-listing, the original 409 is re-thrown — a genuine failure is never masked. Every other status (and any non-conflict 409) still throws LOUD (D-08). exitCodeFor and the adoptSession discriminant are unchanged."
  - "FIX 2 prefers re-listing labels by name over regex-parsing the id out of the 409 body (more robust); the optional inline regex fallback was not needed."
metrics:
  duration: ~20m
  completed: 2026-06-18
---

# Phase 56 Plan 04: UAT Gap-Fix (projects.json shape + Plane label 409) Summary

Closes the two independent live-UAT blockers that surfaced after 56-03: (1) `resolveProjectId` only matched string-valued `projects.json` entries, so the ~7/8 object-shaped (`{default, modules}`) real projects all yielded `{error:'none'}` and `kodo adopt` never shelled (fvf confirmed); (2) `PlaneClient.createLabel` failed LOUD with a `409 'Label with the same name already exists'`, so `createTask` died `CREATE_FAILED` whenever the `kodo:adopted` label pre-existed in the Plane project (kodo confirmed). Both fixed via TDD (failing test -> fix -> green), atomically committed.

## What changed

### FIX 1 — `resolveProjectId` handles the real `{default, modules}` shape (`src/cli/dashboard/select.js`)
- Each entry is normalized to candidate paths: `string -> [value]`, `object -> [default, ...Object.values(modules)]`, keeping only `string` candidates (tolerates operator-corrupted hand-edits — never throws).
- A candidate path `p` matches when `norm(cwd) === norm(p)` or `norm(cwd).startsWith(norm(p) + '/')` (separator-boundary safe; reuses the existing trailing-slash `norm`, no `path` import).
- Each matching project keeps its longest matching candidate; the overall longest match (most specific ancestor) wins. A tie on length between two distinct projectIds -> `{error:'ambiguous'}`. No match -> `{error:'none'}`.
- Discriminated result shape consumed by App.js (`{projectId}` | `{error}`) is unchanged.

### FIX 2 — `PlaneClient.createLabel` idempotent on name-conflict 409 (`src/providers/plane/client.js`)
- POST wrapped in try/catch. On catch, the name-conflict 409 is detected (`'Plane API 409'` AND (`'already exists'` OR `'labels/'`)).
- On that 409 only: re-list `/projects/<id>/labels/` (`.results || data`), find the label whose `name` matches case-insensitively, return it. No match after re-listing -> re-throw the original error.
- Any other error (other statuses, non-conflict 409) re-throws unchanged — D-08 fail-loud preserved.
- JSDoc updated to document the idempotent name-conflict branch.

## Tests

- `test/dashboard/select-adopt.test.js` — added a `Phase 56 Plan 04` describe block: object entry resolves via `default` (fvf), cwd under a `modules` path resolves, nearest-ancestor across module/default, nearest-ancestor between two projects, mixed string+object map, ambiguous (two objects same path), object no-match -> none, never-throws over non-string `default`/`modules`, and empty-object entry tolerated.
- `test/plane-provider.test.js` — added a `PlaneClient.createLabel idempotency` describe block: 409 -> re-list + reuse existing label, case-insensitive name match, 409 with no re-list match -> re-throw, non-409 (500) -> throw LOUD without re-listing, happy-path 201 -> return raw label without re-listing.

## Deviations from Plan

None — both fixes implemented exactly as specified. The optional inline-regex fallback for FIX 2 (parsing the id out of the 409 body) was deliberately not added; re-listing by name is the robust primary path the plan preferred.

## Verification

- Scoped: `node --test test/dashboard/select-adopt.test.js test/format-isolation.test.js` -> 36 pass / 0 fail (color isolation intact).
- Scoped: `node --test test/plane-provider.test.js test/providers/contract.test.js` -> 40 pass / 0 fail.
- Full: `node --test $(find test -name '*.test.js' -type f)` -> **1434 pass / 1 skip (pre-existing) / 0 fail**.

## Constraints honored

- `src/cli/dashboard/select.js` stays import-free of picocolors/format.js/path (format-isolation test green).
- FIX 2 scoped to the name-conflict 409 branch only; `exitCodeFor` and the `adoptSession` discriminant untouched; fail-LOUD preserved for all other statuses.
- never-throws preserved in `resolveProjectId` (feeds a synchronous React handler).
- STATE.md / ROADMAP.md NOT modified.

## Self-Check: PASSED
- src/cli/dashboard/select.js — FOUND (modified, committed ccfb811)
- src/providers/plane/client.js — FOUND (modified, committed 56c669c)
- test/dashboard/select-adopt.test.js — FOUND (modified, committed 543292e)
- test/plane-provider.test.js — FOUND (modified, committed 543292e)
- .planning/phases/56-tecla-del-dashboard/56-04-SUMMARY.md — FOUND (this file)
