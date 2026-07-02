// @ts-check
//
// test/cli/up.test.js — Plan 66-01 Task 3 (UP-01/02/03, DIST-03).
//
// Prueba `runUp` de src/cli/up.js: el orquestador ensure-daemon → health-wait →
// attach dashboard → return DEJANDO EL DAEMON VIVO. Compone las piezas de Phase 65
// (statusDaemon/startDaemon/runDaemon/runDashboard) detrás de seams DI — este test
// verifica el ORDEN, la idempotencia (attach-if-running / puerto-ocupado), el guard
// win32 (foreground) y el invariante LOCKED UP-02 (cero signal handlers hacia el
// daemon). TODO por DI, sin procesos, red ni ink reales.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runUp, waitForHealth } from '../../src/cli/up.js';

/** Deps base: daemon frío (idle + puerto libre), todo espiable. */
function makeDeps(overrides = {}) {
  const calls = {
    startDaemon: [],
    runDashboard: [],
    runDaemon: 0,
    waitForHealth: 0,
    processOn: [],
    stderr: [],
  };
  const deps = {
    _platform: 'darwin',
    _loadConfig: () => ({ server: { port: 9090 } }),
    _resolveBaseUrl: () => 'http://localhost:9090',
    _statusDaemon: () => ({ status: 'idle', pid: null }),
    _probePort: async () => false,
    _startDaemon: async (name, argv) => { calls.startDaemon.push([name, argv]); return { ok: true, started: true, pid: 1 }; },
    _waitForHealth: async () => { calls.waitForHealth += 1; return true; },
    _runDashboard: async (d) => { calls.runDashboard.push(d); },
    _runDaemon: async () => { calls.runDaemon += 1; },
    _process: { on: (sig, fn) => { calls.processOn.push([sig, fn]); } },
    _stderr: { write: (s) => { calls.stderr.push(s); } },
    ...overrides,
  };
  return { deps, calls };
}

describe('runUp', () => {
  it('daemon frío: startDaemon 1× (kodo, [daemon,run]) → waitForHealth → runDashboard (UP-01)', async () => {
    const { deps, calls } = makeDeps();
    await runUp(deps);
    assert.equal(calls.startDaemon.length, 1);
    assert.deepEqual(calls.startDaemon[0], ['kodo', ['daemon', 'run']]);
    assert.equal(calls.waitForHealth, 1);
    assert.equal(calls.runDashboard.length, 1);
    assert.deepEqual(calls.runDashboard[0], { url: 'http://localhost:9090' });
  });

  it('daemon vivo (statusDaemon running): NO startDaemon, sí runDashboard (attach idempotente, UP-03)', async () => {
    const { deps, calls } = makeDeps({ _statusDaemon: () => ({ status: 'running', pid: 42 }) });
    await runUp(deps);
    assert.equal(calls.startDaemon.length, 0);
    assert.equal(calls.runDashboard.length, 1);
  });

  it('puerto ocupado pero sin daemon (idle + probePort true): NO startDaemon (attach, no EADDRINUSE, UP-03)', async () => {
    const { deps, calls } = makeDeps({ _probePort: async () => true });
    await runUp(deps);
    assert.equal(calls.startDaemon.length, 0);
    assert.equal(calls.runDashboard.length, 1);
  });

  it('win32: runDaemon invocado; startDaemon y runDashboard NO; no lanza (DIST-03)', async () => {
    const { deps, calls } = makeDeps({ _platform: 'win32' });
    await runUp(deps);
    assert.equal(calls.runDaemon, 1);
    assert.equal(calls.startDaemon.length, 0);
    assert.equal(calls.runDashboard.length, 0);
    assert.ok(calls.stderr.some((s) => /foreground/i.test(s)));
  });

  it('UP-02: cero registros de SIGINT/SIGTERM en process.on tras runUp', async () => {
    const { deps, calls } = makeDeps();
    await runUp(deps);
    const signalRegs = calls.processOn.filter(([sig]) => sig === 'SIGINT' || sig === 'SIGTERM');
    assert.equal(signalRegs.length, 0);
  });

  it('startDaemon {ok:false}: escribe stderr y retorna sin lanzar ni attach', async () => {
    const { deps, calls } = makeDeps({
      _startDaemon: async () => ({ ok: false, message: 'boom' }),
    });
    await runUp(deps); // no debe lanzar
    assert.ok(calls.stderr.some((s) => /boom/.test(s)));
    assert.equal(calls.runDashboard.length, 0, 'no debe attach si el daemon no arrancó');
    assert.equal(calls.waitForHealth, 0, 'no debe health-wait si el daemon no arrancó');
  });

  it('health-wait false: avisa por stderr pero CONTINÚA al dashboard (fail-open)', async () => {
    const { deps, calls } = makeDeps({ _waitForHealth: async () => false });
    await runUp(deps);
    assert.ok(calls.stderr.some((s) => /health/i.test(s)));
    assert.equal(calls.runDashboard.length, 1, 'fail-open: abre el dashboard igual');
  });
});

// Gap-closure 66-07: con el kodo.pid escrito temprano, `kodo up` pasa el pid-wait
// en <100ms y confía en waitForHealth para el readiness. El health-wait DEBE
// tolerar un provider.init de red (boot lento) sin rendirse — pero seguir acotado
// (never-hang). Verificamos el presupuesto por defecto y que un boot lento-pero-
// eventualmente-200 resuelve true.
describe('waitForHealth: 66-07 timeout acomoda provider.init de red', () => {
  it('timeout por defecto ≥ 10s (presupuesto de provider.init, bounded)', async () => {
    // Reloj virtual: nunca responde 200 → debe rendirse SOLO tras ≥10s (no antes),
    // y ser finito (never-hang).
    let clock = 0;
    const nowFn = () => clock;
    const sleepFn = async (ms) => { clock += ms; };
    const healthy = await waitForHealth('http://x', {}, {
      _fetch: async () => ({ ok: false }),
      _now: nowFn,
      _sleep: sleepFn,
    });
    assert.equal(healthy, false, 'se rinde (bounded, never-hang)');
    assert.ok(clock >= 10000, `el deadline por defecto acomoda ≥10s de boot (fue ${clock}ms)`);
  });

  it('boot lento pero eventualmente-200 dentro del presupuesto → true', async () => {
    let clock = 0;
    const nowFn = () => clock;
    const sleepFn = async (ms) => { clock += ms; };
    let attempts = 0;
    // Simula provider.init lento: los primeros intentos fallan (ECONNREFUSED/no-200),
    // luego responde 200 a los ~5s (dentro del presupuesto por defecto).
    const healthy = await waitForHealth('http://x', {}, {
      _fetch: async () => {
        attempts += 1;
        if (clock < 5000) throw new Error('ECONNREFUSED');
        return { ok: true };
      },
      _now: nowFn,
      _sleep: sleepFn,
    });
    assert.equal(healthy, true, 'un boot de red lento-pero-exitoso resuelve true');
    assert.ok(attempts > 1, 'reintentó durante el boot');
  });
});
