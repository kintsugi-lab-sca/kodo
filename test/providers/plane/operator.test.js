// @ts-check
//
// KODO-58 — identidad del operador en el provider de Plane: resolución, caché y el
// recorte de `listPendingTasks`.
//
// HOME aislado antes de importar nada: config.js cachea KODO_DIR al import y el
// provider construye un PlaneClient, que lee config en su constructor.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'kodo-plane-operator-'));
process.env.HOME = HOME;
mkdirSync(join(HOME, '.kodo'), { recursive: true });
writeFileSync(
  join(HOME, '.kodo', 'config.json'),
  JSON.stringify(
    {
      provider: 'plane',
      providers: {
        plane: {
          base_url: 'https://plane.test',
          api_key_env: 'KODO_TEST_PLANE_KEY',
          workspace_slug: 'test',
          projects: [],
          states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
        },
      },
    },
    null,
    2,
  ) + '\n',
);
process.env.KODO_TEST_PLANE_KEY = 'test-key';

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// DINÁMICO: los imports estáticos se evalúan antes del cuerpo del módulo, y el
// constructor de PlaneClient llama a `loadConfig()` — con un import estático leería el
// `~/.kodo/config.json` REAL del operador en vez del HOME temporal de arriba.
const { createPlaneProvider } = await import('../../../src/providers/plane/provider.js');

const ME = 'da60ae01-2464-40da-857d-5aeb558bd881';
const OTHER = '78469dc1-bab7-4d26-8b55-a67002e3edb8';
const PROJECT = 'proj-uuid';

const BASE_CONFIG = {
  baseUrl: 'https://plane.test',
  webUrl: 'https://plane.test',
  apiKey: 'test-key',
  workspaceSlug: 'test',
  projects: [{ id: PROJECT, identifier: 'TST', name: 'Test' }],
  states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
};

const TRIGGER_STATE = 'state-in-progress';

/** Work item crudo en el estado trigger, con `kodo` puesta. */
function workItem(sequenceId, assignees) {
  return {
    id: `wi-${sequenceId}`,
    name: `Task ${sequenceId}`,
    description_html: '',
    state: TRIGGER_STATE,
    priority: 'medium',
    labels: ['label-kodo'],
    project: PROJECT,
    project_detail: { id: PROJECT, name: 'Test', identifier: 'TST' },
    sequence_id: sequenceId,
    assignees,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

/**
 * Stub de fetch por sufijo de path. Devuelve el contador de llamadas por ruta para poder
 * afirmar «no se volvió a preguntar por la identidad».
 * @param {Record<string, () => any>} routes
 */
function stubFetch(routes) {
  const original = globalThis.fetch;
  /** @type {Record<string, number>} */
  const calls = {};
  // @ts-ignore — override deliberado y acotado al test.
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    const matched = Object.keys(routes).find((suffix) => path.endsWith(suffix));
    if (!matched) throw new Error(`plane stub miss: ${path}`);
    calls[matched] = (calls[matched] || 0) + 1;
    return new Response(JSON.stringify(routes[matched]()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Rutas mínimas que `init()` + `listPendingTasks()` necesitan. */
function baseRoutes(items, me = { id: ME, display_name: 'alex' }) {
  return {
    '/users/me/': () => me,
    '/projects/': () => ({ results: [{ id: PROJECT, identifier: 'TST', name: 'Test' }] }),
    '/labels/': () => ({ results: [{ id: 'label-kodo', name: 'kodo' }] }),
    '/states/': () => ({
      results: [{ id: TRIGGER_STATE, name: 'In Progress', group: 'started' }],
    }),
    '/modules/': () => ({ results: [] }),
    '/work-items/': () => ({ results: items }),
  };
}

describe('KODO-58: identidad del operador (provider Plane)', () => {
  /** @type {{ restore: () => void }|null} */
  let stub = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
  });

  it('init() resuelve /users/me y lo persiste vía persistOperatorFn', async () => {
    stub = stubFetch(baseRoutes([]));
    const persisted = [];
    const provider = createPlaneProvider(BASE_CONFIG, {
      persistOperatorFn: (op) => persisted.push(op),
    });
    await provider.init();

    assert.deepEqual(provider.getOperator(), { id: ME, display_name: 'alex' });
    assert.deepEqual(persisted, [{ id: ME, display_name: 'alex' }]);
  });

  it('con identidad YA cacheada en config, init() NO llama a /users/me (cero red en régimen permanente)', async () => {
    stub = stubFetch(baseRoutes([]));
    const provider = createPlaneProvider(
      { ...BASE_CONFIG, operator: { id: ME, display_name: 'alex' } },
      { persistOperatorFn: () => assert.fail('no debe reescribir una caché que ya vale') },
    );
    await provider.init();

    assert.equal(stub.calls['/users/me/'], undefined, '/users/me no debió llamarse');
    assert.deepEqual(provider.getOperator(), { id: ME, display_name: 'alex' });
  });

  it('FAIL-OPEN: si /users/me falla, init() sigue adelante y la identidad queda en null', async () => {
    stub = stubFetch({ ...baseRoutes([]), '/users/me/': () => { throw new Error('boom'); } });
    const provider = createPlaneProvider(BASE_CONFIG);
    await provider.init(); // no debe lanzar
    assert.equal(provider.getOperator(), null);
  });

  it('refreshOperator() SÍ vuelve a preguntar aunque haya caché (es el camino de `kodo doctor --operator`)', async () => {
    stub = stubFetch(baseRoutes([], { id: OTHER, display_name: 'edanray' }));
    const persisted = [];
    const provider = createPlaneProvider(
      { ...BASE_CONFIG, operator: { id: ME, display_name: 'alex' } },
      { persistOperatorFn: (op) => persisted.push(op) },
    );
    const refreshed = await provider.refreshOperator();

    assert.deepEqual(refreshed, { id: OTHER, display_name: 'edanray' });
    assert.deepEqual(persisted, [{ id: OTHER, display_name: 'edanray' }]);
    assert.equal(stub.calls['/users/me/'], 1);
  });

  it('getOperator() devuelve una COPIA: mutarla no corrompe el estado del provider', async () => {
    stub = stubFetch(baseRoutes([]));
    const provider = createPlaneProvider(BASE_CONFIG);
    await provider.init();
    const op = provider.getOperator();
    op.id = 'mutado';
    assert.equal(provider.getOperator().id, ME);
  });
});

describe('KODO-58: listPendingTasks recorta por operador', () => {
  /** @type {{ restore: () => void }|null} */
  let stub = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
  });

  it('deja las mías y descarta las de otro y las sin asignado', async () => {
    stub = stubFetch(
      baseRoutes([
        workItem(1, [ME]),
        workItem(2, [OTHER]),
        workItem(3, []),
        workItem(4, [OTHER, ME]),
      ]),
    );
    const provider = createPlaneProvider(BASE_CONFIG);
    await provider.init();
    const pending = await provider.listPendingTasks();

    assert.deepEqual(pending.map((t) => t.ref), ['TST-1', 'TST-4']);
  });

  it('require_assignee:false devuelve todas las dispatchables (comportamiento previo)', async () => {
    stub = stubFetch(
      baseRoutes([workItem(1, [ME]), workItem(2, [OTHER]), workItem(3, [])]),
    );
    const provider = createPlaneProvider({ ...BASE_CONFIG, requireAssignee: false });
    await provider.init();
    const pending = await provider.listPendingTasks();

    assert.deepEqual(pending.map((t) => t.ref), ['TST-1', 'TST-2', 'TST-3']);
  });

  it('sin identidad conocida devuelve todas (fail-open, igual que el gate del dispatcher)', async () => {
    stub = stubFetch({
      ...baseRoutes([workItem(1, [ME]), workItem(2, [OTHER])]),
      '/users/me/': () => { throw new Error('down'); },
    });
    const provider = createPlaneProvider(BASE_CONFIG);
    await provider.init();
    const pending = await provider.listPendingTasks();

    assert.deepEqual(pending.map((t) => t.ref), ['TST-1', 'TST-2']);
  });
});
