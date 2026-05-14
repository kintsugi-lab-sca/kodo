// @ts-check
/**
 * Phase 25 TEST-02 / Plan 25-02 — startPolling contract + clock-mock coverage.
 *
 * This file is built in two passes:
 *   - Task 2a (THIS pass): scaffolding (createTestClock, fakeClient, fakeProvider,
 *     fakeLogger, tempStatePath, makeIssue) + POLL-01 (5 cases) + POLL-02 (5 cases)
 *     + the wall-time meta-assertion as the FINAL it() of the file.
 *   - Task 2b: inserts POLL-03 (7 cases) + POLL-04 (6 cases) + TEST-02 invariantes
 *     (3 cases) BEFORE the meta-test so the elapsed timer captures everything.
 *
 * Invariants verified across the full suite:
 *   - T-25-02 (Information disclosure): pollingDispatch never leaks issue body.
 *   - T-25-03 (DoS bounded retry): exponential backoff sequence 2s/4s/8s × 3.
 *   - T-25-04 (Dispatch storm): first tick populates cursor, NO dispatch.
 *   - T-25-05 (PR elevation): items with pull_request !== null are skipped.
 *   - LOG-12: check.js NOT importing polling.js — covered in check-isolation.test.js.
 *   - Pitfall #5 (clock): zero `Date.now()` calls in polling.js outside DEFAULT_CLOCK.
 *
 * Live-fetch leak guard: globalThis.fetch is replaced with a thrower for the
 * lifetime of the file. Any test that forgets to inject `opts.client` (and
 * doesn't run provider-only) will fail loud rather than touch api.github.com.
 *
 * Wall-time budget: `process.hrtime.bigint()` measures the total elapsed across
 * `before` → all `it()` blocks → the final meta-assertion. Target < 1.5s
 * (clock injection means zero real timers > 0ms in production code paths).
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { startPolling } from '../../src/triggers/polling.js';

// ────────────────────────────────────────────────────────────────────────────
// Live-fetch leak guard (lift de test/providers/github/provider.test.js:37-49).
// Any production code path that touches globalThis.fetch instead of using the
// injected `client`/`provider` will throw loud here.
// ────────────────────────────────────────────────────────────────────────────
const _originalFetch = globalThis.fetch;
let _suiteStart = 0n;
before(() => {
  // @ts-ignore — intentional override scoped to this test file.
  globalThis.fetch = () => {
    throw new Error('live fetch leak: test must inject opts.client or opts.provider');
  };
  _suiteStart = process.hrtime.bigint();
});
after(() => {
  globalThis.fetch = _originalFetch;
});

// ────────────────────────────────────────────────────────────────────────────
// Test clock controller (lift de 25-RESEARCH.md Example 2 verbatim — zero-dep
// scheduler queue with manual `advance`).
// ────────────────────────────────────────────────────────────────────────────
function createTestClock() {
  /** @type {Array<{ts: number, fn: () => void, handle: number}>} */
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
      clearTimeout(handle) {
        const i = queue.findIndex((q) => q.handle === handle);
        if (i >= 0) queue.splice(i, 1);
      },
      now() {
        return virtualNow;
      },
    },
    /** Advance virtual time by `ms`, executing any timers that fire. */
    async advance(ms) {
      const target = virtualNow + ms;
      while (queue.length && queue[0].ts <= target) {
        const next = queue.shift();
        virtualNow = next.ts;
        next.fn();
        // Allow microtasks (any promises awaited inside fn) to settle deterministically.
        await new Promise((r) => globalThis.setImmediate(r));
      }
      virtualNow = target;
    },
    pendingCount() {
      return queue.length;
    },
  };
}

/** Drain pending microtasks once. */
async function drainMicrotasks() {
  await new Promise((r) => globalThis.setImmediate(r));
}

/**
 * Build a minimal fake `GitHubClient` for tests. Captures listIssues calls.
 * Default returns `{status: 200, items: [], etag: undefined, rate_limit_remaining: 5000}`.
 *
 * @param {{ listIssues?: (owner: string, repo: string, opts: any) => Promise<any> }} [overrides]
 */
function makeFakeClient(overrides = {}) {
  const calls = { listIssues: /** @type {any[]} */ ([]) };
  return {
    calls,
    async listIssues(owner, repo, opts) {
      calls.listIssues.push({ owner, repo, opts });
      if (overrides.listIssues) return overrides.listIssues(owner, repo, opts);
      return { status: 200, items: [], etag: undefined, rate_limit_remaining: 5000 };
    },
  };
}

/**
 * Build a minimal fake `TaskProvider` (9-method shim). Only `listPendingTasks`
 * is exercised by `processRepo`; the other 8 are no-ops to satisfy the typedef.
 *
 * @param {{ listPendingTasks?: () => Promise<any[]> }} [overrides]
 */
function makeFakeProvider(overrides = {}) {
  const calls = { listPendingTasks: /** @type {number} */ (0) };
  return {
    calls,
    async init() {},
    async getTask() {
      return /** @type {any} */ ({});
    },
    async updateTaskState() {},
    async addComment() {},
    async listPendingTasks() {
      calls.listPendingTasks++;
      if (overrides.listPendingTasks) return overrides.listPendingTasks();
      return [];
    },
    parseTriggerEvent() {
      return null;
    },
    verifySignature() {
      return false;
    },
    async resolveRef() {
      return '';
    },
    async listProjects() {
      return [];
    },
  };
}

/**
 * Build a fake logger that captures every emit into a shared array. `child()`
 * returns the same captureArray so child loggers share the same sink.
 *
 * @param {any[]} captureArray
 */
function makeFakeLogger(captureArray) {
  return {
    info: (msg, ctx) => captureArray.push({ level: 'info', msg, ...(ctx || {}) }),
    warn: (msg, ctx) => captureArray.push({ level: 'warn', msg, ...(ctx || {}) }),
    error: (msg, ctx) => captureArray.push({ level: 'error', msg, ...(ctx || {}) }),
    debug: (msg, ctx) => captureArray.push({ level: 'debug', msg, ...(ctx || {}) }),
    child: () => makeFakeLogger(captureArray),
  };
}

/** Unique tmp path per test for the state cache. */
function tempStatePath() {
  return join(tmpdir(), `kodo-polling-test-${randomUUID()}.json`);
}

/**
 * Build a raw GitHub-shaped issue. Defaults are minimal but valid; tests
 * override per-case via the `overrides` parameter.
 *
 * @param {Partial<{
 *   node_id: string, number: number, title: string, body: string,
 *   labels: Array<{name: string}|string>, state: string, html_url: string,
 *   pull_request: any, created_at: string, updated_at: string,
 * }>} [overrides]
 */
function makeIssue(overrides = {}) {
  const number = overrides.number ?? 42;
  return {
    node_id: overrides.node_id ?? `I_test${number}`,
    number,
    title: overrides.title ?? 'test issue',
    body: overrides.body ?? '',
    labels: overrides.labels ?? [{ name: 'kodo' }],
    state: overrides.state ?? 'open',
    html_url: overrides.html_url ?? `https://github.com/octocat/hello-world/issues/${number}`,
    pull_request: overrides.pull_request ?? null,
    created_at: overrides.created_at ?? '2026-05-14T07:00:00Z',
    updated_at: overrides.updated_at ?? '2026-05-14T08:00:00Z',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Per-test cleanup (statePath + handle).
// ────────────────────────────────────────────────────────────────────────────
/** @type {string} */
let statePath;
/** @type {{stop: () => void} | null} */
let handle;
/** @type {any[]} */
let events;

beforeEach(() => {
  statePath = tempStatePath();
  handle = null;
  events = [];
});

afterEach(() => {
  if (handle) {
    try {
      handle.stop();
    } catch {}
    handle = null;
  }
  try {
    rmSync(statePath, { force: true });
  } catch {}
  try {
    rmSync(statePath + '.tmp', { force: true });
  } catch {}
});

describe('startPolling — POLL-01 loop signature & scheduling', () => {
  it('returns {stop} handle', async () => {
    const { clock } = createTestClock();
    handle = startPolling({
      client: makeFakeClient(),
      repos: [{ owner: 'octocat', repo: 'hello-world' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    assert.equal(typeof handle.stop, 'function');
  });

  it('throws if neither provider nor client given', () => {
    const { clock } = createTestClock();
    assert.throws(
      () =>
        startPolling({
          repos: [{ owner: 'octocat', repo: 'hello-world' }],
          intervalSec: 60,
          clock,
          statePath,
        }),
      /requires opts\.provider or opts\.client/,
    );
  });

  it('schedules next tick after intervalSec', async () => {
    const { clock, advance } = createTestClock();
    const client = makeFakeClient();
    handle = startPolling({
      client,
      repos: [{ owner: 'octocat', repo: 'hello-world' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    // First tick fires via Promise.resolve().then(tick).
    await drainMicrotasks();
    assert.equal(client.calls.listIssues.length, 1, 'first tick fired');
    // Advance virtual time by intervalSec to fire next tick.
    await advance(60_000);
    await drainMicrotasks();
    assert.equal(client.calls.listIssues.length, 2, 'second tick fired after 60s');
  });

  it('stop cancels pending loop', async () => {
    const { clock, advance } = createTestClock();
    const client = makeFakeClient();
    handle = startPolling({
      client,
      repos: [{ owner: 'octocat', repo: 'hello-world' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    assert.equal(client.calls.listIssues.length, 1);
    handle.stop();
    await advance(60_000);
    await drainMicrotasks();
    assert.equal(client.calls.listIssues.length, 1, 'no more ticks after stop');
  });

  it('multiple repos polled in single tick', async () => {
    const { clock } = createTestClock();
    const client = makeFakeClient();
    handle = startPolling({
      client,
      repos: [
        { owner: 'octocat', repo: 'r1' },
        { owner: 'octocat', repo: 'r2' },
        { owner: 'octocat', repo: 'r3' },
      ],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    assert.equal(client.calls.listIssues.length, 3);
    assert.deepEqual(
      client.calls.listIssues.map((c) => c.repo),
      ['r1', 'r2', 'r3'],
    );
  });
});

describe('startPolling — POLL-02 state cache', () => {
  it('loadStateCache fail-open on corrupted JSON', async () => {
    // Pre-populate with garbage; first tick should treat cache as empty (no error).
    writeFileSync(statePath, 'not-valid-json{{{');
    const { clock } = createTestClock();
    const client = makeFakeClient();
    handle = startPolling({
      client,
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    // First tick proceeds, no throw, no crash. listIssues called with NO since.
    assert.equal(client.calls.listIssues.length, 1);
    assert.equal(client.calls.listIssues[0].opts.since, undefined);
  });

  it('loadStateCache fail-open on missing file', async () => {
    // statePath does NOT exist yet (rmSync in afterEach also guarantees this).
    assert.equal(existsSync(statePath), false);
    const { clock } = createTestClock();
    const client = makeFakeClient();
    handle = startPolling({
      client,
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    // No throw; first tick fires with empty cache.
    assert.equal(client.calls.listIssues.length, 1);
  });

  it('atomic write: tmp file gone post-tick', async () => {
    const { clock } = createTestClock();
    const client = makeFakeClient({
      listIssues: async () => ({
        status: 200,
        items: [makeIssue({ number: 1, updated_at: '2026-05-14T10:00:00Z' })],
        etag: 'W/"abc"',
        rate_limit_remaining: 5000,
      }),
    });
    handle = startPolling({
      client,
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    // statePath exists; statePath.tmp does NOT (it was renamed).
    assert.equal(existsSync(statePath), true, 'state file written');
    assert.equal(existsSync(statePath + '.tmp'), false, 'tmp file consumed by rename');
  });

  it('304 preserves cursor', async () => {
    // Pre-populate state with a cursor — first-tick logic will then NOT
    // re-skip dispatch for an existing cursor key.
    mkdirSync(join(statePath, '..'), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/r1': { last_updated_at: '2026-05-14T05:00:00Z', etag: 'W/"prev"' },
      }),
    );
    const { clock } = createTestClock();
    const client = makeFakeClient({
      listIssues: async () => ({
        status: 304,
        items: [],
        etag: 'W/"prev"',
        rate_limit_remaining: 5000,
      }),
    });
    handle = startPolling({
      client,
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    // 304 does NOT trigger a save — the cursor and etag stay verbatim.
    const cache = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(cache['octocat/r1'].last_updated_at, '2026-05-14T05:00:00Z');
    assert.equal(cache['octocat/r1'].etag, 'W/"prev"');
  });

  it('200 advances cursor to max(updated_at)', async () => {
    // Pre-populate so we're NOT in first-tick state.
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/r1': { last_updated_at: '2026-05-14T05:00:00Z' },
      }),
    );
    const { clock } = createTestClock();
    const client = makeFakeClient({
      listIssues: async () => ({
        status: 200,
        items: [
          makeIssue({ number: 1, updated_at: '2026-05-14T08:00:00Z' }),
          makeIssue({ number: 2, updated_at: '2026-05-14T10:00:00Z' }),
          makeIssue({ number: 3, updated_at: '2026-05-14T09:00:00Z' }),
        ],
        etag: 'W/"new"',
        rate_limit_remaining: 5000,
      }),
    });
    handle = startPolling({
      client,
      // dispatchTriggerFn no-op so we don't accidentally invoke the real dispatcher
      dispatchTriggerFn: async () => ({ action: 'launched' }),
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    const cache = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(cache['octocat/r1'].last_updated_at, '2026-05-14T10:00:00Z');
    assert.equal(cache['octocat/r1'].etag, 'W/"new"');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// META: wall-time guard. This must remain the LAST it() of the file — Task 2b
// inserts its new cases BEFORE this block so the elapsed timer captures
// everything (~22-27 total cases including this one).
// ────────────────────────────────────────────────────────────────────────────
describe('TEST-02 wall-time budget', () => {
  it('suite wall-time under 1.5s budget (TEST-02 timing guard)', () => {
    const elapsed = process.hrtime.bigint() - _suiteStart;
    assert.ok(
      elapsed < 1_500_000_000n,
      `suite took ${Number(elapsed) / 1e6}ms (budget 1500ms)`,
    );
  });
});
