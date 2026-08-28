// @ts-check
//
// test/helpers/dashboard-ctx.js — KODO-40.
//
// Fake del `ctx` que App.js construye por pulsación y pasa a las sub-máquinas de teclado
// extraídas (SetupWizard / OverlayViewer / AdoptPicker / ConfigEditor / ProjectsEditor /
// RowActions). Sustituye el estado React por un objeto plano: los VALORES son campos normales y
// los SETTERS los escriben en sitio (aceptando también la forma updater `(prev) => next`, igual
// que React), además de apilar cada escritura en `calls` para poder asertar la secuencia.
//
// Esto permite testear cada handler sin montar el árbol ink — imposible mientras los handlers
// eran ramas anónimas de un único `useInput` de ~1170 líneas.

/**
 * @param {Record<string, any>} [overrides] - valores iniciales y stubs de DI.
 * @returns {any} ctx con `calls` (log de setters) y `keys` (helpers de teclas).
 */
export function makeCtx(overrides = {}) {
  /** @type {Array<[string, any]>} */
  const calls = [];
  const ctx = {
    calls,
    // ── estado por defecto (el mismo shape que App.js) ──────────────────────
    baseUrl: 'http://127.0.0.1:7777',
    fetchFn: async () => {
      throw new Error('fetchFn no stubbeado en este test');
    },
    sessions: [],
    projects: {},
    mode: 'list',
    buffer: '',
    cursor: 0,
    configSnapshot: null,
    fieldCursor: 0,
    setupStep: 'provider',
    providerCursor: 0,
    projectsSnapshot: null,
    adoptCursor: 0,
    armedSurface: null,
    armedTaskId: null,
    armedTaskRef: null,
    overlaySnapshot: null,
    overlayReqRef: { current: 0 },
    projectsReqRef: { current: 0 },
    // ── DI inerte (cada test sobreescribe lo que necesite) ──────────────────
    loadConfigFn: () => ({ provider: 'plane', providers: { plane: {} } }),
    onSaveConfig: async () => ({ ok: true }),
    onSaveApiKey: async () => ({ ok: true }),
    listProjectsFn: async () => ({ ok: true, projects: [] }),
    loadProjectsFn: () => ({}),
    saveProjectsFn: () => {},
    listModulesFn: async () => ({ ok: true, modules: [] }),
    dispatchProjectIdsFn: () => [],
    ...overrides,
  };
  // Setters: escriben en sitio (soportando la forma updater) y registran la llamada.
  for (const [name, field] of [
    ['setMode', 'mode'],
    ['setBuffer', 'buffer'],
    ['setCursor', 'cursor'],
    ['setMaskValue', 'maskValue'],
    ['setFocusError', 'focusError'],
    ['setFooterColor', 'footerColor'],
    ['setConfigSnapshot', 'configSnapshot'],
    ['setConfigEditError', 'configEditError'],
    ['setFieldCursor', 'fieldCursor'],
    ['setSetupStep', 'setupStep'],
    ['setProviderCursor', 'providerCursor'],
    ['setProjectsSnapshot', 'projectsSnapshot'],
    ['setProjectsError', 'projectsError'],
    ['setProjectsEditError', 'projectsEditError'],
    ['setOverlaySnapshot', 'overlaySnapshot'],
    ['setOverlayKind', 'overlayKind'],
    ['setScrollOffset', 'scrollOffset'],
    ['setAdoptCursor', 'adoptCursor'],
    ['setArmedSessionId', 'armedSessionId'],
    ['setArmedSurface', 'armedSurface'],
    ['setArmedTaskId', 'armedTaskId'],
    ['setArmedTaskRef', 'armedTaskRef'],
  ]) {
    ctx[name] = (/** @type {any} */ v) => {
      const next = typeof v === 'function' ? v(ctx[field]) : v;
      ctx[field] = next;
      calls.push([name, next]);
    };
  }
  return ctx;
}

/** Teclas de ink: solo los flags que los handlers consultan. */
export const KEY = {
  none: {},
  escape: { escape: true },
  up: { upArrow: true },
  down: { downArrow: true },
  left: { leftArrow: true },
  right: { rightArrow: true },
  enter: { return: true },
  backspace: { backspace: true },
};

/**
 * ¿Se llamó a `name` en algún momento? (con el valor, si se pide).
 * @param {any} ctx
 * @param {string} name
 */
export function called(ctx, name) {
  return ctx.calls.filter((/** @type {[string, any]} */ c) => c[0] === name).map((/** @type {[string, any]} */ c) => c[1]);
}
