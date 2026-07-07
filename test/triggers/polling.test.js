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

describe('startPolling — POLL-03 dispatch patterns + idempotency + fire-and-forget', () => {
  it('first tick skips dispatch (Pitfall #7 / T-25-04)', async () => {
    // Cache empty for this repo; client returns 5 issues. Expected: dispatchCalls.length === 0,
    // cursor populated with max(updated_at).
    const dispatchCalls = /** @type {any[]} */ ([]);
    const { clock } = createTestClock();
    const client = makeFakeClient({
      listIssues: async () => ({
        status: 200,
        items: [
          makeIssue({ number: 1, updated_at: '2026-05-14T08:00:00Z' }),
          makeIssue({ number: 2, updated_at: '2026-05-14T09:00:00Z' }),
          makeIssue({ number: 3, updated_at: '2026-05-14T10:00:00Z' }),
          makeIssue({ number: 4, updated_at: '2026-05-14T07:00:00Z' }),
          makeIssue({ number: 5, updated_at: '2026-05-14T11:00:00Z' }),
        ],
        etag: 'W/"first"',
        rate_limit_remaining: 5000,
      }),
    });
    handle = startPolling({
      client,
      dispatchTriggerFn: async (event) => {
        dispatchCalls.push(event);
        return { action: 'launched' };
      },
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    assert.equal(dispatchCalls.length, 0, 'first tick must NOT dispatch');
    const cache = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(
      cache['octocat/r1'].last_updated_at,
      '2026-05-14T11:00:00Z',
      'cursor populated to max(updated_at)',
    );
  });

  it('pattern (a): new issue after cursor fires dispatch', async () => {
    // Pre-populated cursor — second tick semantics from the start.
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/r1': { last_updated_at: '2026-05-14T05:00:00Z' },
      }),
    );
    const dispatchCalls = /** @type {any[]} */ ([]);
    const { clock } = createTestClock();
    const client = makeFakeClient({
      listIssues: async () => ({
        status: 200,
        items: [
          makeIssue({
            number: 42,
            created_at: '2026-05-14T10:00:00Z',
            updated_at: '2026-05-14T10:00:00Z',
          }),
        ],
        etag: 'W/"x"',
        rate_limit_remaining: 5000,
      }),
    });
    handle = startPolling({
      client,
      dispatchTriggerFn: async (event) => {
        dispatchCalls.push(event);
        return { action: 'launched' };
      },
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    assert.equal(dispatchCalls.length, 1);
    assert.equal(dispatchCalls[0].action, 'polling');
    assert.equal(dispatchCalls[0].provider, 'github');
    assert.equal(dispatchCalls[0].taskRef, 'octocat/r1#42');
  });

  it('pattern (b/c): existing issue updated since cursor fires dispatch', async () => {
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/r1': { last_updated_at: '2026-05-14T05:00:00Z' },
      }),
    );
    const dispatchCalls = /** @type {any[]} */ ([]);
    const { clock } = createTestClock();
    const client = makeFakeClient({
      listIssues: async () => ({
        status: 200,
        items: [
          makeIssue({
            number: 7,
            // created BEFORE the cursor; updated AFTER — classic pattern (b/c).
            created_at: '2026-05-10T01:00:00Z',
            updated_at: '2026-05-14T10:00:00Z',
          }),
        ],
        etag: 'W/"x"',
        rate_limit_remaining: 5000,
      }),
    });
    handle = startPolling({
      client,
      dispatchTriggerFn: async (event) => {
        dispatchCalls.push(event);
        return { action: 'launched' };
      },
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    assert.equal(dispatchCalls.length, 1);
    assert.equal(dispatchCalls[0].taskRef, 'octocat/r1#7');
  });

  it('DELIV-01: dispatch que TIMEOUT (nunca resuelve) → clasificado fallido, el tick no se cuelga', async () => {
    // Contrato post-DELIV-01: el dispatch YA NO es fire-and-forget; se awaitea
    // con un timeout acotado (Promise.race con clock.setTimeout). Un dispatch
    // que nunca resuelve vence por timeout → NO confirmado → NO avanza el
    // cursor sobre ese issue; el tick termina (no se cuelga el loop recursivo,
    // Pitfall #4). Se usa `observed:true` para saltar el skip de primer tick.
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/r1': { last_updated_at: '2026-05-14T05:00:00Z', observed: true },
      }),
    );
    const { clock, advance } = createTestClock();
    // dispatchFn devuelve una promesa que NUNCA resuelve.
    const client = makeFakeClient({
      listIssues: async () => ({
        status: 200,
        items: [makeIssue({ number: 1, updated_at: '2026-05-14T10:00:00Z' })],
        etag: 'W/"x"',
        rate_limit_remaining: 5000,
      }),
    });
    handle = startPolling({
      client,
      dispatchTriggerFn: () => new Promise(() => {}), // nunca resuelve
      dispatchTimeoutMs: 5000,
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    // El tick está bloqueado en el await del dispatch; disparar el timeout.
    await advance(5000);
    await drainMicrotasks();
    // El cursor NO avanzó sobre el issue cuyo dispatch venció (queda en prev).
    const cache = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(
      cache['octocat/r1'].last_updated_at,
      '2026-05-14T05:00:00Z',
      'timeout → cursor NO avanza sobre el issue fallido',
    );
    // El tick terminó y reprogramó el siguiente (no colgó).
    await advance(60_000);
    await drainMicrotasks();
    assert.equal(client.calls.listIssues.length, 2, 'segundo tick disparado tras el timeout');
  });

  it('DELIV-01: dispatch que RECHAZA no crashea el loop y emite polling.error dispatch-unconfirmed', async () => {
    // dispatchFn rechaza; el tick clasifica el issue como no confirmado
    // (polling.error error:'dispatch-unconfirmed'), NO avanza el cursor sobre
    // él, y el siguiente tick vuelve a dispararlo.
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/r1': { last_updated_at: '2026-05-14T05:00:00Z', observed: true },
      }),
    );
    const { clock, advance } = createTestClock();
    const logger = makeFakeLogger(events);
    const client = makeFakeClient({
      listIssues: async () => ({
        status: 200,
        items: [makeIssue({ number: 1, updated_at: '2026-05-14T10:00:00Z' })],
        etag: 'W/"x"',
        rate_limit_remaining: 5000,
      }),
    });
    handle = startPolling({
      client,
      dispatchTriggerFn: async () => {
        throw new Error('dispatch boom');
      },
      dispatchTimeoutMs: 5000,
      logger,
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    await drainMicrotasks();
    const failed = events.filter(
      (e) => e.msg === 'polling.error' && e.error === 'dispatch-unconfirmed',
    );
    assert.ok(
      failed.length >= 1,
      `expected polling.error dispatch-unconfirmed; got: ${JSON.stringify(events)}`,
    );
    // El cursor NO avanzó sobre el issue rechazado.
    const cache = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(cache['octocat/r1'].last_updated_at, '2026-05-14T05:00:00Z');
    // El siguiente tick vuelve a dispararlo (re-intento).
    await advance(60_000);
    await drainMicrotasks();
    assert.equal(client.calls.listIssues.length, 2, 'segundo tick disparado pese al rechazo');
  });

  it('PR filter (Pitfall #2 / T-25-05): issues with pull_request !== null are skipped', async () => {
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/r1': { last_updated_at: '2026-05-14T05:00:00Z' },
      }),
    );
    const dispatchCalls = /** @type {any[]} */ ([]);
    const { clock } = createTestClock();
    const client = makeFakeClient({
      listIssues: async () => ({
        status: 200,
        items: [
          makeIssue({
            number: 10,
            updated_at: '2026-05-14T10:00:00Z',
            pull_request: { url: 'https://api.github.com/repos/octocat/r1/pulls/10' },
          }),
          makeIssue({ number: 11, updated_at: '2026-05-14T10:00:00Z', pull_request: null }),
        ],
        etag: 'W/"x"',
        rate_limit_remaining: 5000,
      }),
    });
    handle = startPolling({
      client,
      dispatchTriggerFn: async (event) => {
        dispatchCalls.push(event);
        return { action: 'launched' };
      },
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    assert.equal(dispatchCalls.length, 1, 'only the issue dispatched, NOT the PR');
    assert.equal(dispatchCalls[0].taskRef, 'octocat/r1#11');
  });

  it('provider-only path: listPendingTasks used when no client', async () => {
    // Pre-populate so we're not in first-tick.
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/r1': { last_updated_at: '2026-05-14T05:00:00Z' },
      }),
    );
    const { clock } = createTestClock();
    const dispatchCalls = /** @type {any[]} */ ([]);
    const provider = makeFakeProvider({
      listPendingTasks: async () => [
        // Already normalized TaskItem shape (provider returns canonical TaskItems).
        {
          id: 'I_test99',
          ref: 'octocat/r1#99',
          title: 't',
          description: '',
          labels: ['kodo'],
          projectId: 'octocat/r1',
          projectName: 'octocat/r1',
          groups: [],
          url: 'https://github.com/octocat/r1/issues/99',
          priority: null,
          state: 'open',
          // synthetic timestamp so shouldDispatch sees an update after cursor
          updated_at: '2026-05-14T10:00:00Z',
          created_at: '2026-05-14T09:00:00Z',
        },
      ],
    });
    handle = startPolling({
      provider,
      dispatchTriggerFn: async (event) => {
        dispatchCalls.push(event);
        return { action: 'launched' };
      },
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    assert.equal(provider.calls.listPendingTasks, 1, 'provider path invoked');
    assert.equal(dispatchCalls.length, 1);
    assert.equal(dispatchCalls[0].taskRef, 'octocat/r1#99');
  });
});

describe('startPolling — POLL-04 retry backoff', () => {
  it('429 triggers retry with 2s base backoff', async () => {
    const { clock, advance } = createTestClock();
    const logger = makeFakeLogger(events);
    let count = 0;
    const client = makeFakeClient({
      listIssues: async () => {
        count++;
        if (count === 1) {
          const err = /** @type {any} */ (new Error('rate limited'));
          err.status = 429;
          throw err;
        }
        return { status: 200, items: [], etag: undefined, rate_limit_remaining: 1 };
      },
    });
    handle = startPolling({
      client,
      logger,
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    assert.equal(count, 1, 'attempt 1 fired');
    await advance(2000);
    await drainMicrotasks();
    assert.equal(count, 2, 'attempt 2 after 2s backoff');
    const errors = events.filter((e) => e.msg === 'polling.error');
    assert.ok(errors.length >= 1, 'polling.error emitted');
    assert.equal(errors[0].status, 429);
    assert.equal(errors[0].attempt, 1);
  });

  it('5xx triggers retry path (500/502/503/504)', async () => {
    for (const status of [500, 502, 503, 504]) {
      const localStatePath = tempStatePath();
      const { clock, advance } = createTestClock();
      let count = 0;
      const client = makeFakeClient({
        listIssues: async () => {
          count++;
          if (count === 1) {
            const err = /** @type {any} */ (new Error(`http ${status}`));
            err.status = status;
            throw err;
          }
          return { status: 200, items: [], etag: undefined, rate_limit_remaining: 5000 };
        },
      });
      const h = startPolling({
        client,
        repos: [{ owner: 'octocat', repo: 'r1' }],
        intervalSec: 60,
        clock,
        statePath: localStatePath,
      });
      await drainMicrotasks();
      assert.equal(count, 1, `status ${status}: attempt 1 fired`);
      await advance(2000);
      await drainMicrotasks();
      assert.equal(count, 2, `status ${status}: attempt 2 after backoff`);
      h.stop();
      try {
        rmSync(localStatePath, { force: true });
      } catch {}
    }
  });

  it('network error (ETIMEDOUT, AbortError) triggers retry', async () => {
    for (const kind of ['ETIMEDOUT', 'AbortError']) {
      const localStatePath = tempStatePath();
      const { clock, advance } = createTestClock();
      let count = 0;
      const client = makeFakeClient({
        listIssues: async () => {
          count++;
          if (count === 1) {
            const err = /** @type {any} */ (new Error('network'));
            if (kind === 'ETIMEDOUT') err.code = 'ETIMEDOUT';
            else err.name = 'AbortError';
            throw err;
          }
          return { status: 200, items: [], etag: undefined, rate_limit_remaining: 5000 };
        },
      });
      const h = startPolling({
        client,
        repos: [{ owner: 'octocat', repo: 'r1' }],
        intervalSec: 60,
        clock,
        statePath: localStatePath,
      });
      await drainMicrotasks();
      assert.equal(count, 1, `${kind}: attempt 1 fired`);
      await advance(2000);
      await drainMicrotasks();
      assert.equal(count, 2, `${kind}: attempt 2 after backoff`);
      h.stop();
      try {
        rmSync(localStatePath, { force: true });
      } catch {}
    }
  });

  it('exponential backoff sequence 2s/4s/8s — 1+3 calls total per tick', async () => {
    // T-25-03 invariant: RETRY_BASE_MS=2000, RETRY_MAX_ATTEMPTS=3.
    // Sequence: attempt 1 immediate → sleep 2s → attempt 2 → sleep 4s → attempt 3 → sleep 8s → attempt 4 → exhausted, return.
    const { clock, advance } = createTestClock();
    const logger = makeFakeLogger(events);
    const client = makeFakeClient({
      listIssues: async () => {
        const err = /** @type {any} */ (new Error('rate limited'));
        err.status = 429;
        throw err;
      },
    });
    handle = startPolling({
      client,
      logger,
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    assert.equal(client.calls.listIssues.length, 1, 'attempt 1');
    await advance(2000);
    await drainMicrotasks();
    assert.equal(client.calls.listIssues.length, 2, 'attempt 2 after 2s');
    await advance(4000);
    await drainMicrotasks();
    assert.equal(client.calls.listIssues.length, 3, 'attempt 3 after 4s');
    await advance(8000);
    await drainMicrotasks();
    assert.equal(client.calls.listIssues.length, 4, 'attempt 4 after 8s');
    // After 4 total attempts (1 initial + 3 retries), warn-and-continue → no more retries this tick.
    // The next call should ONLY happen when intervalSec elapses.
    await advance(1000);
    await drainMicrotasks();
    assert.equal(client.calls.listIssues.length, 4, 'no further retries in same tick');
    await advance(60_000);
    await drainMicrotasks();
    assert.equal(client.calls.listIssues.length, 5, 'next tick fires after intervalSec');
  });

  it('warn-and-continue after 3 retries exhausted (no polling.stopped event)', async () => {
    const { clock, advance } = createTestClock();
    const logger = makeFakeLogger(events);
    const client = makeFakeClient({
      listIssues: async () => {
        const err = /** @type {any} */ (new Error('rate limited'));
        err.status = 429;
        throw err;
      },
    });
    handle = startPolling({
      client,
      logger,
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    await advance(2000);
    await drainMicrotasks();
    await advance(4000);
    await drainMicrotasks();
    await advance(8000);
    await drainMicrotasks();
    const errors = events.filter((e) => e.msg === 'polling.error');
    assert.ok(
      errors.some((e) => e.attempt === 3),
      `expected polling.error with attempt:3; got attempts: ${errors.map((e) => e.attempt).join(',')}`,
    );
    // Open Q #1 RESOLVED — Option A — no polling.stopped event ever emitted.
    const stopped = events.filter((e) => e.msg === 'polling.stopped');
    assert.equal(stopped.length, 0, 'polling.stopped MUST NOT be emitted (warn-and-continue)');
  });

  it('non-transient error (401, 404) does NOT retry', async () => {
    for (const status of [401, 404]) {
      const localStatePath = tempStatePath();
      const localEvents = /** @type {any[]} */ ([]);
      const { clock, advance } = createTestClock();
      const logger = makeFakeLogger(localEvents);
      const client = makeFakeClient({
        listIssues: async () => {
          const err = /** @type {any} */ (new Error(`http ${status}`));
          err.status = status;
          throw err;
        },
      });
      const h = startPolling({
        client,
        logger,
        repos: [{ owner: 'octocat', repo: 'r1' }],
        intervalSec: 60,
        clock,
        statePath: localStatePath,
      });
      await drainMicrotasks();
      // Give a chance for retry attempts to fire if they were going to.
      await advance(2000);
      await drainMicrotasks();
      await advance(4000);
      await drainMicrotasks();
      assert.equal(client.calls.listIssues.length, 1, `status ${status}: exactly 1 call (no retry)`);
      const errors = localEvents.filter((e) => e.msg === 'polling.error');
      assert.equal(errors.length, 1, `status ${status}: exactly 1 polling.error event`);
      assert.equal(errors[0].status, status);
      h.stop();
      try {
        rmSync(localStatePath, { force: true });
      } catch {}
    }
  });
});

describe('startPolling — POLL-FIX-01 provider-only path', () => {
  // Phase 28 D-05: cierra el bug v0.7 tech debt — antes de D-01..D-03,
  // normalizeIssue/normalizeWorkItem excluían updated_at/created_at del TaskItem
  // canónico, por lo que el path provider-only invocaba `shouldDispatch` con
  // `task.updated_at === undefined`. La comparación `undefined > cursor` siempre
  // retornaba false → dispatches silenciados. Estos tests blindan el contrato
  // post-D-01: TaskItem expone updated_at REAL y shouldDispatch lo evalúa.

  it('TaskItem.updated_at > cursor dispara dispatch en path provider-only', async () => {
    // Pre-poblar cursor para evitar first-tick skip (T-25-04).
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/hello': { last_updated_at: '2026-05-15T08:00:00Z' },
      }),
    );
    const { clock } = createTestClock();
    const dispatched = /** @type {any[]} */ ([]);
    // TaskItem mock con los 13 campos canónicos D-01 — espejo exacto del
    // shape que `normalizeIssue` / `normalizeWorkItem` emiten post-Phase-28.
    const taskItem = {
      id: 'I_pollfix01',
      ref: 'octocat/hello#1',
      title: 't',
      description: '',
      labels: ['kodo'],
      projectId: 'octocat/hello',
      projectName: 'octocat/hello',
      groups: [],
      url: 'https://github.com/octocat/hello/issues/1',
      priority: null,
      state: 'open',
      updated_at: '2026-05-15T10:00:00Z',  // POST cursor → debe disparar
      created_at: '2026-05-15T09:00:00Z',
    };
    const provider = makeFakeProvider({
      listPendingTasks: async () => [taskItem],
    });
    handle = startPolling({
      provider,
      dispatchTriggerFn: async (event) => {
        dispatched.push(event);
        return { action: 'launched' };
      },
      repos: [{ owner: 'octocat', repo: 'hello' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    assert.equal(
      dispatched.length,
      1,
      'D-05: TaskItem.updated_at > cursor → shouldDispatch evalúa real, dispara',
    );
    assert.equal(dispatched[0].taskRef, 'octocat/hello#1');
    assert.equal(dispatched[0].action, 'polling');
    assert.equal(dispatched[0].provider, 'github');
  });

  it('TaskItem.updated_at ≤ cursor NO dispara dispatch (paridad client path)', async () => {
    // Cursor reciente; el TaskItem trae timestamp MENOR. shouldDispatch debe
    // retornar false — exactamente como lo hace en el path client raw.
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/hello': { last_updated_at: '2026-05-15T12:00:00Z' },
      }),
    );
    const { clock } = createTestClock();
    const dispatched = /** @type {any[]} */ ([]);
    const taskItem = {
      id: 'I_pollfix02',
      ref: 'octocat/hello#2',
      title: 't',
      description: '',
      labels: ['kodo'],
      projectId: 'octocat/hello',
      projectName: 'octocat/hello',
      groups: [],
      url: 'https://github.com/octocat/hello/issues/2',
      priority: null,
      state: 'open',
      updated_at: '2026-05-15T10:00:00Z',  // PRE cursor → NO debe disparar
      created_at: '2026-05-15T09:00:00Z',
    };
    const provider = makeFakeProvider({
      listPendingTasks: async () => [taskItem],
    });
    handle = startPolling({
      provider,
      dispatchTriggerFn: async (event) => {
        dispatched.push(event);
        return { action: 'launched' };
      },
      repos: [{ owner: 'octocat', repo: 'hello' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    assert.equal(
      dispatched.length,
      0,
      'TaskItem.updated_at ≤ cursor → shouldDispatch retorna false, cero dispatches',
    );
  });

  it('D-06: cursor avanza a max(TaskItem.updated_at) en path provider-only', async () => {
    // Mismo paradigma que POLL-02 "200 advances cursor", pero en path provider.
    // Verifica que extractMaxUpdatedAt lee task.updated_at correctamente
    // (no undefined) y persiste el cursor al cache.
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/hello': { last_updated_at: '2026-05-15T08:00:00Z' },
      }),
    );
    const { clock } = createTestClock();
    const provider = makeFakeProvider({
      listPendingTasks: async () => [
        {
          id: 'I_a', ref: 'octocat/hello#10', title: 't', description: '',
          labels: ['kodo'], projectId: 'octocat/hello', projectName: 'octocat/hello',
          groups: [], url: 'https://github.com/octocat/hello/issues/10',
          priority: null, state: 'open',
          updated_at: '2026-05-15T11:00:00Z',
          created_at: '2026-05-15T09:00:00Z',
        },
        {
          id: 'I_b', ref: 'octocat/hello#11', title: 't', description: '',
          labels: ['kodo'], projectId: 'octocat/hello', projectName: 'octocat/hello',
          groups: [], url: 'https://github.com/octocat/hello/issues/11',
          priority: null, state: 'open',
          updated_at: '2026-05-15T14:00:00Z',  // max
          created_at: '2026-05-15T09:00:00Z',
        },
        {
          id: 'I_c', ref: 'octocat/hello#12', title: 't', description: '',
          labels: ['kodo'], projectId: 'octocat/hello', projectName: 'octocat/hello',
          groups: [], url: 'https://github.com/octocat/hello/issues/12',
          priority: null, state: 'open',
          updated_at: '2026-05-15T13:00:00Z',
          created_at: '2026-05-15T09:00:00Z',
        },
      ],
    });
    handle = startPolling({
      provider,
      dispatchTriggerFn: async () => ({ action: 'launched' }),
      repos: [{ owner: 'octocat', repo: 'hello' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    const cache = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(
      cache['octocat/hello'].last_updated_at,
      '2026-05-15T14:00:00Z',
      'D-06: cursor avanza a max(task.updated_at) cross-TaskItem en path provider-only',
    );
  });
});

describe('TEST-02 NDJSON shape + invariants', () => {
  it('emits polling.tick per repo with {owner, repo, status, dispatched}', async () => {
    const { clock } = createTestClock();
    const logger = makeFakeLogger(events);
    const client = makeFakeClient({
      listIssues: async () => ({
        status: 200,
        items: [],
        etag: undefined,
        rate_limit_remaining: 5000,
      }),
    });
    handle = startPolling({
      client,
      logger,
      repos: [
        { owner: 'octocat', repo: 'r1' },
        { owner: 'octocat', repo: 'r2' },
      ],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    const ticks = events.filter((e) => e.msg === 'polling.tick');
    assert.equal(ticks.length, 2, 'one tick event per repo');
    for (const t of ticks) {
      assert.equal(typeof t.owner, 'string');
      assert.equal(typeof t.repo, 'string');
      assert.equal(typeof t.status, 'number');
      assert.equal(typeof t.dispatched, 'number');
    }
  });

  it('polling.dispatch NDJSON does NOT include issue.body (T-25-02 invariant)', async () => {
    // T-25-02 guardian: even if user content is in the issue payload, NDJSON must
    // not surface body / title / raw object.
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/r1': { last_updated_at: '2026-05-14T05:00:00Z' },
      }),
    );
    const { clock } = createTestClock();
    const logger = makeFakeLogger(events);
    const client = makeFakeClient({
      listIssues: async () => ({
        status: 200,
        items: [
          makeIssue({
            number: 42,
            body: 'SECRET TOKEN ghp_xxx pleaseDoNotLeakMe',
            title: 'SECRET title content',
            updated_at: '2026-05-14T10:00:00Z',
          }),
        ],
        etag: 'W/"x"',
        rate_limit_remaining: 5000,
      }),
    });
    handle = startPolling({
      client,
      logger,
      dispatchTriggerFn: async () => ({ action: 'launched' }),
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    const dispatched = events.filter((e) => e.msg === 'polling.dispatch');
    assert.equal(dispatched.length, 1);
    const serialized = JSON.stringify(dispatched[0]);
    assert.equal(serialized.indexOf('SECRET TOKEN'), -1, 'body must not leak to NDJSON');
    assert.equal(serialized.indexOf('SECRET title'), -1, 'title must not leak to NDJSON');
    // Positive shape check.
    assert.equal(dispatched[0].owner, 'octocat');
    assert.equal(dispatched[0].repo, 'r1');
    assert.equal(dispatched[0].ref, 'octocat/r1#42');
    assert.equal(typeof dispatched[0].pattern, 'string');
  });
});

describe('startPolling — DAEMON-01 polling.tick.summary (Phase 28)', () => {
  // Phase 28 D-10/D-12: cross-repo aggregate emitted at the end of every tick
  // (once per tick). processRepo now returns {dispatched, rate_limit_remaining}
  // on ALL 4 branches (304, 200, non-transient error, retries-exhausted) so the
  // tick loop can sum dispatches and compute min cross-repo rate-limit.

  it('emits exactly 1 polling.tick.summary per tick with 2 successful repos (D-10 shape)', async () => {
    const { clock } = createTestClock();
    const logger = makeFakeLogger(events);
    const client = makeFakeClient(); // default returns rate_limit_remaining: 5000
    handle = startPolling({
      client,
      logger,
      repos: [
        { owner: 'a', repo: 'b' },
        { owner: 'c', repo: 'd' },
      ],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    const summaries = events.filter((e) => e.msg === 'polling.tick.summary');
    assert.equal(summaries.length, 1, 'exactly 1 summary per tick');
    assert.equal(summaries[0].repos_polled, 2);
    assert.equal(summaries[0].total_dispatches, 0);
    assert.equal(summaries[0].rate_limit_remaining, 5000);
    assert.deepEqual(summaries[0].repos, ['a/b', 'c/d']);
  });

  it('D-12: rate_limit_remaining is the MIN cross-repo (most conservative)', async () => {
    const { clock } = createTestClock();
    const logger = makeFakeLogger(events);
    const client = makeFakeClient({
      listIssues: async (owner /*, repo, opts */) =>
        owner === 'a'
          ? { status: 200, items: [], etag: undefined, rate_limit_remaining: 4823 }
          : { status: 200, items: [], etag: undefined, rate_limit_remaining: 1500 },
    });
    handle = startPolling({
      client,
      logger,
      repos: [
        { owner: 'a', repo: 'b' },
        { owner: 'c', repo: 'd' },
      ],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    const summaries = events.filter((e) => e.msg === 'polling.tick.summary');
    assert.equal(summaries.length, 1);
    assert.equal(
      summaries[0].rate_limit_remaining,
      1500,
      'min(4823, 1500) === 1500 — most conservative cross-repo',
    );
  });

  it('D-12: null fallback when provider-only path (no rate-limit in envelope)', async () => {
    const { clock } = createTestClock();
    const logger = makeFakeLogger(events);
    const provider = makeFakeProvider({ listPendingTasks: async () => [] });
    handle = startPolling({
      provider,
      logger,
      repos: [{ owner: 'x', repo: 'y' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    const summaries = events.filter((e) => e.msg === 'polling.tick.summary');
    assert.equal(summaries.length, 1);
    assert.equal(
      summaries[0].rate_limit_remaining,
      null,
      'provider-only synthetic envelope has no rate_limit → summary null',
    );
    assert.deepEqual(summaries[0].repos, ['x/y']);
  });

  it('branch 304 surfaces envelope rate_limit_remaining (fixes "all-304 → null" bug)', async () => {
    // Pre-populate state with etag so the next request will return 304 path.
    writeFileSync(
      statePath,
      JSON.stringify({
        'a/b': { last_updated_at: '2026-05-15T10:00:00Z', etag: 'W/"abc"' },
      }),
    );
    const { clock } = createTestClock();
    const logger = makeFakeLogger(events);
    const client = makeFakeClient({
      listIssues: async () => ({
        status: 304,
        items: [],
        etag: 'W/"abc"',
        rate_limit_remaining: 3777,
      }),
    });
    handle = startPolling({
      client,
      logger,
      repos: [{ owner: 'a', repo: 'b' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    const summaries = events.filter((e) => e.msg === 'polling.tick.summary');
    assert.equal(summaries.length, 1);
    assert.equal(
      summaries[0].rate_limit_remaining,
      3777,
      '304 path must surface envelope rate_limit (NOT null)',
    );
    assert.equal(summaries[0].total_dispatches, 0);
  });

  it('error branch returns {0, null}: summary preserved with total_dispatches=0', async () => {
    // 500 ∈ TRANSIENT_STATUSES → exhausts retries → returns {0, null}.
    const { clock, advance } = createTestClock();
    const logger = makeFakeLogger(events);
    const client = makeFakeClient({
      listIssues: async () => {
        const e = /** @type {any} */ (new Error('boom'));
        e.status = 500;
        throw e;
      },
    });
    handle = startPolling({
      client,
      logger,
      repos: [{ owner: 'a', repo: 'b' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    // Drain retries: 2s + 4s + 8s. Generous advance to cover all backoffs.
    await drainMicrotasks();
    await advance(2000);
    await drainMicrotasks();
    await advance(4000);
    await drainMicrotasks();
    await advance(8000);
    await drainMicrotasks();
    const summaries = events.filter((e) => e.msg === 'polling.tick.summary');
    assert.equal(summaries.length, 1, 'summary still emitted despite retries exhausted');
    assert.equal(summaries[0].total_dispatches, 0);
    assert.equal(summaries[0].rate_limit_remaining, null);
    assert.deepEqual(summaries[0].repos, ['a/b'], 'repo appears in list (push BEFORE-await)');
  });

  it('D-11: per-repo polling.tick coexists with cross-repo polling.tick.summary', async () => {
    // Two repos, two pollingTick events + exactly one pollingTickSummary.
    const { clock } = createTestClock();
    const logger = makeFakeLogger(events);
    const client = makeFakeClient();
    handle = startPolling({
      client,
      logger,
      repos: [
        { owner: 'a', repo: 'b' },
        { owner: 'c', repo: 'd' },
      ],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    const ticks = events.filter((e) => e.msg === 'polling.tick');
    const summaries = events.filter((e) => e.msg === 'polling.tick.summary');
    assert.equal(ticks.length, 2, 'D-11: per-repo polling.tick preserved (one per repo)');
    assert.equal(summaries.length, 1, 'D-10: exactly one cross-repo summary');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 28 Plan 28-03 Task 3 — KODO_TEST_FORCE_THROW test seam coverage.
// ────────────────────────────────────────────────────────────────────────────
describe('startPolling — DAEMON-02 KODO_TEST_FORCE_THROW seam (Phase 28)', () => {
  /** @type {string | undefined} */
  let _prevForce;
  /** @type {string | undefined} */
  let _prevNodeEnv;

  beforeEach(() => {
    _prevForce = process.env.KODO_TEST_FORCE_THROW;
    _prevNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (_prevForce === undefined) delete process.env.KODO_TEST_FORCE_THROW;
    else process.env.KODO_TEST_FORCE_THROW = _prevForce;
    if (_prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = _prevNodeEnv;
  });

  it('NODE_ENV !== "test": KODO_TEST_FORCE_THROW ignorado completamente (defense in depth)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.KODO_TEST_FORCE_THROW = 'true';
    const { clock } = createTestClock();
    const client = makeFakeClient();
    handle = startPolling({
      client,
      repos: [{ owner: 'octocat', repo: 'hello-world' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    // Flow normal: client.listIssues fue invocado, sin throw.
    assert.equal(client.calls.listIssues.length, 1, 'flow normal — listIssues fue invocado');
  });

  it('NODE_ENV === "test" + KODO_TEST_FORCE_THROW === "true": seam emite throw via process.nextTick (uncaughtException)', async () => {
    process.env.NODE_ENV = 'test';
    process.env.KODO_TEST_FORCE_THROW = 'true';
    const { clock } = createTestClock();
    const client = makeFakeClient();
    const captured = [];
    const logger = makeFakeLogger(captured);

    // Intercepta uncaughtException temporalmente. process.nextTick(throw)
    // escapa al .catch() del Promise top-level y va al handler global —
    // exactamente el flow que en el child daemon real se traduce en stack
    // trace de Node a stderr → fd redirect (D-13) → logfile.
    /** @type {Error[]} */
    const uncaughtErrors = [];
    /** @type {Array<((err: Error) => void) | NodeJS.UncaughtExceptionListener>} */
    const previousListeners = process.listeners('uncaughtException').slice();
    process.removeAllListeners('uncaughtException');
    const intercept = (err) => {
      uncaughtErrors.push(err);
    };
    process.on('uncaughtException', intercept);

    try {
      handle = startPolling({
        client,
        repos: [{ owner: 'octocat', repo: 'hello-world' }],
        intervalSec: 60,
        clock,
        statePath,
        logger,
      });
      // Esperar al primer tick (microtask) Y al process.nextTick del seam.
      await drainMicrotasks();
      await drainMicrotasks();
    } finally {
      process.removeListener('uncaughtException', intercept);
      // Restaurar listeners previos.
      for (const l of previousListeners) {
        process.on('uncaughtException', /** @type {any} */ (l));
      }
    }

    // El seam corre en processRepo ANTES del client.listIssues — el throw
    // va via process.nextTick, así que el throw NO bloquea el resto del tick
    // (que SÍ procede a listIssues). En el child daemon real, este throw
    // será uncaughtException (sin handler) y Node imprimirá el stack trace
    // a stderr → logfile via fd redirect.
    assert.equal(
      uncaughtErrors.length,
      1,
      `exactamente 1 uncaughtException, got: ${JSON.stringify(uncaughtErrors.map((e) => e.message))}`,
    );
    assert.match(
      uncaughtErrors[0].message,
      /KODO_TEST_FORCE_THROW: test-induced crash/,
      `mensaje del throw, got: ${uncaughtErrors[0].message}`,
    );
    // Sanity: el stack trace existe (Task 4 integration valida esto en el
    // logfile real via fd redirect).
    assert.match(
      uncaughtErrors[0].stack || '',
      /at\s+/,
      'Error.stack debe contener frames "at ..."',
    );
  });

  it('NODE_ENV === "test" pero KODO_TEST_FORCE_THROW unset: flow normal (sin throw)', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.KODO_TEST_FORCE_THROW;
    const { clock } = createTestClock();
    const client = makeFakeClient();
    handle = startPolling({
      client,
      repos: [{ owner: 'octocat', repo: 'hello-world' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    // Sin la env var, el guard NO se activa: flow normal.
    assert.equal(client.calls.listIssues.length, 1, 'flow normal — listIssues invocado');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 71 Plan 01 — DELIV-01 watermark acotado (Pitfall #2, LA trampa central).
// ────────────────────────────────────────────────────────────────────────────
describe('startPolling — DELIV-01 watermark acotado bajo min(fallidos)', () => {
  it('[A falla @00, B ok @05] → cursor por debajo de A; 2º tick RE-dispara A (client path)', async () => {
    // Pitfall #2: el cursor es un watermark escalar. Si A (updated_at menor)
    // falla y B (updated_at mayor) confirma, avanzar el cursor a B enterraría a
    // A bajo el filtro `since`/`>` y A no se reintentaría jamás. La regla de
    // watermark acotado retrocede el cursor por debajo de min(fallidos).
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/r1': { last_updated_at: '2026-05-14T09:00:00Z', observed: true },
      }),
    );
    const { clock, advance } = createTestClock();
    const dispatchCalls = /** @type {any[]} */ ([]);
    let tickNo = 0;
    const client = makeFakeClient({
      listIssues: async () => {
        tickNo++;
        return {
          status: 200,
          items: [
            // A: updated_at MENOR, su dispatch FALLA.
            makeIssue({ number: 1, updated_at: '2026-05-14T10:00:00Z' }),
            // B: updated_at MAYOR, su dispatch CONFIRMA.
            makeIssue({ number: 2, updated_at: '2026-05-14T10:05:00Z' }),
          ],
          etag: undefined,
          rate_limit_remaining: 5000,
        };
      },
    });
    handle = startPolling({
      client,
      dispatchTriggerFn: async (event) => {
        dispatchCalls.push({ tick: tickNo, ref: event.taskRef });
        // A (#1) rechaza SIEMPRE; B (#2) confirma.
        if (event.taskRef === 'octocat/r1#1') throw new Error('A boom');
        return { action: 'launched' };
      },
      dispatchTimeoutMs: 5000,
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    await drainMicrotasks();
    // El cursor quedó ESTRICTAMENTE por debajo de A (10:00) para que A re-dispare.
    const cache = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.ok(
      cache['octocat/r1'].last_updated_at < '2026-05-14T10:00:00Z',
      `cursor debe quedar < A(10:00); got ${cache['octocat/r1'].last_updated_at}`,
    );
    // 2º tick: A (#1) se vuelve a intentar.
    await advance(60_000);
    await drainMicrotasks();
    await drainMicrotasks();
    const secondTickA = dispatchCalls.filter((c) => c.tick === 2 && c.ref === 'octocat/r1#1');
    assert.ok(secondTickA.length >= 1, 'A (#1) re-disparado en el 2º tick');
  });

  it('[A falla @00, B ok @05] → cursor acotado; 2º tick RE-dispara A (provider path)', async () => {
    // Mismo invariante en el path provider-agnostic (sin `since`): el único
    // filtro es el comparador local estricto `>`, así que la regla de watermark
    // acotado es aún más crítica aquí.
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/r1': { last_updated_at: '2026-05-14T09:00:00Z', observed: true },
      }),
    );
    const { clock, advance } = createTestClock();
    const dispatchCalls = /** @type {any[]} */ ([]);
    let tickNo = 0;
    const mkTask = (num, updated) => ({
      id: `I_${num}`,
      ref: `octocat/r1#${num}`,
      title: 't',
      description: '',
      labels: ['kodo'],
      projectId: 'octocat/r1',
      projectName: 'octocat/r1',
      groups: [],
      url: `https://github.com/octocat/r1/issues/${num}`,
      priority: null,
      state: 'open',
      updated_at: updated,
      created_at: '2026-05-14T08:00:00Z',
    });
    const provider = makeFakeProvider({
      listPendingTasks: async () => {
        tickNo++;
        return [mkTask(1, '2026-05-14T10:00:00Z'), mkTask(2, '2026-05-14T10:05:00Z')];
      },
    });
    handle = startPolling({
      provider,
      dispatchTriggerFn: async (event) => {
        dispatchCalls.push({ tick: tickNo, ref: event.taskRef });
        if (event.taskRef === 'octocat/r1#1') throw new Error('A boom');
        return { action: 'launched' };
      },
      dispatchTimeoutMs: 5000,
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    await drainMicrotasks();
    const cache = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.ok(
      cache['octocat/r1'].last_updated_at < '2026-05-14T10:00:00Z',
      `provider path: cursor debe quedar < A(10:00); got ${cache['octocat/r1'].last_updated_at}`,
    );
    await advance(60_000);
    await drainMicrotasks();
    await drainMicrotasks();
    const secondTickA = dispatchCalls.filter((c) => c.tick === 2 && c.ref === 'octocat/r1#1');
    assert.ok(secondTickA.length >= 1, 'provider path: A (#1) re-disparado en el 2º tick');
  });

  it('todos los dispatch confirman → el cursor avanza a max(updated_at)', async () => {
    // Sin fallidos, el watermark acotado no retrocede: avanza normal.
    writeFileSync(
      statePath,
      JSON.stringify({
        'octocat/r1': { last_updated_at: '2026-05-14T05:00:00Z', observed: true },
      }),
    );
    const { clock } = createTestClock();
    const client = makeFakeClient({
      listIssues: async () => ({
        status: 200,
        items: [
          makeIssue({ number: 1, updated_at: '2026-05-14T10:00:00Z' }),
          makeIssue({ number: 2, updated_at: '2026-05-14T11:00:00Z' }),
        ],
        etag: undefined,
        rate_limit_remaining: 5000,
      }),
    });
    handle = startPolling({
      client,
      dispatchTriggerFn: async () => ({ action: 'launched' }),
      dispatchTimeoutMs: 5000,
      repos: [{ owner: 'octocat', repo: 'r1' }],
      intervalSec: 60,
      clock,
      statePath,
    });
    await drainMicrotasks();
    await drainMicrotasks();
    const cache = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(cache['octocat/r1'].last_updated_at, '2026-05-14T11:00:00Z');
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
