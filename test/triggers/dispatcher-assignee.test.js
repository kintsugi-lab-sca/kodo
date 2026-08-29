// @ts-check
//
// KODO-58 — el gate multi-operador del dispatcher.
//
// HOME aislado ANTES de cualquier dynamic import, por la misma razón que
// dispatcher.test.js: el wrapper de auditoría escribe `dispatch.decision` en
// `~/.kodo/logs/dispatch.ndjson`, y sin aislar contaminaría la traza real del operador.
// Aquí además importa para el CONFIG: sin `~/.kodo/config.json` en el HOME temporal,
// `loadConfig()` devuelve los defaults — que es justo el escenario que queremos ejercer
// (`dispatch.require_assignee: true`).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.HOME = mkdtempSync(join(tmpdir(), 'kodo-assignee-test-'));

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const ME = 'da60ae01-2464-40da-857d-5aeb558bd881';
const OTHER = '78469dc1-bab7-4d26-8b55-a67002e3edb8';

/** Sesión que `launchWorkItemFn` devuelve cuando el dispatch llega hasta el final. */
const FAKE_SESSION = {
  workspace_ref: 'workspace:1',
  session_id: 'sess-1',
  task_id: 'task-uuid-1',
  task_ref: 'KL-42',
  provider: 'test',
  project_id: 'proj-1',
  summary: 'Test task',
  status: 'running',
  started_at: new Date().toISOString(),
  project_path: '/tmp/test',
};

/**
 * Provider falso con identidad. `getOperator` es el método OPCIONAL que el gate detecta
 * con `typeof`; omitirlo (operator=null) deja el gate inerte a propósito.
 *
 * @param {{ assignees?: any, operator?: string|null }} opts
 */
function fakeProvider({ assignees, operator = ME }) {
  const provider = {
    init: async () => {},
    getTask: async () => ({
      id: 'task-uuid-1',
      ref: 'KL-42',
      title: 'Test task',
      description: 'desc',
      labels: ['kodo'],
      projectId: 'proj-1',
      projectName: 'Test Project',
      groups: [],
      url: 'https://example.com/KL-42',
      priority: 'medium',
      assignees,
    }),
    updateTaskState: async () => {},
    addComment: async () => {},
    listPendingTasks: async () => [],
    parseTriggerEvent: () => null,
    verifySignature: () => true,
    resolveRef: async () => '',
  };
  if (operator) {
    // @ts-ignore — método opcional, fuera de TASK_PROVIDER_METHODS (FROZEN at 9).
    provider.getOperator = () => ({ id: operator, display_name: 'yo' });
  }
  return provider;
}

/** Deps mínimas para que el camino feliz llegue a `launchWorkItemFn` sin tocar nada real. */
function makeDeps(provider, launched) {
  return {
    getProviderFn: () => provider,
    launchWorkItemFn: async () => {
      launched.push(true);
      return FAKE_SESSION;
    },
    listSessionsFn: () => [],
    listWorkspacesFn: () => '',
    removeSessionFn: () => ({ ok: true }),
    resolveProjectPathFn: () => '/tmp/test',
    // `false` = no hay worktree previo para esta tarea → sin colisión, el dispatch llega
    // al launch. Con `true` el veredicto sería `worktree_collision` y este fichero no
    // estaría midiendo el gate de KODO-58.
    existsSyncFn: () => false,
    acquireLockFn: () => 'token',
    releaseLockFn: () => {},
    startLockHeartbeatFn: () => () => {},
    dispatchLockDir: mkdtempSync(join(tmpdir(), 'kodo-assignee-locks-')),
    _logger: null, // audit desactivado: este test mide el veredicto, no la traza
  };
}

const EVENT = { taskRef: 'KL-42', action: 'state_change', provider: 'test', raw: {} };

describe('KODO-58: gate multi-operador del dispatcher', () => {
  /** @type {boolean[]} */
  let launched;
  beforeEach(() => {
    launched = [];
  });

  it('tarea asignada a OTRO operador → ignored con motivo, y NO se lanza nada', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const result = await dispatchTrigger(
      EVENT,
      {},
      makeDeps(fakeProvider({ assignees: [OTHER] }), launched),
    );
    assert.equal(result.action, 'ignored');
    assert.equal(result.code, 'assigned_to_other');
    assert.deepEqual(launched, [], 'no debe lanzarse ninguna sesión');
  });

  it('tarea asignada a MÍ → se lanza', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const result = await dispatchTrigger(
      EVENT,
      {},
      makeDeps(fakeProvider({ assignees: [ME] }), launched),
    );
    assert.equal(result.action, 'launched');
    assert.deepEqual(launched, [true]);
  });

  it('tarea asignada a MÍ y a otro → se lanza (el reparto no es exclusivo)', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const result = await dispatchTrigger(
      EVENT,
      {},
      makeDeps(fakeProvider({ assignees: [OTHER, ME] }), launched),
    );
    assert.equal(result.action, 'launched');
  });

  it('tarea SIN asignado → skipped con log `dispatch.skipped reason=unassigned`', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const lines = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    let result;
    try {
      result = await dispatchTrigger(EVENT, {}, makeDeps(fakeProvider({ assignees: [] }), launched));
    } finally {
      console.log = originalLog;
    }
    assert.equal(result.action, 'ignored');
    assert.equal(result.code, 'unassigned');
    assert.deepEqual(launched, []);
    assert.ok(
      lines.some((l) => l.includes('dispatch.skipped reason=unassigned')),
      `falta la línea de log; se vio: ${JSON.stringify(lines)}`,
    );
  });

  it('--force lanza igual una tarea de otro operador (orden explícita de un humano)', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const result = await dispatchTrigger(
      EVENT,
      { force: true },
      makeDeps(fakeProvider({ assignees: [OTHER] }), launched),
    );
    assert.equal(result.action, 'launched');
    assert.deepEqual(launched, [true]);
  });

  it('--force lanza igual una tarea sin asignado', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const result = await dispatchTrigger(
      EVENT,
      { force: true },
      makeDeps(fakeProvider({ assignees: [] }), launched),
    );
    assert.equal(result.action, 'launched');
  });

  it('provider SIN getOperator → gate inerte, se lanza como antes de KODO-58', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const result = await dispatchTrigger(
      EVENT,
      {},
      makeDeps(fakeProvider({ assignees: [OTHER], operator: null }), launched),
    );
    assert.equal(result.action, 'launched', 'sin identidad conocida el filtro debe ser fail-open');
  });

  it('el gate corre DESPUÉS del cleanup de estado terminal: una tarea de otro que se cierra sigue limpiando su sesión local', async () => {
    // Escenario real: lancé la tarea, alguien la reasignó y la cerró. Si el gate cortase
    // antes del bloque 2b, la fila se quedaría colgada en state.json para siempre.
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const provider = fakeProvider({ assignees: [OTHER] });
    const original = provider.getTask;
    // 'Cancelled' es terminal para CUALQUIER provider (está cableado junto al
    // `states.done` configurado); el provider ficticio 'test' no tiene bloque de estados
    // en config, así que 'Done' aquí no lo sería.
    provider.getTask = async () => ({ ...(await original()), state: 'Cancelled' });

    const removed = [];
    const deps = makeDeps(provider, launched);
    deps.listSessionsFn = () => [{ task_id: 'task-uuid-1', task_ref: 'KL-42' }];
    deps.removeSessionFn = (id) => {
      removed.push(id);
      return { ok: true };
    };

    const result = await dispatchTrigger(EVENT, {}, deps);
    assert.equal(result.action, 'cleaned');
    assert.deepEqual(removed, ['task-uuid-1'], 'la limpieza local NO puede depender del asignado');
  });
});

// El caso `dispatch.require_assignee: false` vive en su propio fichero
// (dispatcher-assignee-off.test.js): `config.js` cachea `KODO_DIR` al import, así que un
// config distinto exige un HOME fijado ANTES del primer import — no se puede conmutar a
// mitad de fichero.
