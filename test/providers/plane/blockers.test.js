// @ts-check
//
// KODO-73 — `listBlockers` del provider de Plane.
//
// HOME aislado ANTES del primer import de config.js: el constructor de `PlaneClient`
// llama a `loadConfig()` aunque le pasemos baseUrl/apiKey explícitos, y sin aislar
// leería el `~/.kodo/config.json` real del operador.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.HOME = mkdtempSync(join(tmpdir(), 'kodo-blockers-home-'));

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/** @type {import('../../../src/providers/plane/provider.js')['createPlaneProvider']} */
let createPlaneProvider;

const PROJ = 'proj-uuid';
const OTHER_PROJ = 'other-proj-uuid';

const MOCK_CONFIG = {
  baseUrl: 'https://test.example.com',
  apiKey: 'test-key',
  workspaceSlug: 'test',
  projects: [{ id: PROJ, identifier: 'TST', name: 'Test' }],
  states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
};

const TASK = { id: 'task-uuid', ref: 'TST-42', projectId: PROJ };

const STATES = [
  { id: 'st-todo', name: 'Todo', group: 'unstarted' },
  { id: 'st-backlog', name: 'Backlog', group: 'backlog' },
  { id: 'st-done', name: 'Done', group: 'completed' },
];

/**
 * Stub de `globalThis.fetch` con tabla de rutas. FAIL-LOUD ante path no cubierto: un
 * `{}` por defecto escondería una llamada que el provider hace y el test no modela.
 *
 * @param {Record<string, any>} routes - path exacto (sin host) → body de respuesta.
 */
function stubFetch(routes) {
  const original = globalThis.fetch;
  /** @type {string[]} */
  const calls = [];
  // @ts-ignore — override acotado al caller.
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const match = Object.keys(routes).find((p) => path.endsWith(p));
    if (!match) throw new Error(`plane stub miss: ${path}`);
    return new Response(JSON.stringify(routes[match]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Relaciones vacías salvo lo que se pase — Plane siempre devuelve las ocho listas. */
function relations(overrides = {}) {
  return {
    blocking: [],
    blocked_by: [],
    duplicate: [],
    relates_to: [],
    start_after: [],
    start_before: [],
    finish_after: [],
    finish_before: [],
    ...overrides,
  };
}

describe('KODO-73: PlaneProvider.listBlockers', () => {
  /** @type {{ calls: string[], restore: () => void }|null} */
  let stub = null;

  beforeEach(async () => {
    ({ createPlaneProvider } = await import('../../../src/providers/plane/provider.js'));
  });

  afterEach(() => {
    stub?.restore();
    stub = null;
  });

  it('es un método OPCIONAL presente en el provider de Plane', () => {
    const provider = createPlaneProvider(MOCK_CONFIG);
    assert.equal(typeof provider.listBlockers, 'function');
  });

  it('sin blocked_by → [] y UNA sola llamada (el caso dominante no paga bucle)', async () => {
    stub = stubFetch({
      [`/work-items/${TASK.id}/relations/`]: relations({
        relates_to: [{ project_id: PROJ, issue_id: 'other-uuid' }],
      }),
    });
    const provider = createPlaneProvider(MOCK_CONFIG);
    const blockers = await provider.listBlockers(TASK);
    assert.deepEqual(blockers, []);
    assert.equal(stub.calls.length, 1, `esperaba 1 llamada, hubo: ${stub.calls.join(' | ')}`);
  });

  it('resuelve ref y estado normalizado de cada bloqueador', async () => {
    stub = stubFetch({
      [`/work-items/${TASK.id}/relations/`]: relations({
        blocked_by: [
          { project_id: PROJ, issue_id: 'blk-open' },
          { project_id: PROJ, issue_id: 'blk-closed' },
        ],
      }),
      '/work-items/blk-open/': {
        id: 'blk-open',
        sequence_id: 7,
        state: 'st-todo',
        project_detail: { id: PROJ, identifier: 'TST' },
      },
      '/work-items/blk-closed/': {
        id: 'blk-closed',
        sequence_id: 8,
        state: 'st-done',
        project_detail: { id: PROJ, identifier: 'TST' },
      },
      '/states/': { results: STATES },
    });
    const provider = createPlaneProvider(MOCK_CONFIG);
    const blockers = await provider.listBlockers(TASK);
    assert.deepEqual(blockers, [
      { id: 'blk-open', ref: 'TST-7', state: 'in_progress' },
      { id: 'blk-closed', ref: 'TST-8', state: 'done' },
    ]);
  });

  // El provider TRADUCE, no decide: devuelve también los cerrados. Filtrar es política,
  // y la política vive en src/blockers.js.
  it('devuelve también los bloqueadores cerrados — filtrar es de la regla, no del provider', async () => {
    stub = stubFetch({
      [`/work-items/${TASK.id}/relations/`]: relations({
        blocked_by: [{ project_id: PROJ, issue_id: 'blk-closed' }],
      }),
      '/work-items/blk-closed/': {
        id: 'blk-closed',
        sequence_id: 8,
        state: 'st-done',
        project_detail: { id: PROJ, identifier: 'TST' },
      },
      '/states/': { results: STATES },
    });
    const provider = createPlaneProvider(MOCK_CONFIG);
    const blockers = await provider.listBlockers(TASK);
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0].state, 'done');
  });

  it('un bloqueador en Backlog mapea a "unknown" (que la regla trata como abierto)', async () => {
    stub = stubFetch({
      [`/work-items/${TASK.id}/relations/`]: relations({
        blocked_by: [{ project_id: PROJ, issue_id: 'blk-bl' }],
      }),
      '/work-items/blk-bl/': {
        id: 'blk-bl',
        sequence_id: 3,
        state: 'st-backlog',
        project_detail: { id: PROJ, identifier: 'TST' },
      },
      '/states/': { results: STATES },
    });
    const provider = createPlaneProvider(MOCK_CONFIG);
    const [blocker] = await provider.listBlockers(TASK);
    assert.equal(blocker.state, 'unknown');
  });

  // Un bloqueador puede vivir en otro proyecto: la relación trae su project_id y hay que
  // usar ESE, no el de la tarea (si no, el GET pega al proyecto equivocado).
  it('usa el project_id de la RELACIÓN para un bloqueador de otro proyecto', async () => {
    stub = stubFetch({
      [`/work-items/${TASK.id}/relations/`]: relations({
        blocked_by: [{ project_id: OTHER_PROJ, issue_id: 'blk-x' }],
      }),
      '/work-items/blk-x/': {
        id: 'blk-x',
        sequence_id: 5,
        state: 'st-todo',
        project_detail: { id: OTHER_PROJ, identifier: 'OTR' },
      },
      '/states/': { results: STATES },
    });
    const provider = createPlaneProvider(MOCK_CONFIG);
    const [blocker] = await provider.listBlockers(TASK);
    assert.equal(blocker.ref, 'OTR-5');
    assert.ok(
      stub.calls.some((p) => p.includes(`/projects/${OTHER_PROJ}/work-items/blk-x/`)),
      `debía leer el bloqueador bajo su propio proyecto; llamadas: ${stub.calls.join(' | ')}`,
    );
  });

  it('sin identifier resoluble cae al UUID en vez de publicar un ref falso', async () => {
    stub = stubFetch({
      [`/work-items/${TASK.id}/relations/`]: relations({
        blocked_by: [{ project_id: OTHER_PROJ, issue_id: 'blk-x' }],
      }),
      '/work-items/blk-x/': { id: 'blk-x', sequence_id: 5, state: 'st-todo' },
      '/states/': { results: STATES },
    });
    const provider = createPlaneProvider(MOCK_CONFIG);
    const [blocker] = await provider.listBlockers(TASK);
    assert.equal(blocker.ref, 'blk-x');
  });

  // FALLO PARCIAL. Un bloqueador ilegible (borrado → 404, proyecto sin permiso → 403) no
  // puede tirar el gate entero al fail-open: la relación existe, el tablero afirmó el
  // bloqueo. Entra como `unknown`, que la regla trata como ABIERTO, y los bloqueadores
  // legibles se siguen resolviendo con normalidad.
  it('un bloqueador ilegible entra como "unknown" sin arrastrar a los demás', async () => {
    const original = globalThis.fetch;
    // @ts-ignore — override acotado al caller.
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      const json = (body) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (path.endsWith(`/work-items/${TASK.id}/relations/`)) {
        return json(
          relations({
            blocked_by: [
              { project_id: PROJ, issue_id: 'blk-gone' },
              { project_id: PROJ, issue_id: 'blk-open' },
            ],
          }),
        );
      }
      // El borrado: 404 permanente, no un fallo transitorio de transporte.
      if (path.endsWith('/work-items/blk-gone/')) {
        return new Response('{"error":"not found"}', { status: 404 });
      }
      if (path.endsWith('/work-items/blk-open/')) {
        return json({
          id: 'blk-open',
          sequence_id: 7,
          state: 'st-todo',
          project_detail: { id: PROJ, identifier: 'TST' },
        });
      }
      if (path.endsWith('/states/')) return json({ results: STATES });
      throw new Error(`plane stub miss: ${path}`);
    };
    stub = { calls: [], restore: () => { globalThis.fetch = original; } };

    const provider = createPlaneProvider(MOCK_CONFIG);
    const blockers = await provider.listBlockers(TASK);

    assert.deepEqual(blockers, [
      { id: 'blk-gone', ref: 'blk-gone', state: 'unknown' },
      { id: 'blk-open', ref: 'TST-7', state: 'in_progress' },
    ]);
  });

  it('si TODOS los bloqueadores son ilegibles, siguen contando como abiertos', async () => {
    const original = globalThis.fetch;
    // @ts-ignore — override acotado al caller.
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith(`/work-items/${TASK.id}/relations/`)) {
        return new Response(
          JSON.stringify(relations({ blocked_by: [{ project_id: PROJ, issue_id: 'blk-gone' }] })),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{"error":"forbidden"}', { status: 403 });
    };
    stub = { calls: [], restore: () => { globalThis.fetch = original; } };

    const provider = createPlaneProvider(MOCK_CONFIG);
    const blockers = await provider.listBlockers(TASK);
    // Lo que NO debe pasar: lanzar por rechazo (fail-open) cuando el tablero declara
    // un bloqueo que simplemente no podemos leer.
    assert.deepEqual(blockers, [{ id: 'blk-gone', ref: 'blk-gone', state: 'unknown' }]);
  });

  it('los errores de /relations/ PROPAGAN — el fail-open lo decide el gate del dispatcher', async () => {
    const original = globalThis.fetch;
    // 404, no un throw: un error de transporte dispararía el retry con backoff del
    // cliente y este test tardaría segundos en comprobar algo que no es el retry.
    // @ts-ignore — override acotado.
    globalThis.fetch = async () => new Response('{"error":"nope"}', { status: 404 });
    stub = { calls: [], restore: () => { globalThis.fetch = original; } };
    const provider = createPlaneProvider(MOCK_CONFIG);
    await assert.rejects(() => provider.listBlockers(TASK), /Plane API 404/);
  });
});
