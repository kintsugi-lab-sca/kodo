// @ts-check
//
// test/hooks/session-end-integrate.test.js — KODO-26: el cableado de la captura en SessionEnd.
//
// Lo que este fichero prueba NO es la captura (eso es test/integration/capture.test.js), sino su
// SITIO en la secuencia de cierre. El orden es el requisito mecánico de la fase: el nombre de la
// rama se lee del worktree, y `performTerminalCleanup` lo remueve unas líneas después — una
// captura detrás del cleanup no tendría dónde leer.
//
// Aislamiento del HOME por DI en todas las invocaciones (T-74-15), igual que sus hermanos:
// `plansDir` a un tmpdir, `stateWriterFn` no-op y `getOrchestratorFn` a null.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessionEndHook } from '../../src/hooks/session-end.js';
// KODO-53: seams de aislamiento de la bandeja del orquestador (ver docblock del helper).
import { ORCH_INBOX_SEAMS } from '../helpers/orchestrator-inbox-seams.js';

let plansDir;
before(() => { plansDir = mkdtempSync(join(tmpdir(), 'kodo-send-int-')); });
after(() => { rmSync(plansDir, { recursive: true, force: true }); });

const noopStateWriter = () => ({ ok: true });
const noOrchestrator = () => null;

function makeSession(overrides = {}) {
  return {
    session_id: 's-int-1',
    task_id: 'task-int-1',
    task_ref: 'KODO-26',
    provider: 'plane',
    project_id: 'p-1',
    project_path: '/tmp/repo-int',
    summary: 'cola de integración',
    status: 'review',
    started_at: new Date().toISOString(),
    workspace_ref: 'workspace:int-1',
    gsd: false,
    ...overrides,
  };
}

function makeCmuxStub() {
  return { setColor: async () => {}, notify: async () => {}, listWorkspaces: async () => '', send: async () => {} };
}

function makeLogger() {
  const logger = { info() {}, warn() {}, error() {}, debug() {}, child: () => logger };
  return logger;
}

/**
 * Deps base con TODOS los seams de aislamiento puestos. `captureIntegrationFn` lo pone cada
 * caso: es justo lo que se está midiendo.
 */
function baseDeps(session, calls) {
  return {
    // KODO-53: la bandeja del orquestador. Va en las deps BASE por la misma razón que
    // `plansDir` y `getOrchestratorFn` — sin el stub, cada cierre de esta suite encola un
    // evento en el `~/.kodo/state.json` REAL (medido: 4 entradas `KODO-26` por pasada).
    ...ORCH_INBOX_SEAMS,
    findSessionFn: () => ({ id: session.task_id, session }),
    removeSessionFn: () => { calls.push('removeSession'); },
    loggerFactory: () => makeLogger(),
    cmux: makeCmuxStub(),
    provider: null,
    config: {},
    plansDir,
    stateWriterFn: noopStateWriter,
    getOrchestratorFn: noOrchestrator,
    gitFn: (cwd, args) => { calls.push(`git:${args.join(' ')}`); return ''; },
  };
}

describe('SessionEnd — captura de la cola de integración (KODO-26)', () => {
  it('la captura corre ANTES del cleanup terminal destructivo', async () => {
    const session = makeSession({ worktree_path: '/tmp/repo-int/.bg-shell/s-int-1' });
    const calls = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        ...baseDeps(session, calls),
        captureIntegrationFn: async () => { calls.push('capture'); return { captured: false, reason: 'merged', entry: null }; },
      },
    );

    const iCapture = calls.indexOf('capture');
    const iRemove = calls.indexOf('removeSession');
    assert.ok(iCapture !== -1, 'la captura corrió');
    assert.ok(iRemove !== -1, 'el cleanup destructivo corrió');
    assert.ok(iCapture < iRemove, 'captura ANTES de removeSession');
    // Y también antes de que el saneo del worktree emita su primer comando git.
    const iFirstGit = calls.findIndex((c) => c.startsWith('git:'));
    assert.ok(iCapture < iFirstGit, 'captura ANTES del primer git del cleanup');
  });

  it('recibe la sesión y el worktree de la sesión', async () => {
    const session = makeSession({ worktree_path: '/tmp/repo-int/.bg-shell/s-int-1' });
    const calls = [];
    let received = null;
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        ...baseDeps(session, calls),
        captureIntegrationFn: async (args) => { received = args; return { captured: false, reason: 'merged', entry: null }; },
      },
    );

    assert.equal(received.session.task_ref, 'KODO-26');
    assert.equal(typeof received.gitFn, 'function');
    // El worktree resuelto: ninguno de los dos candidatos existe en disco, así que se conserva el
    // persistido (comportamiento documentado de `resolveEffectiveWorktree`).
    assert.equal(received.worktree, '/tmp/repo-int/.bg-shell/s-int-1');
  });

  it('sesión adoptada (sin worktree_path) → la captura recibe null y lee del repo', async () => {
    const session = makeSession();
    const calls = [];
    let received = null;
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        ...baseDeps(session, calls),
        captureIntegrationFn: async (args) => { received = args; return { captured: false, reason: 'merged', entry: null }; },
      },
    );
    assert.equal(received.worktree, null);
  });

  it('FAIL-OPEN: una captura que LANZA no impide el cierre', async () => {
    const session = makeSession({ worktree_path: '/tmp/repo-int/.bg-shell/s-int-1' });
    const calls = [];
    await assert.doesNotReject(
      runSessionEndHook(
        { session_id: session.session_id, cwd: session.project_path },
        {
          ...baseDeps(session, calls),
          captureIntegrationFn: async () => { throw new Error('git murió'); },
        },
      ),
      'un fallo de la cola JAMÁS bloquea el cierre de Claude Code',
    );
    assert.ok(calls.includes('removeSession'), 'el cleanup terminal corrió igual');
  });

  it('una sesión ya archivada (source: history) no dispara captura', async () => {
    const session = makeSession();
    const calls = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        ...baseDeps(session, calls),
        findSessionFn: () => ({ id: session.task_id, session, source: 'history' }),
        captureIntegrationFn: async () => { calls.push('capture'); return { captured: false, reason: 'merged', entry: null }; },
      },
    );
    assert.ok(!calls.includes('capture'), 'el guard de idempotencia corta antes');
  });
});
