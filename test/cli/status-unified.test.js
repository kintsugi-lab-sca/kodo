// @ts-check
//
// test/cli/status-unified.test.js — Plan 66-02 Task 2 (UP-05, D-04, DX-06).
//
// Prueba `runStatusUnified` de src/cli/stop-status.js: status DAEMON-FIRST con
// `--json` byte-DETERMINISTA. Verifica que:
//   - running + json → stdout EXACTO `{"status":"running","pid":123}\n` (byte-comparado).
//   - idle + json → stdout EXACTO `{"status":"idle","pid":null}\n`.
//   - Las 2 keys {status, pid} presentes SIEMPRE, mismo orden, sin ANSI en la rama json.
//   - Rama TTY (json:false) escribe legible; retorna 0 en ambas ramas.
// La comparación del --json es con `===` (byte-exacto), NO assert.match — el
// determinismo es el contrato (Pitfall #10). TODO por DI, sin daemon real.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runStatusUnified } from '../../src/cli/stop-status.js';

/** Deps base: statusDaemon inyectable + captura de stdout. */
function makeDeps(overrides = {}) {
  const calls = { out: [] };
  const deps = {
    _statusDaemon: () => ({ status: 'running', pid: 123 }),
    _write: (s) => { calls.out.push(s); },
    // stream no-TTY → createFormatter no colorea (bytes limpios en la rama TTY del test).
    _stdout: { isTTY: false },
    ...overrides,
  };
  return { deps, calls };
}

describe('runStatusUnified', () => {
  it('running + json:true → stdout EXACTO {"status":"running","pid":123}\\n (byte-comparado)', async () => {
    const { deps, calls } = makeDeps();
    const code = await runStatusUnified({ json: true }, deps);
    assert.equal(code, 0);
    assert.equal(calls.out.length, 1);
    assert.equal(calls.out[0], '{"status":"running","pid":123}\n');
  });

  it('idle + json:true → stdout EXACTO {"status":"idle","pid":null}\\n', async () => {
    const { deps, calls } = makeDeps({
      _statusDaemon: () => ({ status: 'idle', pid: null }),
    });
    const code = await runStatusUnified({ json: true }, deps);
    assert.equal(code, 0);
    assert.equal(calls.out[0], '{"status":"idle","pid":null}\n');
  });

  it('json: keys {status, pid} SIEMPRE presentes, mismo orden, sin ANSI', async () => {
    const { deps, calls } = makeDeps();
    await runStatusUnified({ json: true }, deps);
    const line = calls.out[0];
    // Sin secuencias ANSI (ESC).
    assert.ok(!/\x1b\[/.test(line), 'la rama json no debe contener ANSI');
    const parsed = JSON.parse(line);
    assert.deepEqual(Object.keys(parsed), ['status', 'pid'], 'orden y presencia de keys fijos');
  });

  it('TTY (json:false) running → escribe legible con pid; retorna 0', async () => {
    const { deps, calls } = makeDeps();
    const code = await runStatusUnified({}, deps);
    assert.equal(code, 0);
    assert.ok(calls.out.some((s) => /running/.test(s)));
    assert.ok(calls.out.some((s) => /pid: 123/.test(s)));
  });

  it('TTY (json:false) idle → escribe stopped; retorna 0', async () => {
    const { deps, calls } = makeDeps({
      _statusDaemon: () => ({ status: 'idle', pid: null }),
    });
    const code = await runStatusUnified({}, deps);
    assert.equal(code, 0);
    assert.ok(calls.out.some((s) => /stopped/.test(s)));
  });
});
