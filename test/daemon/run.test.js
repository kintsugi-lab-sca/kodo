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
      // D-09: teardown lee el payload y borra solo si es NUESTRO (pid === process.pid).
      _readPidFile: () => ({ pid: process.pid, started_at: 'x', kind: 'daemon' }),
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
  it('managed boot error throw → logged + cleanup, sin polling, no crash', async () => {
    let logged = '';
    let pollingCalls = 0;
    let removed = null;
    const proc = makeFakeProc();
    await runDaemon({
      _loadConfig: () => GITHUB_CONFIG,
      _providerUsesPolling: providerUsesPolling,
      _startServer: () => { throw new Error('boot exploded'); },
      _startPolling: () => { pollingCalls += 1; return { stop() {} }; },
      _writePidFile: () => {},
      _readPidFile: () => ({ pid: process.pid, started_at: 'x', kind: 'daemon' }),
      _removePidFile: (name) => { removed = name; },
      _process: proc,
      _block: async () => {},
      _log: (msg) => { logged += msg; },
    });
    assert.equal(pollingCalls, 0, 'un throw en startServer NO debe arrancar polling');
    assert.match(logged, /daemon start failed/i, 'el fallo genérico se loguea (clean surface)');
    assert.equal(removed, 'kodo', 'cleanup borra kodo.pid incluso en el fail path');
    assert.ok(proc.exitCalls.length >= 1, 'run.js es el único dueño del exit (también en fail)');
    assert.notEqual(proc.exitCalls[0], undefined);
  });
});

// ---------------------------------------------------------------------------
// Gap-closure 66-07: cold-spawn PID timeout.
//
// Bug: `kodo up` (cold start) reportaba "daemon 'kodo' failed to write PID file
// within 2000ms" aunque el daemon SÍ arrancaba. Causa: writePidFile se llamaba
// DESPUÉS de `await startServer({managed})`, que hace provider.init() (llamada de
// red). Cuando el boot tarda >2000ms el kodo.pid no está escrito antes de que el
// bounded-wait de startDaemon (lifecycle.js) se rinda. El PID file representa
// "el proceso daemon está vivo" → debe escribirse en cuanto el proceso arranca,
// ANTES del await de red; server-ready lo cubre waitForHealth contra /health.
// ---------------------------------------------------------------------------
describe('runDaemon: 66-07 PID escrito ANTES del await de startServer', () => {
  it('writePidFile se llama ANTES de que startServer resuelva (call order)', async () => {
    const order = [];
    const pidBeforeServer = { seen: false };
    await runDaemon({
      _loadConfig: () => PLANE_CONFIG,
      _providerUsesPolling: providerUsesPolling,
      _startServer: async () => {
        // Cuando startServer arranca (simula provider.init de red), el kodo.pid
        // YA debe estar escrito — ese es el invariante de liveness.
        pidBeforeServer.seen = order.includes('pid');
        order.push('startServer');
        return { server: { close() {} }, stopReconcile: () => {} };
      },
      _writePidFile: () => { order.push('pid'); },
      _removePidFile: () => {},
      _process: makeFakeProc(),
      _block: async () => {},
      _log: () => {},
    });
    assert.equal(pidBeforeServer.seen, true, 'el kodo.pid ya estaba escrito cuando startServer arrancó');
    assert.deepEqual(order, ['pid', 'startServer'], 'orden: writePidFile → startServer');
  });

  it('fail-path: pid escrito temprano se BORRA si startServer lanza (sin stale pid)', async () => {
    const order = [];
    const proc = makeFakeProc();
    const res = await runDaemon({
      _loadConfig: () => PLANE_CONFIG,
      _providerUsesPolling: providerUsesPolling,
      _startServer: () => { order.push('startServer-throw'); throw new Error('boom'); },
      _writePidFile: () => { order.push('write'); },
      _readPidFile: () => ({ pid: process.pid, started_at: 'x', kind: 'daemon' }),
      _removePidFile: () => { order.push('remove'); },
      _process: proc,
      _block: async () => {},
      _log: () => {},
    });
    assert.deepEqual(order, ['write', 'startServer-throw', 'remove'],
      'pid se escribe temprano, startServer lanza, y el fail-path borra el pid (no stale)');
    assert.equal(res && res.ok, false, 'fail-path devuelve {ok:false}');
    assert.deepEqual(proc.exitCalls, [1], 'exit(1) en el fail path');
  });

  it('KODO_SETUP_REQUIRED → mensaje DISTINTO de config (no el genérico)', async () => {
    let logged = '';
    const proc = makeFakeProc();
    await runDaemon({
      _loadConfig: () => PLANE_CONFIG,
      _providerUsesPolling: providerUsesPolling,
      _startServer: () => { throw Object.assign(new Error('setup required'), { code: 'KODO_SETUP_REQUIRED' }); },
      _writePidFile: () => {},
      _removePidFile: () => {},
      _process: proc,
      _block: async () => {},
      _log: (msg) => { logged += msg; },
    });
    assert.match(logged, /configuraci[oó]n/i, 'menciona configuración (mensaje accionable no-config)');
    assert.match(logged, /kodo config/i, 'apunta al comando de setup');
    assert.doesNotMatch(logged, /daemon start failed/i, 'NO usa el mensaje genérico de error de boot');
  });
});

// ---------------------------------------------------------------------------
// Phase 70 Task 1 — D-09 / CONC-04: teardown solo borra su PROPIO kodo.pid.
//
// El teardown lee el payload del PID file y borra ~/.kodo/kodo.pid SOLO cuando
// `payload.pid === process.pid` (el proceso es el dueño). Un proceso que NO es el
// dueño (payload con un pid ajeno = un daemon vivo distinto) NO toca el PID file
// — evita que un arranque nuevo borre el PID de otro daemon (audit A5).
//
// D-10 REVISED se preserva: el bind-failure test prueba que el `teardown(1)` del
// fail-path borra el PID cuando es NUESTRO (write pre-bind + fail-path cleanup =
// no lying PID), sin haber movido la escritura a post-bind.
// ---------------------------------------------------------------------------
describe('runDaemon: teardown ownership del PID (D-09 / CONC-04)', () => {
  it('payload con pid AJENO → NO borra kodo.pid en teardown (no-op, no throw)', async () => {
    let removeCalls = 0;
    const proc = makeFakeProc();
    await runDaemon({
      _loadConfig: () => PLANE_CONFIG,
      _providerUsesPolling: providerUsesPolling,
      _startServer: () => ({ server: { close() {} }, stopReconcile: () => {} }),
      _writePidFile: () => {},
      // payload de OTRO proceso (pid ajeno) — el daemon NO es el dueño.
      _readPidFile: () => ({ pid: process.pid + 100000, started_at: 'x', kind: 'daemon' }),
      _removePidFile: () => { removeCalls += 1; },
      _process: proc,
      _block: async () => {},
      _log: () => {},
    });
    // Dispara el teardown vía señal.
    proc.handlers.SIGTERM();
    assert.equal(removeCalls, 0, 'un proceso NO dueño no borra el PID file de otro daemon');
    assert.deepEqual(proc.exitCalls, [0], 'teardown igual sale exit(0) (no throw)');
  });

  it('payload con NUESTRO pid → SÍ borra kodo.pid en teardown', async () => {
    let removed = null;
    const proc = makeFakeProc();
    await runDaemon({
      _loadConfig: () => PLANE_CONFIG,
      _providerUsesPolling: providerUsesPolling,
      _startServer: () => ({ server: { close() {} }, stopReconcile: () => {} }),
      _writePidFile: () => {},
      _readPidFile: () => ({ pid: process.pid, started_at: 'x', kind: 'daemon' }),
      _removePidFile: (name) => { removed = name; },
      _process: proc,
      _block: async () => {},
      _log: () => {},
    });
    proc.handlers.SIGTERM();
    assert.equal(removed, 'kodo', 'el dueño (payload.pid === process.pid) SÍ borra su kodo.pid');
  });

  it('bind-fail: teardown(1) borra el PID NUESTRO (write pre-bind + fail-path cleanup, D-10 REVISED)', async () => {
    const order = [];
    const proc = makeFakeProc();
    const res = await runDaemon({
      _loadConfig: () => PLANE_CONFIG,
      _providerUsesPolling: providerUsesPolling,
      _startServer: () => { order.push('startServer-throw'); throw new Error('bind EADDRINUSE'); },
      _writePidFile: () => { order.push('write'); },
      _readPidFile: () => ({ pid: process.pid, started_at: 'x', kind: 'daemon' }),
      _removePidFile: () => { order.push('remove'); },
      _process: proc,
      _block: async () => {},
      _log: () => {},
    });
    assert.deepEqual(order, ['write', 'startServer-throw', 'remove'],
      'write pre-bind → bind lanza → fail-path teardown borra el PID (no post-bind, no lying PID)');
    assert.equal(res && res.ok, false);
    assert.deepEqual(proc.exitCalls, [1], 'exit(1) en el fail path');
  });
});
