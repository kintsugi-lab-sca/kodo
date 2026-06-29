---
phase: 52-createtask-contrato-anti-recursi-n
plan: 02
subsystem: providers/plane
tags: [createTask, bidir-01, plane, transport, normalize, optional-method, frozen-9, checkpoint-paused]

# Dependency graph
requires:
  - phase: 52-createtask-contrato-anti-recursi-n
    plan: 01
    provides: "KODO_LABEL_ADOPTED const exported from src/labels.js (imported here, never inlined)"
  - phase: 40-provider-state-adapter
    provides: "getTaskState optional-method (typeof-detected, outside FROZEN-9) template mirrored for createTask"
  - phase: 48-open-in-manager
    provides: "webUrl/browse URL wiring consumed by normalizeWorkItem's 6-field context"
provides:
  - "client.createWorkItem(projectId, fields) — authenticated POST /work-items/ transport (mirror of createComment)"
  - "client.createLabel(projectId, name, color?) — POST /labels/ for the kodo:adopted marker UUID lookup-or-create"
  - "provider.createTask({projectId, title, description}) — typeof-detected optional method, OUTSIDE the FROZEN-9; creates in trigger state, applies kodo:adopted marker, normalizes 201 to canonical TaskItem"
affects: [52-03, 53-adopt-session]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional provider method via typeof-detection (FROZEN-at-9) — createTask added to the provider object literal only, never to TASK_PROVIDER_METHODS"
    - "Create-then-normalize: 201 round-trips through the EXISTING normalizeWorkItem with the FULL 6-field context (shape-identity with fetched TaskItems)"
    - "Label-UUID lookup-or-create marker application BEFORE the work-item POST (marker present at next poll tick, survives --force)"

key-files:
  created: []
  modified:
    - src/providers/plane/client.js
    - src/providers/plane/provider.js

key-decisions:
  - "Relative import path ../../labels.js (verified: matches normalize.js depth) — KODO_LABEL_ADOPTED imported, never inlined (source-hygiene REPORT-05)"
  - "Trigger state resolved refresh-on-miss mirroring updateTaskState, but does NOT throw if unresolved (createTask lets state be undefined -> Plane project default; updateTaskState throws because it targets a known state)"
  - "Marker label resolved/created BEFORE the work-item POST and pushed into labelCache so subsequent creates reuse the UUID"

requirements-completed: []  # BIDIR-01 implementation landed; marked complete only after the D-07 checkpoint approves the live 201 shape

# Metrics
duration: ~2min (autonomous tasks)
completed: 2026-06-16
status: checkpoint-paused
---

# Phase 52 Plan 02: Plane createTask (BIDIR-01) Summary

**`createTask` delivered as a typeof-detected optional method on the Plane adapter (outside the FROZEN-9): an authenticated `POST .../work-items/` in the configured trigger state, stamped with the `kodo:adopted` marker (label-UUID lookup-or-create), with the 201 normalized back to a shape-identical canonical `TaskItem` via the existing `normalizeWorkItem` + full 6-field context.**

> **STATUS: CHECKPOINT-PAUSED.** Both autonomous implementation tasks (Task 1, Task 2) are committed and fully verified against the local test suite. Task 3 is a `checkpoint:human-verify` gate (D-07) requiring a manual POST against the operator's live Plane CE instance to pin the real 201 shape (`id` + `sequence_id`) — the single MEDIUM-confidence item (Assumption A1) of the phase. BIDIR-01 is NOT yet marked complete in REQUIREMENTS.md; the plan resumes (and the requirement is checked off) once the operator confirms the live 201 shape.

## Performance

- **Duration:** ~2 min (autonomous Tasks 1+2; excludes the pending human checkpoint)
- **Started:** 2026-06-16T08:48:23Z
- **Autonomous work completed:** 2026-06-16T08:50:00Z
- **Tasks:** 3 (2 auto committed + verified; 1 checkpoint:human-verify PENDING)
- **Files modified:** 2

## Accomplishments

- **`client.createWorkItem(projectId, fields)`** — byte-for-byte mirror of `createComment`: `this.request('/projects/${projectId}/work-items/', { method: 'POST', body: fields })`. Trailing slash is load-bearing (Pitfall 3). `fields` is `{ name, description_html?, state?, labels? }` where `state` is a UUID and `labels` are UUIDs. No swallowing try/catch — `request()` already throws on non-ok (D-08).
- **`client.createLabel(projectId, name, color?)`** — same POST pattern to `/projects/${projectId}/labels/`, default neutral gray color. Resolves the Plane half of Open Q1: the `kodo:adopted` marker is a label-UUID that must exist before the work-item POST.
- **`provider.createTask({ projectId, title, description })`** — added to the provider object literal at the same level as `getTaskState`, OUTSIDE the FROZEN-9, with the verbatim optional-method comment (swapped `getTaskState`→`createTask`). Body:
  1. Resolves `proj` via `config.projects.find(p => p.id === projectId)`.
  2. Builds `description_html` (`<p>...<br>...</p>`) or `''`.
  3. Resolves the trigger-state UUID (D-04) refresh-on-miss against `stateByName` (mirror of `updateTaskState`), but does NOT throw if unresolved → omits `state` so Plane applies the project default.
  4. Resolves/creates the `kodo:adopted` label UUID in `labelCache` by case-insensitive name; creates via `client.createLabel` and caches it when absent (Open Q1 lookup-or-create BEFORE the POST → marker present at the next poll tick, survives `--force`).
  5. POSTs `{ name: title, description_html, ...(stateId ? { state } : {}), labels: [adoptedLabelId] }`.
  6. Normalizes the 201 via `normalizeWorkItem` with the **FULL 6-field context** (`labels, projectIdentifier, baseUrl, webUrl, workspaceSlug, stateMap`) copied from `listPendingTasks` (Pitfall 2) → `url`/`state` resolve, shape-identical to a fetched `TaskItem` (D-06).
- `KODO_LABEL_ADOPTED` imported from `../../labels.js` (no inline literal — source-hygiene REPORT-05, enforced by `labels-hygiene.test.js` scanning all of `src/`).
- `TASK_PROVIDER_METHODS` (interface.js) and `registry.js` left untouched — FROZEN-9 intact.

## Task Commits

1. **Task 1: createWorkItem + createLabel POST transport** - `6402037` (feat) — `src/providers/plane/client.js`
2. **Task 2: createTask typeof-detected** - `5a4d8f2` (feat) — `src/providers/plane/provider.js`
3. **Task 3: D-07 live Plane CE 201 shape verification** - `checkpoint:human-verify` — PENDING (no commit; requires operator's live creds)

## Files Created/Modified

- `src/providers/plane/client.js` - Added `createWorkItem` + `createLabel` (POST transport mirroring `createComment`, trailing-slash paths, no swallow).
- `src/providers/plane/provider.js` - Extended import with `KODO_LABEL_ADOPTED`; added `createTask` optional method (trigger-state create, marker lookup-or-create, full 6-field normalize).

## Decisions Made

- **Import path `../../labels.js`** — verified against `normalize.js`'s import depth (same directory level); imported the const, never inlined the literal.
- **Trigger state does NOT throw on miss** — unlike `updateTaskState` (which throws because it targets a caller-named state), `createTask` leaves `state` off the body when unresolved and lets Plane apply the project default. This keeps create resilient to a misconfigured/renamed trigger state without failing the mutation.
- **Marker resolved before the POST and cached** — the new `{id,name}` from `createLabel` is pushed into `labelCache` so the next `createTask` (and the normalize step's label resolution) reuse it without a second API round-trip.

## Deviations from Plan

None — both autonomous tasks executed exactly as written. No Rule 1/2/3 auto-fixes were needed; the test suite was green on first run.

## Issues Encountered

None. Targeted tests (`contract.test.js` + `labels-hygiene.test.js`) and the full suite passed without iteration.

## Verification

- `node --test test/providers/contract.test.js test/labels-hygiene.test.js` → 20 pass, 0 fail (the `createTask` `it()` lands in Plan 03, so 20 is the expected current count).
- `npm test` (full suite) → **1333 pass, 0 fail, 1 skipped** (pre-existing skip; no regressions).
- `createTask` source-hygiene: no inline `'kodo:adopted'` (import asserted by the hygiene test, which scans all of `src/`).
- `createTask` NOT in `TASK_PROVIDER_METHODS` (interface.js untouched); the Plan 03 negative-assert will lock this.
- **PENDING (Task 3 / D-07):** live Plane CE `POST .../work-items/` 201 shape (`id` + `sequence_id`, `state`/`project_detail` resolution) NOT yet validated — see checkpoint below.

## Known Stubs

None.

## Threat Flags

None new. The change adds the first create-mutation surface (`POST /work-items/`, `POST /labels/`) — but both were anticipated and dispositioned in the plan's `<threat_model>` (T-52-1 DoS mitigated by the marker applied before return; T-52-3 Tampering mitigated by LOUD propagation, no swallowing catch; T-52-SC zero new packages). No surface outside the registered threat model.

## Checkpoint Pending (Task 3 / D-07 — human-verify, gate=blocking)

The Plane CE 201 create shape is the only MEDIUM-confidence item (Assumption A1): reads/PATCH/comments are verified-by-use, but the create-201 is not. D-07 requires a ~5-min manual POST against the operator's live Plane CE to pin `id` + `sequence_id` before the normalization is trusted and BIDIR-01 is marked complete.

**Verification steps (operator):**
1. With real Plane CE creds (`PLANE_API_KEY`, base URL, workspace slug, a test `projectId`), POST to `POST {baseUrl}/api/v1/workspaces/{slug}/projects/{projectId}/work-items/` with header `X-API-Key` and body `{ "name": "kodo adopt smoke test" }`.
2. Confirm 201 and that the JSON includes the fields `normalizeWorkItem` consumes: `id`, `sequence_id` (numeric), `project_detail`/`state_detail` or at least `project`/`state` resolvable via the provider caches.
3. Note the observed `sequence_id` and whether `state`/`project_detail` are embedded or require the caches.
4. (Optional) `POST .../labels/` with `{ "name": "kodo:adopted" }` returns a label with `id` (UUID) — confirms `createLabel` for Open Q1.
5. If the shape diverges (sequence_id absent, state unresolvable), paste the raw 201 JSON so the normalization can be adjusted before marking the phase green.

**Resume signal:** "approved" with the observed `sequence_id`, or paste the raw 201 JSON if the shape diverges.

## Next Phase Readiness

- The `createTask` method is wired and locally green; once D-07 approves the live 201 shape, BIDIR-01 is complete and Plan 03 (the capability-gated `contract.test.js` `it()` + FROZEN-9 negative-assert) and Phase 53 (`adoptSession`, which consumes a canonical `TaskItem` via the `typeof` gate) can rely on it.
- GitHub `createTask` (BIDIR-02) is delivered in a sibling plan of this phase, mirroring the same optional-method pattern.

## Self-Check: PASSED

- `src/providers/plane/client.js` contains `createWorkItem` + `createLabel` ✓
- `src/providers/plane/provider.js` contains `async createTask` + imports `KODO_LABEL_ADOPTED` ✓
- Commits `6402037`, `5a4d8f2` exist ✓
- Full suite green (1333 pass / 0 fail / 1 skip) ✓

---
*Phase: 52-createtask-contrato-anti-recursi-n*
*Autonomous tasks completed: 2026-06-16 — checkpoint (Task 3 / D-07) PENDING*
