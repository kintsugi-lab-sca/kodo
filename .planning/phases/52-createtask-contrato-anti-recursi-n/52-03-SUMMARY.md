---
phase: 52-createtask-contrato-anti-recursi-n
plan: 03
subsystem: providers/github
tags: [createTask, bidir-02, bidir-01, github, transport, normalize, optional-method, frozen-9, contract-matrix]

# Dependency graph
requires:
  - phase: 52-createtask-contrato-anti-recursi-n
    plan: 01
    provides: "KODO_LABEL_ADOPTED const exported from src/labels.js (imported here, never inlined)"
  - phase: 52-createtask-contrato-anti-recursi-n
    plan: 02
    provides: "Plane provider.createTask — the contract test exercises it too; both providers must implement createTask before the B9 it() runs"
  - phase: 24-githubprovider-normalizer-registry
    provides: "normalizeIssue (reused verbatim), getTask owner/repo split, getTaskState optional-method template"
  - phase: 23-githubclient
    provides: "GitHubClient.request() (auth PAT, API-version pin, canonical .code/.status Error on non-ok) — createIssue reuses it"
provides:
  - "client.createIssue(owner, repo, fields) — authenticated POST /repos/{o}/{r}/issues transport (mirror of addComment, body Markdown, no swallow)"
  - "provider.createTask({projectId, title, description}) — typeof-detected optional method OUTSIDE the FROZEN-9; creates an open issue with the kodo:adopted marker, normalizes the 201 to a canonical TaskItem"
  - "contract.test.js B9 capability-gated createTask it() (mirror B8) round-tripping a mocked 201 for BOTH providers (closes BIDIR-01 + BIDIR-02) + FROZEN-9 negative-assert"
affects: [53-adopt-session]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional provider method via typeof-detection (FROZEN-at-9) — createTask added to the provider object literal only, never to TASK_PROVIDER_METHODS"
    - "Create-then-normalize: 201 round-trips through the EXISTING normalizeIssue with the trivial {projectId:'owner/repo'} context (shape-identity with fetched TaskItems)"
    - "GitHub label marker applied AT CREATE as a plain string (no UUID resolution, unlike Plane)"
    - "Method-aware Plane fetch stub: routes receive method so one suffix serves {results:[...]} on GET (list/warmup) and the raw shape on POST (create)"

key-files:
  created: []
  modified:
    - src/providers/github/client.js
    - src/providers/github/provider.js
    - test/providers/contract.test.js

key-decisions:
  - "GitHub labels are plain strings — kodo:adopted attached directly in the create body via [KODO_LABEL_ADOPTED]; no label-UUID lookup-or-create (the Plane half of Open Q1 does not apply to GitHub)"
  - "Relative import ../../labels.js (verified: same depth as normalize.js) — KODO_LABEL_ADOPTED imported, never inlined (source-hygiene REPORT-05)"
  - "Contract test: extended stubPlaneFetch route fns to receive `method` (the A3 low-risk extension) so /work-items/ and /labels/ POSTs return the RAW shape that createWorkItem/createLabel consume (res.json() direct, not wrapped in results)"
  - "makeFakeGitHubClient.createIssue returns created_at/updated_at (the default getIssue omits them) because assertTaskItemShape requires both as ISO strings (Phase 28 D-01)"

requirements-completed: [BIDIR-02, BIDIR-01]

# Metrics
duration: ~4min
completed: 2026-06-16
---

# Phase 52 Plan 03: GitHub createTask (BIDIR-02) + shared contract test (closes BIDIR-01) Summary

**`createTask` delivered as a typeof-detected optional method on the GitHub adapter (outside the FROZEN-9): an authenticated `POST /repos/{o}/{r}/issues` (title required, body Markdown) that stamps the `kodo:adopted` marker as a plain string at create and normalizes the 201 back to a shape-identical canonical `TaskItem` via the existing `normalizeIssue` — plus the capability-gated contract-matrix `it()` (mirror of B8) that round-trips a mocked 201 for BOTH providers, closing BIDIR-01 + BIDIR-02, and the FROZEN-9 negative-assert locking `createTask` out of `TASK_PROVIDER_METHODS`.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-16T09:36:02Z
- **Completed:** 2026-06-16T09:42:00Z
- **Tasks:** 3 (all autonomous, all committed + verified)
- **Files modified:** 3

## Accomplishments

- **`client.createIssue(owner, repo, fields)`** — byte-for-byte mirror of `addComment`: `encodeURIComponent(owner/repo)` + `this.request('/repos/${o}/${r}/issues', { method: 'POST', body: fields })`. Path has NO number and NO trailing slash (GitHub convention, base of `listIssues`). `fields` is `{ title, body?, labels? }` where `title` is required, `body` is **Markdown** (the known divergence from Plane's HTML), and `labels` are plain strings. No swallowing try/catch — `request()` already throws a canonical `Error` with `.code` (`'forbidden'`/`'not_found'`) + `.status` on non-ok (D-08 LOUD; Pitfall 4).
- **`provider.createTask({ projectId, title, description })`** — added to the provider object literal at the same level as `getTaskState`, OUTSIDE the FROZEN-9, with the verbatim optional-method comment (swapped `getTaskState`→`createTask`). Body:
  1. `const [owner, repo] = projectId.split('/')` (projectId arrives as `'owner/repo'` per `listProjects`).
  2. `client.createIssue(owner, repo, { title, body: description || '', labels: [KODO_LABEL_ADOPTED] })` — the marker is a plain string attached at create; GitHub needs NO UUID resolution (unlike Plane). D-04: the issue stays `open` by default (no state field).
  3. `normalizeIssue(raw, { projectId: '${owner}/${repo}' })` — trivial context (D-06); `task_id`/`id` from `node_id`, `ref` from `owner/repo#number`, `url` from `html_url`. The returned TaskItem is shape-identical to a fetched one.
- `KODO_LABEL_ADOPTED` imported from `../../labels.js` (no inline literal — source-hygiene REPORT-05, enforced by `labels-hygiene.test.js` scanning all of `src/`).
- **Contract test B9** — `it('createTask (if supported) round-trips a 201 to a canonical TaskItem')` inside the `for (const providerName of PROVIDERS)` matrix loop (mirror of B8): capability-gated skip, then `assertTaskItemShape(task, providerName)`. Runs (not skips) for BOTH plane + github → closes BIDIR-01 + BIDIR-02 simultaneously. Plus `getCreateTaskArg(name)` per-provider helper, a `createIssue` override in `makeFakeGitHubClient`, method-aware Plane stub routes, and the FROZEN-9 negative-assert at B1.
- `TASK_PROVIDER_METHODS` (interface.js) and `registry.js` left untouched — FROZEN-9 intact; the new B1 negative-assert locks it.

## GitHub PAT scope (D-08)

The create mutation requires write access to issues. Minimum PAT scope to document for operators:
- **Fine-grained PAT:** `Issues: Read and write` (`issues:write`).
- **Classic PAT:** `repo` (for private repos) or `public_repo` (public repos only).

A PAT lacking write scope → **403 `forbidden`**; a nonexistent/inaccessible repo → **404 `not_found`**. Both propagate LOUD as the canonical `Error` (`.code`/`.status`) — `createTask` never catches-and-defaults to an empty TaskItem (D-08 / T-52-2 / T-52-3).

## Task Commits

Each task committed atomically:

1. **Task 1: createIssue POST transport** - `5f46234` (feat) — `src/providers/github/client.js`
2. **Task 2: createTask typeof-detected** - `96ef25e` (feat) — `src/providers/github/provider.js`
3. **Task 3: B9 capability-gated it() + FROZEN-9 negative-assert** - `78e2e5d` (feat) — `test/providers/contract.test.js`

## Files Created/Modified

- `src/providers/github/client.js` - Added `createIssue` (POST transport mirroring `addComment`, no-trailing-slash path, no swallow).
- `src/providers/github/provider.js` - Extended imports with `KODO_LABEL_ADOPTED`; added `createTask` optional method (open-by-default issue create, marker as plain string, trivial-context normalize).
- `test/providers/contract.test.js` - Added `getCreateTaskArg`, a `createIssue` fake-client override (with timestamps), method-aware `stubPlaneFetch` routes (`/work-items/` + `/labels/` POST serve raw shapes), the B9 createTask `it()`, and the FROZEN-9 negative-assert at B1.

## Decisions Made

- **Marker as a plain string at create** — GitHub labels are strings, so `[KODO_LABEL_ADOPTED]` goes directly in the create body; no lookup-or-create round-trip (the Plane Open Q1 complexity does not apply here). The dispatcher's `isAdopted` cut (Plan 01) suppresses re-dispatch regardless.
- **Method-aware stub routes (A3 extension)** — `createWorkItem`/`createLabel` consume `request()` which returns `res.json()` raw; the existing GET routes returned `{ results: [...] }`. I threaded `method` into the route fns so a single suffix serves the list/warmup shape on GET and the raw create shape on POST, instead of forking the route table or asserting status.
- **Fake `createIssue` returns timestamps** — the default `getIssue` fake omits `created_at`/`updated_at`, but `assertTaskItemShape` requires both (Phase 28 D-01), so the create override includes them.

## Deviations from Plan

None — all three autonomous tasks executed exactly as written. No Rule 1/2/3 auto-fixes were needed; targeted and full suites were green on first run.

## Issues Encountered

None. The only nuance was anticipated by the plan (Task 3 step 3 / A3): the Plane POST routes must return the raw create shape, not the `{ results: [...] }` list envelope. Threading `method` into the stub routes handled both GET and POST on the shared suffix cleanly.

## Verification

- `node --test test/providers/contract.test.js` → **18 pass, 0 fail** (9 per provider × 2). The B9 `createTask` `it()` RUNS (not skips) for both plane and github.
- `node --test test/labels-hygiene.test.js` → 4 pass, 0 fail (no inline `'kodo:adopted'` introduced).
- `npm test` (full suite) → **1335 pass, 0 fail, 1 skipped** (pre-existing skip). +2 vs the 1333 baseline = the new createTask `it()` × 2 providers. No regressions.
- `TASK_PROVIDER_METHODS.length === 9` and `createTask` NOT in the list — asserted by the new B1 negative-assert; `interface.js` / `registry.js` untouched.

## Known Stubs

None. `normalizeIssue.groups` is `[]` by design (milestone not extracted — Phase 24 D-14), unchanged here.

## Threat Flags

None new. The change adds the GitHub create-mutation surface (`POST /repos/{o}/{r}/issues`) — anticipated and dispositioned in the plan's `<threat_model>`: T-52-2 (insufficient PAT scope → 403/404 LOUD, never read as success — mitigated by the propagating canonical Error), T-52-1 (marker applied at create so `isAdopted` cuts re-dispatch under `--force`), T-52-3 (no swallowing catch on the mutation), T-52-SC (zero new packages). No surface outside the registered threat model.

## Next Phase Readiness

- BOTH adapters now expose `createTask` as a typeof-detected optional method outside the FROZEN-9, each stamping `kodo:adopted` and normalizing the 201 to a canonical `TaskItem`. Phase 53 (`adoptSession`) can call `provider.createTask` via the `typeof` gate and consume the returned canonical TaskItem with no per-provider special case.
- The contract matrix now guards the create round-trip for both providers — a regression in either `createTask` or its normalizer fails loud in CI.
- The dispatcher's `isAdopted` cut (Plan 01) + the marker applied at create (Plans 02/03) together close the anti-recursion loop (BIDIR-06) end-to-end.

## Self-Check: PASSED

- `src/providers/github/client.js` contains `createIssue` ✓
- `src/providers/github/provider.js` contains `async createTask` + imports `KODO_LABEL_ADOPTED` ✓
- `test/providers/contract.test.js` contains the createTask `it()` + FROZEN-9 negative-assert ✓
- Commits `5f46234`, `96ef25e`, `78e2e5d` exist ✓
- Full suite green (1335 pass / 0 fail / 1 skip) ✓

---
*Phase: 52-createtask-contrato-anti-recursi-n*
*Completed: 2026-06-16 — FINAL wave of the phase*
