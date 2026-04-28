# Phase 6: Structured Logger Foundation — Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 6 nuevos (2 src + 4 tests)
**Analogs found:** 6 / 6

## File Classification

| Nuevo archivo | Rol | Data Flow | Analog más cercano | Calidad |
|---------------|-----|-----------|---------------------|---------|
| `src/logger.js` | library/factory | transform + file-I/O (append NDJSON) + stderr stream | `src/providers/plane/provider.js` (factory con closure) + `src/config.js` (fs + KODO_DIR) | role-match fuerte (composición) |
| `src/logger-noop.js` | library/stub | no-op (zero side-effects) | `src/providers/registry.js` (módulo pequeño con estado cerrado) | role-match débil (solo convenciones) |
| `test/logger.test.js` | test/unit | in-memory + tmpdir fixture | `test/check.test.js` (factory injection, sin tocar disco) + `test/state.test.js` (tmpdir fixture) | exact (compuesto) |
| `test/logger.redaction.test.js` | test/unit | tmpdir + grep del archivo persistido | `test/state.test.js` (tmpdir + rm teardown) | exact |
| `test/check-isolation.test.js` | test/static + smoke | regex source walk + `spawnSync` | `test/check.test.js` (lectura source + `readFileSync` + assert.match) | exact |
| `test/startup-budget.test.js` | test/smoke (opcional, combinable con check-isolation) | `spawnSync` + `hrtime` | `test/check.test.js` (ejecución de check) + registry/test spawn patterns | role-match |

> Nota estructural: RESEARCH.md recomienda **fusionar** `test/check-isolation.test.js` + `test/startup-budget.test.js` en un único archivo con dos bloques `it()`. El planner decide; aquí se documentan ambos patrones separados.

---

## Pattern Assignments

### `src/logger.js` (library, factory + file-I/O + stderr transform)

**Analog primario:** `src/providers/plane/provider.js` (factory pura que captura estado por closure, devuelve objeto literal con métodos — sin `this`, sin `class`).
**Analog secundario:** `src/config.js` (imports `node:fs`/`node:path`/`node:os`, constante `KODO_DIR`, `mkdirSync({ recursive: true })`, patrón `// @ts-check` + JSDoc `@param`/`@returns`).

**Header + imports pattern** (de `src/config.js` líneas 1-4 y `src/session/state.js` líneas 1-4):
```javascript
// @ts-check
import { appendFileSync, mkdirSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { KODO_DIR } from './config.js';
```
Reglas a copiar:
- `// @ts-check` obligatorio en línea 1 (presente en `config.js:1`, `check.js:1`, `state.js:1`, `registry.js:1`, `provider.js:1`).
- Imports bare con prefijo `node:` explícito (ej. `node:fs`, `node:path`, `node:os`) — estilo constante en `config.js:2-4`.
- Imports internos con extensión `.js` obligatoria (ESM puro), paths relativos (`./config.js`, no alias).
- Reutilizar `KODO_DIR` importado de `./config.js` (líneas 6 y 176 de `config.js`); **no** reinstanciar con `join(homedir(), '.kodo')`.

**Factory pattern — closure-captured state** (de `src/providers/plane/provider.js` líneas 17-50):
```javascript
/**
 * @typedef {{
 *   baseUrl: string,
 *   apiKey: string,
 *   ...
 * }} PlaneProviderConfig
 */

/**
 * Factory that creates a TaskProvider adapter for Plane.
 *
 * @param {PlaneProviderConfig} config
 * @returns {import('../../interface.js').TaskProvider}
 */
export function createPlaneProvider(config) {
  const client = new PlaneClient({ ... });
  let labelCache = [];
  const stateCache = new Map();
  let initTimestamp = 0;

  function parseRef(ref) { /* ... */ }

  return {
    init: async () => { /* ... */ },
    getTask: async (ref) => { /* ... */ },
    /* ... */
  };
}
```
Reglas a copiar:
- Export `function createLogger({ sessionId, minLevel })` (named export, no default).
- JSDoc `@typedef` al principio para la config; JSDoc `@param`/`@returns` en cada export público.
- Helpers privados como `function name(...)` dentro del factory (hoisting), no como arrow.
- Estado mutable (ej. `writeFailedWarned`, `bindings`) como `let` locales al closure — mismo estilo que `labelCache`, `initTimestamp` en `provider.js:30-38`.
- El objeto retornado es literal con métodos flecha; nada de `this`.

**mkdir + path pattern** (de `src/config.js` líneas 6-9, 69-73):
```javascript
const KODO_DIR = join(homedir(), '.kodo');
// ...
function ensureDir() {
  if (!existsSync(KODO_DIR)) {
    mkdirSync(KODO_DIR, { recursive: true });
  }
}
```
**Decisión:** RESEARCH Pattern 1 usa `mkdirSync(logDir, { recursive: true })` directo (sin `existsSync`) — es más idiomático y idempotente; se alinea con la nota "Don't Hand-Roll" del RESEARCH. Preferir esa forma en el logger.

**Re-export de constantes al final** (de `src/config.js:176` y `src/session/state.js:149`):
```javascript
export { KODO_DIR, CONFIG_PATH, PROJECTS_PATH, DEFAULT_CONFIG };
```
Aplicar: exportar `LEVELS` o `LEVEL_NAMES` al final si son útiles para tests, con el mismo estilo.

**Error handling — swallow + ANSI-prefixed stderr** (de `src/check.js` líneas 15-17 y 46-50):
```javascript
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED = '\x1b[31m';
const ANSI_RESET = '\x1b[0m';
// ...
} catch (err) {
  lines.push(
    `${ANSI_RED}[kodo:check] Error checking tasks: ${err.message}${ANSI_RESET}`,
  );
}
```
Reglas a copiar:
- Constantes ANSI en `UPPER_SNAKE_CASE` al top del módulo (formato exacto: `'\x1b[33m'`).
- Prefijo de mensaje `[kodo:<subsistema>]` en español/inglés mixto ej. `[kodo:logger]` — consistente con `[kodo] Config migrada...` (config.js:115), `[kodo:check] ...` (check.js:42). El `write failed` del logger debe seguir este formato: `[kodo:logger] write failed: ${err.message}`.
- El logger nunca `throw` para errores I/O; atrapa, emite un warning pretty-print a stderr con `fs.writeSync(2, ...)` (RESEARCH pattern 1, líneas 242-247) y continúa.

**Convenciones de estilo** (observadas en múltiples archivos):
- Strings con comillas simples (`'node:fs'`, `'\x1b[33m'`) — universal en `config.js`, `check.js`, `state.js`.
- Indentación 2 espacios.
- Comentarios de cabecera estilo banner no obligatorios, pero sí bloque JSDoc sobre `export function`.
- `snake_case` para keys serializadas (`session_id`, `plane_task_id`, `phase_id`) — confirmado en `src/session/state.js:9-23` (typedef `Session`).

---

### `src/logger-noop.js` (library, stub)

**Analog:** No existe en el codebase un stub similar. El análogo más cercano es `src/providers/registry.js` por ser **un archivo pequeño con estado local cerrado y exports mínimos**. El propio RESEARCH (línea 334) justifica crear este archivo separado para no contaminar el grafo de `check.js`.

**Header pattern** (mismo que todos los módulos):
```javascript
// @ts-check
```

**Estructura recomendada** (derivada de RESEARCH Pattern 4, líneas 326-330):
```javascript
// @ts-check
//
// No-op logger stub. MUST have zero imports (not even from node: builtins,
// not from ./config.js) so that src/check.js can import it without pulling
// src/logger.js into the vigilante's import graph (see LOG-12).
//

/** @type {{ debug: Function, info: Function, warn: Function, error: Function, child: Function }} */
export const noopLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() { return noopLogger; },
});
```
Reglas:
- **Zero imports** — ni `node:*` ni relativos. Cualquier import viola la garantía de aislamiento.
- `Object.freeze` para prevenir mutación accidental (patrón no presente en el codebase, pero estándar Node).
- Named export `noopLogger`; `src/logger.js` puede re-exportarlo para conveniencia: `export { noopLogger } from './logger-noop.js';`.
- Comentario de cabecera explicando la restricción (similar al banner en `src/check.js:1-7`).

---

### `test/logger.test.js` (test/unit — factory API, levels, NDJSON shape)

**Analog primario:** `test/check.test.js` (factory con DI, asserts sobre output estructurado, `describe/it`, sin tocar disco real).
**Analog secundario:** `test/state.test.js` (tmpdir fixture para tests que sí escriben a disco).

**Imports + tmpdir fixture** (de `test/state.test.js` líneas 1-11):
```javascript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), `kodo-test-${Date.now()}`);
const TEST_STATE = join(TEST_DIR, 'state.json');
```
Reglas a copiar:
- `node:test` para describe/it/beforeEach; `node:assert/strict` para asserts.
- Nombre del directorio único por run: `kodo-<prefijo>-${Date.now()}` — ej. `kodo-logger-${Date.now()}`.
- Fixture teardown como último `it('cleanup', ...)` (state.test.js:80-82) O `after(() => rmSync(...))` (más limpio, usado en RESEARCH example líneas 437, 447). **Preferir `after()`** — el teardown como `it` es un vestigio.

**HOME override para `KODO_DIR`** — el logger importa `KODO_DIR` de `./config.js`, que se evalúa con `homedir()` **al load time**. Para aislar:
```javascript
// Set HOME BEFORE importing the logger
const TEST_HOME = join(tmpdir(), `kodo-logger-${Date.now()}`);
process.env.HOME = TEST_HOME;
const { createLogger } = await import('../src/logger.js');
```
Este patrón viene del RESEARCH example (líneas 439-442). **Orden crítico:** setear `process.env.HOME` **antes** del `await import(...)` dinámico; si `logger.js` se importa estáticamente, el override ya no surte efecto.

**Factory con injection + assert shape** (de `test/check.test.js` líneas 36-56):
```javascript
describe('check.js — checkPendingTasks (pure)', () => {
  it('Test 1: calls provider.listPendingTasks() ...', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [{ id: '1', ref: 'KL-1' }],
    });
    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 1,
      getProviderFn: () => provider,
    });
    assert.match(result.lines.join('\n'), /2 pending/);
    assert.ok(result.reasons.some((r) => r.includes('2 tarea')));
  });
});
```
Aplicar a logger:
- `describe` por feature (`'createLogger factory'`, `'child bindings'`, `'level filtering'`, `'NDJSON shape'`).
- `it` con descripción imperativa en inglés (verbos: `'writes NDJSON with base fields'`, `'filters below minLevel'`).
- Parse del archivo NDJSON línea a línea + `JSON.parse` + `assert.equal`/`assert.match` sobre campos.

**Mock de stderr (Pattern 4 del research, línea 527)**:
```javascript
it('stderr never emits a JSON object', (t) => {
  const captured = [];
  t.mock.method(process.stderr, 'write', (chunk) => { captured.push(chunk.toString()); return true; });
  // ...
});
```
`t.mock.method` es API nativa de `node:test` (Node 20+). No es patrón ya usado en el codebase actual (no hay tests que mockeen stderr hoy), pero está disponible.

---

### `test/logger.redaction.test.js` (test/unit — grep assertion)

**Analog:** `test/state.test.js` (tmpdir fixture con write+read del archivo) combinado con el example explícito en RESEARCH (líneas 432-467).

**Pattern completo** (del RESEARCH líneas 432-467, ya adaptado a las convenciones del repo):
```javascript
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_HOME = join(tmpdir(), `kodo-redact-${Date.now()}`);
process.env.HOME = TEST_HOME;
const { createLogger } = await import('../src/logger.js');

describe('logger redaction (grep assertion)', () => {
  const sessionId = 'sess-redact-1';
  const logPath = join(TEST_HOME, '.kodo', 'logs', `${sessionId}.ndjson`);
  after(() => rmSync(TEST_HOME, { recursive: true, force: true }));

  it('never persists PLANE_API_KEY, headers, JWT-like values', () => {
    const log = createLogger({ sessionId, minLevel: 'debug' });
    const SECRETS = {
      apiKey: 'plane_abcdef0123456789deadbeefcafe1234',
      jwt:    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.abc123sig',
      sig:    'sha256=0123456789abcdef0123456789abcdef',
    };
    log.info('creds top-level', { plane_api_key: SECRETS.apiKey });
    log.info('nested headers', { request: { headers: { authorization: `Bearer ${SECRETS.apiKey}` } } });
    log.info('webhook', { headers: { 'x-plane-signature': SECRETS.sig } });
    log.info('raw JWT', { payload: SECRETS.jwt });

    const raw = readFileSync(logPath, 'utf-8');
    for (const s of Object.values(SECRETS)) {
      assert.equal(raw.includes(s), false, `secret leaked: ${s.slice(0, 12)}…`);
    }
    assert.equal(raw.includes('[REDACTED]'), true);
  });
});
```
Reglas del codebase aplicadas:
- `describe`/`it`/`after` de `node:test`.
- `assert` de `node:assert/strict` (alineado con `state.test.js:2`).
- Constantes de secretos en `UPPER_SNAKE_CASE` (convención del repo).
- Cleanup con `rmSync({ recursive: true, force: true })` — mismo flag que `state.test.js:81`.
- Mensajes de assert en inglés con contexto (`\`secret leaked: ${...}\``).

---

### `test/check-isolation.test.js` (test/static + smoke — import graph + startup budget)

**Analog:** `test/check.test.js` líneas 158-181 (bloque `describe('check.js — source invariants')` — hace **exactamente** el mismo tipo de verificación: leer source, asertar ausencia de imports específicos).

**Pattern de source invariant** (de `test/check.test.js` líneas 158-181):
```javascript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECK_SOURCE_PATH = join(__dirname, '..', 'src', 'check.js');

describe('check.js — source invariants', () => {
  it('Test 2: source file does NOT import or reference PlaneClient', () => {
    const source = readFileSync(CHECK_SOURCE_PATH, 'utf-8');
    assert.ok(
      !source.includes('PlaneClient'),
      'check.js must not reference PlaneClient',
    );
    assert.ok(
      !source.includes("from './plane/client.js'"),
      'check.js must not import from ./plane/client.js',
    );
  });

  it('imports initRegistry and getProvider from providers/registry.js', () => {
    const source = readFileSync(CHECK_SOURCE_PATH, 'utf-8');
    assert.match(source, /from ['"]\.\/providers\/registry\.js['"]/, '...');
  });
});
```
Este es **literalmente el ancestro** del test LOG-12. El test nuevo solo debe:
1. Extender a **transitivo** (walkImports recursivo) — patrón RESEARCH líneas 482-495.
2. Asertar que `logger.js` no aparece en el grafo cerrado desde `check.js`; `logger-noop.js` **sí** está permitido.

**Regex walker completo** (RESEARCH líneas 480-501, ya pulido; aplicar solo ajustes de estilo del repo):
```javascript
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', 'src');
const IMPORT_RE = /^\s*import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/gm;

function walkImports(entry, visited = new Set()) {
  if (visited.has(entry)) return visited;
  visited.add(entry);
  const src = readFileSync(entry, 'utf-8');
  for (const match of src.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue;
    const resolved = resolve(dirname(entry), spec);
    walkImports(resolved, visited);
  }
  return visited;
}

describe('LOG-12: vigilante isolation', () => {
  it('kodo check does not import logger.js transitively', () => {
    const graph = walkImports(join(SRC, 'check.js'));
    const hit = [...graph].find(p => p.endsWith('/logger.js'));
    assert.equal(hit, undefined, `check.js transitively imports ${hit}`);
  });
});
```
Ajustes de estilo del repo:
- Usar `fileURLToPath`/`dirname` como en `test/check.test.js:5-9` (ya presente).
- Mensaje de assert en inglés con contexto del path violador.
- `/\/logger\.js$/` o `.endsWith('/logger.js')` para evitar match accidental de `logger-noop.js`.

---

### `test/startup-budget.test.js` (test/smoke — spawnSync + hrtime)

**Analog:** No existe un test de presupuesto de arranque en el codebase actual. El patrón viene del RESEARCH (líneas 504-519). El ancestro más cercano es `test/check.test.js` por referenciar al `src/check.js` en el filesystem.

**Pattern completo** (RESEARCH líneas 504-519, ajustado):
```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_KODO = resolve(__dirname, '..', 'bin', 'kodo');

describe('LOG-12: startup budget', () => {
  it('kodo check completes in under 50ms (median of 5 runs)', () => {
    const runs = 5;
    const durations = [];
    for (let i = 0; i < runs; i++) {
      const t0 = process.hrtime.bigint();
      spawnSync(process.execPath, [BIN_KODO, 'check'], { stdio: 'ignore' });
      durations.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    const median = durations.sort((a, b) => a - b)[Math.floor(runs / 2)];
    assert.ok(median < 50, `median startup ${median.toFixed(1)}ms exceeds 50ms budget`);
  });
});
```
**Open question del RESEARCH (Q3):** Si baseline en CI es >50 ms, cambiar threshold a `max(50, baseline * 1.15)` medido en Wave 0. El planner debe añadir un task de medición previa.

---

## Shared Patterns (cross-cutting)

### P-1: `// @ts-check` header
**Source:** `src/config.js:1`, `src/check.js:1`, `src/session/state.js:1`, `src/providers/registry.js:1`, `src/providers/plane/provider.js:1`
**Apply to:** Todos los archivos `src/*.js` y `src/**/*.js` (sí a `logger.js` y `logger-noop.js`).
Excepción: archivos de test **no** usan `// @ts-check` (verificado en `test/check.test.js`, `test/state.test.js`) — no aplicar en tests.

### P-2: Reutilizar `KODO_DIR` de `config.js`
**Source:** `src/config.js:6,176` (export); `src/session/state.js:4,6` (import + derive path).
```javascript
import { KODO_DIR } from '../config.js';
const STATE_PATH = join(KODO_DIR, 'state.json');
```
**Apply to:** `src/logger.js` debe derivar `logDir = join(KODO_DIR, 'logs')` de la misma manera. **NO** duplicar `homedir()` ni `.kodo`.

### P-3: JSDoc `@param`/`@returns` en exports públicos
**Source:** `src/config.js:75-82,104-108,131,137,148,154-159`; `src/providers/plane/provider.js:17-22`.
Todo `export function` debe ir precedido de JSDoc. `@typedef` al top del módulo para forms complejos.
**Apply to:** `createLogger`, `child`, `debug`/`info`/`warn`/`error`, `noopLogger` — todos con JSDoc.

### P-4: Mensajes `[kodo:<subsistema>] ...` con ANSI para stderr
**Source:** `src/check.js:15-17, 42, 48, 120, 124`; `src/config.js:115` (versión sin color).
Formato: `` `[kodo:logger] write failed: ${err.message}` `` para el warning de I/O fallido del research (pattern 1, línea 244). El logger ya tiene su propio pretty-print ANSI; el fallback "write failed" puede usar el mismo formato.

### P-5: Test harness — `node:test` + `node:assert/strict`
**Source:** Todos los archivos `test/*.test.js`; confirmado `package.json` scripts.
**Apply to:** Los 3 (o 4) tests del phase.
Command to run phase suite:
```
node --test test/logger.test.js test/logger.redaction.test.js test/check-isolation.test.js
```

### P-6: tmpdir fixture con cleanup
**Source:** `test/state.test.js:7-11,80-82`.
```javascript
const TEST_DIR = join(tmpdir(), `kodo-<label>-${Date.now()}`);
// ...
after(() => rmSync(TEST_DIR, { recursive: true, force: true }));
```
**Apply to:** `test/logger.test.js`, `test/logger.redaction.test.js` (ambos escriben NDJSON a disco).
No aplica a `test/check-isolation.test.js` (solo lee source) ni a `test/startup-budget.test.js` (spawn aislado).

### P-7: Factory function (no class)
**Source:** `src/providers/plane/provider.js:23` (`export function createPlaneProvider(config)`); `src/providers/registry.js:62` (`export function getProvider(name)`).
Excepción documentada en CONTEXT.md: `PlaneClient` es la única `class` del proyecto.
**Apply to:** `createLogger` es factory, `logger.child()` devuelve otro objeto literal (ver RESEARCH Pattern 1 líneas 216-224).

### P-8: Named exports, ESM puro
**Source:** Ningún `export default` en `src/`; confirmado `package.json` `"type": "module"`.
**Apply to:** `export function createLogger(...)`, `export const noopLogger`, `export { LEVELS, LEVEL_NAMES }` (si se exponen para tests).

### P-9: Keys `snake_case` en datos serializados
**Source:** `src/session/state.js:9-23` (`session_id`, `workspace_ref`, `task_ref`, `project_id`, `started_at`, `project_path`).
**Apply to:** Campos NDJSON del logger: `session_id`, `plane_task_id`, `phase_id`, `timestamp`, `level`, `component`, `msg`. Nunca `camelCase` en payload.

---

## No Analog Found

Ningún archivo del phase carece completamente de análogo — todos tienen al menos role-match. Hay dos **sub-capabilities** sin precedente directo en el codebase que el planner debe notar:

| Sub-capability | Novedad | Recomendación |
|----------------|---------|---------------|
| Redactor deep-walk (recursivo con límites de profundidad/longitud) | Patrón nuevo en el repo | Seguir **RESEARCH Pattern 2** literal (líneas 256-292); no hay equivalente interno a imitar |
| Mock de `process.stderr.write` con `t.mock.method` | No se usa en tests actuales | Seguir **RESEARCH example** (líneas 526-535); API nativa de Node 20 |
| `spawnSync` + `process.hrtime.bigint()` para presupuesto de arranque | No existe en el repo hoy | Nuevo; seguir RESEARCH example |
| Walker de import-graph por regex | No existe en el repo hoy | Nuevo; seguir RESEARCH example; **validado** por claim A3: el repo no usa `import()` dinámico (grep 0 resultados al 2026-04-15) |

---

## Metadata

**Analog search scope:** `src/`, `test/`, `bin/`
**Files scanned:** 14 `src/*.js` y subdirs, 14 `test/*.test.js`, 1 `bin/kodo`
**Key source files read:**
- `src/config.js` (176 LoC) — imports, KODO_DIR, mkdir, JSDoc
- `src/check.js` (127 LoC) — ANSI, error swallowing, target del test de aislamiento
- `src/session/state.js` (149 LoC) — typedef pattern, KODO_DIR reuse, snake_case
- `src/providers/registry.js` (101 LoC) — módulo pequeño con estado cerrado
- `src/providers/plane/provider.js` (parcial) — factory con closure state
- `src/cli.js` (parcial) — commander command + action pattern (para wiring de `--log-level` en fase siguiente)
- `bin/kodo` (3 LoC) — shebang + dynamic import de `src/cli.js`
- `test/state.test.js` (83 LoC) — tmpdir fixture completo
- `test/check.test.js` (181 LoC) — factory DI + source-invariant pattern

**Pattern extraction date:** 2026-04-15
