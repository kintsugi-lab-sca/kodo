// @ts-check
//
// test/dashboard/app-send-back.test.js — KODO-109.
//
// La tecla `b` del dashboard: guard de «solo tareas en revisión», text-input del feedback,
// confirmación y desenlace del runner `onSendBack` (shell de `kodo send-back`) en el footer.
// Harness: molde de app-dismiss.test.js (fake clock + router por URL, tick de 80 ms).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App from '../../src/cli/dashboard/App.js';
import {
  SEND_BACK_GUARD,
  SEND_BACK_EDIT_HINT,
  SEND_BACK_OK,
  SEND_BACK_ERR,
} from '../../src/cli/dashboard/RowActions.js';

function makeFakeClock() {
  /** @type {Array<{ handle: number, fn: Function }>} */
  let pending = [];
  let next = 1;
  return {
    schedule: (fn) => {
      const handle = next++;
      pending.push({ handle, fn });
      return handle;
    },
    cancel: (handle) => {
      pending = pending.filter((p) => p.handle !== handle);
    },
    scheduleTimeout: () => next++,
    cancelTimeout: () => {},
    now: () => 1_000_000,
  };
}

function drain() {
  return new Promise((resolve) => setTimeout(resolve, 80));
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function row(overrides) {
  return {
    workspace_ref: 'ws-a',
    status: 'idle',
    state: 'idle',
    alive: true,
    started_at: '2026-10-28T09:00:00Z',
    project_name: 'kodo',
    elapsed_min: 5,
    summary: '',
    provider_state_reason: null,
    ...overrides,
  };
}

/** @param {any} sessionRow @param {(args: any) => Promise<any>} onSendBack */
function renderApp(sessionRow, onSendBack) {
  const clock = makeFakeClock();
  const status = { count: 1, sessions: [sessionRow] };
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => status });
  return render(createElement(App, {
    baseUrl: 'http://localhost:9090',
    fetchFn,
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    scheduleTimeout: clock.scheduleTimeout,
    cancelTimeout: clock.cancelTimeout,
    readTasksFn: () => ({}),
    inboxCountFn: () => 0,
    queueCountFn: () => 0,
    onSendBack,
  }));
}

/** Teclea un texto carácter a carácter (ink procesa cada write como una pulsación). */
async function type(stdin, text) {
  for (const ch of text) {
    stdin.write(ch);
    await drain();
  }
}

describe('KODO-109 — tecla b (send back)', () => {
  it('b + texto + Enter + Enter invoca onSendBack con ref y feedback y pinta el éxito', async () => {
    const calls = [];
    const onSendBack = async (args) => {
      calls.push(args);
      return { ok: true, stdout: '{}' };
    };
    const { lastFrame, stdin, unmount } = renderApp(
      row({ task_id: 't1', task_ref: 'KODO-1', provider_state: 'in_review' }),
      onSendBack,
    );
    try {
      await drain();
      stdin.write('b');
      await drain();
      assert.match(lastFrame(), new RegExp(esc(SEND_BACK_EDIT_HINT)), lastFrame());
      await type(stdin, 'falta x');
      assert.match(lastFrame(), /send back KODO-1 — feedback: falta x/, lastFrame());
      stdin.write('\r'); // → confirmación
      await drain();
      assert.match(lastFrame(), /with this feedback\? Enter send/, lastFrame());
      assert.equal(calls.length, 0, 'confirmar es un segundo paso');
      stdin.write('\r'); // → ejecuta
      await drain();
      await drain();
      assert.deepEqual(calls, [{ ref: 'KODO-1', text: 'falta x' }]);
      assert.match(lastFrame(), new RegExp(esc(SEND_BACK_OK('KODO-1'))), lastFrame());
    } finally {
      unmount();
    }
  });

  it('si el provider falla, el footer muestra el error del CLI', async () => {
    const onSendBack = async () => ({
      ok: false,
      code: 'NON_ZERO_EXIT',
      detail: 2,
      stderr: 'MOVE_FAILED (transient): 503 move',
    });
    const { lastFrame, stdin, unmount } = renderApp(
      row({ task_id: 't1', task_ref: 'KODO-1', provider_state: 'in_review' }),
      onSendBack,
    );
    try {
      await drain();
      stdin.write('b');
      await drain();
      await type(stdin, 'x');
      stdin.write('\r');
      await drain();
      stdin.write('\r');
      await drain();
      await drain();
      assert.match(lastFrame(), new RegExp(esc(SEND_BACK_ERR('MOVE_FAILED (transient): 503 move'))), lastFrame());
    } finally {
      unmount();
    }
  });

  it('b sobre una tarea que no está en revisión: guard, sin text-input ni llamada', async () => {
    let called = false;
    const { lastFrame, stdin, unmount } = renderApp(
      row({ task_id: 't1', task_ref: 'KODO-1', provider_state: 'in_progress' }),
      async () => {
        called = true;
        return { ok: true, stdout: '' };
      },
    );
    try {
      await drain();
      stdin.write('b');
      await drain();
      assert.match(lastFrame(), new RegExp(esc(SEND_BACK_GUARD)), lastFrame());
      assert.doesNotMatch(lastFrame(), new RegExp(esc(SEND_BACK_EDIT_HINT)));
      assert.equal(called, false);
    } finally {
      unmount();
    }
  });

  it('Esc en la edición cancela sin llamar', async () => {
    let called = false;
    const { lastFrame, stdin, unmount } = renderApp(
      row({ task_id: 't1', task_ref: 'KODO-1', provider_state: 'in_review' }),
      async () => {
        called = true;
        return { ok: true, stdout: '' };
      },
    );
    try {
      await drain();
      stdin.write('b');
      await drain();
      await type(stdin, 'algo');
      stdin.write('\x1b');
      await drain();
      assert.doesNotMatch(lastFrame(), /send back KODO-1/);
      assert.equal(called, false);
    } finally {
      unmount();
    }
  });
});
