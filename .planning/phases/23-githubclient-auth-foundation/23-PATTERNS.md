# Phase 23: GitHubClient + Auth Foundation — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 6 (3 NEW source/test/fixtures groups + 2 modified + 1 optional script)
**Analogs found:** 4 / 6 (2 files are net-new infrastructure — fixtures dir + scripts dir)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/providers/github/client.js` (NEW) | HTTP client (transport) | request-response (sync) | `src/providers/plane/client.js` | exact role + flow |
| `test/providers/github/client.test.js` (NEW) | unit test (HTTP behavior) | request-response (mocked) | `test/plane-provider.test.js` + `test/normalize.test.js` | role-match (suite layout + fixture loading) |
| `test/fixtures/github/*.json` (NEW, 9 files) | test fixture data | static JSON | `test/fixtures/plane-workitem.json` (shape pattern only) | role-match (no GitHub fixtures exist yet) |
| `src/logger-events.js` (MODIFIED) | event taxonomy helper | event-driven (emit) | `planeApiCall` (l.192-200) + `orchestratorReview` (l.143-152, info/warn switch) | exact (same module) |
| `test/logger-events.test.js` (MODIFIED) | unit test (taxonomy contract) | event-driven (assertion) | `planeApiCall` test (l.200-215) + `planeApiCallFailed` test (l.217-226) + EVENTS array (l.50-68) | exact (same module) |
| `scripts/capture-github-fixtures.js` (NEW, OPTIONAL) | CLI utility script | request-response (one-shot capture) | **NO ANALOG** — `scripts/` dir does not exist | none |

---

## Pattern Assignments

### `src/providers/github/client.js` (HTTP client, request-response)

**Analog:** `src/providers/plane/client.js` (212 LOC, full template — target ~150 LOC for GitHubClient).

#### Header pattern (lines 1-2)

```js
// @ts-check
import { loadConfig, getPlaneApiKey } from '../../config.js';
```

**Adapt for GitHubClient:**
```js
// @ts-check
import { loadConfig, getProviderApiKey } from '../../config.js';
```

Per D-07 + D-10: use `getProviderApiKey('github')` (already exported from `src/config.js:160`); NEVER add a `getGithubApiKey()` wrapper.

#### Constructor pattern (lines 4-16)

```js
export class PlaneClient {
  /** @param {{ baseUrl?: string, apiKey?: string, workspaceSlug?: string, logger?: import('../../logger.js').Logger }} [opts] */
  constructor(opts = {}) {
    const config = loadConfig();
    this.baseUrl = (opts.baseUrl || config.plane.base_url).replace(/\/$/, '');
    this.apiKey = opts.apiKey || getPlaneApiKey();
    this.workspaceSlug = opts.workspaceSlug || config.plane.workspace_slug;
    this.logger = opts.logger; // undefined if not provided — emission uses optional chain

    if (!this.apiKey) {
      throw new Error(`Plane API key not found. Set ${config.plane.api_key_env} env var.`);
    }
  }
}
```

**REQUIRED DIVERGENCES (Phase 23):**

1. **D-06: Add `opts.fetch` injection (improvement over PlaneClient).** The `fetch` is stored on `this` so `request()` reads from `this.fetch ?? globalThis.fetch`. This destraba testing without global mocking (see test patterns below).

2. **D-30: `baseUrl` default hardcoded to `'https://api.github.com'`** (no `config.providers.github.base_url` dependency in Phase 23 — D-30 leaves that as a future hook). Allow override via `opts.baseUrl` for fake-server testing.

3. **No `workspaceSlug`** — GitHub uses `<owner>/<repo>` positional args per method (D-23), not a constructor-level scope.

4. **D-09: Token error message** — `'GitHub token not found. Set GITHUB_TOKEN env var.'` (literal env var name from `config.providers.github.api_key_env` — but Phase 23 tests inject `opts.token`, see D-32).

**Adapted constructor (sketch):**
```js
export class GitHubClient {
  /** @param {{ baseUrl?: string, token?: string, fetch?: typeof globalThis.fetch, logger?: import('../../logger.js').Logger }} [opts] */
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl || 'https://api.github.com').replace(/\/$/, '');
    this.token = opts.token || getProviderApiKey('github');
    this.fetch = opts.fetch || globalThis.fetch;
    this.logger = opts.logger;

    if (!this.token) {
      throw new Error('GitHub token not found. Set GITHUB_TOKEN env var.');
    }
  }
}
```

#### Private `request` pattern (lines 18-92) — CORE TEMPLATE

The Plane `request` is ~75 LOC. The GitHubClient `request` will be ~60-70 LOC after **removing** the retry/throttle blocks per D-11 and D-29, and **adding** the 304-aware envelope branch per D-19.

**Copy (with adaptation):**

```js
async request(path, opts = {}) {
  const url = new URL(`${this.baseUrl}${path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, v);
    }
  }

  const started = Date.now();
  const res = await this.fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'Authorization': `token ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kodo/0.7.x',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.etag ? { 'If-None-Match': opts.etag } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });

  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  if (remaining !== null) this._rateRemaining = parseInt(remaining, 10);
  if (reset !== null) this._rateReset = parseInt(reset, 10);

  // ... 304 branch (envelope) ...
  // ... emit githubApiCall (info/warn) ...
  // ... !res.ok → emit githubApiCallFailed + throw canonical Error ...
}
```

**Rate-limit header parsing pattern (PlaneClient lines 56-59) — COPY VERBATIM:**

```js
const remaining = res.headers.get('x-ratelimit-remaining');
const reset = res.headers.get('x-ratelimit-reset');
if (remaining !== null) this._rateRemaining = parseInt(remaining, 10);
if (reset !== null) this._rateReset = parseInt(reset, 10);
```

This handles the `headers.get()` returns `string | null` semantics (Pitfall #8 from RESEARCH.md).

**Error-throw pattern (PlaneClient lines 70-73) — ADAPT with `.code`/`.status`/`.retryAfter`:**

PlaneClient:
```js
if (!res.ok) {
  const text = await res.text().catch(() => '');
  throw new Error(`Plane API ${res.status}: ${path} — ${text}`);
}
```

GitHubClient (per D-12, D-13, D-14 + Error Mapping Table in RESEARCH.md §Error Mapping Table):
```js
if (!res.ok) {
  const text = await res.text().catch(() => '');
  const snippet = text.slice(0, 200);
  const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
  const code = mapErrorCode(res.status, res.headers, retryAfter);
  // emit failure NDJSON BEFORE throwing
  if (this.logger) {
    const { githubApiCallFailed } = await import('../../logger-events.js');
    githubApiCallFailed(this.logger, {
      method: opts.method || 'GET', path, status: res.status, error: snippet,
    });
  }
  const err = new Error(`GitHub API ${res.status}: ${path} — ${snippet}`);
  err.code = code;
  err.status = res.status;
  if (retryAfter !== undefined) err.retryAfter = retryAfter;
  throw err;
}
```

**NDJSON emission pattern (PlaneClient lines 75-88) — ADAPT to githubApiCall with level switch (D-16):**

PlaneClient (success branch):
```js
if (this.logger) {
  try {
    const { planeApiCall } = await import('../../logger-events.js');
    planeApiCall(this.logger, {
      method: opts.method || 'GET',
      path,
      status: res.status,
      duration_ms: Date.now() - started,
    });
  } catch {
    // silent — never interfere with the actual API response flow
  }
}
return res.json();
```

GitHubClient (success branch, with `rate_limit_remaining` field):
```js
if (this.logger) {
  try {
    const { githubApiCall } = await import('../../logger-events.js');
    githubApiCall(this.logger, {
      method: opts.method || 'GET',
      path,
      status: res.status,
      duration_ms: Date.now() - started,
      rate_limit_remaining: this._rateRemaining,
    });
  } catch { /* silent */ }
}
```

#### CRITICAL DIVERGENCES — DO NOT PORT FROM PLANECLIENT

**D-11 (no retry):** PlaneClient lines **31-67** implement `maxRetries`, exponential backoff, and `console.warn` on 429. **MUST NOT PORT.** The GitHubClient does a single `fetch` and surfaces 429 as a canonical `Error` immediately. Phase 25 (POLL-04) is the retry layer.

```js
// LINES TO **NOT** PORT (PlaneClient 31-67):
const maxRetries = opts.maxRetries ?? 3;
let attempt = 0;
if (this._rateRemaining !== undefined && this._rateRemaining < 5 && this._rateReset) {
  // ... proactive throttle ...
}
while (true) {
  // ... fetch ...
  if (res.status === 429 && attempt < maxRetries) {
    // ... backoff + continue ...
  }
  // ...
}
```

**D-29 (no proactive throttle):** PlaneClient lines **34-42** (proactive sleep when `_rateRemaining < 5`). **MUST NOT PORT.** GitHubClient surfaces — does not decide policy.

**`console.warn` from PlaneClient lines 39, 64:** **MUST NOT PORT.** GitHubClient is NDJSON-only (Pitfall #7 from RESEARCH.md). All observability via `this.logger?.…` optional-chain.

#### D-19 envelope branch (NET-NEW pattern — no analog in PlaneClient)

After parsing rate-limit headers, BEFORE the `!res.ok` check, insert:

```js
// 304 path is exclusive to listIssues callers (D-21). The branch is in
// `request()` because `request()` already has the parsed headers; the public
// `listIssues` reads the envelope keys and re-shapes if needed.
if (res.status === 304) {
  // No body. DO NOT call res.json() — would throw (Pitfall in RESEARCH.md).
  return {
    status: 304,
    items: [],
    etag: res.headers.get('etag') ?? opts.etag,
    rate_limit_remaining: this._rateRemaining,
  };
}
```

**Note:** The envelope shape is documented in RESEARCH.md §Conditional Fetch Deep-Dive. `listIssues()` wraps a 200 response as `{status:200, items, etag, rate_limit_remaining}` while the other 4 public methods return `res.json()` raw.

#### Public method pattern (PlaneClient lines 94-180)

PlaneClient `listStates` (line 95-98) is the minimal pattern:
```js
async listStates(projectId) {
  const data = await this.request(`/projects/${projectId}/states/`);
  return data.results || data;
}
```

PlaneClient `createComment` (line 175-180) is the POST pattern:
```js
async createComment(projectId, workItemId, commentHtml) {
  return this.request(`/projects/${projectId}/work-items/${workItemId}/comments/`, {
    method: 'POST',
    body: { comment_html: commentHtml },
  });
}
```

PlaneClient `updateWorkItem` (line 138-143) is the PATCH pattern:
```js
async updateWorkItem(projectId, workItemId, updates) {
  return this.request(`/projects/${projectId}/work-items/${workItemId}/`, {
    method: 'PATCH',
    body: updates,
  });
}
```

**GitHubClient methods (D-22, with positional `owner`/`repo` per D-23):**

| Public method | Pattern source (PlaneClient) | GitHub-specific notes |
|---------------|----------------------------|---------------------|
| `getIssue(owner, repo, number)` | `listStates` (GET single resource) | Path: `/repos/${owner}/${repo}/issues/${number}` — use `encodeURIComponent(owner)` + `encodeURIComponent(repo)` per Security V5 (SSRF mitigation). |
| `listIssues(owner, repo, opts)` | NET-NEW envelope path | Wraps raw `request()` result: `{ status: 200, items: data, etag: res.headers.get('etag'), rate_limit_remaining: this._rateRemaining }`. Accepts `opts.etag`, `opts.state`, `opts.labels`, `opts.since`, `opts.per_page`. |
| `addComment(owner, repo, number, body)` | `createComment` (POST) | Body shape: `{ body: <markdown> }` (NOT `comment_html`). |
| `updateIssue(owner, repo, number, updates)` | `updateWorkItem` (PATCH) | Path: `/repos/${owner}/${repo}/issues/${number}`. |
| `listLabels(owner, repo)` | `listStates` (GET array) | Path: `/repos/${owner}/${repo}/labels?per_page=100`. |

**JSDoc pattern (mirror PlaneClient line 100-104):**
```js
/**
 * @param {string} owner
 * @param {string} repo
 * @param {{ labels?: string[], state?: 'open'|'closed'|'all', since?: string, etag?: string, per_page?: number }} [opts]
 * @returns {Promise<{ status: 200 | 304, items: any[], etag: string | undefined, rate_limit_remaining: number | undefined }>}
 */
async listIssues(owner, repo, opts = {}) { ... }
```

#### Helper functions (NET-NEW — no analog)

These two helpers live inside `client.js` (D-02: single file; no `errors.js` split):

```js
/**
 * Parse GitHub `Retry-After` header — RFC 7231 allows integer (seconds) OR
 * HTTP-date (Pitfall #4 in RESEARCH.md).
 * @param {string|null} header
 * @returns {number|undefined}
 */
function parseRetryAfter(header) {
  if (!header) return undefined;
  const asInt = parseInt(header, 10);
  if (!isNaN(asInt) && String(asInt) === header.trim()) return asInt;
  const asDate = Date.parse(header);
  if (!isNaN(asDate)) return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
  return undefined;
}

/**
 * Map HTTP status → canonical `.code` (D-12 + Error Mapping Table).
 * @param {number} status
 * @param {Headers} headers
 * @param {number|undefined} retryAfter
 * @returns {'unauthorized'|'forbidden'|'not_found'|'rate_limit_exceeded'|'github_api_error'}
 */
function mapErrorCode(status, headers, retryAfter) {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit_exceeded';
  if (status === 403) {
    const remaining = headers.get('x-ratelimit-remaining');
    if (remaining === '0' || retryAfter !== undefined) return 'rate_limit_exceeded';
    return 'forbidden';
  }
  return 'github_api_error';
}
```

---

### `test/providers/github/client.test.js` (unit test, request-response mocked)

**Analog:** `test/plane-provider.test.js` (suite layout) + `test/normalize.test.js` (fixture loading via import-assertion).

#### Test file header pattern (`test/plane-provider.test.js` lines 1-7)

```js
// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { TASK_PROVIDER_METHODS } from '../src/interface.js';
```

**Adapt:**
```js
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient } from '../../src/providers/github/client.js';
import issueFixture from '../fixtures/github/issue.json' with { type: 'json' };
import issuesListFixture from '../fixtures/github/issues-list.json' with { type: 'json' };
// ... 7 more fixture imports ...
```

Use the `import … with { type: 'json' }` ESM assertion style from `test/normalize.test.js:12-14` — already validated in the codebase.

#### Fake fetch helper (NET-NEW pattern — DO NOT copy `test/plane-provider.test.js` lines 62-77)

`test/plane-provider.test.js` lines **62-77** uses `globalThis.fetch = …` mutation:

```js
function stubFetch(routes) {
  const calls = {};
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => { /* ... */ };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
```

**DO NOT REPLICATE.** Per D-06 + RESEARCH.md §Testing Strategy, use constructor injection instead:

```js
/**
 * @param {{ status: number, body?: any, headers?: Record<string,string> }} scenario
 * @returns {typeof fetch}
 */
function makeFetch(scenario) {
  return async (_url, _init) => ({
    status: scenario.status,
    ok: scenario.status >= 200 && scenario.status < 300,
    headers: {
      get(name) { return scenario.headers?.[name.toLowerCase()] ?? null; },
    },
    async json() {
      if (scenario.status === 304) throw new Error('No body for 304');
      return scenario.body;
    },
    async text() {
      return scenario.body ? JSON.stringify(scenario.body) : '';
    },
  });
}
```

This fake can live inline in the test file or under `test/providers/github/__helpers/fake-fetch.js` per VALIDATION.md Wave 0.

#### Spy-for-init pattern (when assertions need init/headers/body)

For tests that assert what the client sent (test cases #4, #5, #12 in RESEARCH.md test plan):

```js
function makeSpyFetch(scenario) {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: url.toString(), init });
    return makeFetch(scenario)(url, init);
  };
  return { fakeFetch, calls };
}
```

#### Logger spy pattern (NET-NEW — RESEARCH.md §Testing Strategy)

For tests that assert NDJSON level switching (test case #11):

```js
function makeSpyLogger() {
  const records = [];
  return {
    records,
    info: (event, fields) => records.push({ level: 'info', event, ...fields }),
    warn: (event, fields) => records.push({ level: 'warn', event, ...fields }),
    error: (event, fields) => records.push({ level: 'error', event, ...fields }),
  };
}
```

This is a minimal stub — NOT the real `createLogger` from `src/logger.js` (we don't want NDJSON file I/O in this test suite; that's covered by `test/logger-events.test.js`).

#### Suite structure (mirror `describe`/`it` style from PlaneProvider test l.19-29)

```js
describe('GitHubClient', () => {
  describe('constructor', () => {
    it('throws when token unset', () => {
      assert.throws(
        () => new GitHubClient({ fetch: makeFetch({status:200,body:{}}), /* no token */ }),
        /GitHub token not found/,
      );
    });
  });

  describe('getIssue', () => {
    it('returns raw payload + parses rate-limit headers', async () => {
      const client = new GitHubClient({
        token: 'ghp_test',
        fetch: makeFetch({ status: 200, body: issueFixture, headers: { 'x-ratelimit-remaining': '4998' } }),
      });
      const issue = await client.getIssue('octocat', 'hello-world', 42);
      assert.equal(issue.number, 42);
      assert.equal(client._rateRemaining, 4998);
    });
  });

  // ... listIssues, addComment, updateIssue, listLabels, error mapping, etag ...
});
```

#### Coverage matrix

Test 12 cases per RESEARCH.md §Testing Strategy table (minimum 8 per SC#4). VALIDATION.md tasks 23-02-01 through 23-02-12 enumerate them.

---

### `test/fixtures/github/*.json` (9 NEW fixture files)

**Analog:** `test/fixtures/plane-workitem.json` (shape pattern only — structure shows JSON data captured from real API response).

**No structural analog in repo for GitHub fixtures.** Flag as Wave 0 net-new infrastructure.

#### Fixture format (NET-NEW pattern — documented in RESEARCH.md §Testing Strategy)

Each fixture is a JSON file with the **response body** that the fake fetch will return. Rate-limit headers and ETag values are injected by the test scenario object, NOT stored in the fixture (because headers vary per test, while body is stable).

**Naming convention** (D-33):
- `issue.json` — `GET /repos/.../issues/42` happy path
- `issues-list.json` — `GET /repos/.../issues` (array of 2: 1 issue + 1 PR with `pull_request` ≠ null)
- `issue-comment.json` — `POST .../comments` 201 response
- `labels-list.json` — `GET .../labels`
- `rate-limit-low.json` — issue payload (test injects `X-RateLimit-Remaining: 99` header at scenario level)
- `rate-limit-exceeded.json` — `{ "message": "API rate limit exceeded ..." }`
- `not-modified-304.json` — `{}` placeholder (304 has no body; fixture exists for scenario shape symmetry)
- `unauthorized-401.json` — `{ "message": "Bad credentials", "documentation_url": "..." }`
- `not-found-404.json` — `{ "message": "Not Found", "documentation_url": "..." }`

**Redaction rule** (D-34, mirror `plane-workitem.json` IDs `a1b2c3d4-…`): owner = `kodo-test`, repo = `fixture-repo`, IDs = small ints, no real PATs or user info.

**Example shape** (`test/fixtures/github/issue.json`):
```json
{
  "id": 1,
  "node_id": "I_kwTEST001",
  "number": 42,
  "title": "Test issue",
  "body": "Issue body markdown",
  "labels": [{ "id": 1, "node_id": "LA_TEST001", "name": "kodo", "color": "0e8a16", "default": false, "description": null }],
  "state": "open",
  "state_reason": null,
  "html_url": "https://github.com/kodo-test/fixture-repo/issues/42",
  "pull_request": null,
  "assignees": [],
  "user": { "login": "kodo-test", "id": 1 },
  "created_at": "2026-05-14T07:00:00Z",
  "updated_at": "2026-05-14T08:00:00Z",
  "locked": false,
  "comments": 0
}
```

---

### `src/logger-events.js` (MODIFIED — extend EVENTS + add 2 helpers)

**Analog (same module):** `planeApiCall` (l.188-200) for `githubApiCall` body + `orchestratorReview` (l.139-152) for the info/warn level switch.

#### Extending `EVENTS` frozen object (lines 38-52)

Current shape (line 38-52):
```js
export const EVENTS = Object.freeze({
  SESSION_START:           'session.start',
  SESSION_END:             'session.end',
  STATE_TRANSITION:        'state.transition',
  ORCHESTRATOR_REVIEW:     'orchestrator.review',
  GSD_PHASE_RESOLVED:      'gsd.phase.resolved',
  GSD_BOOTSTRAP:           'gsd.bootstrap',
  PLANE_API_CALL:          'plane.api.call',
  PLANE_API_CALL_FAILED:   'plane.api.call.failed',
  WORKTREE_CLEANUP_OK:     'worktree.cleanup.ok',
  WORKTREE_CLEANUP_DIRTY:  'worktree.cleanup.dirty',
  WORKTREE_CLEANUP_ERROR:  'worktree.cleanup.error',
  SKILL_SYNC_AUTO:         'skill.sync.auto',
  SKILL_SYNC_AUTO_ERROR:   'skill.sync.auto.error',
});
```

**Pattern to apply (add 2 keys preserving the chronological-grouping order — append at end, parallel to PLANE_API_CALL siblings):**

```js
export const EVENTS = Object.freeze({
  // ... 13 existing, unchanged ...
  GITHUB_API_CALL:         'github.api.call',
  GITHUB_API_CALL_FAILED:  'github.api.call.failed',
});
```

**ALSO update the JSDoc `@type` block (lines 23-37):** add the 2 new entries to the object type literal — same key/value pairs.

**ALSO update the comment header (lines 1-18):** add `github.api.call, github.api.call.failed` to the event list on line 8-10, and add a `// + Phase 23 (github client)` parenthetical to the Contrato fijo comment.

#### Adding `githubApiCall` helper

**Primary pattern source:** `planeApiCall` (lines 188-200):

```js
/**
 * @param {Logger} logger
 * @param {{ method: string, path: string, status: number, duration_ms: number }} fields
 */
export function planeApiCall(logger, fields) {
  logger.info(EVENTS.PLANE_API_CALL, {
    event: EVENTS.PLANE_API_CALL,
    method: fields.method,
    path: fields.path,
    status: fields.status,
    duration_ms: fields.duration_ms,
  });
}
```

**Switch pattern source:** `orchestratorReview` (line 145):
```js
const level = fields.verdict === 'approved' ? 'info' : 'warn';
logger[level](EVENTS.ORCHESTRATOR_REVIEW, { /* fields */ });
```

**Adapted `githubApiCall` (combines both patterns per D-16):**

```js
/**
 * Emitido cuando una llamada a GitHub API completa exitosamente. El nivel del
 * record cambia a `warn` cuando `rate_limit_remaining < 100` (Phase 23 D-16,
 * pattern mirror `orchestratorReview` con level switch por field).
 *
 * @param {Logger} logger
 * @param {{ method: string, path: string, status: number, duration_ms: number, rate_limit_remaining: number|undefined }} fields
 */
export function githubApiCall(logger, fields) {
  const level = (typeof fields.rate_limit_remaining === 'number' && fields.rate_limit_remaining < 100)
    ? 'warn'
    : 'info';
  logger[level](EVENTS.GITHUB_API_CALL, {
    event: EVENTS.GITHUB_API_CALL,
    method: fields.method,
    path: fields.path,
    status: fields.status,
    duration_ms: fields.duration_ms,
    rate_limit_remaining: fields.rate_limit_remaining,
  });
}
```

#### Adding `githubApiCallFailed` helper

**Primary pattern source:** `planeApiCallFailed` (lines 202-217):

```js
/**
 * Emitido cuando una llamada a Plane falla en un paso específico del gate
 * (getTask, addComment, updateTaskState). ...
 *
 * @param {Logger} logger
 * @param {{ step: string, error: string }} fields
 */
export function planeApiCallFailed(logger, fields) {
  logger.error(EVENTS.PLANE_API_CALL_FAILED, {
    event: EVENTS.PLANE_API_CALL_FAILED,
    step: fields.step,
    error: fields.error,
  });
}
```

**DIVERGENCE:** Replace `step` with `{method, path, status}` triplet (per RESEARCH.md §NDJSON Event Additions table). GitHub failures are HTTP-level, not gate-step-level.

**Adapted:**
```js
/**
 * Emitido cuando una llamada a GitHub API falla (HTTP !res.ok). Complementa
 * `github.api.call` — siempre uno o el otro emite por request.
 *
 * @param {Logger} logger
 * @param {{ method: string, path: string, status: number, error: string }} fields
 */
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

**LOG-12 invariant preservation:** Both helpers only manipulate `fields` and delegate to `logger[level](...)` — no new imports. `logger-events.js` continues to only import `node:os` and `node:path` (lines 20-21 unchanged). The `check-isolation.test.js` contract remains green.

---

### `test/logger-events.test.js` (MODIFIED — extend EVENTS assertion + add 2 helper tests)

**Analog (same module):** `planeApiCall` test (l.200-215) + `planeApiCallFailed` test (l.217-226) + EVENTS array assertion (l.50-68).

#### Extending the EVENTS-types assertion (lines 50-68)

Current shape (line 50-68):
```js
it('EVENTS is frozen and contains the 13 canonical types', () => {
  assert.equal(Object.isFrozen(EVENTS), true);
  const types = Object.values(EVENTS).sort();
  assert.deepEqual(types, [
    'gsd.bootstrap',
    'gsd.phase.resolved',
    'orchestrator.review',
    'plane.api.call',
    'plane.api.call.failed',
    'session.end',
    'session.start',
    'skill.sync.auto',
    'skill.sync.auto.error',
    'state.transition',
    'worktree.cleanup.dirty',
    'worktree.cleanup.error',
    'worktree.cleanup.ok',
  ]);
});
```

**MUST update to 15 entries (alphabetical order):**

```js
it('EVENTS is frozen and contains the 15 canonical types', () => {
  assert.equal(Object.isFrozen(EVENTS), true);
  const types = Object.values(EVENTS).sort();
  assert.deepEqual(types, [
    'github.api.call',           // NEW
    'github.api.call.failed',    // NEW
    'gsd.bootstrap',
    'gsd.phase.resolved',
    'orchestrator.review',
    'plane.api.call',
    'plane.api.call.failed',
    'session.end',
    'session.start',
    'skill.sync.auto',
    'skill.sync.auto.error',
    'state.transition',
    'worktree.cleanup.dirty',
    'worktree.cleanup.error',
    'worktree.cleanup.ok',
  ]);
});
```

**ALSO update the import block (lines 28-43)** to add `githubApiCall, githubApiCallFailed`.

**ALSO update the `describe(...)` label on line 49** to include `+ Phase 23 (github client)`.

#### Adding `githubApiCall` test cases (mirror `planeApiCall` test pattern, lines 200-215)

**Pattern source (planeApiCall test):**
```js
it('planeApiCall emits event=plane.api.call + method/path/status/duration_ms', () => {
  const sessionId = 'sess-ev-pac';
  const log = createLogger({ sessionId, minLevel: 'info' });
  planeApiCall(log, {
    method: 'GET',
    path: '/work-items/KL-42/',
    status: 200,
    duration_ms: 142,
  });
  const line = readAllLines(logPathFor(sessionId)).pop();
  assert.equal(line.event, EVENTS.PLANE_API_CALL);
  assert.equal(line.method, 'GET');
  assert.equal(line.path, '/work-items/KL-42/');
  assert.equal(line.status, 200);
  assert.equal(line.duration_ms, 142);
});
```

**Adapt — TWO tests needed (info path + warn path per D-16 level switch):**

```js
it('githubApiCall emits at info level when rate_limit_remaining >= 100', () => {
  const sessionId = 'sess-ev-ghac-info';
  const log = createLogger({ sessionId, minLevel: 'info' });
  githubApiCall(log, {
    method: 'GET',
    path: '/repos/octocat/hello-world/issues/42',
    status: 200,
    duration_ms: 123,
    rate_limit_remaining: 4998,
  });
  const line = readAllLines(logPathFor(sessionId)).pop();
  assert.equal(line.event, EVENTS.GITHUB_API_CALL);
  assert.equal(line.level, 'info');
  assert.equal(line.rate_limit_remaining, 4998);
});

it('githubApiCall emits at warn level when rate_limit_remaining < 100', () => {
  const sessionId = 'sess-ev-ghac-warn';
  const log = createLogger({ sessionId, minLevel: 'info' });
  githubApiCall(log, {
    method: 'GET',
    path: '/repos/octocat/hello-world/issues',
    status: 200,
    duration_ms: 80,
    rate_limit_remaining: 50,
  });
  const line = readAllLines(logPathFor(sessionId)).pop();
  assert.equal(line.event, EVENTS.GITHUB_API_CALL);
  assert.equal(line.level, 'warn');
  assert.equal(line.rate_limit_remaining, 50);
});
```

#### Adding `githubApiCallFailed` test case (mirror `planeApiCallFailed` test, lines 217-226)

**Pattern source:**
```js
it('planeApiCallFailed emits event=plane.api.call.failed + step/error at error level', () => {
  const sessionId = 'sess-ev-pacf';
  const log = createLogger({ sessionId, minLevel: 'info' });
  planeApiCallFailed(log, { step: 'getTask', error: 'ECONNREFUSED' });
  const line = readAllLines(logPathFor(sessionId)).pop();
  assert.equal(line.event, EVENTS.PLANE_API_CALL_FAILED);
  assert.equal(line.level, 'error');
  assert.equal(line.step, 'getTask');
  assert.equal(line.error, 'ECONNREFUSED');
});
```

**Adapt with method/path/status fields:**
```js
it('githubApiCallFailed emits event=github.api.call.failed + method/path/status/error at error level', () => {
  const sessionId = 'sess-ev-ghacf';
  const log = createLogger({ sessionId, minLevel: 'info' });
  githubApiCallFailed(log, {
    method: 'GET',
    path: '/repos/octocat/hello-world/issues/42',
    status: 404,
    error: 'Not Found',
  });
  const line = readAllLines(logPathFor(sessionId)).pop();
  assert.equal(line.event, EVENTS.GITHUB_API_CALL_FAILED);
  assert.equal(line.level, 'error');
  assert.equal(line.method, 'GET');
  assert.equal(line.path, '/repos/octocat/hello-world/issues/42');
  assert.equal(line.status, 404);
  assert.equal(line.error, 'Not Found');
});
```

---

### `scripts/capture-github-fixtures.js` (NEW, OPTIONAL — Plan 23-03)

**Analog:** **NONE.** The `scripts/` directory does not exist in the repo.

**Decision per RESEARCH.md §Plan-shaping:** If skipped, fixtures are constructed manually from the response shapes documented in RESEARCH.md §GitHub REST API Reference and §Testing Strategy. The script is convenience-only and not on the SC critical path.

**If implemented:** Follow the minimal Node CLI pattern (no analog in repo, propose):
```js
// @ts-check
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.argv[2]; // "owner/repo"
if (!TOKEN || !REPO) {
  console.error('Usage: GITHUB_TOKEN=ghp_… node scripts/capture-github-fixtures.js <owner>/<repo>');
  process.exit(1);
}
// ... 5 fetch calls, redact IDs, write to test/fixtures/github/*.json ...
```

This file is **outside** the SC critical path. Plan 23-03 can be deferred if budget is tight.

---

## Shared Patterns

### `// @ts-check` header
**Source:** Every JS file in the repo (e.g., `src/providers/plane/client.js:1`, `src/logger-events.js:1`, `test/plane-provider.test.js:1`).
**Apply to:** ALL new files in Phase 23. Required by CONVENTIONS.md §Linting.

### JSDoc on public methods/exports
**Source:** `src/providers/plane/client.js` lines 18-22 (`@param`/`@returns`), `src/logger-events.js` lines 86-92 (`@param` with object typedef).
**Apply to:** All public methods of `GitHubClient` + both new helpers in `logger-events.js`.

### Error template format
**Source:** `src/providers/plane/client.js:72` — `throw new Error(\`Plane API ${res.status}: ${path} — ${text}\`)`.
**Apply to:** GitHubClient `request()` — `throw new Error(\`GitHub API ${status}: ${path} — ${snippet}\`)` per D-14. **Add** `.code`/`.status`/`.retryAfter` properties (per D-12) — this is the only structural divergence.

### Optional-chain logger emission
**Source:** `src/providers/plane/client.js` lines 76-88 — `if (this.logger) { ... }` wrapping the dynamic import + helper call. The dynamic `await import('../../logger-events.js')` is the established pattern to avoid coupling the client's import graph to logger-events at load time.
**Apply to:** GitHubClient `request()` success and failure branches. Wrap each in `try { … } catch { /* silent */ }` per the lesson on line 85-87 (never interfere with the API response flow).

### Test framework: `node:test` + `node:assert/strict`
**Source:** Every test file in the repo. TESTING.md §Framework.
**Apply to:** New `test/providers/github/client.test.js`. Use `describe`/`it`/`beforeEach` (no mocking framework, no jest, no mocha).

### JSON fixture import via ESM assertion
**Source:** `test/normalize.test.js` lines 12-14:
```js
import workItemFixture from './fixtures/plane-workitem.json' with { type: 'json' };
```
**Apply to:** Loading GitHub fixtures in `test/providers/github/client.test.js`. Path prefix is `../fixtures/github/<name>.json` because the test now lives one directory deeper.

### Headers `.get()` null-handling
**Source:** `src/providers/plane/client.js` lines 56-59 — `if (remaining !== null) this._rateRemaining = parseInt(remaining, 10);`
**Apply to:** GitHubClient `request()` rate-limit header parsing, AND ETag header parsing in the 304 branch. Per Pitfall #8 in RESEARCH.md.

---

## Net-New Patterns (no analog in codebase)

### 1. `fetch` injection via constructor opts (D-06)

**No precedent in repo.** PlaneClient uses `globalThis.fetch` directly. The improvement (small `?? globalThis.fetch` fallback in the constructor + `this.fetch` field) is a Phase 23-owned pattern that future providers should adopt. The lesson: testing without `globalThis` mutation is worth ~4 LOC of constructor code.

**Signature:**
```js
constructor(opts) {
  this.fetch = opts.fetch || globalThis.fetch;
}
// usage in request(): await this.fetch(url, init)
```

### 2. ETag/304 envelope shape (D-19)

**No precedent in repo.** PlaneClient does not support conditional fetch. The envelope `{ status, items, etag, rate_limit_remaining }` is unique to GitHubClient's `listIssues` (D-21: only that method).

**Branch location:** in the private `request()` (centralized in 1 place); the public `listIssues` reads the result and re-shapes. Alternative: keep `request()` raw and put the envelope construction in `listIssues` directly — author's discretion, but doing it in `request()` is cleaner because that's where the parsed headers already live.

### 3. Canonical error `.code` + `.status` + `.retryAfter` on plain `Error` (D-12)

**No precedent in repo.** PlaneClient throws bare `Error` with only `message`. GitHubClient enriches with structured properties. Per D-12, do NOT subclass `Error` — overengineering. Just mutate the instance:
```js
const err = new Error(msg);
err.code = 'rate_limit_exceeded';
err.status = 429;
err.retryAfter = 60;
throw err;
```

### 4. Logger level switch by numeric field threshold (extends `orchestratorReview` pattern)

`orchestratorReview` switches on an enum (`'approved'` vs other). `githubApiCall` switches on a numeric threshold (`< 100`). Same structural pattern, different predicate.

### 5. Fake-fetch `Response`-like builder (test helper)

**No analog.** PlaneClient's test pattern uses real `globalThis.fetch` mutation + real `new Response(JSON.stringify(body))`. RESEARCH.md §Testing Strategy argues for an explicit non-`Response` fake to expose case-sensitivity bugs on header reads. The helper signature `(scenario) => fetch-impl` is Phase 23-owned.

### 6. Fixture file format for GitHub responses

**No analog** (test/fixtures/github/ does not exist). Format: pure response-body JSON, redacted (owner=`kodo-test`, repo=`fixture-repo`, IDs=small ints). Test scenario objects (in the test file) carry the headers, not the fixture.

---

## No Analog Found

| File | Role | Data Flow | Reason | Mitigation |
|------|------|-----------|--------|-----------|
| `test/fixtures/github/*.json` | static JSON fixtures | data | `test/fixtures/` only has Plane data; no GitHub-shaped JSON exists | Author from RESEARCH.md §GitHub REST API Reference; redact per D-34. Plan 23-03 (optional) automates capture. |
| `scripts/capture-github-fixtures.js` (OPTIONAL) | one-shot CLI script | request-response (live) | `scripts/` directory does not exist in repo | If implemented, follow minimal-Node-CLI conventions from CONVENTIONS.md. If deferred (recommended low-priority), generate fixtures manually. |

---

## Metadata

**Analog search scope:**
- `src/providers/plane/` (client.js, provider.js, normalize.js, labels.js)
- `src/logger-events.js`, `src/config.js`, `src/interface.js`
- `test/` (top-level), `test/fixtures/`, `test/helpers/`

**Files scanned:** ~15 source files (rapid Read on the 4 critical analogs: PlaneClient, logger-events.js, plane-provider.test.js, logger-events.test.js; targeted Reads on normalize.test.js for fixture-import idiom and config.js:155-176 for `getProviderApiKey`).

**Strong matches:** 4 (PlaneClient as exact template; logger-events `planeApiCall`/`orchestratorReview` as exact template; PlaneProvider test as suite layout; normalize.test as fixture-import idiom). Stopped at the threshold of diminishing returns.

**Pattern extraction date:** 2026-05-14

---

## PATTERN MAPPING COMPLETE

**Phase:** 23 — GitHubClient + Auth Foundation
**Files classified:** 6 (5 critical for SC#1-4 + 1 optional)
**Analogs found:** 4 / 6 (the 2 net-new are `test/fixtures/github/` and `scripts/`)

### Coverage
- Files with exact analog: 4 (`client.js`, `client.test.js`, `logger-events.js` modify, `logger-events.test.js` modify)
- Files with role-match analog: 0
- Files with no analog: 2 (fixture directory + optional script)

### Key Patterns Identified
- **PlaneClient is the structural template** for `GitHubClient` (constructor → private `request` → 5 public methods), with **3 documented divergences**: D-11 (no retry, drop lines 31-67), D-19 (304 envelope branch added), D-6 (`fetch` injection in constructor).
- **`logger-events.js` helper duo follows `planeApiCall` + `orchestratorReview` blend:** `githubApiCall` uses the planeApiCall body shape with the orchestratorReview info/warn level-switch pattern; `githubApiCallFailed` uses the planeApiCallFailed body shape with `method/path/status` instead of `step`.
- **Tests use `fetch` injection (NEW), NOT `globalThis.fetch` mutation (Plane anti-pattern):** the `makeFetch(scenario)` helper is the only major net-new test pattern. Fixture import follows `normalize.test.js` ESM assertion idiom.
- **Logger taxonomy assertion in `logger-events.test.js` lines 50-68** is the highest-risk change in modified files: the array literal MUST grow from 13 → 15 entries in alphabetical sort order. Failure to update this is the most likely cause of regression.

### File Created
`/Users/alex/dev/klab/kodo/.planning/phases/23-githubclient-auth-foundation/23-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can reference analog patterns in PLAN.md files for Plans 23-01 (logger-events extension), 23-02 (client + fixtures + tests), and optional 23-03 (capture script).
