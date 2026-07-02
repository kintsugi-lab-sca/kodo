// @ts-check
//
// test/dashboard/app-setup.test.js — Phase 68 Plan 02 Wave 0 RED (SETUP-01 render, SETUP-02).
//
// State-machine del NUEVO `mode:'setup'` del dashboard (onboarding first-run, D-01/D-04). Molde
// hermético de app-dismiss.test.js: `render` de ink-testing-library + `createElement(App, {...})` +
// import de las constantes exportadas + fake clock + `stdin.write(...)` → `lastFrame()`. Los
// callbacks `onSaveConfig`/`onSaveApiKey` son fakes que registran sus argumentos → CERO contacto
// con el ~/.kodo/ real del operador (dogfooding con secretos vivos, PERSIST-04).
//
// Cubre los 6 casos del Test Map de VALIDATION.md (SETUP-02):
//   (a) mount setup:true → SETUP_OVERLAY_TITLE + SETUP_STEP_PROVIDER (entra en setup, no en la tabla).
//   (b) selector: Enter en `plane` → onSaveConfig con provider:'plane' + avanza a base_url.
//   (c) Enter en `github` → SETUP_GITHUB_REDIRECT, NO avanza, cero onSaveConfig estructural (D-06).
//   (d) base_url + workspace_slug: teclear + Enter → onSaveConfig con el valor en el path (SETUP-02).
//   (e) apikey: teclear → el frame muestra `•` (NUNCA el valor literal, T-68-04); Enter →
//       onSaveApiKey(api_key_env, valor) + SETUP_COMPLETE_RESTART (aviso honesto, D-08).
//   (f) non-TTY (rawModeSupported:false) → SETUP_NO_RAWMODE, never-throws (D-13, layer de render).
//
// RESEARCH Pitfall 5: ink NO awaitea el handler async → un save encadenado necesita el frame
// intermedio; el drain de setTimeout(80ms) (molde app-dismiss) es load-bearing.
//
// Wave 0 RED: falla hasta que Task 2 exporte las SETUP_* y añada el mode:'setup'.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App, {
  SETUP_OVERLAY_TITLE,
  SETUP_STEP_PROVIDER,
  SETUP_STEP_BASE_URL,
  SETUP_STEP_WORKSPACE,
  SETUP_STEP_APIKEY,
  SETUP_GITHUB_REDIRECT,
  SETUP_COMPLETE_RESTART,
  SETUP_NO_RAWMODE,
} from '../../src/cli/dashboard/App.js';
import SessionTable from '../../src/cli/dashboard/SessionTable.js';

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

// Config fixture del modo setup: provider plane con api_key_env (para el paso 4/4), estructurales
// vacíos (first-run). loadConfigFn devuelve un CLON → App lo deep-clona internamente al montar.
const SETUP_CONFIG_FIXTURE = {
  provider: 'plane',
  providers: {
    plane: {
      base_url: '',
      api_key_env: 'PLANE_API_KEY',
      workspace_slug: '',
      states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
    },
  },
  cmux: { colors: { running: 'Amber', done: 'Green', error: 'Crimson', review: 'Blue' } },
  claude: { default_model: 'opus', max_parallel: 3 },
  server: { idle_threshold_min: 5, stuck_threshold_min: 30 },
};

// Spy de onSaveConfig: registra cada config recibido (array). NUNCA llama al saveConfig real.
function makeConfigSpy(result = { ok: true }) {
  const spy = { calls: /** @type {any[]} */ ([]) };
  const fn = async (/** @type {any} */ cfg) => {
    spy.calls.push(cfg);
    return result;
  };
  return { spy, fn };
}

// Spy de onSaveApiKey: registra (key, value). NUNCA llama al writeEnvVar real (dogfooding seguro).
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

function injectProps(clock, extra = {}) {
  return {
    baseUrl: 'http://localhost:9090',
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ count: 0, sessions: [] }) }),
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    scheduleTimeout: clock.scheduleTimeout,
    cancelTimeout: clock.cancelTimeout,
    setup: true,
    loadConfigFn: () => structuredClone(SETUP_CONFIG_FIXTURE),
    ...extra,
  };
}

// RESEARCH Pitfall 5 (molde app-dismiss): 80ms es load-bearing para keystrokes encadenados que
// dependen del re-render previo (cada paso del wizard transiciona el sub-modo).
function drain() {
  return new Promise((resolve) => setTimeout(resolve, 80));
}

describe('SETUP-02: state-machine del modo setup (provider → base_url → workspace_slug → apikey)', () => {
  it('(a) mount con setup:true entra en modo setup (título + paso 1/4 provider)', async () => {
    const clock = makeFakeClock();
    const { lastFrame, unmount } = render(createElement(App, injectProps(clock)));
    try {
      await drain();
      const frame = lastFrame();
      assert.ok(frame.includes(SETUP_OVERLAY_TITLE), `debe mostrar el título del overlay\n${frame}`);
      assert.ok(frame.includes(SETUP_STEP_PROVIDER), `debe entrar en el paso 1/4 provider\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('(b) Enter en `plane` guarda provider y avanza al paso base_url', async () => {
    const clock = makeFakeClock();
    const { spy, fn } = makeConfigSpy();
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, { onSaveConfig: fn })),
    );
    try {
      await drain();
      stdin.write('\r'); // Enter en plane (cursor 0 por defecto)
      await drain();
      const frame = lastFrame();
      assert.equal(spy.calls.length, 1, 'plane debe disparar exactamente un onSaveConfig');
      assert.equal(spy.calls[0]?.provider, 'plane', 'el config guardado lleva provider:plane');
      assert.ok(frame.includes(SETUP_STEP_BASE_URL), `debe avanzar al paso 2/4 base_url\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('(c) Enter en `github` muestra el redirect y NO avanza (cero onSaveConfig estructural, D-06)', async () => {
    const clock = makeFakeClock();
    const { spy, fn } = makeConfigSpy();
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, { onSaveConfig: fn })),
    );
    try {
      await drain();
      stdin.write('\x1b[B'); // ↓ mueve el cursor a github
      await drain();
      stdin.write('\r'); // Enter en github
      await drain();
      const frame = lastFrame();
      assert.ok(frame.includes(SETUP_GITHUB_REDIRECT), `github debe mostrar el redirect\n${frame}`);
      assert.equal(spy.calls.length, 0, 'github NO debe disparar onSaveConfig estructural (D-06)');
      assert.ok(!frame.includes(SETUP_STEP_BASE_URL), `github NO debe avanzar al guiado\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('(d) base_url y workspace_slug persisten al path correcto vía onSaveConfig', async () => {
    const clock = makeFakeClock();
    const { spy, fn } = makeConfigSpy();
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, { onSaveConfig: fn })),
    );
    try {
      await drain();
      stdin.write('\r'); // plane → avanza a base_url
      await drain();
      for (const ch of 'https://tasks.test') { stdin.write(ch); await drain(); }
      stdin.write('\r'); // guarda base_url → avanza a workspace_slug
      await drain();
      const afterBaseUrl = spy.calls[spy.calls.length - 1];
      assert.equal(
        afterBaseUrl?.providers?.plane?.base_url,
        'https://tasks.test',
        'base_url debe persistir en providers.plane.base_url',
      );
      assert.ok(lastFrame().includes(SETUP_STEP_WORKSPACE), 'debe avanzar al paso 3/4 workspace_slug');
      for (const ch of 'my-workspace') { stdin.write(ch); await drain(); }
      stdin.write('\r'); // guarda workspace_slug → avanza a apikey
      await drain();
      const afterSlug = spy.calls[spy.calls.length - 1];
      assert.equal(
        afterSlug?.providers?.plane?.workspace_slug,
        'my-workspace',
        'workspace_slug debe persistir en providers.plane.workspace_slug',
      );
      assert.ok(lastFrame().includes(SETUP_STEP_APIKEY), 'debe avanzar al paso 4/4 API key');
    } finally {
      unmount();
    }
  });

  it('(e) apikey se enmascara (`•`, nunca el valor) y persiste vía onSaveApiKey + aviso de reinicio', async () => {
    const clock = makeFakeClock();
    const cfg = makeConfigSpy();
    const key = makeApiKeySpy();
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, { onSaveConfig: cfg.fn, onSaveApiKey: key.fn })),
    );
    const SECRET = 'sk-secret-123';
    try {
      await drain();
      stdin.write('\r'); // plane → base_url
      await drain();
      for (const ch of 'https://tasks.test') { stdin.write(ch); await drain(); }
      stdin.write('\r'); // base_url → workspace_slug
      await drain();
      for (const ch of 'my-workspace') { stdin.write(ch); await drain(); }
      stdin.write('\r'); // workspace_slug → apikey
      await drain();
      for (const ch of SECRET) { stdin.write(ch); await drain(); }
      // T-68-04 (held-out de seguridad): el VALOR de la key NUNCA aparece en el frame — solo `•`.
      const editing = lastFrame();
      assert.ok(!editing.includes(SECRET), `el valor de la key JAMÁS debe renderizarse raw\n${editing}`);
      assert.ok(editing.includes('•'), `el paso apikey debe pintar la mascara de puntos\n${editing}`);
      stdin.write('\r'); // guarda la API key
      await drain();
      await drain(); // Pitfall 5: ink no awaitea el handler async
      const done = lastFrame();
      assert.equal(key.spy.calls, 1, 'Enter en apikey debe disparar exactamente un onSaveApiKey');
      assert.equal(key.spy.lastKey, 'PLANE_API_KEY', 'onSaveApiKey recibe el api_key_env, no el valor crudo del path');
      assert.equal(key.spy.lastValue, SECRET, 'onSaveApiKey recibe el valor tecleado');
      assert.ok(done.includes(SETUP_COMPLETE_RESTART), `al completar debe mostrar el aviso de reinicio honesto\n${done}`);
      assert.ok(!done.includes(SECRET), `el valor de la key NUNCA aparece tras guardar\n${done}`);
    } finally {
      unmount();
    }
  });
});

describe('SETUP-02/D-13: degradación non-TTY del modo setup (layer de render, never-throws)', () => {
  it('(f) rawModeSupported:false → SETUP_NO_RAWMODE, no lanza', () => {
    let frame = '';
    assert.doesNotThrow(() => {
      const { lastFrame, unmount } = render(
        createElement(SessionTable, {
          rows: [],
          selectedIndex: -1,
          counts: {},
          connected: false,
          mode: 'setup',
          setupStep: 'provider',
          providerCursor: 0,
          buffer: '',
          cursor: 0,
          mask: false,
          rawModeSupported: false,
        }),
      );
      frame = lastFrame();
      unmount();
    }, 'el render non-TTY del modo setup NUNCA debe lanzar');
    assert.ok(frame.includes(SETUP_NO_RAWMODE), `non-TTY debe mostrar la degradación honesta\n${frame}`);
  });
});
