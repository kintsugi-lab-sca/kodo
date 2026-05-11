# Phase 15: CLI Polish Wiring — Pattern Map

**Mapped:** 2026-05-05
**Files analyzed:** 5 (0 new, 5 modified)
**Analogs found:** 5 / 5

> **Phase 15 NO crea archivos.** Cablea el helper `src/cli/format.js` (Phase 14, ya en main, read-only desde aquí) en 5 callsites. Los analogs principales son **el propio `format.js`** (API a invocar) y **patrones internos del repo** (DI-by-descriptor, factory shape, columnar layout).
>
> **Hereda de `14-PATTERNS.md`** (NO se re-derivan):
> - Factory shape `createFormatter(stream, env?)` con returned object literal de métodos.
> - DI-by-descriptor (analogs en `gsd-inspect.js:50-52` + `gsd-verify.js:55-57`).
> - JSDoc `@typedef` para shapes públicos.
> - `@ts-check` + ES modules + factory functions sobre classes.
> - Convenciones ANSI level→color (`debug=gray, info=cyan, warn=yellow, error=red`) — ya implementadas en `format.js`.
>
> **Nuevo en Phase 15** (foco de este documento):
> - Patrón **"shape dual condicionado a `useColor`"** en `formatLine` (D-02): no es solo color sino layout. Es la primera vez en el repo que un helper bifurca *bytes* (no solo escapes ANSI) según TTY/NO_COLOR.
> - Patrón **"4-section verdict report"** en `gsd-inspect#renderHuman` (D-12): reorganización del output existente a `config / fetch / roadmap / match` con `fmt.ok`/`fmt.fail` por sección.
> - Patrón **"verdict-to-color mapping"** en `gsd-verify#renderHuman` (D-14): switch sobre `verdict.action` mapeado a `fmt.green / fmt.yellow / fmt.red` con prioridades semánticas (pass / soft-fail / hard-fail).
> - Patrón **"summary-by-slice"** del comentario Plane (D-15): se imprime el primer slice de `renderComment(verdict)` sin re-renderizar — protege Pitfall #2 Phase 10 (determinismo byte-a-byte).

---

## File Classification

| Modified File | Role | Data Flow | Analog principal | Match Quality | Decision Refs |
|---------------|------|-----------|------------------|---------------|---------------|
| `src/logger.js` | utility (formatter) | transform (record→string), DI por opts | `src/cli/format.js` (helper a delegar) + `src/logger.js#formatLine` (shape actual) | exact (combinación: API consumer + extensión interna) | D-01, D-02, D-04 |
| `src/logs/reader.js` | controller (CLI handler) | streaming/dump (NDJSON line→formatted) | `src/cli/format.js#_resolveUseColor` (helper a invocar) + reader actual (loop intacto) | exact (sustitución de un solo cómputo, loop no cambia) | D-01, D-03 |
| `src/check.js` | service (vigilante) | request-response (state→summary) | `src/cli/format.js` factory (sustituye ANSI inline) + DI `getProviderFn` (analog para `formatterFn`) | exact (eliminación + sustitución 1-a-1) | D-09, D-10, D-11 |
| `src/cli/gsd-inspect.js` | controller (CLI handler) | request-response (taskId→verdict report) | propio `renderHuman` actual (refactor estructural) + format.js (helpers) | exact (refactor in-place de la función ya existente) | D-12, D-13 |
| `src/cli/gsd-verify.js` | controller (CLI handler) | request-response (sessionId→verdict + Plane echo) | propio `renderHuman` actual + `src/gsd/verify.js#renderComment` (slice source) | exact (refactor + nuevo summary block) | D-14, D-15 |

---

## Pattern Assignments

### `src/logger.js` — `formatLine` columnar dual + `useColor` source generalization (D-01, D-02, D-04)

**Analogs:**
- **API consumer:** `src/cli/format.js#createFormatter` y `src/cli/format.js#_resolveUseColor` (helper a invocar — Phase 14 D-01, D-02, D-04).
- **Shape actual:** el propio `src/logger.js#formatLine` (lines 82-92) — la rama `useColor=false` debe preservarse byte-a-byte (SC#1).
- **Pattern de branching ya presente en el archivo:** `src/logger.js:85-86` ya bifurca `c = useColor ? color : ''` y `r = useColor ? ANSI_RESET : ''`. Phase 15 escala el patrón de "branching de un escape" a "branching de layout completo".

#### Imports pattern (nuevo import a añadir)

**Source:** `src/cli/format.js:1-18` exporta `createFormatter` y `_resolveUseColor` como named exports.

**Apply to `src/logger.js`** (añadir bajo el bloque actual de imports en `src/logger.js:16-18`):

```javascript
import { createFormatter, _resolveUseColor } from './cli/format.js';
```

LOG-12 invariante: `format.js` NO importa `logger.js` (verificado por `test/format-isolation.test.js` Phase 14 D-06). El import es unidireccional.

#### Shape dual condicionado a `useColor` (D-02)

**Source — actual (lines 82-92):**

```javascript
export function formatLine(record, { useColor }) {
  const time = String(/** @type {any} */ (record).timestamp).slice(11, 19);
  const lvl = String(/** @type {any} */ (record).level).toUpperCase();
  const c = useColor ? COLOR_BY_LEVEL[/** @type {any} */ (record).level] || '' : '';
  const r = useColor ? ANSI_RESET : '';
  const comp = /** @type {any} */ (record).component
    ? ` ${/** @type {any} */ (record).component}`
    : '';
  const ctx = formatCtxInline(record);
  return `${time} ${c}${lvl}${r}${comp} ${/** @type {any} */ (record).msg}${ctx}`;
}
```

**Apply** — bifurcar en dos shapes condicionado a `useColor`. **El branch `useColor=false` debe ser literalmente el cuerpo actual** (preserva SC#1 byte-a-byte):

```javascript
export function formatLine(record, { useColor }) {
  const time = String(/** @type {any} */ (record).timestamp).slice(11, 19);
  const lvl = String(/** @type {any} */ (record).level).toUpperCase();

  if (!useColor) {
    // BRANCH NON-TTY/NO_COLOR — preservación byte-a-byte (SC#1).
    // NO tocar este return: cualquier cambio rompe golden bytes test.
    const comp = /** @type {any} */ (record).component
      ? ` ${/** @type {any} */ (record).component}`
      : '';
    const ctx = formatCtxInline(record);
    return `${time} ${lvl}${comp} ${/** @type {any} */ (record).msg}${ctx}`;
  }

  // BRANCH TTY+COLOR — columnar nuevo (D-02 + D-05).
  // widths: timestamp=8 (HH:MM:SS), level=5 (max 'ERROR'), component=12 (D-05).
  // separator default ' · ' (D-07).
  // Component vacío → 12 espacios (D-06, alineación vertical).
  const fmt = createFormatter(process.stderr); // o process.stdout — ver D-04 + Discretion sobre _renderColumnar
  // ... usar fmt.debug/info/warn/error para el level chip + fmt.formatRow para alinear
  // ... ctx se anexa post-row si está presente
}
```

**Discretion CONTEXT line 75:** Phase 15 puede inlinear o extraer a `_renderColumnar(rec, fmt, widths)` interno. El factory `createFormatter` se invoca **una vez por record** o se cachea a nivel módulo si la closure de useColor es estable (mismo descriptor en todos los callsites del mismo proceso).

#### Widths fijas + pad-only (D-05, D-06)

**Source:** `src/cli/format.js:69-73` — `padCell` ya hace pad-only sin truncate (D-10 Phase 14 contract).

```javascript
function padCell(cell, width) {
  const w = visibleWidth(cell);
  if (w >= width) return cell;
  return cell + ' '.repeat(width - w);
}
```

**Apply en logger.js:** widths constantes a nivel módulo (estilo `LEVELS` y `LEVEL_NAMES` ya frozen en lines 25, 28):

```javascript
/** @type {Readonly<{ timestamp: 8, level: 5, component: 12 }>} */
const COLUMNAR_WIDTHS = Object.freeze({ timestamp: 8, level: 5, component: 12 });
```

`Object.freeze` por convención del archivo (líneas 25, 28, 37 ya lo hacen).

#### `useColor` source generalization (line 204)

**Source — actual (line 204):**

```javascript
const useColor = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
```

**Apply** — sustituir por `_resolveUseColor` (que añade soporte FORCE_COLOR D-02 Phase 14):

```javascript
const useColor = _resolveUseColor(process.stderr);
```

Cero churn en `maybeMirrorToStderr` (line 263-272) — el `useColor` se sigue capturando en closure y `formatLine(record, { useColor })` mantiene la firma (D-04 CONTEXT Phase 15).

#### Mantener `formatCtxInline` y la firma de `formatLine`

**No tocar:**
- `formatCtxInline` (lines 61-72) — pure helper, sigue siendo el formateo de extras `+k=v`.
- Firma `formatLine(record, { useColor })` — los 2 callers (`maybeMirrorToStderr` line 271 y `reader.js` line 99) la consumen igual; cambiar la firma forzaría churn fuera de Phase 15 scope.
- El bloque de redacción (lines 94-172) — fuera de scope.

#### Error handling: ANSI_RED en `writeNdjson` (line 253)

**Source actual (line 253):**

```javascript
process.stderr.write(`${ANSI_RED}[kodo:logger] write failed: ${msg}${ANSI_RESET}\n`);
```

**Discretion:** este path NO es uno de los 4 surfaces TTY del SC; puede dejarse como está (ANSI inline) o migrarse a `fmt.red(...)` por consistencia. **Recomendación:** dejarlo igual — Phase 15 alcance explícito en CONTEXT lines 122-133 NO lo lista. Cambiar línea 253 abre churn fuera del SC.

---

### `src/logs/reader.js` — `useColor` source change (D-01, D-03)

**Analog:** `src/cli/format.js#_resolveUseColor` (Phase 14 — drop-in replacement de la línea 68 inline).

#### Imports pattern

**Source actual (line 24):**

```javascript
import { LEVELS, formatLine } from '../logger.js';
```

**Apply** — añadir import de `_resolveUseColor` desde format.js (NO desde logger.js — D-07 Phase 14 single-source):

```javascript
import { LEVELS, formatLine } from '../logger.js';
import { _resolveUseColor } from '../cli/format.js';
```

`reader.js` ya está fuera del grafo de `check.js` (CONTEXT line 184), no afecta LOG-12.

#### `useColor` cómputo (line 68) — sustitución 1-a-1

**Source actual (line 68):**

```javascript
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
```

**Apply** — drop-in (descriptor diferente que logger.js: aquí `process.stdout`, allá `process.stderr`):

```javascript
const useColor = _resolveUseColor(process.stdout);
```

#### `--json` early return — PRESERVAR EXACTO (D-03)

**Source actual (lines 74-79):**

```javascript
if (opts.json) {
  // --json: passthrough crudo sin parsear ni filtrar (pipe-friendly para jq).
  process.stdout.write(raw + '\n');
  return;
}
```

**Apply:** **NO TOCAR**. El formatter NUNCA se invoca para `--json`. SC#2 cumplido triviamente. El golden bytes test pre/post Phase 15 compara bytes sin tocar `--json` path.

#### Loop de `printLine` — PRESERVAR EXACTO

Lines 80-100 (parse + filtros + `formatLine(rec, { useColor })`) NO cambian. La columnar shape entra **vía `formatLine`** (D-01 → modificación en logger.js); reader.js solo consume.

---

### `src/check.js` — sustituir ANSI inline por formatter (D-09, D-10, D-11)

**Analogs:**
- **Reemplazo:** `src/cli/format.js#createFormatter` (Phase 14 — `fmt.yellow / fmt.red / fmt.ok`).
- **DI pattern:** el propio `checkPendingTasks` ya inyecta `getProviderFn` (line 31) — Phase 15 añade `formatterFn` siguiendo el mismo molde.

#### Eliminar ANSI inline (lines 15-17)

**Source actual:**

```javascript
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED = '\x1b[31m';
const ANSI_RESET = '\x1b[0m';
```

**Apply:** **ELIMINAR las 3 líneas**. `format.js` es la única superficie de color (D-07 Phase 14, blindado por `test/format-isolation.test.js`).

#### Imports pattern

**Source actual (lines 9-13):**

```javascript
import { loadConfig } from './config.js';
import { loadState } from './session/state.js';
// ...
```

**Apply** — añadir un import directo a format.js. **Verificar LOG-12:** `format.js` NO importa `logger.js`, por lo que `check.js → format.js` mantiene el guard verde (CONTEXT line 184, `test/check-isolation.test.js` sigue pasando):

```javascript
import { createFormatter } from './cli/format.js';
```

#### DI-by-descriptor analog — añadir `formatterFn` opt (D-11)

**Source — pattern existente en este mismo archivo (lines 24-30):**

```javascript
export async function checkPendingTasks({ config, runningCount, getProviderFn }) {
```

**Apply** — extender `checkPendingTasks` con `formatterFn` opcional (default factory):

```javascript
/**
 * @param {{
 *   config: { provider: string, claude: { max_parallel: number } },
 *   runningCount: number,
 *   getProviderFn: (name: string) => import('./interface.js').TaskProvider,
 *   formatterFn?: () => import('./cli/format.js').Formatter,
 * }} params
 */
export async function checkPendingTasks({ config, runningCount, getProviderFn, formatterFn }) {
  const fmt = (formatterFn || (() => createFormatter(process.stdout)))();
  // ...
}
```

**Stream rationale (D-11):** `runCheckAndAct` escribe via `console.log` (line 117), que va a stdout. Por eso `process.stdout` en el factory default. Tests inyectan `formatterFn: () => createFormatter({ isTTY: true })` para asertar bytes coloreados.

#### Sustitución 1-a-1 de los 3 callsites ANSI

**Source actual (lines 41-44):**

```javascript
lines.push(
  `${ANSI_YELLOW}[kodo:check] ${pending.length} pending kodo task(s), ${available} slot(s) available${ANSI_RESET}`,
);
```

**Apply (D-10):**

```javascript
lines.push(
  `[kodo:check] ${fmt.yellow(`${pending.length} pending kodo task(s), ${available} slot(s) available`)}`,
);
```

**Source actual (lines 47-49):**

```javascript
lines.push(
  `${ANSI_RED}[kodo:check] Error checking tasks: ${err.message}${ANSI_RESET}`,
);
```

**Apply:**

```javascript
lines.push(
  `[kodo:check] ${fmt.red(`Error checking tasks: ${err.message}`)}`,
);
```

**Source actual (line 105):**

```javascript
lines.push('[kodo:check] All clear ✓');
```

**Apply (D-10):** `fmt.ok('All clear')` ya embebe el `✓` (Phase 14 `format.js:165` → `${OK_SYMBOL} ${pc.green(s)}`). **El `✓` literal del string actual debe eliminarse** o queda duplicado:

```javascript
lines.push(`[kodo:check] ${fmt.ok('All clear')}`);
```

#### Preservación bytes en NO_COLOR (SC#5 + D-09)

Cuando `useColor=false`, `fmt.yellow`/`fmt.red`/`fmt.ok` son identity (Phase 14 D-04 — `createColors(false)` devuelve identity functions). El símbolo `✓` sigue presente porque está embebido literalmente, no por color. Resultado: bytes en NO_COLOR coinciden con la baseline (los strings sin ANSI codes), satisfaciendo SC#5 sin actualizar snapshots de `test/check.test.js`.

⚠️ **Diff vs. baseline:** la línea actual `'[kodo:check] All clear ✓'` (sin trailing space después del `✓`) y el output post-Phase 15 `'[kodo:check] ✓ All clear'` (con `✓` antes del texto) **no son byte-idénticos**. Phase 15 D-10 acepta este cambio de orden porque el helper `fmt.ok` siempre antepone el símbolo (`format.js:165`). El test snapshot debe actualizarse a `'[kodo:check] ✓ All clear'`. Verificar con planner si SC#5 acepta el reorden o exige símbolo a la derecha.

#### `runCheck` lines/summary split — NO TOCAR

El patrón "compone `lines[]`, luego `lines.join('\n')`" (lines 62-108) NO cambia. Phase 15 colorea cada línea individualmente vía `fmt.*`; el join sigue siendo `\n`-separado.

---

### `src/cli/gsd-inspect.js` — refactor `renderHuman` a 4 secciones (D-12, D-13)

**Analogs:**
- **Helpers:** `src/cli/format.js` — `fmt.ok('OK')` / `fmt.fail('FAIL')` (D-03 Phase 14).
- **DI shape existente:** `runGsdInspect` ya inyecta `writeFn`, `errFn`, `getProviderFn`, `resolveProjectPathFn`, `resolvePhaseFn` (lines 50-62). Phase 15 puede añadir `formatterFn` siguiendo el mismo molde.
- **Estructura de switch sobre `verdict.action`:** ya existe en lines 127-143; se preserva la lógica, solo cambia el chrome de cada sección.

#### Reorden semántico de chequeos (Discretion CONTEXT line 77)

**Orden de ejecución actual (lines 64-89):** fetch → config → resolver → roadmap-check.

**Orden literal SC#3:** `config / fetch / roadmap / match`.

**Apply (Discretion):** reordenar el render para que coincida con el **orden de chequeo real** (orden de fallo): `config / fetch / roadmap / match` se renderiza en ese orden; las labels son **literales** del SC. Si el handler aún ejecuta fetch primero, hay que **reordenar también la ejecución del handler** (o renderizar las secciones tras computar todas, en cualquier orden).

**Decisión recomendada:** mantener el orden de ejecución actual (fetch primero — es lo que falla más rápido en producción) y **renderizar las 4 secciones en orden literal SC** tras tener todos los datos. Las secciones se computan conditional sobre el verdict ya conocido.

#### 4 secciones con `fmt.ok`/`fmt.fail` por sección (D-12)

**Source actual (lines 116-144):**

```javascript
function renderHuman({ task, projectPath, hasPlanning, verdict, brief, write }) {
  // Section 1: task resolution
  write(`Task:         ${task.ref} — ${task.title}\n`);
  // ...
  // Section 2: .planning/PROJECT.md presence
  write(`.planning/PROJECT.md: ${hasPlanning ? 'present' : 'MISSING'}\n\n`);
  // Section 3: verdict — exhaustive switch per D-02
  // Section 4: preview of buildGsdContext...
}
```

**Apply** — refactor a 4 secciones literales del SC con symbol-leading lines:

```javascript
function renderHuman({ task, projectPath, hasPlanning, verdict, brief, configOk, fetchOk, write, fmt }) {
  // Header (info de contexto, sin OK/FAIL — son hechos)
  write(`Task:         ${task.ref} — ${task.title}\n`);
  write(`Labels:       [${(task.labels || []).join(', ')}]\n`);
  write(`Project path: ${projectPath}\n\n`);

  // Section 1: config
  write(`config:  ${configOk ? fmt.ok('OK') : fmt.fail('FAIL')}\n`);
  // Section 2: fetch
  write(`fetch:   ${fetchOk ? fmt.ok('OK') : fmt.fail('FAIL')}\n`);
  // Section 3: roadmap (.planning/PROJECT.md presence)
  write(`roadmap: ${hasPlanning ? fmt.ok('OK') : fmt.fail('FAIL')}\n`);
  // Section 4: match (verdict)
  const matchOk = verdict.action !== 'error';
  write(`match:   ${matchOk ? fmt.ok('OK') : fmt.fail('FAIL')}`);
  if (verdict.action === 'phase') write(` — phase ${verdict.phase_id}`);
  else if (verdict.action === 'bootstrap') write(` — bootstrap (${verdict.reason})`);
  else if (verdict.action === 'error') write(` — ${verdict.code}${verdict.detail ? `: ${verdict.detail}` : ''}`);
  write('\n\n');

  // Preserve preview only for bootstrap (Discretion: útil para auditoría)
  if (verdict.action === 'bootstrap' && brief) {
    // ... preview existente (lines 146-163 del actual)
  }
}
```

**Nota crítica:** `configOk` y `fetchOk` son **hechos del control flow** — no del verdict. Phase 15 debe propagarlos desde `runGsdInspect` al `renderHuman`. Hoy el handler hace `try/catch` con early-return (lines 64-83); para llegar a `renderHuman` ambos ya pasaron (i.e. `configOk=true` y `fetchOk=true` siempre que se llame `renderHuman`). En modo human, las líneas `config: ✓ OK` y `fetch: ✓ OK` se imprimen siempre porque cualquier fallo previo ya hizo `return 1` o `return 2` antes de llegar al render.

→ **Las únicas dos secciones con FAIL posible en `renderHuman`** son:
- `roadmap` (FAIL si `hasPlanning === false`)
- `match` (FAIL si `verdict.action === 'error'`)

Las secciones `config` y `fetch` siempre se renderizan como ✓ OK (si fallan, el handler retorna antes con un mensaje de error vía `errFn` — no via `renderHuman`).

#### Línea final `Exit: N` (D-13)

**Source — pattern actual:** el handler retorna el code en line 109:

```javascript
return verdict.action === 'error' ? 1 : 0;
```

**Apply** — imprimir el código antes del return:

```javascript
const exitCode = verdict.action === 'error' ? 1 : 0;
write(`Exit: ${exitCode}\n`);
return exitCode;
```

**Invariante preservada:** el N visible **nunca diverge** del N retornado por el proceso (D-19 Phase 9). Esto es cosmético: el operador ve en stdout el code que el handler va a devolver — útil para flujos shell (`kodo gsd inspect ...; echo "exit=$?"` ya no requiere el `echo`).

⚠️ **Rama config/fetch FAIL:** los `return 1`/`return 2` tempranos (lines 71, 82) NO pasan por `renderHuman`, sólo por `errFn`. Phase 15 D-13 puede:
- (a) Imprimir `Exit: 1` o `Exit: 2` también en esos paths (consistencia total) — vía `write` antes del return.
- (b) Solo imprimirlo en el happy path (Discretion).

Recomendación: **(a)** para consistencia del operador (el `Exit: N` aparece siempre, en error y en éxito).

#### Preservar JSON path (line 96-103)

`opts.json` mode NO se toca. Sigue siendo `JSON.stringify({...}, null, 2)` con el shape actual (task, project_path, has_planning_dir, verdict, brief). El `Exit: N` NO se añade al JSON output (sería una key extra que rompería consumers existentes); solo aparece en human mode.

---

### `src/cli/gsd-verify.js` — verdict→color mapping + Plane summary (D-14, D-15)

**Analogs:**
- **Helpers:** `src/cli/format.js` — `fmt.green / fmt.yellow / fmt.red` para los 3 niveles semánticos (D-03 Phase 14).
- **DI pattern existente:** `runGsdVerifyCli` ya inyecta `runVerifyFn`, `writeFn`, `errFn` (lines 55-58). Phase 15 añade `formatterFn` siguiendo el mismo molde.
- **Slice source para summary:** `src/gsd/verify.js#renderComment(verdict, phaseName)` (line 302) — exhaustive switch que devuelve markdown completo. Las dos primeras líneas son el header determinista.

> ⚠️ **Corrección a CONTEXT D-15:** `renderComment` vive en `src/gsd/verify.js:302` (NO en `src/gsd/verification.js` como dice CONTEXT). El planner debe importar desde `../gsd/verify.js`. Verificado contra fuente.

#### Verdict→color mapping (D-14)

**Source actual (lines 87-114):**

```javascript
function renderHuman(result, write) {
  const { verdict, plane, session } = result;
  // ...
  switch (verdict.action) {
    case 'pass':
      write(`  action:      pass\n`);
      // ...
    case 'fail':
      write(`  action:      fail\n`);
      // ...
    case 'missing':
      write(`  action:      missing\n`);
      // ...
    case 'malformed':
      write(`  action:      malformed\n`);
      // ...
  }
}
```

**Apply (D-14)** — colorear el valor de `action` según semántica:

```javascript
function renderHuman(result, write, fmt) {
  const { verdict, plane, session } = result;
  write(`Session:      ${session.session_id}\n`);
  write(`Task:         ${session.task_ref}\n\n`);
  write('Verdict:\n');

  // D-14 mapping: verdict.action → 3 colores semánticos
  const actionColored = (() => {
    switch (verdict.action) {
      case 'pass':      return fmt.green('pass');           // happy path
      case 'fail':      return fmt.yellow('fail');          // soft-fail (recoverable por agente)
      case 'missing':   return fmt.red('missing');          // hard-fail (operador interviene)
      case 'malformed': return fmt.red('malformed');        // hard-fail
      default:          return String(verdict.action);
    }
  })();
  write(`  action:      ${actionColored}\n`);

  // El cuerpo (phase_id, must_haves, reason, detail) se imprime en color neutro
  switch (verdict.action) {
    case 'pass':
      write(`  phase_id:    ${verdict.phase_id}\n`);
      write(`  must_haves:  ${verdict.must_haves}\n`);
      break;
    case 'fail':
      write(`  phase_id:    ${verdict.phase_id}\n`);
      write(`  reason:      ${verdict.reason}\n`);
      write(`  detail:      ${verdict.detail}\n`);
      break;
    case 'missing':
      write(`  phase_id:    ${verdict.phase_id}\n`);
      break;
    case 'malformed':
      write(`  phase_id:    ${verdict.phase_id}\n`);
      write(`  detail:      ${verdict.detail}\n`);
      break;
  }
  write('\n');
  // ... summary slice y Plane line (ver D-15 abajo)
}
```

**Discretion CONTEXT line 67:** opcionalmente, añadir prefix `fmt.ok` cuando `pass`. Si se hace, la línea queda `action:      ${fmt.ok('pass')}` — pero `fmt.ok` ya antepone `✓`, lo que duplicaría señales. Recomendación: **NO usar `fmt.ok` en este contexto**, solo `fmt.green('pass')`. El símbolo `✓` se reserva para `gsd-inspect` (D-12 ya lo aplica vía `fmt.ok('OK')`).

#### Plane comment summary block (D-15) — slice-only, NO re-render

**Source — `src/gsd/verify.js:302-315`:**

```javascript
export function renderComment(verdict, phaseName) {
  switch (verdict.action) {
    case 'pass':      return renderPassComment(verdict, phaseName);
    case 'fail':      return renderFailComment(verdict, phaseName);
    case 'missing':   return renderMissingComment(verdict, phaseName);
    case 'malformed': return renderMalformedComment(verdict, phaseName);
  }
  return '';
}
```

Cada `renderXComment` devuelve un string multi-line con un header determinista en line 0 y `**Verdict**: <action>` o equivalente en line 1-2 (ver `renderPassComment` lines 322-332 — el header es `[kodo:gsd] ✅ Phase ${v.phase_id} verificada — ${phaseName}`).

**Apply (D-15)** — imprimir las 2-3 primeras líneas como **slice del body ya generado por `verify.js`**, NO re-renderizar:

```javascript
// El result.plane.comment_body ya contiene el output de renderComment(verdict, phaseName).
// Slice las primeras 2-3 líneas y mostrarlas como summary determinista.
// Pitfall #2 Phase 10: NO se llama a renderComment desde aquí — se reusa el string
// que ya generó verify.js. Determinismo del comentario byte-a-byte intacto.

if (result.plane && result.plane.comment_body) {
  const summaryLines = result.plane.comment_body.split('\n').slice(0, 3);
  write('Plane comment (summary):\n');
  for (const line of summaryLines) {
    write(`  ${line}\n`);
  }
  write('\n');
}

// Plane: commented=X transitioned=Y (línea existente, line 115)
write(`Plane: commented=${plane.commented} transitioned=${plane.transitioned}\n`);
```

⚠️ **Asumption del shape:** Phase 15 D-15 asume que `result.plane.comment_body` está expuesto por `runGsdVerify`. **Hay que verificar** que `src/gsd/verify.js#runGsdVerify` ya devuelve `plane.comment_body` (o equivalente — `plane.body`, `plane.markdown`). Si no, dos opciones:
- (a) Añadir `comment_body` al return shape de `runGsdVerify` (mínimo cambio, fuera de Phase 15 strict scope pero defendible).
- (b) Llamar `renderComment(verdict, phaseName)` desde `gsd-verify.js` y slicear localmente. **Esto rompe Pitfall #2** porque crea un segundo callsite del renderer — si alguien refactoriza `renderPassComment` y olvida que se llama dos veces, divergen. **NO RECOMENDADO**.

→ **Recomendación:** opción (a). El planner debe verificar el shape actual de `runGsdVerify` y proponer el mínimo cambio en `verify.js` para exponer el body — sin alterar la lógica de posting.

#### Order of output

**SC requiere:** sección Verdict → comment summary → Plane line. El orden actual es Verdict → Plane line. Phase 15 inserta el summary block entre los dos.

#### `formatterFn` DI

```javascript
export async function runGsdVerifyCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const runVerifyFn = deps.runVerifyFn || runGsdVerify;
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();
  // ...
  if (opts.json) {
    write(JSON.stringify(result, null, 2) + '\n');
  } else {
    renderHuman(result, write, fmt);
  }
}
```

JSDoc `RunGsdVerifyCliDeps` typedef se extiende:

```javascript
/**
 * @typedef {{
 *   runVerifyFn?: typeof runGsdVerify,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 * }} RunGsdVerifyCliDeps
 */
```

#### Preservar JSON path (line 71-73)

`opts.json` mode NO se toca — sigue serializando `result` completo con `JSON.stringify(result, null, 2)`. Los colores son cosmética puramente human-mode.

---

## Shared Patterns

### Pattern A — `useColor` source unification

**Source:** `src/cli/format.js#_resolveUseColor` (Phase 14 D-04, line 42-46).

```javascript
export function _resolveUseColor(stream, env = process.env) {
  if (env.NO_COLOR != null) return false;
  if (env.FORCE_COLOR != null) return env.FORCE_COLOR !== '0';
  return Boolean(stream && stream.isTTY);
}
```

**Apply to all callsites con cómputo inline:**
- `src/logger.js:204` — `Boolean(process.stderr.isTTY) && !process.env.NO_COLOR` → `_resolveUseColor(process.stderr)`.
- `src/logs/reader.js:68` — `Boolean(process.stdout.isTTY) && !process.env.NO_COLOR` → `_resolveUseColor(process.stdout)`.

Ambos cómputos pasan a la misma función — agregando soporte FORCE_COLOR como side-effect. Test source-hygiene Phase 14 sigue verde (no nuevos imports de picocolors).

### Pattern B — DI por dep opcional con factory default

**Source dual:**
- `src/check.js:31` (existente): `getProviderFn` opcional con default factory.
- `src/cli/gsd-inspect.js:50-62` (existente): `writeFn`, `errFn`, `getProviderFn`, `resolveProjectPathFn`, `resolvePhaseFn` con defaults.
- `src/cli/gsd-verify.js:55-58` (existente): `runVerifyFn`, `writeFn`, `errFn`.

**Apply** — añadir `formatterFn` opcional a los 3 handlers que cablean color:

```javascript
const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();
```

Tests determinísticos pasan `formatterFn: () => createFormatter({ isTTY: true }, { NO_COLOR: undefined })` (TTY mode con bytes columnares) o `{ isTTY: false }` (preservación bytes pre-Phase 14).

### Pattern C — Imports adicionales de format.js

**Source:** Phase 14 declaró que `format.js` es la única superficie de color. Phase 15 cablea desde 5 callsites:

| Archivo | Import añadido |
|---------|----------------|
| `src/logger.js` | `import { createFormatter, _resolveUseColor } from './cli/format.js';` |
| `src/logs/reader.js` | `import { _resolveUseColor } from '../cli/format.js';` |
| `src/check.js` | `import { createFormatter } from './cli/format.js';` |
| `src/cli/gsd-inspect.js` | `import { createFormatter } from './format.js';` |
| `src/cli/gsd-verify.js` | `import { createFormatter } from './format.js';` |

**Test source-hygiene Phase 14 (`test/format-isolation.test.js`):**
- Picocolors single-source: ningún archivo de la tabla importa `picocolors` directamente — todos van por `format.js`. ✓
- LOG-12 extension: `format.js` no importa `logger.js`. ✓
- LOG-12 original: `check.js → logger.js` sigue prohibido transitivamente. ✓ (`check.js` añade `format.js` que NO arrastra `logger.js`).

### Pattern D — `Object.freeze` para constantes nuevas

**Source:** `src/logger.js:25, 28, 37` ya usan freeze para tablas read-only. `src/cli/format.js:21, 24, 27` lo replica para `OK_SYMBOL`, `FAIL_SYMBOL`, `DEFAULT_SEPARATOR`.

**Apply** — la constante nueva `COLUMNAR_WIDTHS` en logger.js (D-05) debe freezarse:

```javascript
/** @type {Readonly<{ timestamp: 8, level: 5, component: 12 }>} */
const COLUMNAR_WIDTHS = Object.freeze({ timestamp: 8, level: 5, component: 12 });
```

### Pattern E — Stream descriptor en factory: stderr vs. stdout

**Convención del repo (mapeo descriptor → consumer):**

| Surface | Descriptor | Razón |
|---------|------------|-------|
| `logger.js#maybeMirrorToStderr` | `process.stderr` | mirror del logger es stderr (line 264-271) |
| `logs/reader.js#runLogs` | `process.stdout` | dump del log file es stdout (line 99) |
| `check.js#runCheckAndAct` | `process.stdout` | escribe via `console.log` (line 117) que es stdout |
| `gsd-inspect.js#runGsdInspect` | `process.stdout` | `writeFn` default es `process.stdout.write` (line 51) |
| `gsd-verify.js#runGsdVerifyCli` | `process.stdout` | `writeFn` default es `process.stdout.write` (line 56) |

**Decisión por archivo:** el `createFormatter(stream)` se pasa el descriptor que coincida con el `writeFn` del callsite. **NO mezclar** (no usar fmt-de-stderr para escribir a stdout); rompería la coherencia useColor/isTTY.

---

## No Analog Found

| File | Razón |
|------|-------|
| (ninguno) | Todos los 5 archivos modificados tienen analogs claros. La mayoría son **el propio archivo** (refactors in-place de funciones existentes) o **`src/cli/format.js`** (la API a cablear). |

**Patrones nuevos sin precedente directo en el repo** (pero derivables de Phase 14 + el archivo afectado):
1. **Shape dual condicionado a `useColor`** (D-02 logger.js): el branching `useColor ? color : ''` ya existía a nivel escape; Phase 15 lo escala a layout completo. No hay otro archivo que bifurque bytes según TTY.
2. **`Exit: N` antes de return** (D-13 gsd-inspect.js): patrón de "echo del exit code" no presente en el repo. Inspirado por `gh`/`jq` (CONTEXT line 178).
3. **Verdict→3-color mapping con prioridad semántica** (D-14 gsd-verify.js): ningún otro switch en el repo mapea action a color. Es nuevo, pero la **estructura del switch** ya existe (lines 92-113) — solo se le añade el helper de color.
4. **Slice del body Plane sin re-render** (D-15 gsd-verify.js): patrón de "echo del primer slice" novel; protege Pitfall #2 Phase 10 (determinismo byte-a-byte del comment Plane).

---

## Metadata

**Analog search scope:** `src/`, `src/cli/`, `src/logs/`, `src/gsd/`, `.planning/phases/14-*/`.
**Files read (source):** `src/logger.js`, `src/logs/reader.js`, `src/check.js`, `src/cli/gsd-inspect.js`, `src/cli/gsd-verify.js`, `src/cli/format.js`, `src/gsd/verify.js` (líneas 295-355 para verificar shape de `renderComment`).
**Files read (context):** `.planning/phases/15-cli-polish-wiring/15-CONTEXT.md`, `.planning/phases/14-cli-format-foundation/14-CONTEXT.md`, `.planning/phases/14-cli-format-foundation/14-PATTERNS.md`.
**Pattern extraction date:** 2026-05-05.
**Critical correction logged:** CONTEXT D-15 cita `src/gsd/verification.js#renderComment` — la función real vive en `src/gsd/verify.js:302` (mismo módulo que `runGsdVerify`). Verificado con `grep`. El planner debe usar el path correcto al importar.
