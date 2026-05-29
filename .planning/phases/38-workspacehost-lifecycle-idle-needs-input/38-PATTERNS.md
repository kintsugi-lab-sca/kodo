# Phase 38: WorkspaceHost Lifecycle + Idle/Needs-Input — Pattern Map

**Mapped:** 2026-05-30
**Files analyzed:** 16 (7 new + 9 modified)
**Analogs found:** 16 / 16

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/host/interface.js` | contract/config | — | `src/interface.js` | exact |
| `src/host/cmux.js` | service/provider | request-response | `src/providers/plane/provider.js` | role-match |
| `test/host/contract.test.js` | test (matrix) | — | `test/providers/contract.test.js` | exact |
| `test/host/cmux-isolation.test.js` | test (walker) | — | `test/format-isolation.test.js` | exact |
| `test/state/migration.test.js` | test (pure fn) | — | `test/migration.test.js` | exact |
| `test/host/reconciliation.test.js` | test (tick async) | event-driven | `test/migration.test.js` + `src/cli/dashboard/usePoll.js` | role-match |
| `38-HUMAN-UAT.md` | doc/UAT | — | `.planning/phases/37-attach-handoff-cmux/37-HUMAN-UAT.md` | exact |
| `src/cli/dashboard/format.js` | utility (modify) | — | self (extend) | exact |
| `src/cli/dashboard/SessionTable.js` | component (modify) | — | self (extend) | exact |
| `src/cli/dashboard/App.js` | component (modify) | — | self (extend) | exact |
| `src/cli/dashboard/index.js` | entry (modify) | request-response | self (extend) | exact |
| `src/session/manager.js` | service (modify) | CRUD | self (extend) | exact |
| `src/session/state.js` | model/store (modify) | CRUD | self (extend) | exact |
| `src/gsd/verify.js` | hook (modify) | — | self (line-level) | exact |
| `src/hooks/stop.js` | hook (modify) | — | self (line-level) | exact |
| `src/logger-events.js` | utility (modify) | — | self (extend) | exact |

---

## Pattern Assignments

---

### `src/host/interface.js` (contract, new)

**Analog:** `src/interface.js`

**Divergencias clave:** `src/interface.js` expone 9 métodos (`TASK_PROVIDER_METHODS`) y 2 typedefs (`TaskItem`, `TriggerEvent`). `src/host/interface.js` expone **4 métodos** (`HOST_METHODS`) y 1 typedef (`WorkspaceInfo`). La constante se llama `HOST_METHODS` (no `TASK_PROVIDER_METHODS`). `getHost(name)` reemplaza al factory de `providers/registry.js`.

**Imports pattern** (`src/interface.js` líneas 1-8):
```js
// @ts-check
// No imports — módulo puro de contratos. Cero I/O, cero deps.
```

**Constante de métodos** (`src/interface.js` líneas 51-62):
```js
/** @type {readonly string[]} */
export const TASK_PROVIDER_METHODS = Object.freeze([
  'init',
  'getTask',
  // ...9 métodos
]);
```
Copiar exactamente este patrón con `HOST_METHODS` para los 4 métodos de D-03:
```js
export const HOST_METHODS = Object.freeze([
  'listWorkspaces',
  'selectWorkspace',
  'isAlive',
  'needsInput',
]);
```

**Typedef de WorkspaceInfo** — modelar como el `@typedef TaskItem` de `src/interface.js` líneas 11-26: objeto con tipos escalares, campos opcionales marcados con `?`, comentario de fase en los campos nuevos.

**`getHost(name)` factory** — NO existe análogo directo en `src/interface.js` (ese módulo es puro). El registry vive en `src/providers/registry.js`. Para Phase 38 `getHost` es un pequeño factory inline en el mismo `src/host/interface.js` (análogo simplificado de `getProvider` de `src/providers/registry.js` pero sin `initRegistry`). Planner debe decidir si exportar `getHost` desde `interface.js` o desde un `src/host/registry.js` separado — el CONTEXT.md no distingue, usar el mínimo viable (inline en `interface.js`).

---

### `src/host/cmux.js` (provider impl, new)

**Analog:** `src/providers/plane/provider.js` (factory pattern) + `src/cli/dashboard/focus.js` (reutilización de `runFocus`)

**Imports pattern** (`src/providers/plane/provider.js` líneas 1-5):
```js
// @ts-check
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PlaneClient } from './client.js';
import { normalizeWorkItem, parseTriggerEvent } from './normalize.js';
```
Para `CmuxHost`:
```js
// @ts-check
import { execFile } from 'node:child_process';
import { runFocus } from '../cli/dashboard/focus.js';
import { HOST_METHODS } from './interface.js';
```

**Factory pattern** (`src/providers/plane/provider.js` líneas 23-31):
```js
export function createPlaneProvider(config, opts = {}) {
  const logger = opts.logger?.child({ component: 'plane' });
  const client = new PlaneClient({ ... });
  // caches locales
  return { init, getTask, ... };
}
```
Copiar este patrón como `createCmuxHost(config, opts = {})` retornando el objeto con los 4 métodos del contrato. La caché de 1-tick de `isAlive`/`needsInput` usa el mismo patrón `Map` local (`stateCache`, `moduleCache` en plane/provider.js líneas 36-41).

**Retorno discriminado never-throws** — `selectWorkspace` re-exporta el shape de `runFocus` directamente. Ver `src/cli/dashboard/focus.js` para la firma `{ok, code?, detail?}` ya establecida en Phase 37. `CmuxHost.selectWorkspace(ref)` es un wrapper de 3 líneas.

**Binary path desde config** — mismo patrón que `src/cli/dashboard/index.js` línea 122:
```js
const cmuxBin = loadConfig().cmux.binary;
```

---

### `test/host/contract.test.js` (contract matrix test, new)

**Analog:** `test/providers/contract.test.js`

**Estructura de matrix loop** (líneas 369-467): el loop `for (const implName of IMPLS)` itera sobre `['cmux', 'null']` (NullHost mock) × N asserts. Todos los `it()` viven DENTRO del `describe` del loop — cero `it()` top-level (Pitfall #3 del contrato de Phase 27).

**Live-fetch leak guard** (líneas 54-63): para `CmuxHost` no hay `globalThis.fetch` pero sí hay `execFile`. Aplicar el mismo patrón: en `before()` sobreescribir el exec inyectable con un stub que lanza loud si no está stubbeado. `NullHost` no necesita stub.

**`instantiateHost(name)` helper** — espejo de `instantiateProvider` (líneas 287-343): oculta la divergencia DI. Para `cmux`: inyectar `exec` fake que retorna `{ stdout: JSON.stringify([...]) }`. Para `null`: instancia directa sin DI.

**Shape assert** — copiar `assertTaskItemShape` (líneas 139-187) como `assertWorkspaceInfoShape`. Fields: `workspace_ref` (string), `alive` (boolean), `needs_input` (boolean), `last_activity` (string|null). Subset check + required check + tipo por campo.

**Asserts mínimos del contrato** (análogo a B1-B7):
- `HOST_METHODS.every(m => typeof host[m] === 'function')` — shape del contrato.
- `listWorkspaces()` retorna array donde cada item satisface `WorkspaceInfo` shape.
- `selectWorkspace(ref)` retorna discriminated union `{ok}` (never-throws).
- `isAlive(ref)` retorna boolean (never-throws).
- `needsInput(ref)` retorna boolean (never-throws).

---

### `test/host/cmux-isolation.test.js` (walker structural, new)

**Analog:** `test/format-isolation.test.js`

**Walker de imports transitivo** (líneas 40-51): copiar `walkImports` y `extractImports` literalmente — son helpers puros reutilizables. La invariante LOG-12 ya usa el mismo walker.

**`listJsFiles` recursivo** (líneas 59-71): copiar literal.

**Scope del walker** (D-09):
```js
// Directorios a inspeccionar (análogo a las líneas 99-113 de format-isolation.test.js)
const SCANNED_DIRS = [
  join(SRC, 'cli', 'dashboard'),
  join(SRC, 'session'),
  // src/cli/polling.js si existe en Phase 38
];
```

**Assert pattern** (líneas 108-113):
```js
assert.deepEqual(
  importers,
  ['src/host/cmux.js'],  // única fuente permitida
  `cmux must be imported from EXACTLY ONE file (src/host/cmux.js).\n` +
    `Found importers: ${importers.join(', ')}`,
);
```
Detectar tres formas (D-09): `from '*/cmux/*'`, `require('*/cmux/*'`), literal string `'cmux'` en path imports. Usar regex `/\/cmux[./]/` sobre los specifiers extraídos por `extractImports`.

**Excepciones documentadas** (D-09): `src/host/cmux.js`, `src/cmux/client.js` (helper interno usado SOLO desde `CmuxHost`), `src/cli/dashboard/focus.js` (Phase 37, mantenido). Listar explícitamente en el assert message.

---

### `test/state/migration.test.js` (pure fn migration test, new)

**Analog:** `test/migration.test.js` (líneas 16-86, `describe('state migration', ...)`)

**Estructura de fixtures inline** (líneas 17-31): el estado v2 de fixture se define como objeto literal inline en el describe — no como archivo JSON externo. Para v3, mismo patrón con los nuevos campos del schema (D-04/D-11).

**3 fixtures requeridas** (D-05):
1. `STATE_V2_EMPTY` — `{schema_version:2, sessions:{}, history:[]}`.
2. `STATE_V2_WITH_RECENT_HISTORY` — sesiones con `ended_at` < 30 días Y `workspace_ref` en `liveRefs` → rescate a `idle`.
3. `STATE_V2_NO_HOST` — sesiones con `ended_at` < 30 días Y tab ausente → `dead`.

**Patrón de assert idempotencia** (líneas 68-85):
```js
it('no migra si ya tiene schema_version: 3', () => {
  const v3State = { schema_version: 3, sessions: {}, history: [] };
  const result = migrateStateV3(v3State);
  assert.equal(result.schema_version, 3);
  assert.equal(result, v3State); // same reference — no migration
});
```

**DI del host para rescate** — `migrateStateV3(rawState, hostSnapshot)` donde `hostSnapshot` es el array de `WorkspaceInfo` ya consultado (no `await host.listWorkspaces()` dentro de la función pura). Los tests inyectan el snapshot directamente — zero I/O en la función pura.

---

### `test/host/reconciliation.test.js` (tick-based async, new)

**Analog:** `src/cli/dashboard/usePoll.js` (inyección de `schedule`/`cancel`) + `test/migration.test.js` (pure fn style)

No hay un test de reconciliación existente — este es el archivo con menos análogo directo en el codebase. El patrón más cercano es la inyección de clock en `usePoll`:

**Injectable clock pattern** (`src/cli/dashboard/App.js` líneas 95-99):
```js
// props de INYECCIÓN opcionales para tests:
// now, schedule, cancel, scheduleTimeout, cancelTimeout
```
Para `reconcile()`: la función acepta `{host, state, now, debounceStore}` como parámetros. Los tests inyectan un host fake (`NullHost` con snapshots controlados) y un `now` fake para simular 2 ticks consecutivos del debounce.

**Estructura de test** — copiar el estilo de `test/migration.test.js` (describe + inline fixtures, sin `beforeEach`/`afterEach` async). La reconciliación es una función pura o casi-pura si se inyectan las deps:
```js
describe('reconciliation — idle↔needs-input debounce', () => {
  it('requiere 2 ticks consecutivos para aplicar transición (D-07)', () => {
    const store = new Map(); // debounce store inyectable
    // tick 1
    const s1 = reconcileTick(state, liveRefs, { debounceStore: store, tick: 1 });
    assert.equal(s1.sessions['t1'].state, 'running'); // no cambia aún
    // tick 2
    const s2 = reconcileTick(s1, liveRefs, { debounceStore: store, tick: 2 });
    assert.equal(s2.sessions['t1'].state, 'idle'); // aplica
  });
});
```

---

### `38-HUMAN-UAT.md` (UAT doc, new)

**Analog:** `.planning/phases/37-attach-handoff-cmux/37-HUMAN-UAT.md`

**Frontmatter obligatorio** (líneas 1-13):
```yaml
---
status: pending
phase: 38-workspacehost-lifecycle-idle-needs-input
source: [38-CONTEXT.md D-14]
started: ~
updated: ~
approved_by: ~
approved_at: ~
fixture: scripts/dev-dashboard-fixture.mjs (Phase 36) + /tmp/uat-38-fixture.mjs (ad-hoc)
blocking_for_phase_close: true
obligatorios: 4
bonus: 0
---
```

**Estructura de escenario** (líneas 22-44): cada escenario tiene `setup:`, `steps:` (numerados), `expected:` (bullet points con mensajes literal-estables exactos), `result: pending`, `verified_via: ~`.

**4 escenarios requeridos** (D-14):
1. Re-test Phase 37 Escenario #1 (Focus exitoso) — verificar parity sobre `CmuxHost`.
2. Re-test Phase 37 Escenario #2 (Zombie reject) — verificar parity sobre `CmuxHost`.
3. **Nuevo Escenario A** — idle visible: sesión con `process_alive=false, tab_alive=true, needs_input=false` → badge `⏸ idle`.
4. **Nuevo Escenario B** — needs-input visible: misma + `needs_input=true` → badge `🔔 needs-input`.

**Notas de cierre** (líneas 122-127): copiar bloque literal de Phase 37 adaptando los números de escenarios obligatorios (1-4 en Phase 38 vs 1-2 en Phase 37).

---

### `src/cli/dashboard/format.js` (modify — extend with state badges)

**Analog:** self (`src/cli/dashboard/format.js`)

**Punto de inserción:** después de `statusLabel` (línea 108) y antes de `rowCells` (línea 119). Añadir `STATE_BADGES` y `stateBadge()` sin tocar las funciones existentes.

**Patrón de constante badge** (D-06 literal-stable):
```js
// Extensión Phase 38 D-06: badges por estado del lifecycle (literal-stable).
// Color SOLO via nombre ink string — JAMÁS ANSI (color-isolation D-12 Phase 34).
export const STATE_BADGES = Object.freeze({
  running:       { glyph: '▶', color: 'green',  label: 'running' },
  idle:          { glyph: '⏸', color: 'yellow', label: 'idle' },
  'needs-input': { glyph: '🔔', color: 'cyan',   label: 'needs-input' },
  dead:          { glyph: '✗', color: 'red',    label: 'dead' },
});
```

**`stateBadge(state)` helper** — mismo patrón que `statusColor` (líneas 91-98): retorna el objeto del badge o `{}` como fallback, NUNCA ANSI:
```js
export function stateBadge(state) {
  return STATE_BADGES[state] ?? {};
}
```

**Extensión de `rowCells`** (líneas 119-127): añadir campo `state_badge` al objeto retornado. NO renombrar ni quitar campos existentes — aditividad pura.

**Invariante color-isolation** (D-12): este archivo NO importa `picocolors` ni `src/cli/format.js`. Los nombres de color (`'green'`, `'yellow'`, `'cyan'`, `'red'`) son strings planos que ink convierte internamente. El walker `test/format-isolation.test.js` cubre este archivo automáticamente.

---

### `src/cli/dashboard/SessionTable.js` (modify — add state column)

**Analog:** self (`src/cli/dashboard/SessionTable.js`)

**Punto de inserción 1 — COLS** (línea 29): añadir `state: 14` al objeto `COLS`. No cambiar los anchos existentes para no romper el layout actual.

**Punto de inserción 2 — `countsLabel`** (líneas 64-72): extender el objeto `c` con los nuevos estados:
```js
// Extensión Phase 38 D-06: contar idle/needs-input/dead aparte de running
if (counts.idle > 0) parts.push(`${counts.idle} idle`);
if (counts['needs-input'] > 0) parts.push(`${counts['needs-input']} needs-input`);
if (counts.dead > 0) parts.push(`${counts.dead} dead`);
```
Mantener el orden existente (running, zombie) antes de los nuevos estados.

**Punto de inserción 3 — fila de datos** (líneas 196-217): añadir celda de state badge entre gutter y task_ref. La celda usa `stateBadge(session.state)` de `format.js`:
```js
const badge = stateBadge(session.state ?? session.status ?? '');
cell({ width: COLS.state, text: `${badge.glyph ?? ''} ${badge.label ?? ''}`.trim(),
       color: badge.color, bold: selected, truncate: false }),
```

**Footer-error para errores de host** (D-06, Phase 38): misma estructura que `errorLine` (líneas 160-163). Añadir dos constantes exportadas en `App.js` (ver sección App.js abajo) que `SessionTable` renderiza igual que `FOCUS_ERR_*` de Phase 37.

---

### `src/cli/dashboard/App.js` (modify — multi-state filter + host error constants)

**Analog:** self (`src/cli/dashboard/App.js`)

**Punto de inserción 1 — constantes de error del host** (después de línea 80, donde están `FOCUS_ERR_ZOMBIE`/`FOCUS_ERR_ENOENT`):
```js
// Phase 38 D-06: mensajes literal-estables para errores del host WorkspaceHost.
// Mismo patrón que FOCUS_ERR_* de Phase 37 D-05.
export const HOST_ERR_UNAVAILABLE = '[!] host unavailable — check binary path';
export const HOST_ERR_TIMEOUT = '[!] host timeout — list-workspaces took >5s';
```

**Punto de inserción 2 — `s:active` alias** en el pipeline de filtrado (línea 187):
```js
// Phase 38 D-06: expandir s:active a OR de running|idle|needs-input ANTES de applyFilter.
// applyFilter hace match exacto (r.status === parsed.status), así que el alias se resuelve
// aquí expandiendo la query o filtrando manualmente.
```
El patrón más limpio dado el `applyFilter` actual (match exacto) es un pre-proceso:
```js
const filterQuery = query.replace(/s:active\b/gi, '');
// filtrar manualmente con la condición OR si detectamos s:active
const hasActiveFilter = /s:active\b/i.test(query);
```
O extender `parseFilter` (en `select.js`) para soportar arrays en `status`. Ver `select.js` línea 102 — punto de extensión preferido para mantener la lógica en el helper puro.

**Punto de inserción 3 — `onReconcile` prop** (mismo patrón que `onFocus`, línea 136): inyectable para que `runDashboard` pase la función de reconciliación al `onResult` del poll loop.

---

### `src/cli/dashboard/index.js` (modify — wire reconciliation)

**Analog:** self (`src/cli/dashboard/index.js`)

**Punto de inserción** (después de línea 136 donde se pasa `onFocus`): añadir `onReconcile` como prop a `<App />`. El wire es idéntico al de `onFocus` — lazy import de `src/host/cmux.js`, construir el host con config, pasar como callback:
```js
// Phase 38 D-07: reconciliación por poll tick. Mismo patrón DI que onFocus (Phase 37).
const { createCmuxHost } = await import('../../host/cmux.js');
const host = createCmuxHost({ binary: cmuxBin });
onReconcile: async (state) => reconcileTick(state, await host.listWorkspaces()),
```

**Invariante preservado** (38-CONTEXT.md §Invariants): NO tocar líneas 129/155 (alt-screen toggle), NO tocar el SIGTERM handler (línea 143), NO tocar `waitUntilExit` (línea 149). Solo añadir al objeto de props de `<App />`.

---

### `src/session/manager.js` (modify — `markSessionStatus` nuevos estados + compat shim)

**Analog:** self (`src/session/manager.js`)

**Punto de extensión — firma** (línea 366): extender el JSDoc `@param nextStatus` de:
```js
* @param {'running'|'done'|'error'|'review'|'interrupted'} nextStatus
```
a:
```js
* @param {'running'|'idle'|'needs-input'|'dead'|'closed'|'done'|'error'|'review'|'interrupted'} nextStatus
```

**Compat shim** (D-12): insertar ANTES del guard `!taskId` (línea 371):
```js
// Phase 38 D-12: compat shim 'done' → 'idle'. Eliminado en v0.10.
if (nextStatus === 'done') {
  if (logger) logger.warn('markSessionStatus: DEPRECATED status done mapped to idle', { task_id: taskId });
  nextStatus = 'idle';
}
```

**Patrón de return** (líneas 362-397): no cambia — el discriminated union `{ok:true, from, to}` / `{ok:false, reason}` se conserva intacto. `to` ahora puede ser `'idle'` en lugar de `'done'`.

---

### `src/session/state.js` (modify — schema v2→v3 migration trigger)

**Analog:** self (`src/session/state.js`)

**Patrón de migración existente** (líneas 46-94 — `migrateState` + `migrateStateIfNeeded`):
```js
export function migrateState(rawState) {
  if (rawState.schema_version === 2) return rawState; // idempotencia
  return { schema_version: 2, sessions: {} };
}

function migrateStateIfNeeded() {
  // ...
  if (raw.schema_version === 2) return; // skip si ya migrado
  writeFileSync(STATE_PATH + '.bak', ...); // backup ANTES de migrar
  const newState = migrateState(raw);
  writeFileSync(STATE_PATH, ...);
}
```

**Extensión para v3** — copiar exactamente este patrón:
```js
// Phase 38 D-05: migrateStateV2toV3 — función pura inyectable para tests.
// Acepta hostSnapshot (WorkspaceInfo[]) para decidir rescate vs dead.
export function migrateStateV2toV3(rawState, hostSnapshot = []) {
  if (rawState.schema_version === 3) return rawState; // idempotencia
  // ... lógica de rescate D-04
  return { schema_version: 3, sessions: newSessions, history: newHistory };
}
```

**Backup con timestamp sortable** (D-05): mismo formato que el existente (`state.json.bak`) pero con timestamp:
```js
// Análogo a la línea 91: writeFileSync(STATE_PATH + '.bak', ...)
const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15); // YYYYMMDDTHHMMSS
writeFileSync(STATE_PATH + `.bak.${ts}`, JSON.stringify(raw, null, 2) + '\n');
```

**Typedef `Session` v3** (líneas 11-36): añadir campos aditivos al typedef existente (mismo patrón `@typedef` inline):
```js
*   state?: 'running'|'idle'|'needs-input'|'dead'|'closed',  // Phase 38 D-04/D-11
*   needs_input?: boolean,    // Phase 38 D-11
*   process_alive?: boolean,  // Phase 38 D-11
*   tab_alive?: boolean,      // Phase 38 D-11
*   last_seen_alive?: string, // Phase 38 D-11
```
Todos opcionales (`?`) — campos aditivos, sesiones v2 existentes son válidas sin ellos.

**`loadState()` trigger** (líneas 97-105): `migrateStateIfNeeded()` se llama ya al inicio de `loadState()`. Para v3, añadir `migrateStateV2toV3IfNeeded()` con el mismo patrón — o extender `migrateStateIfNeeded` para cubrir ambas migraciones en secuencia.

---

### `src/gsd/verify.js` (modify — caller migration `'review'` permanece, solo nota)

**Analog:** self, línea 274 exacta.

**Call site** (línea 274):
```js
const result = markSessionStatus(session.task_id, 'review', 'gate-passed', log, session.session_id);
```
`verify.js` rama `pass` usa `'review'`, NO `'done'`. Este call site NO requiere migración a `'idle'` — el status `'review'` se mantiene como estado válido. Solo `stop.js` usa `'done'`.

**Patrón de consumo del return** (líneas 275-280) — NO cambiar:
```js
if (!result?.ok) {
  log.warn('markSessionStatus.skipped', {
    reason: result?.reason,
    session_id: session.session_id,
  });
}
```

---

### `src/hooks/stop.js` (modify — `'done'` → `'idle'`)

**Analog:** self, línea 202 exacta.

**Call site actual** (línea 202):
```js
const result = markSessionStatus(session.task_id, 'done', 'session-stop', log, session.session_id);
```

**Cambio requerido** (D-12):
```js
const result = markSessionStatus(session.task_id, 'idle', 'session-stop:lock-released', log, session.session_id);
```
Cambio quirúrgico de 2 elementos: string `'done'` → `'idle'` y reason `'session-stop'` → `'session-stop:lock-released'` (D-12 caller migration plan). El patrón de consumo del return (líneas 203-208) NO cambia.

---

### `src/logger-events.js` (modify — 4 new NDJSON events)

**Analog:** self, pattern de cualquier helper existente (e.g., `pollingTick` líneas 422-431).

**Patrón de extensión** (D-13): añadir al objeto `EVENTS` (líneas 47-67) las 4 claves nuevas:
```js
HOST_LIST_OK:          'host.list_workspaces.ok',
HOST_LIST_FAIL:        'host.list_workspaces.fail',
HOST_RECONCILE_TICK:   'host.reconcile.tick',
STATE_MIGRATION_V3:    'state.migration.v2_to_v3',
```

**Helper pattern** — copiar el estilo de `pollingTick` (líneas 422-431): JSDoc `@param`, whitelist explícito field-by-field (NO spread), nivel fijo (`info` para ok/tick, `warn` para fail):
```js
export function hostListOk(logger, fields) {
  logger.info(EVENTS.HOST_LIST_OK, {
    event: EVENTS.HOST_LIST_OK,
    count: fields.count,
    duration_ms: fields.duration_ms,
  });
}

export function hostListFail(logger, fields) {
  logger.warn(EVENTS.HOST_LIST_FAIL, {
    event: EVENTS.HOST_LIST_FAIL,
    code: fields.code,
    detail: fields.detail,
    duration_ms: fields.duration_ms,
  });
}

export function hostReconcileTick(logger, fields) {
  logger.info(EVENTS.HOST_RECONCILE_TICK, {
    event: EVENTS.HOST_RECONCILE_TICK,
    rescued: fields.rescued,
    sealed: fields.sealed,
    transitioned: fields.transitioned,
    total: fields.total,
  });
}

export function stateMigrationV3(logger, fields) {
  logger.info(EVENTS.STATE_MIGRATION_V3, {
    event: EVENTS.STATE_MIGRATION_V3,
    from_count: fields.from_count,
    to_sessions: fields.to_sessions,
    to_history: fields.to_history,
    rescued: fields.rescued,
    sealed: fields.sealed,
  });
}
```

**Actualizar el header del archivo** (líneas 1-16): añadir los 4 eventos nuevos a la lista del comentario introductorio. El conteo pasa de 19 → 23 eventos.

**Invariante LOG-12**: este archivo solo importa `node:os` y `node:path` (líneas 23-24). Los 4 nuevos helpers NO añaden imports — cero riesgo de violar LOG-12.

---

## Shared Patterns

### Factory con config + opts.logger

**Source:** `src/providers/plane/provider.js` líneas 23-31
**Apply to:** `src/host/cmux.js`
```js
export function createCmuxHost(config, opts = {}) {
  const logger = opts.logger?.child({ component: 'cmux-host' });
  // caches locales (Map) para isAlive/needsInput de 1-tick
  return { listWorkspaces, selectWorkspace, isAlive, needsInput };
}
```

### Discriminated union never-throws

**Source:** `src/cli/dashboard/focus.js` (Phase 37) + `src/session/manager.js` líneas 362-397
**Apply to:** `src/host/cmux.js` (`selectWorkspace`), `test/host/contract.test.js`
El patrón es `{ok: true, ...}` / `{ok: false, code, detail?}`. `selectWorkspace` re-exporta el resultado de `runFocus` sin transformar.

### Color isolation via `<Text color>` ink

**Source:** `src/cli/dashboard/format.js` líneas 91-98 + `src/cli/dashboard/SessionTable.js` líneas 45-55
**Apply to:** `src/cli/dashboard/format.js` (STATE_BADGES), `src/cli/dashboard/SessionTable.js` (badge cell)
Los nombres de color son strings planos (`'green'`, `'yellow'`, `'cyan'`, `'red'`). Jamás ANSI inline, jamás `picocolors`. El walker `test/format-isolation.test.js` cubre esto automáticamente.

### Compat shim con log.warn + eliminado en vX.Y

**Source:** patrón documental en `src/session/state.js` + `src/session/manager.js`
**Apply to:** `src/session/manager.js` (shim `'done'` → `'idle'`)
El shim vive ANTES del guard `!taskId`. El warn emite `session_id` y `status` para rastrear callers legacy en el NDJSON. Comentario `// Eliminado en v0.10` en el código.

### Literal-stable exported constants

**Source:** `src/cli/dashboard/App.js` líneas 72-80 (`FOCUS_ERR_ZOMBIE`, `FOCUS_ERR_ENOENT`)
**Apply to:** `src/cli/dashboard/App.js` (`HOST_ERR_UNAVAILABLE`, `HOST_ERR_TIMEOUT`)
Exportar las constantes para que los tests importen y aserten sin duplicar strings. Cualquier cambio en el string rompe los tests automáticamente.

### Walker de imports con excepciones documentadas

**Source:** `test/format-isolation.test.js` líneas 98-113
**Apply to:** `test/host/cmux-isolation.test.js`
El assert message lista explícitamente las excepciones permitidas. El test pasa trivialmente si el directorio no existe aún (Wave 0 RED-stub safe).

---

## No Analog Found

Ningún archivo de Phase 38 queda sin análogo. El único caso parcial es `test/host/reconciliation.test.js` que no tiene un test de polling/reconciliación preexistente; el planner debe construirlo desde cero usando el patrón de inyección de clock de `usePoll` + el estilo de test puro de `test/migration.test.js`.

---

## Metadata

**Analog search scope:** `src/`, `test/`, `.planning/phases/37-*`
**Files scanned:** 18 archivos leídos directamente + grep sobre verify.js, stop.js, select.js
**Pattern extraction date:** 2026-05-30
**Invariantes que el planner NO debe violar:**
- Alt-screen toggle `index.js` líneas 129/155 — NO tocar.
- `test/format-isolation.test.js` walker cubre `src/cli/dashboard/` automáticamente — cualquier import de `picocolors` en archivos nuevos del dashboard falla el suite.
- LOG-12: `src/logger-events.js` solo importa `node:os` + `node:path` — los 4 helpers nuevos NO añaden imports.
- `markSessionStatus` es non-throwing por contrato — el compat shim preserva esto.
- `findSession dual-scan` (Phase 30) sigue funcionando — los estados `idle`/`needs-input`/`dead` viven en `state.sessions`, solo `closed` se mueve a `state.history`.
