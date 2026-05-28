// @ts-check
//
// test/dashboard/app-focus.test.js — Phase 37 Plan 02 Wave 0 RED (TUI-13/TUI-14).
//
// Integration tests con ink-testing-library para los 3 contratos load-bearing del Enter
// handler de App.js:
//   1. alive===false guard (D-02): Enter sobre fila zombie NUNCA invoca onFocus, footer
//      rojo con mensaje literal canónico FOCUS_ERR_ZOMBIE.
//   2. ok path (TUI-13 criterio #1): Enter sobre fila alive invoca onFocus exactamente
//      UNA vez con `row.workspace_ref` literal; cero footer-error.
//   3. clear-on-any-input (D-04): con focusError visible, cualquier tecla limpia el state,
//      restaura el footer normal `↑↓ move · / filter · q quit`, NO propaga al handler.
//
// Patrón espejo de test/dashboard-render.test.js — `ink-testing-library` + `render` +
// `stdin.write` + `lastFrame()` + `tick(80ms)` (80ms load-bearing: más corto es flakey
// en CI, más largo es lento).
//
// Wave 0 RED status: el archivo falla inicialmente porque App.js aún no exporta
// FOCUS_ERR_ZOMBIE, ni acepta la prop `onFocus`, ni tiene el state focusError ni el Enter
// handler. Task 2 (App.js) + Task 3 (SessionTable.js) lo ponen GREEN.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App, { FOCUS_ERR_ZOMBIE } from '../../src/cli/dashboard/App.js';

// 80ms es load-bearing — coincide con el tick de test/dashboard-render.test.js. Por debajo
// es flakey en CI (ink necesita un frame para procesar el keystroke + el siguiente render);
// por encima es lento sin beneficio.
const tick = () => new Promise((r) => setTimeout(r, 80));

/**
 * Construye un fetchFn fake que retorna el array de sesiones en un payload con la forma
 * que espera fetchStatus (`{sessions, count, pending}`). El primer poll resuelve con
 * status 200 + ok:true.
 *
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
 * Construye un SessionRecord fixture completo. Todos los campos son LOAD-BEARING porque
 * sortSessions/applyFilter/rowCells los leen — si falta alguno el render explota o muestra
 * '—' silenciosamente, ocultando el bug.
 *
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
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('Phase 37 Plan 02: Enter handler + alive guard + clear-on-any-input', () => {
  it('alive=false guard: Enter sobre fila zombie NO llama onFocus y muestra footer rojo', async () => {
    let focusCalls = 0;
    const onFocus = async () => {
      focusCalls++;
      return { ok: true };
    };
    const fakeFetch = makeFetch([sessionFixture({ task_id: 'Z-1', alive: false })]);

    const { stdin, lastFrame } = render(
      createElement(App, {
        baseUrl: 'http://localhost:9090',
        fetchFn: fakeFetch,
        onFocus,
      }),
    );

    await tick(); // primer poll resuelve + render
    stdin.write('\r'); // Enter
    await tick();

    assert.equal(
      focusCalls,
      0,
      'onFocus NUNCA debe llamarse con alive:false (D-02 guard pre-flight)',
    );
    // Asserta contra la constante exportada (no string duplicada — elimina drift D-05).
    assert.match(
      lastFrame(),
      /workspace gone \(alive=false\) — press any key/,
      `footer-error rojo D-04 ausente.\nframe:\n${lastFrame()}`,
    );
    // Sanity: la constante exportada debe coincidir con el regex assertado.
    assert.equal(
      FOCUS_ERR_ZOMBIE,
      '[!] workspace gone (alive=false) — press any key',
      'FOCUS_ERR_ZOMBIE debe ser la string canónica D-05',
    );
  });

  it('ok path: Enter sobre fila alive llama onFocus con workspace_ref literal y NO renderiza error', async () => {
    let focusCalls = 0;
    let capturedRef = null;
    const onFocus = async (/** @type {string} */ ref) => {
      focusCalls++;
      capturedRef = ref;
      return { ok: true };
    };
    const fakeFetch = makeFetch([
      sessionFixture({ task_id: 'A-1', alive: true, workspace_ref: 'workspace:9' }),
    ]);

    const { stdin, lastFrame } = render(
      createElement(App, {
        baseUrl: 'http://localhost:9090',
        fetchFn: fakeFetch,
        onFocus,
      }),
    );

    await tick(); // primer poll + render
    stdin.write('\r'); // Enter
    await tick();

    assert.equal(focusCalls, 1, 'onFocus invocada exactamente una vez (TUI-13 criterio #1)');
    assert.equal(
      capturedRef,
      'workspace:9',
      'workspace_ref propagado literal desde row.workspace_ref',
    );
    assert.doesNotMatch(
      lastFrame(),
      /\[!\]/,
      `cero footer-error en ok path.\nframe:\n${lastFrame()}`,
    );
  });

  it('clear-on-any-input: cualquier tecla limpia focusError y restaura footer normal (D-04)', async () => {
    let focusCalls = 0;
    const onFocus = async () => {
      focusCalls++;
      return { ok: true };
    };
    const fakeFetch = makeFetch([sessionFixture({ task_id: 'Z-1', alive: false })]);

    const { stdin, lastFrame } = render(
      createElement(App, {
        baseUrl: 'http://localhost:9090',
        fetchFn: fakeFetch,
        onFocus,
      }),
    );

    await tick(); // primer poll + render
    stdin.write('\r'); // Enter sobre zombie → footer rojo
    await tick();
    assert.match(
      lastFrame(),
      /workspace gone/,
      `pre-condition: footer-error D-04 visible tras Enter sobre zombie.\nframe:\n${lastFrame()}`,
    );

    stdin.write('x'); // cualquier tecla → consume el dismiss
    await tick();

    assert.doesNotMatch(
      lastFrame(),
      /workspace gone/,
      `focusError debe limpiarse en la siguiente tecla (D-04).\nframe:\n${lastFrame()}`,
    );
    assert.match(
      lastFrame(),
      /↑↓ move · \/ filter · q quit/,
      `footer normal debe restaurarse al limpiar focusError.\nframe:\n${lastFrame()}`,
    );
    assert.equal(
      focusCalls,
      0,
      'la tecla x consume el dismiss (clear-on-any-input), NO propaga al handler de Enter',
    );
  });
});
