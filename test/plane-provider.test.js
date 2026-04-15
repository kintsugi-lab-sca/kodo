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
});
