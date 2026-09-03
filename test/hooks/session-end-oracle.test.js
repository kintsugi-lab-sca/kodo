// @ts-check
//
// test/hooks/session-end-oracle.test.js — KODO-69: el cableado del oráculo en SessionEnd.
//
// Lo que este fichero prueba NO es el oráculo (eso es test/integration/oracle-run.test.js), sino
// su SITIO y su COSTE en el cierre. Las dos propiedades que la fase compra o pierde aquí:
//
//   1. El hook LANZA, no EJECUTA. Si el oráculo corriera en línea, `SessionEnd` bloquearía a
//      Claude Code el tiempo de un `npm ci && npm test` — y encima con el worktree de la sesión
//      a punto de borrarse.
//   2. Fail-open de cuerpo entero. Un spawn que no sale deja la entrada con `oracle: null` y el
//      cierre sigue su curso; el cleanup destructivo corre igual.
//
// Aislamiento del HOME por DI en todas las invocaciones (T-74-15), igual que sus hermanos:
// `plansDir` a un tmpdir, `stateWriterFn` no-op y `getOrchestratorFn` a null.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessionEndHook } from '../../src/hooks/session-end.js';
import { ORCH_INBOX_SEAMS } from '../helpers/orchestrator-inbox-seams.js';

let plansDir;
before(() => { plansDir = mkdtempSync(join(tmpdir(), 'kodo-send-oracle-')); });
after(() => { rmSync(plansDir, { recursive: true, force: true }); });

function makeSession(overrides = {}) {
  return {
    session_id: 's-oracle-1',
    task_id: 'task-oracle-1',
    task_ref: 'KODO-69',
    provider: 'plane',
    project_id: 'p-1',
    project_path: '/tmp/repo-oracle',
    summary: 'oráculo mecánico',
    status: 'review',
    started_at: new Date().toISOString(),
    workspace_ref: 'workspace:oracle-1',
    gsd: false,
    worktree_path: '/tmp/repo-oracle/.bg-shell/s-oracle-1',
    ...overrides,
  };
}

const CAPTURED_ENTRY = {
  task_ref: 'KODO-69',
  branch: 'worktree-abc',
  project_path: '/tmp/repo-oracle',
  commits_ahead: 3,
  suggested: 'merge',
};

function baseDeps(session, calls, { config = {}, capture } = {}) {
  const logger = { info() {}, warn() {}, error() {}, debug() {}, child: () => logger };
  return {
    ...ORCH_INBOX_SEAMS,
    findSessionFn: () => ({ id: session.task_id, session }),
    removeSessionFn: () => { calls.push('removeSession'); },
    loggerFactory: () => logger,
    cmux: { setColor: async () => {}, notify: async () => {}, listWorkspaces: async () => '', send: async () => {} },
    provider: null,
    config,
    plansDir,
    stateWriterFn: () => ({ ok: true }),
    getOrchestratorFn: () => null,
    gitFn: (cwd, args) => { calls.push(`git:${args.join(' ')}`); return ''; },
    captureIntegrationFn: capture || (async () => {
      calls.push('capture');
      return { captured: true, reason: 'queued', entry: { ...CAPTURED_ENTRY } };
    }),
  };
}

describe('SessionEnd — el disparo del oráculo mecánico (KODO-69)', () => {
  // El selector es la RAMA y no el `task_ref`: una entrada se identifica por
  // (project_path, branch), así que una tarea que tocó dos repos deja dos entradas con la MISMA
  // ref — y disparar por ref resolvería la primera, que puede no ser la que acaba de cerrar.
  it('LANZA la corrida con la RAMA de la entrada recién encolada, y no la ejecuta', async () => {
    const session = makeSession();
    const calls = [];
    const spawned = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      { ...baseDeps(session, calls), spawnOracleFn: (ref) => { spawned.push(ref); calls.push('spawn'); return true; } },
    );
    assert.deepEqual(spawned, ['worktree-abc']);
  });

  it('el disparo va DESPUÉS de la captura y ANTES del cleanup destructivo', async () => {
    const session = makeSession();
    const calls = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      { ...baseDeps(session, calls), spawnOracleFn: () => { calls.push('spawn'); return true; } },
    );
    const iCapture = calls.indexOf('capture');
    const iSpawn = calls.indexOf('spawn');
    const iRemove = calls.indexOf('removeSession');
    assert.ok(iCapture !== -1 && iSpawn !== -1 && iRemove !== -1);
    assert.ok(iCapture < iSpawn, 'sin entrada en la cola no habría sobre qué correr');
    assert.ok(iSpawn < iRemove, 'el disparo ocurre mientras la sesión todavía existe');
  });

  it('una captura que NO encoló nada (rama ya mergeada) no dispara nada', async () => {
    const session = makeSession();
    const calls = [];
    let spawns = 0;
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        ...baseDeps(session, calls, {
          capture: async () => ({ captured: false, reason: 'merged', entry: null }),
        }),
        spawnOracleFn: () => { spawns++; return true; },
      },
    );
    assert.equal(spawns, 0);
  });

  it('`oracle.enabled: false` apaga el disparo (y solo eso: la captura sigue)', async () => {
    const session = makeSession();
    const calls = [];
    let spawns = 0;
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        ...baseDeps(session, calls, { config: { oracle: { enabled: false } } }),
        spawnOracleFn: () => { spawns++; return true; },
      },
    );
    assert.equal(spawns, 0);
    assert.ok(calls.includes('capture'), 'la cola de integración no depende del oráculo');
  });

  it('un config SIN el bloque `oracle` dispara igual (default activo, y el default no ejecuta comandos)', async () => {
    const session = makeSession();
    const calls = [];
    let spawns = 0;
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      { ...baseDeps(session, calls, { config: {} }), spawnOracleFn: () => { spawns++; return true; } },
    );
    assert.equal(spawns, 1);
  });

  it('FAIL-OPEN: un disparo que LANZA no impide el cierre', async () => {
    const session = makeSession();
    const calls = [];
    await assert.doesNotReject(
      runSessionEndHook(
        { session_id: session.session_id, cwd: session.project_path },
        { ...baseDeps(session, calls), spawnOracleFn: () => { throw new Error('EAGAIN'); } },
      ),
      'un fallo del oráculo JAMÁS bloquea el cierre de Claude Code',
    );
    assert.ok(calls.includes('removeSession'), 'el cleanup terminal corrió igual');
  });
});
