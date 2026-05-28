# Phase 37: Focus — invocar `cmux select-workspace` — Pattern Map

**Mapped:** 2026-05-28
**Files analyzed:** 7 (3 new modules + 2 modified + 2 new tests + 1 UAT artifact)
**Analogs found:** 7 / 7 (100% coverage — todos los archivos tienen analog directo en el repo)

> Phase 37 (revised tras hallazgo C-01) es ENSAMBLAJE de primitivas existentes: `execFile` fire-and-forget (espejo de `src/cmux/client.js`), never-throws + discriminated union (espejo de `src/cli/dashboard/client.js` Phase 35), DI en `runDashboard` (continuación de Phase 34 D-DI), prop-passing a `<App />`+`useState`+`useInput` (espejo de Phase 36), tests con fakes inyectables y mensajes literal-estables (espejo de Phase 35 client tests), UAT artifact con frontmatter `status:`/`source:` (espejo de Phase 36 UAT). Cero invención.

---

## File Classification

| New/Modified file | Role | Data flow | Closest analog | Match quality |
|---|---|---|---|---|
| `src/cli/dashboard/focus.js` (**NEW**) | orquestador puro / service | request-response (in: `{exec, ref, binary, timeoutMs}`; out: discriminated union `{ok}`) | `src/cmux/client.js:14-26` (`run(args)` execFile pattern) + `src/cli/dashboard/client.js:47-58` (never-throws shape) | exact (rol + flujo) |
| `src/cli/dashboard/index.js` (**MODIFIED**) | orchestrator wiring / process owner | DI extension (in: `deps.exec`; out: prop `onFocus` a `<App />`) | self (mismo archivo, Phase 34 D-DI patrón: `stdout`/`stdin`/`url`) | exact (extensión homogénea) |
| `src/cli/dashboard/App.js` (**MODIFIED**) | view component / interaction routing | event-driven (in: `key.return`; out: `await onFocus(...)` + `setFocusError`) | self (Phase 36 `useInput` mode-gated bloque `mode==='list'`, líneas 198-219) + Phase 35 `lastError` state (línea 109) | exact (extensión homogénea) |
| `src/cli/dashboard/SessionTable.js` (**POSIBLE MOD**) | view component / presentational | request-response (in: prop `focusError`; out: render condicional rojo del footer) | self (Phase 36 `filterLine` render condicional líneas 145-148; precedencia D-12 líneas 155-167) | exact (mismo patrón "render condicional por prop opcional") |
| `test/dashboard/focus.test.js` (**NEW**) | Wave 0 RED unit test | request-response (fake `exec` → asserts sobre args + return) | `test/dashboard-client.test.js:24-114` (5 escenarios discriminados con fake inyectable + leak guard) | exact (mismo patrón Wave 0) |
| `test/dashboard/app-focus.test.js` (**NEW**) | Wave 0 RED integration test (ink-testing-library) | event-driven (render `<App>` + `stdin.write` + `lastFrame()` assert) | `test/dashboard-render.test.js:34-77` (render + stdin.write + lastFrame + frame count) | exact (mismo patrón) |
| `.planning/phases/37-attach-handoff-cmux/37-HUMAN-UAT.md` (**NEW**) | UAT artifact (D-08, bloqueante) | sign-off (in: ejecución manual; out: pass/fail con observed) | `.planning/phases/36-tabla-viva-render-seleccion-filtros/36-HUMAN-UAT.md:1-46` (frontmatter + Current Test + Tests + Summary + Gaps) | exact (formato literal) |

---

## Pattern Assignments

### `src/cli/dashboard/focus.js` (NEW — orquestador puro, never-throws)

**Role:** Orquestador puro testeable. Recibe `exec` inyectado, retorna discriminated union. Never-throws (Phase 35 D-07 contract).
**Data flow:** Input `{exec, ref, binary, timeoutMs?}` → Output `Promise<{ok:true} | {ok:false, code:'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail}>`.

**Primary analog: `src/cmux/client.js:14-26`** (Pattern espejo — `execFile` + binary lookup + timeout + error mapping; copiar la *forma*, NO la propagación por reject).

Imports + body literal del analog (lines 1-26):
```js
// @ts-check
import { execFile } from 'node:child_process';
import { loadConfig } from '../config.js';

function getCmuxBinary() {
  return loadConfig().cmux.binary;
}

/**
 * @param {string[]} args
 * @param {import('../logger.js').Logger} [logger]
 * @returns {Promise<string>}
 */
function run(args, logger) {
  return new Promise((resolve, reject) => {
    logger?.debug('cmux.exec', { cmd: args[0], argc: args.length });
    execFile(getCmuxBinary(), args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        logger?.warn('cmux.fail', { cmd: args[0], stderr: String(stderr || '').slice(0, 200) });
        reject(new Error(`cmux ${args[0]} failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
```

**Adaptations a aplicar (las 4 divergencias load-bearing):**
1. **`binary` viene por argumento, no por `getCmuxBinary()` interno**: D-01 + Claude's Discretion exigen que `focus.js` reciba `binary` como parámetro inyectable (testeable sin tocar `loadConfig`). `runDashboard` lo resuelve con `loadConfig().cmux.binary` y se lo pasa (D-07).
2. **`exec` inyectado en lugar de `execFile` literal**: D-01 + DI Phase 34 — `runFocus({ exec, ref, binary, timeoutMs })`.
3. **Args literales fijos**: `['select-workspace', '--workspace', ref]` (D-07), NO `[...args]` genérico.
4. **NEVER-THROWS — reemplaza `reject(...)` por `resolve({ok:false, code, detail})`** (D-01 + Phase 35 D-07 contract). El mapeo de `err.code`:
   - `err.code === 'ENOENT'` → `{ok:false, code:'ENOENT', detail: err.message}`
   - `err.code === number` (exit code ≠ 0) → `{ok:false, code:'NON_ZERO_EXIT', detail: err.code}`
   - `err` capturado en `try/catch` síncrono o cualquier otra forma → `{ok:false, code:'SPAWN_ERROR', detail: err.message}`
   - `!err` → `{ok:true}`
5. **Timeout 5_000 (no 15_000)** — D-07: la RPC al socket de cmux es ~50ms; timeout corto evita enmascarar un cmux colgado.

**Secondary analog (forma del retorno): `src/cli/dashboard/client.js:47-58`** — el discriminated union never-throws ya está canónico en `fetchStatus`:

```js
export async function fetchStatus(baseUrl, fetchFn = globalThis.fetch, signal) {
  try {
    const res = await fetchFn(`${baseUrl}/status`, { signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!Array.isArray(data.sessions)) return { ok: false, error: 'bad shape' };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

**Adapt:** Misma forma `{ok:true} | {ok:false, ...}`, pero con `code` (un literal type union) en vez de `error` (string libre). El header-comment de `focus.js` debe documentar la divergencia tal y como `client.js` documenta la suya respecto a `src/providers/plane/client.js` (líneas 17-22 del cliente).

**No-picocolors invariant:** `focus.js` debe importar SOLO `node:child_process` y (opcionalmente) tipos. Cero import de `picocolors`, cero import de `src/cli/format.js`. El walker `test/format-isolation.test.js:199-220` lo verifica automáticamente porque escanea `src/cli/dashboard/**`.

---

### `src/cli/dashboard/index.js` (MODIFIED — DI extension + onFocus prop)

**Role:** Process owner. Phase 37 le añade `exec` a `deps` y le cablea `onFocus` como prop a `<App />`. **CERO modificación a alt-screen toggle, SIGTERM handler, exit code, o `try/finally` lineal** (constraint del CONTEXT.md — D-12 Phase 34 D-10 preserved, NO-ALT-SCREEN-MUTATION + NO-SIGNAL-HANDLER-MUTATION del VALIDATION.md).
**Data flow:** Input `deps.exec` (DI); output: prop `onFocus={async (ref) => runFocus({...})}` al render de `App`.

**Primary analog: self — `src/cli/dashboard/index.js:78-131`** (mismo archivo, patrón DI Phase 34 D-DI).

Firma actual (line 78-79):
```js
export async function runDashboard(deps = {}) {
  const { stdout = process.stdout, stdin = process.stdin, url } = deps;
```

Lazy imports + render actuales (líneas 93-109):
```js
const { loadConfig } = await import('../../config.js');
const baseUrl = resolveBaseUrl({ url, loadConfig });

const { render } = await import('ink');
const { createElement } = await import('react');
const App = (await import('./App.js')).default;

stdout.write('\x1b[?1049h');

const app = render(createElement(App, { baseUrl }));
```

**Adaptations a aplicar:**
1. **Añadir `exec` al destructuring de `deps`** (mismo lugar y forma que `stdout`/`stdin`/`url`):
   ```js
   const {
     stdout = process.stdout,
     stdin = process.stdin,
     url,
     exec, // Phase 37 D-01 — inyectable; default lazy import abajo
   } = deps;
   ```
2. **Lazy import del execFile default** (si `exec` no inyectado) — mismo patrón lazy del repo:
   ```js
   const execImpl = exec ?? (await import('node:child_process')).execFile;
   ```
3. **Lazy import de `runFocus`** (mismo patrón que `App`):
   ```js
   const { runFocus } = await import('./focus.js');
   ```
4. **Resolver `cmuxBin` una sola vez** (no en cada Enter — `loadConfig()` ya hizo I/O):
   ```js
   const cmuxBin = loadConfig().cmux.binary;
   ```
   ⚠️ Pero `loadConfig` está atado al `resolveBaseUrl({ url, loadConfig })` — el planner decide: o llamar `loadConfig()` una segunda vez aquí, o izar `const cfg = loadConfig(); const baseUrl = resolveBaseUrl({ url, loadConfig: () => cfg })`. Recomendación: una segunda llamada (cero coste real, máxima legibilidad).
5. **Añadir prop `onFocus` al `createElement(App, …)`**:
   ```js
   const app = render(createElement(App, {
     baseUrl,
     onFocus: async (ref) => runFocus({ exec: execImpl, ref, binary: cmuxBin }),
   }));
   ```

**Non-changes (constraints DURAS del CONTEXT.md):**
- Línea 107 `stdout.write('\x1b[?1049h')` → **NO TOCAR**.
- Líneas 115-118 SIGTERM handler → **NO TOCAR**.
- Líneas 120-130 `try/finally` lineal → **NO añadir `while(true)` loop**.
- Línea 127 `stdout.write('\x1b[?1049l')` → **NO TOCAR**.
- Línea 129 `process.exitCode = 0` → **NO TOCAR**.

---

### `src/cli/dashboard/App.js` (MODIFIED — onFocus prop + focusError state + Enter handler)

**Role:** Component root. Phase 37 le añade prop `onFocus`, estado `focusError`, handler de `Enter` en bloque `mode==='list'` (guard alive→await onFocus→mapeo), y clear-on-any-input.
**Data flow:** Event-driven. `key.return` (mode list) → guard `row.alive === false` → `await onFocus(row.workspace_ref)` → `if (!ok) setFocusError(...)`. Cualquier tecla con `focusError != null` → `setFocusError(null)` y consume.

**Primary analog: self — `src/cli/dashboard/App.js:198-219`** (Phase 36 `useInput` mode='list' branch).

Bloque actual `mode === 'list'` (líneas 198-219, literal):
```js
// mode === 'list'
if (input === 'q') {
  exit(); // D-08: clean unmount, NO process.exit (conservado Phase 34).
  return;
}
if (input === '/') {
  setMode('filter'); // abre la línea de filtro modal (D-13)
  return;
}
if (key.upArrow) {
  const ni = Math.max(0, sel.index - 1);
  if (filtered[ni]) setSelectedTaskId(filtered[ni].task_id);
  return;
}
if (key.downArrow) {
  const ni = Math.min(filtered.length - 1, sel.index + 1);
  if (filtered[ni]) setSelectedTaskId(filtered[ni].task_id);
  return;
}
// key.escape: DELIBERADAMENTE ignorado en modo lista (reservado Phase 38 — D-11/D-15).
```

**Adaptations a aplicar:**

1. **Añadir `onFocus` a la firma de props** (junto a `baseUrl`, `fetchFn`, `now`, etc., líneas 89-99):
   ```js
   export default function App({
     baseUrl, fetchFn, now = Date.now,
     schedule, cancel, scheduleTimeout, cancelTimeout, baseMs, maxMs,
     onFocus, // Phase 37 D-01
   }) {
   ```

2. **Añadir `focusError` useState** (mismo patrón que `lastError` línea 109 de Phase 35, mismo idioma `useState(/** @type {string|null} */ (null))`):
   ```js
   const [focusError, setFocusError] = useState(/** @type {string | null} */ (null));
   ```

3. **Clear-on-any-input al inicio de `useInput`** (ANTES del switch `mode`):
   ```js
   useInput((input, key) => {
     // Phase 37 D-04: cualquier tecla limpia focusError ANTES de procesar (consume).
     if (focusError != null) {
       setFocusError(null);
       return;
     }
     if (mode === 'filter') { /* ... existente ... */ }
     // mode === 'list'
     // ... ramas existentes ...
   ```

4. **Añadir handler de Enter en bloque `mode === 'list'`** DESPUÉS de las ramas `q`/`/`/`upArrow`/`downArrow` y ANTES del comentario `// key.escape: ...`:
   ```js
   if (key.return) {
     const row = sel.row; // sel viene de resolveSelection(filtered, ...) — Phase 36 D-05/D-06
     if (!row) return; // lista vacía: no-op
     if (row.alive === false) {
       // Phase 37 D-02 + D-05: zombie pre-flight — cero invocación de cmux.
       setFocusError('[!] workspace gone (alive=false) — press any key');
       return;
     }
     // D-06: invocación post-flight; runFocus es never-throws (D-01).
     const result = await onFocus?.(row.workspace_ref);
     if (result && !result.ok) {
       if (result.code === 'ENOENT') {
         setFocusError('[!] cmux not found in PATH — press any key');
       } else {
         // NON_ZERO_EXIT o SPAWN_ERROR: detail tiene el code numérico o 'unknown'
         const n = result.detail ?? 'unknown';
         setFocusError(`[!] cmux focus failed (code ${n}) — press any key`);
       }
     }
     return;
   }
   ```

5. **CRÍTICO — async useInput callback:** El handler actual de `useInput` es síncrono. Phase 37 requiere `await onFocus(...)`. Hay dos opciones (Claude's Discretion del CONTEXT.md):
   - **Recomendado (consistente con Phase 35 D-07):** marcar el callback completo como `async (input, key) => {...}`. ink permite handlers async (no awaitea el return; el state update llega cuando resuelve).
   - Alternativa: `onFocus?.(row.workspace_ref).then(result => { ... })`.

   Razón para `async/await`: simétrico con `usePoll`'s `fetchStatus` pattern.

6. **Pasar `focusError` a `SessionTable`** (si el render del footer-error vive ahí — Claude's Discretion):
   ```js
   createElement(SessionTable, { rows: filtered, selectedIndex: sel.index, /* ... */, focusError })
   ```
   Y el footer hint `'↑↓ move · / filter · q quit'` (línea 258) **no cambia** — el footer-error vive DENTRO de `SessionTable` (consistente con la línea de filtro modal, líneas 145-148).

**Reference (resolveSelection / sel.row):** `sel.row` viene de `resolveSelection(filtered, selectedTaskId, prevIndexRef.current)` (línea 162) — el shape de retorno incluye `{ row, taskId, index }`. El planner DEBE verificar que `select.js` expone `sel.row` (no solo `sel.index` + `sel.taskId`). Si no, el handler usa `filtered[sel.index]`.

---

### `src/cli/dashboard/SessionTable.js` (POSIBLE MOD — render condicional del footer-error)

**Role:** Presentational. Phase 37 le añade un slot de render condicional para el footer-error rojo.
**Data flow:** Input prop `focusError?: string | null`; output: si `focusError != null`, sustituir el footer normal por `<Text color="red">{focusError}</Text>`.

**Primary analog: self — `src/cli/dashboard/SessionTable.js:142-148`** (Phase 36 `filterLine` — mismo patrón "render condicional opcional por prop").

Render condicional actual `filterLine` (líneas 142-148):
```js
// Línea de filtro modal (D-13, UI-SPEC:191): prompt `/ <query>▏` al pie, SOLO cuando mode==='filter'.
// El cursor `▏` es el marcador inequívoco de que el input de filtro tiene el foco (lo distingue del
// `/ filter` del footer de hints). `null` cuando no estamos en modo filtro.
const filterLine =
  mode === 'filter'
    ? h(Box, { marginTop: 1 }, h(Text, null, `/ ${query}▏`))
    : null;
```

**Adaptations a aplicar:**

1. **Añadir `focusError` a la firma** (después de `query`, mismo idioma):
   ```js
   export default function SessionTable({
     rows, selectedIndex, counts, connected, lastGoodCount, lastGoodAt, lastAttemptAt,
     hasQuery = false, mode = 'list', query = '',
     focusError = null, // Phase 37 D-04
   }) {
   ```

2. **Construir `errorLine` con el mismo patrón** (después de `filterLine`):
   ```js
   const errorLine =
     focusError != null
       ? h(Box, { marginTop: 1 }, h(Text, { color: 'red' }, focusError))
       : null;
   ```
   **Color-isolation (D-12 Phase 34):** `<Text color="red">` literal — `'red'` es ink color name. Cero picocolors.

3. **Reemplazar `filterLine` por `(errorLine ?? filterLine)`** en los 3 returns de SessionTable (líneas 156, 165, 209) — precedencia: error gana a filter (consistente con el dismiss-on-any-key del clear-on-any-input).

Alternativa Claude's Discretion: izar el render del footer-error a `App.js` (sustituye la línea 258 `'↑↓ move · / filter · q quit'`). Recomendado: dejarlo en `SessionTable` por consistencia con `filterLine` (mismo nivel de granularidad).

---

### `test/dashboard/focus.test.js` (NEW — Wave 0 RED)

**Role:** Unit test del orquestador puro `runFocus`. 5 escenarios discriminados con `exec` fake.
**Data flow:** Fake `exec` callback invokes con varios `err`/`stdout`/`stderr` → asserts sobre `result` y `args` literales.

**Primary analog: `test/dashboard-client.test.js:24-114`** (Phase 35 Plan 01 Wave 0 — exactamente el mismo patrón "discriminante {ok} never-throws con fake inyectable").

Imports + leak guard literal (líneas 24-40):
```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { fetchStatus } from '../src/cli/dashboard/client.js';

// Runtime fetch-leak guard: cualquier test que olvide inyectar `fetchFn` toca este thrower.
// El restore en `after()` evita contaminar el resto de la suite.
const _originalFetch = globalThis.fetch;
before(() => {
  // @ts-ignore — intentional override scoped to this test file.
  globalThis.fetch = () => {
    throw new Error('live fetch leak: test must inject fetchFn as 2nd arg of fetchStatus');
  };
});
after(() => {
  globalThis.fetch = _originalFetch;
});
```

Patrón de fake (líneas 49-56):
```js
function makeFetch(scenario) {
  return async (_url, _init) => ({
    status: scenario.status,
    ok: scenario.ok,
    json: scenario.json ?? (async () => ({})),
  });
}
```

Patrón de escenario discriminado (líneas 74-79):
```js
it('HTTP no-ok: 500 → { ok:false } con error que contiene "500"', async () => {
  const fetchFn = makeFetch({ status: 500, ok: false });
  const result = await fetchStatus(BASE_URL, fetchFn);
  assert.equal(result.ok, false);
  assert.match(result.error, /500/);
});
```

**Adaptations a aplicar (5 escenarios del VALIDATION.md):**

1. **Fake `exec` factory** — modelo: callback-style de `execFile`. El fake captura los args invocados:
   ```js
   function makeExec(scenario) {
     return (cmd, args, opts, cb) => {
       captured = { cmd, args, opts };
       if (scenario.sync_throw) throw new Error('spawn EACCES');
       setImmediate(() => cb(scenario.err ?? null, scenario.stdout ?? '', scenario.stderr ?? ''));
     };
   }
   ```

2. **Escenario `ok path` (TUI-13)** — args literales:
   ```js
   it('ok path: callback sin err → { ok: true } y args ordering literal', async () => {
     let captured;
     const exec = (cmd, args, opts, cb) => {
       captured = { cmd, args };
       setImmediate(() => cb(null, '', ''));
     };
     const result = await runFocus({
       exec, ref: 'workspace:5', binary: '/path/to/cmux',
     });
     assert.deepEqual(result, { ok: true });
     assert.equal(captured.cmd, '/path/to/cmux');
     assert.deepEqual(captured.args, ['select-workspace', '--workspace', 'workspace:5']);
   });
   ```

3. **Escenario `ENOENT mapping` (TUI-14):**
   ```js
   it('ENOENT mapping: err.code="ENOENT" → { ok:false, code:"ENOENT", detail }', async () => {
     const exec = (cmd, args, opts, cb) => {
       const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
       setImmediate(() => cb(err, '', ''));
     };
     const result = await runFocus({ exec, ref: 'workspace:1', binary: 'cmux' });
     assert.equal(result.ok, false);
     assert.equal(result.code, 'ENOENT');
   });
   ```

4. **Escenario `NON_ZERO_EXIT mapping` (TUI-14)** — `err.code = number` (exit code):
   ```js
   it('NON_ZERO_EXIT mapping: err.code=7 → { ok:false, code:"NON_ZERO_EXIT", detail:7 }', async () => {
     const exec = (cmd, args, opts, cb) => {
       const err = Object.assign(new Error('command failed'), { code: 7 });
       setImmediate(() => cb(err, '', ''));
     };
     const result = await runFocus({ exec, ref: 'workspace:1', binary: 'cmux' });
     assert.equal(result.ok, false);
     assert.equal(result.code, 'NON_ZERO_EXIT');
     assert.equal(result.detail, 7);
   });
   ```

5. **Escenario `SPAWN_ERROR never-throws` (TUI-14)** — `exec` lanza síncronamente:
   ```js
   it('never-throws contract: exec sync-throws → { ok:false, code:"SPAWN_ERROR" }', async () => {
     const exec = () => { throw new Error('bad args'); };
     const result = await runFocus({ exec, ref: 'workspace:1', binary: 'cmux' });
     assert.equal(result.ok, false);
     assert.equal(result.code, 'SPAWN_ERROR');
     // contract: la Promise resuelve, NO se rechaza
   });
   ```

**Leak guard adaptation:** No hace falta sobreescribir `globalThis.execFile` (no es global). En su lugar, el leak guard es estructural: `runFocus` REQUIERE `exec` como argumento (no default), así que un test que olvide pasarlo falla con `TypeError: exec is not a function`. Documentar esto en el header-comment.

---

### `test/dashboard/app-focus.test.js` (NEW — Wave 0 RED integration)

**Role:** Integration test con `ink-testing-library`. Cubre `alive===false` guard, clear-on-any-input, footer-error rendering.
**Data flow:** Render `<App>` con fetchFn fake + onFocus spy → simular Enter via `stdin.write('\r')` → assert `lastFrame()`.

**Primary analog: `test/dashboard-render.test.js:34-77`** (Phase 34 Wave 0 — el patrón render+stdin+lastFrame+frame-count está canónico).

Imports + render literal (líneas 34-52):
```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App from '../src/cli/dashboard/App.js';

const NEVER_FETCH = () => new Promise(() => {});

describe('TUI-01: dashboard chrome (D-01)', () => {
  it('renders banner + waiting placeholder + q quit footer', () => {
    const { lastFrame } = render(
      createElement(App, { baseUrl: 'http://localhost:9090', fetchFn: NEVER_FETCH }),
    );
    const frame = lastFrame();
    assert.match(frame, /kodo dashboard/, `banner missing\nframe:\n${frame}`);
    assert.match(frame, /waiting for server/, `status line de arranque "waiting for server" missing\nframe:\n${frame}`);
    assert.match(frame, /q quit/, `footer hint "q quit" missing\nframe:\n${frame}`);
  });
```

Patrón stdin + tick + frame count (líneas 61-77):
```js
it('q triggers clean exit (extra unmount frame vs an ignored key)', async () => {
  const tick = () => new Promise((r) => setTimeout(r, 80));
  const ignored = render(createElement(App, { baseUrl: 'http://localhost:9090', fetchFn: NEVER_FETCH }));
  const baselineFrames = ignored.frames.length;
  ignored.stdin.write('x');
  await tick();
  assert.equal(ignored.frames.length, baselineFrames, ...);
```

**Adaptations a aplicar (3 escenarios del VALIDATION.md):**

1. **Fake fetch que retorna 1 sesión `alive:false`** — patrón espejo de §RESEARCH Code Example 2:
   ```js
   const fakeFetch = async () => ({
     ok: true, status: 200,
     json: async () => ({
       sessions: [{
         task_id: 'T-1', task_ref: 'KL-99', workspace_ref: 'workspace:9',
         status: 'running', alive: false, phase_id: 'p', gsd_mode: 'gsd',
         project_name: 'kodo', project_path: '/x/kodo',
         summary: 'zombie session', started_at: new Date().toISOString(),
       }],
       count: 1, pending: [],
     }),
   });
   ```

2. **Test `alive===false` guard** (TUI-14, criterio #2 — onFocus NUNCA llamado):
   ```js
   it('alive false guard: Enter sobre fila zombie NO llama onFocus y muestra footer rojo', async () => {
     let focusCalls = 0;
     const onFocus = async () => { focusCalls++; return { ok: true }; };
     const { stdin, lastFrame } = render(createElement(App, {
       baseUrl: 'http://localhost:9090', fetchFn: fakeFetch, onFocus,
     }));
     await new Promise(r => setTimeout(r, 50)); // primer poll + render
     stdin.write('\r'); // Enter
     await new Promise(r => setTimeout(r, 20));
     assert.equal(focusCalls, 0, 'onFocus NUNCA debe llamarse con alive:false');
     assert.match(lastFrame(), /workspace gone \(alive=false\)/);
   });
   ```

3. **Test `clear-on-any-input`** (D-04):
   ```js
   it('clear on any input: con focusError visible, cualquier tecla lo limpia', async () => {
     // setup: forzar focusError via fila alive:false + Enter
     // luego: presionar cualquier tecla (ej 'x') → lastFrame() vuelve al footer normal
     // y NO consume otras acciones
     // ...
     stdin.write('\r'); await tick();
     assert.match(lastFrame(), /workspace gone/);
     stdin.write('x'); await tick();
     assert.doesNotMatch(lastFrame(), /workspace gone/);
   });
   ```

4. **Test footer-error rendering** (color rojo):
   ```js
   it('footer-error rendering: mensaje canónico aparece tras Enter sobre zombie', async () => {
     // tras Enter → assert.match(lastFrame(), /workspace gone \(alive=false\) — press any key/)
     // (ink-testing-library no expone color directo; el walker test/format-isolation cubre que
     //  el color sale de <Text color="red"> y no de picocolors)
   });
   ```

**Tick helper:** Reusar el patrón `const tick = () => new Promise(r => setTimeout(r, 80))` (línea 63). Los 80ms son load-bearing — más corto es flakey en CI.

---

### `.planning/phases/37-attach-handoff-cmux/37-HUMAN-UAT.md` (NEW — bloqueante D-08)

**Role:** UAT artifact bloqueante del cierre de fase. 2 escenarios obligatorios + 2 bonus opcionales.
**Data flow:** Human in the loop — ejecución manual con fixture/server real; resultado escrito en slot `Observed:` + sign-off.

**Primary analog: `.planning/phases/36-tabla-viva-render-seleccion-filtros/36-HUMAN-UAT.md:1-46`** (formato literal — frontmatter YAML + Current Test + Tests + Summary + Gaps).

Literal del analog (líneas 1-46):
```markdown
---
status: passed
phase: 36-tabla-viva-render-seleccion-filtros
source: [36-VERIFICATION.md]
started: 2026-05-28
updated: 2026-05-28
approved_by: human
approved_at: 2026-05-28
fixture: scripts/dev-dashboard-fixture.mjs
hot_patches_validated: [116cb1e (alt-screen), ca61733 (bold+gutter)]
---

## Current Test

[all passed — UAT closed]

## Tests

### 1. Layout visual de la tabla
expected: En `kodo dashboard` con el server vivo y ≥3 sesiones, la tabla muestra ...
result: passed
verified_via: fixture server (`scripts/dev-dashboard-fixture.mjs`) — 6 filas alineadas en TTY real ...

### 2. Color semántico visible
expected: ...
result: passed
verified_via: ...

### 3. UX del filtro modal
expected: ...
result: passed
verified_via: ...

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

(none)
```

**Adaptations a aplicar (CONTEXT.md D-08):**

1. **Frontmatter inicial** (status pending, sin fecha approved):
   ```yaml
   ---
   status: pending
   phase: 37-attach-handoff-cmux
   source: [37-VERIFICATION.md, 37-CONTEXT.md D-08]
   started: 2026-05-28
   updated: 2026-05-28
   approved_by: pending
   approved_at: pending
   fixture: scripts/dev-dashboard-fixture.mjs
   blocking_for_phase_close: true
   ---
   ```

2. **Current Test:** literal `[escenario 1: Focus exitoso visible]` (inicial, updates a `[all passed — UAT closed]` al cerrar).

3. **2 escenarios obligatorios** (D-08 §1-2):
   ```markdown
   ### 1. Focus exitoso visible
   expected: Tras `kodo dashboard` con ≥1 sesión alive y cmux visible, navegar (↑/↓) hasta una fila alive, pulsar Enter. La app cmux cambia el foco al workspace `workspace:N` (visible en la GUI macOS). El dashboard kodo sigue corriendo en su pane: cursor preservado sobre la fila, `● live` sigue parpadeando, polling activo. Tiempo del Enter al focus visible: ≤200ms.
   result: pending
   verified_via: (pendiente — requiere TTY real + cmux.app visible)

   ### 2. Zombie reject
   expected: Forzar workspace zombie (matar manualmente el workspace cmux subyacente con `cmux close-workspace --workspace workspace:N`; siguiente poll lo marca `alive:false` en el dashboard, marca textual `(zombie)` en la celda status). Navegar a esa fila. Pulsar Enter. Footer normal `↑↓ move · / filter · q quit` se reemplaza por `[!] workspace gone (alive=false) — press any key` en rojo. Dashboard intacto. `ps aux | grep cmux` NO muestra invocación de `cmux select-workspace` (el guard cortocircuitó). Pulsar cualquier tecla restaura el footer normal.
   result: pending
   verified_via: (pendiente — requiere TTY real + cross-process verification)
   ```

4. **2 escenarios bonus opcionales** (D-08 §3-4, `result: pending` o `result: skipped`):
   ```markdown
   ### 3. ENOENT (bonus, opcional)
   expected: Renombrar temporalmente el binario: `mv /Applications/cmux.app/Contents/Resources/bin/cmux{,.bak}`. Lanzar dashboard; navegar a fila alive; Enter. Footer rojo `[!] cmux not found in PATH — press any key`. Restaurar: `mv .../cmux{.bak,}`.
   result: pending (optional, no bloqueante)

   ### 4. Exit code ≠ 0 (bonus, opcional)
   expected: Forzar ref inválido (modificar manualmente `state.json` con `workspace_ref:'workspace:99999'`). Enter → footer rojo `[!] cmux focus failed (code N) — press any key`. Dashboard intacto.
   result: pending (optional, no bloqueante)
   ```

5. **Summary inicial:**
   ```markdown
   ## Summary

   total: 2 (obligatorios) + 2 (bonus opcionales)
   passed: 0
   issues: 0
   pending: 2 (obligatorios bloqueantes)
   skipped: 0
   blocked: 0
   ```

6. **Gaps:** `(pending — UAT por ejecutar)`.

**Blocking gate:** Sin `status: passed` + `approved_by: human` + ambos obligatorios `result: passed`, `gsd-verify-work` debe bloquear el cierre (D-08 lo dice literal). Los bonus pueden quedar como `pending`/`skipped`.

---

## Shared Patterns

### Color-isolation (Phase 34 D-12)
**Source:** `test/format-isolation.test.js:199-220` (walker activo).
**Apply to:** `focus.js` y CUALQUIER nuevo archivo bajo `src/cli/dashboard/**`.
**Mecanismo:** El walker escanea `src/cli/dashboard/**/*.js`, extrae imports, asserta que NINGUNO importa `picocolors`. `focus.js` queda cubierto automáticamente — no requiere extensión del test.

Excerpt (líneas 208-219):
```js
it('ningún archivo de src/cli/dashboard/ importa picocolors', () => {
  const dashFiles = listJsFiles(SRC).filter((f) => f.includes('/cli/dashboard/'));
  const leakers = dashFiles
    .filter((f) => extractImports(readFileSync(f, 'utf-8')).includes('picocolors'))
    .map((f) => relative(REPO, f));
  assert.deepEqual(
    leakers,
    [],
    `Color del TUI debe salir de ink <Text>, no de picocolors (D-12).\n` +
      `Archivos bajo src/cli/dashboard/ que importan picocolors:\n  ${leakers.join('\n  ')}`,
  );
});
```

**Footer-error rojo:** `<Text color="red">...</Text>` (ink). Cero `picocolors`, cero `\x1b[31m`.

### Never-throws + discriminated union (Phase 35 D-07)
**Source:** `src/cli/dashboard/client.js:47-58` (`fetchStatus` shape).
**Apply to:** `focus.js#runFocus` (mismo invariante: cualquier modo de fallo colapsa al discriminante, jamás un throw que llegue a React).

Excerpt (lines 47-58 literal — ya copiado arriba):
```js
export async function fetchStatus(baseUrl, fetchFn = globalThis.fetch, signal) {
  try {
    const res = await fetchFn(`${baseUrl}/status`, { signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!Array.isArray(data.sessions)) return { ok: false, error: 'bad shape' };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

**Adapt for runFocus:** `{ok:false, code:'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail}` en vez de `{ok:false, error}`.

### DI in runDashboard (Phase 34 D-DI)
**Source:** `src/cli/dashboard/index.js:78-79` (firma `runDashboard(deps = {})`).
**Apply to:** `index.js` — extender con `exec` siguiendo el patrón.

Excerpt (líneas 78-79):
```js
export async function runDashboard(deps = {}) {
  const { stdout = process.stdout, stdin = process.stdin, url } = deps;
```

**Extension:** Añadir `exec` al destructuring. NO añadir `render` ni `loadConfig` al `deps` (no se requieren para esta fase).

### Canonical literal-stable messages (Phase 34 D-04 patrón `NON_TTY_MSG`)
**Source:** `src/cli/dashboard/index.js:40-42` (constante a nivel de módulo, literal-string usada por tests).
**Apply to:** Los 3 mensajes de error de `focusError` (D-05).

Excerpt:
```js
const NON_TTY_MSG =
  'kodo dashboard requires an interactive terminal (TTY). ' +
  'Run it directly in your terminal, not in a pipe or CI.';
```

**Adapt:** El planner decide si izar las 3 strings de D-05 a constantes de módulo (más testeable; los tests las importan y asertan equality literal) o inline-as-template-strings (menos abstracción; los tests las matchan con regex). Recomendación: **izar a constantes** en `App.js` (`FOCUS_ERR_ZOMBIE`, `FOCUS_ERR_ENOENT`, `FOCUS_ERR_FAILED_FN`) — los tests del App importan las constantes en lugar de duplicar strings, eliminando el riesgo de drift.

### React.createElement plano + ink markup (Phase 34 invariante)
**Source:** `src/cli/dashboard/App.js:238-259` (root JSX-less markup).
**Apply to:** Cualquier markup nuevo en App.js / SessionTable.js (el footer-error).

Excerpt (línea 258):
```js
createElement(Text, { dimColor: true }, '↑↓ move · / filter · q quit'),
```

**Adapt para el footer-error rojo:**
```js
h(Text, { color: 'red' }, focusError)
```
(donde `h` es el alias local de `createElement` en `SessionTable.js:24`).

---

## No Analog Found

(ninguno — todos los archivos tienen analog directo en el repo).

---

## Metadata

**Analog search scope:**
- `src/cli/dashboard/**` (todos los módulos de Phases 34-36)
- `src/cmux/client.js` (cliente RPC fire-and-forget cmux)
- `src/config.js` (`loadConfig().cmux.binary` lookup)
- `test/dashboard-*.test.js` (12 archivos, Phases 34-36)
- `test/format-isolation.test.js` (walker invariant)
- `.planning/phases/36-tabla-viva-render-seleccion-filtros/36-HUMAN-UAT.md` (formato UAT)

**Files scanned:** 14 archivos source + 12 test files + 1 UAT analog.

**Pattern extraction date:** 2026-05-28

**Cross-cutting invariantes verificadas (alineadas con `37-VALIDATION.md`):**
- NO-PICOCOLORS — cubierto por walker existente sobre `src/cli/dashboard/**`.
- NEVER-THROWS — `runFocus` espejo de `fetchStatus`.
- NO-STDIO-INHERIT — `execFile` callback-style, sin `stdio:'inherit'`.
- NO-ALT-SCREEN-MUTATION — `index.js` líneas 107/127 intactas.
- NO-SIGNAL-HANDLER-MUTATION — `index.js` líneas 115-128 intactas.
- LITERAL-STABLE MESSAGES — 3 strings canónicas de D-05 aseradas literal en tests (recomendado: izar a constantes).
