// @ts-check
//
// KODO-58 — el escape hatch: `dispatch.require_assignee: false`.
//
// Fichero APARTE de dispatcher-assignee.test.js por una razón mecánica, no estética:
// `config.js` cachea `KODO_DIR` en el momento del import, así que el config que verá
// `loadConfig()` queda decidido por el HOME vigente en ese instante. Conmutar el knob a
// mitad de un fichero no tendría efecto; hay que fijar el HOME —y escribir el
// config.json— ANTES del primer import.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'kodo-assignee-off-'));
mkdirSync(join(HOME, '.kodo'), { recursive: true });
writeFileSync(
  join(HOME, '.kodo', 'config.json'),
  JSON.stringify({ dispatch: { require_assignee: false } }, null, 2),
);
process.env.HOME = HOME;

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ME = 'da60ae01-2464-40da-857d-5aeb558bd881';
const OTHER = '78469dc1-bab7-4d26-8b55-a67002e3edb8';

const EVENT = { taskRef: 'KL-42', action: 'state_change', provider: 'test', raw: {} };

/** @param {any} assignees */
function fakeProvider(assignees) {
  return {
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
    getOperator: () => ({ id: ME, display_name: 'yo' }),
  };
}

function makeDeps(provider, launched) {
  return {
    getProviderFn: () => provider,
    launchWorkItemFn: async () => {
      launched.push(true);
      return {
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
    },
    listSessionsFn: () => [],
    listWorkspacesFn: () => '',
    removeSessionFn: () => ({ ok: true }),
    resolveProjectPathFn: () => '/tmp/test',
    existsSyncFn: () => false,
    acquireLockFn: () => 'token',
    releaseLockFn: () => {},
    startLockHeartbeatFn: () => () => {},
    dispatchLockDir: mkdtempSync(join(tmpdir(), 'kodo-assignee-off-locks-')),
    _logger: null,
  };
}

describe('KODO-58: dispatch.require_assignee=false restaura el comportamiento previo', () => {
  it('con el knob apagado, una tarea asignada a OTRO se lanza igual', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const launched = [];
    const result = await dispatchTrigger(EVENT, {}, makeDeps(fakeProvider([OTHER]), launched));
    assert.equal(result.action, 'launched');
    assert.deepEqual(launched, [true]);
  });

  it('con el knob apagado, una tarea SIN asignado se lanza igual', async () => {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const launched = [];
    const result = await dispatchTrigger(EVENT, {}, makeDeps(fakeProvider([]), launched));
    assert.equal(result.action, 'launched');
  });
});
