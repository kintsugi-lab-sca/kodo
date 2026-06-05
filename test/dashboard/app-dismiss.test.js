// @ts-check
//
// test/dashboard/app-dismiss.test.js — Phase 42 Plan 02 Wave 0 RED (DISMISS-02, DISMISS-04 TUI).
//
// Integration-light con ink-testing-library para la state machine de `mode:'confirm'` + el
// handler `d` + el guard inverso `alive===true` + el footer transitorio derivado de actions[].
// Cubre los contratos load-bearing de Task 2:
//   (a) `d` sobre fila dead → frame muestra DISMISS_CONFIRM (armado, persistente).
//   (b) segundo `d` → fetchFn recibe UN DELETE → frame muestra DISMISS_OK; un fake moved-dirty
//       → DISMISS_PARTIAL_DIRTY.
//   (c) `d` sobre fila viva → frame muestra DISMISS_GUARD_ALIVE, cero DELETE, nunca entra en confirm.
//   (d) `d` (arma) luego 'x' → cancela a list, cero DELETE.
//   (e) `d` (arma) luego Esc → cancela.
//   (f) mensaje de resultado transitorio presente + siguiente tecla → mensaje limpiado.
//
// Harness hermético (molde dashboard-overlay.test.js): fake clock + router por URL. El router
// cuenta los DELETE (T-42-06/07: aserción de cero DELETE en cancel/guard). RESEARCH Pitfall 5:
// ink NO awaitea el handler async → el segundo `d` puede necesitar DOS `await drain()`.
//
// Wave 0 RED: falla hasta que App.js exporte DISMISS_* y tenga el mode:'confirm' + handler `d`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App, {
  DISMISS_CONFIRM,
  DISMISS_GUARD_ALIVE,
  DISMISS_OK,
  DISMISS_PARTIAL_DIRTY,
} from '../../src/cli/dashboard/App.js';

// ── Fake clock (idéntico a dashboard-overlay.test.js) ────────────────────────
function makeFakeClock(startMs = 1_000_000) {
  /** @type {Array<{ handle: number, fn: Function }>} */
  let pending = [];
  let nextHandle = 1;
  let nowMs = startMs;
  const schedule = (fn) => {
    const handle = nextHandle++;
    pending.push({ handle, fn });
    return handle;
  };
  const cancel = (handle) => {
    pending = pending.filter((p) => p.handle !== handle);
  };
  let nextTimeoutHandle = 10000;
  const scheduleTimeout = () => nextTimeoutHandle++;
  const cancelTimeout = () => {};
  const flushTick = async () => {
    const entry = pending.pop();
    if (!entry) return false;
    await entry.fn();
    return true;
  };
  return {
    schedule,
    cancel,
    scheduleTimeout,
    cancelTimeout,
    flushTick,
    now: () => nowMs,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

function injectProps(clock, fetchFn) {
  return {
    baseUrl: 'http://localhost:9090',
    fetchFn,
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    scheduleTimeout: clock.scheduleTimeout,
    cancelTimeout: clock.cancelTimeout,
  };
}

async function drain() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

// Fixture: KL-2 (task_id 'b', alive:false → dead) NO es la fila inicial seleccionada.
// KL-1 (task_id 'a', alive:true → live) es la newest, arriba, seleccionada por defecto.
const STATUS_FIXTURE = {
  count: 2,
  sessions: [
    {
      task_id: 'a',
      task_ref: 'KL-1',
      workspace_ref: 'ws-a',
      status: 'running',
      alive: true,
      started_at: '2026-05-27T10:00:00Z',
      project_name: 'kodo',
      elapsed_min: 5,
      summary: '',
    },
    {
      task_id: 'b',
      task_ref: 'KL-2',
      workspace_ref: 'ws-b',
      status: 'running',
      alive: false,
      started_at: '2026-05-27T09:00:00Z',
      project_name: 'kodo',
      elapsed_min: 63,
      summary: '',
    },
  ],
};

/**
 * Router por URL que CUENTA los DELETE. `deleteBody` factory decide la respuesta del DELETE.
 * Devuelve `{ fetchFn, deletes }` donde `deletes` es un array de los task_id eliminados.
 */
function makeRouter({ status = STATUS_FIXTURE, deleteBody } = {}) {
  /** @type {string[]} */
  const deletes = [];
  const fetchFn = async (/** @type {string} */ url, /** @type {any} */ init) => {
    const u = String(url);
    if (u.endsWith('/status')) return okResponse(status);
    if (u.includes('/sessions/') && init?.method === 'DELETE') {
      const id = decodeURIComponent(u.split('/sessions/')[1]);
      deletes.push(id);
      if (typeof deleteBody === 'function') return deleteBody(id);
      return okResponse({ ok: true, removed: id, actions: [{ type: 'worktree', result: 'removed' }] });
    }
    if (u.endsWith('/comments/' + 'x') || u.includes('/comments/')) return okResponse({ comments: [] });
    if (u.endsWith('/logs')) return okResponse({ logs: [] });
    return okResponse(status);
  };
  return { fetchFn, deletes };
}

describe('DISMISS-02: state machine arma/confirma/cancela', () => {
  it('(a) d sobre fila dead arma el confirm (DISMISS_CONFIRM visible, sin DELETE)', async () => {
    const clock = makeFakeClock();
    const { fetchFn, deletes } = makeRouter();
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('\x1b[B'); // ↓ baja el cursor a KL-2 (dead)
      await drain();
      stdin.write('d'); // arma
      await drain();
      const frame = lastFrame();
      assert.match(frame, new RegExp(DISMISS_CONFIRM('KL-2').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `d sobre dead debe armar el confirm\n${frame}`);
      assert.equal(deletes.length, 0, 'armar NO debe disparar DELETE');
    } finally {
      unmount();
    }
  });

  it('(b) segundo d dispara UN DELETE y muestra DISMISS_OK', async () => {
    const clock = makeFakeClock();
    const { fetchFn, deletes } = makeRouter();
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('\x1b[B'); // ↓ a KL-2 (dead)
      await drain();
      stdin.write('d'); // arma
      await drain();
      stdin.write('d'); // confirma
      await drain();
      await drain(); // Pitfall 5: ink no awaitea el handler async
      const frame = lastFrame();
      assert.equal(deletes.length, 1, 'segundo d debe disparar exactamente un DELETE');
      assert.equal(deletes[0], 'b', 'el DELETE va contra el task_id (identidad), no el task_ref');
      assert.match(frame, new RegExp(DISMISS_OK('KL-2').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `segundo d debe mostrar DISMISS_OK\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('(b2) moved-dirty en actions[] → DISMISS_PARTIAL_DIRTY', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter({
      deleteBody: (id) =>
        okResponse({ ok: true, removed: id, actions: [{ type: 'worktree', result: 'moved-dirty' }] }),
    });
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('\x1b[B');
      await drain();
      stdin.write('d');
      await drain();
      stdin.write('d');
      await drain();
      await drain();
      const frame = lastFrame();
      assert.match(frame, new RegExp(DISMISS_PARTIAL_DIRTY('KL-2').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `moved-dirty → DISMISS_PARTIAL_DIRTY\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('(d) arma luego "x" cancela a list sin DELETE', async () => {
    const clock = makeFakeClock();
    const { fetchFn, deletes } = makeRouter();
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('\x1b[B');
      await drain();
      stdin.write('d'); // arma
      await drain();
      stdin.write('x'); // cualquier tecla ≠ d/Esc cancela (D-04)
      await drain();
      const frame = lastFrame();
      assert.equal(deletes.length, 0, 'cancelar con tecla random NO debe disparar DELETE');
      assert.doesNotMatch(frame, new RegExp(DISMISS_CONFIRM('KL-2').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `tras cancelar, el confirm ya no debe estar armado\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('(e) arma luego Esc cancela', async () => {
    const clock = makeFakeClock();
    const { fetchFn, deletes } = makeRouter();
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('\x1b[B');
      await drain();
      stdin.write('d'); // arma
      await drain();
      stdin.write('\x1b'); // Esc cancela
      await drain();
      const frame = lastFrame();
      assert.equal(deletes.length, 0, 'Esc NO debe disparar DELETE');
      assert.doesNotMatch(frame, new RegExp(DISMISS_CONFIRM('KL-2').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `tras Esc, el confirm ya no debe estar armado\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('DISMISS-04/SC#2: guard inverso alive===true (TUI layer)', () => {
  it('(c) d sobre fila viva muestra DISMISS_GUARD_ALIVE, cero DELETE, no entra en confirm', async () => {
    const clock = makeFakeClock();
    const { fetchFn, deletes } = makeRouter();
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      // KL-1 (alive:true) es la fila seleccionada por defecto (newest, arriba).
      stdin.write('d');
      await drain();
      const frame = lastFrame();
      assert.match(frame, new RegExp(DISMISS_GUARD_ALIVE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `d sobre viva debe mostrar el guard rojo\n${frame}`);
      assert.equal(deletes.length, 0, 'd sobre viva NO debe disparar DELETE');
      // NO entró en confirm: el armed prompt no está presente.
      assert.doesNotMatch(frame, new RegExp(DISMISS_CONFIRM('KL-1').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `d sobre viva NUNCA debe armar el confirm\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('D-12: el mensaje de resultado transitorio se limpia con la siguiente tecla', () => {
  it('(f) tras un guard message, la siguiente tecla lo limpia (clear-on-any-input)', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('d'); // sobre KL-1 viva → guard message (transitorio)
      await drain();
      assert.match(lastFrame(), new RegExp(DISMISS_GUARD_ALIVE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `precondición: el guard message está visible`);
      stdin.write('j'); // tecla cualquiera → limpia el mensaje
      await drain();
      const frame = lastFrame();
      assert.doesNotMatch(frame, new RegExp(DISMISS_GUARD_ALIVE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `el mensaje transitorio debe limpiarse con la siguiente tecla\n${frame}`);
    } finally {
      unmount();
    }
  });
});
