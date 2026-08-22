// @ts-check
//
// test/dispatcher-audit.test.js — KODO-28.
//
// El wrapper de auditoría de `dispatchTrigger`: emite `dispatch.decision` en CADA
// veredicto y `dispatch.error` cuando la implementación lanza. Antes de KODO-28 el
// único rastro eran los `console.log('[kodo:dispatch] ...')`, que morían con el
// proceso — y en el daemon detached ni siquiera llegaban a un fichero.
//
// El audit se conduce por el seam `_logger` (un espía), así que estos tests no
// tocan el FS. Aun así se aísla HOME: un fallo del seam no debe poder escribir en
// el `~/.kodo/logs/` real del operador.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.HOME = mkdtempSync(join(tmpdir(), 'kodo-dispatch-audit-'));

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

/** Logger espía con la superficie que consumen los helpers de logger-events. */
function makeSpyLogger() {
  /** @type {any[]} */
  const records = [];
  const push = (level) => (msg, fields) => records.push({ level, ...fields });
  return { records, info: push('info'), warn: push('warn'), error: push('error') };
}

/**
 * @param {string[]} labels
 * @param {object} extra
 */
function fakeTask(labels, extra = {}) {
  return {
    id: 'task-uuid-1',
    ref: 'KL-42',
    title: 'Test task',
    description: 'desc',
    labels,
    projectId: 'proj-1',
    projectName: 'Test Project',
    groups: [],
    url: 'https://example.com/KL-42',
    priority: 'medium',
    ...extra,
  };
}

/**
 * @param {object} task
 * @param {object} overrides
 */
function fakeProvider(task, overrides = {}) {
  return {
    init: async () => {},
    getTask: async () => task,
    updateTaskState: async () => {},
    addComment: async () => {},
    listPendingTasks: async () => [],
    parseTriggerEvent: () => null,
    verifySignature: () => true,
    resolveRef: async () => '',
    ...overrides,
  };
}

const EVENT = { taskRef: 'KL-42', action: 'state_change', provider: 'plane', raw: {} };

/**
 * @param {object} deps
 * @returns {Promise<{ result: any, records: any[] }>}
 */
async function run(deps) {
  const logger = makeSpyLogger();
  const result = await dispatchTrigger(EVENT, {}, {
    listSessionsFn: () => [],
    listWorkspacesFn: async () => '',
    removeSessionFn: () => {},
    launchWorkItemFn: async () => ({ session_id: 'sess-1', workspace_ref: 'workspace:1' }),
    _logger: logger,
    ...deps,
  });
  return { result, records: logger.records };
}

describe('KODO-28: dispatchTrigger emite dispatch.decision en cada veredicto', () => {
  it('launched: un solo record con action=launched y sin code', async () => {
    const { result, records } = await run({
      getProviderFn: () => fakeProvider(fakeTask(['kodo'])),
    });
    assert.equal(result.action, 'launched');
    assert.equal(records.length, 1);
    assert.equal(records[0].event, 'dispatch.decision');
    assert.equal(records[0].level, 'info');
    assert.equal(records[0].provider, 'plane');
    assert.equal(records[0].task_ref, 'KL-42');
    assert.equal(records[0].action, 'launched');
    assert.equal('code' in records[0], false);
  });

  it('sin label kodo: code=no_kodo_label (antes el veredicto era anónimo)', async () => {
    const { result, records } = await run({
      getProviderFn: () => fakeProvider(fakeTask(['bug', 'frontend'])),
    });
    assert.equal(result.action, 'ignored');
    assert.equal(result.code, 'no_kodo_label');
    assert.equal(records[0].action, 'ignored');
    assert.equal(records[0].code, 'no_kodo_label');
  });

  it('anti-recursión gsd-child: code=gsd_child', async () => {
    const { records } = await run({
      getProviderFn: () => fakeProvider(fakeTask(['kodo', 'kodo:gsd-child'])),
    });
    assert.equal(records[0].code, 'gsd_child');
  });

  it('anti-recursión adopted: code=adopted', async () => {
    const { records } = await run({
      getProviderFn: () => fakeProvider(fakeTask(['kodo', 'kodo:adopted'])),
    });
    assert.equal(records[0].code, 'adopted');
  });

  it('worktree_collision: propaga code y detail (el path del worktree) al audit', async () => {
    const { result, records } = await run({
      getProviderFn: () => fakeProvider(fakeTask(['kodo'])),
      resolveProjectPathFn: () => '/tmp/proj',
      existsSyncFn: () => true,
    });
    assert.equal(result.action, 'worktree_collision');
    assert.equal(records[0].action, 'worktree_collision');
    assert.equal(records[0].code, 'worktree_exists');
    assert.ok(records[0].detail.startsWith('/tmp/proj'), 'detail lleva el path en colisión');
  });

  it('un veredicto = exactamente un record (sin duplicados)', async () => {
    const { records } = await run({
      getProviderFn: () => fakeProvider(fakeTask(['kodo'])),
    });
    assert.equal(records.filter((r) => r.event === 'dispatch.decision').length, 1);
  });
});

describe('KODO-28: dispatchTrigger emite dispatch.error y RE-LANZA', () => {
  it('un throw del provider produce dispatch.error y el error sigue propagándose', async () => {
    const logger = makeSpyLogger();
    await assert.rejects(
      () => dispatchTrigger(EVENT, {}, {
        getProviderFn: () => fakeProvider(null, {
          getTask: async () => { throw new Error('No configured project with identifier "UNKNOWN"'); },
        }),
        _logger: logger,
      }),
      /No configured project/,
      'el caller de webhook.js depende de recibir el error intacto (pista KODO-10)',
    );
    assert.equal(logger.records.length, 1);
    assert.equal(logger.records[0].event, 'dispatch.error');
    assert.equal(logger.records[0].level, 'error');
    assert.equal(logger.records[0].task_ref, 'KL-42');
    assert.equal(logger.records[0].provider, 'plane');
    assert.match(logger.records[0].error, /No configured project/);
  });

  it('el mensaje se trunca a 200 chars (mismo contrato que pollingError)', async () => {
    const logger = makeSpyLogger();
    await assert.rejects(
      () => dispatchTrigger(EVENT, {}, {
        getProviderFn: () => fakeProvider(null, {
          getTask: async () => { throw new Error('x'.repeat(500)); },
        }),
        _logger: logger,
      }),
      /xxx/,
    );
    assert.equal(logger.records[0].error.length, 200);
  });

  it('un throw NO emite además un dispatch.decision', async () => {
    const logger = makeSpyLogger();
    await assert.rejects(
      () => dispatchTrigger(EVENT, {}, {
        getProviderFn: () => fakeProvider(null, {
          getTask: async () => { throw new Error('boom'); },
        }),
        _logger: logger,
      }),
      /boom/,
    );
    assert.equal(logger.records.filter((r) => r.event === 'dispatch.decision').length, 0);
  });
});

describe('KODO-28: el audit nunca altera el comportamiento del dispatcher', () => {
  it('un logger que lanza no rompe el veredicto', async () => {
    const exploding = {
      info: () => { throw new Error('sink caído'); },
      warn: () => { throw new Error('sink caído'); },
      error: () => { throw new Error('sink caído'); },
    };
    const result = await dispatchTrigger(EVENT, {}, {
      getProviderFn: () => fakeProvider(fakeTask(['kodo'])),
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      launchWorkItemFn: async () => ({ session_id: 'sess-1' }),
      _logger: exploding,
    });
    assert.equal(result.action, 'launched');
  });

  it('un logger que lanza tampoco enmascara el error original', async () => {
    const exploding = { info: () => {}, warn: () => {}, error: () => { throw new Error('sink caído'); } };
    await assert.rejects(
      () => dispatchTrigger(EVENT, {}, {
        getProviderFn: () => fakeProvider(null, {
          getTask: async () => { throw new Error('error original'); },
        }),
        _logger: exploding,
      }),
      /error original/,
    );
  });

  it('_logger:null desactiva el audit por completo', async () => {
    const result = await dispatchTrigger(EVENT, {}, {
      getProviderFn: () => fakeProvider(fakeTask(['kodo'])),
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      launchWorkItemFn: async () => ({ session_id: 'sess-1' }),
      _logger: null,
    });
    assert.equal(result.action, 'launched');
  });
});
