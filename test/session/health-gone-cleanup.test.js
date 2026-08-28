// @ts-check
//
// test/session/health-gone-cleanup.test.js — KODO-47.
//
// HOME aislado ANTES de cualquier dynamic import: `actOnHealth` resuelve el host desde
// la config del operador, y sin aislar leería (y podría tocar) su ~/.kodo real.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
process.env.HOME = mkdtempSync(joinPath(tmpdir(), 'kodo-health-test-'));

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/** Captura console.log/warn del pase para poder asertar QUÉ se afirmó. */
function captureConsole() {
  const logs = [];
  const warns = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...args) => logs.push(args.join(' '));
  console.warn = (...args) => warns.push(args.join(' '));
  return {
    logs,
    warns,
    restore() {
      console.log = origLog;
      console.warn = origWarn;
    },
  };
}

const GONE = [{ taskId: 'task-uuid-1', ref: 'KL-42', health: 'gone', elapsed_min: 30 }];

describe('KODO-47 actOnHealth — el log de limpieza sigue al retorno del mutador', () => {
  let cap;
  beforeEach(() => { cap = captureConsole(); });
  afterEach(() => { cap.restore(); });

  it('removeSession en lock-timeout → warn explícito y NINGÚN log que afirme la limpieza', async () => {
    const { actOnHealth } = await import('../../src/session/health.js');
    const calls = [];

    await actOnHealth(/** @type {any} */ (GONE), {
      removeSessionFn: (taskId) => {
        calls.push(taskId);
        return { ok: false, reason: 'lock-timeout' };
      },
    });

    assert.deepEqual(calls, ['task-uuid-1']);
    assert.equal(
      cap.logs.find((l) => l.includes('cleaned up')),
      undefined,
      'no se afirma una limpieza que no se escribió',
    );
    const warn = cap.warns.find((w) => w.includes('KL-42'));
    assert.ok(warn, 'avisa por warn');
    assert.match(warn, /lock-timeout/);
    assert.match(warn, /NO aplicada/);
  });

  it('removeSession con éxito → log de limpieza y cero warns', async () => {
    const { actOnHealth } = await import('../../src/session/health.js');

    await actOnHealth(/** @type {any} */ (GONE), {
      removeSessionFn: () => ({ ok: true }),
    });

    assert.ok(cap.logs.find((l) => l.includes('KL-42') && l.includes('cleaned up')));
    assert.deepEqual(cap.warns, []);
  });

  it('un mutador que devuelve undefined (contrato previo a WR-01) se trata como éxito', async () => {
    const { actOnHealth } = await import('../../src/session/health.js');

    await actOnHealth(/** @type {any} */ (GONE), { removeSessionFn: () => undefined });

    assert.ok(cap.logs.find((l) => l.includes('cleaned up')));
    assert.deepEqual(cap.warns, []);
  });
});
