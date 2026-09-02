// @ts-check
//
// KODO-73 — el gate de bloqueos del dispatcher.
//
// HOME aislado ANTES de cualquier dynamic import, por la misma razón que
// dispatcher-assignee.test.js: el wrapper de auditoría escribe `dispatch.decision` en
// `~/.kodo/logs/dispatch.ndjson`, y sin `~/.kodo/config.json` en el HOME temporal
// `loadConfig()` devuelve los defaults — que es justo el escenario a ejercer
// (`dispatch.respect_blockers: true`).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.HOME = mkdtempSync(join(tmpdir(), 'kodo-blockers-test-'));

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { forgetAnnouncedBlock } from '../../src/blockers.js';

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

const TASK = {
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
  // Sin identidad de operador el gate 2c queda inerte (fail-open), así que este fichero
  // mide SOLO el gate de bloqueos.
  assignees: [],
};

/**
 * Provider falso. `listBlockers` es el método OPCIONAL que el gate detecta con `typeof`;
 * pasar `blockers: null` lo omite y deja el gate inerte a propósito.
 *
 * @param {{ blockers?: any[]|null, throws?: Error, commentThrows?: Error }} opts
 */
function fakeProvider({ blockers, throws, commentThrows } = {}) {
  /** @type {string[]} */
  const comments = [];
  /** @type {number} */
  let probes = 0;
  const provider = {
    init: async () => {},
    getTask: async () => ({ ...TASK }),
    updateTaskState: async () => {},
    addComment: async (_task, text) => {
      if (commentThrows) throw commentThrows;
      comments.push(text);
    },
    listPendingTasks: async () => [],
    parseTriggerEvent: () => null,
    verifySignature: () => true,
    resolveRef: async () => '',
    listProjects: async () => [],
  };
  if (blockers !== null && blockers !== undefined) {
    // @ts-ignore — método opcional, fuera de TASK_PROVIDER_METHODS (FROZEN at 9).
    provider.listBlockers = async () => {
      probes++;
      if (throws) throw throws;
      return blockers;
    };
  }
  return {
    provider,
    comments,
    probeCount: () => probes,
  };
}

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
    existsSyncFn: () => false,
    acquireLockFn: () => ({ token: 'token' }),
    releaseLockFn: () => {},
    startLockHeartbeatFn: () => () => {},
    dispatchLockDir: mkdtempSync(join(tmpdir(), 'kodo-blockers-locks-')),
    _logger: null, // audit desactivado: este test mide el veredicto, no la traza
  };
}

const EVENT = { taskRef: 'KL-42', action: 'state_change', provider: 'test', raw: {} };

const OPEN = [{ id: 'blk-1', ref: 'KL-7', state: 'in_progress' }];
const CLOSED = [{ id: 'blk-1', ref: 'KL-7', state: 'done' }];

describe('KODO-73: gate de bloqueos del dispatcher', () => {
  /** @type {boolean[]} */
  let launched;
  beforeEach(() => {
    launched = [];
    forgetAnnouncedBlock();
  });

  // ── Criterio de aceptación 1 ───────────────────────────────────────────────
  it('tarea con blocked_by ABIERTO → no arranca sesión y deja constancia del motivo', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const { provider, comments } = fakeProvider({ blockers: OPEN });
    const result = await dispatchTrigger(EVENT, {}, makeDeps(provider, launched));

    assert.equal(result.action, 'ignored');
    assert.equal(result.code, 'blocked_by_open');
    assert.equal(result.detail, 'KL-7');
    assert.deepEqual(launched, [], 'no debe lanzarse ninguna sesión');
    assert.equal(comments.length, 1, 'debe dejar constancia en la tarea');
    assert.match(comments[0], /KL-7/);
  });

  it('todos los bloqueadores cerrados → se lanza, sin comentar nada', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const { provider, comments } = fakeProvider({ blockers: CLOSED });
    const result = await dispatchTrigger(EVENT, {}, makeDeps(provider, launched));

    assert.equal(result.action, 'launched');
    assert.deepEqual(launched, [true]);
    assert.deepEqual(comments, []);
  });

  it('sin relaciones → se lanza', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const { provider } = fakeProvider({ blockers: [] });
    const result = await dispatchTrigger(EVENT, {}, makeDeps(provider, launched));
    assert.equal(result.action, 'launched');
  });

  // ── Criterio de aceptación 2 ───────────────────────────────────────────────
  it('provider SIN la capacidad → path idéntico al actual, y ni se consulta', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const { provider, probeCount } = fakeProvider({ blockers: null });
    assert.equal(typeof provider.listBlockers, 'undefined', 'el fake no debe declarar la capacidad');

    const result = await dispatchTrigger(EVENT, {}, makeDeps(provider, launched));
    assert.equal(result.action, 'launched');
    assert.deepEqual(launched, [true]);
    assert.equal(probeCount(), 0);
  });

  // ── Fail-open ──────────────────────────────────────────────────────────────
  it('si listBlockers revienta, se lanza igual (un /relations/ caído no para el daemon)', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const { provider, comments } = fakeProvider({
      blockers: OPEN,
      throws: new Error('boom'),
    });
    const result = await dispatchTrigger(EVENT, {}, makeDeps(provider, launched));
    assert.equal(result.action, 'launched');
    assert.deepEqual(comments, [], 'no se comenta un bloqueo que no se ha podido leer');
  });

  // ── --force ────────────────────────────────────────────────────────────────
  it('--force salta el gate: una orden humana explícita manda sobre el bloqueo', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const { provider, probeCount } = fakeProvider({ blockers: OPEN });
    const result = await dispatchTrigger(EVENT, { force: true }, makeDeps(provider, launched));
    assert.equal(result.action, 'launched');
    assert.equal(probeCount(), 0, '--force ni siquiera paga la llamada');
  });

  // ── Dedup del comentario ───────────────────────────────────────────────────
  it('el polling revisita la tarea sin acumular comentarios idénticos', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const { provider, comments } = fakeProvider({ blockers: OPEN });
    const deps = makeDeps(provider, launched);
    for (let i = 0; i < 4; i++) await dispatchTrigger(EVENT, {}, deps);
    assert.equal(comments.length, 1, `esperaba 1 comentario, hubo ${comments.length}`);
  });

  it('si falla el comentario, el veredicto sigue siendo "no lanzar" y se reintenta el aviso', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const { provider } = fakeProvider({
      blockers: OPEN,
      commentThrows: new Error('plane 500'),
    });
    const deps = makeDeps(provider, launched);
    const first = await dispatchTrigger(EVENT, {}, deps);
    assert.equal(first.action, 'ignored');
    assert.equal(first.code, 'blocked_by_open');
    assert.deepEqual(launched, []);

    // La firma se olvidó, así que el siguiente tick vuelve a intentar el aviso: si el
    // comentario ahora funcionase, la constancia quedaría. Se comprueba sustituyendo
    // addComment por uno que sí registra.
    /** @type {string[]} */
    const retried = [];
    // @ts-ignore — reemplazo puntual sobre el fake.
    provider.addComment = async (_task, text) => { retried.push(text); };
    await dispatchTrigger(EVENT, {}, deps);
    assert.equal(retried.length, 1);
  });

  it('un bloqueo que desaparece y vuelve se anuncia otra vez', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    let current = OPEN;
    const { provider, comments } = fakeProvider({ blockers: [] });
    // @ts-ignore — capacidad dinámica para simular la evolución del tablero.
    provider.listBlockers = async () => current;
    const deps = makeDeps(provider, launched);

    await dispatchTrigger(EVENT, {}, deps);          // bloqueada → avisa
    current = CLOSED;
    await dispatchTrigger(EVENT, {}, deps);          // desbloqueada → lanza y olvida
    current = OPEN;
    await dispatchTrigger(EVENT, {}, deps);          // vuelve a bloquearse → avisa otra vez

    assert.equal(comments.length, 2);
    assert.deepEqual(launched, [true]);
  });

  it('un CONJUNTO distinto de bloqueadores vuelve a comentar', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    let current = OPEN;
    const { provider, comments } = fakeProvider({ blockers: [] });
    // @ts-ignore
    provider.listBlockers = async () => current;
    const deps = makeDeps(provider, launched);

    await dispatchTrigger(EVENT, {}, deps);
    current = [...OPEN, { id: 'blk-2', ref: 'KL-9', state: 'blocked' }];
    await dispatchTrigger(EVENT, {}, deps);

    assert.equal(comments.length, 2);
    assert.match(comments[1], /KL-9/);
  });
});
