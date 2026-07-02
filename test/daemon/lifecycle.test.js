// @ts-check
//
// test/daemon/lifecycle.test.js — Plan 65-03 Task 1 (D-02).
//
// Prueba el módulo genérico `src/daemon/lifecycle.js`: `startDaemon(name, argv, deps)`,
// `stopDaemon(name, deps)`, `statusDaemon(name, deps)`. Es plumbing name-parametrizado
// templado línea a línea sobre el daemon maduro de polling (src/cli/polling.js): Windows
// refuse-with-guidance, pre-flight readPidFile+isPidAlive, detached spawn + unref + bounded
// wait, stop SIGTERM→5s→SIGKILL + removePidFile, status running|idle. Su consumidor real es
// Phase 66 (kodo up/stop/status) — por eso `argv` es un parámetro (NO hardcodea 'daemon run').
//
// TODO se conduce vía DI (deps con `_spawn`/`_kill`/`_isPidAlive`/`_readPidFile`/
// `_removePidFile`/`_now`/`_sleep`/`_platform`/`_kodoBin`), sin procesos reales ni FS real,
// así que NO necesita HOME-isolation: las primitivas FS/proc están todas inyectadas.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startDaemon, stopDaemon, statusDaemon } from '../../src/daemon/lifecycle.js';

/** Fake child con unref() rastreable (mirror de child de spawn detached). */
function makeFakeChild() {
  const child = { unref_called: 0, unref() { child.unref_called += 1; } };
  return child;
}

/** now() monotónico que avanza `step` ms por llamada — dispara el deadline en tests. */
function makeClock(step = 10000) {
  let t = 0;
  return () => { const v = t; t += step; return v; };
}

describe('lifecycle: startDaemon(name, argv, deps)', () => {
  it('already-running short-circuit: PID vivo → no spawn', async () => {
    let spawned = 0;
    const res = await startDaemon('kodo', ['daemon', 'run'], {
      _platform: 'darwin',
      _readPidFile: () => ({ pid: 123, started_at: 'x', kind: 'daemon' }),
      _isPidAlive: () => true,
      _spawn: () => { spawned += 1; return makeFakeChild(); },
      _removePidFile: () => {},
    });
    assert.equal(spawned, 0, 'no debe spawnear si ya corre');
    assert.equal(res.ok, true);
    assert.equal(res.alreadyRunning, true);
    assert.equal(res.pid, 123);
  });

  it('stale PID (file presente, proceso muerto) → removePidFile + procede a spawn', async () => {
    let removed = null;
    let spawned = 0;
    const child = makeFakeChild();
    let readCall = 0;
    const res = await startDaemon('kodo', ['daemon', 'run'], {
      _platform: 'linux',
      // 1ª lectura (pre-flight) = stale pid 999; posteriores (bounded wait) = child vivo 456.
      _readPidFile: () => { readCall += 1; return readCall === 1 ? { pid: 999, started_at: 'x' } : { pid: 456, started_at: 'x' }; },
      _isPidAlive: (pid) => pid === 456, // 999 muerto, 456 (child) vivo
      _removePidFile: (name) => { removed = name; },
      _spawn: () => { spawned += 1; return child; },
      _now: makeClock(),
      _sleep: async () => {},
      _kodoBin: '/abs/bin/kodo',
    });
    assert.equal(removed, 'kodo', 'stale PID debe limpiarse antes de proceder');
    assert.equal(spawned, 1, 'debe spawnear tras limpiar el stale');
    assert.equal(child.unref_called, 1, 'child.unref() es crítico (si no, el padre cuelga)');
    assert.equal(res.ok, true);
    assert.equal(res.started, true);
    assert.equal(res.pid, 456);
  });

  it('happy path sin PID previo: spawn detached + unref + bounded wait → started', async () => {
    let spawnArgs = null;
    const child = makeFakeChild();
    let readCall = 0;
    const res = await startDaemon('kodo', ['daemon', 'run'], {
      _platform: 'darwin',
      _readPidFile: () => { readCall += 1; return readCall === 1 ? null : { pid: 456, started_at: 'x' }; },
      _isPidAlive: (pid) => pid === 456,
      _removePidFile: () => {},
      _spawn: (...a) => { spawnArgs = a; return child; },
      _now: makeClock(),
      _sleep: async () => {},
      _kodoBin: '/abs/bin/kodo',
      _execPath: '/usr/bin/node',
    });
    assert.equal(res.started, true);
    assert.equal(res.pid, 456);
    // argv array form + KODO_BIN absoluto (Security EOP: no shell/PATH lookup).
    assert.equal(spawnArgs[0], '/usr/bin/node', 'spawn usa process.execPath (no PATH lookup)');
    assert.deepEqual(spawnArgs[1], ['/abs/bin/kodo', 'daemon', 'run'], 'argv array form: KODO_BIN abs + argv del caller');
    assert.equal(spawnArgs[2].detached, true, 'detached:true para el daemon');
    assert.equal(child.unref_called, 1);
  });

  it('bounded wait agota deadline sin PID → timedOut (no started)', async () => {
    const res = await startDaemon('kodo', ['daemon', 'run'], {
      _platform: 'darwin',
      _readPidFile: () => null, // el hijo nunca escribe el PID
      _isPidAlive: () => false,
      _removePidFile: () => {},
      _spawn: () => makeFakeChild(),
      _now: makeClock(),
      _sleep: async () => {},
      _kodoBin: '/abs/bin/kodo',
    });
    assert.equal(res.ok, false);
    assert.equal(res.timedOut, true);
  });

  it('Windows refuse-with-guidance: no detached spawn', async () => {
    let spawned = 0;
    const res = await startDaemon('kodo', ['daemon', 'run'], {
      _platform: 'win32',
      _readPidFile: () => null,
      _isPidAlive: () => false,
      _spawn: () => { spawned += 1; return makeFakeChild(); },
      _removePidFile: () => {},
    });
    assert.equal(spawned, 0, 'Windows NO debe spawnear detached');
    assert.equal(res.ok, false);
    assert.equal(res.unsupported, true);
    assert.match(res.message, /Windows/i);
  });
});

describe('lifecycle: stopDaemon(name, deps)', () => {
  it('SIGTERM → 5s → SIGKILL escalation + removePidFile', async () => {
    const signals = [];
    let removed = null;
    const res = await stopDaemon('kodo', {
      _readPidFile: () => ({ pid: 123, started_at: 'x' }),
      _isPidAlive: () => true, // nunca muere → fuerza SIGKILL
      _kill: (pid, sig) => { signals.push([pid, sig]); },
      _removePidFile: (name) => { removed = name; },
      _now: makeClock(),
      _sleep: async () => {},
    });
    assert.deepEqual(signals, [[123, 'SIGTERM'], [123, 'SIGKILL']], 'SIGTERM primero, luego SIGKILL fallback');
    assert.equal(removed, 'kodo');
    assert.equal(res.ok, true);
    assert.equal(res.stopped, true);
    assert.equal(res.pid, 123);
  });

  it('proceso muere tras SIGTERM (sin SIGKILL) → stopped', async () => {
    const signals = [];
    const res = await stopDaemon('kodo', {
      _readPidFile: () => ({ pid: 123, started_at: 'x' }),
      _isPidAlive: () => false, // ya muerto en el primer check → no SIGKILL
      _kill: (pid, sig) => { signals.push([pid, sig]); },
      _removePidFile: () => {},
      _now: makeClock(),
      _sleep: async () => {},
    });
    assert.deepEqual(signals, [[123, 'SIGTERM']], 'solo SIGTERM, no SIGKILL');
    assert.equal(res.stopped, true);
  });

  it('ESRCH (proceso ya muerto) → stale cleanup success', async () => {
    let removed = null;
    const res = await stopDaemon('kodo', {
      _readPidFile: () => ({ pid: 123, started_at: 'x' }),
      _kill: () => { const e = new Error('no such process'); e.code = 'ESRCH'; throw e; },
      _isPidAlive: () => false,
      _removePidFile: (name) => { removed = name; },
      _now: makeClock(),
      _sleep: async () => {},
    });
    assert.equal(removed, 'kodo');
    assert.equal(res.ok, true);
    assert.equal(res.stale, true);
  });

  it('sin PID file → notRunning (no kill)', async () => {
    let killed = 0;
    const res = await stopDaemon('kodo', {
      _readPidFile: () => null,
      _kill: () => { killed += 1; },
      _isPidAlive: () => false,
      _removePidFile: () => {},
    });
    assert.equal(killed, 0);
    assert.equal(res.ok, true);
    assert.equal(res.notRunning, true);
  });
});

describe('lifecycle: statusDaemon(name, deps)', () => {
  it('PID + isPidAlive → running (con pid)', () => {
    const res = statusDaemon('kodo', {
      _readPidFile: () => ({ pid: 123, started_at: 'x' }),
      _isPidAlive: () => true,
    });
    assert.equal(res.status, 'running');
    assert.equal(res.pid, 123);
  });

  it('sin PID file → idle', () => {
    const res = statusDaemon('kodo', {
      _readPidFile: () => null,
      _isPidAlive: () => false,
    });
    assert.equal(res.status, 'idle');
    assert.equal(res.pid, null);
  });

  it('PID stale (file presente, proceso muerto) → idle', () => {
    const res = statusDaemon('kodo', {
      _readPidFile: () => ({ pid: 123, started_at: 'x' }),
      _isPidAlive: () => false,
    });
    assert.equal(res.status, 'idle');
    assert.equal(res.pid, null);
  });
});
