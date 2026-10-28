// @ts-check
//
// test/send-back-cli.test.js — KODO-109. Exit codes de `kodo send-back` (espejo de comment-cli):
// 0 ok · 1 error del operador · 2 transient. Todo inyectado: cero red, cero state.json real.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSendBackCli } from '../src/cli/send-back.js';

const CONFIG = {
  provider: 'plane',
  providers: { plane: { states: { trigger: 'In Progress', review: 'In review' } } },
};

const plainFmt = () => /** @type {any} */ ({ red: (s) => s, yellow: (s) => s, green: (s) => s, ok: (s) => s });

function deps({ taskState = 'In review', failMove = false } = {}) {
  const out = { stdout: '', stderr: '', persisted: /** @type {any[]} */ ([]) };
  return {
    out,
    deps: {
      loadConfigFn: () => CONFIG,
      getProviderFn: () => ({
        getTask: async (ref) => ({ id: 't1', projectId: 'p1', ref, state: taskState }),
        addComment: async () => {},
        updateTaskState: async () => {
          if (failMove) throw new Error('503');
        },
      }),
      setSendBackFn: (id, v) => {
        out.persisted.push([id, v]);
        return { ok: true };
      },
      writeFn: (s) => { out.stdout += s; },
      errFn: (s) => { out.stderr += s; },
      formatterFn: plainFmt,
    },
  };
}

describe('runSendBackCli', () => {
  it('ok → 0 y JSON con el estado de destino', async () => {
    const { out, deps: d } = deps();
    const code = await runSendBackCli({ ref: 'KODO-1', text: 'falta x', json: true }, d);
    assert.equal(code, 0);
    assert.equal(JSON.parse(out.stdout).state, 'In Progress');
  });

  it('tarea fuera de revisión → 1', async () => {
    const { out, deps: d } = deps({ taskState: 'Done' });
    assert.equal(await runSendBackCli({ ref: 'KODO-1', text: 'x' }, d), 1);
    assert.match(out.stderr, /NOT_IN_REVIEW/);
  });

  it('move fallido → 2, con el feedback persistido y retirado', async () => {
    const { out, deps: d } = deps({ failMove: true });
    assert.equal(await runSendBackCli({ ref: 'KODO-1', text: 'x' }, d), 2);
    assert.match(out.stderr, /MOVE_FAILED \(transient\)/);
    assert.equal(out.persisted.at(-1)[1], null, 'el último write retira el feedback');
  });
});
