// @ts-check
//
// test/server/provider-state.test.js — Phase 40 Plan 02 (PSTATE-04).
//
// Unit tests for the pure, DI-driven provider_state resolver. The resolver is the
// riskiest code of Phase 40 (cache + in-flight dedup + fail-open) and is extracted
// out of server.js precisely so it is testable WITHOUT booting the HTTP server.
//
// DI style mirrors test/server-reconcile-logger.test.js: inject a mock provider
// (a getTaskState spy with a call counter), a spy logger (captures emitted events),
// and a controllable `now` to exercise TTL expiry deterministically (no real timers).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createProviderStateResolver } from '../../src/server/provider-state.js';

/**
 * Spy logger compatible with the logger-events helpers (they call `logger.error`).
 * Captures every emitted record so tests can assert provider.state.fetch.failed.
 */
function makeSpyLogger() {
  const records = [];
  const capture = (level) => (event, fields) => records.push({ level, event, fields });
  return {
    records,
    debug: capture('debug'),
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
    child() { return this; },
  };
}

/** Mock provider with a getTaskState spy + call counter. */
function makeProvider({ resolveValue, reject } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async getTaskState(arg) {
      calls += 1;
      this.lastArg = arg;
      if (reject) throw new Error(reject);
      return resolveValue;
    },
    lastArg: undefined,
  };
}

const planeSession = { task_id: 'KL-42', project_id: 'proj-1', provider: 'plane' };
const githubSession = { task_id: 'owner/repo#7', task_ref: 'owner/repo#7', provider: 'github' };

describe('Phase 40 Plan 02: createProviderStateResolver (PSTATE-04)', () => {
  it('unsupported: provider WITHOUT getTaskState → {state:null, reason:unsupported}, zero fetch calls', async () => {
    const logger = makeSpyLogger();
    const resolver = createProviderStateResolver({
      provider: {}, // no getTaskState
      logger,
      ttlMs: 30000,
      now: () => 1000,
    });
    const out = await resolver.resolve(planeSession);
    assert.deepEqual(out, { state: null, reason: 'unsupported' });
    assert.equal(logger.records.length, 0, 'unsupported must not emit any event');
  });

  it('ok: getTaskState resolves "in_review" → {state:in_review, reason:null}', async () => {
    const provider = makeProvider({ resolveValue: 'in_review' });
    const logger = makeSpyLogger();
    const resolver = createProviderStateResolver({ provider, logger, ttlMs: 30000, now: () => 1000 });
    const out = await resolver.resolve(planeSession);
    assert.deepEqual(out, { state: 'in_review', reason: null });
    assert.equal(provider.calls, 1);
  });

  it('fetch-failed: getTaskState rejects → {state:null, reason:fetch-failed} AND emits one provider.state.fetch.failed', async () => {
    const provider = makeProvider({ reject: 'boom' });
    const logger = makeSpyLogger();
    const resolver = createProviderStateResolver({ provider, logger, ttlMs: 30000, now: () => 1000 });
    const out = await resolver.resolve(planeSession);
    assert.deepEqual(out, { state: null, reason: 'fetch-failed' });
    const failures = logger.records.filter((r) => r.event === 'provider.state.fetch.failed');
    assert.equal(failures.length, 1, 'must emit exactly one fetch-failed event');
    assert.equal(failures[0].level, 'error');
    assert.equal(failures[0].fields.task_id, 'KL-42');
    assert.equal(failures[0].fields.provider, 'plane');
    assert.equal(failures[0].fields.error, 'boom', 'error is err.message string, not the Error object');
  });

  it('cache: 2 sequential resolves of same task_id within ttlMs → getTaskState called exactly once', async () => {
    const provider = makeProvider({ resolveValue: 'in_progress' });
    const logger = makeSpyLogger();
    let t = 1000;
    const resolver = createProviderStateResolver({ provider, logger, ttlMs: 30000, now: () => t });
    const a = await resolver.resolve(planeSession);
    t = 1000 + 29000; // still within TTL
    const b = await resolver.resolve(planeSession);
    assert.deepEqual(a, { state: 'in_progress', reason: null });
    assert.deepEqual(b, { state: 'in_progress', reason: null });
    assert.equal(provider.calls, 1, 'second resolve within TTL must hit the cache');
  });

  it('cache expiry: a resolve AFTER ttlMs re-fetches', async () => {
    const provider = makeProvider({ resolveValue: 'in_progress' });
    const logger = makeSpyLogger();
    let t = 1000;
    const resolver = createProviderStateResolver({ provider, logger, ttlMs: 30000, now: () => t });
    await resolver.resolve(planeSession);
    t = 1000 + 31000; // past TTL
    await resolver.resolve(planeSession);
    assert.equal(provider.calls, 2, 'resolve past TTL must re-fetch');
  });

  it('dedup: 2 concurrent (not awaited serially) resolves of same task_id → getTaskState called exactly once', async () => {
    let calls = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const provider = {
      get calls() { return calls; },
      async getTaskState() { calls += 1; await gate; return 'blocked'; },
    };
    const logger = makeSpyLogger();
    const resolver = createProviderStateResolver({ provider, logger, ttlMs: 30000, now: () => 1000 });
    const p1 = resolver.resolve(planeSession);
    const p2 = resolver.resolve(planeSession);
    release();
    const [a, b] = await Promise.all([p1, p2]);
    assert.deepEqual(a, { state: 'blocked', reason: null });
    assert.deepEqual(b, { state: 'blocked', reason: null });
    assert.equal(calls, 1, 'overlapping resolves must share the single in-flight fetch');
  });

  it('id-shape: plane session passes {id, projectId}; github session passes {ref}', async () => {
    const planeProvider = makeProvider({ resolveValue: 'done' });
    const githubProvider = makeProvider({ resolveValue: 'done' });
    const logger = makeSpyLogger();
    const planeResolver = createProviderStateResolver({ provider: planeProvider, logger, ttlMs: 30000, now: () => 1 });
    const githubResolver = createProviderStateResolver({ provider: githubProvider, logger, ttlMs: 30000, now: () => 1 });
    await planeResolver.resolve(planeSession);
    await githubResolver.resolve(githubSession);
    assert.deepEqual(planeProvider.lastArg, { id: 'KL-42', projectId: 'proj-1' });
    assert.deepEqual(githubProvider.lastArg, { ref: 'owner/repo#7' });
  });

  it('default now is Date.now (does not require injection)', async () => {
    const provider = makeProvider({ resolveValue: 'done' });
    const logger = makeSpyLogger();
    const resolver = createProviderStateResolver({ provider, logger, ttlMs: 30000 }); // no `now`
    const out = await resolver.resolve(planeSession);
    assert.deepEqual(out, { state: 'done', reason: null });
  });

  it('in-flight entry is cleared after a failed fetch (next resolve re-attempts, not a stuck promise)', async () => {
    let calls = 0;
    const provider = {
      get calls() { return calls; },
      async getTaskState() { calls += 1; throw new Error('transient'); },
    };
    const logger = makeSpyLogger();
    let t = 1000;
    const resolver = createProviderStateResolver({ provider, logger, ttlMs: 30000, now: () => t });
    await resolver.resolve(planeSession);
    // Within TTL, a fetch-failed result is cached (transient stays until TTL) → no re-fetch.
    t = 1000 + 31000; // past TTL → re-attempt
    const out = await resolver.resolve(planeSession);
    assert.deepEqual(out, { state: null, reason: 'fetch-failed' });
    assert.equal(calls, 2, 'after TTL the failed entry is re-attempted (in-flight was cleared)');
  });
});
