// @ts-check
//
// test/dispatcher-integration-pressure.test.js — KODO-72.
//
// El aviso de presión de integración: al lanzar una tarea sobre un repo que YA acumula ramas
// `pending` en `integration_queue`, el dispatcher lo DICE y lanza IGUALMENTE.
//
// La propiedad que estos tests protegen no es que el aviso salga, sino que el aviso NO PUEDA
// convertirse en un bloqueo. De ahí que casi todos afirmen dos cosas a la vez: que hay traza y
// que `action` sigue siendo `'launched'` / `'stale_relaunch'`.
//
// Se conduce por los seams `countPendingIntegrationsFn` y `enqueueOrchestratorEventFn`, así que
// NO se toca `state.json`. Aun así se aísla HOME (molde de dispatcher-audit.test.js): un fallo
// del seam jamás debe poder escribir en el `~/.kodo` real del operador.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.HOME = mkdtempSync(join(tmpdir(), 'kodo-int-pressure-'));

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

const PROJECT = '/repo/kodo';
const EVENT = { taskRef: 'KODO-71', action: 'state_change', provider: 'plane', raw: {} };

function fakeTask(extra = {}) {
  return {
    id: 'task-uuid-71',
    ref: 'KODO-71',
    title: 'Tarea de prueba',
    description: 'desc',
    labels: ['kodo'],
    projectId: 'proj-1',
    projectName: 'kodo',
    groups: [],
    url: 'https://example.com/KODO-71',
    priority: 'medium',
    ...extra,
  };
}

function fakeProvider(task) {
  return {
    init: async () => {},
    getTask: async () => task,
    updateTaskState: async () => {},
    addComment: async () => {},
    listPendingTasks: async () => [],
    parseTriggerEvent: () => null,
    verifySignature: () => true,
    resolveRef: async () => '',
  };
}

/**
 * Corre el dispatcher capturando las DOS superficies del aviso: el stdout del carril
 * `[kodo:dispatch]` y la bandeja del orquestador.
 *
 * @param {object} deps
 * @returns {Promise<{ result: any, stdout: string[], inbox: any[] }>}
 */
async function run(deps = {}) {
  /** @type {string[]} */
  const stdout = [];
  /** @type {any[]} */
  const inbox = [];
  const origLog = console.log;
  console.log = (...args) => stdout.push(args.join(' '));
  try {
    const result = await dispatchTrigger(EVENT, {}, {
      getProviderFn: () => fakeProvider(fakeTask()),
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      launchWorkItemFn: async () => ({ session_id: 'sess-1', workspace_ref: 'workspace:1' }),
      resolveProjectPathFn: () => PROJECT,
      // El collision-check pregunta por el worktree; en estos tests nunca existe.
      existsSyncFn: () => false,
      // Dedup lock cross-process: siempre se concede, así llegamos al launch.
      acquireLockFn: () => ({ token: 'tok' }),
      releaseLockFn: () => {},
      startLockHeartbeatFn: () => () => {},
      enqueueOrchestratorEventFn: (input) => { inbox.push(input); return { ok: true }; },
      _logger: null,
      ...deps,
    });
    return { result, stdout, inbox };
  } finally {
    console.log = origLog;
  }
}

const pressureLines = (stdout) => stdout.filter((l) => l.includes('integration_pressure'));

describe('KODO-72: aviso de cola de integración en el dispatcher', () => {
  it('CRITERIO DE ACEPTACIÓN — con 2 pending del mismo repo, la tercera tarea AVISA y LANZA', async () => {
    /** @type {string[]} */
    const asked = [];
    const { result, stdout, inbox } = await run({
      countPendingIntegrationsFn: (p) => { asked.push(p); return 2; },
    });

    // Lanza igualmente. Esto es lo LOAD-BEARING: aviso, jamás bloqueo.
    assert.equal(result.action, 'launched');
    assert.ok(result.session, 'la sesión se creó');

    // Se preguntó por el repo DESTINO, no por otro.
    assert.deepEqual(asked, [PROJECT]);

    // Superficie 1: el log del dispatcher.
    const lines = pressureLines(stdout);
    assert.equal(lines.length, 1, 'un solo aviso por lanzamiento');
    assert.match(lines[0], /^\[kodo:dispatch\] integration_pressure — KODO-71 /);
    assert.match(lines[0], /2 entradas pending/);
    assert.ok(lines[0].includes(PROJECT), 'el aviso nombra el repo');
    assert.match(lines[0], /se lanza igualmente/);

    // Superficie 2: la bandeja que la ronda del orquestador lee en su paso 1.
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].kind, 'integration-pressure');
    assert.equal(inbox[0].task_ref, 'KODO-71');
    assert.match(inbox[0].text, /KODO-71 va a un repo con 2 entradas pending/);
    assert.match(inbox[0].text, /no bloqueo/);
  });

  it('CRITERIO DE ACEPTACIÓN — con la cola VACÍA no hay aviso por ninguna de las dos superficies', async () => {
    const { result, stdout, inbox } = await run({
      countPendingIntegrationsFn: () => 0,
    });

    assert.equal(result.action, 'launched');
    assert.deepEqual(pressureLines(stdout), [], 'cero líneas de aviso');
    assert.deepEqual(inbox, [], 'cero entradas en la bandeja');
  });

  it('singular: 1 pending dice «1 entrada», no «1 entradas»', async () => {
    const { stdout, inbox } = await run({ countPendingIntegrationsFn: () => 1 });
    assert.match(pressureLines(stdout)[0], /1 entrada pending/);
    assert.match(inbox[0].text, /1 entrada pending/);
  });

  it('FAIL-OPEN: si contar la cola LANZA, el lanzamiento sigue y no hay aviso', async () => {
    const { result, stdout, inbox } = await run({
      countPendingIntegrationsFn: () => { throw new Error('state.json ilegible'); },
    });

    assert.equal(result.action, 'launched');
    assert.ok(result.session);
    assert.deepEqual(pressureLines(stdout), []);
    assert.deepEqual(inbox, []);
  });

  it('FAIL-OPEN: si encolar en la bandeja LANZA, el lanzamiento sigue igual', async () => {
    const { result, stdout } = await run({
      countPendingIntegrationsFn: () => 3,
      enqueueOrchestratorEventFn: () => { throw new Error('lock-timeout'); },
    });

    assert.equal(result.action, 'launched');
    assert.ok(result.session);
    assert.equal(pressureLines(stdout).length, 1, 'el log sí salió: es la superficie previa');
  });

  it('un conteo no numérico se trata como cero (never-throws hasta el final)', async () => {
    const { result, stdout, inbox } = await run({
      countPendingIntegrationsFn: () => /** @type {any} */ ('dos'),
    });

    assert.equal(result.action, 'launched');
    assert.deepEqual(pressureLines(stdout), []);
    assert.deepEqual(inbox, []);
  });

  it('el relanzamiento tras una sesión stale también avisa — abre sesión nueva sobre el repo', async () => {
    const { result, stdout, inbox } = await run({
      countPendingIntegrationsFn: () => 2,
      // Hay una sesión persistida para esta task_id, pero su workspace ya no existe:
      // el dispatcher la limpia y RELANZA.
      listSessionsFn: () => [{ task_id: 'task-uuid-71', workspace_ref: 'workspace:muerto' }],
      listWorkspacesFn: async () => 'workspace:otro',
    });

    assert.equal(result.action, 'stale_relaunch');
    assert.equal(pressureLines(stdout).length, 1);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].kind, 'integration-pressure');
  });

  it('un veredicto que NO lanza (already_active) no emite aviso: no hay lanzamiento que avisar', async () => {
    const { result, stdout, inbox } = await run({
      countPendingIntegrationsFn: () => 5,
      // Sesión viva: su workspace SÍ está en la lista → already_active, sin launch.
      listSessionsFn: () => [{ task_id: 'task-uuid-71', workspace_ref: 'workspace:vivo' }],
      listWorkspacesFn: async () => 'workspace:vivo',
    });

    assert.equal(result.action, 'already_active');
    assert.deepEqual(pressureLines(stdout), []);
    assert.deepEqual(inbox, []);
  });

  it('un veredicto ignorado (sin label kodo) tampoco avisa ni cuenta la cola', async () => {
    let counted = 0;
    const { result, inbox } = await run({
      getProviderFn: () => fakeProvider(fakeTask({ labels: ['bug'] })),
      countPendingIntegrationsFn: () => { counted++; return 4; },
    });

    assert.equal(result.action, 'ignored');
    assert.equal(result.code, 'no_kodo_label');
    assert.equal(counted, 0, 'ni siquiera se lee la cola: se corta mucho antes');
    assert.deepEqual(inbox, []);
  });

  it('el perdedor del dedup lock cross-process no avisa: no llega a lanzar', async () => {
    let counted = 0;
    const { result, inbox } = await run({
      countPendingIntegrationsFn: () => { counted++; return 2; },
      acquireLockFn: () => null, // otro proceso tiene el lock
    });

    assert.equal(result.action, 'already_active');
    assert.equal(counted, 0, 'el aviso va DESPUÉS del lock, por eso ni se cuenta');
    assert.deepEqual(inbox, []);
  });
});
