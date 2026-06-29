// @ts-check
//
// test/dashboard-projects.test.js — Phase 64 Plan 02 Wave 0 (RED → GREEN).
//
// Renderiza el componente `App` del dashboard con ink-testing-library y verifica el EDITOR de
// PROYECTOS: el carril ASYNC base (la 1ª fuente de datos de red surfaced como estado de la TUI).
// Cubre la máquina de modos projects/projects-loading/projects-edit/projects-error (D-02), el
// fetch async de listProjectsFn con guard de request-token dedicado projectsReqRef (D-01,
// PROJ-05), la validación de ruta reusando validateExistingDir (PROJ-02), quitar mapeo (PROJ-03)
// y la degradación never-throws con retry (D-07/PROJ-05).
//
// Harness hermético reusado VERBATIM de test/dashboard-config.test.js (makeFakeClock/injectProps/
// drain/okResponse/makeRouter). injectProps se EXTIENDE con los 3 *Fn DI de este plan:
//   - listProjectsFn: fake async → { ok:true, projects } | { ok:false, error } (carril discriminado).
//   - loadProjectsFn: fake síncrono → mapa de proyectos local (la fuente del estado de mapeo).
//   - saveProjectsFn: spy síncrono — punto de muestreo de PROJ-03 y del "carril de error NUNCA
//     escribe" (PROJ-05).
//
// El test es el CONTRATO: bloquea los nombres de props DI (listProjectsFn/loadProjectsFn/
// saveProjectsFn), las constantes PROJECTS_* y los modos. Antes de implementar Tasks 2/3 FALLA
// (RED): las constantes PROJECTS_* no existen aún como exports de App.js (TypeError al cargar).
//
// Pitfall 6 (RESEARCH): `lastFrame()` incluye códigos ANSI cuando el cursor se pinta con
// `<Text inverse>`. Se asierte por CONTENIDO de texto (segmentos contiguos), NUNCA por la
// posición/styling del cursor.
//
// DISCIPLINA: cada test que renderiza App captura el handle y llama `unmount()` en un `finally`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App, {
  PROJECTS_OVERLAY_TITLE,
  PROJECTS_SAVED_RESTART,
  PROJECTS_UNMAPPED,
  PROJECTS_LOAD_FAILED,
} from '../src/cli/dashboard/App.js';

// ── Fake clock (idéntico a dashboard-config.test.js) ─────────────────────────
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

// Spy de saveProjectsFn: registra cuántas veces se llamó y el último mapa recibido. Síncrono
// (saveProjects de runtime es síncrono atómico). PROJ-03 verifica el mapa sin la key; PROJ-05
// verifica que `calls === 0` en todo el carril de error.
function makeSaveSpy() {
  const spy = { calls: 0, lastMap: /** @type {any} */ (null) };
  const fn = (/** @type {any} */ map) => {
    spy.calls += 1;
    spy.lastMap = map;
  };
  return { spy, fn };
}

// listProjectsFn por defecto del harness: éxito con dos proyectos conocidos (p1 mapeado, p2 no).
const PROJECTS_FIXTURE = [
  { id: 'p1', identifier: 'KL', name: 'k-lab' },
  { id: 'p2', identifier: 'XX', name: 'otro' },
];

function injectProps(clock, fetchFn, extra = {}) {
  return {
    baseUrl: 'http://localhost:9090',
    fetchFn,
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    scheduleTimeout: clock.scheduleTimeout,
    cancelTimeout: clock.cancelTimeout,
    listProjectsFn: async () => ({ ok: true, projects: PROJECTS_FIXTURE }),
    loadProjectsFn: () => ({}),
    saveProjectsFn: () => {},
    ...extra,
  };
}

// drain idéntico a dashboard-config.test.js: 6 ciclos del event loop purgan el re-subscribe de
// useInput (un render tarde tras un cambio de modo) y resuelven los await de los *Fn async.
async function drain() {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

// Fixture de /status: KL-1 (task_id 'a') es la fila seleccionada inicial (newest, arriba).
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
      project_path: '/x/foo',
      elapsed_min: 63,
      summary: '',
    },
  ],
};

function makeRouter({ status = STATUS_FIXTURE } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.endsWith('/status')) return okResponse(status);
    if (u.endsWith('/logs')) return okResponse({ logs: [] });
    return okResponse(status);
  };
}

describe('PROJ-01 / D-01/D-02/D-10: `m` abre el editor, fetch ok → lista con estado de mapeo', () => {
  it('`m` en mode:list → projects-loading → projects con título, nombres y estado [ruta]/[sin mapear]', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { lastFrame, stdin, unmount } = render(
      createElement(
        App,
        injectProps(clock, fetchFn, {
          // p1 mapeado a una ruta corta REAL (/tmp existe en unix); p2 sin mapear.
          loadProjectsFn: () => ({ p1: '/tmp' }),
        }),
      ),
    );
    try {
      await drain();
      stdin.write('m'); // abre → projects-loading → (await) → projects
      await drain();
      const frame = lastFrame();
      assert.match(frame, new RegExp(PROJECTS_OVERLAY_TITLE), `m debe abrir el overlay de proyectos\n${frame}`);
      assert.match(frame, /k-lab/, `la lista debe mostrar el proyecto p1 (k-lab)\n${frame}`);
      assert.match(frame, /otro/, `la lista debe mostrar el proyecto p2 (otro)\n${frame}`);
      assert.match(frame, /\/tmp/, `la fila mapeada (p1) debe mostrar su ruta\n${frame}`);
      assert.ok(frame.includes(PROJECTS_UNMAPPED), `la fila NO mapeada (p2) debe mostrar ${PROJECTS_UNMAPPED}\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('PROJ-02 UI (válido) / D-03: Enter precarga, valida y guarda con aviso de reinicio', () => {
  it('Enter sobre una fila con ruta válida → valida → saveProjectsFn una vez + aviso de reinicio', async () => {
    const realDir = mkdtempSync(join(tmpdir(), 'kodo-proj-'));
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { spy, fn } = makeSaveSpy();
    const { lastFrame, stdin, unmount } = render(
      createElement(
        App,
        injectProps(clock, fetchFn, {
          loadProjectsFn: () => ({ p1: realDir }), // precarga una ruta REAL existente
          saveProjectsFn: fn,
        }),
      ),
    );
    try {
      await drain();
      stdin.write('m'); // → projects
      await drain();
      stdin.write('\r'); // Enter en p1 → projects-edit (precarga realDir, cursor al final)
      await drain();
      stdin.write('\r'); // Enter → valida realDir (ok) → guarda
      await drain();
      assert.equal(spy.calls, 1, 'saveProjectsFn debe llamarse exactamente una vez con una ruta válida');
      assert.equal(spy.lastMap.p1, realDir, 'el mapa guardado lleva p1 → la ruta validada');
      assert.match(lastFrame(), /reinicia|reiniciar/i, `tras guardar debe verse el aviso de reinicio\n${lastFrame()}`);
    } finally {
      unmount();
      rmSync(realDir, { recursive: true, force: true });
    }
  });
});

describe('PROJ-02 UI (inválido) / CFG-05-mol: ruta inexistente → footer rojo, NO escribe, sigue editando', () => {
  it('una ruta inexistente en projects-edit muestra el error y NO llama a saveProjectsFn', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { spy, fn } = makeSaveSpy();
    const { lastFrame, stdin, unmount } = render(
      createElement(
        App,
        injectProps(clock, fetchFn, {
          loadProjectsFn: () => ({}), // p1 sin mapear → precarga buffer vacío
          saveProjectsFn: fn,
        }),
      ),
    );
    try {
      await drain();
      stdin.write('m'); // → projects
      await drain();
      stdin.write('\r'); // Enter en p1 → projects-edit (precarga '')
      await drain();
      stdin.write('Z'); // 'Z' (ruta inexistente)
      await drain();
      stdin.write('\r'); // intenta guardar → inválido
      await drain();
      const frame = lastFrame();
      assert.match(frame, /no existe/, `una ruta inexistente debe pintar el error de validación\n${frame}`);
      assert.equal(spy.calls, 0, 'saveProjectsFn NO debe llamarse con una ruta inválida');
      // Pitfall 2: el error vive en projectsEditError (no focusError) → la siguiente tecla edita.
      stdin.write('Q'); // 'ZQ' → no consumido por un clear-on-any-input
      await drain();
      assert.match(lastFrame(), /ZQ/, `tras el error la siguiente tecla edita el buffer (no se pierde)\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });
});

describe('PROJ-03 / D-03/D-06: una tecla quita el mapeo (delete + save sin la key)', () => {
  it('`x` sobre una fila mapeada → saveProjectsFn con el mapa SIN esa key; la fila pasa a [sin mapear]', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { spy, fn } = makeSaveSpy();
    const { lastFrame, stdin, unmount } = render(
      createElement(
        App,
        injectProps(clock, fetchFn, {
          loadProjectsFn: () => ({ p1: '/tmp' }), // p1 mapeado
          saveProjectsFn: fn,
        }),
      ),
    );
    try {
      await drain();
      stdin.write('m'); // → projects (fieldCursor=0 → p1)
      await drain();
      stdin.write('x'); // quita el mapeo de p1
      await drain();
      assert.equal(spy.calls, 1, 'quitar debe llamar a saveProjectsFn una vez');
      assert.ok(!('p1' in spy.lastMap), 'el mapa guardado NO debe contener la key p1 (delete)');
      assert.ok(lastFrame().includes(PROJECTS_UNMAPPED), `la fila quitada debe mostrar ${PROJECTS_UNMAPPED}\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });
});

describe('PROJ-05 (error) / D-07: fetch {ok:false} → projects-error; Esc sale; saveProjectsFn NUNCA', () => {
  it('listProjectsFn {ok:false} → mensaje de error; Esc vuelve a list; saveProjectsFn no se llama', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { spy, fn } = makeSaveSpy();
    const { lastFrame, stdin, unmount } = render(
      createElement(
        App,
        injectProps(clock, fetchFn, {
          listProjectsFn: async () => ({ ok: false, error: 'ECONNREFUSED' }),
          saveProjectsFn: fn,
        }),
      ),
    );
    try {
      await drain();
      stdin.write('m'); // → projects-loading → projects-error
      await drain();
      assert.ok(
        lastFrame().includes(PROJECTS_LOAD_FAILED('ECONNREFUSED')),
        `un fallo de fetch debe pintar PROJECTS_LOAD_FAILED\n${lastFrame()}`,
      );
      stdin.write('\x1b'); // Esc → vuelve a list
      await drain();
      assert.match(lastFrame(), /KL-1/, `Esc en projects-error debe volver a la tabla\n${lastFrame()}`);
      assert.equal(spy.calls, 0, 'el carril de error NUNCA debe llamar a saveProjectsFn (PROJ-05)');
    } finally {
      unmount();
    }
  });

  it('`r` reintenta el fetch (2ª llamada ok) → vuelve a projects; saveProjectsFn sigue sin llamarse', async () => {
    let calls = 0;
    const listProjectsFn = async () => {
      calls += 1;
      return calls === 1
        ? { ok: false, error: 'ECONNREFUSED' }
        : { ok: true, projects: PROJECTS_FIXTURE };
    };
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { spy, fn } = makeSaveSpy();
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { listProjectsFn, saveProjectsFn: fn })),
    );
    try {
      await drain();
      stdin.write('m'); // → projects-error (1ª llamada falla)
      await drain();
      assert.ok(lastFrame().includes(PROJECTS_LOAD_FAILED('ECONNREFUSED')), `1ª llamada falla\n${lastFrame()}`);
      stdin.write('r'); // reintenta → 2ª llamada ok → projects
      await drain();
      assert.match(lastFrame(), /k-lab/, `el retry exitoso debe mostrar la lista de proyectos\n${lastFrame()}`);
      assert.equal(spy.calls, 0, 'ni el error ni el retry escriben projects.json (PROJ-05)');
    } finally {
      unmount();
    }
  });
});

describe('PROJ-05 (race) / UX-03: Esc durante projects-loading descarta el resultado tardío', () => {
  it('Esc en projects-loading invalida el fetch en vuelo; el resultado tardío NO entra a projects', async () => {
    /** @type {(v: any) => void} */
    let resolveFetch = () => {};
    const listProjectsFn = () =>
      new Promise((res) => {
        resolveFetch = res;
      });
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { spy, fn } = makeSaveSpy();
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { listProjectsFn, saveProjectsFn: fn })),
    );
    try {
      await drain();
      stdin.write('m'); // → projects-loading (fetch queda en vuelo, deferred)
      await drain(); // re-subscribe a la rama projects-loading (fetch sigue pendiente)
      stdin.write('\x1b'); // Esc → invalida (projectsReqRef++) + vuelve a list
      await drain();
      resolveFetch({ ok: true, projects: PROJECTS_FIXTURE }); // resultado TARDÍO
      await drain();
      const frame = lastFrame();
      assert.doesNotMatch(frame, new RegExp(PROJECTS_OVERLAY_TITLE), `el resultado tardío NO debe abrir el overlay\n${frame}`);
      assert.match(frame, /›.*KL-1/, `selectedTaskId intacto: el cursor sigue en KL-1\n${frame}`);
      assert.equal(spy.calls, 0, 'una apertura cancelada nunca escribe');
    } finally {
      unmount();
    }
  });
});
