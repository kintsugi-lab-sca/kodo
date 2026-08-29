// @ts-check
//
// KODO-58 — `kodo check` no cuenta como pendientes las tareas de otro operador.
//
// Este test cablea el provider REAL de Plane (con `fetch` stubbeado) dentro de
// `checkPendingTasks`. Es a propósito: el recorte por operador vive en
// `listPendingTasks`, que es el ÚNICO camino de lectura de pendientes del repo
// (`kodo check` y el `/status` del servidor convergen ahí vía `fetchFreshPending`).
// Un test con un provider de mentira solo demostraría que el doble se comporta como el
// doble; con el provider real demuestra el criterio de éxito de verdad.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'kodo-check-assignee-'));
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

// DINÁMICO: ver la nota de test/config-operator-cache.test.js — un import estático se
// evalúa antes de que el HOME temporal esté puesto, y el constructor de PlaneClient lee
// `loadConfig()`.
const { checkPendingTasks } = await import('../src/check.js');
const { createPlaneProvider } = await import('../src/providers/plane/provider.js');

const ME = 'da60ae01-2464-40da-857d-5aeb558bd881';
const OTHER = '78469dc1-bab7-4d26-8b55-a67002e3edb8';
const PROJECT = 'proj-uuid';
const TRIGGER_STATE = 'state-in-progress';

const PROVIDER_CONFIG = {
  baseUrl: 'https://plane.test',
  webUrl: 'https://plane.test',
  apiKey: 'test-key',
  workspaceSlug: 'test',
  projects: [{ id: PROJECT, identifier: 'TST', name: 'Test' }],
  states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
};

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

function stubFetch(items) {
  const routes = {
    '/users/me/': () => ({ id: ME, display_name: 'alex' }),
    '/projects/': () => ({ results: [{ id: PROJECT, identifier: 'TST', name: 'Test' }] }),
    '/labels/': () => ({ results: [{ id: 'label-kodo', name: 'kodo' }] }),
    '/states/': () => ({ results: [{ id: TRIGGER_STATE, name: 'In Progress', group: 'started' }] }),
    '/modules/': () => ({ results: [] }),
    '/work-items/': () => ({ results: items }),
  };
  const original = globalThis.fetch;
  // @ts-ignore — override deliberado y acotado al test.
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    const matched = Object.keys(routes).find((suffix) => path.endsWith(suffix));
    if (!matched) throw new Error(`plane stub miss: ${path}`);
    return new Response(JSON.stringify(routes[matched]()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return () => { globalThis.fetch = original; };
}

/** Formatter no-color, para que las líneas se puedan asertar por substring. */
const plainFormatter = () => ({
  yellow: (s) => s,
  red: (s) => s,
  ok: (s) => s,
  dim: (s) => s,
  error: (s) => s,
});

const CHECK_CONFIG = { provider: 'plane', claude: { max_parallel: 3 } };

describe('KODO-58: kodo check y las tareas de otro operador', () => {
  /** @type {(() => void)|null} */
  let restore = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('con 1 mía y 2 de otros, cuenta 1 pendiente — no 3', async () => {
    restore = stubFetch([workItem(1, [ME]), workItem(2, [OTHER]), workItem(3, [])]);
    const provider = createPlaneProvider(PROVIDER_CONFIG);

    const { lines, reasons } = await checkPendingTasks({
      config: CHECK_CONFIG,
      runningCount: 0,
      activeSessions: [],
      getProviderFn: () => provider,
      formatterFn: plainFormatter,
    });

    assert.equal(reasons.length, 1);
    assert.ok(lines[0].includes('1 pending kodo task(s)'), `línea inesperada: ${lines[0]}`);
  });

  it('si TODAS son de otros, no hay pendientes y el orquestador no se despierta', async () => {
    restore = stubFetch([workItem(2, [OTHER]), workItem(3, [])]);
    const provider = createPlaneProvider(PROVIDER_CONFIG);

    const { lines, reasons } = await checkPendingTasks({
      config: CHECK_CONFIG,
      runningCount: 0,
      activeSessions: [],
      getProviderFn: () => provider,
      formatterFn: plainFormatter,
    });

    assert.deepEqual(reasons, [], 'ninguna razón para despertar al orquestador');
    assert.deepEqual(lines, []);
  });
});
