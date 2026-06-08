// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { TASK_PROVIDER_METHODS } from '../src/interface.js';

/** @type {import('../src/providers/plane/provider.js')['createPlaneProvider']} */
let createPlaneProvider;

const MOCK_CONFIG = {
  baseUrl: 'https://test.example.com',
  apiKey: 'test-key',
  workspaceSlug: 'test',
  projects: [{ id: 'proj-uuid', identifier: 'TST', name: 'Test' }],
  states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
  webhookSecret: 'test-secret',
};

describe('PlaneProvider', () => {
  beforeEach(async () => {
    ({ createPlaneProvider } = await import('../src/providers/plane/provider.js'));
  });

  it('createPlaneProvider returns object with all TaskProvider methods', () => {
    const provider = createPlaneProvider(MOCK_CONFIG);
    for (const method of TASK_PROVIDER_METHODS) {
      assert.equal(typeof provider[method], 'function', `Missing method: ${method}`);
    }
  });

  it('verifySignature returns true for valid HMAC', () => {
    const provider = createPlaneProvider(MOCK_CONFIG);
    const payload = '{"event":"issue","action":"update"}';
    const expected = createHmac('sha256', 'test-secret').update(payload).digest('hex');
    const result = provider.verifySignature(payload, { 'x-plane-signature': expected });
    assert.equal(result, true);
  });

  it('verifySignature returns false for invalid signature', () => {
    const provider = createPlaneProvider(MOCK_CONFIG);
    const payload = '{"event":"issue","action":"update"}';
    const result = provider.verifySignature(payload, { 'x-plane-signature': 'deadbeef' });
    assert.equal(result, false);
  });

  it('verifySignature returns false for missing signature', () => {
    const provider = createPlaneProvider(MOCK_CONFIG);
    const payload = '{"event":"issue","action":"update"}';
    const result = provider.verifySignature(payload, {});
    assert.equal(result, false);
  });

  it('verifySignature returns false for missing secret', () => {
    const configNoSecret = { ...MOCK_CONFIG, webhookSecret: undefined };
    const provider = createPlaneProvider(configNoSecret);
    const payload = '{"event":"issue","action":"update"}';
    const result = provider.verifySignature(payload, { 'x-plane-signature': 'anything' });
    assert.equal(result, false);
  });

  describe('rate-limit hygiene (cache reuse)', () => {
    /**
     * Stub fetch with a route table; counts hits per endpoint suffix.
     * @param {Record<string, () => any>} routes
     */
    function stubFetch(routes) {
      const calls = {};
      const original = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const path = new URL(url).pathname;
        const matched = Object.keys(routes).find((suffix) => path.endsWith(suffix) || path.includes(suffix));
        calls[matched || path] = (calls[matched || path] || 0) + 1;
        const body = matched ? routes[matched]() : { results: [] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      return { calls, restore: () => { globalThis.fetch = original; } };
    }

    it('updateTaskState reuses cached states without calling /states/ again', async () => {
      const stub = stubFetch({
        '/states/': () => ({ results: [{ id: 'state-rev', name: 'In review' }, { id: 'state-done', name: 'Done' }] }),
        '/labels/': () => ({ results: [] }),
        '/modules/': () => ({ results: [] }),
        '/projects/proj-uuid/work-items/wi-1/': () => ({ id: 'wi-1' }),
      });
      try {
        const provider = createPlaneProvider(MOCK_CONFIG);
        await provider.init();
        const initStateCalls = stub.calls['/states/'];
        assert.equal(initStateCalls, 1, 'init should fetch states exactly once');

        await provider.updateTaskState({ id: 'wi-1', projectId: 'proj-uuid' }, 'Done');
        assert.equal(stub.calls['/states/'], 1, 'updateTaskState must not re-fetch states');
      } finally {
        stub.restore();
      }
    });

    it('getTaskState resolves the live state UUID via cached definitions (no extra /states/ call when warm)', async () => {
      // This Plane API returns the state ASSIGNMENT as a UUID (`state`), NOT an expanded
      // `state_detail`. getTaskState reads the UUID live and resolves it against the
      // state definitions cached at init.
      const stub = stubFetch({
        '/states/': () => ({ results: [{ id: 's-review', name: 'In Review', group: 'started' }] }),
        '/labels/': () => ({ results: [] }),
        '/modules/': () => ({ results: [] }),
        '/projects/proj-uuid/work-items/wi-1/': () => ({ id: 'wi-1', state: 's-review' }),
      });
      try {
        const provider = createPlaneProvider(MOCK_CONFIG);
        await provider.init();
        assert.equal(stub.calls['/states/'], 1, 'init fetches states exactly once');
        const state = await provider.getTaskState({ id: 'wi-1', projectId: 'proj-uuid' });
        assert.equal(state, 'in_review', 'name substring "review" wins over group "started"');
        assert.equal(stub.calls['/states/'], 1, 'getTaskState must not re-fetch /states/ when cache is warm');
      } finally {
        stub.restore();
      }
    });

    it('listPendingTasks does not request the state_detail expansion', async () => {
      let workItemsUrl = null;
      const original = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const u = new URL(url);
        const p = u.pathname;
        if (p.endsWith('/work-items/')) {
          workItemsUrl = u.toString();
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        }
        if (p.endsWith('/states/')) {
          return new Response(JSON.stringify({ results: [{ id: 's1', name: 'In Progress' }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      };
      try {
        const provider = createPlaneProvider(MOCK_CONFIG);
        await provider.init();
        await provider.listPendingTasks();
        assert.ok(workItemsUrl, 'work-items endpoint should be hit');
        assert.ok(!workItemsUrl.includes('state_detail'), 'expand=state_detail must be removed');
      } finally {
        globalThis.fetch = original;
      }
    });
  });

  describe('getTaskState mapping (D-08/D-09/D-10)', () => {
    /**
     * Build a provider whose work item is ASSIGNED the given state definition. The Plane
     * API returns `state` as a UUID (never an expanded `state_detail`); getTaskState
     * resolves the UUID against the state definitions served by /states/.
     * @param {{name?: string, group?: string}|null} stateDef null → no state assigned
     */
    function providerWithState(stateDef) {
      const original = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const p = new URL(url).pathname;
        if (p.includes('/work-items/wi-1/')) {
          const body = stateDef === null ? { id: 'wi-1' } : { id: 'wi-1', state: 'st-1' };
          return new Response(JSON.stringify(body), { status: 200 });
        }
        if (p.endsWith('/states/')) {
          const results = stateDef === null ? [] : [{ id: 'st-1', name: stateDef.name, group: stateDef.group }];
          return new Response(JSON.stringify({ results }), { status: 200 });
        }
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      };
      const provider = createPlaneProvider(MOCK_CONFIG);
      return { provider, restore: () => { globalThis.fetch = original; } };
    }

    /** @param {{name?: string, group?: string}|null} stateDetail */
    async function mapState(stateDetail) {
      const { provider, restore } = providerWithState(stateDetail);
      try {
        return await provider.getTaskState({ id: 'wi-1', projectId: 'proj-uuid' });
      } finally {
        restore();
      }
    }

    it('name "In Review" (any group) → in_review (name wins over group, D-08)', async () => {
      assert.equal(await mapState({ name: 'In Review', group: 'started' }), 'in_review');
      assert.equal(await mapState({ name: 'In Review', group: 'completed' }), 'in_review');
    });

    it('name "Blocked" (any group) → blocked', async () => {
      assert.equal(await mapState({ name: 'Blocked', group: 'started' }), 'blocked');
    });

    it('name "In Progress" group "started" → in_progress', async () => {
      assert.equal(await mapState({ name: 'In Progress', group: 'started' }), 'in_progress');
    });

    it('name "Done" group "completed" → done', async () => {
      assert.equal(await mapState({ name: 'Done', group: 'completed' }), 'done');
    });

    it('group "cancelled" (terminal) → done', async () => {
      assert.equal(await mapState({ name: 'Cancelled', group: 'cancelled' }), 'done');
    });

    it('group "unstarted" → in_progress', async () => {
      assert.equal(await mapState({ name: 'Todo', group: 'unstarted' }), 'in_progress');
    });

    it('group "backlog" → unknown', async () => {
      assert.equal(await mapState({ name: 'Backlog', group: 'backlog' }), 'unknown');
    });

    it('missing / unrecognized state → unknown', async () => {
      assert.equal(await mapState(null), 'unknown');
      assert.equal(await mapState({ name: 'Weird', group: 'mystery' }), 'unknown');
    });

    it('anti-ReDoS: a name like "(.*)+review" is matched as a literal substring, not a regex', async () => {
      // String.includes('review') is true here because the literal contains "review".
      // The point is no RegExp is ever constructed from provider input (D-10).
      assert.equal(await mapState({ name: '(.*)+review', group: 'backlog' }), 'in_review');
      // A pathological string that would hang a backtracking regex resolves instantly.
      assert.equal(await mapState({ name: 'a'.repeat(50000) + '!', group: 'backlog' }), 'unknown');
    });
  });
});
