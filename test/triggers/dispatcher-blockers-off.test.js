// @ts-check
//
// KODO-73 — el escape hatch: `dispatch.respect_blockers: false`.
//
// Fichero APARTE de dispatcher-blockers.test.js por la misma razón mecánica que
// dispatcher-assignee-off.test.js: `config.js` cachea `KODO_DIR` en el import, así que el
// config que verá `loadConfig()` queda decidido por el HOME vigente en ese instante.
// Conmutar el knob a mitad de fichero no tendría efecto.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'kodo-blockers-off-'));
mkdirSync(join(HOME, '.kodo'), { recursive: true });
writeFileSync(
  join(HOME, '.kodo', 'config.json'),
  JSON.stringify({ dispatch: { respect_blockers: false } }, null, 2),
);
process.env.HOME = HOME;

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const EVENT = { taskRef: 'KL-42', action: 'state_change', provider: 'test', raw: {} };

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

/** Bloqueador ABIERTO: con el knob en `true` este dispatch NO llegaría al launch. */
const OPEN = [{ id: 'blk-1', ref: 'KL-7', state: 'in_progress' }];

function fakeProvider() {
  /** @type {string[]} */
  const comments = [];
  let probes = 0;
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
      assignees: [],
    }),
    updateTaskState: async () => {},
    addComment: async (_task, text) => { comments.push(text); },
    listPendingTasks: async () => [],
    parseTriggerEvent: () => null,
    verifySignature: () => true,
    resolveRef: async () => '',
    listProjects: async () => [],
  };
  // @ts-ignore — método opcional, fuera de TASK_PROVIDER_METHODS (FROZEN at 9).
  provider.listBlockers = async () => { probes++; return OPEN; };
  return { provider, comments, probeCount: () => probes };
}

function makeDeps(provider, launched) {
  return {
    getProviderFn: () => provider,
    launchWorkItemFn: async () => { launched.push(true); return FAKE_SESSION; },
    listSessionsFn: () => [],
    listWorkspacesFn: () => '',
    removeSessionFn: () => ({ ok: true }),
    resolveProjectPathFn: () => '/tmp/test',
    existsSyncFn: () => false,
    acquireLockFn: () => ({ token: 'token' }),
    releaseLockFn: () => {},
    startLockHeartbeatFn: () => () => {},
    dispatchLockDir: mkdtempSync(join(tmpdir(), 'kodo-blockers-off-locks-')),
    _logger: null,
  };
}

describe('KODO-73: dispatch.respect_blockers=false restaura el comportamiento previo', () => {
  it('una tarea con blocked_by ABIERTO se lanza igual', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    /** @type {boolean[]} */
    const launched = [];
    const { provider, comments, probeCount } = fakeProvider();

    const result = await dispatchTrigger(EVENT, {}, makeDeps(provider, launched));

    assert.equal(result.action, 'launched');
    assert.deepEqual(launched, [true]);
    // Con el knob apagado no se consulta ni se comenta: el path es el de antes de
    // KODO-73, no «el gate corre y luego se ignora».
    assert.equal(probeCount(), 0, 'con el knob apagado no se paga la llamada');
    assert.deepEqual(comments, [], 'con el knob apagado no se comenta nada');
  });
});
