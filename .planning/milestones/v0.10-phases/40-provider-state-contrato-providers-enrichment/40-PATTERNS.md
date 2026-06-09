# Phase 40: Provider State — contrato + providers + enrichment - Pattern Map

**Mapped:** 2026-06-03
**Files analyzed:** 7 (1 modified-doc + 6 code/test)
**Analogs found:** 7 / 7 (all in-repo, exact pattern precedents exist)

> Every "new method" in this phase is **additive + optional**. There is a near-1:1
> precedent for each one already in the codebase (v0.9 `listComments`/`supported`).
> The planner should mirror these excerpts, not invent new shapes.

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/providers/plane/provider.js` | provider adapter | request-response (HTTP→normalize) | `listComments` in same file (`provider.js:187-195`) + `stateCache` (`:36`) | exact |
| `src/providers/plane/client.js` | API client | request-response | `listStates` in same file (`client.js:95-98`) | exact (reuse, likely no change) |
| `src/providers/github/provider.js` | provider adapter | request-response (label→map) | `listPendingTasks` label filter (`provider.js:133-147`) | exact |
| `src/server.js` (`GET /status` handler) | route handler + enrichment | request-response + per-row cache | `listComments` `supported` handler (`:433-443`) + `/status` enrichment (`:364-413`) | exact |
| `src/logger-events.js` | event registry (pure transform) | event-driven | `githubApiCallFailed` / `planeApiCallFailed` (`:234-294`) | exact |
| `test/providers/contract.test.js` | contract test | test | capability-gated pattern — see "No Analog" note | role-match |
| `STATE.md` | doc | n/a | n/a | doc-only |

> **Files NOT touched (FROZEN — D-13):** `src/interface.js`. `TASK_PROVIDER_METHODS`
> stays at 9. `getTaskState` is optional → NOT added to that array. The registry loop
> (`registry.js:102`) throws for any method in that array missing from a provider; adding
> a 10th would break boot for any provider that doesn't implement it.

---

## Pattern Assignments

### `src/providers/plane/provider.js` (provider adapter — add optional `getTaskState`)

**Analog A — the optional-method shape to mirror (`listComments`, lines 187-195):**
```javascript
async listComments(task) {
  const raw = await client.listComments(task.projectId, task.id);
  return raw.map((c) => ({
    id: c.id,
    actor: c.actor_detail?.display_name || c.actor || 'unknown',
    text: (c.comment_html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    created_at: c.created_at,
  }));
}
```
`getTaskState` is added as a sibling key on the same `provider` object literal — NOT
listed in `TASK_PROVIDER_METHODS`. Its existence is detected via `typeof === 'function'`
at the call site (server.js), exactly like `listComments`. Signature: per D-Discretion,
Plane needs `projectId` too — follow `listComments(task)` which takes `{ id, projectId }`.

**Analog B — `stateCache` (UUID→name), lines 33-36:**
```javascript
/** @type {Map<string, string>} state UUID → state name */
const stateCache = new Map();
/** @type {Map<string, Map<string, string>>} projectId → Map<stateName, stateId> */
const stateByName = new Map();
```
`stateCache` maps `UUID → name` ONLY — it loses `group`. For PSTATE-01 the map (D-09)
needs **`group` too**. The init loop (lines 95-103) reads `client.listStates(proj.id)`
which already returns objects carrying `group` + `name`; today only `s.id`/`s.name` are
consumed. The planner can either extend `stateCache` to store `{name, group}` or add a
parallel `stateGroupCache`. Prefer extending — keep one cache, populated in the same loop:
```javascript
// existing init loop, provider.js:94-103
for (const proj of config.projects) {
  const states = await client.listStates(proj.id);
  const byName = new Map();
  for (const s of states) {
    stateCache.set(s.id, s.name);   // ← add s.group here (D-10 needs group for getTaskState)
    byName.set(s.name, s.id);
  }
  stateByName.set(proj.id, byName);
}
```

**Mapping logic (D-08/D-09/D-10) — anti-ReDoS, `String.includes`, NO regex:**
```javascript
// name substring WINS over group (D-08 — "In Review" lives inside group 'started')
const lower = (name || '').toLowerCase();
if (lower.includes('review')) return 'in_review';
if (lower.includes('block')) return 'blocked';
switch (group) {
  case 'completed': case 'cancelled': return 'done';
  case 'started': case 'unstarted':  return 'in_progress';
  case 'backlog':                    return 'unknown';
  default:                           return 'unknown';
}
```

---

### `src/providers/plane/client.js` (API client — reuse `listStates`, likely no change)

**Analog — `listStates`, lines 95-98 (already returns `group` + `name`):**
```javascript
/** @param {string} projectId */
async listStates(projectId) {
  const data = await this.request(`/projects/${projectId}/states/`);
  return data.results || data;
}
```
The Plane states endpoint already returns each state with `group`. **No new client method
is needed** if `getTaskState` reads from the enriched `stateCache` populated at init. If
the planner instead chooses an on-demand single-item fetch, mirror `getWorkItem`
(`client.js:115-119`) which expands `state_detail` — `state_detail.group` carries the group.

---

### `src/providers/github/provider.js` (provider adapter — add optional `getTaskState`)

**Analog — label access already present in `listPendingTasks`, lines 133-147:**
```javascript
async listPendingTasks() {
  const allTasks = [];
  for (const r of config.repos || []) {
    const result = await client.listIssues(r.owner, r.repo, { labels: ['kodo'], state: 'open' });
    for (const issue of result.items || []) {
      if (issue.pull_request) continue;
      allTasks.push(normalizeIssue(issue, { projectId: `${r.owner}/${r.repo}` }));
    }
  }
  return allTasks;
}
```
`TaskItem.labels` is `issue.labels.map(l => l.name)` (normalize.js:13/87). `getTaskState`
needs NO extra API call (D-12) — it reads labels + open/closed state off the issue/TaskItem
already in hand.

**Mapping logic (D-11/D-12) — same `String.includes` anti-ReDoS as Plane, with the
mandatory honesty comment (specifics requirement):**
```javascript
// CONVENTION, not native: GitHub Issues has no "review"/"blocked" state. We derive
// it from label names by convention (D-11/D-12). NO PR review-state lookup (deferred).
async getTaskState(task) {
  const labels = (task.labels || []).map((l) => String(l).toLowerCase());
  if (labels.some((l) => l.includes('review'))) return 'in_review';
  if (labels.some((l) => l.includes('block')))  return 'blocked';
  return task.state === 'closed' ? 'done' : 'in_progress';  // open → in_progress
}
```
Note the divergence-comment convention this file already follows (D-19..D-28 block at top
of `provider.js:1-37`) — add the GitHub mapping convention as a similar inline comment.

---

### `src/server.js` (`GET /status` — the core enrichment + cache pattern)

**Analog A — THE reference pattern (`listComments`/`supported`, lines 433-443):**
```javascript
// D-07 (TUI-15): `supported` es un campo ADITIVO byte-compatible. Distingue
// "este provider no implementa listComments" (supported:false, PERMANENTE)
// de "la tarea no tiene comentarios aún" (supported:true + comments:[], TRANSITORIO).
const supported = typeof provider.listComments === 'function';
const comments = supported
  ? await provider.listComments({ id: session.task_id, projectId: session.project_id })
  : [];
res.end(JSON.stringify({ comments, supported }));
```
This is the exact `typeof === 'function'` capability gate `getTaskState` mirrors. For
Phase 40, the derived shape is flat (D-05/D-06/D-07): instead of emitting a `supported`
bool, the reason field carries the distinction:
- supported + fetch OK → `{ provider_state: 'in_review', provider_state_reason: null }`
- `typeof !== 'function'` → `{ provider_state: null, provider_state_reason: 'unsupported' }`
- call threw          → `{ provider_state: null, provider_state_reason: 'fetch-failed' }`

**Analog B — the enrichment injection point (`/status` handler, lines 379-385):**
```javascript
// Enrich sessions with elapsed_min only. `alive` is the authoritative value
// written by reconcileTick into state.json (única fuente de verdad, D-04);
// it pasa-through vía `...s`, NO se recomputa aquí.
const enriched = sessions.map((s) => ({
  ...s,
  elapsed_min: Math.floor((Date.now() - new Date(s.started_at).getTime()) / 60000),
}));
```
`provider_state` / `provider_state_reason` are added to THIS `.map()` (server.js:382),
spread-additive (`...s`). Because the fetch is async and per-row, the map becomes async:
serial `for` loop or `Promise.allSettled` (D-Discretion — **allSettled, never `all`**, so
one row's failure does not abort the whole `/status` response — fail-open per row).

**Analog C — the existing cache + TTL to reuse (lines 17-19, 367-377):**
```javascript
const PENDING_CACHE_TTL_MS = 30 * 1000;   // ← REUSE this constant (D-02), do not add a 2nd number
let pendingCache = { data: [], ts: 0 };
...
if (Date.now() - pendingCache.ts < PENDING_CACHE_TTL_MS) {
  pending = pendingCache.data;
} else {
  try {
    pending = await provider.listPendingTasks();
    pendingCache = { data: pending, ts: Date.now() };
  } catch (err) {
    console.warn(`[kodo] listPendingTasks failed: ${err.message}`);
    pending = pendingCache.data;   // ← fail-open to stale cache
  }
}
```
**D-01: do NOT reuse `pendingCache`** (it's `{data, ts}` per provider, wrong shape). Add a
NEW module-level `const providerStateCache = new Map();` keyed by `task_id` only (D-04),
storing `{ state, reason, ts }`, sharing `PENDING_CACHE_TTL_MS` for TTL. Add an in-flight
dedup `Map<task_id, Promise>` (D-03) so overlapping polls await the same fetch.

---

### `src/logger-events.js` (add `provider.state.fetch.failed` event)

**Analog — `githubApiCallFailed`, lines 286-294 (and `planeApiCallFailed`, 234-240):**
```javascript
export function githubApiCallFailed(logger, fields) {
  logger.error(EVENTS.GITHUB_API_CALL_FAILED, {
    event: EVENTS.GITHUB_API_CALL_FAILED,
    method: fields.method,
    path: fields.path,
    status: fields.status,
    error: fields.error,
  });
}
```
Two edits, mirroring this molde exactly:
1. Add the key to the `EVENTS` registry (`Object.freeze`, lines 51-75) AND to the `@type`
   JSDoc block above it (lines 26-50) — both are kept in sync:
   ```javascript
   PROVIDER_STATE_FETCH_FAILED: 'provider.state.fetch.failed',
   ```
2. Add a `providerStateFetchFailed(logger, fields)` helper using **explicit field whitelist
   (NO spread `...fields`)** — the established convention (see pollingTick comment, lines
   519-526). Fields: `{ task_id, provider, error }` (D-15 + D-Discretion: follow
   `*.api.call.failed` shape). Use `logger.error` (fail-open is never silent in the log, D-15).
   Invariant LOG-12: **zero new imports** — only `node:os` + `node:path` (lines 23-24).

---

### `test/providers/contract.test.js` (capability-gated assert — PSTATE-03)

**Pattern to add — a capability-gated `it()` INSIDE the existing matrix loop**
(`for (const providerName of PROVIDERS)`, lines 369-466). The structural invariant
(Pitfall #3) requires every `it()` to live inside this loop; the test count is
`PROVIDERS.length × N_asserts` by construction. The new assert must skip-without-breaking
determinism when a provider lacks `getTaskState`:
```javascript
it('getTaskState (if supported) returns a normalized state string', async () => {
  if (typeof provider.getTaskState !== 'function') return; // capability-gated skip
  const state = await provider.getTaskState(/* {id, projectId} per provider */);
  assert.ok(
    state === null || typeof state === 'string',
    `[${providerName}] getTaskState must return string|null`,
  );
});
```
The existing B1 assert (lines 404-412) iterates `TASK_PROVIDER_METHODS` and stays at 9 —
`getTaskState` is NOT added there (D-13/D-14). Note the matrix's mock instantiation
(`instantiateProvider`, lines 287-343): Plane uses a `globalThis.fetch` route-table stub,
GitHub uses `opts.client` injection — the new `getTaskState` mock data flows through those
same fixtures (`/states/` route already returns state objects; github fixture has labels).

---

## Shared Patterns

### Capability gate (optional provider method)
**Source:** `src/server.js:438` (`typeof provider.listComments === 'function'`) + `src/providers/registry.js:102`
**Apply to:** Both new `getTaskState` adapters, the `/status` enrichment, and the contract test.
```javascript
const supported = typeof provider.getTaskState === 'function';
```
The registry loop validates ONLY `TASK_PROVIDER_METHODS` (frozen at 9) — an optional method
absent from that array does not break boot. This is the entire reason `getTaskState` is opt-in.

### Fail-open + observable failure
**Source:** `src/server.js:373-376` (stale-cache fallback) + `src/logger-events.js:286` (error event)
**Apply to:** `/status` enrichment per-row.
Per row: `Promise.allSettled` → on reject, set `provider_state: null,
provider_state_reason: 'fetch-failed'` AND emit `provider.state.fetch.failed` (D-15). Never
let a provider error 500 the `/status` response.

### Additive JSON response (byte-compatible)
**Source:** `src/server.js:443` (`{ comments, supported }`) — v0.9 invariant.
**Apply to:** `/status` row shape. Old clients ignore `provider_state` /
`provider_state_reason` (D-07). NEVER written back to `state.json` (read-only carril, D-04
v0.9: `reconcileTick` is the sole writer of `alive`).

### Anti-ReDoS string mapping
**Source:** D-10/D-11 (new) — established repo norm.
**Apply to:** Both Plane and GitHub mappers — `String.includes` case-insensitive, NEVER
regex over provider-controlled input (state names / label names).

### Explicit-whitelist event helper (no spread)
**Source:** `src/logger-events.js:535-543` (pollingTickSummary) + comment lines 519-526.
**Apply to:** `providerStateFetchFailed` — list fields explicitly, never `...fields`.

---

## No Analog Found

None. Every code path has an exact in-repo precedent. The contract-test assertion is the
only "role-match (not exact)" item: the `listComments` capability is exercised at the
`/status` handler level (server.js), not yet inside `contract.test.js` itself — so the
capability-gated `it()` is a NEW assert in the matrix, but its skip-pattern
(`if (typeof ... !== 'function') return`) mirrors the server-side gate 1:1. The planner
should follow that skip-pattern to preserve `PROVIDERS × N_asserts` determinism.

## Metadata

**Analog search scope:** `src/server.js`, `src/interface.js`, `src/providers/{registry,plane,github}`, `src/logger-events.js`, `src/config.js`, `test/providers/contract.test.js`, per-provider test headers.
**Files scanned:** 9
**Pattern extraction date:** 2026-06-03
