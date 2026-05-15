# Phase 25: Polling Trigger Channel — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 4 (2 create + 2 modify)
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/triggers/polling.js` (CREATE) | trigger channel | event-driven + async loop + fire-and-forget dispatch | `src/triggers/webhook.js` (dispatch shape) + `src/providers/github/client.js` (retry/transport tone) + `src/config.js` (state persistence) | role-match (composite) |
| `test/triggers/polling.test.js` (CREATE) | unit/integration test | input-fixture → assert via fake DI | `test/webhook.test.js` (fakeDeps + fire-and-forget assertion) + `test/providers/github/provider.test.js` (live-fetch leak guard + fakeClient injection) | role-match (composite) |
| `src/logger-events.js` (MODIFY) | event taxonomy | pure transform: fields → NDJSON record | `src/logger-events.js` (Phase 23 GitHub helpers `githubApiCall`/`githubApiCallFailed`) | exact (in-file precedent) |
| `test/check-isolation.test.js` (MODIFY) | invariant guard | static import-graph walk | `test/check-isolation.test.js` lines 113-131 (Phase 24 LOG-12 extension for `github/provider.js` and `github/normalize.js`) | exact (in-file precedent) |

**Note about directory:** `test/triggers/` does NOT exist yet (verified). Plan must create it.

---

## Pattern Assignments

### `src/triggers/polling.js` (trigger channel, event-driven loop)

**Analog A — Fire-and-forget dispatch shape:** `src/triggers/webhook.js`

**Imports + dispatch deps injection pattern** (`src/triggers/webhook.js:1-8`):
```javascript
// @ts-check
import { dispatchTrigger } from './dispatcher.js';

/**
 * @typedef {{
 *   dispatchTriggerFn?: (event: import('../interface.js').TriggerEvent, opts?: object) => Promise<any>,
 * }} WebhookDeps
 */
```

**Fire-and-forget dispatch contract** (`src/triggers/webhook.js:24,46-48`):
```javascript
const dispatchFn = deps.dispatchTriggerFn || dispatchTrigger;
// ...
// 4. Fire-and-forget dispatch -- do NOT await (webhooks must respond fast)
dispatchFn(triggerEvent).catch((err) => {
  console.error(`[kodo] Dispatch error: ${err.message}`);
});
```

**Apply to polling.js:** Mirror the `dispatchFn = deps.dispatchTriggerFn || dispatchTrigger` idiom. Loop must call `dispatchFn(...)` then `.catch(...)` — NEVER `await`. Reason locked in research §Example 3: cmux spawn ~1-2s blocks loop on multi-issue ticks.

---

**Analog B — Retry transport + error envelope:** `src/providers/github/client.js`

**Header/structural comment style** (`src/providers/github/client.js:1-31`): Long header doc-comment explaining "mirror estructural de X con N divergencias justificadas" — same style as Phase 23 `client.js`. Polling.js should open with similar header referencing `webhook.js` (mirror) + `Plane client.js` retry (divergence: retry lives at polling layer per D-11).

**Transient status set + parseRetryAfter** (`src/providers/github/client.js:42-69`):
```javascript
function parseRetryAfter(header) { /* ... */ }
function mapErrorCode(status, headers, retryAfter) { /* ... */ }
```

**Apply to polling.js:** Define module-level constants similarly:
```javascript
const RETRY_BASE_MS = 2000;
const RETRY_MAX_ATTEMPTS = 3;
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
```
Detection logic in catch: `TRANSIENT_STATUSES.has(err.status) || err.code === 'ETIMEDOUT' || err.name === 'AbortError'`.

**Dynamic import of logger-events helpers** (`src/providers/github/client.js:147-148,176-177`):
```javascript
try {
  const { githubApiCall } = await import('../../logger-events.js');
  githubApiCall(this.logger, { /* fields */ });
} catch {
  // silent — nunca interferir con el response flow.
}
```

**Apply to polling.js:** Phase 23 D-15 lock-in is **dynamic** import for logger helpers to preserve LOG-12. **HOWEVER:** `polling.js` is NOT in `check.js` graph (asserted in `test/check-isolation.test.js` extension below). So polling.js MAY use **static** imports for `pollingTick`/`pollingDispatch`/`pollingError` — confirm in plan 25-02. **Tradeoff:** static imports are simpler; dynamic preserves the precedent. Recommendation: static (polling.js never reaches check.js).

---

**Analog C — Atomic state persistence:** `src/config.js`

**KODO_DIR export + ensureDir + writeFileSync idiom** (`src/config.js:1-9,69-73,132-135`):
```javascript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const KODO_DIR = join(homedir(), '.kodo');

function ensureDir() {
  if (!existsSync(KODO_DIR)) {
    mkdirSync(KODO_DIR, { recursive: true });
  }
}

export function saveConfig(config) {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

export { KODO_DIR, CONFIG_PATH, PROJECTS_PATH, DEFAULT_CONFIG };
```

**Apply to polling.js:**
- Import `KODO_DIR` from `../config.js` (per RESEARCH §Pattern 2 D-12).
- Define `DEFAULT_STATE_PATH = join(KODO_DIR, 'polling-state.json')`.
- `loadStateCache`: wrap `readFileSync` + `JSON.parse` in try/catch; defensive `if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed; return {};` — fail-open per POLL-02.
- `saveStateCache`: **upgrade** `config.js`'s non-atomic write to `tmp + rename`:
```javascript
const tmp = path + '.tmp';
writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n');
renameSync(tmp, path);  // atomic on POSIX (Pitfall #6 — kodo is Mac/Linux)
```
This is a **conscious additive improvement** over `saveConfig` (not refactoring config.js — Rule 3 quirúrgico).

---

**Analog D — Provider/client injection signature:** `src/triggers/dispatcher.js`

**Deps typedef + default fallback** (`src/triggers/dispatcher.js:18-31,43-55`):
```javascript
/**
 * @typedef {{
 *   getProviderFn?: (name?: string) => import('../interface.js').TaskProvider,
 *   launchWorkItemFn?: (ref: string, opts: object) => Promise<any>,
 *   listSessionsFn?: () => any[],
 *   // ...
 * }} DispatchDeps
 */
export async function dispatchTrigger(event, opts = {}, deps = {}) {
  const getProviderFn = deps.getProviderFn || ((name) => getProvider(name || event.provider));
  const launchWorkItemFn = deps.launchWorkItemFn || launchWorkItem;
  // ...
}
```

**Apply to polling.js `startPolling`:** Single opts object (not 3 args — research §Pattern 1 signature):
```javascript
/**
 * @typedef {{
 *   setTimeout: (fn: () => void, ms: number) => any,
 *   clearTimeout: (handle: any) => void,
 *   now: () => number,
 * }} Clock
 */

const DEFAULT_CLOCK = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h),
  now: () => Date.now(),
};

/**
 * @param {{
 *   provider?: import('../interface.js').TaskProvider,
 *   client?: import('../providers/github/client.js').GitHubClient,
 *   repos: Array<{owner: string, repo: string}>,
 *   intervalSec?: number,
 *   clock?: Clock,
 *   logger?: import('../logger.js').Logger,
 *   statePath?: string,
 *   dispatchTriggerFn?: typeof dispatchTrigger,
 * }} opts
 * @returns {{ stop: () => void }}
 */
export function startPolling(opts) { /* ... */ }
```

**Pitfall #5 lock-in:** `polling.js` must use `clock.now()` exclusively (zero `Date.now()` direct calls). Lint check: `grep 'Date\.now\(\)' src/triggers/polling.js` must return 0 lines.

---

**Analog E — listIssues envelope consumer:** `src/providers/github/provider.js`

**listPendingTasks 304-friendly pattern** (`src/providers/github/provider.js:133-147`):
```javascript
async listPendingTasks() {
  const allTasks = [];
  for (const r of config.repos || []) {
    const result = await client.listIssues(r.owner, r.repo, {
      labels: ['kodo'],
      state: 'open',
    });
    for (const issue of result.items || []) {
      if (issue.pull_request) continue; // Pitfall #2: PRs intermixed con issues.
      allTasks.push(normalizeIssue(issue, { projectId: `${r.owner}/${r.repo}` }));
    }
  }
  return allTasks;
}
```

**Apply to polling.js processRepo:** Same envelope consumption — `result.items`, `result.status`, `result.etag`. Decision locked by hybrid signature (D-XX Open Q #2):
- If `opts.client` injected → direct path with etag: `client.listIssues(owner, repo, {labels:['kodo'], state:'open', since: prev.last_updated_at, etag: prev.etag})`. Mirror PR filter line: `if (issue.pull_request) continue;` (citing Pitfall #2).
- If only `opts.provider` injected → `provider.listPendingTasks()` (no etag, no cursor benefit — Phase 27 fallback).

---

### `test/triggers/polling.test.js` (unit/integration, fake DI)

**Analog A — fakeProvider + fire-and-forget assertion:** `test/webhook.test.js`

**fakeProvider helper** (`test/webhook.test.js:9-21`):
```javascript
function createFakeProvider(overrides = {}) {
  return {
    init: async () => {},
    getTask: async () => ({}),
    updateTaskState: async () => {},
    addComment: async () => {},
    listPendingTasks: async () => [],
    parseTriggerEvent: () => ({ taskRef: 'KL-42', action: 'state_change', provider: 'test', raw: {} }),
    verifySignature: () => true,
    resolveRef: async () => '',
    ...overrides,
  };
}
```

**dispatch spy + microtask drain pattern** (`test/webhook.test.js:38-52`):
```javascript
const result = await handleWebhookRequest(body, headers, provider, {
  dispatchTriggerFn: async (event, opts) => {
    dispatchCalls.push({ event, opts });
    return { action: 'launched' };
  },
});
// Fire-and-forget — dispatch was called (may still be pending)
// Give microtask a chance to run
await new Promise((r) => setTimeout(r, 10));
assert.equal(dispatchCalls.length, 1);
```

**Apply to polling.test.js:**
- Build `createFakeProvider()` lifted from `test/webhook.test.js` (8-method shim with `listPendingTasks: async () => []` default).
- Inject `dispatchTriggerFn` spy via `startPolling({ dispatchTriggerFn: ... })`.
- For fire-and-forget assertion: use the clock-mock `advance()` + `setImmediate` microtask drain (research §Example 2). Do NOT use `await new Promise((r) => setTimeout(r, 10))` — that defeats the clock-mock purpose.

---

**Analog B — fakeClient + live-fetch leak guard:** `test/providers/github/provider.test.js`

**live-fetch leak guard** (`test/providers/github/provider.test.js:37-49`):
```javascript
const _originalFetch = globalThis.fetch;
before(() => {
  // @ts-ignore — intentional override scoped to this test file.
  globalThis.fetch = () => {
    throw new Error('live fetch leak: test must inject opts.client');
  };
});
after(() => {
  globalThis.fetch = _originalFetch;
});
```

**fakeClient shape + spy collection** (`test/providers/github/provider.test.js:60-100`):
```javascript
function makeFakeClient(overrides = {}) {
  const calls = {
    getIssue: [],
    listIssues: [],
    addComment: [],
    updateIssue: [],
    listLabels: [],
  };
  return {
    calls,
    async listIssues(owner, repo, opts) {
      calls.listIssues.push({ owner, repo, opts });
      if (overrides.listIssues) return overrides.listIssues(owner, repo, opts);
      return { status: 200, items: [], etag: undefined, rate_limit_remaining: 5000 };
    },
    // ... other methods
  };
}
```

**Apply to polling.test.js:**
- Copy the `before/after` live-fetch leak guard verbatim. Polling tests MUST never touch `api.github.com`.
- `makeFakeClient({ listIssues: ... })` per-test override pattern is exactly what polling tests need to:
  - Return `{status:304, items:[], etag:'E1'}` to test cursor preservation
  - Return `{status:200, items:[issueFixture]}` to test dispatch path
  - Throw `{status:429}` to test retry backoff (research §Code Examples Example 2)
- Reuse `test/fixtures/github/issues-list.json` (2 issues + 1 PR) per RESEARCH §Wave 0 Gaps — assert that PR is filtered.

---

**Analog C — Clock controller + fakeLogger spy:** RESEARCH §Code Examples Example 2 (no existing analog — new pattern)

This is the **net-new pattern** for Phase 25. The closest precedent is the deps-injection idiom in `dispatcher.js`, but no existing test uses a clock controller. Plan must implement `createTestClock()` and `makeFakeLogger(captureArray)` per research §Example 2 and §Option A.

**Critical contract for clock injection:**
```javascript
function createTestClock() {
  const queue = [];
  let nextHandle = 1;
  let virtualNow = 0;
  return {
    clock: {
      setTimeout(fn, ms) {
        const handle = nextHandle++;
        queue.push({ ts: virtualNow + ms, fn, handle });
        queue.sort((a, b) => a.ts - b.ts);
        return handle;
      },
      clearTimeout(handle) { /* findIndex + splice */ },
      now() { return virtualNow; },
    },
    async advance(ms) {
      const target = virtualNow + ms;
      while (queue.length && queue[0].ts <= target) {
        const next = queue.shift();
        virtualNow = next.ts;
        next.fn();
        await new Promise((r) => globalThis.setImmediate(r));
      }
      virtualNow = target;
    },
    pendingCount() { return queue.length; },
  };
}
```

**fakeLogger** (RESEARCH §Option A):
```javascript
function makeFakeLogger(captureArray) {
  return {
    info: (msg, ctx) => captureArray.push({ level: 'info', msg, ...ctx }),
    warn: (msg, ctx) => captureArray.push({ level: 'warn', msg, ...ctx }),
    error: (msg, ctx) => captureArray.push({ level: 'error', msg, ...ctx }),
    debug: (msg, ctx) => captureArray.push({ level: 'debug', msg, ...ctx }),
    child: (bindings) => makeFakeLogger(captureArray),
  };
}
```

---

**Analog D — Test file imports + statePath isolation:** `test/dispatcher.test.js`

**Test imports + beforeEach reset** (`test/dispatcher.test.js:1-3,64-71`):
```javascript
// @ts-check
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
// ...
describe('dispatchTrigger', () => {
  beforeEach(() => {
    fakeProvider = createFakeProvider();
    launchWorkItemCalls = [];
    listSessionsResult = [];
    listWorkspacesResult = '';
    removeSessionCalls = [];
  });
```

**Apply to polling.test.js:**
- Same `@ts-check` + `describe`/`it`/`beforeEach`/`afterEach` from `node:test`.
- Per-test `tempStatePath`: use `join(os.tmpdir(), \`polling-state-${randomUUID()}.json\`)` and clean in `afterEach`. Avoid touching the real `~/.kodo/polling-state.json`.
- `beforeEach` resets capture arrays (events, dispatchCalls) and stops any prior `{stop}` handle from previous test.

---

### `src/logger-events.js` (taxonomy, MODIFY — in-file precedent)

**Analog — Phase 23 GitHub helpers** (`src/logger-events.js:38-39,55-56,242-276`)

**EVENTS frozen object extension pattern** (`src/logger-events.js:24-57`):
```javascript
/** @type {Readonly<{
 *   SESSION_START: 'session.start',
 *   // ...
 *   GITHUB_API_CALL: 'github.api.call',
 *   GITHUB_API_CALL_FAILED: 'github.api.call.failed',
 * }>} */
export const EVENTS = Object.freeze({
  SESSION_START:           'session.start',
  // ...
  GITHUB_API_CALL:         'github.api.call',
  GITHUB_API_CALL_FAILED:  'github.api.call.failed',
});
```

**Helper function pattern (level switch by field)** (`src/logger-events.js:242-256`):
```javascript
export function githubApiCall(logger, fields) {
  const level =
    typeof fields.rate_limit_remaining === 'number' && fields.rate_limit_remaining < 100
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

**Helper function pattern (error level)** (`src/logger-events.js:268-276`):
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

**Apply to logger-events.js MODIFY:**

1. Update top-of-file comment (line 4-11) to include `polling.tick`, `polling.dispatch`, `polling.error` in the inventory list.

2. Add 3 entries to the `EVENTS` JSDoc typedef + frozen object (after `GITHUB_API_CALL_FAILED`):
```javascript
POLLING_TICK:           'polling.tick',
POLLING_DISPATCH:       'polling.dispatch',
POLLING_ERROR:          'polling.error',
```

3. Append 3 helper functions following the pattern (RESEARCH §Example 1):
   - `pollingTick(logger, {owner, repo, status, dispatched, first_tick?})` → `logger.info`
   - `pollingDispatch(logger, {owner, repo, ref, pattern})` → `logger.info`
   - `pollingError(logger, {owner, repo, status, attempt, error?})` → `logger.warn`

4. **Security invariant (research §Security):** `pollingDispatch` payload must NOT include `issue.body` or any user content. Only `{owner, repo, ref, pattern}`.

5. **LOG-12 invariant preserved:** logger-events.js continues to import only `node:os` + `node:path`. The 3 new helpers add zero new imports.

---

### `test/check-isolation.test.js` (invariant guard, MODIFY — in-file precedent)

**Analog — Phase 24 LOG-12 extension** (`test/check-isolation.test.js:109-131`)

**Test pattern** (`test/check-isolation.test.js:113-121`):
```javascript
// Phase 24 LOG-12 extension: el provider de GitHub carga config.js (vía GitHubClient
// constructor) y normalize.js carga interface.js — ambos fuera del árbol permitido
// de `kodo check`. Mantener `check.js` light-weight como en v0.5 (precedente del
// logger.js prohibido) es invariante cross-phase (STATE.md).
it('kodo check does not import src/providers/github/provider.js transitively', () => {
  const graph = walkImports(join(SRC, 'check.js'));
  const violators = [...graph].filter((p) => p.endsWith('/providers/github/provider.js'));
  assert.deepEqual(
    violators,
    [],
    `check.js transitively imports github/provider.js via:\n  ${violators.map((p) => relative(REPO, p)).join('\n  ')}`,
  );
});
```

**Apply to check-isolation.test.js MODIFY:**

Add a third `it(...)` row after line 131 (just before the closing `});` of the describe block) using verbatim the same shape:
```javascript
// Phase 25 LOG-12 extension: polling.js loads dispatcher, GitHubClient, config (KODO_DIR)
// and logger-events helpers — all outside the permitted check.js tree. The dispatcher
// (already excluded by transitive check) imports manager.js and gsd/lock.js which load
// cmux/state machinery. Polling is a trigger channel, not a check primitive.
it('kodo check does not import src/triggers/polling.js transitively', () => {
  const graph = walkImports(join(SRC, 'check.js'));
  const violators = [...graph].filter((p) => p.endsWith('/triggers/polling.js'));
  assert.deepEqual(
    violators,
    [],
    `check.js transitively imports triggers/polling.js via:\n  ${violators.map((p) => relative(REPO, p)).join('\n  ')}`,
  );
});
```

**Critical:** ~12 LOC, zero changes to walker logic or imports at top of file. Quirúrgico per Rule 3.

---

## Shared Patterns

### Pattern: `@ts-check` + JSDoc typedefs at module head

**Source:** Universal across `src/triggers/*.js`, `src/providers/github/*.js`
**Apply to:** `src/triggers/polling.js`, `test/triggers/polling.test.js`
```javascript
// @ts-check
/**
 * [Module doc — purpose, divergences from analogs, references to Phase decisions]
 */
import { dispatchTrigger } from './dispatcher.js';
```

### Pattern: Dependency injection via opts/deps object with default fallback

**Source:** `src/triggers/dispatcher.js:43-55`, `src/triggers/webhook.js:24`, `src/providers/github/provider.js:67-73`
**Apply to:** All polling.js exported functions
```javascript
const dispatchFn = opts.dispatchTriggerFn || dispatchTrigger;
const clock = opts.clock || DEFAULT_CLOCK;
```

### Pattern: Fire-and-forget with `.catch(...)`, never `await`

**Source:** `src/triggers/webhook.js:46-48`
**Apply to:** polling.js `dispatchFn(...)` call site (research §Example 3)
```javascript
dispatchFn({ taskRef, action, provider, raw }, {}).catch((err) => {
  logger?.error('polling.dispatch.failed', { owner, repo, ref, error: err.message });
});
```

### Pattern: Atomic file write via `tmp + rename`

**Source:** `src/config.js:132-135` (non-atomic; polling.js IMPROVES this additively)
**Apply to:** `saveStateCache` in polling.js
```javascript
const tmp = path + '.tmp';
writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n');
renameSync(tmp, path);
```

### Pattern: Live-fetch leak guard in tests

**Source:** `test/providers/github/provider.test.js:40-49`
**Apply to:** `test/triggers/polling.test.js` `before/after` blocks
```javascript
const _originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = () => { throw new Error('live fetch leak: test must inject opts.client'); };
});
after(() => { globalThis.fetch = _originalFetch; });
```

### Pattern: Closed-taxonomy NDJSON event helper

**Source:** `src/logger-events.js:242-276`
**Apply to:** New helpers `pollingTick`, `pollingDispatch`, `pollingError` in logger-events.js
```javascript
export function pollingTick(logger, fields) {
  logger.info(EVENTS.POLLING_TICK, {
    event: EVENTS.POLLING_TICK,
    owner: fields.owner,
    repo: fields.repo,
    status: fields.status,
    dispatched: fields.dispatched,
    ...(fields.first_tick ? { first_tick: true } : {}),
  });
}
```

### Pattern: LOG-12 invariant guard test row

**Source:** `test/check-isolation.test.js:113-131`
**Apply to:** New `it('kodo check does not import src/triggers/polling.js transitively', ...)` row
Same `walkImports + filter + assert.deepEqual` skeleton; only the path suffix changes.

---

## No Analog Found

All files have analogs. The single **net-new sub-pattern** is the `createTestClock()` controller for `test/triggers/polling.test.js` — sourced from RESEARCH §Code Examples Example 2 (industry-standard fake-timer idiom; no existing test in the repo uses it).

| Sub-pattern | Reason no analog | Source |
|------|---|---|
| `createTestClock()` helper | First clock-injecting test in repo | RESEARCH.md §Code Examples Example 2 (self-contained, zero-dep) |
| `makeFakeLogger(captureArray)` | First spy-logger for NDJSON assertions; existing tests assert on logger.js stderr/file output | RESEARCH.md §NDJSON Option A |

Planner should treat these as **NEW patterns established by Phase 25** that future polling-adjacent tests (Phase 26 CLI, Phase 27 cross-provider) can reuse.

---

## Metadata

**Analog search scope:**
- `src/triggers/*.js` (2 files: dispatcher, webhook)
- `src/providers/github/*.js` (3 files: client, provider, normalize)
- `src/config.js`
- `src/logger-events.js`
- `test/webhook.test.js`, `test/dispatcher.test.js`, `test/providers/github/provider.test.js`, `test/check-isolation.test.js`

**Files scanned:** 11
**Pattern extraction date:** 2026-05-14

**Key cross-phase invariants preserved:**
- LOG-12 (check.js graph isolation) — extended with new row for polling.js
- Closed-taxonomy NDJSON (15 events → 18 events after Phase 25)
- Fire-and-forget dispatch contract (webhook.js precedent)
- DI via opts/deps (dispatcher.js precedent)
- snake_case config sub-blocks (Phase 24 D-29)
- Provider/client injection in tests (Phase 24 D-36 + D-37 live-fetch leak guard)
