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

describe('PlaneClient.createLabel idempotency on name-conflict 409 (Phase 56 Plan 04 UAT gap-fix)', () => {
  /** @type {import('../src/providers/plane/client.js')['PlaneClient']} */
  let PlaneClient;

  beforeEach(async () => {
    ({ PlaneClient } = await import('../src/providers/plane/client.js'));
  });

  // Explicit opts bypass loadConfig() (config.plane is undefined under the v2 schema; passing
  // baseUrl/apiKey/workspaceSlug short-circuits the `opts.x || config.plane.x` reads).
  const CLIENT_OPTS = {
    baseUrl: 'https://test.example.com',
    apiKey: 'test-key',
    workspaceSlug: 'test',
  };

  const LABELS_409_BODY =
    '{"error":"Label with the same name already exists in the project","id":"e69e7ac6-1111-2222-3333-444444444444"}';

  /**
   * Stub globalThis.fetch: POST a /labels/ lanza el 409 'already exists', GET re-lista labels.
   * @param {{ existingLabels: any[] }} cfg
   */
  function stubLabels(cfg) {
    const original = globalThis.fetch;
    const calls = { post: 0, get: 0 };
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      const method = (init && init.method) || 'GET';
      if (path.endsWith('/labels/') && method === 'POST') {
        calls.post++;
        // request() throws on !res.ok with this exact message shape.
        return new Response(LABELS_409_BODY, {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (path.endsWith('/labels/') && method === 'GET') {
        calls.get++;
        return new Response(JSON.stringify({ results: cfg.existingLabels }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    };
    return { calls, restore: () => { globalThis.fetch = original; } };
  }

  it('409 name-conflict → re-lista y RETORNA el label existente (idempotente)', async () => {
    const existing = { id: 'e69e7ac6-1111-2222-3333-444444444444', name: 'kodo:adopted' };
    const stub = stubLabels({ existingLabels: [{ id: 'other', name: 'bug' }, existing] });
    try {
      const client = new PlaneClient(CLIENT_OPTS);
      const result = await client.createLabel('proj-uuid', 'kodo:adopted');
      assert.equal(result.id, existing.id, 'reusa el id del label existente');
      assert.equal(result.name, 'kodo:adopted');
      assert.equal(stub.calls.post, 1, 'intentó el POST una vez');
      assert.equal(stub.calls.get, 1, 're-listó labels una vez');
    } finally {
      stub.restore();
    }
  });

  it('match de nombre case-insensitive al re-listar', async () => {
    const existing = { id: 'lbl-ci', name: 'Kodo:Adopted' };
    const stub = stubLabels({ existingLabels: [existing] });
    try {
      const client = new PlaneClient(CLIENT_OPTS);
      const result = await client.createLabel('proj-uuid', 'kodo:adopted');
      assert.equal(result.id, 'lbl-ci');
    } finally {
      stub.restore();
    }
  });

  it('409 pero el label NO aparece al re-listar → re-lanza el error original (no enmascara fallo)', async () => {
    const stub = stubLabels({ existingLabels: [{ id: 'x', name: 'unrelated' }] });
    try {
      const client = new PlaneClient(CLIENT_OPTS);
      await assert.rejects(
        () => client.createLabel('proj-uuid', 'kodo:adopted'),
        /Plane API 409/,
        'sin match en la re-lista, el 409 original se propaga LOUD',
      );
    } finally {
      stub.restore();
    }
  });

  it('error NO-409 (p.ej. 500) sigue fallando LOUD (D-08 intacto)', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const method = (init && init.method) || 'GET';
      if (method === 'POST') {
        return new Response('{"error":"boom"}', { status: 500, headers: { 'content-type': 'application/json' } });
      }
      throw new Error('GET should never be reached for a non-409 error');
    };
    try {
      const client = new PlaneClient(CLIENT_OPTS);
      await assert.rejects(
        () => client.createLabel('proj-uuid', 'kodo:adopted'),
        /Plane API 500/,
        'un 500 no es name-conflict → re-throw sin re-listar',
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it('éxito normal (POST 201) → retorna el label crudo sin re-listar', async () => {
    const original = globalThis.fetch;
    const calls = { post: 0, get: 0 };
    globalThis.fetch = async (url, init) => {
      const method = (init && init.method) || 'GET';
      if (method === 'POST') {
        calls.post++;
        return new Response(JSON.stringify({ id: 'new-uuid', name: 'kodo:adopted' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      calls.get++;
      throw new Error('GET should never be reached on success');
    };
    try {
      const client = new PlaneClient(CLIENT_OPTS);
      const result = await client.createLabel('proj-uuid', 'kodo:adopted');
      assert.equal(result.id, 'new-uuid');
      assert.equal(calls.get, 0, 'no re-lista en el happy path');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('PlaneProvider.createTask description_html omission (Phase 56 Plan 05 UAT gap-fix)', () => {
  /** @type {import('../src/providers/plane/provider.js')['createPlaneProvider']} */
  let createPlaneProvider;
  beforeEach(async () => {
    ({ createPlaneProvider } = await import('../src/providers/plane/provider.js'));
  });

  /**
   * Stub fetch: init() pre-caches labels (incl. kodo:adopted) + states (incl. trigger),
   * so createTask reuses them and only POSTs /work-items/. Captures that POST body.
   * @returns {{ getBody: () => any, restore: () => void }}
   */
  function stubCreateTask() {
    const original = globalThis.fetch;
    let captured = null;
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      const method = (init && init.method) || 'GET';
      if (path.endsWith('/labels/') && method === 'GET') {
        return new Response(JSON.stringify({ results: [{ id: 'lbl-adopted', name: 'kodo:adopted' }] }), { status: 200 });
      }
      if (path.endsWith('/states/') && method === 'GET') {
        return new Response(JSON.stringify({ results: [{ id: 'st-trigger', name: 'In Progress', group: 'started' }] }), { status: 200 });
      }
      if (path.endsWith('/work-items/') && method === 'POST') {
        captured = JSON.parse(init.body);
        return new Response(JSON.stringify({ id: 'wi-new', name: captured.name, state: 'st-trigger' }), { status: 201 });
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    };
    return { getBody: () => captured, restore: () => { globalThis.fetch = original; } };
  }

  it('omits description_html entirely when no description (Plane 400 "Invalid HTML passed" blocker)', async () => {
    const stub = stubCreateTask();
    try {
      const provider = createPlaneProvider(MOCK_CONFIG);
      await provider.init();
      await provider.createTask({ projectId: 'proj-uuid', title: 'adopted task' });
      const body = stub.getBody();
      assert.ok(body, 'work-items POST must fire');
      assert.equal(body.name, 'adopted task');
      assert.ok(!('description_html' in body), 'description_html MUST be omitted when empty (not sent as "")');
      assert.deepEqual(body.labels, ['lbl-adopted']);
    } finally {
      stub.restore();
    }
  });

  it('includes description_html when a description IS given', async () => {
    const stub = stubCreateTask();
    try {
      const provider = createPlaneProvider(MOCK_CONFIG);
      await provider.init();
      await provider.createTask({ projectId: 'proj-uuid', title: 't', description: 'hello\nworld' });
      const body = stub.getBody();
      assert.equal(body.description_html, '<p>hello<br>world</p>');
    } finally {
      stub.restore();
    }
  });
});

describe('PlaneProvider.createTask module placement (Phase 57 module-placement gap-fix)', () => {
  /** @type {import('../src/providers/plane/provider.js')['createPlaneProvider']} */
  let createPlaneProvider;
  beforeEach(async () => {
    ({ createPlaneProvider } = await import('../src/providers/plane/provider.js'));
  });

  /**
   * Stub fetch: labels + states pre-seeded so createTask reaches the work-items POST. The
   * /modules/ GET returns the configured module list; the module-issues POST is captured. Each
   * leg is configurable so the fail-open cases can return an empty module list or a 500.
   *
   * @param {{ modules?: any[], modulesStatus?: number, assocStatus?: number }} [cfg]
   */
  function stubModulePlacement(cfg = {}) {
    const modules = cfg.modules ?? [{ id: 'mod-fvf', name: 'FVF' }];
    const original = globalThis.fetch;
    const calls = { workItemPost: 0, modulesGet: 0, assocPost: 0 };
    let assocBody = null;
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      const method = (init && init.method) || 'GET';
      if (path.endsWith('/labels/') && method === 'GET') {
        return new Response(JSON.stringify({ results: [{ id: 'lbl-adopted', name: 'kodo:adopted' }] }), { status: 200 });
      }
      if (path.endsWith('/states/') && method === 'GET') {
        return new Response(JSON.stringify({ results: [{ id: 'st-trigger', name: 'In Progress', group: 'started' }] }), { status: 200 });
      }
      if (path.endsWith('/work-items/') && method === 'POST') {
        calls.workItemPost++;
        const body = JSON.parse(init.body);
        return new Response(JSON.stringify({ id: 'wi-new', name: body.name, state: 'st-trigger' }), { status: 201 });
      }
      if (path.endsWith('/modules/') && method === 'GET') {
        calls.modulesGet++;
        if (cfg.modulesStatus && cfg.modulesStatus >= 400) {
          return new Response('{"error":"boom"}', { status: cfg.modulesStatus });
        }
        return new Response(JSON.stringify({ results: modules }), { status: 200 });
      }
      if (path.endsWith('/module-issues/') && method === 'POST') {
        calls.assocPost++;
        assocBody = JSON.parse(init.body);
        if (cfg.assocStatus && cfg.assocStatus >= 400) {
          return new Response('{"error":"assoc boom"}', { status: cfg.assocStatus });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }
      throw new Error(`unexpected fetch: ${method} ${path}`);
    };
    return { calls, getAssocBody: () => assocBody, restore: () => { globalThis.fetch = original; } };
  }

  it('resolves module NAME→id via listModules and POSTs module-issues with { issues: [workItemId] }', async () => {
    const stub = stubModulePlacement();
    try {
      const provider = createPlaneProvider(MOCK_CONFIG);
      await provider.init();
      const task = await provider.createTask({ projectId: 'proj-uuid', title: 'adopt me', module: 'FVF' });
      assert.equal(task.id, 'wi-new', 'returns the created task');
      assert.equal(stub.calls.assocPost, 1, 'module-issues POST fired exactly once');
      assert.deepEqual(stub.getAssocBody(), { issues: ['wi-new'] });
    } finally {
      stub.restore();
    }
  });

  it('matches the module name case-insensitively', async () => {
    const stub = stubModulePlacement({ modules: [{ id: 'mod-fvf', name: 'FVF' }] });
    try {
      const provider = createPlaneProvider(MOCK_CONFIG);
      await provider.init();
      await provider.createTask({ projectId: 'proj-uuid', title: 't', module: 'fvf' });
      assert.equal(stub.calls.assocPost, 1, 'case-insensitive name match resolves the module');
      assert.deepEqual(stub.getAssocBody(), { issues: ['wi-new'] });
    } finally {
      stub.restore();
    }
  });

  it('no module arg → never lists modules, never associates (unchanged behavior)', async () => {
    const stub = stubModulePlacement();
    try {
      const provider = createPlaneProvider(MOCK_CONFIG);
      await provider.init();
      stub.calls.modulesGet = 0; // discount the init() module-cache warm-up; count only createTask
      const task = await provider.createTask({ projectId: 'proj-uuid', title: 't' });
      assert.equal(task.id, 'wi-new');
      assert.equal(stub.calls.modulesGet, 0, 'no module → no listModules');
      assert.equal(stub.calls.assocPost, 0, 'no module → no association POST');
    } finally {
      stub.restore();
    }
  });

  it('FAIL-OPEN: module name not found → still returns the created task (no throw, no assoc)', async () => {
    const stub = stubModulePlacement({ modules: [{ id: 'mod-other', name: 'Other' }] });
    try {
      const provider = createPlaneProvider(MOCK_CONFIG);
      await provider.init();
      stub.calls.modulesGet = 0; // discount the init() module-cache warm-up; count only createTask
      const task = await provider.createTask({ projectId: 'proj-uuid', title: 't', module: 'FVF' });
      assert.equal(task.id, 'wi-new', 'work item still returned despite unresolvable module');
      assert.equal(stub.calls.modulesGet, 1, 'attempted to resolve the module name');
      assert.equal(stub.calls.assocPost, 0, 'no association when the name does not resolve');
    } finally {
      stub.restore();
    }
  });

  it('FAIL-OPEN: module-issues POST 500 → still returns the created task (no throw)', async () => {
    const stub = stubModulePlacement({ assocStatus: 500 });
    try {
      const provider = createPlaneProvider(MOCK_CONFIG);
      await provider.init();
      const task = await provider.createTask({ projectId: 'proj-uuid', title: 't', module: 'FVF' });
      assert.equal(task.id, 'wi-new', 'a failed association must NOT downgrade the created task');
      assert.equal(stub.calls.assocPost, 1, 'attempted the association once');
    } finally {
      stub.restore();
    }
  });

  it('FAIL-OPEN: listModules 500 → still returns the created task (no throw)', async () => {
    const stub = stubModulePlacement({ modulesStatus: 500 });
    try {
      const provider = createPlaneProvider(MOCK_CONFIG);
      await provider.init();
      const task = await provider.createTask({ projectId: 'proj-uuid', title: 't', module: 'FVF' });
      assert.equal(task.id, 'wi-new', 'a failed module list must NOT downgrade the created task');
      assert.equal(stub.calls.assocPost, 0, 'never reached the association POST');
    } finally {
      stub.restore();
    }
  });
});

describe('PlaneClient.addWorkItemToModule (Phase 57 module-placement gap-fix)', () => {
  /** @type {import('../src/providers/plane/client.js')['PlaneClient']} */
  let PlaneClient;
  beforeEach(async () => {
    ({ PlaneClient } = await import('../src/providers/plane/client.js'));
  });
  const CLIENT_OPTS = { baseUrl: 'https://test.example.com', apiKey: 'test-key', workspaceSlug: 'test' };

  it('POSTs /modules/<id>/module-issues/ with { issues: [workItemId] }', async () => {
    const original = globalThis.fetch;
    let captured = null;
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      const method = (init && init.method) || 'GET';
      assert.equal(method, 'POST');
      assert.ok(path.endsWith('/projects/proj-uuid/modules/mod-1/module-issues/'), `path was ${path}`);
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    };
    try {
      const client = new PlaneClient(CLIENT_OPTS);
      await client.addWorkItemToModule('proj-uuid', 'mod-1', 'wi-7');
      assert.deepEqual(captured, { issues: ['wi-7'] });
    } finally {
      globalThis.fetch = original;
    }
  });
});
