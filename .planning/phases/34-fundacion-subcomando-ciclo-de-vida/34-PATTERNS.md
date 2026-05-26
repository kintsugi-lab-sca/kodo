# Phase 34: Fundación — subcomando + ciclo de vida - Pattern Map

**Mapped:** 2026-05-26
**Files analyzed:** 6 (2 nuevos prod, 2 tests nuevos, 1 test extendido, 1 manifiesto)
**Analogs found:** 5 / 6 (el componente ink `App.js` no tiene análogo en el codebase — es greenfield)

> Idioma: prosa en español. Identificadores de código, paths y términos técnicos (`render`, `useApp`,
> `isRawModeSupported`, `picocolors`, `spawnSync`, etc.) se mantienen en su forma original.

## File Classification

| Nuevo/Modificado | Role | Data Flow | Análogo más cercano | Calidad del match |
|------------------|------|-----------|---------------------|-------------------|
| `src/cli.js` (MOD: +1 bloque `command`) | route / cli-entry | request-response | bloques `status` (L249-270) / `logs` (L273-298) del mismo archivo | exact |
| `src/cli/dashboard/index.js` (NEW) | controller / process-owner | event-driven (lifecycle) | bloque `orchestrate` `src/cli.js:124-200` (SIGTERM/cleanup) + `src/cli/polling.js` (handler exportado DI-zable) | role-match |
| `src/cli/dashboard/App.js` (NEW) | component (ink) | render / event-driven (input) | **ninguno** — primer componente React/ink del repo | no-analog |
| `test/dashboard-non-tty.test.js` (NEW) | test (integration) | request-response (spawnSync) | `test/version-smoke.test.js` (spawnSync `--version`) + `test/session-of-resolver.test.js` | exact |
| `test/dashboard-render.test.js` (NEW) | test (render unit) | render (ink-testing-library) | `test/version-smoke.test.js` (estructura `describe`/`it`) | partial-match |
| `test/format-isolation.test.js` (MOD: +1 `describe`) | test (static walker) | transform (AST/regex scan) | el propio `describe` "Single source of color" L98-129 (extender, NO modificar) | exact |
| `package.json` (MOD: +2 deps, +2 devDeps) | config | — | manifiesto existente (deps `commander`/`picocolors`) | exact |

## Pattern Assignments

### `src/cli.js` — registro del subcomando `dashboard` (route, request-response)

**Análogo:** bloques `status` (`src/cli.js:249-270`) y `logs` (`src/cli.js:273-298`) — mismo archivo.

**Patrón de registro + lazy import** (extraído de `src/cli.js:248-298`):
```js
// --- kodo status ---  (L249-270)  ← lazy import en .action, sin flags
program
  .command('status')
  .description('Show active sessions')
  .action(async () => {
    await ensureConfig();
    const { listSessions } = await import('./session/state.js');
    // ...
  });

// --- kodo logs ---  (L273-298)  ← lazy import + opciones + try/catch → exit 1
program
  .command('logs [session-id]')
  .description('Inspect a session log (dump, tail, filter)')
  .option('-f, --follow', 'Tail live output (like tail -f)')
  .action(async (sessionId, opts) => {
    try {
      const { runLogs } = await import('./logs/reader.js');
      await runLogs({ sessionId, follow: opts.follow || false, /* ... */ });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```

**Qué copiar para `dashboard`:**
- `.command('dashboard')` + `.description('Live TUI dashboard of active kodo sessions')` (D-06).
- `.option('--url <baseUrl>', ...)` (D-05, un único flag de escape).
- `.action(async (opts) => { const { runDashboard } = await import('./cli/dashboard/index.js'); await runDashboard({ url: opts.url }); })` (D-07, lazy import idéntico).
- **NO** copiar `await ensureConfig()` de `status` — el TUI no requiere provider configurado en Phase 34 (mirror del comentario de `skill sync` en `src/cli.js:345-346`: "NO `ensureConfig()`"). El dashboard resuelve baseUrl en memoria; no toca config sensible.

**Divergencia consciente respecto al try/catch de `logs`:** el `try/catch → exit 1` de `logs`/`launch` envuelve el handler clásico. Para `dashboard`, el ciclo de vida y el exit code los gobierna `runDashboard` (el guard non-TTY hace su propio `process.exit(1)`, y la salida limpia es `process.exitCode = 0`). El `.action` puede quedar tan delgado como el de `status` (sin try/catch) o envolver para loggear errores de bootstrap — criterio del planner, pero NO duplicar el manejo de exit que ya vive en `index.js`.

---

### `src/cli/dashboard/index.js` — `runDashboard` (controller / process-owner, event-driven lifecycle)

**Análogo:** bloque `orchestrate` (`src/cli.js:124-200`) para el patrón SIGTERM + cleanup idempotente; helpers exportados DI-zables de `src/cli/polling.js` para la firma `runX({...})`.

**Patrón SIGTERM + cleanup idempotente** (extraído de `src/cli.js:142-200`, el más maduro del repo):
```js
// src/cli.js:142-200 — orchestrate: handler ANTES del setup async, cleanup idempotente
const cleanup = () => {
  try { if (pollingHandle) pollingHandle.stop(); } catch { /* idempotent */ }
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
// ... setup async ...
```

**Qué copiar / adaptar para `runDashboard`:**
- **Guard non-TTY ANTES de `render()`** (D-03/D-04). NO hay análogo de TTY-check en el repo — es nuevo, pero el patrón "chequeo barato → stderr + `process.exit(1)`" se mimetiza del gate de `config --set` en `src/cli.js:37-40`:
  ```js
  // src/cli.js:37-40 (análogo de gate temprano → exit 1)
  if (!key || value === undefined) {
    console.error('Usage: --set key=value (...)');
    process.exit(1);
  }
  ```
  Para `dashboard` el guard es:
  ```js
  const NON_TTY_MSG =
    'kodo dashboard requires an interactive terminal (TTY). ' +
    'Run it directly in your terminal, not in a pipe or CI.'; // D-04 — string EXACTO, asertado por test
  export async function runDashboard(deps = {}) {
    const { stdout = process.stdout, stdin = process.stdin } = deps;  // DI para testabilidad (constraint PROJECT.md)
    if (!stdout.isTTY || !stdin.isTTY) {
      process.stderr.write(NON_TTY_MSG + '\n');   // a stderr (D-03), no stdout
      process.exit(1);                            // ANTES de render()
    }
    // ...
  }
  ```
- **Resolución de baseUrl** (D-05) usando `loadConfig().server.port` (default 9090, `src/config.js:62-66`) con lazy import como el resto del archivo:
  ```js
  const { loadConfig } = await import('../../config.js');
  const baseUrl = deps.url ?? `http://localhost:${loadConfig().server.port}`;
  ```
- **SIGTERM handler explícito** (D-10) — diverge de `orchestrate` en dos puntos: (1) el cleanup es `app.unmount()` de ink, NO `process.exit(0)` directo (ink restaura la terminal en unmount); (2) usar `process.once('SIGTERM', ...)` y removerlo tras `waitUntilExit()` para no fugar el listener:
  ```js
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const App = (await import('./App.js')).default;
  const app = render(createElement(App, { baseUrl }));
  const onSigterm = () => { app.unmount(); };   // mismo camino que q/Ctrl-C, restaura terminal
  process.once('SIGTERM', onSigterm);
  await app.waitUntilExit();
  process.removeListener('SIGTERM', onSigterm);
  process.exitCode = 0;  // salida limpia (NO process.exit — deja drenar stdio)
  ```
- **Ctrl-C** (D-09): NO se cablea aquí — lo cubre el `exitOnCtrlC: true` default de ink. NO replicar el `process.on('SIGINT', ...)` de `orchestrate` (eso saltaría el teardown de ink → terminal sucia, Pitfall 9).

**Constraint DI (de `.planning/PROJECT.md`):** `runDashboard(deps = {})` debe aceptar `stdout`/`stdin` inyectables (default a `process.*`) — igual que los helpers de `src/cli/polling.js` reciben sus deps por parámetro para ser testeables sin tocar globals.

---

### `src/cli/dashboard/App.js` — componente root ink (component, render + event-driven input)

**Análogo:** NINGUNO. Es el primer componente React/ink del codebase. El planner debe usar los
patrones del RESEARCH.md (Patterns 1-4, líneas 200-275) y el mockup aprobado de CONTEXT.md (líneas
127-136) como fuente, NO un archivo existente.

**Disciplinas a heredar del codebase (aunque el archivo sea greenfield):**
- **Color SOLO vía ink** (D-12, Pitfall 10): cero `import ... 'picocolors'`. El walker de
  `test/format-isolation.test.js` (extendido) lo verifica. Banner via `createElement(Text, { bold: true }, 'kodo dashboard')`, NUNCA `pc.bold(...)`.
- **No build step** (constraint PROJECT.md / RESEARCH L112): `React.createElement` plano, NO JSX.
  El `bin/kodo` (`import('../src/cli.js')`) corre directo bajo `node` sin transpile.
- **`// @ts-check`** en la cabecera (convención verificada en `src/cli.js:1`, `src/config.js:1`).
- **`q` → `useApp().exit()`** (D-08, NO `process.exit`), **`Esc` NO sale** (D-11). Ver RESEARCH Pattern 3 (L239-264).
- Belt-and-suspenders: gatear `useInput` con `useStdin().isRawModeSupported` (Pitfall 1).

**Chrome mínimo (mockup CONTEXT L127-136):** banner `kodo dashboard` arriba, placeholder central
`starting…` estático (D-02, sin polling), footer `q quit`. Markup `<Box>`/borde/padding es discreción
del planner (D-01 fija el contenido, no el styling exacto).

---

### `test/dashboard-non-tty.test.js` — guard non-TTY E2E (test integration, request-response)

**Análogo:** `test/version-smoke.test.js` (estructura `spawnSync` + `KODO_BIN`) y
`test/session-of-resolver.test.js` (helper `runX()` + asserts de exit code + match de stderr).

**Boilerplate de paths + spawnSync** (extraído de `test/version-smoke.test.js:1-19`):
```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

const result = spawnSync(process.execPath, [KODO_BIN, '--version'], {
  cwd: REPO,
  encoding: 'utf-8',
  timeout: 10_000,   // fail-fast si el bin cuelga (CI hygiene)
});
```

**Patrón de asserts** (extraído de `test/session-of-resolver.test.js:169-180` y `test/version-smoke.test.js:24-38`):
```js
assert.equal(result.status, 1, `expected exit 1, got ${result.status}\nstderr: ${result.stderr}`);
assert.match(result.stderr, /requires an interactive terminal \(TTY\)/);
```

**Qué copiar / adaptar para el test non-TTY:**
- Mismo boilerplate `__dirname`/`REPO`/`KODO_BIN`.
- `spawnSync(process.execPath, [KODO_BIN, 'dashboard'], { stdio: ['pipe','pipe','pipe'], encoding:'utf-8', timeout: 10_000 })` — los tres pipes garantizan non-TTY (reproduce `kodo dashboard | cat` / CI).
- `assert.equal(r.status, 1, ...)` + `assert.match(r.stderr, /requires an interactive terminal \(TTY\)/)` + `assert.equal(r.stderr.trim(), CANONICAL)` donde `CANONICAL` es el string EXACTO de D-04.
- **Divergencia clave respecto a `version-smoke`:** ese test afirma `stderr === ''`; aquí es lo opuesto — el mensaje canónico DEBE estar en stderr (no stdout).

---

### `test/dashboard-render.test.js` — render del chrome (test render unit, ink-testing-library)

**Análogo:** `test/version-smoke.test.js` solo para la estructura `describe`/`it` + asserts. El
mecanismo de render (`ink-testing-library`) es nuevo en el repo — usar el patrón del RESEARCH L372-398.

**Estructura `describe`/`it`** (convención verificada en todos los tests del repo):
```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
describe('TUI-01: dashboard chrome (D-01)', () => {
  it('renders banner + starting placeholder + q quit footer', () => { /* ... */ });
});
```

**Qué copiar / adaptar:**
- Render via `ink-testing-library`: `const { lastFrame, stdin } = render(createElement(App, { baseUrl: 'http://localhost:9090' }))`.
- `assert.match(lastFrame(), /kodo dashboard/)`, `/starting…/`, `/q quit/` (chrome D-01).
- `q → exit`: `stdin.write('q')`; la aserción exacta depende de la firma de exit que elija el planner (mock de `useApp` vs flag) — RESEARCH Assumption A3 (L418) lo deja como criterio de implementación.
- Requiere `ink-testing-library@^4.0.0` instalado como devDep (gap Wave 0).

---

### `test/format-isolation.test.js` — extensión del walker (test static walker, transform)

**Análogo:** el propio `describe` "Single source of color (D-07, D-08)" (`test/format-isolation.test.js:98-129`).

**Patrón a copiar — el bloque existente que escanea importers de `picocolors`** (L98-115):
```js
describe('Single source of color (D-07, D-08): picocolors imports', () => {
  it('only src/cli/format.js imports picocolors (single source of color)', () => {
    const allFiles = listJsFiles(SRC);   // listJsFiles ya recorre TODO src/ recursivamente (L59-71)
    const importers = [];
    for (const file of allFiles) {
      const specs = extractImports(readFileSync(file, 'utf-8'));  // helper existente L23-28
      if (specs.includes('picocolors')) importers.push(relative(REPO, file));
    }
    assert.deepEqual(importers, ['src/cli/format.js'], `...`);
  });
});
```

**Qué añadir (D-13) — NUEVO `describe`, sin tocar las aserciones existentes:**
- Reusar los helpers ya presentes: `listJsFiles(SRC)` (L59-71), `extractImports()` (L23-28), `IMPORT_FROM_RE`/`IMPORT_BARE_RE` (L15-16).
- Filtrar la lista por path bajo `src/cli/dashboard/` y afirmar cero importadores de `picocolors`:
  ```js
  describe('TUI-04 (D-13): cero picocolors bajo src/cli/dashboard/', () => {
    it('ningún archivo de src/cli/dashboard/ importa picocolors', () => {
      const dashFiles = listJsFiles(SRC).filter((f) => f.includes('/cli/dashboard/'));
      const leakers = dashFiles
        .filter((f) => extractImports(readFileSync(f, 'utf-8')).includes('picocolors'))
        .map((f) => relative(REPO, f));
      assert.deepEqual(leakers, [], `...`);
    });
  });
  ```
- **NO modificar** el `assert.deepEqual(importers, ['src/cli/format.js'])` existente (L109-114): ink no es `picocolors`, así que esa aserción sigue verde sin tocarla.

---

### `package.json` — deps (config)

**Análogo:** el propio manifiesto (`package.json:12-19`).

**Estado actual:**
```json
"dependencies": { "commander": "^13.0.0", "picocolors": "^1.1.1" },
"engines": { "node": ">=20.0.0" }
```

**Qué añadir:**
- `dependencies`: `"ink": "^6.8.0"`, `"react": "^19.2.0"` (NO `ink@7` — exige Node >=22 y rompería `engines.node >=20`, Pitfall 4).
- `devDependencies` (sección nueva): `"ink-testing-library": "^4.0.0"`, `"@types/react": "^19"` (este último opcional — Open Question 1 del RESEARCH).
- **NO tocar** `engines.node` (debe seguir `>=20.0.0`). **NO** añadir `scripts.build` (constraint "no build step").

---

## Shared Patterns

### Lazy import en `.action` (todos los subcomandos)
**Source:** `src/cli.js` — `config` (L25), `start` (L73), `status` (L254), `logs` (L284), `polling` (L373).
**Apply to:** el bloque `dashboard` en `src/cli.js` y los imports de ink/react DENTRO de `runDashboard`.
```js
.action(async (opts) => {
  const { runDashboard } = await import('./cli/dashboard/index.js'); // aísla ink (pesado) al path del subcomando
  await runDashboard({ url: opts.url });
});
```
Mantiene `kodo --version`/`kodo check` ligeros: ink/react NO se cargan salvo que se invoque `dashboard`.

### Gate temprano → stderr + `process.exit(1)`
**Source:** `src/cli.js:37-40` (`config --set`), `src/cli.js:50-53` (`config --map-project`).
**Apply to:** el guard non-TTY de `runDashboard` (escribir a stderr, exit 1 ANTES de cualquier render).

### Cleanup idempotente de señales
**Source:** `src/cli.js:142-200` (`orchestrate` — el handler más maduro del repo).
**Apply to:** el SIGTERM handler de `runDashboard`, CON la divergencia: `app.unmount()` (ink restaura
terminal) en lugar de `process.exit(0)` directo, y NO cablear SIGINT (lo cubre `exitOnCtrlC` de ink).

### Color single-source (invariante del proyecto)
**Source:** `src/cli/format.js` (único importador legítimo de `picocolors`); verificado por `test/format-isolation.test.js`.
**Apply to:** todo `src/cli/dashboard/**` — cero `picocolors`; color exclusivamente vía `<Text color>` de ink (D-12).

### Spawn E2E de subcomando con timeout
**Source:** `test/version-smoke.test.js:18-23` + `test/session-of-resolver.test.js:61-72`.
**Apply to:** `test/dashboard-non-tty.test.js` — `spawnSync(process.execPath, [KODO_BIN, 'dashboard'], { timeout, encoding:'utf-8' })`.

### `// @ts-check` + JSDoc + ESM
**Source:** `src/cli.js:1`, `src/config.js:1`, `test/session-of-resolver.test.js:1`.
**Apply to:** todos los archivos nuevos (`index.js`, `App.js`, ambos tests). `import`/`export` ESM (`"type":"module"`), specifiers con `.js` explícito.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/cli/dashboard/App.js` | component (ink) | render / input | Primer componente React/ink del repo — no existe precedente de `useApp`/`useInput`/`<Box>`. El planner usa RESEARCH.md Patterns 1-4 (L200-275) + mockup CONTEXT (L127-136). El mecanismo `ink-testing-library` (en `test/dashboard-render.test.js`) tampoco tiene precedente. |

> Nota: `src/cli/dashboard/index.js` SÍ tiene análogo parcial (lifecycle/SIGTERM de `orchestrate`,
> firma DI de `polling.js`), pero el **guard non-TTY** y la integración con `render()`/`waitUntilExit()`
> de ink son nuevos — el planner combina el patrón de gate temprano (`config --set`) con los Patterns
> 2-3 del RESEARCH.

## Metadata

**Analog search scope:** `src/cli.js`, `src/cli/` (ls), `src/config.js`, `test/format-isolation.test.js`, `test/version-smoke.test.js`, `test/session-of-resolver.test.js`, `package.json`, `bin/kodo`.
**Files scanned:** 8 leídos en detalle; `src/cli/dashboard/` confirmado inexistente (greenfield).
**Pattern extraction date:** 2026-05-26
