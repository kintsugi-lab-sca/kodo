// @ts-check
//
// test/cli/stop-unified.test.js — Plan 66-02 Task 1 (UP-05, D-04).
//
// Prueba `runStopUnified` de src/cli/stop-status.js: la lógica DAEMON-FIRST con
// fallback legacy server.pid. Verifica que:
//   - {stopped}/{stale} de stopDaemon → NO se invoca el fallback stopServer.
//   - {notRunning} → SÍ se invoca stopServer exactamente 1× (back-compat kodo start).
//   - never-throws: un stopServer que lanza NO crashea el handler.
// TODO por DI (fakes de stopDaemon/stopServer + captura de stdout/stderr); sin
// procesos, señales ni server.js reales.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runStopUnified } from '../../src/cli/stop-status.js';

/** Formatter fake: identidad sin ANSI (bytes predecibles en los asserts). */
const fakeFmt = {
  ok: (s) => s,
  fail: (s) => s,
  dim: (s) => s,
  green: (s) => s,
  yellow: (s) => s,
  red: (s) => s,
  cyan: (s) => s,
  gray: (s) => s,
  debug: (s) => s,
  info: (s) => s,
  warn: (s) => s,
  error: (s) => s,
  formatRow: (c) => c.join(' '),
  formatTable: (r) => r.map((x) => x.join(' ')).join('\n'),
};

/** Deps base: stopDaemon inyectable, stopServer espiado, stdout/stderr capturados. */
function makeDeps(overrides = {}) {
  const calls = { stopServer: 0, out: [], err: [] };
  const deps = {
    _stopDaemon: async () => ({ ok: true, stopped: true, pid: 123 }),
    _stopServer: () => { calls.stopServer += 1; return true; },
    _write: (s) => { calls.out.push(s); },
    _err: (s) => { calls.err.push(s); },
    _fmt: fakeFmt,
    ...overrides,
  };
  return { deps, calls };
}

describe('runStopUnified', () => {
  it('stopDaemon {stopped:true} → NO invoca stopServer; retorna 0', async () => {
    const { deps, calls } = makeDeps();
    const code = await runStopUnified({}, deps);
    assert.equal(code, 0);
    assert.equal(calls.stopServer, 0, 'fallback legacy NO debe invocarse si el daemon estaba vivo');
    assert.ok(calls.out.some((s) => /stopped/.test(s)));
    assert.ok(calls.out.some((s) => /pid: 123/.test(s)));
  });

  it('stopDaemon {stale:true} → NO invoca stopServer; retorna 0', async () => {
    const { deps, calls } = makeDeps({
      _stopDaemon: async () => ({ ok: true, stale: true }),
    });
    const code = await runStopUnified({}, deps);
    assert.equal(code, 0);
    assert.equal(calls.stopServer, 0, 'stale cleanup NO debe caer al fallback');
    assert.ok(calls.out.some((s) => /stopped/.test(s)));
  });

  it('stopDaemon {notRunning:true} → invoca stopServer 1× (fallback legacy); retorna 0', async () => {
    const { deps, calls } = makeDeps({
      _stopDaemon: async () => ({ ok: true, notRunning: true }),
    });
    const code = await runStopUnified({}, deps);
    assert.equal(code, 0);
    assert.equal(calls.stopServer, 1, 'sin daemon debe caer exactamente 1× al server.pid legacy');
  });

  it('never-throws: un stopServer que lanza NO propaga como crash (retorna 0)', async () => {
    const { deps, calls } = makeDeps({
      _stopDaemon: async () => ({ ok: true, notRunning: true }),
      _stopServer: () => { throw new Error('boom'); },
    });
    const code = await runStopUnified({}, deps); // no debe lanzar
    assert.equal(code, 0);
    assert.ok(calls.err.some((s) => /boom/.test(s)), 'el fallo del fallback se avisa por stderr');
  });
});
