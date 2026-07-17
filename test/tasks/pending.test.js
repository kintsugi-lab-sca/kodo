// @ts-check
//
// test/tasks/pending.test.js — Phase 76 Plan 01 (ORCH-05 / ORCH-06).
//
// Unit tests for the pure, zero-import `pending` read lane. Mirrors the DI test
// style of test/server/provider-state.test.js: a mock provider whose spied method
// is `listPendingTasks` (returns an array or throws) with a call counter, plus a
// controllable `now` closure to exercise TTL freshness deterministically WITHOUT
// real timers.
//
// The module under test (src/tasks/pending.js) is the single source of truth for
// pending: fetchFreshPending (raw fetch, may throw), createPendingResolver
// (cache + discriminated freshness, never throws), buildPendingStatusFields
// (payload shaper). Freshness is discriminated in {stale}, never collapsed (D-04);
// on failure fetched_at is FROZEN to the last success (Pitfall 3 / ORCH-06).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchFreshPending,
  createPendingResolver,
  buildPendingStatusFields,
} from '../../src/tasks/pending.js';

/**
 * Mock provider with a listPendingTasks spy + call counter. Returns `resolveValue`
 * (an array) on success, or throws `new Error(reject)` when `reject` is set.
 */
function makeProvider({ resolveValue, reject } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async listPendingTasks() {
      calls += 1;
      if (reject) throw new Error(reject);
      return resolveValue;
    },
  };
}

const sampleTasks = [
  { ref: 'KL-1', title: 'Alpha', url: 'http://x/1', state: 'todo', projectName: 'Proj' },
  { ref: 'KL-2', title: 'Beta', url: 'http://x/2', state: 'todo', projectName: 'Proj' },
];

describe('Phase 76 Plan 01: fetchFreshPending (ORCH-05 convergence)', () => {
  it('propagates the throw (raw mode for check.js, D-07)', async () => {
    const provider = makeProvider({ reject: 'boom' });
    await assert.rejects(
      () => fetchFreshPending(() => provider.listPendingTasks()),
      /boom/,
      'fetchFreshPending must NOT capture the throw — it propagates raw',
    );
  });

  it('returns the list verbatim when listPendingTasksFn resolves', async () => {
    const provider = makeProvider({ resolveValue: sampleTasks });
    const out = await fetchFreshPending(() => provider.listPendingTasks());
    assert.deepEqual(out, sampleTasks);
    assert.equal(provider.calls, 1);
  });
});

describe('Phase 76 Plan 01: createPendingResolver (TTL + discriminated freshness)', () => {
  it('TTL fresh hit: two resolves within ttlMs → single fetch, second is {stale:false}', async () => {
    const provider = makeProvider({ resolveValue: sampleTasks });
    let t = 1000;
    const resolver = createPendingResolver({
      listPendingTasksFn: () => provider.listPendingTasks(),
      ttlMs: 30000,
      now: () => t,
    });
    const a = await resolver.resolve();
    t = 1000 + 29000; // still within TTL
    const b = await resolver.resolve();
    assert.equal(a.stale, false);
    assert.deepEqual(a.tasks, sampleTasks);
    assert.equal(b.stale, false);
    assert.deepEqual(b.tasks, sampleTasks);
    assert.equal(provider.calls, 1, 'second resolve within TTL must hit the cache (no re-fetch)');
  });

  it('TTL expired: a resolve after ttlMs re-fetches', async () => {
    const provider = makeProvider({ resolveValue: sampleTasks });
    let t = 1000;
    const resolver = createPendingResolver({
      listPendingTasksFn: () => provider.listPendingTasks(),
      ttlMs: 30000,
      now: () => t,
    });
    await resolver.resolve();
    t = 1000 + 31000; // past TTL
    await resolver.resolve();
    assert.equal(provider.calls, 2, 'resolve past TTL must re-fetch');
  });

  it('catch with prior cache: fail → last-known-good LABELED stale, fetched_at FROZEN (Pitfall 3)', async () => {
    let calls = 0;
    let t = 1000;
    // First resolve succeeds; subsequent ones throw.
    const listPendingTasksFn = async () => {
      calls += 1;
      if (calls === 1) return sampleTasks;
      throw new Error('provider down');
    };
    const resolver = createPendingResolver({ listPendingTasksFn, ttlMs: 30000, now: () => t });
    const first = await resolver.resolve();
    assert.equal(first.stale, false);
    const firstFetchedAt = first.fetched_at;
    assert.ok(typeof firstFetchedAt === 'string' && firstFetchedAt.length > 0);

    t = 1000 + 31000; // past TTL → forces a re-fetch that will now throw
    const second = await resolver.resolve();
    assert.equal(second.stale, true, 'failure with cache must be labeled stale');
    assert.deepEqual(second.tasks, sampleTasks, 'serves last-known-good tasks');
    assert.strictEqual(
      second.fetched_at,
      firstFetchedAt,
      'fetched_at MUST NOT advance to the failure moment — it stays the last success (Pitfall 3)',
    );
  });

  it('cold-start down: never succeeded → {tasks:[], fetched_at:null, stale:true}', async () => {
    const provider = makeProvider({ reject: 'still down' });
    const resolver = createPendingResolver({
      listPendingTasksFn: () => provider.listPendingTasks(),
      ttlMs: 30000,
      now: () => 1000,
    });
    const out = await resolver.resolve();
    assert.deepEqual(out, { tasks: [], fetched_at: null, stale: true });
  });
});

describe('Phase 76 Plan 01: buildPendingStatusFields (payload shaper, Pitfall 4)', () => {
  it('fresh branch: maps tasks and derives pending_count === pending.length', () => {
    const out = buildPendingStatusFields({
      tasks: sampleTasks,
      fetched_at: '2026-07-17T00:00:00.000Z',
      stale: false,
    });
    assert.deepEqual(out, {
      pending: [
        { ref: 'KL-1', title: 'Alpha', url: 'http://x/1', state: 'todo', projectName: 'Proj' },
        { ref: 'KL-2', title: 'Beta', url: 'http://x/2', state: 'todo', projectName: 'Proj' },
      ],
      pending_count: 2,
      pending_stale: false,
      pending_fetched_at: '2026-07-17T00:00:00.000Z',
    });
    assert.equal(out.pending_count, out.pending.length, 'pending_count derived from the same tasks');
  });

  it('stale/cold branch: empty tasks → {pending:[], pending_count:0, pending_stale:true, pending_fetched_at:null}', () => {
    const out = buildPendingStatusFields({ tasks: [], fetched_at: null, stale: true });
    assert.deepEqual(out, {
      pending: [],
      pending_count: 0,
      pending_stale: true,
      pending_fetched_at: null,
    });
    assert.equal(out.pending_count, out.pending.length);
  });
});
