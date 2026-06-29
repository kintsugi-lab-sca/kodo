# Phase 52: createTask + contrato + anti-recursión - Pattern Map

**Mapped:** 2026-06-16
**Files analyzed:** 11 (all MODIFIED — Phase 52 is purely additive; NO new source files)
**Analogs found:** 11 / 11 (100% — every precedent is in-file or a sibling block, verified line-by-line)

> **Note for planner:** Every analog below lives in the SAME file being modified (or a directly-imported sibling). This is mechanical mirroring, not invention. Line numbers were re-verified against HEAD on 2026-06-16; minor drift from RESEARCH.md noted inline where present.

## File Classification

| Modified File | Role | Data Flow | Closest Analog (in-file) | Match Quality |
|---------------|------|-----------|--------------------------|---------------|
| `src/providers/plane/client.js` | client (transport) | request-response (POST create) | `createComment` (`:175-180`) | exact |
| `src/providers/github/client.js` | client (transport) | request-response (POST create) | `addComment` (`:293-300`) | exact |
| `src/providers/plane/provider.js` | provider (adapter) | transform (201 → TaskItem) | `getTaskState` (`:248-263`) + `listPendingTasks` ctx (`:265-284`) + `updateTaskState` state-resolve (`:200-218`) | exact |
| `src/providers/github/provider.js` | provider (adapter) | transform (201 → TaskItem) | `getTaskState` (`:177-180`) + `getTask` (`:121-125`) | exact |
| `src/providers/plane/normalize.js` | normalizer (pure) | transform | `normalizeWorkItem` (`:65-97`) — REUSE verbatim, no edit | exact (reuse) |
| `src/providers/github/normalize.js` | normalizer (pure) | transform | `normalizeIssue` (`:84-108`) — REUSE verbatim, no edit | exact (reuse) |
| `src/labels.js` | utility (taxonomy) | — | `KODO_LABEL_GSD_CHILD` + `isGsdChild` (`:99-123`) | exact |
| `src/triggers/dispatcher.js` | middleware (dispatch guard) | event-driven (cut) | `isGsdChild` cut (`:63-71`) | exact |
| `src/interface.js` | config (contract) | — | `TASK_PROVIDER_METHODS` (`:52-62`) — REFERENCE ONLY, FROZEN, do NOT touch | n/a (untouched) |
| `test/providers/contract.test.js` | test | — | B8 `getTaskState` it() (`:494-505`) + `getTaskStateArg` (`:375-381`) + `instantiateProvider` (`:287-347`) + `makeFakeGitHubClient` (`:195-239`) | exact |
| `test/dispatcher.test.js` | test | — | REPORT-01 behavior (`:1040-1151`) + source-hygiene (`:1153-1189`) | exact |
| `test/labels-hygiene.test.js` | test | — | REPORT-05 (`:41-65`) | exact |
| `test/labels.test.js` | test | — | `isGsdChild` truth-table (`:171-214`) | exact |

> `src/providers/registry.js` is also REFERENCE ONLY (its 9-method loop iterates `TASK_PROVIDER_METHODS` — must stay intact; `createTask` is never iterated).

---

## Pattern Assignments

### `src/providers/plane/client.js` — add `createWorkItem` (client, request-response)

**Analog:** `createComment` (`src/providers/plane/client.js:175-180`)

**Core transport pattern to mirror** (`:175-180`):
```javascript
async createComment(projectId, workItemId, commentHtml) {
  return this.request(`/projects/${projectId}/work-items/${workItemId}/comments/`, {
    method: 'POST',
    body: { comment_html: commentHtml },
  });
}
```

**What to copy / change:**
- Same `this.request(path, { method: 'POST', body })` shape — auth (`X-API-Key`), 10s timeout, rate-limit retry, error throw are ALL already centralized in `request()` (`:23-92`). Do NOT add a new fetch.
- New path: `` `/projects/${projectId}/work-items/` `` — **byte-identical** to `listWorkItems` (`:107`) and the comments POST. **Pitfall 3:** trailing slash is load-bearing (Plane is trailing-slash-strict; `POST .../work-items` without `/` 404s).
- Body is `{ name, description_html?, state?, labels? }` — `name` required; `state` is a state UUID (NOT a name); `description_html` is HTML.
- `request()` returns `res.json()` directly (the raw 201 work item) — no envelope.

**Error handling:** inherited from `request()` — non-ok throws `Error('Plane API ${status}: ${path} — ${text}')` (`:70-72`). `createWorkItem` does NOT wrap/swallow (D-08: create is a mutation, fails LOUD).

---

### `src/providers/github/client.js` — add `createIssue` (client, request-response)

**Analog:** `addComment` (`src/providers/github/client.js:293-300`)

**Core transport pattern to mirror** (`:293-300`):
```javascript
async addComment(owner, repo, number, markdownBody) {
  const o = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  return this.request(`/repos/${o}/${r}/issues/${number}/comments`, {
    method: 'POST',
    body: { body: markdownBody },
  });
}
```

**What to copy / change:**
- `encodeURIComponent(owner)` / `encodeURIComponent(repo)` — every GitHub client method does this (`:229-230`, `:255-256`, `:294-295`, `:313-314`). Copy it.
- New path: `` `/repos/${o}/${r}/issues` `` — note NO trailing number, NO trailing slash (GitHub convention, mirrors the `listIssues` base path `:264`).
- Body is `{ title, body?, labels? }` — `title` required; `body` is **Markdown** (NOT HTML — the known divergence from Plane, documented at client.js:285).
- GitHub labels are plain strings → pass `labels: [KODO_LABEL_ADOPTED]` directly in the create body (D-02/D-03 marker attached at creation; no UUID resolution unlike Plane).

**Error handling — LOAD-BEARING (D-08 / Pitfall 4):** `request()` already throws a canonical `Error` with `.code` (`'forbidden'`/`'not_found'`) + `.status` on non-ok (`:168-195`, `mapErrorCode` `:60-70`). `createIssue` must let it PROPAGATE — never catch-and-default to an empty TaskItem. Never-throws is for the read rails only.

---

### `src/providers/plane/provider.js` — add `createTask` (provider, transform)

**Analog (optional-method template):** `getTaskState` (`src/providers/plane/provider.js:248-263`)
**Analog (state NAME→UUID resolve):** `updateTaskState` (`:200-218`)
**Analog (FULL normalize context):** `listPendingTasks` (`:265-284`)

**Optional-method comment template to copy verbatim** (`:235-236`):
```javascript
// OPTIONAL method (NOT in TASK_PROVIDER_METHODS — FROZEN at 9, D-13). Detected at
// the call site via `typeof provider.getTaskState === 'function'`.
```
→ swap `getTaskState` for `createTask`. Place the new method inside the `provider` object literal, OUTSIDE the 9 — same level as `getTaskState`.

**State NAME→UUID resolution pattern to mirror** (`updateTaskState` `:200-216`) — refresh-on-miss against the `stateByName` cache, for D-04 (create in the configured `config.states.trigger` in-progress state):
```javascript
let stateId = stateByName.get(task.projectId)?.get(stateName);
if (!stateId) {
  const states = await client.listStates(task.projectId);
  const byName = new Map();
  for (const s of states) {
    stateCache.set(s.id, s.name);
    byName.set(s.name, s.id);
  }
  stateByName.set(task.projectId, byName);
  stateId = byName.get(stateName);
  // (updateTaskState throws if unresolved; createTask may let it be undefined → Plane default)
}
```

**FULL normalize context to copy — LOAD-BEARING (Pitfall 2)** (`listPendingTasks` `:271-278`):
```javascript
const context = {
  labels: labelCache,
  projectIdentifier: proj.identifier,
  baseUrl: config.baseUrl,
  webUrl: config.webUrl,
  workspaceSlug: config.workspaceSlug,
  stateMap: stateCache,
};
// ...
normalizeWorkItem(item, context);
```
Resolve `proj` via `config.projects.find((p) => p.id === projectId)`. Passing a PARTIAL context yields `url: undefined` (identifier unresolved → see normalize.js `:72-91`) or `state: undefined` (no `stateMap` → normalize.js `:93`), breaking shape-identity (D-06) and the round-trip test.

**Open question for planner (Research Q1 / A2):** how `kodo:adopted` is applied to a Plane work item at create. Plane labels are UUIDs (`resolveWorkItemLabels` `:41-54` resolves UUID→name). Options: (a) look up `kodo:adopted` UUID in `labelCache` by name and pass in create body `labels`; (b) follow-up `updateWorkItem` PATCH after create; (c) create the label first via a new client method. The `isAdopted` dispatcher guard works regardless of WHEN the label lands, but D-02's "survives --force" needs it present before the next poll tick. **Decide at planning.**

---

### `src/providers/github/provider.js` — add `createTask` (provider, transform)

**Analog (optional-method template):** `getTaskState` (`src/providers/github/provider.js:177-180`)
**Analog (owner/repo split + normalize):** `getTask` (`:121-125`)

**Optional-method comment template to copy** (`:167-168`):
```javascript
// OPTIONAL method (NOT in TASK_PROVIDER_METHODS — FROZEN at 9, D-13). Detected via
// `typeof provider.getTaskState === 'function'` at the call site.
```
→ swap `getTaskState` for `createTask`. Place inside the `provider` object literal, OUTSIDE the 9.

**Owner/repo split + normalize pattern to mirror** (`getTask` `:121-125`):
```javascript
async getTask(ref) {
  const { owner, repo, number } = parseRef(ref);
  const issue = await client.getIssue(owner, repo, number);
  return normalizeIssue(issue, { projectId: `${owner}/${repo}` });
}
```

**What to copy / change for `createTask`:**
- `projectId` arrives as `'owner/repo'` (the `listProjects` shape `:201-204`) → split with `const [owner, repo] = projectId.split('/')`.
- Call `client.createIssue(owner, repo, { title, body: description || '', labels: [KODO_LABEL_ADOPTED] })`.
- GitHub `normalizeIssue` context is trivially simple (D-06): `normalizeIssue(raw, { projectId: `${owner}/${repo}` })` — `task_id` from `node_id`, `ref` from `number`, `url` from `html_url` (all in normalize.js `:93-107`). NO cache assembly needed (contrast with Plane).
- D-04: GitHub issue stays `open` by default — no state field needed in the create body.

---

### `src/providers/plane/normalize.js` — REUSE `normalizeWorkItem` (normalizer, pure) — NO EDIT

**Analog / target:** `normalizeWorkItem` (`:65-97`) — already emits the 13 canonical `TaskItem` fields.

This file is **UNCHANGED**. `createTask` (Plane provider) imports and calls it for the 201. The only requirement is passing the FULL context (see Plane provider section above / Pitfall 2). The 201 raw shape is assumed identical to a fetched work item (`id` + `sequence_id` + `state` + `state_detail`/`project_detail`) — **MEDIUM-confidence assumption A1**, de-risked by the locked D-07 5-min manual Plane CE POST at phase start.

---

### `src/providers/github/normalize.js` — REUSE `normalizeIssue` (normalizer, pure) — NO EDIT

**Analog / target:** `normalizeIssue` (`:84-108`) — emits 13 canonical fields; `id=node_id` (`:94`), `ref=owner/repo#number` (`:95`), `url=html_url` (`:102`), `state='open'|'closed'` (`:104`).

This file is **UNCHANGED**. `createTask` (GitHub provider) imports and calls it with `{ projectId: 'owner/repo' }`.

---

### `src/labels.js` — add `KODO_LABEL_ADOPTED` + `isAdopted` (utility)

**Analog:** `KODO_LABEL_GSD_CHILD` const + `isGsdChild` helper (`:99-123`)

**Exact structural mirror to copy** (`:99-123`):
```javascript
export const KODO_LABEL_GSD_CHILD = 'kodo:gsd-child';

export function isGsdChild(labels) {
  if (!Array.isArray(labels)) return false;
  return labels.some((l) => {
    const name =
      typeof l === 'object' && l !== null ? l.name :
      typeof l === 'string' ? l :
      null;
    return typeof name === 'string' && name.toLowerCase() === KODO_LABEL_GSD_CHILD;
  });
}
```

**What to write:** append `KODO_LABEL_ADOPTED = 'kodo:adopted'` + `isAdopted(labels)` after the `isGsdChild` block — byte-for-byte the same body, swapping the const reference. Tolerates `string[]` and `{name}[]`, case-insensitive (the dispatcher passes `string[]`; provider adapters pass `{name}[]`).

**CRITICAL SUBTLETY (Pitfall 1) — do NOT touch `parseKodoLabels`:** `parseKodoLabels` (`:12-38`) treats ANY `kodo:*` label as `isKodo:true` (`:26-28`) — including `kodo:adopted`, which it pushes into `flags` (`:31-32`). This means the marker makes `isKodo` TRUE, so the dispatcher's primary "no kodo label" gate (`dispatcher.js:77`) does NOT suppress an adopted task on its own. `getGsdMode` (`:53-58`) only recognizes `gsd`/`gsd-quick`, so an `adopted` flag yields `gsdMode: null` (no GSD launch path) — but full suppression depends on the `isAdopted` early cut. This is WHY the dispatcher cut (below) is load-bearing, not redundant.

---

### `src/triggers/dispatcher.js` — add `isAdopted` cut (middleware, event-driven)

**Analog:** `isGsdChild` anti-recursion cut (`src/triggers/dispatcher.js:63-71`) + import line (`:6`)

**Import line to extend** (`:6`):
```javascript
import { parseKodoLabels, getGsdMode, isGsdChild } from '../labels.js';
```
→ add `isAdopted`: `import { parseKodoLabels, getGsdMode, isGsdChild, isAdopted } from '../labels.js';`

**Exact existing cut to mirror** (`:68-71`):
```javascript
if (isGsdChild(task.labels)) {
  console.log(`[kodo:dispatch] Ignored — kodo:gsd-child filtered (anti-recursion)`);
  return { action: 'ignored', code: 'gsd_child' };
}
```

**New cut to insert — immediately after the `isGsdChild` block (`:71`), BEFORE the `if (!opts.force)` block (`:74`)** (per Code Examples + Pattern 2):
```javascript
if (isAdopted(task.labels)) {
  console.log(`[kodo:dispatch] Ignored — kodo:adopted filtered (anti-recursion)`);
  return { action: 'ignored', code: 'adopted' };
}
```

**ORDERING IS LOAD-BEARING (D-02 / Pitfall 1 / hygiene test):** the cut MUST precede `if (!opts.force)` (`:74`) so `--force` does NOT bypass it (mirrors the `isGsdChild` `--force` survival, dispatcher.js comment `:63-67`). The source-hygiene ordering test (`dispatcher.test.js:1178-1188`) checks `filterIdx < forceIdx` for the literal substring — the new `isAdopted` cut and its test assertion must satisfy the same constraint. `code: 'adopted'` is discretion (CONTEXT.md), parallel to `'gsd_child'`.

---

### `src/interface.js` — REFERENCE ONLY (config, FROZEN) — DO NOT TOUCH

**Reference:** `TASK_PROVIDER_METHODS` (`:52-62`) — `Object.freeze`d at 9 methods.

`createTask` is NEVER added here (Pitfall 5 / Anti-Pattern). It stays an optional typeof-detected method. `registry.js`'s 9-method validation loop iterates this list — leaving it at 9 keeps every provider valid without a `createTask`. The contract test's B1 (`contract.test.js:431-439`) asserts exactly these 9 as functions; planner should add a NEGATIVE assert that `createTask` is NOT in the list.

---

### `test/providers/contract.test.js` — add capability-gated `createTask` it() (test)

**Analog (the it()):** B8 `getTaskState` capability-gated test (`:494-505`)
**Analog (per-provider arg helper):** `getTaskStateArg` (`:375-381`)
**Analog (Plane stub routes):** `instantiateProvider` → `stubPlaneFetch` (`:287-347`, route table `:289-318`)
**Analog (GitHub fake client):** `makeFakeGitHubClient` (`:195-239`)

**Capability-gated it() pattern to mirror** (`:498-505`):
```javascript
it('getTaskState (if supported) returns a normalized state literal', async () => {
  if (typeof provider.getTaskState !== 'function') return; // capability-gated skip
  const state = await provider.getTaskState(getTaskStateArg(providerName));
  assert.ok(
    PROVIDER_STATE_VOCAB.includes(state),
    `[${providerName}] getTaskState must return one of ${PROVIDER_STATE_VOCAB.join('|')}, got: ${state}`,
  );
});
```
→ new it() (lives INSIDE the `for (const providerName of PROVIDERS)` matrix loop, Pitfall #3 at `:393`):
```javascript
it('createTask (if supported) round-trips a 201 to a canonical TaskItem', async () => {
  if (typeof provider.createTask !== 'function') return; // capability-gated skip
  const task = await provider.createTask(getCreateTaskArg(providerName));
  assertTaskItemShape(task, providerName); // reuses the 13-field shape assert (:139-187)
});
```

**Per-provider arg helper to mirror** `getTaskStateArg` (`:375-381`) → write `getCreateTaskArg(name)`: plane → `{ projectId: 'p0p0p0p0-1111-2222-3333-444444444444', title, description }` (matching the existing `/projects/` stub UUID `:294`); github → `{ projectId: 'octocat/hello-world', title, description }`.

**Plane stub route (A3):** the existing `stubPlaneFetch` matches by path SUFFIX, method-agnostic (`:258`), and the `'/work-items/'` route (`:317`) already returns `{ results: [planeWorkItem] }` at `status:200`. A POST to `/work-items/` routes there; the round-trip asserts SHAPE not status, so it works as-is. If status:201 must be asserted, extend `stubPlaneFetch` to inspect method (low risk per A3).

**GitHub fake client:** add a `createIssue` override to `makeFakeGitHubClient` (`:195-239`) returning a raw issue shape like the existing `getIssue` default (`:208-216`: `{ node_id, number, title, body, labels, state, html_url }`).

**FROZEN-9 negative assert:** B1 (`:431`) already asserts the 9 are functions; ADD `assert.ok(!TASK_PROVIDER_METHODS.includes('createTask'))`.

---

### `test/dispatcher.test.js` — add `isAdopted` anti-recursion describe block (test)

**Analog (behavior):** `describe('REPORT-01 — kodo:gsd-child anti-recursion filter')` (`:1040-1151`)
**Analog (source-hygiene/ordering):** `describe('REPORT-01 — dispatcher.js source hygiene')` (`:1153-1189`)

**Structural clone — swap `gsd-child`→`adopted`, `code:'gsd_child'`→`code:'adopted'`.** Key cases to mirror:
- Returns `{action:'ignored', code:'adopted'}` for an adopted-labelled task (mirror `:1092-1097`).
- Cut fires BEFORE acquireGsdLock / resolvePhase / launchWorkItem (mirror `:1099-1108`, asserting `acquireCalled/resolveCalled/launchCalledWith` stay false/null via the `_inspect()` deps harness `:1056-1090`).
- Cut fires even under `opts.force:true` (mirror `:1110-1119`).
- Control: a normal `kodo:gsd` task DOES reach the resolver — no false positive (mirror `:1140-1150`).
- Source-hygiene ordering (mirror `:1178-1188`): assert `source.indexOf('isAdopted(task.labels)') < source.search(/if\s*\(!opts\.force\)/)`.
- Import assert (mirror `:1156-1163`): dispatcher imports `isAdopted` from `../labels.js`.

The `makeDeps` harness (`:1056-1090`) provides a full 8-method fake provider + injectable lock/launch/resolve fns + `_inspect()` — reuse it with `task.labels = ['kodo:adopted']`.

---

### `test/labels-hygiene.test.js` — extend REPORT-05 (test)

**Analog:** `describe('REPORT-05 — labels source hygiene')` (`:41-65`)

**No-inline-literal pattern to mirror** (`:42-58`): walks all `src/**/*.js` except `labels.js` (`listJsFilesExcept` `:27-39`), strips comments (`stripComments` `:18-24`), asserts no `'kodo:gsd-child'`/`"kodo:gsd-child"` literal survives. → add the same assertion for `'kodo:adopted'`.

**Source-export assertion to mirror** (`:60-64`):
```javascript
assert.match(source, /export\s+const\s+KODO_LABEL_GSD_CHILD\s*=\s*['"]kodo:gsd-child['"]/);
assert.match(source, /export\s+function\s+isGsdChild\s*\(/);
```
→ add the parallel asserts: `labels.js` exports `KODO_LABEL_ADOPTED = 'kodo:adopted'` + `function isAdopted(`.

---

### `test/labels.test.js` — add `isAdopted` truth-table (test)

**Analog:** `describe('REPORT-01 — isGsdChild + KODO_LABEL_GSD_CHILD')` (`:171-214`)

Mirror the full truth-table (`:172-213`), swapping `gsd-child`→`adopted`:
- const value is `'kodo:adopted'` (`:172-174`)
- `isAdopted([])` / null / undefined / non-array → false (`:176-185`)
- string form `['kodo:adopted']` → true (`:187-189`)
- object form `[{name:'kodo:adopted'}]` → true (`:191-193`)
- case-insensitive (`:195-198`)
- rejects similar-but-different (`kodo:adopted-x`, missing prefix) (`:205-209`)
- tolerates mixed garbage in array (`:211-214`)

Also extend the import line (`:3`) to pull `isAdopted, KODO_LABEL_ADOPTED`.

---

## Shared Patterns

### Authentication (reuse, no new surface — ASVS V2)
**Source:** `PlaneClient.request()` (`src/providers/plane/client.js:46-54`, `X-API-Key`) · `GitHubClient.request()` (`src/providers/github/client.js:114-122`, `Authorization: token <PAT>`)
**Apply to:** both new client methods (`createWorkItem`, `createIssue`).
Both create methods route through the existing `request()` — auth headers, 10s `AbortSignal.timeout`, rate-limit handling, error mapping are inherited. **Never hand-roll a new fetch** (would break LOG-12 isolation + duplicate auth/timeout/error-mapping).

### Error handling — LOUD on create mutations (D-08 / Pitfall 4)
**Source:** GitHub `request()` canonical-error throw (`github/client.js:168-195` + `mapErrorCode` `:60-70`) · Plane `request()` throw (`plane/client.js:70-72`)
**Apply to:** both `provider.createTask` methods.
Read rails are never-throws; a create mutation the operator just requested must SURFACE failure. `createTask` does NOT wrap the POST in a swallowing try/catch — let the `.code`/`.status` Error propagate so the Phase 53 caller maps it to `{ok:false, code, detail}`.

### Optional-method via typeof-detection (FROZEN-at-9, Pattern 1)
**Source:** `getTaskState` — Plane (`plane/provider.js:235-263`), GitHub (`github/provider.js:167-180`)
**Apply to:** both `provider.createTask` methods + `interface.js` (untouched) + the contract test gate.
Add `createTask` to the provider object literal ONLY; NEVER push into `TASK_PROVIDER_METHODS`; callers and tests gate with `typeof provider.createTask === 'function'`. The `registry.js` 9-method loop must stay intact.

### Anti-recursion early cut (Pattern 2, mirror isGsdChild)
**Source:** `isGsdChild` cut (`dispatcher.js:63-71`) + `KODO_LABEL_GSD_CHILD`/`isGsdChild` (`labels.js:99-123`)
**Apply to:** `labels.js` (new const+helper) + `dispatcher.js` (new cut before `if (!opts.force)`).
The cut is a HARD safety property verified by three existing test families (REPORT-01 behavior, REPORT-01 ordering hygiene, REPORT-05 no-inline). It must be inserted BEFORE the `--force` block and use the helper (never inline `labels.some`).

### Source-hygiene (no-inline-literal for label markers)
**Source:** REPORT-05 (`labels-hygiene.test.js:41-65`) + REPORT-01 ordering (`dispatcher.test.js:1178-1188`)
**Apply to:** every callsite of `kodo:adopted` — only `labels.js` may contain the literal; all consumers use `KODO_LABEL_ADOPTED`/`isAdopted`.

### Normalize 201 → canonical TaskItem (D-06)
**Source:** `normalizeWorkItem` (`plane/normalize.js:65-97`) · `normalizeIssue` (`github/normalize.js:84-108`)
**Apply to:** both `provider.createTask` methods.
REUSE the pure normalizers verbatim so the returned `TaskItem` is shape-identical to a fetched one. **Plane:** pass the FULL 6-field context (Pitfall 2). **GitHub:** pass `{ projectId: 'owner/repo' }`.

---

## No Analog Found

None. All 11 modified files have an exact in-file or sibling precedent. The single MEDIUM-confidence item is NOT a missing analog but a runtime assumption (A1): the live Plane CE `POST .../work-items/` 201 shape — de-risked by the locked D-07 5-min manual POST at phase start, NOT a pattern gap.

## Metadata

**Analog search scope:** `src/providers/plane/`, `src/providers/github/`, `src/labels.js`, `src/triggers/`, `src/interface.js`, `test/providers/`, `test/dispatcher.test.js`, `test/labels-hygiene.test.js`, `test/labels.test.js`
**Files scanned (read line-by-line):** 13 (4 providers/clients, 2 normalizers, labels, dispatcher, interface, 3 test files + grep of labels.test.js)
**Verification:** every RESEARCH.md line-ref re-checked against HEAD 2026-06-16. Drift noted: GitHub `getTaskState` at `:177` (research said `:177-180` ✓), Plane `createComment` at `:175` ✓, `isGsdChild` cut `:68-71` ✓, B8 `:498` ✓, REPORT-01 `:1040` ✓, REPORT-05 `:42` ✓. No material drift.
**Pattern extraction date:** 2026-06-16
