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
//      restaura el footer normal `↑↓ move · / filter · d dismiss · q quit`, NO propaga al handler.
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
import { createCmuxHost } from '../../src/host/cmux.js';

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

    const { stdin, lastFrame, unmount } = render(
      createElement(App, {
        baseUrl: 'http://localhost:9090',
        fetchFn: fakeFetch,
        onFocus,
      }),
    );

    try {
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
    } finally {
      // Desmonta para que el cleanup de usePoll cancele el setTimeout recursivo (D-09);
      // sin esto el loop de polling deja el event loop vivo y el runner cuelga.
      unmount();
    }
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

    const { stdin, lastFrame, unmount } = render(
      createElement(App, {
        baseUrl: 'http://localhost:9090',
        fetchFn: fakeFetch,
        onFocus,
      }),
    );

    try {
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
    } finally {
      unmount();
    }
  });

  it('clear-on-any-input: cualquier tecla limpia focusError y restaura footer normal (D-04)', async () => {
    let focusCalls = 0;
    const onFocus = async () => {
      focusCalls++;
      return { ok: true };
    };
    const fakeFetch = makeFetch([sessionFixture({ task_id: 'Z-1', alive: false })]);

    const { stdin, lastFrame, unmount } = render(
      createElement(App, {
        baseUrl: 'http://localhost:9090',
        fetchFn: fakeFetch,
        onFocus,
      }),
    );

    try {
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
        /↑↓ move · \/ filter \(ps:state\) · d dismiss · q quit/,
        `footer normal debe restaurarse al limpiar focusError.\nframe:\n${lastFrame()}`,
      );
      assert.equal(
        focusCalls,
        0,
        'la tecla x consume el dismiss (clear-on-any-input), NO propaga al handler de Enter',
      );
    } finally {
      unmount();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 38 Plan 03 (SC#6 parcial): Phase 37 parity PROGRAMÁTICA sobre
// CmuxHost.selectWorkspace. Per RESEARCH §S7: selectWorkspace delega a runFocus
// y re-exporta su shape sin transformar → enchufado como onFocus, el dashboard
// se comporta idéntico a Phase 37. El UAT HUMANO (4 escenarios reales) vive en
// Plan 04 (38-HUMAN-UAT.md): 2 retest Phase 37 + 2 nuevos idle/needs-input.
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 38 SC#6: Phase 37 parity vía CmuxHost.selectWorkspace', () => {
  it('Escenario 1 (focus ok): Enter sobre fila alive → host.selectWorkspace {ok:true}, sin focusError', async () => {
    // exec fake callback-style (execFile shape): code 0 → runFocus resuelve {ok:true}.
    const execCalls = [];
    const fakeExec = (binary, args, opts, cb) => {
      execCalls.push({ binary, args, opts });
      cb(null, '', ''); // err=null, stdout, stderr → exit 0 (ok)
      return { on() {} };
    };
    const host = createCmuxHost({ exec: fakeExec, binary: 'cmux-test' });

    let onFocusResult = null;
    const onFocus = async (ref) => {
      onFocusResult = await host.selectWorkspace(ref);
      return onFocusResult;
    };
    const fakeFetch = makeFetch([sessionFixture({ task_id: 'A-1', alive: true, workspace_ref: 'workspace:9' })]);

    const { stdin, lastFrame, unmount } = render(
      createElement(App, { baseUrl: 'http://localhost:9090', fetchFn: fakeFetch, onFocus }),
    );

    try {
      await tick();
      stdin.write('\r'); // Enter
      await tick();

      assert.deepEqual(onFocusResult, { ok: true }, 'host.selectWorkspace retorna {ok:true} (shape Phase 37)');
      // exec invocado con los args ordenados verbatim de Phase 37 runFocus.
      assert.equal(execCalls.length, 1, 'exec invocado exactamente una vez');
      assert.equal(execCalls[0].binary, 'cmux-test');
      assert.deepEqual(execCalls[0].args, ['select-workspace', '--workspace', 'workspace:9']);
      assert.equal(execCalls[0].opts?.timeout, 5000, 'timeout 5s (Phase 37 D-08)');
      // cero footer-error en el ok path.
      assert.doesNotMatch(lastFrame(), /\[!\]/, `cero footer-error en focus ok\nframe:\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });

  it('Escenario 2 (zombie reject): Enter sobre fila alive=false NO invoca host.selectWorkspace', async () => {
    const execCalls = [];
    const fakeExec = (binary, args, opts, cb) => {
      execCalls.push({ binary, args });
      cb(null, '', '');
      return { on() {} };
    };
    const host = createCmuxHost({ exec: fakeExec, binary: 'cmux-test' });

    let selectCalls = 0;
    const onFocus = async (ref) => {
      selectCalls++;
      return host.selectWorkspace(ref);
    };
    const fakeFetch = makeFetch([sessionFixture({ task_id: 'Z-1', alive: false })]);

    const { stdin, lastFrame, unmount } = render(
      createElement(App, { baseUrl: 'http://localhost:9090', fetchFn: fakeFetch, onFocus }),
    );

    try {
      await tick();
      stdin.write('\r'); // Enter sobre zombie → guard cortocircuita ANTES de onFocus
      await tick();

      assert.equal(selectCalls, 0, 'el guard alive=false cortocircuita: onFocus/host.selectWorkspace NUNCA se invoca');
      assert.equal(execCalls.length, 0, 'exec NO se invoca en el zombie path');
      assert.match(lastFrame(), /workspace gone \(alive=false\)/, 'footer-error zombie (FOCUS_ERR_ZOMBIE literal Phase 37)');

      // clear-on-any-input Phase 37 D-04 preservado.
      stdin.write('x');
      await tick();
      assert.doesNotMatch(lastFrame(), /workspace gone/, 'cualquier tecla limpia focusError (Phase 37 D-04)');
    } finally {
      unmount();
    }
  });
});
