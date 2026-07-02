// @ts-check
//
// test/dashboard-mask.test.js — Phase 67 Plan 02 (SETUP-03/04, D-05/D-06/D-07/D-09).
//
// Verifica el campo ENMASCARADO de la API key en el overlay de config del dashboard:
//   - render de la máscara (`•` por char) que NUNCA pinta el valor raw (Pitfall 11),
//   - el callback DI `onSaveApiKey` recibe (api_key_env, valorReal) — escritura en-proceso,
//   - el indicador de PRESENCIA `[configurado]`/`[sin configurar]` (D-09, jamás el valor),
//   - la degradación non-TTY (`rawModeSupported=false`, Pitfall 16) — never-throws, no cuelga,
//   - la limpieza del buffer tras save/cancel (Pitfall 6: sin secreto colgado en memoria).
//
// NO re-testea `writeEnvVar` (eso es 67-01) — el callback es un SPY, así que el `~/.kodo/.env`
// real NUNCA se toca (dogfooding: el daemon vivo guarda secretos reales).
//
// Dos capas: (A) render DIRECTO de SessionTable (máscara/indicador/degradación — sin coreografía
// de stdin), y (B) integración con App vía ink-testing-library (callback/buffer-clear — molde
// hermético de dashboard-config.test.js). Pitfall 5 (RESEARCH): `lastFrame()` incluye ANSI del
// cursor `inverse`; se asierte por CONTENIDO de texto, nunca por posición/styling.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App, {
  API_KEY_LABEL,
  API_KEY_CONFIGURED,
  API_KEY_UNSET,
  API_KEY_NO_RAWMODE,
  API_KEY_SAVED_RESTART,
} from '../src/cli/dashboard/App.js';
import SessionTable from '../src/cli/dashboard/SessionTable.js';

// Snapshot de config con valores conocidos + api_key_env del provider activo (mold DEFAULT_CONFIG).
// Ningún secreto vive aquí (api_key_env es el NOMBRE de la env var, no el valor).
const CONFIG_FIXTURE = {
  provider: 'plane',
  providers: {
    plane: {
      base_url: 'https://example.com',
      api_key_env: 'PLANE_API_KEY',
      workspace_slug: 'k-lab',
      states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
    },
  },
  cmux: { colors: { running: 'Amber', done: 'Green', error: 'Crimson', review: 'Blue' } },
  claude: { default_model: 'opus', max_parallel: 3 },
  server: { idle_threshold_min: 5, stuck_threshold_min: 30 },
};

// getEditableFields devuelve 11 campos → el renglón de API key es el índice 11 (APPEND).
const API_KEY_ROW_INDEX = 11;

// ── (A) Render DIRECTO de SessionTable ───────────────────────────────────────
// SessionTable es presentacional: se le pasan props y se lee el frame. Evita la coreografía de
// stdin/drain para las aserciones de puro render (máscara, indicador, degradación).

describe('67-02 render: máscara del text-input de API key (D-05/Pitfall 11)', () => {
  it('mask=true pinta `•` por carácter y NUNCA el valor raw', () => {
    const { lastFrame, unmount } = render(
      createElement(SessionTable, {
        rows: [],
        selectedIndex: -1,
        counts: { running: 0, review: 0, done: 0, error: 0, zombie: 0 },
        connected: true,
        lastGoodCount: 0,
        lastGoodAt: 1,
        lastAttemptAt: 1,
        mode: 'config-edit',
        configSnapshot: CONFIG_FIXTURE,
        fieldCursor: API_KEY_ROW_INDEX,
        buffer: 'topsecret',
        cursor: 9,
        mask: true,
        rawModeSupported: true,
      }),
    );
    try {
      const frame = lastFrame();
      assert.match(frame, /•/, `mask=true debe pintar bullets\n${frame}`);
      assert.doesNotMatch(frame, /topsecret/, `el valor raw NUNCA se pinta (Pitfall 11)\n${frame}`);
      assert.match(frame, new RegExp(API_KEY_LABEL), `el renglón de API key debe estar presente\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('mask=false pinta el buffer tal cual (control: la máscara es opt-in)', () => {
    const { lastFrame, unmount } = render(
      createElement(SessionTable, {
        rows: [],
        selectedIndex: -1,
        counts: { running: 0, review: 0, done: 0, error: 0, zombie: 0 },
        connected: true,
        lastGoodCount: 0,
        lastGoodAt: 1,
        lastAttemptAt: 1,
        mode: 'config-edit',
        configSnapshot: CONFIG_FIXTURE,
        fieldCursor: API_KEY_ROW_INDEX,
        buffer: 'plain',
        cursor: 5,
        mask: false,
        rawModeSupported: true,
      }),
    );
    try {
      const frame = lastFrame();
      assert.match(frame, /plain/, `mask=false debe pintar el buffer sin enmascarar\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('67-02 render: indicador de presencia [configurado] (D-09)', () => {
  function renderConfigList(apiKeyConfigured, rawModeSupported = true) {
    return render(
      createElement(SessionTable, {
        rows: [],
        selectedIndex: -1,
        counts: { running: 0, review: 0, done: 0, error: 0, zombie: 0 },
        connected: true,
        lastGoodCount: 0,
        lastGoodAt: 1,
        lastAttemptAt: 1,
        mode: 'config',
        configSnapshot: CONFIG_FIXTURE,
        fieldCursor: API_KEY_ROW_INDEX,
        apiKeyConfigured,
        rawModeSupported,
      }),
    );
  }

  it('apiKeyConfigured=true → [configurado] (presencia, jamás el valor)', () => {
    const { lastFrame, unmount } = renderConfigList(true);
    try {
      const frame = lastFrame();
      assert.ok(frame.includes(API_KEY_CONFIGURED), `presencia → [configurado]\n${frame}`);
      assert.doesNotMatch(frame, /PLANE_API_KEY/, `nunca el nombre de la env var ni el valor\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('apiKeyConfigured=false → [sin configurar]', () => {
    const { lastFrame, unmount } = renderConfigList(false);
    try {
      const frame = lastFrame();
      assert.ok(frame.includes(API_KEY_UNSET), `sin presencia → [sin configurar]\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('67-02 render: degradación non-TTY (D-07/Pitfall 16)', () => {
  it('rawModeSupported=false → mensaje a `kodo config`, no muestra el indicador ni edita', () => {
    const { lastFrame, unmount } = render(
      createElement(SessionTable, {
        rows: [],
        selectedIndex: -1,
        counts: { running: 0, review: 0, done: 0, error: 0, zombie: 0 },
        connected: true,
        lastGoodCount: 0,
        lastGoodAt: 1,
        lastAttemptAt: 1,
        mode: 'config',
        configSnapshot: CONFIG_FIXTURE,
        fieldCursor: API_KEY_ROW_INDEX,
        apiKeyConfigured: true, // aun con presencia, la degradación gana
        rawModeSupported: false,
      }),
    );
    try {
      const frame = lastFrame();
      assert.ok(frame.includes(API_KEY_NO_RAWMODE), `non-TTY debe mostrar la degradación\n${frame}`);
      assert.ok(!frame.includes(API_KEY_CONFIGURED), `la degradación gana al indicador\n${frame}`);
    } finally {
      unmount();
    }
  });
});

// ── (B) Integración con App (callback + buffer-clear) ─────────────────────────
// Molde hermético de dashboard-config.test.js: fake clock + injectProps + drain + router.

function makeFakeClock(startMs = 1_000_000) {
  /** @type {Array<{ handle: number, fn: Function }>} */
  let pending = [];
  let nextHandle = 1;
  let nowMs = startMs;
  const schedule = (fn) => { const h = nextHandle++; pending.push({ handle: h, fn }); return h; };
  const cancel = (h) => { pending = pending.filter((p) => p.handle !== h); };
  let nextTimeoutHandle = 10000;
  const scheduleTimeout = () => nextTimeoutHandle++;
  const cancelTimeout = () => {};
  return { schedule, cancel, scheduleTimeout, cancelTimeout, now: () => nowMs, advance: (ms) => { nowMs += ms; } };
}

// Spy de onSaveApiKey: registra (key, value) y devuelve un resultado controlado. NUNCA llama al
// writeEnvVar real → el ~/.kodo/.env real queda intacto (dogfooding seguro).
function makeApiKeySpy(result = { ok: true }) {
  const spy = { calls: 0, lastKey: /** @type {any} */ (null), lastValue: /** @type {any} */ (null) };
  const fn = async (/** @type {string} */ key, /** @type {string} */ value) => {
    spy.calls += 1;
    spy.lastKey = key;
    spy.lastValue = value;
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
    loadConfigFn: () => structuredClone(CONFIG_FIXTURE),
    ...extra,
  };
}

async function drain() {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
}

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

const STATUS_FIXTURE = {
  count: 1,
  sessions: [
    {
      task_id: 'a', task_ref: 'KL-1', workspace_ref: 'ws-a', status: 'running', alive: true,
      started_at: '2026-05-27T10:00:00Z', project_name: 'kodo', elapsed_min: 5, summary: '',
    },
  ],
};

function makeRouter() {
  return async (url) => {
    const u = String(url);
    if (u.endsWith('/status')) return okResponse(STATUS_FIXTURE);
    if (u.endsWith('/logs')) return okResponse({ logs: [] });
    return okResponse(STATUS_FIXTURE);
  };
}

// Abre config y navega hasta el renglón de API key (11 ↓ desde el índice 0).
async function openApiKeyRow(stdin) {
  stdin.write('e');
  await drain();
  for (let i = 0; i < API_KEY_ROW_INDEX; i++) {
    stdin.write('\x1b[B'); // ↓
    await drain();
  }
}

describe('67-02 integración: onSaveApiKey recibe (api_key_env, valorReal)', () => {
  it('teclear la key y Enter llama a onSaveApiKey una vez con el valor real; muestra aviso de reinicio', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { spy, fn } = makeApiKeySpy({ ok: true });
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onSaveApiKey: fn })),
    );
    try {
      await openApiKeyRow(stdin);
      stdin.write('\r'); // Enter → config-edit ENMASCARADO, buffer vacío
      await drain();
      for (const ch of 'sk-secret') { stdin.write(ch); await drain(); }
      // La máscara está activa: el valor raw no se pinta.
      assert.doesNotMatch(lastFrame(), /sk-secret/, `el valor raw no debe pintarse\n${lastFrame()}`);
      assert.match(lastFrame(), /•/, `la máscara debe pintar bullets\n${lastFrame()}`);
      stdin.write('\r'); // guarda
      await drain();
      assert.equal(spy.calls, 1, 'onSaveApiKey debe llamarse exactamente una vez');
      assert.equal(spy.lastKey, 'PLANE_API_KEY', 'la key es el api_key_env del provider activo');
      assert.equal(spy.lastValue, 'sk-secret', 'el valor pasado al callback es el REAL (no la máscara)');
      assert.ok(lastFrame().includes(API_KEY_SAVED_RESTART), `tras guardar debe verse el aviso de reinicio\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });
});

describe('67-02 integración: buffer se limpia tras cancelar (Pitfall 6)', () => {
  it('teclear, Esc, re-entrar → el campo está vacío (sin secreto colgado)', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { spy, fn } = makeApiKeySpy({ ok: true });
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { onSaveApiKey: fn })),
    );
    try {
      await openApiKeyRow(stdin);
      stdin.write('\r'); // config-edit
      await drain();
      for (const ch of 'abcd') { stdin.write(ch); await drain(); }
      assert.equal((lastFrame().match(/•/g) || []).length, 4, `4 chars → 4 bullets\n${lastFrame()}`);
      stdin.write('\x1b'); // Esc → cancela, limpia el buffer
      await drain();
      stdin.write('\r'); // re-entra al renglón (sigue seleccionado)
      await drain();
      stdin.write('z'); // un solo char
      await drain();
      assert.equal(spy.calls, 0, 'cancelar no debe llamar a onSaveApiKey');
      assert.equal((lastFrame().match(/•/g) || []).length, 1, `re-entrar con buffer limpio → 1 bullet, no 5\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });
});

describe('67-02 integración: indicador [configurado] refleja isApiKeyConfiguredFn', () => {
  it('isApiKeyConfiguredFn=()=>true → el overlay muestra [configurado] (nunca el valor)', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter();
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, fetchFn, { isApiKeyConfiguredFn: () => true })),
    );
    try {
      stdin.write('e');
      await drain();
      const frame = lastFrame();
      assert.ok(frame.includes(API_KEY_CONFIGURED), `presencia → [configurado]\n${frame}`);
      assert.doesNotMatch(frame, /PLANE_API_KEY/, `nunca el nombre de la env var\n${frame}`);
    } finally {
      unmount();
    }
  });
});
