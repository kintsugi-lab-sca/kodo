// @ts-check
//
// test/dashboard/app-adopt.test.js — Phase 56 Plan 02 Wave 0 RED (DETECT-02).
//
// Integration-light con ink-testing-library para la state machine del flujo adopt (tecla `a`):
// discover on-demand → picker overlay con cursor seleccionable → double-confirm armado por
// sessionId → shell never-throws de `kodo adopt`. Clon del harness de app-dismiss.test.js
// (injectProps + fake clock + router por URL + drain() 80ms — Pitfall 1: ink NO awaitea el
// handler async, los keystrokes encadenados necesitan el frame intermedio de 80ms).
//
// Contratos load-bearing de Task 2 (mold dismiss a-f):
//   (a) `a` en list → picker overlay frame con la(s) surface(s) adoptable(s).
//   (b) ↑/↓ mueven un CURSOR seleccionable sobre adoptable[] (NO scroll de lectura — Pitfall 3).
//   (c) sobre una surface resoluble, `a` → ADOPT_CONFIRM(ref) armado (sessionId).
//   (d) segundo `a` tras drain() → onAdopt llamado EXACTAMENTE una vez + ADOPT_OK frame.
//   (e) Esc en confirm → cero onAdopt, mode vuelve a list.
//   (f) surface cuyo cwd no resuelve proyecto → ADOPT_NO_PROJECT footer, cero onAdopt (D-05).
//   (g) onAdoptDiscover devuelve [] (o solo no-adoptables) → ADOPT_NONE footer, NO abre overlay (D-02/D-03).
//   (h) Pitfall 2: el confirm de adopt (`a`) NO colisiona con el de dismiss (`d`).
//
// Wave 0 RED: falla hasta que App.js exporte ADOPT_* y tenga el `a` handler + picker + confirm
// armado por sessionId + props onAdoptDiscover/onAdopt/projects.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App, {
  ADOPT_NONE,
  ADOPT_CONFIRM,
  ADOPT_OK,
  ADOPT_ALREADY,
  ADOPT_NO_PROJECT,
} from '../../src/cli/dashboard/App.js';

// ── Fake clock (idéntico a app-dismiss.test.js) ──────────────────────────────
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

// RESEARCH Pitfall 1: ink NO awaitea el handler async; los keystrokes encadenados (2º `a` debe
// ver mode==='confirm' del 1º) necesitan el frame intermedio. 80ms es load-bearing (más corto es
// flakey en CI) — molde EXACTO de app-dismiss.test.js:87-89. NO setImmediate.
function drain() {
  return new Promise((resolve) => setTimeout(resolve, 80));
}

function escRe(s) {
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

// /status fixture: UNA sesión ya trackeada (session_id 'tracked-1'). El set-difference de
// computeAdoptable debe excluir esa surface si una de las descubiertas la reusara.
const STATUS_FIXTURE = {
  count: 1,
  sessions: [
    {
      task_id: 't1',
      task_ref: 'KL-1',
      workspace_ref: 'ws-tracked',
      session_id: 'tracked-1',
      status: 'running',
      alive: true,
      started_at: '2026-05-27T10:00:00Z',
      project_name: 'kodo',
      summary: '',
    },
  ],
};

// Mapa projectId → path (molde de loadProjects()). El cwd de la surface adoptable cae bajo
// /home/op/kodo (resuelve a 'kodo'); el de la surface huérfana no cae bajo ningún proyecto.
const PROJECTS_FIXTURE = { kodo: '/home/op/kodo' };

// Surfaces descubiertas por onAdoptDiscover. Mezcla deliberada para probar el filtro:
//   - adopt-A: kind 'claude', sessionId NUEVO, cwd bajo /home/op/kodo → ADOPTABLE + resoluble.
//   - non-claude: kind 'codex' → filtrada por computeAdoptable (no claude).
//   - tracked: kind 'claude' pero sessionId === 'tracked-1' (ya en /status) → filtrada (diff).
function adoptableSurfaces() {
  return [
    { workspaceRef: 'ws-1', cwd: '/home/op/kodo/src', sessionId: 'sess-adopt-A', kind: 'claude' },
    { workspaceRef: 'ws-2', cwd: '/home/op/other', sessionId: 'sess-non-claude', kind: 'codex' },
    { workspaceRef: 'ws-tracked', cwd: '/home/op/kodo', sessionId: 'tracked-1', kind: 'claude' },
  ];
}

// Router /status (no DELETE necesario para adopt). Reusa el patrón de app-dismiss.
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

describe('DETECT-02: handler `a` → discover → picker', () => {
  it('(a) a en list abre el picker con la surface adoptable (cwd visible)', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    const onAdoptDiscover = async () => adoptableSurfaces();
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover })),
    );
    try {
      await drain();
      stdin.write('a');
      await drain();
      const frame = lastFrame();
      assert.match(frame, escRe('/home/op/kodo/src'), `el picker debe listar la surface adoptable\n${frame}`);
      // Las no-adoptables (non-claude / ya trackeada) NO aparecen.
      assert.doesNotMatch(frame, escRe('/home/op/other'), `la surface non-claude NO debe aparecer\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('(g) onAdoptDiscover vacío → ADOPT_NONE footer, NO abre overlay', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    const onAdoptDiscover = async () => []; // host sin surfaces / sin soporte
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover })),
    );
    try {
      await drain();
      stdin.write('a');
      await drain();
      const frame = lastFrame();
      assert.match(frame, escRe(ADOPT_NONE), `vacío debe mostrar ADOPT_NONE\n${frame}`);
      // No abrió picker: la línea de hints de list sigue presente.
      assert.match(frame, /a adopt/, `mode debe seguir en list (hints visibles)\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('DETECT-02: picker cursor + double-confirm (D-04)', () => {
  it('(b) ↑/↓ mueven el cursor seleccionable (no scroll), (c) a arma ADOPT_CONFIRM, (d) 2º a shellea una vez', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    /** @type {Array<object>} */
    const adopts = [];
    const onAdoptDiscover = async () => [
      { workspaceRef: 'ws-1', cwd: '/home/op/kodo/src', sessionId: 'sess-A', kind: 'claude' },
      { workspaceRef: 'ws-3', cwd: '/home/op/kodo/lib', sessionId: 'sess-B', kind: 'claude' },
    ];
    const onAdopt = async (/** @type {object} */ payload) => {
      adopts.push(payload);
      return { ok: true };
    };
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover, onAdopt })),
    );
    try {
      await drain();
      stdin.write('a'); // abre picker (cursor 0 → sess-A /src)
      await drain();
      stdin.write('\x1b[B'); // ↓ mueve cursor a sess-B (/lib) — cursor seleccionable, no scroll
      await drain();
      // (c) arma sobre la surface bajo el cursor (sess-B, resuelve a 'kodo')
      stdin.write('a');
      await drain();
      const armedFrame = lastFrame();
      assert.match(armedFrame, escRe(ADOPT_CONFIRM('ws-3')), `2ª surface debe armar ADOPT_CONFIRM\n${armedFrame}`);
      // (d) segundo `a` ejecuta el adopt UNA vez
      stdin.write('a');
      await drain();
      await drain(); // Pitfall 1: ink no awaitea el handler async
      const okFrame = lastFrame();
      assert.equal(adopts.length, 1, 'el segundo a debe shellear onAdopt exactamente una vez');
      assert.equal(adopts[0].sessionId, 'sess-B', 'onAdopt recibe el sessionId del cursor (identidad, no índice)');
      assert.equal(adopts[0].projectId, 'kodo', 'projectId resuelto por reverse-lookup del cwd');
      assert.equal(adopts[0].cwd, '/home/op/kodo/lib', 'cwd de la surface bajo el cursor');
      assert.equal(adopts[0].workspaceRef, 'ws-3', 'workspaceRef de la surface bajo el cursor');
      assert.match(okFrame, escRe(ADOPT_OK('ws-3')), `éxito debe mostrar ADOPT_OK verde\n${okFrame}`);
    } finally {
      unmount();
    }
  });

  it('(d3) 56-06: el armed adopt pasa el title de la surface a onAdopt (rides through hasta runAdopt)', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    /** @type {Array<object>} */
    const adopts = [];
    // surface CON title (auto-derivado por cmux) + surface SIN title.
    const onAdoptDiscover = async () => [
      { workspaceRef: 'ws-1', cwd: '/home/op/kodo/src', sessionId: 'sess-T', kind: 'claude', title: 'KODO DEV' },
      { workspaceRef: 'ws-2', cwd: '/home/op/kodo/lib', sessionId: 'sess-N', kind: 'claude' },
    ];
    const onAdopt = async (/** @type {object} */ p) => {
      adopts.push(p);
      return { ok: true };
    };
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover, onAdopt })),
    );
    try {
      await drain();
      stdin.write('a'); // picker (cursor 0 → sess-T, con title)
      await drain();
      stdin.write('a'); // arma
      await drain();
      assert.match(lastFrame(), escRe(ADOPT_CONFIRM('ws-1')), 'precondición: armado sobre sess-T');
      stdin.write('a'); // ejecuta
      await drain();
      await drain(); // Pitfall 1: ink no awaitea el handler async
      assert.equal(adopts.length, 1, 'el segundo a shellea onAdopt una vez');
      assert.equal(adopts[0].sessionId, 'sess-T');
      assert.equal(adopts[0].title, 'KODO DEV', 'onAdopt recibe el title auto-derivado de la surface');
    } finally {
      unmount();
    }
  });

  it('(d4) 56-06: surface SIN title → onAdopt recibe title undefined (core cae al basename)', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    /** @type {Array<object>} */
    const adopts = [];
    const onAdoptDiscover = async () => [
      { workspaceRef: 'ws-2', cwd: '/home/op/kodo/lib', sessionId: 'sess-N', kind: 'claude' },
    ];
    const onAdopt = async (/** @type {object} */ p) => {
      adopts.push(p);
      return { ok: true };
    };
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover, onAdopt })),
    );
    try {
      await drain();
      stdin.write('a');
      await drain();
      stdin.write('a');
      await drain();
      assert.match(lastFrame(), escRe(ADOPT_CONFIRM('ws-2')), 'precondición: armado sobre sess-N');
      stdin.write('a');
      await drain();
      await drain();
      assert.equal(adopts.length, 1);
      assert.equal(adopts[0].title, undefined, 'sin title en la surface → onAdopt lo recibe undefined');
    } finally {
      unmount();
    }
  });

  it('(d2) 56-03: onAdopt → ALREADY_ADOPTED muestra footer ámbar (NO verde ADOPT_OK)', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    /** @type {Array<object>} */
    const adopts = [];
    const onAdoptDiscover = async () => [
      { workspaceRef: 'ws-1', cwd: '/home/op/kodo/src', sessionId: 'sess-A', kind: 'claude' },
    ];
    // El CLI sale 0 pero el discriminante es un no-op idempotente → runAdopt lo
    // resuelve como { ok:false, code:'ALREADY_ADOPTED' }. El footer NO debe ser verde.
    const onAdopt = async (/** @type {object} */ p) => {
      adopts.push(p);
      return { ok: false, code: 'ALREADY_ADOPTED', detail: 'KL-7' };
    };
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover, onAdopt })),
    );
    try {
      await drain();
      stdin.write('a'); // picker
      await drain();
      stdin.write('a'); // arma
      await drain();
      assert.match(lastFrame(), escRe(ADOPT_CONFIRM('ws-1')), 'precondición: armado');
      stdin.write('a'); // ejecuta
      await drain();
      await drain(); // Pitfall 1: ink no awaitea el handler async
      const frame = lastFrame();
      assert.equal(adopts.length, 1, 'el segundo a debe shellear onAdopt una vez');
      assert.match(frame, escRe(ADOPT_ALREADY('ws-1')), `ALREADY_ADOPTED → footer ámbar 'already adopted'\n${frame}`);
      assert.doesNotMatch(frame, escRe(ADOPT_OK('ws-1')), `NO debe mostrar el verde engañoso 'adopted'\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('(e) Esc en confirm cancela: cero onAdopt, vuelve a list', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    /** @type {Array<object>} */
    const adopts = [];
    const onAdoptDiscover = async () => [
      { workspaceRef: 'ws-1', cwd: '/home/op/kodo/src', sessionId: 'sess-A', kind: 'claude' },
    ];
    const onAdopt = async (/** @type {object} */ p) => {
      adopts.push(p);
      return { ok: true };
    };
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover, onAdopt })),
    );
    try {
      await drain();
      stdin.write('a'); // picker
      await drain();
      stdin.write('a'); // arma
      await drain();
      assert.match(lastFrame(), escRe(ADOPT_CONFIRM('ws-1')), 'precondición: armado');
      stdin.write('\x1b'); // Esc cancela
      await drain();
      const frame = lastFrame();
      assert.equal(adopts.length, 0, 'Esc NO debe shellear adopt');
      assert.doesNotMatch(frame, escRe(ADOPT_CONFIRM('ws-1')), `tras Esc el confirm ya no está armado\n${frame}`);
      assert.match(frame, /a adopt/, `tras Esc vuelve a list (hints visibles)\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('DETECT-02: D-05 — no/ambiguous project bloquea el shell', () => {
  it('(f) surface cuyo cwd no resuelve proyecto → ADOPT_NO_PROJECT footer, cero onAdopt', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    /** @type {Array<object>} */
    const adopts = [];
    // cwd huérfano: no cae bajo ningún path de PROJECTS_FIXTURE.
    const onAdoptDiscover = async () => [
      { workspaceRef: 'ws-orphan', cwd: '/tmp/orphan', sessionId: 'sess-orphan', kind: 'claude' },
    ];
    const onAdopt = async (/** @type {object} */ p) => {
      adopts.push(p);
      return { ok: true };
    };
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover, onAdopt })),
    );
    try {
      await drain();
      stdin.write('a'); // picker
      await drain();
      stdin.write('a'); // intenta armar → resolveProjectId falla → ADOPT_NO_PROJECT
      await drain();
      const frame = lastFrame();
      assert.equal(adopts.length, 0, 'no-project NUNCA debe shellear adopt (D-05)');
      assert.match(frame, escRe(ADOPT_NO_PROJECT('/tmp/orphan')), `cwd huérfano → ADOPT_NO_PROJECT\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('Pitfall 2: el confirm de adopt y el de dismiss no colisionan', () => {
  it('(h) un `a` no dispara dismiss y el flujo adopt arma por sessionId (no task_id)', async () => {
    const clock = makeFakeClock();
    const { fetchFn } = makeRouter();
    /** @type {Array<object>} */
    const adopts = [];
    const onAdoptDiscover = async () => [
      { workspaceRef: 'ws-1', cwd: '/home/op/kodo/src', sessionId: 'sess-A', kind: 'claude' },
    ];
    const onAdopt = async (/** @type {object} */ p) => {
      adopts.push(p);
      return { ok: true };
    };
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onAdoptDiscover, onAdopt })),
    );
    try {
      await drain();
      stdin.write('a'); // picker
      await drain();
      stdin.write('a'); // arma adopt (por sessionId)
      await drain();
      // Una `d` en el confirm de adopt NO debe ejecutar nada (solo `a` ejecuta adopt) y NO debe
      // disparar el dismiss (que se arma por task_id). Cancela.
      stdin.write('d');
      await drain();
      const frame = lastFrame();
      assert.equal(adopts.length, 0, 'una d en confirm de adopt no shellea adopt');
      assert.doesNotMatch(frame, escRe(ADOPT_CONFIRM('ws-1')), `tras d el confirm de adopt se cancela\n${frame}`);
    } finally {
      unmount();
    }
  });
});
