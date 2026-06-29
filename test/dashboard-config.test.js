// @ts-check
//
// test/dashboard-config.test.js — Phase 63 Plan 02 Wave 0 (RED).
//
// Renderiza el componente `App` del dashboard con ink-testing-library y verifica el EDITOR de
// configuración (la 2ª ruptura consciente de "TUI read-only"): la máquina de modos config/
// config-edit, el text-input controlado con cursor, validación derivada de un estado dedicado
// (configEditError, NO focusError) y guardado con aviso de reinicio. Cubre UX-01..04, CFG-05-UI,
// PERSIST-03/04 + el never-throws de escritura fallida (UX-04/D-12).
//
// Harness hermético reusado VERBATIM de test/dashboard-overlay.test.js (makeFakeClock/injectProps/
// drain/okResponse/makeRouter). injectProps se EXTIENDE con dos props DI nuevas:
//   - loadConfigFn: () => CONFIG_FIXTURE (snapshot fake con valores conocidos; NO toca ~/.kodo/ real).
//   - onSaveConfig: spy async never-throws que registra el config recibido y devuelve {ok} controlado.
//
// El test es el CONTRATO: bloquea los nombres de props DI (loadConfigFn/onSaveConfig), las constantes
// CONFIG_* y los modos config/config-edit. Antes de implementar Tasks 2/3 FALLA (RED) — las
// constantes CONFIG_* no existen aún como exports de App.js (SyntaxError al cargar el módulo).
//
// Pitfall 5 (RESEARCH): `lastFrame()` incluye códigos ANSI cuando el cursor se pinta con
// `<Text inverse>`. Se asierte por CONTENIDO de texto (el segmento ANTES del cursor es contiguo),
// NUNCA por la posición/styling del cursor.
//
// DISCIPLINA: cada test que renderiza App captura el handle y llama `unmount()` en un `finally`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App, {
  CONFIG_OVERLAY_TITLE,
  CONFIG_SAVED_RESTART,
  CONFIG_SAVE_FAILED,
} from '../src/cli/dashboard/App.js';

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

// Snapshot fake de config con valores CONOCIDOS (mold DEFAULT_CONFIG de src/config.js). El editor
// opera sobre un structuredClone de esto (Pitfall 1) — el fixture nunca se muta entre tests porque
// loadConfigFn lo deep-clona en el handler `e`. Solo los 11 campos editables de getEditableFields
// importan; NINGÚN secreto (api_key_env/base_url/workspace_slug) aparece (PERSIST-04 por construcción).
const CONFIG_FIXTURE = {
  provider: 'plane',
  providers: {
    plane: {
      base_url: 'https://example.com', // NO editable — no debe aparecer en el overlay
      api_key_env: 'PLANE_API_KEY', // NO editable — secreto, jamás en el overlay
      workspace_slug: 'k-lab', // NO editable — jamás en el overlay
      states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
    },
  },
  cmux: { colors: { running: 'Amber', done: 'Green', error: 'Crimson', review: 'Blue' } },
  claude: { default_model: 'opus', max_parallel: 3 },
  server: { idle_threshold_min: 5, stuck_threshold_min: 30 },
};

// loadConfigFn por defecto del harness: devuelve una COPIA fresca del fixture cada vez (defensa en
// profundidad — aunque el handler `e` ya deep-clona, esto evita aliasing entre tests).
function makeLoadConfigFn() {
  return () => structuredClone(CONFIG_FIXTURE);
}

// Spy de onSaveConfig: registra cuántas veces se llamó y el último config recibido; devuelve un
// resultado controlado ({ok:true} por defecto, {ok:false} para el caso de escritura fallida UX-04).
function makeSaveSpy(result = { ok: true }) {
  const spy = { calls: 0, lastConfig: /** @type {any} */ (null) };
  const fn = async (/** @type {any} */ cfg) => {
    spy.calls += 1;
    spy.lastConfig = cfg;
    return result;
  };
  return { spy, fn };
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
    loadConfigFn: makeLoadConfigFn(),
    onSaveConfig: makeSaveSpy().fn,
    ...extra,
  };
}

// El editor encadena transiciones de modo + tecleo INMEDIATO (Enter→config-edit→teclear). ink
// re-suscribe el handler de `useInput` un render TARDE respecto al cambio de estado, así que la
// primera tecla tras una transición se descarta con un drain de 2 (suficiente para los overlays
// read-only, que no tipean en el modo recién abierto). Un terminal real tiene latencia humana de
// sobra entre teclas; aquí se purga con varios ciclos del event loop para reflejar esa realidad.
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

describe('UX-01/D-02: `e` abre el overlay de config sin salir del dashboard', () => {
  it('`e` en mode:list abre el overlay con título + la lista de campos editables', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('e');
      await drain();
      const frame = lastFrame();
      assert.match(frame, new RegExp(CONFIG_OVERLAY_TITLE), `e debe abrir el overlay de config\n${frame}`);
      // La lista incluye al menos default_model ('opus') y max_parallel (label 'Máximo en paralelo').
      assert.match(frame, /Modelo por defecto|opus/, `el overlay debe listar el campo default_model\n${frame}`);
      assert.match(frame, /Máximo en paralelo/, `el overlay debe listar el campo max_parallel\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('PERSIST-04: el overlay NUNCA muestra api_key_env / base_url / workspace_slug', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('e');
      await drain();
      const frame = lastFrame();
      assert.doesNotMatch(frame, /PLANE_API_KEY|api_key_env/, `ningún secreto en el overlay\n${frame}`);
      assert.doesNotMatch(frame, /workspace_slug|k-lab/, `ningún workspace_slug en el overlay\n${frame}`);
      assert.doesNotMatch(frame, /example\.com|base_url/, `ningún base_url en el overlay\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('UX-02/D-01: text-input con cursor, backspace, ←, inserción en medio', () => {
  it('Enter precarga el valor y la edición inserta en la posición del cursor (no append ciego)', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('e'); // abre config (fieldCursor=0 → default_model='opus')
      await drain();
      stdin.write('\r'); // entra a config-edit, precarga 'opus' con el cursor al final
      await drain();
      stdin.write('8'); // 'opus8'
      await drain();
      stdin.write('\x7f'); // backspace → 'opus'
      await drain();
      stdin.write('\x1b[D'); // ← cursor a la izquierda (entre 'opu' y 's')
      await drain();
      stdin.write('X'); // inserta en medio → 'opuXs'
      await drain();
      const frame = lastFrame();
      // Pitfall 5: asertar el segmento ANTES del cursor ('opuX'), contiguo y sin bytes ANSI internos.
      assert.match(frame, /opuX/, `la inserción debe ocurrir en el cursor, no por append ciego\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('CFG-05-UI: valor inválido → footer rojo, NO escribe, sigue en config-edit', () => {
  it('un max_parallel inválido (0) muestra el error de validación y no llama a onSaveConfig', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { spy, fn } = makeSaveSpy();
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onSaveConfig: fn })),
    );
    try {
      await drain();
      stdin.write('e'); // config
      await drain();
      stdin.write('\x1b[B'); // ↓ a max_parallel (fieldCursor=1)
      await drain();
      stdin.write('\r'); // config-edit de max_parallel (precarga '3')
      await drain();
      stdin.write('\x7f'); // backspace → ''
      await drain();
      stdin.write('0'); // '0' (inválido: < 1)
      await drain();
      stdin.write('\r'); // intenta guardar
      await drain();
      const frame = lastFrame();
      assert.match(frame, /entero positivo/, `un valor inválido debe pintar el error de validación\n${frame}`);
      assert.equal(spy.calls, 0, 'onSaveConfig NO debe llamarse con un valor inválido');
      // Pitfall 2: el error vive en configEditError (no focusError) → la siguiente tecla NO se pierde.
      // Seguimos en config-edit: teclear un dígito válido sigue editando el buffer.
      stdin.write('5'); // '05' → no consumido por un clear-on-any-input
      await drain();
      assert.match(lastFrame(), /05/, `tras el error la siguiente tecla edita el buffer (no se pierde)\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });
});

describe('PERSIST-03/D-10: valor válido → guarda y muestra el aviso de reinicio', () => {
  it('editar max_parallel a 5 y confirmar llama a onSaveConfig una vez con el valor aplicado', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { spy, fn } = makeSaveSpy({ ok: true });
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onSaveConfig: fn })),
    );
    try {
      await drain();
      stdin.write('e');
      await drain();
      stdin.write('\x1b[B'); // ↓ a max_parallel
      await drain();
      stdin.write('\r'); // config-edit (precarga '3')
      await drain();
      stdin.write('\x7f'); // ''
      await drain();
      stdin.write('5'); // '5'
      await drain();
      stdin.write('\r'); // guarda
      await drain();
      assert.equal(spy.calls, 1, 'onSaveConfig debe llamarse exactamente una vez');
      assert.equal(spy.lastConfig.claude.max_parallel, 5, 'el config guardado lleva el valor nuevo aplicado');
      assert.match(lastFrame(), /reinicia|reiniciar/i, `tras guardar debe verse el aviso de reinicio\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });
});

describe('UX-03/D-05: Esc en config preserva la selección por task_id', () => {
  it('Esc cierra el overlay y vuelve a la tabla con el MISMO cursor (KL-1)', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('e');
      await drain();
      stdin.write('\x1b'); // Esc
      await drain();
      const frame = lastFrame();
      assert.match(frame, /›.*KL-1/, `Esc debe restaurar la tabla con el cursor en KL-1\n${frame}`);
      assert.match(frame, /KL-2/, `Esc debe restaurar la tabla completa (KL-2 visible)\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('UX-04/D-12: escritura fallida deja el panel montado y el footer rojo', () => {
  it('onSaveConfig {ok:false} → footer CONFIG_SAVE_FAILED, el panel sigue renderizando (no crash)', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { fn } = makeSaveSpy({ ok: false, error: 'EACCES' });
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onSaveConfig: fn })),
    );
    try {
      await drain();
      stdin.write('e');
      await drain();
      stdin.write('\x1b[B'); // ↓ a max_parallel
      await drain();
      stdin.write('\r'); // config-edit
      await drain();
      stdin.write('\x7f'); // ''
      await drain();
      stdin.write('5'); // '5' (válido)
      await drain();
      stdin.write('\r'); // intenta guardar → falla
      await drain();
      const frame = lastFrame();
      // CONFIG_SAVE_FAILED lleva `[!]` (metacaracteres de regex) → assert por substring literal.
      assert.ok(frame.includes(CONFIG_SAVE_FAILED), `una escritura fallida pinta CONFIG_SAVE_FAILED\n${frame}`);
      assert.ok(frame.length > 0, 'el panel ink sigue montado (lastFrame no vacío)');
    } finally {
      unmount();
    }
  });
});
