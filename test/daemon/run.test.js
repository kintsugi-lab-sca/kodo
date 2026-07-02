// @ts-check
//
// test/daemon/run.test.js — Plan 65-03 Task 2 (D-01 / D-05 / D-06).
//
// Prueba `runDaemon(deps)` en src/daemon/run.js: el ÚNICO funnel foreground que
// compone `startServer({managed:true})` + `startPolling` CONDICIONAL en UN proceso
// con UN solo PID file (~/.kodo/kodo.pid), instala los handlers de señal PRIMERO y
// es el único dueño del teardown y del exit (D-05 single-owner).
//
// TODO se conduce vía DI (deps con `_loadConfig`/`_startServer`/`_startPolling`/
// `_providerUsesPolling`/`_provider`/`_writePidFile`/`_removePidFile`/`_process`/
// `_block`/`_log`), así que compose + teardown corren enteros in-process con fakes:
//   - github → server + polling + kodo.pid
//   - plane  → server only, sin polling, con kodo.pid
//   - SIGTERM inyectado → stop()+stopReconcile()+server.close()+removePidFile una vez,
//     exit(0) exactamente una vez (single owner)
//   - startServer throw → logged + cleanup, sin polling, no uncaught crash

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { providerUsesPolling } from '../../src/daemon/provider-uses-polling.js';
import { runDaemon } from '../../src/daemon/run.js';

/** Fake `process` que captura handlers de señal y las llamadas a exit(). */
function makeFakeProc() {
  const handlers = {};
  const exitCalls = [];
  return {
    handlers,
    exitCalls,
    on(sig, fn) { handlers[sig] = fn; },
    exit(code) { exitCalls.push(code); },
  };
}

/** Config github con un repo + poll_interval custom. */
const GITHUB_CONFIG = {
  provider: 'github',
  providers: { github: { repos: [{ owner: 'o', repo: 'r' }], poll_interval: 30 } },
};
const PLANE_CONFIG = { provider: 'plane' };

describe('runDaemon: compose funnel', () => {
  it('github → startServer({managed}) + startPolling + kodo.pid', async () => {
    let startServerOpts = null;
    let pollingOpts = null;
    let pidWrite = null;
    const server = { close_called: 0, close() { server.close_called += 1; } };
    const res = await runDaemon({
      _loadConfig: () => GITHUB_CONFIG,
      _providerUsesPolling: providerUsesPolling,
      _startServer: (opts) => { startServerOpts = opts; return { server, stopReconcile: () => {} }; },
      _provider: { id: 'github' },
      _startPolling: (opts) => { pollingOpts = opts; return { stop() {} }; },
      _writePidFile: (payload, name) => { pidWrite = { payload, name }; },
      _removePidFile: () => {},
      _process: makeFakeProc(),
      _block: async () => {},
      _log: () => {},
    });
    assert.equal(startServerOpts.managed, true, 'startServer se invoca en modo managed');
    assert.ok(pollingOpts, 'startPolling debe invocarse para github');
    assert.deepEqual(pollingOpts.repos, [{ owner: 'o', repo: 'r' }]);
    assert.equal(pollingOpts.intervalSec, 30, 'intervalSec desde poll_interval de la config');
    assert.equal(pollingOpts.provider.id, 'github');
    assert.ok(pidWrite, 'debe escribir el PID file');
    assert.equal(pidWrite.name, 'kodo', 'UN solo PID file: ~/.kodo/kodo.pid');
    assert.equal(pidWrite.payload.kind, 'daemon');
    assert.equal(typeof pidWrite.payload.pid, 'number');
    assert.equal(typeof pidWrite.payload.started_at, 'string');
    assert.equal(res && res.ok, true);
  });

  it('plane → server only, sin polling, con kodo.pid', async () => {
    let pollingCalls = 0;
    let pidWrite = null;
    await runDaemon({
      _loadConfig: () => PLANE_CONFIG,
      _providerUsesPolling: providerUsesPolling,
      _startServer: () => ({ server: { close() {} }, stopReconcile: () => {} }),
      _startPolling: () => { pollingCalls += 1; return { stop() {} }; },
      _writePidFile: (payload, name) => { pidWrite = { payload, name }; },
      _removePidFile: () => {},
      _process: makeFakeProc(),
      _block: async () => {},
      _log: () => {},
    });
    assert.equal(pollingCalls, 0, 'plane usa webhook ingress: NO startPolling (D-06)');
    assert.ok(pidWrite, 'plane igualmente escribe kodo.pid (el server es el daemon)');
    assert.equal(pidWrite.name, 'kodo');
  });
});

describe('runDaemon: single-owner teardown (D-05)', () => {
  it('SIGTERM → stop()+stopReconcile()+server.close()+removePidFile once, exit(0) once', async () => {
    let pollingStopped = 0;
    let reconcileStopped = 0;
    let removed = null;
    const server = { close_called: 0, close() { server.close_called += 1; } };
    const proc = makeFakeProc();
    await runDaemon({
      _loadConfig: () => GITHUB_CONFIG,
      _providerUsesPolling: providerUsesPolling,
      _startServer: () => ({ server, stopReconcile: () => { reconcileStopped += 1; } }),
      _provider: { id: 'github' },
      _startPolling: () => ({ stop() { pollingStopped += 1; } }),
      _writePidFile: () => {},
      _removePidFile: (name) => { removed = name; },
      _process: proc,
      _block: async () => {},
      _log: () => {},
    });
    // Handlers registrados ANTES del await (early signal safe).
    assert.equal(typeof proc.handlers.SIGTERM, 'function', 'SIGTERM handler registrado');
    assert.equal(typeof proc.handlers.SIGINT, 'function', 'SIGINT handler registrado');

    proc.handlers.SIGTERM();
    assert.equal(pollingStopped, 1, 'polling.stop() una vez');
    assert.equal(reconcileStopped, 1, 'stopReconcile() una vez');
    assert.equal(server.close_called, 1, 'server.close() una vez');
    assert.equal(removed, 'kodo', 'removePidFile("kodo")');
    assert.deepEqual(proc.exitCalls, [0], 'exit(0) exactamente una vez');

    // Segunda señal (SIGINT) → idempotente, sin doble teardown (Pitfall double-teardown).
    proc.handlers.SIGINT();
    assert.equal(pollingStopped, 1, 'no re-stop de polling');
    assert.equal(server.close_called, 1, 'no re-close del server');
    assert.deepEqual(proc.exitCalls, [0], 'exit sigue siendo una sola vez');
  });
});

describe('runDaemon: startServer throw (Pitfall 4)', () => {
  it('managed misconfig throw → logged + cleanup, sin polling, no crash', async () => {
    let logged = '';
    let pollingCalls = 0;
    let removed = null;
    const proc = makeFakeProc();
    await runDaemon({
      _loadConfig: () => GITHUB_CONFIG,
      _providerUsesPolling: providerUsesPolling,
      _startServer: () => { throw Object.assign(new Error('setup required'), { code: 'KODO_SETUP_REQUIRED' }); },
      _startPolling: () => { pollingCalls += 1; return { stop() {} }; },
      _writePidFile: () => {},
      _removePidFile: (name) => { removed = name; },
      _process: proc,
      _block: async () => {},
      _log: (msg) => { logged += msg; },
    });
    assert.equal(pollingCalls, 0, 'un throw en startServer NO debe arrancar polling');
    assert.match(logged, /daemon start failed/i, 'el fallo se loguea (clean surface)');
    assert.equal(removed, 'kodo', 'cleanup borra kodo.pid incluso en el fail path');
    assert.ok(proc.exitCalls.length >= 1, 'run.js es el único dueño del exit (también en fail)');
    assert.notEqual(proc.exitCalls[0], undefined);
  });
});
