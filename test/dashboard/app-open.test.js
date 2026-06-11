// @ts-check
//
// test/dashboard/app-open.test.js — Phase 48 Plan 02 (OPEN-01/02/03).
//
// Integration tests con ink-testing-library para el handler `o` de App.js. Clon del harness
// de app-focus.test.js (render + stdin.write('o') + tick(80ms) + lastFrame). Contratos:
//   (a) `o` sobre fila CON task_url → onOpen invocada UNA vez con el task_url literal +
//       footer verde `opening <ref>…` (D-01/D-02). REF = task_ref (no task_id), sin `[!]`.
//   (b) `o` sobre fila SIN task_url → onOpen NUNCA invocada (D-05) + footer bare
//       `no task URL for this session` (sin `[!]`, sin `— press any key`). open jamás recibe
//       un arg falsy/basura (D-05 / SC#2).
//   (c) `o` cuyo onOpen resuelve { ok:false, code:'ENOENT' } → footer
//       `[!] open not found in PATH — press any key` (espejo de FOCUS_ERR_ENOENT).
//   (d) clear-on-any-input (D-03): tras el footer transitorio, cualquier otra tecla restaura
//       la línea de hints (footer limpiado, sin timer dedicado).
//
// D-04 (no alive guard): `o` funciona sobre alive/zombie/dismissed por igual — el ÚNICO guard
// es no-URL. Por eso (a) usa una fila viva y el escenario adversarial usa alive:false sin que
// importe (no se testea aquí el alive, se testea que el único corte es task_url).
//
// 80ms es load-bearing (coincide con app-focus.test.js): por debajo es flakey en CI.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App, {
  OPEN_OK,
  OPEN_ERR_NO_URL,
  OPEN_ERR_ENOENT,
} from '../../src/cli/dashboard/App.js';

const tick = () => new Promise((r) => setTimeout(r, 80));

/**
 * fetchFn fake con la forma que espera fetchStatus (`{sessions, count, pending}`), status 200.
 * @param {Array<object>} sessions
 */
function makeFetch(sessions) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ sessions, count: sessions.length, pending: [] }),
  });
}

/**
 * SessionRecord fixture. Todos los campos son load-bearing (sortSessions/applyFilter/rowCells
 * los leen). `task_url` es OPCIONAL — su ausencia/presencia es lo que (a)/(b) ejercitan.
 * @param {object} [overrides]
 */
function sessionFixture(overrides = {}) {
  return {
    task_id: 'T-1',
    task_ref: 'KL-99',
    workspace_ref: 'workspace:9',
    status: 'running',
    alive: true,
    phase_id: 'p',
    gsd_mode: 'gsd',
    project_name: 'kodo',
    project_path: '/x/kodo',
    summary: 'test session',
    task_url: 'https://tasks.example.com/k-lab/browse/KL-99',
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('Phase 48 Plan 02: o handler — open-in-manager (OPEN-01/02/03)', () => {
  it('(a) o sobre fila con task_url llama onOpen una vez con el url literal + footer verde opening <ref>…', async () => {
    let openCalls = 0;
    let capturedUrl = null;
    const onOpen = async (/** @type {string} */ url) => {
      openCalls++;
      capturedUrl = url;
      return { ok: true };
    };
    const fakeFetch = makeFetch([
      sessionFixture({
        task_id: 'A-1',
        task_ref: 'KL-7',
        task_url: 'https://tasks.example.com/k-lab/browse/KL-7',
      }),
    ]);

    const { stdin, lastFrame, unmount } = render(
      createElement(App, { baseUrl: 'http://localhost:9090', fetchFn: fakeFetch, onOpen }),
    );

    try {
      await tick(); // primer poll + render
      stdin.write('o');
      await tick();

      assert.equal(openCalls, 1, 'onOpen invocada exactamente una vez (OPEN-01)');
      assert.equal(
        capturedUrl,
        'https://tasks.example.com/k-lab/browse/KL-7',
        'task_url propagado literal desde row.task_url',
      );
      assert.match(
        lastFrame(),
        /opening KL-7…/,
        `footer verde de éxito D-01/D-02 ausente.\nframe:\n${lastFrame()}`,
      );
      assert.doesNotMatch(
        lastFrame(),
        /\[!\]/,
        `el footer de éxito NO lleva prefijo [!] (mirror DISMISS_OK).\nframe:\n${lastFrame()}`,
      );
      assert.equal(OPEN_OK('KL-7'), 'opening KL-7…', 'OPEN_OK literal canónico (single-char …)');
    } finally {
      unmount();
    }
  });

  it('(b) o sobre fila SIN task_url: onOpen NUNCA llamada y footer bare no task URL for this session', async () => {
    let openCalls = 0;
    const onOpen = async () => {
      openCalls++;
      return { ok: true };
    };
    // fila sin task_url (legacy row). alive cualquiera — D-04 no usa alive como guard.
    const fakeFetch = makeFetch([sessionFixture({ task_id: 'B-1', task_url: undefined })]);

    const { stdin, lastFrame, unmount } = render(
      createElement(App, { baseUrl: 'http://localhost:9090', fetchFn: fakeFetch, onOpen }),
    );

    try {
      await tick();
      stdin.write('o');
      await tick();

      assert.equal(openCalls, 0, 'onOpen NUNCA se invoca sin task_url (D-05 — open jamás recibe arg falsy)');
      assert.match(
        lastFrame(),
        /no task URL for this session/,
        `footer bare D-05/SC#2 ausente.\nframe:\n${lastFrame()}`,
      );
      assert.doesNotMatch(
        lastFrame(),
        /\[!\]/,
        `el footer no-URL es BARE: sin [!] (D-05 LOCKED).\nframe:\n${lastFrame()}`,
      );
      assert.doesNotMatch(
        lastFrame(),
        /press any key/,
        `el footer no-URL es BARE: sin "— press any key" (D-05 LOCKED).\nframe:\n${lastFrame()}`,
      );
      assert.equal(OPEN_ERR_NO_URL, 'no task URL for this session', 'literal LOCKED (D-05/SC#2)');
    } finally {
      unmount();
    }
  });

  it('(c) o cuyo onOpen resuelve {ok:false, code:ENOENT} muestra [!] open not found in PATH', async () => {
    const onOpen = async () => ({ ok: false, code: 'ENOENT', detail: 'spawn ENOENT' });
    const fakeFetch = makeFetch([
      sessionFixture({ task_id: 'C-1', task_url: 'https://tasks.example.com/x' }),
    ]);

    const { stdin, lastFrame, unmount } = render(
      createElement(App, { baseUrl: 'http://localhost:9090', fetchFn: fakeFetch, onOpen }),
    );

    try {
      await tick();
      stdin.write('o');
      await tick();

      assert.match(
        lastFrame(),
        /\[!\] open not found in PATH — press any key/,
        `footer-error ENOENT D-02 ausente.\nframe:\n${lastFrame()}`,
      );
      assert.equal(
        OPEN_ERR_ENOENT,
        '[!] open not found in PATH — press any key',
        'OPEN_ERR_ENOENT literal canónico (mirror FOCUS_ERR_ENOENT)',
      );
    } finally {
      unmount();
    }
  });

  it('(d) clear-on-any-input: tras el footer transitorio, cualquier tecla restaura la línea de hints (D-03)', async () => {
    const onOpen = async () => ({ ok: true });
    const fakeFetch = makeFetch([
      sessionFixture({ task_id: 'D-1', task_ref: 'KL-3', task_url: 'https://tasks.example.com/x' }),
    ]);

    const { stdin, lastFrame, unmount } = render(
      createElement(App, { baseUrl: 'http://localhost:9090', fetchFn: fakeFetch, onOpen }),
    );

    try {
      await tick();
      stdin.write('o'); // éxito → footer verde opening KL-3…
      await tick();
      assert.match(
        lastFrame(),
        /opening KL-3…/,
        `pre-condition: footer transitorio visible.\nframe:\n${lastFrame()}`,
      );

      stdin.write('x'); // cualquier tecla → consume el footer transitorio (clear-on-any-input)
      await tick();

      assert.doesNotMatch(
        lastFrame(),
        /opening KL-3…/,
        `el footer transitorio debe limpiarse en la siguiente tecla (D-03, sin timer).\nframe:\n${lastFrame()}`,
      );
      assert.match(
        lastFrame(),
        /o open/,
        `la línea de hints (con "o open") debe restaurarse al limpiar el footer.\nframe:\n${lastFrame()}`,
      );
    } finally {
      unmount();
    }
  });
});
