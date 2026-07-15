# Phase 68: Dashboard Setup Mode + CFGF-03 + First-Run — Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 9 (6 src + 3 test)
**Analogs found:** 9 / 9 (todos con análogo interno en el repo — fase de composición ~90%)

> Fase brownfield de state-machine TUI. Casi todo es reuso de piezas ya enviadas en Phases 63/65/66/67. Los excerpts de este mapa son **el molde exacto a copiar**, no orientación abstracta. Los excerpts de código van en su forma original.

## File Classification

| Archivo (nuevo/modificado) | Rol | Data Flow | Análogo más cercano | Calidad match |
|----------------------------|-----|-----------|---------------------|---------------|
| `src/config.js` — `needsSetup()` NUEVO | utility (helper puro) | transform / file-I/O (`existsSync` + presence) | `isReportToProviderEnabled(_loadConfig=loadConfig)` + `isApiKeyConfigured` (mismo archivo) | exact |
| `src/cli/up.js` — rama pre-spawn `runUp` | controller (orquestador CLI) | request-response (branch pre-spawn) | `runUp` mismo (seams DI ya presentes) | exact (self) |
| `src/cli/dashboard/App.js` — `mode:'setup'` | store / state-machine (React) | event-driven (useInput mode-gated) | `mode:'config'/'config-edit'` (App.js:1024-1104) + masked field (App.js:1029-1057) | exact |
| `src/cli/dashboard/SessionTable.js` — `renderSetupOverlay` | component (render) | transform (props→ink tree) | `renderConfigOverlay` (SessionTable.js:296-359) | exact |
| `src/cli/dashboard/index.js` — wiring | provider (DI wiring) | request-response | `onSaveConfig`/`onSaveApiKey` ya cableados (index.js:279-302) | exact (self) |
| `src/cli.js` — `interactiveConfig` rewire | controller (wizard readline) | request-response (readline) | `interactiveConfig` mismo (cli.js:576-680) | exact (self, casi no-op) |
| `test/config.test.js` — casos `needsSetup` | test | unit puro (DI) | tests existentes de config (mismo archivo) | role-match |
| `test/cli/up.test.js` — rama pre-spawn | test | unit (DI `makeDeps`) | `makeDeps` seams de up.test.js | role-match |
| `test/dashboard/app-setup.test.js` NUEVO | test | integration (ink-testing-library) | `test/dashboard/app-dismiss.test.js` (render + stdin.write + lastFrame) | exact |

---

## Pattern Assignments

### `src/config.js` — `needsSetup()` NUEVO (utility, transform + file-I/O)

**Análogo:** `isReportToProviderEnabled` (molde DI) + `isApiKeyConfigured` (presence-check) — **mismo archivo**.

**Molde DI a copiar** (config.js:254-256) — la firma con loader inyectable por defecto:
```javascript
export function isReportToProviderEnabled(_loadConfig = loadConfig) {
  return _loadConfig().workflow?.report_to_provider === true;
}
```

**Presence-check de la key a reutilizar tal cual** (config.js:227-230) — NUNCA expone el valor (PERSIST-04):
```javascript
export function isApiKeyConfigured(providerName) {
  const key = getProviderApiKey(providerName);
  return typeof key === 'string' && key.length > 0;
}
```

**LOAD-BEARING (Pitfall 2/12) — `loadConfig` NO sirve para first-run.** Devuelve `DEFAULT_CONFIG` (plane válido) cuando falta el archivo, indistinguible de config real (config.js:157):
```javascript
export function loadConfig() {
  ensureDir();
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  ...
}
```
→ `needsSetup()` DEBE apoyarse en `existsSync(CONFIG_PATH)` directo como primera señal. Los campos estructurales solo se evalúan **si `config.json` existe**.

**Símbolos ya disponibles (sin nuevos imports):** `CONFIG_PATH`, `existsSync` (importado config.js:2), `loadConfig`, `isApiKeyConfigured`, `getProviderApiKey`. Ya exportados en el barrel (config.js:407). El helper nuevo sigue el mismo `export function`.

**Firma sugerida (naming es discreción del planner — Assumption A2):**
```javascript
export function needsSetup(providerName, _loadConfig = loadConfig) {
  if (!existsSync(CONFIG_PATH)) return true;           // Pitfall 12: no config.json → first-run
  const config = _loadConfig();
  const name = providerName || config.provider;
  if (!isApiKeyConfigured(name)) return true;          // falta API key → setup
  const p = config.providers?.[name];                  // estructurales SOLO si config existe (D-03)
  if (name === 'plane' && (!p?.base_url || !p?.workspace_slug)) return true;
  return false;
}
```
**Nota D-09:** `isApiKeyConfigured` lee `process.env` cacheado (que `loadEnvFile` pobló al import, no-override). En first-run limpio la var está ausente → correcto. El riesgo del no-override solo muerde al re-configurar sobre una key vieja (Pitfall 3), no en first-run.

---

### `src/cli/up.js` — rama pre-spawn en `runUp` (controller, request-response)

**Análogo:** el propio `runUp` (up.js:151-220) — ya tiene el patrón de seams DI con lazy-import.

**Patrón de seam DI a extender** (up.js:169-182) — cada dependencia es `deps._x || lazyImport`:
```javascript
let loadConfigFn = deps._loadConfig;
if (!loadConfigFn) loadConfigFn = (await import('../config.js')).loadConfig;
...
const runDashboardFn = deps._runDashboard
  || (await import('./dashboard/index.js')).runDashboard;
```
→ Añadir `_needsSetup` al mismo patrón: `const needsSetupFn = deps._needsSetup || (await import('../config.js')).needsSetup;`

**Punto de inserción exacto (D-02):** entre `const cfg = loadConfigFn()` (up.js:187) y el bloque `(2) ensure-daemon` (up.js:191). El código actual:
```javascript
const cfg = loadConfigFn();
const port = cfg?.server?.port ?? 9090;
const baseUrl = resolveBaseUrlFn({ loadConfig: loadConfigFn });

// (2) ensure-daemon (idempotencia D-02): PID-alive PRIMARIO + probePort SECUNDARIO.
const status = statusDaemonFn('kodo');
```
→ Insertar ANTES de `(2)`: si `needsSetupFn()` → `await runDashboardFn({ url: baseUrl, setup: true }); return;` (NO spawn — el daemon moriría con `teardown(1)`). El `runDashboardFn({ url: baseUrl })` de éxito ya existe en up.js:215; la rama setup lo llama con el flag extra.

**Never-throws / fail-open:** todo el orquestador ya evita `process.exit` (up.js:197-201, 208-212). La rama setup mantiene el mismo contrato.

---

### `src/cli/dashboard/App.js` — `mode:'setup'` (state-machine, event-driven)

**Análogo:** modos `config`/`config-edit` (App.js:1024-1104) + masked field Phase 67 (App.js:1029-1057).

**Copy literal-estable EXPORTADA — patrón a extender** (App.js:239-260). Añadir constantes `SETUP_*` junto a estas (los tests las importan y asseran equality sin duplicar strings):
```javascript
export const CONFIG_SAVED_RESTART = 'guardado — reinicia el server/daemon para aplicar los cambios';
...
export const API_KEY_SAVED_RESTART = 'API key guardada — reinicia el server/daemon para aplicar';
export const API_KEY_NO_RAWMODE = 'Usa `kodo config` para editar la API key';  // degradación non-TTY (D-13)
```
→ El aviso de reinicio honesto (D-08) reusa `CONFIG_SAVED_RESTART`/`API_KEY_SAVED_RESTART` tal cual, o añade `SETUP_SAVED_RESTART` con el mismo molde.

**Guardado del campo enmascarado — REUSO LITERAL Phase 67** (App.js:1029-1057). El modo setup lo copia sin cambios para el paso `apikey`:
```javascript
const provider = configSnapshot?.provider;
const apiKeyEnv = configSnapshot?.providers?.[provider]?.api_key_env;
const result = await onSaveApiKey(apiKeyEnv, buffer);
if (!result || result.ok !== false) {
  setBuffer('');            // limpia el secreto de memoria (Pitfall 5/11)
  setMaskValue(false);
  setConfigEditError(null);
  setFocusError(API_KEY_SAVED_RESTART);
  setFooterColor('yellow');
  ...
}
```

**Guardado de provider/base_url/workspace_slug — molde config-edit Enter** (App.js:1071-1094) — deep-clone ANTES de mutar (Pitfall 1 de Phase 63):
```javascript
const next = structuredClone(configSnapshot);
setByPath(next, field.path, res.value);   // o 'provider' para el selector (D-05)
const result = await onSaveConfig(next);
if (!result || result.ok !== false) {
  setConfigSnapshot(next);
  setConfigEditError(null);
  setFocusError(CONFIG_SAVED_RESTART);
  setFooterColor('yellow');
  ...
}
```

**Text-input controlado (inserción en cursor, NO append)** — molde App.js:1097-1102:
```javascript
if (input && !key.ctrl && !key.meta) {
  setBuffer((b) => b.slice(0, cursor) + input + b.slice(cursor));
  setCursor((c) => c + input.length);
  return;
}
```

**Selector de provider (D-05)** — lista canónica `['plane', 'github']` (molde cli.js:588, adaptado a `useInput` ↑/↓ + Enter). Enter en `'github'` → mensaje que remite a `kodo config` (D-06), NO continúa el guiado. Enter en `'plane'` → `setByPath(next,'provider','plane')` + `saveConfig`, avanza a `base_url`.

**Estructura de la state-machine:** cada modo es una rama `if (mode === 'X')` en el `useInput` mode-gated (ya hay 14 modos; `setup` es el 15º). El sub-flujo lineal: `provider` → `base_url` → `workspace_slug` → `apikey` (masked). El molde de sub-máquina lineal más cercano es `projects-*` (App.js:1105+).

---

### `src/cli/dashboard/SessionTable.js` — `renderSetupOverlay` (component, transform)

**Análogo:** `renderConfigOverlay` (SessionTable.js:296-359).

**Dispatch por modo a extender** (SessionTable.js:682-714) — el `SessionTable` enruta por `if (mode === 'X')`:
```javascript
if ((mode === 'config' || mode === 'config-edit') && configSnapshot) {
  return renderConfigOverlay(configSnapshot, fieldCursor, mode, buffer, cursor, configEditError, focusError, footerColor, mask, apiKeyConfigured, rawModeSupported);
}
```
→ Añadir: `if (mode === 'setup' && ...) return renderSetupOverlay(...)`. Insertar en el mismo bloque de dispatch (SessionTable.js:682-714), coherente con el orden config → projects.

**Render enmascarado — REUSO LITERAL** (SessionTable.js:342-346). El valor del secreto se deriva a `•` por char; el cursor `inverse` opera sobre la máscara:
```javascript
const display = mask ? '•'.repeat(buffer.length) : buffer;
const left = display.slice(0, cursor);
const under = display[cursor] ?? ' ';
const right = display.slice(cursor + 1);
apiValueEl = h(Text, null, left, h(Text, { inverse: true }, under), right);
```

**Degradación non-TTY (D-13/Pitfall 4)** — precedencia ya establecida (SessionTable.js:339-340):
```javascript
if (!rawModeSupported) {
  apiValueEl = h(Text, { dimColor: true }, API_KEY_NO_RAWMODE);
}
```
→ `renderSetupOverlay` reusa esta rama: en non-TTY pinta el mensaje de remisión a `kodo config`, never-throws.

**Estructura de fila (gutter `› ` + label 24-wide + valor)** — molde SessionTable.js:318-324 / 352-358.

---

### `src/cli/dashboard/index.js` — wiring (provider, request-response)

**Análogo:** el propio `runDashboard` (index.js:85-333) — los wrappers ya están cableados.

**Wrappers never-throws ya presentes a REUSAR** (index.js:279-302):
```javascript
onSaveConfig: async (cfg) => { ... saveConfig ... },
onSaveApiKey: async (key, value) => { ... writeEnvVar + process.env[key]=value ... },
isApiKeyConfiguredFn: (providerName) => isApiKeyConfigured(providerName),
```
Lazy import compartido (index.js:110): `const { loadConfig, saveConfig, writeEnvVar, isApiKeyConfigured } = await import('../../config.js');` → añadir `needsSetup` al mismo destructuring si App lo consume vía prop.

**Wiring a añadir:** pasar `setup`/`needsSetupFn` como prop a `render(createElement(App, {...}))` (index.js:240). Assumption A3: la ruta más coherente con D-01 es `needsSetupFn` como prop (App decide render local); alternativa es el flag `setup:true` ya propagado desde `runUp`.

**Guard non-TTY (D-13/Pitfall 4 / Open Q2)** — el `process.exit(1)` actual (index.js:90-93):
```javascript
if (!stdout.isTTY || !stdin.isTTY) {
  ...
  process.exit(1);
}
```
**Decisión D-13:** NO se convierte este guard (se mantiene tal cual — menos superficie/riesgo). El literal "sin ningún exit(1)" del SC#1 aplica al first-run en terminal real; el degradado non-TTY dentro del render reusa `isRawModeSupported` + `API_KEY_NO_RAWMODE`.

---

### `src/cli.js` — `interactiveConfig` rewire (controller, readline)

**Análogo:** el propio `interactiveConfig` (cli.js:576-680) — **casi no-op de verificación** (Assumption A4).

**Estado actual verificado (cli.js:579):** ya usa los escritores compartidos:
```javascript
const { loadConfig, saveConfig, loadProjects, saveProjects, getProviderApiKey } = await import('./config.js');
```

**Presence-check de la key SIN capturar el valor (D-10/D-11) — ya cumple** (cli.js:613-620):
```javascript
const apiKey = getProviderApiKey(selectedProvider);
if (!apiKey) {
  console.log(`\n  ✗ ${providerConfig.api_key_env} no esta configurada.`);
  console.log(`  Configura la variable y vuelve a ejecutar kodo config.\n`);
  rl.close();
  return;
}
```
→ El wizard NO hace `rl.question` sobre el valor de la key (evita eco del secreto — Pitfall 11). El rewire SETUP-05 es: verificar que ningún camino escribe config/secretos fuera de `saveConfig`/`saveProjects`/`writeEnvVar` + añadir el test de source-hygiene/DI que blinde el invariante.

**Lista de providers canónica** (cli.js:588): `const availableProviders = ['plane', 'github'];` — misma lista que el selector del dashboard (D-05).

---

### Tests

**`test/config.test.js`** (unit puro): extender con casos de `needsSetup()` inyectando `_loadConfig` (molde `isReportToProviderEnabled`). Casos: (a) sin config.json → true, (b) config sin API key → true, (c) config completa → false, (d) **held-out Pitfall 12**: `DEFAULT_CONFIG` NO debe leerse como config real (falso negativo). Aislar `CONFIG_PATH` vía `HOME` (KODO_DIR isolation, obs 22683).

**`test/cli/up.test.js`** (unit DI): extender `makeDeps` con seam `_needsSetup` y `_runDashboard`. Asserts: (a) `needsSetup=true` → `_runDashboard` recibe `{setup:true}` y `_startDaemon` NO se llama (D-02), (b) sin `exit(1)`.

**`test/dashboard/app-setup.test.js`** NUEVO (integration): análogo directo `test/dashboard/app-dismiss.test.js`.
- Harness a copiar: `render` de `ink-testing-library` + `createElement(App, {...})` + import de constantes exportadas (app-dismiss.test.js:22-31).
- Patrón: `stdin.write(...)` para simular teclas → `lastFrame()` para assertar el render.
- **RESEARCH Pitfall 5 (app-dismiss.test.js:18):** ink NO awaitea el handler async → un save puede necesitar DOS `await drain()`.
- Cubre: selector provider → saveConfig, base_url/slug → saveConfig, API key enmascarada → onSaveApiKey (`•` en render), aviso de reinicio (D-08), non-TTY degrada (Pitfall 4).

---

## Shared Patterns

### Never-throws / fail-open (TUI + CLI)
**Fuente:** `runUp` (up.js:197-212), wrappers `onSaveConfig`/`onSaveApiKey` (index.js:279-302), handlers App.js (try/catch → `set*Error`, App.js:1054-1055/1092-1093).
**Aplica a:** todos los archivos de la fase. Ningún camino nuevo lanza ni hace `process.exit` en terminal real. El panel ink jamás se desmonta.

### Boundary del secreto PERSIST-04 / Pitfall 11
**Fuente:** `writeEnvVar` (config.js:359, único escritor 0600), `isApiKeyConfigured` (config.js:227, solo presencia), masked render (SessionTable.js:342).
**Aplica a:** App.js (paso apikey), SessionTable.js (renderSetupOverlay), index.js (onSaveApiKey).
```javascript
// El valor SOLO cruza en-proceso a writeEnvVar; jamás a config.json / logger / argv / snapshot.
// Render: '•'.repeat(buffer.length). Buffer limpiado tras save (setBuffer('')). NUNCA console.log del valor.
```
El grep de higiene held-out de Phase 67 (5 sinks) debe seguir verde tras añadir el modo setup.

### Una fontanería, varios consumidores (SETUP-05)
**Fuente:** `saveConfig` (config.js:167), `saveProjects` (config.js:184), `writeEnvVar` (config.js:359) — escritura atómica.
**Aplica a:** dashboard (App/index) y wizard headless (cli.js) convergen en los MISMOS 3 escritores. Cero escritura directa de `.env`/`config.json` fuera de ellos.

### Copy literal-estable exportada
**Fuente:** constantes `CONFIG_*`/`API_KEY_*`/`PROJECTS_*` exportadas de App.js (App.js:239-260).
**Aplica a:** App.js (añadir `SETUP_*`), SessionTable.js (importa, mata drift), tests (importan y asseran equality sin duplicar strings).

### DI puro / helper compartido (anti-duplicación)
**Fuente:** molde `isReportToProviderEnabled(_loadConfig=loadConfig)` (config.js:254); seams `deps._x || lazyImport` (up.js:169-182).
**Aplica a:** `needsSetup()` es UN helper consumido por `runUp` (pre-spawn) y por App/index (render). NO duplicar la lógica de detección (D-01/D-02).

---

## No Analog Found

*Ninguno.* Los 9 archivos tienen análogo interno directo. La fase es ~90% composición de piezas enviadas en Phases 63/65/66/67. El único código genuinamente nuevo es: (a) el helper `needsSetup()`, (b) la rama `setup` en la state-machine, (c) el selector de provider — y los tres tienen molde exacto arriba.

## Cross-cutting Warnings (para el planner)

- **Pitfall 1 (webhook secret, LOAD-BEARING, D-12):** `KODO_SETUP_REQUIRED` que mata al daemon se lanza por webhook secret ausente (`server.js:464`), NO por la API key. `needsSetup()` NO lo incluye. La UAT en máquina limpia usa `KODO_DEV=1`/`--insecure`. NO planificar la ruta feliz asumiendo que el 2º `kodo up` arranca solo sin webhook secret.
- **Pitfall 12 (falso negativo):** usar `existsSync(CONFIG_PATH)` directo en `needsSetup`, nunca los valores de `loadConfig()`.
- **Pitfall 3/15 (no-override):** en re-config sobre key vieja, `loadEnvFile` no override-a; dentro del dashboard el wrapper `onSaveApiKey` ya setea `process.env[key]=value` (index.js). No re-llamar `loadEnvFile` para confirmar.

## Metadata

**Analog search scope:** `src/config.js`, `src/cli/up.js`, `src/cli/dashboard/{App,SessionTable,index}.js`, `src/cli.js`, `test/dashboard/app-dismiss.test.js`.
**Files scanned:** 8 (leídos targeted, sin re-reads).
**Pattern extraction date:** 2026-07-02
