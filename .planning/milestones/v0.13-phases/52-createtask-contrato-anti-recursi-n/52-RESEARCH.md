# Phase 52: createTask + contrato + anti-recursión - Research

**Researched:** 2026-06-16
**Domain:** Provider adapter extension (optional typeof-detected method) + dispatcher anti-recursion guard — Node.js, kodo bidirectional reverse flow
**Confidence:** HIGH (every claim below verified by reading the actual source files; the single MEDIUM item is the live Plane CE 201 shape, de-riskable in a 5-min manual POST)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-08)

- **D-01 (anti-recursion primary layer):** `createTask` creates the adopted task **WITHOUT any kodo trigger label** (`kodo:gsd` / `kodo:gsd-quick`). The dispatcher only launches when `parseKodoLabels(...).isKodo === true` (`dispatcher.js:77-80`); without a trigger label the adopted task is **never** dispatched. The anti-redispatch lever is the **absent label**, not a passive state.
- **D-02 (defense in depth, survives `--force`):** `createTask` stamps a `kodo:adopted` marker and a new cut `isAdopted(task.labels)` is added to `dispatcher.js` that drops the task **BEFORE** lock/resolver/launch — an exact mirror of the `isGsdChild` guard (`dispatcher.js:68`, which cuts even under `opts.force`). Constant `KODO_LABEL_ADOPTED = 'kodo:adopted'` + helper `isAdopted` in `src/labels.js`, with anti-inline source-hygiene (mirror of `KODO_LABEL_GSD_CHILD` / `isGsdChild`).
- **D-03:** the `kodo:adopted` marker also makes the task's **provenance** visible/filterable (origin = adopted session) — an honest signal, not just a guard.
- **D-04 (initial state):** the task is created in **in-progress / active** state (Plane: the provider's configured `trigger`/in-progress state; GitHub: the issue is simply `open`), because it reflects reality — the human is already working that ad-hoc session. NOT created in `Backlog`/passive. The "no re-dispatch" guarantee comes from D-01/D-02, NOT from an inactive state.
- **D-05 (transport mirrors existing POST):** new transport methods mirror EXACTLY the existing authenticated POST (`createComment` / `addComment`): same `request()`, same auth already present (`X-API-Key` in Plane, PAT in GitHub). Plane: `POST .../projects/{id}/work-items/`, `name` required, body `description_html`. GitHub: `POST /repos/{o}/{r}/issues`, `title` required, body **Markdown** (already-known divergence from the `addComment` split).
- **D-06 (normalize the 201):** the 201 is normalized back to `TaskItem` via the EXISTING normalizers (`normalizeWorkItem` / `normalizeIssue`), so the returned `TaskItem` is **shape-identical** to a fetched one. `task_id`: Plane `${identifier}-${sequence_id}`, GitHub `number`. `url`: Plane `web_url`/browse-URL (wired v0.12 Phase 48), GitHub `html_url`.
- **D-07 (capability-gated test):** a capability-gated `it()` in `test/providers/contract.test.js` mirroring the B8 `getTaskState` test (~`contract.test.js:498`): asserts `createTask` is a function when supported, that it is **NOT** in `TASK_PROVIDER_METHODS` (the `registry.js` validation loop stays intact), and that a mocked 201 round-trips to a canonical `TaskItem`. The real **Plane CE** endpoint is validated with a ~5-min manual POST at phase start (research flag — the only MEDIUM-confidence item).
- **D-08 (GitHub PAT scope):** document `issues:write` (fine-grained) / `repo` (classic) as minimum scope. `createTask` fails **LOUD** on 403/404 (insufficient scope / nonexistent repo) with a clear message — never silent (never-throws is for the read rails, not for a mutation the operator just requested).

### Claude's Discretion
- Exact internal client method names (`createWorkItem`/`createIssue` suggested).
- The exact taxonomy of `createTask` error `code` strings — coordinated with the Phase 53 `{ok:false, code, detail}` plumbing discriminant; here it's enough that errors propagate with context.

### Deferred Ideas (OUT OF SCOPE)
- `adoptSession` + `state.json` write (idempotency/double-adopt, LOUD atomicity, sanitized data) → **Phase 53** (BIDIR-03/04/05/08). `createTask` is the transport piece Phase 53 consumes.
- Destination project selection / auto-derived title / sanitization → Phase 53 (BIDIR-08). Phase 52 receives `{ projectId, title, description? }` already resolved.
- CLI `kodo adopt` → Phase 54 · dashboard key → Phase 56 (gated by spike 55) · assisted orchestrator → Phase 57.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BIDIR-01 | `createTask` as optional typeof-detected method on **Plane** (`POST .../work-items/`, `name` required, `X-API-Key` already in `PlaneClient.request()`), normalizing the 201 via existing `normalizeWorkItem`. FROZEN-9 preserved; capability-gated `it()` mirrors B8. | §Standard Stack (Plane transport sketch verified line-by-line vs `createComment`), §Code Examples (createWorkItem + provider.createTask), §Architecture Patterns Pattern 1, §Pitfall 4 (normalize context completeness) |
| BIDIR-02 | `createTask` on **GitHub** (`POST /repos/{o}/{r}/issues`, `title` required, **Markdown** body), PAT scope `issues:write`/`repo` documented; contract matrix iterates the capability as in v0.10. | §Standard Stack (GitHub transport sketch vs `addComment`), §Code Examples (createIssue + provider.createTask), §Security Domain (PAT scope + LOUD failure) |
| BIDIR-06 | Anti-recursion: a freshly adopted task must NEVER be re-dispatched. Dual-layer: absent trigger label (primary) + `isAdopted` cut mirroring `isGsdChild` (`dispatcher.js:68`, before lock/resolver/launch, `--force` does not bypass). | §Architecture Patterns Pattern 2+3, §Code Examples (isAdopted + dispatcher cut), §Common Pitfalls 1, §Validation Architecture (adopted task → ignored even under --force) |
</phase_requirements>

## Summary

Phase 52 is a **pure additive extension** of two existing provider adapters plus a one-guard change to the dispatcher. There is no new dependency, no new endpoint, no new file *required* on the source side (the new code lands in 5 existing files: 2 clients, 2 providers, 1 dispatcher + `labels.js`). Every shape it must produce or consume already exists in the repo and was read line-by-line for this research. The work is mechanical mirroring of three proven precedents: (1) the `getTaskState` optional-method pattern (Phase 40), (2) the `createComment`/`addComment` authenticated POST transport, and (3) the `isGsdChild` anti-recursion cut (Phase 29).

The two highest-risk traps are both about *completeness of mirroring*, not novelty. First, `normalizeWorkItem` for Plane requires a **full context object** (`labels`, `projectIdentifier`, `baseUrl`, `webUrl`, `workspaceSlug`, `stateMap`) sourced from the provider's init-warmed caches — passing a partial context silently produces a `TaskItem` with a dead `url` or missing `state`. The provider's `getTaskState` and `listPendingTasks` both already assemble this exact context; `createTask` must copy it verbatim. Second, the anti-recursion guard is a **hard safety property** verified by three existing tests (REPORT-01 behavior, REPORT-01 source-hygiene ordering, REPORT-05 no-inline-literal) — the new `isAdopted` cut must be inserted **before the `if (!opts.force)` block** (i.e., right next to or after `isGsdChild` at line 68) or the source-hygiene/ordering test will (correctly) fail.

**Primary recommendation:** Mirror `getTaskState` for the provider method, `createComment`/`addComment` for the client transport, `isGsdChild`/`KODO_LABEL_GSD_CHILD` for the `labels.js` guard, the REPORT-01 dispatcher test + REPORT-05 hygiene test for `isAdopted`, and the B8 capability-gated `it()` for the contract test. Add a Plane `createTask` route to the contract test's `instantiateProvider` stub. Run a 5-minute manual Plane CE POST at phase start to lock the 201 `sequence_id` shape before writing the normalize call.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| HTTP POST create-task transport | API client (`client.js`) | — | Auth/timeout/error-mapping/NDJSON already centralized in `request()`; create is one more path |
| Raw 201 → canonical `TaskItem` | Provider adapter (`provider.js`) | Normalizer (`normalize.js`) | Provider owns the typeof-detected method + context assembly; normalizer is a pure transform reused verbatim |
| Anti-recursion (re-dispatch suppression) | Dispatcher (`dispatcher.js`) | Labels taxonomy (`labels.js`) | The cut is a dispatch-time correctness property; the marker constant + `isAdopted` predicate live in the single-source-of-truth `labels.js` |
| Contract invariant (FROZEN at 9) | Registry (`registry.js`, UNCHANGED) | Interface (`interface.js`, UNCHANGED) | `createTask` is OUTSIDE the frozen list; registry's 9-method loop must not iterate it |
| Capability detection | Call site (`typeof provider.createTask === 'function'`) | — | Runtime capability, never a contract method (mirror of `getTaskState`) |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js builtin `fetch` | builtin (Node 20+, dev box 22.22.3) | POST transport for both create endpoints | Both `request()` methods already POST `createComment`/`addComment` with auth + 10s `AbortSignal.timeout` + error mapping. `createTask` is the same transport, different path/body. `[VERIFIED: src/providers/plane/client.js:46-54, src/providers/github/client.js:126-131]` |
| `node:test` + `node:assert/strict` | builtin | Contract + dispatcher + hygiene tests | Existing suite (`contract.test.js`, `dispatcher.test.js`, `labels-hygiene.test.js`) is all `node:test`. `[VERIFIED: test/providers/contract.test.js:36-37]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| — | — | **None.** No new runtime/dev dependency. | The milestone STACK.md verdict ("Default-No-New-Dependency holds") is confirmed by source-read: every needed shape already exists. `[VERIFIED: .planning/research/STACK.md TL;DR]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extend existing `request()` | `@octokit/rest`, `axios`, `got` | NEVER. Duplicates auth/timeout/error-mapping/NDJSON the clients already do; breaks LOG-12 isolation + color-isolation invariants. `[CITED: .planning/research/STACK.md "What NOT to Use"]` |
| `createTask` as optional method | Adding it to `TASK_PROVIDER_METHODS` (10th) | NEVER. Breaks FROZEN-at-9, forces every provider to implement create, breaks `registry.js` 9-method loop. `[VERIFIED: src/interface.js:52-62, src/providers/registry.js 9-method loop]` |

**Installation:**
```bash
# Nothing — zero new dependencies. All transport, test, and label infra already present.
```

**Version verification:** N/A — no packages installed. The only external surface is the Plane CE REST API (already in use for GET/PATCH/POST-comment) and GitHub REST `2022-11-28` (already pinned in `GitHubClient.request()` headers, `[VERIFIED: src/providers/github/client.js:118]`).

## Package Legitimacy Audit

> No external packages are installed by this phase. Audit not applicable.

**Packages removed due to slopcheck [SLOP] verdict:** none (no installs)
**Packages flagged as suspicious [SUS]:** none (no installs)

## Architecture Patterns

### System Architecture Diagram

```
  Phase 53 caller (adoptSession)        Contract test (mocked 201)
   │  typeof provider.createTask          │  POST /work-items/ stub route
   │  === 'function'  (capability gate)    │  + makeFakeGitHubClient.createIssue
   ▼                                       ▼
 ┌──────────────────────────────────────────────────────────┐
 │ provider.createTask({ projectId, title, description })    │  ← OPTIONAL, typeof-detected
 │   (NOT in TASK_PROVIDER_METHODS — FROZEN at 9)            │     mirror of getTaskState (Ph40)
 │   1. build description body (Plane: HTML, GitHub: MD)     │
 │   2. client.createWorkItem / client.createIssue ──────────┼──► POST (auth/timeout/errmap
 │   3. normalize raw 201 ──────────────────────────────────┼─►   already in request())
 │      Plane:  normalizeWorkItem(raw, {labels, projectIdent,│        returns raw 201 JSON
 │              baseUrl, webUrl, workspaceSlug, stateMap})    │   (Plane: id+sequence_id;
 │      GitHub: normalizeIssue(raw, {projectId:'owner/repo'}) │    GitHub: number+html_url)
 │   returns canonical TaskItem (shape-identical to fetched) │
 └──────────────────────────────────────────────────────────┘

 ANTI-RECURSION (separate rail, dispatcher.js — BIDIR-06):
   provider.getTask(ref) → task.labels
     │
     ├─ isGsdChild(labels)?  → {action:'ignored', code:'gsd_child'}   (existing, line 68)
     ├─ isAdopted(labels)?   → {action:'ignored', code:'adopted'}     (NEW — mirror, ~line 68-71)
     │       ▲ BOTH cut BEFORE the `if (!opts.force)` block (line 74) — --force does NOT bypass
     ▼
   if (!opts.force) { parseKodoLabels(labels).isKodo? }  ← PRIMARY layer:
     │   no kodo trigger label → {action:'ignored'}          adopted task carries NO trigger label
     ▼
   lock / resolver / launch
```

The created task carries `kodo:adopted` and NO `kodo:gsd`/`kodo:gsd-quick`. Two independent reasons it never launches: (1) primary — `parseKodoLabels` returns `isKodo:false`, ignored at line 77-80; (2) defense — `isAdopted` cuts at ~line 68 even under `--force`.

### Recommended Project Structure
```
src/
├── labels.js                        # MODIFIED — add KODO_LABEL_ADOPTED + isAdopted (mirror gsd-child block at :99-123)
├── interface.js                     # UNCHANGED — TASK_PROVIDER_METHODS stays at 9
├── triggers/
│   └── dispatcher.js                # MODIFIED — import isAdopted; add cut after isGsdChild (line 68), before if(!opts.force)
└── providers/
    ├── registry.js                  # UNCHANGED — 9-method validation loop untouched
    ├── plane/
    │   ├── client.js                # MODIFIED — add createWorkItem(projectId, {name, description_html, state?}) (~6 lines, mirror createComment :175)
    │   ├── provider.js              # MODIFIED — add createTask({projectId,title,description}) after getTaskState (:235-263)
    │   └── normalize.js             # UNCHANGED — reuse normalizeWorkItem
    └── github/
        ├── client.js                # MODIFIED — add createIssue(owner, repo, {title, body, labels}) (~6 lines, mirror addComment :293)
        ├── provider.js              # MODIFIED — add createTask({projectId,title,description}) after getTaskState (:177-180)
        └── normalize.js             # UNCHANGED — reuse normalizeIssue
test/
├── providers/contract.test.js       # MODIFIED — add /work-items/ POST stub route + capability-gated createTask it() (mirror B8 :498)
├── dispatcher.test.js               # MODIFIED — add isAdopted anti-recursion describe block (mirror REPORT-01 :1040-1151)
└── labels-hygiene.test.js           # MODIFIED — add kodo:adopted no-inline assertion (mirror REPORT-05 :41-65)
```

### Pattern 1: Optional provider method via typeof-detection (FROZEN-at-9)
**What:** `createTask` is added to each provider object literal but NOT pushed into `TASK_PROVIDER_METHODS`. Callers gate with `typeof provider.createTask === 'function'`. Exact mechanism that added `getTaskState` in Phase 40.
**When to use:** Any capability not universal to all providers. The registry 9-method loop stays untouched.
**Example:** The plane `getTaskState` precedent comment is the literal template `[VERIFIED: src/providers/plane/provider.js:235-236]`:
```js
// OPTIONAL method (NOT in TASK_PROVIDER_METHODS — FROZEN at 9, D-13). Detected at
// the call site via `typeof provider.getTaskState === 'function'`.
async getTaskState({ id, projectId }) { /* ... */ }
```

### Pattern 2: Anti-recursion early cut (mirror isGsdChild)
**What:** A `isAdopted(task.labels)` cut in `dispatcher.js`, inserted right after the existing `isGsdChild` cut at line 68 and **before** the `if (!opts.force)` block at line 74. Returns `{ action: 'ignored', code: 'adopted' }` (code string is discretion; `'adopted'` recommended, parallel to `'gsd_child'`).
**When to use:** Defense-in-depth so a `--force` re-dispatch or a manually-added trigger label still cannot launch a session for an adopted task.
**Example — the exact existing cut to mirror** `[VERIFIED: src/triggers/dispatcher.js:68-71]`:
```js
if (isGsdChild(task.labels)) {
  console.log(`[kodo:dispatch] Ignored — kodo:gsd-child filtered (anti-recursion)`);
  return { action: 'ignored', code: 'gsd_child' };
}
```

### Pattern 3: Primary layer — absent trigger label
**What:** Because the adopted task carries no `kodo`/`kodo:gsd`/`kodo:gsd-quick`, `parseKodoLabels(task.labels).isKodo` is `false`, and the dispatcher returns `{ action: 'ignored' }` at line 77-80 (when not `--force`). This is the naturally-safe primary layer.
**Verified gate** `[VERIFIED: src/triggers/dispatcher.js:74-80]`:
```js
if (!opts.force) {
  const kodoConfig = parseKodoLabels(task.labels.map((name) => ({ name })));
  if (!kodoConfig.isKodo) {
    return { action: 'ignored' };
  }
}
```
Note: `parseKodoLabels` treats ANY `kodo:*` label as `isKodo:true` (including `kodo:adopted`!) `[VERIFIED: src/labels.js:23-34]`. **This is the critical subtlety:** stamping `kodo:adopted` makes `isKodo` TRUE, so the primary layer (D-01) does NOT suppress an adopted task by itself once the marker is present — `kodo:adopted` would be parsed as a flag. The `isAdopted` cut (D-02) at line 68 fires FIRST and is therefore the load-bearing guard. D-01's "absent trigger label" is what prevents a *launch decision* (no `gsd`/`gsd-quick` flag → `getGsdMode` returns null → no GSD lock/resolver), but the task is only fully suppressed by the `isAdopted` early cut. See Pitfall 1 — this ordering must be exact.

### Anti-Patterns to Avoid
- **Adding `createTask` to `TASK_PROVIDER_METHODS`:** breaks FROZEN-9 + registry loop. Use typeof-detection. `[VERIFIED: src/interface.js:52]`
- **Inlining `labels.some(... 'kodo:adopted' ...)`:** the REPORT-05 hygiene test will fail. Use `isAdopted(labels)` from `labels.js`. `[VERIFIED: test/labels-hygiene.test.js:42-58]`
- **Placing the `isAdopted` cut after `if (!opts.force)`:** the source-hygiene ordering test pattern (REPORT-01 :1178-1188) checks `filterIdx < forceIdx`. Insert before. `[VERIFIED: test/dispatcher.test.js:1178-1188]`
- **Passing a partial normalize context to `normalizeWorkItem`:** produces dead `url`/missing `state`. Copy the full context from `listPendingTasks`/`getTaskState`. `[VERIFIED: src/providers/plane/provider.js:271-278]`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Authenticated POST w/ timeout, rate-limit, error-mapping, NDJSON | A new fetch wrapper | `this.request(path, {method:'POST', body})` | All already centralized: Plane has retry + proactive throttle; GitHub has canonical `.code` error mapping. `[VERIFIED: client.js request() both]` |
| Raw 201 → `TaskItem` | A bespoke field mapper inside `createTask` | `normalizeWorkItem` / `normalizeIssue` | Pure functions emitting exactly the 13 canonical fields; reuse guarantees shape-identity with fetched tasks (D-06). `[VERIFIED: plane/normalize.js:65-97, github/normalize.js:84-108]` |
| Label-marker check | `task.labels.some(l => l === 'kodo:adopted')` inline | `isAdopted(labels)` + `KODO_LABEL_ADOPTED` const in `labels.js` | Source-hygiene invariant enforced by `labels-hygiene.test.js`; tolerant of string|{name} forms. `[VERIFIED: src/labels.js:114-123]` |
| State NAME → state UUID (Plane create-in-state) | A new lookup | Existing `stateByName` cache + `listStates` refresh-on-miss | `updateTaskState` already does exactly this resolution. `[VERIFIED: src/providers/plane/provider.js:200-217]` |

**Key insight:** Phase 52 builds nothing new conceptually — every "how do I do X?" already has a verbatim answer in an adjacent method. The risk is omission (forgetting a normalize-context field, mis-ordering the dispatcher cut), not invention.

## Runtime State Inventory

> Phase 52 is purely additive code (2 client methods, 2 provider methods, 1 labels block, 1 dispatcher cut, 3 test additions). It is NOT a rename/refactor/migration. There is no stored data, live-service config, OS-registered state, secret, or build artifact that embeds a renamed string.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — verified: no datastore key/collection is renamed; `state.json` is written only in Phase 53 (out of scope here). | none |
| Live service config | None — verified: no webhook/dashboard/external config changes; `kodo:adopted` is a NEW label, no existing config references it. | none |
| OS-registered state | None — verified: no task-scheduler/pm2/launchd registration touched. | none |
| Secrets/env vars | None for create itself — the EXISTING `PLANE_API_KEY` / `GITHUB_TOKEN` are reused unchanged (D-05/D-08). No new secret name. Scope must already include write (see Security Domain). | none (verify scope, don't rename) |
| Build artifacts | None — no package rename, no egg-info/compiled artifact. | none |

## Common Pitfalls

### Pitfall 1: The `kodo:adopted` marker makes `parseKodoLabels` return `isKodo:true` — primary layer alone does NOT suppress
**What goes wrong:** Stamping `kodo:adopted` (D-02/D-03) means `parseKodoLabels` sees a `kodo:*` label and sets `isKodo:true` (it pushes `adopted` into `flags`). The "absent trigger label" reasoning (D-01) assumes `isKodo` would be false — but with the marker present, the primary gate at line 77-80 does NOT ignore the task. Only the `isAdopted` early cut (line 68) actually suppresses it.
**Why it happens:** `parseKodoLabels` treats every `kodo:*` as kodo-enabled `[VERIFIED: src/labels.js:23-34]`; the design conflates "is a kodo label" with "is a trigger label." `getGsdMode(flags)` is what distinguishes a launch (`gsd`/`gsd-quick`) from a no-op flag like `adopted` `[VERIFIED: src/labels.js:53-58]`.
**How to avoid:** Make the `isAdopted` cut the load-bearing guard, inserted **before** `if (!opts.force)`. Do NOT rely on D-01's primary layer to suppress on its own — it only prevents a *GSD launch path* (no `gsd` flag → `gsdMode` null → no lock/resolver), not a full dispatch. The verification test must assert `{action:'ignored', code:'adopted'}` even with no trigger label AND even under `--force`.
**Warning signs:** A test that asserts "adopted task ignored via primary layer" passes only because `isAdopted` fired first; removing the marker would reveal the gap.

### Pitfall 2: Incomplete `normalizeWorkItem` context → dead url / missing state
**What goes wrong:** Calling `normalizeWorkItem(raw201, { projectIdentifier })` with a partial context yields `url: undefined` (when identifier unresolved) or `state: undefined` (no `stateMap`), so the returned `TaskItem` is NOT shape-identical to a fetched one — breaking D-06 and the round-trip test.
**Why it happens:** `normalizeWorkItem` needs `{ labels, projectIdentifier, baseUrl, webUrl, workspaceSlug, stateMap }` `[VERIFIED: src/providers/plane/normalize.js:65-97]`; the create-201 raw payload may not include `project_detail`/`state_detail`, so the context caches must fill them.
**How to avoid:** Copy the EXACT context object that `listPendingTasks` assembles `[VERIFIED: src/providers/plane/provider.js:271-278]`: `{ labels: labelCache, projectIdentifier: proj.identifier, baseUrl: config.baseUrl, webUrl: config.webUrl, workspaceSlug: config.workspaceSlug, stateMap: stateCache }`. Resolve `proj` via `config.projects.find(p => p.id === projectId)`.
**Warning signs:** Round-trip test gets `url: undefined` or a `browse/UNKNOWN-<seq>` link; `state` key missing.

### Pitfall 3: Plane trailing-slash strictness on the create path
**What goes wrong:** `POST /projects/{id}/work-items` (no trailing slash) 404s or redirects on Plane.
**Why it happens:** Plane is trailing-slash-strict; every existing path ends in `/` `[VERIFIED: src/providers/plane/client.js:96,107,176]`.
**How to avoid:** Use `/projects/${projectId}/work-items/` — byte-identical to `listWorkItems` (`:107`) and the comments POST (`:176`).
**Warning signs:** 404 on create only; GET/list work fine.

### Pitfall 4: GitHub create failure must be LOUD (D-08)
**What goes wrong:** A 403 (insufficient PAT scope) or 404 (repo nonexistent) on create is swallowed never-throws-style, the operator thinks the task was created, and Phase 53 writes a `state.json` row pointing at nothing.
**Why it happens:** `GitHubClient.request()` already throws a canonical `Error` with `.code` (`forbidden`/`not_found`) on non-ok `[VERIFIED: src/providers/github/client.js:168-195]` — but `createTask` must let that propagate, NOT catch-and-default.
**How to avoid:** `createTask` does NOT wrap the POST in a swallowing try/catch. The error propagates with `.code`/`.status`; the Phase 53 caller maps it to `{ok:false, code, detail}`. (Never-throws is for read rails; a create mutation must surface failure.) `[CITED: CONTEXT.md D-08]`
**Warning signs:** `createTask` returns a malformed/empty TaskItem on a 403 instead of throwing.

### Pitfall 5: Adding `createTask` to the registry's frozen list
**What goes wrong:** Pushing `'createTask'` into `TASK_PROVIDER_METHODS` makes `registry.js`'s 9-method loop require it on every provider, breaking validation for any provider lacking it.
**How to avoid:** Leave `interface.js:52-62` untouched (stays at 9); add the method to the provider object literal only; gate with `typeof`. The contract test must assert `TASK_PROVIDER_METHODS.length === 9` stays true (B1 test at `:431` already iterates exactly the frozen list). `[VERIFIED: src/interface.js:52-62, test/providers/contract.test.js:431-439]`
**Warning signs:** B1 contract test now lists 10 methods; a provider without `createTask` fails registry validation.

## Code Examples

> All examples below are SKETCHES anchored to verified existing methods. Exact body-field passthrough (priority, labels) is discretion; the load-bearing parts (path, required field, normalize context) are verified.

### Plane client transport (mirror createComment `:175-180`)
```js
// src/providers/plane/client.js — ~6 lines, reuses request() verbatim
/**
 * @param {string} projectId
 * @param {{ name: string, description_html?: string, state?: string, labels?: string[] }} fields
 */
async createWorkItem(projectId, fields) {
  return this.request(`/projects/${projectId}/work-items/`, {
    method: 'POST',
    body: fields,   // name required; state is a state UUID (not a name); description_html is HTML
  });
}
```

### Plane provider.createTask (mirror getTaskState `:248` + listPendingTasks context `:271-278`)
```js
// src/providers/plane/provider.js — OPTIONAL, after getTaskState, OUTSIDE the 9
// D-04: create in the configured in-progress/trigger state. Resolve NAME → UUID via the
// existing stateByName cache (same path updateTaskState uses, :200-217). Marker label via labels.
async createTask({ projectId, title, description }) {
  const html = description ? '<p>' + description.replace(/\n/g, '<br>') + '</p>' : '';
  // state UUID for config.states.trigger (D-04) — refresh-on-miss like updateTaskState
  let stateId = stateByName.get(projectId)?.get(config.states.trigger);
  if (!stateId) {
    const states = await client.listStates(projectId);
    const byName = new Map();
    for (const s of states) { stateCache.set(s.id, s.name); byName.set(s.name, s.id); }
    stateByName.set(projectId, byName);
    stateId = byName.get(config.states.trigger);   // may be undefined → Plane uses project default
  }
  const raw = await client.createWorkItem(projectId, {
    name: title,
    description_html: html,
    ...(stateId ? { state: stateId } : {}),
    // kodo:adopted marker applied here — Plane labels are UUIDs; resolve from labelCache or
    // create the label if absent. (DISCRETION: marker-application mechanism; see Open Question Q1)
  });
  const proj = config.projects.find((p) => p.id === projectId);
  return normalizeWorkItem(raw, {            // ← FULL context (Pitfall 2)
    labels: labelCache,
    projectIdentifier: proj?.identifier || 'UNKNOWN',
    baseUrl: config.baseUrl,
    webUrl: config.webUrl,
    workspaceSlug: config.workspaceSlug,
    stateMap: stateCache,
  });
}
```

### GitHub client transport (mirror addComment `:293-300`)
```js
// src/providers/github/client.js — ~6 lines, reuses request() verbatim
/**
 * @param {string} owner @param {string} repo
 * @param {{ title: string, body?: string, labels?: string[] }} fields
 */
async createIssue(owner, repo, fields) {
  const o = encodeURIComponent(owner), r = encodeURIComponent(repo);
  return this.request(`/repos/${o}/${r}/issues`, {
    method: 'POST',
    body: fields,   // title required; body is Markdown (NOT HTML — divergence from Plane)
  });
}
```

### GitHub provider.createTask (mirror getTaskState `:177-180` + parseRef `:122`)
```js
// src/providers/github/provider.js — OPTIONAL, OUTSIDE the 9.
// projectId is 'owner/repo' (D-08 / listProjects shape :201-204). D-04: issue stays `open`.
// kodo:adopted attached at creation via `labels` (GitHub labels are plain strings — simpler than Plane).
async createTask({ projectId, title, description }) {
  const [owner, repo] = projectId.split('/');
  const raw = await client.createIssue(owner, repo, {
    title,
    body: description || '',
    labels: [KODO_LABEL_ADOPTED],   // GitHub: string labels, attached at create (D-02/D-03)
  });
  return normalizeIssue(raw, { projectId: `${owner}/${repo}` });
}
```

### labels.js — KODO_LABEL_ADOPTED + isAdopted (mirror gsd-child block `:99-123`)
```js
// src/labels.js — append after isGsdChild. Exact structural mirror.
export const KODO_LABEL_ADOPTED = 'kodo:adopted';

/** True iff labels contain the kodo:adopted marker. Tolerates string[] and {name}[]. Case-insensitive. */
export function isAdopted(labels) {
  if (!Array.isArray(labels)) return false;
  return labels.some((l) => {
    const name =
      typeof l === 'object' && l !== null ? l.name :
      typeof l === 'string' ? l : null;
    return typeof name === 'string' && name.toLowerCase() === KODO_LABEL_ADOPTED;
  });
}
```

### dispatcher.js cut (insert after isGsdChild `:71`, before `if (!opts.force)` `:74`)
```js
// src/triggers/dispatcher.js — import isAdopted alongside isGsdChild (line 6)
// Insert immediately after the isGsdChild block (line 68-71):
if (isAdopted(task.labels)) {
  console.log(`[kodo:dispatch] Ignored — kodo:adopted filtered (anti-recursion)`);
  return { action: 'ignored', code: 'adopted' };
}
```

### Contract test — Plane stub route + capability-gated it() (mirror B8 `:498-505`)
```js
// test/providers/contract.test.js
// 1. Add POST handler to the Plane stub. The existing '/work-items/' route (:317) returns
//    { results: [planeWorkItem] } for GET; the stub matches by path suffix, not method, so
//    a POST to /work-items/ already routes there and returns planeWorkItem as the "201".
//    The stub's Response is status:200 — acceptable for the round-trip assertion (we assert
//    SHAPE, not status). If status matters, extend stubPlaneFetch to inspect method.
// 2. getCreateTaskArg(name): plane → { projectId, title, description }; github → same with
//    projectId 'octocat/hello-world'.
// 3. The it() (mirror :498):
it('createTask (if supported) round-trips a 201 to a canonical TaskItem', async () => {
  if (typeof provider.createTask !== 'function') return; // capability-gated skip
  const task = await provider.createTask(getCreateTaskArg(providerName));
  assertTaskItemShape(task, providerName);               // reuses the 13-field shape assert
});
// 4. FROZEN-9 stays green via the existing B1 test (:431) — no change needed there, but a
//    NEW negative assert is worth adding: createTask is NOT in TASK_PROVIDER_METHODS.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "kodo never creates or deletes tasks" (PROJECT.md Out of Scope) | v0.13 introduces **create** (delete still forbidden) | This milestone | createTask is consciously additive; a provider orphan is resolved by idempotent re-run (Phase 53), never by delete. `[CITED: CONTEXT.md <specifics>]` |
| Optional methods unknown (pre-Phase 40) | typeof-detected optional methods OUTSIDE the frozen 9 | Phase 40 (`getTaskState`) | `createTask` is the second instance of an established pattern. `[VERIFIED: provider.js getTaskState both]` |

**Deprecated/outdated:** none relevant to this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Plane CE `POST /projects/{id}/work-items/` returns a 201 with `id` + `sequence_id` (same shape as GET) | Standard Stack, Pitfall 3 | If CE diverges, `normalizeWorkItem` produces a wrong `ref`/`url`. Mitigation: the locked D-07 5-min manual POST at phase start. MEDIUM confidence — only residual unknown. `[ASSUMED: docs target Plane Cloud; CE not explicitly stated — STACK.md CE caveat]` |
| A2 | Stamping `kodo:adopted` requires resolving/creating a Plane label UUID at create time (Plane labels are UUIDs, not strings) | Code Examples (Plane createTask), Open Q1 | If the marker can't be applied at create on Plane, D-02's defense for the Plane path relies solely on the absent-trigger-label primary layer until a follow-up PATCH adds it. The `isAdopted` cut still protects once the label exists. `[ASSUMED: from normalize.js resolveWorkItemLabels UUID handling :41-54 — Plane labels arrive as UUIDs]` |
| A3 | The contract-test Plane stub can serve the create POST via the existing `/work-items/` suffix route (method-agnostic matching) | Code Examples (Contract test) | If status:201 is asserted, the stub needs a method-aware extension. Low risk — the round-trip asserts shape, not status. `[ASSUMED: stubPlaneFetch matches by path suffix only :258]` |

## Open Questions

1. **How is `kodo:adopted` applied to a Plane work item at creation?**
   - What we know: GitHub labels are plain strings, attachable in the create `labels` array (`[KODO_LABEL_ADOPTED]`). Plane labels are UUIDs (`resolveWorkItemLabels` handles UUID arrays `[VERIFIED: src/providers/plane/normalize.js:41-54]`), and the create body's `labels` field expects UUIDs.
   - What's unclear: whether a `kodo:adopted` label UUID already exists in the workspace, or must be created/looked-up first. `labelCache` holds existing label `{id,name}` pairs.
   - Recommendation: in `createTask`, look up `kodo:adopted` in `labelCache` by name → use its UUID; if absent, either (a) create it via a Plane labels POST (new client method, in-scope-adjacent) or (b) apply the marker via a follow-up `updateWorkItem` PATCH after create. Decide at planning. The `isAdopted` dispatcher guard works regardless of *when* the label lands, but D-02's "survives --force" property needs the label present before the next poll tick. **Flag for discuss/planning — this is the one genuinely open mechanism.**

2. **Error `code` taxonomy for `createTask` failures (discretion per CONTEXT.md).**
   - What we know: GitHub `request()` throws canonical `.code` (`forbidden`/`not_found`); Plane `request()` throws a plain `Error` with status in the message.
   - What's unclear: exact `code` strings Phase 53 will discriminate on.
   - Recommendation: let errors propagate raw in Phase 52 (CONTEXT.md says "enough that errors propagate with context"); Phase 53 owns the `{ok:false, code, detail}` mapping. No decision needed now.

## Environment Availability

> Phase 52 makes code/test changes only. The two external surfaces (Plane CE, GitHub) are ALREADY in active use by the existing read/PATCH/comment paths — no new tool, service, or runtime is introduced.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js `fetch` + `node:test` | transport + tests | ✓ | Node 22.22.3 (dev box) | — |
| Plane CE REST `/api/v1` | BIDIR-01 create | ✓ (already used for GET/PATCH/POST-comment) | self-hosted CE | 5-min manual POST validates create-201 (D-07) |
| GitHub REST `2022-11-28` | BIDIR-02 create | ✓ (pinned in client headers) | 2022-11-28 | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Plane CE create-201 shape is verified-by-use for read paths but not yet for create — the locked D-07 manual POST closes this (A1).

## Validation Architecture

> nyquist_validation is enabled (config.json `workflow.nyquist_validation` absent of `false`). This section is REQUIRED.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (builtin, Node 22) |
| Config file | none — `node --test` discovers `test/**/*.test.js` |
| Quick run command | `node --test test/providers/contract.test.js test/dispatcher.test.js test/labels-hygiene.test.js test/labels.test.js` |
| Full suite command | `npm test` (runs `node --test` across `test/`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BIDIR-01 | Plane `createTask` round-trips mocked 201 → canonical `TaskItem` (13-field shape, valid url+state) | unit (capability-gated) | `node --test test/providers/contract.test.js` | ✅ (extend with createTask it() + stub route) |
| BIDIR-02 | GitHub `createTask` round-trips mocked 201 (issue) → canonical `TaskItem` | unit (capability-gated) | `node --test test/providers/contract.test.js` | ✅ (extend `makeFakeGitHubClient` with `createIssue`) |
| BIDIR-01/02 | `TASK_PROVIDER_METHODS.length === 9` AND `createTask` NOT in it | unit (invariant) | `node --test test/providers/contract.test.js` | ✅ (B1 test :431 already asserts; add negative assert) |
| BIDIR-06 | Adopted-labeled task → dispatcher returns `{action:'ignored', code:'adopted'}` | unit | `node --test test/dispatcher.test.js` | ❌ Wave 0 — new describe block (mirror REPORT-01 :1040) |
| BIDIR-06 | Cut fires even under `opts.force:true` (--force does NOT bypass) | unit | `node --test test/dispatcher.test.js` | ❌ Wave 0 (mirror REPORT-01 :1110) |
| BIDIR-06 | Cut fires BEFORE acquireGsdLock / resolvePhase / launchWorkItem | unit | `node --test test/dispatcher.test.js` | ❌ Wave 0 (mirror REPORT-01 :1099) |
| BIDIR-06 | Control: a normal `kodo:gsd` task still reaches the resolver (no false positive) | unit | `node --test test/dispatcher.test.js` | ❌ Wave 0 (mirror REPORT-01 :1140) |
| BIDIR-06 | `isAdopted` cut placed before `if (!opts.force)` (source-hygiene ordering) | unit (static) | `node --test test/dispatcher.test.js` | ❌ Wave 0 (mirror REPORT-01 :1178) |
| BIDIR-06 | No inline `'kodo:adopted'` literal outside `labels.js`; `labels.js` exports the const + helper | unit (static) | `node --test test/labels-hygiene.test.js` | ❌ Wave 0 (mirror REPORT-05 :42-63) |
| BIDIR-06 | `isAdopted` unit truth table (string[]/{name}[], case-insensitive, empty/null) | unit | `node --test test/labels.test.js` | ❌ Wave 0 (mirror existing isGsdChild tests in labels.test.js) |

### Sampling Rate
- **Per task commit:** `node --test test/providers/contract.test.js test/dispatcher.test.js test/labels.test.js test/labels-hygiene.test.js`
- **Per wave merge:** `npm test` (full suite — guards the 894+ existing tests against regression)
- **Phase gate:** full suite green before `/gsd:verify-work`; plus the manual Plane CE create-201 POST (D-07) recorded as a one-line evidence note.

### Wave 0 Gaps
- [ ] `test/dispatcher.test.js` — new `describe('BIDIR-06 — kodo:adopted anti-recursion filter')` block, structural clone of REPORT-01 (`:1040-1151`) + source-hygiene (`:1153-1189`), swapping `gsd-child`→`adopted`, `code:'gsd_child'`→`code:'adopted'`.
- [ ] `test/labels-hygiene.test.js` — extend REPORT-05 to also assert no inline `'kodo:adopted'` and that `labels.js` exports `KODO_LABEL_ADOPTED` + `isAdopted`.
- [ ] `test/labels.test.js` — `isAdopted` truth-table unit tests (mirror existing `isGsdChild` coverage).
- [ ] `test/providers/contract.test.js` — `getCreateTaskArg(name)` helper + capability-gated `createTask` it() + `makeFakeGitHubClient.createIssue` override + a negative assert that `createTask` is NOT in `TASK_PROVIDER_METHODS`.
- [ ] Framework install: none — `node:test` is builtin.

## Security Domain

> security_enforcement is enabled (absent = enabled). Section REQUIRED.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reuse existing `X-API-Key` (Plane) / `token <PAT>` (GitHub) headers — no new auth surface. `[VERIFIED: client.js both]` |
| V3 Session Management | no | No session/cookie surface in this phase. |
| V4 Access Control | yes | GitHub create requires PAT scope `issues:write` (fine-grained) or `repo` (classic); Plane API key must have project write. Fail LOUD on 403/404 (D-08). `[CITED: CONTEXT.md D-08, STACK.md GitHub auth]` |
| V5 Input Validation | yes | `createTask` receives `{projectId, title, description}` already-resolved by Phase 53; bodies are JSON-encoded via `JSON.stringify` in `request()` (no injection into the HTTP layer). Sanitization of title/description (path/home-dir redaction) is **Phase 53's** responsibility (BIDIR-08), NOT this phase. `[VERIFIED: request() body JSON.stringify]` |
| V6 Cryptography | no | No crypto introduced; HMAC verify path untouched. |

### Known Threat Patterns for {Plane/GitHub create POST}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Insufficient PAT scope → silent 403 mis-read as success | Repudiation / Tampering | LOUD failure: let `GitHubClient.request()`'s canonical `.code='forbidden'` Error propagate (D-08); never default to an empty TaskItem. `[VERIFIED: github/client.js:64-68,168-195]` |
| Self-recursion: adopted task re-dispatched, launches a colliding session | Denial of Service | Dual-layer anti-recursion (BIDIR-06): `isAdopted` early cut (survives --force) + absent trigger label. `[CITED: PITFALLS.md Pitfall 1]` |
| Leaking cwd/transcript/home-path into a shared manager via title/description | Information Disclosure | OUT OF SCOPE for Phase 52 — Phase 52 receives already-sanitized `{title, description}`. Sanitization is BIDIR-08 (Phase 53). Flag: do NOT add unsanitized derivation here. `[CITED: PITFALLS.md Pitfall 5 / CONTEXT.md Deferred]` |
| Plain `Error` message leaking API internals (Plane) | Information Disclosure | Plane `request()` includes response text in the thrown message `[VERIFIED: client.js:70-72]` — acceptable for a server-side log rail; ensure Phase 53 does not echo raw errors to a shared surface. |

## Sources

### Primary (HIGH confidence — direct source read 2026-06-16)
- `src/providers/plane/client.js` — `request()` POST plumbing (`:23-92`), `createComment` (`:175-180`), `listWorkItems` trailing-slash path (`:107`), `listStates` (`:95-98`)
- `src/providers/github/client.js` — `request()` + canonical error mapping (`:106-217`, `:60-70`), `addComment` Markdown POST (`:293-300`), API version pin (`:118`)
- `src/providers/plane/provider.js` — `getTaskState` optional-method precedent (`:235-263`), `updateTaskState` state-name→UUID resolution (`:200-217`), `listPendingTasks` normalize context (`:265-284`)
- `src/providers/github/provider.js` — `getTaskState` precedent (`:167-180`), `parseRef` owner/repo (`:122`), `listProjects` 'owner/repo' shape (`:201-204`)
- `src/providers/plane/normalize.js` — `normalizeWorkItem` 13-field output + required context (`:65-97`), `resolveWorkItemLabels` UUID handling (`:41-54`)
- `src/providers/github/normalize.js` — `normalizeIssue` 13-field output (`:84-108`)
- `src/interface.js` — `TASK_PROVIDER_METHODS` FROZEN at 9 (`:52-62`), `TaskItem` typedef (`:11-26`)
- `src/labels.js` — `parseKodoLabels` (`:12-38`), `getGsdMode` (`:53-58`), `KODO_LABEL_GSD_CHILD` + `isGsdChild` mirror target (`:99-123`)
- `src/triggers/dispatcher.js` — `isGsdChild` cut (`:68-71`), `if (!opts.force)` + `isKodo` gate (`:74-80`), import line (`:6`)
- `test/providers/contract.test.js` — B8 capability-gated test (`:494-505`), `getTaskStateArg` (`:375-381`), `instantiateProvider` stub routes (`:287-347`), `assertTaskItemShape` 13-field (`:139-187`), B1 9-method (`:431-439`), `makeFakeGitHubClient` (`:195-239`)
- `test/dispatcher.test.js` — REPORT-01 anti-recursion behavior (`:1040-1151`), source-hygiene ordering (`:1153-1189`)
- `test/labels-hygiene.test.js` — REPORT-05 no-inline-literal mirror target (`:41-65`)
- `test/fixtures/plane-workitem.json` — 201 shape reference (`id`, `sequence_id:42`, `state`, `state_detail`, `project_detail`)

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md` — verified Plane `POST .../work-items/` + GitHub `POST .../issues` endpoints, 201 shapes, PAT scope (milestone research, 2026-06-15)
- `.planning/research/ARCHITECTURE.md` — createTask wiring, build order, FROZEN-9 reasoning
- `.planning/research/PITFALLS.md` — Pitfall 1 (self-recursion), Pitfall 6 (FROZEN-9/0-token), Pitfall 5 (title leak, out of scope here)

### Tertiary (LOW confidence — needs phase-start validation)
- Plane CE create-201 exact shape — A1, closed by the locked D-07 5-min manual POST.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; every transport/normalize/test shape read from source.
- Architecture (optional method + anti-recursion): HIGH — three existing precedents (getTaskState, createComment, isGsdChild) read line-by-line; the only subtlety (Pitfall 1, `kodo:adopted` → `isKodo:true`) is documented.
- Pitfalls: HIGH — each anchored to a verified line; the normalize-context and dispatcher-ordering traps are enforced by existing tests.
- Plane CE create-201 shape: MEDIUM — verified-by-use for reads, locked manual POST for create.

**Research date:** 2026-06-16
**Valid until:** 2026-07-16 (stable internal codebase; the one external unknown is de-risked at phase start)
