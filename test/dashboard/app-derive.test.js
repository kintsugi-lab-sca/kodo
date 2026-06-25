// @ts-check
//
// test/dashboard/app-derive.test.js — Phase 62 Plan 03 Wave 0 RED (ORCH-02).
//
// Integration-light con ink-testing-library para el flujo derive-then-confirm de la tecla `a`
// (D-08/D-09/D-11). Clon del harness de app-adopt.test.js (injectProps + fake clock + router por
// URL + drain() 80ms — Pitfall 1: ink NO awaitea el handler async). Añade `onDerive` (callback
// never-throws que resuelve {title?,description?}) y captura el arg de `onAdopt` para verificar la
// fusión.
//
// El flujo completo de la tecla `a`:
//   `a` (list) → picker overlay → `a` (arma surface + dispara onDerive) → mode 'deriving'
//   ('derivando título…') → onDerive resuelve {title,description} → mode 'confirm' con la propuesta
//   → `a` (confirma) → onAdopt(armedSurface con title+description fusionados).
//
// Contratos load-bearing (1:1 con VALIDATION.md filas App.js, 8 comportamientos):
//   (1/T1+T3) `a` sobre surface resoluble → frame DERIVE_PROGRESS → tras drain, confirm con propuesta.
//   (2/T4 fail-open) onDerive resuelve {} → confirm degradado (FALLBACK, sin título:/desc:); NO rojo.
//   (3/fusión) el armedSurface que llega a onAdopt lleva el title y description derivados.
//   (4/T5 Esc-en-deriving) onDerive en vuelo, Esc → mode vuelve a list; el resultado tardío NO reabre.
//   (5/keybinding) `a` durante deriving → tragada (no encola un segundo onDerive).
//   (6/never-throws) si onDerive lanzara, el panel ink sigue montado (assert no-crash).
//   (7/T2) projectId none/ambiguous → ADOPT_NO_PROJECT (rojo), NO entra en deriving, cero onDerive.
//   (8/once) onDerive llamado EXACTAMENTE una vez por armado.
//
// Wave 0 RED: falla hasta que App.js exporte DERIVE_PROGRESS/ADOPT_DERIVED_CONFIRM/
// ADOPT_DERIVED_CONFIRM_FALLBACK y tenga el estado 'deriving' + await onDerive + fusión.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App, {
  ADOPT_NO_PROJECT,
  DERIVE_PROGRESS,
  ADOPT_DERIVED_CONFIRM,
  ADOPT_DERIVED_CONFIRM_FALLBACK,
} from '../../src/cli/dashboard/App.js';

// ── Fake clock (idéntico a app-adopt.test.js) ────────────────────────────────
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
  return {
    schedule,
    cancel,
    scheduleTimeout,
    cancelTimeout,
    now: () => nowMs,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

// RESEARCH Pitfall 1: ink NO awaitea el handler async; los keystrokes encadenados necesitan el
// frame intermedio. 80ms es load-bearing (molde EXACTO de app-adopt.test.js). NO setImmediate.
function drain() {
  return new Promise((resolve) => setTimeout(resolve, 80));
}

function escRe(s) {
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

const STATUS_FIXTURE = { count: 0, sessions: [] };

// El cwd de la surface adoptable cae bajo /home/op/kodo (resuelve a 'kodo'); el huérfano no.
const PROJECTS_FIXTURE = { kodo: '/home/op/kodo' };

function makeRouter({ status = STATUS_FIXTURE } = {}) {
  const fetchFn = async (/** @type {string} */ url) => {
    const u = String(url);
    if (u.endsWith('/status')) return okResponse(status);
    if (u.includes('/comments/')) return okResponse({ comments: [] });
    if (u.endsWith('/logs')) return okResponse({ logs: [] });
    return okResponse(status);
  };
  return { fetchFn };
}

function injectProps(clock, fetchFn, extra = {}) {
  return {
    baseUrl: 'http://localhost:9090',
    fetchFn,
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    scheduleTimeout: clock.scheduleTimeout,
    cancelTimeout: clock.cancelTimeout,
    projects: PROJECTS_FIXTURE,
    ...extra,
  };
}

// Surface adoptable única bajo /home/op/kodo (resuelve a 'kodo'), kind claude, sessionId nuevo.
function adoptableSurface() {
  return [
    { workspaceRef: 'ws-1', cwd: '/home/op/kodo/src', sessionId: 'sess-A', kind: 'claude' },
  ];
}

describe('ORCH-02 (D-08): derive-then-confirm — estado deriving + propuesta en el confirm', () => {
  it('(1) `a` arma → DERIVE_PROGRESS → onDerive resuelve {title,description} → confirm con propuesta', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    let deriveCalls = 0;
    /** @type {Array<object>} */
    const deriveArgs = [];
    // onDerive CONTROLADO: resuelve sólo cuando llamamos releaseDerive(), para poder observar el
    // frame transitorio 'deriving' (DERIVE_PROGRESS) antes de que la derivación complete el confirm.
    let releaseDerive;
    const derivePromise = new Promise((resolve) => {
      releaseDerive = resolve;
    });
    const onDerive = async (/** @type {object} */ a) => {
      deriveCalls += 1;
      deriveArgs.push(a);
      await derivePromise;
      return { title: 'kodo bidireccional', description: 'sincroniza tareas en ambos sentidos' };
    };
    const onDiscover = async () => adoptableSurface();
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover: onDiscover, onDerive })),
    );
    try {
      await drain();
      stdin.write('a'); // abre picker
      await drain();
      stdin.write('a'); // arma → entra en deriving (onDerive en vuelo, sin resolver)
      await drain();
      const derivingFrame = lastFrame();
      assert.match(
        derivingFrame,
        escRe(DERIVE_PROGRESS),
        `tras armar debe mostrar el spinner DERIVE_PROGRESS\n${derivingFrame}`,
      );
      releaseDerive(); // libera onDerive → resuelve {title,description}
      await drain(); // onDerive resuelve → confirm
      const confirmFrame = lastFrame();
      assert.match(confirmFrame, escRe('kodo bidireccional'), `confirm muestra el título propuesto\n${confirmFrame}`);
      assert.match(confirmFrame, escRe('sincroniza tareas'), `confirm muestra la descripción propuesta\n${confirmFrame}`);
      assert.match(confirmFrame, escRe(ADOPT_DERIVED_CONFIRM('ws-1')), `confirm con la copy derived\n${confirmFrame}`);
      assert.equal(deriveCalls, 1, 'onDerive se llama exactamente una vez por armado');
      assert.equal(deriveArgs[0].cwd, '/home/op/kodo/src', 'onDerive recibe el cwd de la surface');
      assert.equal(deriveArgs[0].sessionId, 'sess-A', 'onDerive recibe el sessionId de la surface');
    } finally {
      unmount();
    }
  });

  it('(3) la fusión: el armedSurface que llega a onAdopt lleva title y description derivados', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    /** @type {Array<object>} */
    const adopts = [];
    const onDerive = async () => ({ title: 'título derivado', description: 'cuerpo derivado' });
    const onDiscover = async () => adoptableSurface();
    const onAdopt = async (/** @type {object} */ p) => {
      adopts.push(p);
      return { ok: true };
    };
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover: onDiscover, onDerive, onAdopt })),
    );
    try {
      await drain();
      stdin.write('a'); // picker
      await drain();
      stdin.write('a'); // arma → deriving
      await drain(); // onDerive resuelve → confirm
      assert.match(lastFrame(), escRe(ADOPT_DERIVED_CONFIRM('ws-1')), 'precondición: confirm armado con propuesta');
      stdin.write('a'); // confirma → onAdopt
      await drain();
      await drain(); // Pitfall 1: ink no awaitea el handler async
      assert.equal(adopts.length, 1, 'el confirm shellea onAdopt exactamente una vez');
      assert.equal(adopts[0].title, 'título derivado', 'onAdopt recibe el title derivado (fusión)');
      assert.equal(adopts[0].description, 'cuerpo derivado', 'onAdopt recibe la description derivada (fusión)');
      assert.equal(adopts[0].sessionId, 'sess-A', 'identidad preservada (sessionId)');
    } finally {
      unmount();
    }
  });
});

describe('ORCH-02 (D-09 fail-open): onDerive {} → confirm degradado, sin error rojo', () => {
  it('(2) onDerive resuelve {} → ADOPT_DERIVED_CONFIRM_FALLBACK, sin línea título:/desc:, NO rojo', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    /** @type {Array<object>} */
    const adopts = [];
    const onDerive = async () => ({}); // fail-open
    const onDiscover = async () => adoptableSurface();
    const onAdopt = async (/** @type {object} */ p) => {
      adopts.push(p);
      return { ok: true };
    };
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover: onDiscover, onDerive, onAdopt })),
    );
    try {
      await drain();
      stdin.write('a'); // picker
      await drain();
      stdin.write('a'); // arma → deriving → confirm degradado
      await drain();
      const frame = lastFrame();
      assert.match(frame, escRe(ADOPT_DERIVED_CONFIRM_FALLBACK('ws-1')), `confirm degradado FALLBACK\n${frame}`);
      assert.doesNotMatch(frame, /título:/, `sin título: en fail-open\n${frame}`);
      assert.doesNotMatch(frame, /desc:/, `sin desc: en fail-open\n${frame}`);
      // El confirm sigue funcional: la segunda `a` shellea, y onAdopt NO lleva title/description.
      stdin.write('a');
      await drain();
      await drain();
      assert.equal(adopts.length, 1, 'el confirm degradado sigue shelleando onAdopt');
      assert.equal(adopts[0].title, undefined, 'fail-open → onAdopt sin title (core cae al basename)');
      assert.equal(adopts[0].description, undefined, 'fail-open → onAdopt sin description');
    } finally {
      unmount();
    }
  });
});

describe('ORCH-02 (D-09): Esc en deriving cancela + token de generación invalida el resultado tardío', () => {
  it('(4/T5) Esc durante deriving → vuelve a list; el onDerive tardío NO reabre el confirm', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    /** @type {Array<object>} */
    const adopts = [];
    // onDerive controlado: resuelve sólo cuando llamamos releaseDerive().
    let releaseDerive;
    const derivePromise = new Promise((resolve) => {
      releaseDerive = resolve;
    });
    const onDerive = async () => {
      await derivePromise;
      return { title: 'tardío', description: 'no debe aparecer' };
    };
    const onDiscover = async () => adoptableSurface();
    const onAdopt = async (/** @type {object} */ p) => {
      adopts.push(p);
      return { ok: true };
    };
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover: onDiscover, onDerive, onAdopt })),
    );
    try {
      await drain();
      stdin.write('a'); // picker
      await drain();
      stdin.write('a'); // arma → deriving (onDerive en vuelo, sin resolver)
      await drain();
      assert.match(lastFrame(), escRe(DERIVE_PROGRESS), 'precondición: en deriving con onDerive en vuelo');
      stdin.write('\x1b'); // Esc cancela la derivación en vuelo
      await drain();
      const afterEsc = lastFrame();
      assert.doesNotMatch(afterEsc, escRe(DERIVE_PROGRESS), `tras Esc ya no está en deriving\n${afterEsc}`);
      assert.match(afterEsc, /a adopt/, `tras Esc vuelve a list (hints visibles)\n${afterEsc}`);
      // Ahora resuelve el onDerive tardío: NO debe reabrir el confirm (token de generación invalida).
      releaseDerive();
      await drain();
      const afterLate = lastFrame();
      assert.doesNotMatch(afterLate, escRe('tardío'), `el resultado tardío NO reabre el confirm\n${afterLate}`);
      assert.doesNotMatch(afterLate, escRe(ADOPT_DERIVED_CONFIRM('ws-1')), `no hay confirm tras Esc\n${afterLate}`);
      assert.equal(adopts.length, 0, 'Esc en deriving → cero adopt');
    } finally {
      unmount();
    }
  });

  it('(5) `a` mientras deriving → tragada, no encola un segundo onDerive', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    let deriveCalls = 0;
    let releaseDerive;
    const derivePromise = new Promise((resolve) => {
      releaseDerive = resolve;
    });
    const onDerive = async () => {
      deriveCalls += 1;
      await derivePromise;
      return { title: 't', description: 'd' };
    };
    const onDiscover = async () => adoptableSurface();
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover: onDiscover, onDerive })),
    );
    try {
      await drain();
      stdin.write('a'); // picker
      await drain();
      stdin.write('a'); // arma → deriving (en vuelo)
      await drain();
      assert.match(lastFrame(), escRe(DERIVE_PROGRESS), 'precondición: en deriving');
      stdin.write('a'); // segunda `a` durante deriving → tragada
      await drain();
      releaseDerive();
      await drain();
      assert.equal(deriveCalls, 1, '`a` durante deriving no dispara un segundo onDerive');
    } finally {
      unmount();
    }
  });

  it('(6) onDerive never-throws: si lanzara, el panel ink sigue montado (no-crash)', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    const onDerive = async () => {
      throw new Error('boom (no debería propagar; el contrato es fail-open a {})');
    };
    const onDiscover = async () => adoptableSurface();
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover: onDiscover, onDerive })),
    );
    try {
      await drain();
      stdin.write('a'); // picker
      await drain();
      stdin.write('a'); // arma → deriving → onDerive lanza
      await drain();
      await drain();
      const frame = lastFrame();
      // El panel sigue montado: el banner del dashboard sigue presente (no crash del árbol ink).
      assert.match(frame, /kodo dashboard/, `el panel ink sigue montado tras el throw de onDerive\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('ORCH-02 (T2): projectId none/ambiguous → ADOPT_NO_PROJECT, cero deriving, cero onDerive', () => {
  it('(7) surface huérfana → ADOPT_NO_PROJECT (rojo), NO entra en deriving, cero onDerive', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    let deriveCalls = 0;
    const onDerive = async () => {
      deriveCalls += 1;
      return { title: 't', description: 'd' };
    };
    // cwd huérfano: no cae bajo ningún path de PROJECTS_FIXTURE.
    const onDiscover = async () => [
      { workspaceRef: 'ws-orphan', cwd: '/tmp/orphan', sessionId: 'sess-orphan', kind: 'claude' },
    ];
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover: onDiscover, onDerive })),
    );
    try {
      await drain();
      stdin.write('a'); // picker
      await drain();
      stdin.write('a'); // intenta armar → resolveProjectId falla → ADOPT_NO_PROJECT, NO deriving
      await drain();
      const frame = lastFrame();
      assert.match(frame, escRe(ADOPT_NO_PROJECT('/tmp/orphan')), `cwd huérfano → ADOPT_NO_PROJECT\n${frame}`);
      assert.doesNotMatch(frame, escRe(DERIVE_PROGRESS), `no entra en deriving cuando no resuelve projectId\n${frame}`);
      assert.equal(deriveCalls, 0, 'no-project NUNCA dispara onDerive (regresión Phase 56 preservada)');
    } finally {
      unmount();
    }
  });
});
