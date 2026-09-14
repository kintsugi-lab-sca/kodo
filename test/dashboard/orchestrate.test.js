// @ts-check
//
// test/dashboard/orchestrate.test.js — KODO-89.
//
// Contrato del runner never-throws `runOrchestrate` (shell de `kodo orchestrate` para la tecla `O`):
// argv literal, mapeo de fallos al discriminado y leak guard sin `exec`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runOrchestrate } from '../../src/cli/dashboard/orchestrate.js';

const BASE = { execPath: '/usr/bin/node', kodoBin: '/repo/bin/kodo' };

describe('runOrchestrate', () => {
  it('argv literal: node <kodoBin> orchestrate, con timeout', async () => {
    /** @type {any} */
    let captured;
    const exec = (/** @type {string} */ cmd, /** @type {string[]} */ args, /** @type {any} */ opts, /** @type {Function} */ cb) => {
      captured = { cmd, args, opts };
      setImmediate(() => cb(null, '✓ Orchestrator launched at workspace:80\n', ''));
    };
    const result = await runOrchestrate({ exec, ...BASE });
    assert.deepEqual(result, { ok: true });
    assert.equal(captured.cmd, '/usr/bin/node');
    assert.deepEqual(captured.args, ['/repo/bin/kodo', 'orchestrate']);
    assert.equal(typeof captured.opts.timeout, 'number');
  });

  it('exit ≠ 0 → NON_ZERO_EXIT con el stderr del CLI', async () => {
    const exec = (/** @type {string} */ _c, /** @type {string[]} */ _a, /** @type {any} */ _o, /** @type {Function} */ cb) => {
      setImmediate(() => cb(Object.assign(new Error('failed'), { code: 1 }), '', 'Error: boom\n'));
    };
    const result = await runOrchestrate({ exec, ...BASE });
    assert.deepEqual(result, { ok: false, code: 'NON_ZERO_EXIT', detail: 1, stderr: 'Error: boom' });
  });

  it('ENOENT y fallos sin código numérico se discriminan', async () => {
    const enoent = await runOrchestrate({
      exec: (_c, _a, _o, cb) => setImmediate(() => cb(Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT' }), '', '')),
      ...BASE,
    });
    assert.equal(enoent.ok === false && enoent.code, 'ENOENT');

    const killed = await runOrchestrate({
      exec: (_c, _a, _o, cb) => setImmediate(() => cb(Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }), '', '')),
      ...BASE,
    });
    assert.deepEqual(killed, { ok: false, code: 'SPAWN_ERROR', detail: 'timed out' });
  });

  it('never-throws: exec que lanza síncronamente → SPAWN_ERROR', async () => {
    const result = await runOrchestrate({ exec: () => { throw new Error('sync'); }, ...BASE });
    assert.deepEqual(result, { ok: false, code: 'SPAWN_ERROR', detail: 'sync' });
  });

  it('leak guard: sin `exec` lanza TypeError (jamás cae al execFile real)', () => {
    // @ts-expect-error — omisión deliberada
    assert.throws(() => runOrchestrate({ ...BASE }), TypeError);
  });
});
