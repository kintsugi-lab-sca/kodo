# Phase 38 — RESEARCH

> **Researched:** 2026-05-30
> **Domain:** WorkspaceHost provider contract + lifecycle states idle/needs-input + state.json migration v2→v3
> **Confidence:** HIGH (3/3 open questions resueltas empíricamente con `cmux` real en /Applications/cmux.app)
> **Researcher:** gsd-phase-researcher
> **Mode:** standalone (CONTEXT.md ya escrito en `--auto`, este RESEARCH cubre las 3 Open Questions + 7 surveys de implementación)

## Goal of this document

Resolver las **3 Open Questions** de CONTEXT.md (§Open questions) con evidencia empírica capturada en el host real y mapear el código existente (file:line refs) que el planner debe reusar o no romper. El planner consume este doc para no equivocarse en wiring cmux ↔ kodo y para anclar el style guard sin sorpresas.

## User Constraints (from CONTEXT.md)

### Locked Decisions

Las 15 decisiones D-01..D-15 de CONTEXT.md están **locked**. Resumen telegráfico (el planner las debe respetar verbatim):

- **D-01..D-03 contract:** `WorkspaceHost` en `src/host/interface.js`, 4 métodos `[listWorkspaces, selectWorkspace, isAlive, needsInput]`. Shape `WorkspaceInfo = {workspace_ref, alive, needs_input, last_activity}`. `closeWorkspace` deferred.
- **D-04 estados:** 5 estados `running|idle|needs-input|dead|closed`. `running`/`idle`/`needs-input`/`dead` viven en `state.sessions`; solo `closed` en `state.history`. Transición load-bearing: `process exit` → `idle` (NO `done`).
- **D-05 migración:** schema v2 → v3 idempotente, backup `state.json.bak.YYYYMMDD_HHMMSS`, lazy en `loadState()`, NO downgrade automático. Rescate desde `history` para entries < 30 días con tab viva.
- **D-06 dashboard:** badges `▶ running` (green), `⏸ idle` (yellow), `🔔 needs-input` (cyan, emoji deliberado), `✗ dead` (red). Filtros `s:<state>` extensión Phase 36. Footer-error host con `HOST_ERR_UNAVAILABLE` y `HOST_ERR_TIMEOUT`.
- **D-07 reconciliación:** mismo tick que poll (Phase 35), debouncing 2-tick, never-throws.
- **D-08 CmuxHost:** reusa `runFocus` (Phase 37) y `cmux/client.js` como helper interno. Binary path desde `loadConfig().cmux.binary`.
- **D-09 style guard:** walker análogo a `test/format-isolation.test.js` en `test/host/cmux-isolation.test.js`.
- **D-10 Orca/NullHost:** out of scope. NullHost solo en tests.
- **D-11 dimensiones:** SessionRecord v3 expone `state` + `process_alive` + `tab_alive` + `needs_input` + `last_seen_alive`; `alive` se mantiene como derived field por compat.
- **D-12 caller migration:** `markSessionStatus('done', ...)` → `markSessionStatus('idle', ...)` en `verify.js#274` y `stop.js#202`; compat shim `'done' → 'idle'` con warn DEPRECATED hasta v0.10.
- **D-13 NDJSON:** 4 nuevos eventos taxonomy 19→23: `host.list_workspaces.ok|fail`, `host.reconcile.tick`, `state.migration.v2_to_v3`.
- **D-14 UAT:** re-run Phase 37 escenarios + 2 nuevos en `38-HUMAN-UAT.md`.
- **D-15 plans:** 4 plans secuenciales Wave 1→4.

### Claude's Discretion

CONTEXT.md no marcó nada explícito como discretion — todo está locked. El research aplica el sentido del `--auto` audit log para puntos de juicio implícitos (e.g. uso de `notification.list` para derivar `needs_input`).

### Deferred Ideas (OUT OF SCOPE)

- `OrcaHost` impl (Phase 999.3 candidate).
- `kodo close-session <id>` CLI.
- `kodo gsd doctor --clean-host-orphans`.
- Webhook host (cmux events stream subscribe) — investigado solo como fallback de Q3.

## Open Questions Resolved

### Q1. ¿`cmux list-workspaces --json` existe? — **SÍ** [VERIFIED: cmux binary]

**Evidencia:**

```bash
$ /Applications/cmux.app/Contents/Resources/bin/cmux list-workspaces --help
cmux list-workspaces
Usage: cmux list-workspaces [--window <id|ref|index>]
List workspaces in a window.
Flags:
  --window <id|ref|index>   Target window (default: caller/current window)
```

El `--help` NO documenta `--json`, pero el flag **existe** y funciona (es un flag global silencioso de cmux — confirmado también en `cmux docs api` que menciona `cmux identify --json` con la misma convención). Probado:

```bash
$ /Applications/cmux.app/Contents/Resources/bin/cmux list-workspaces --json
{
  "window_ref" : "window:1",
  "workspaces" : [
    {
      "current_directory" : "/Users/alex/dev/klab/kodo",
      "custom_color" : "#283593",
      "description" : null,
      "index" : 0,
      "latest_conversation_message" : "/gsd-discuss-phase 38 --AUTO",
      "latest_submitted_at" : "2026-05-29T22:26:03.108Z",
      "latest_submitted_message" : "/gsd-discuss-phase 38 --AUTO",
      "listening_ports" : [9090],
      "pinned" : true,
      "ref" : "workspace:1",
      "remote" : { ... },
      "selected" : true,
      "title" : "KODO DEV"
    },
    ...
  ]
}
```

**Shape del JSON (top-level):**

```jsonc
{
  "window_ref": "window:1",        // string — el window activo (default cuando no se pasa --window)
  "workspaces": [/* WorkspaceJson[] */]
}
```

**Shape de `WorkspaceJson` (claves observadas):**

| Clave | Tipo | Notas |
|---|---|---|
| `ref` | string | Canonical `workspace:N` — mapea 1:1 al `workspace_ref` del SessionRecord. |
| `index` | int | Posición visual en cmux (0-based). |
| `title` | string | Nombre humano. |
| `selected` | bool | true si es la tab activa en cmux. |
| `pinned` | bool | true si fue pinned. |
| `current_directory` | string | cwd del workspace. |
| `custom_color` | string\|null | Hex (`#283593`) o null. |
| `description` | string\|null | |
| `latest_conversation_message` | string\|null | Último mensaje (texto truncado). |
| **`latest_submitted_at`** | string ISO 8601 \| null | ⚠️ **Esto sirve como `last_activity` (Q3).** |
| `latest_submitted_message` | string\|null | |
| `listening_ports` | number[] | |
| `remote` | object | ssh remote config (anidado, NO necesario para WorkspaceHost). |

**NO hay un campo `needs_input` ni `alive` directos en este JSON.**

**Impacto en Plan 38-01:**

1. ✅ NO se necesita parser textual. El CmuxHost usa `--json` directamente. Parser regex queda **descartado** — el risk flag de CONTEXT.md §Risk flags (último bullet "cmux JSON API uncertainty") está **resuelto**.
2. La normalización a `WorkspaceInfo` (D-03 shape) requiere mapping:
   - `workspace_ref` ← `ref` (verbatim)
   - `alive` ← `true` si `ref` aparece en el array `workspaces` (presencia = tab viva); si NO aparece → `alive: false` (es decir, `dead`).
   - `needs_input` ← derivado de `notification.list` (Q2, ver abajo)
   - `last_activity` ← `latest_submitted_at` (Q3)
3. **Edge case:** el JSON solo retorna workspaces del **window activo** por default (`--window` filtra). Múltiples windows = listas separadas. Hoy kodo asume un único window (no he encontrado un caller que pase `--window`). El Plan 38-01 puede ignorar multi-window por scope — pero el planner debe documentar el assumption en el JSDoc de `CmuxHost.listWorkspaces`.
4. **Latencia medida:** ~50ms por invocación (3 corridas: 51.8 / 50.9 / 49.3 ms). Compatible con el budget del Phase 35 poll (BASE_MS=2500ms) sin colapsar el bucle. Ver §S5.

### Q2. ¿cmux expone `needs_input` (badge 🔔) vía CLI/socket? — **SÍ, indirecto vía `notification.list`** [VERIFIED: cmux binary]

**Evidencia:**

```bash
$ /Applications/cmux.app/Contents/Resources/bin/cmux rpc notification.list
{
  "notifications" : [
    {
      "body" : "Sí, esa es **mejor idea que sacar los discos** ...",
      "created_at" : "2026-05-29T22:28:12Z",
      "id" : "666085D5-8403-48DE-BB6F-990C475C65F0",
      "is_read" : true,
      "subtitle" : "Completed in dev",
      "surface_ref" : "surface:43",
      "tab_title" : "✳ Investigar actividad de disco en NAS Western Digital",
      "title" : "Claude Code",
      "workspace_ref" : "workspace:21"
    },
    {
      "body" : "Claude is waiting for your input",
      "created_at" : "2026-05-29T10:23:32Z",
      "id" : "2F8A715B-94ED-4A24-AA2A-6387398F6E7B",
      "is_read" : true,
      "subtitle" : "Waiting",
      "surface_ref" : "surface:32",
      "tab_title" : "✳ Analizar rentabilidad y oportunidad de mercado para personalchat",
      "title" : "Claude Code",
      "workspace_ref" : "workspace:16"
    }
  ]
}
```

**Hallazgo load-bearing:**

- cmux **NO tiene** un método `workspace.needs_input` directo (`cmux capabilities` confirma: 193 métodos RPC, NINGUNO con substring `need` o `input` salvo `browser.input_*`).
- El badge 🔔 de la GUI cmux deriva de **notificaciones no leídas** (`is_read: false`).
- El "tipo" `needs-input` específico viene de `subtitle: "Waiting"` con `body: "Claude is waiting for your input"`. Este es el patrón que el agente de Claude Code emite cuando se queda esperando humano (vía PreToolUse hook).

**Derivación recomendada para `CmuxHost.needsInput(ref)`:**

```js
// pseudo-código — Plan 38-01 task
async function needsInput(ref) {
  const { notifications } = JSON.parse(await run(['rpc', 'notification.list']));
  return notifications.some(n =>
    n.workspace_ref === ref &&
    !n.is_read &&
    n.subtitle === 'Waiting'  // literal match — el agente Claude emite este subtitle exacto
  );
}
```

**Latencia medida:** ~47ms por `notification.list` (46.3 / 47.9 ms). Misma orden que `list-workspaces --json`.

**Decisión de cacheo (D-08):** `needsInput` debe caché 1-tick (igual que `isAlive`) — invocar dos veces por sesión (uno por `isAlive`, otro por `needsInput`) duplicaría el coste a ~200ms/tick con varias sesiones. **Recomendación:** `CmuxHost.listWorkspaces()` retorna el shape ENRIQUECIDO (incluye needs_input ya computado), y `isAlive`/`needsInput` son helpers que leen del último snapshot cacheado por 1 tick. Esto reduce 1 round-trip socket por tick a 2 totales: `list-workspaces --json` + `notification.list`.

**Alternativa descartada (events stream):** `cmux events --no-heartbeat` ofrece un stream push de eventos `notification.created`, `feed.item.received` con seq#. Esto eliminaría el polling de notifications — pero requiere un long-lived process keep-alive y manejo de reconexión. **Out of scope para Phase 38**. Capturarlo como deferred idea (Phase 999.X — "cmux events stream subscribe para eliminar debouncing").

**Impacto en Plan 38-01:**
- `CmuxHost.listWorkspaces()` invoca AMBOS comandos en paralelo (`Promise.all`) y mergea por `workspace_ref`. Total budget: ~50ms (paralelo, no 100ms secuencial).
- `needs_input` queda como campo confiable del WorkspaceInfo — NO es dead-letter como el CONTEXT.md §Open Q#2 sugería como fallback.

**Impacto en Plan 38-03:** el badge `🔔 needs-input` de D-06 SÍ se renderiza para cmux desde el día uno. UAT Escenario B de D-14 (forzar el badge en cmux) es viable.

### Q3. ¿cmux expone `last_activity`? — **SÍ, vía `latest_submitted_at`** [VERIFIED: cmux binary]

**Evidencia:** ya visto en Q1. Cada workspace JSON contiene `latest_submitted_at: "2026-05-29T22:26:03.108Z"` (ISO 8601 UTC con milisegundos). Es el timestamp del último mensaje submited por el usuario al agente — semánticamente equivale al concepto `last_activity` de la spec D-03.

**Edge case:** workspace con cero actividad (recién creado, nunca submited) tiene `latest_submitted_at: null`. El CmuxHost debe propagar `null` literal al `WorkspaceInfo.last_activity` y el dashboard hace fallback al `started_at` del SessionRecord (D-03 último párrafo).

**Impacto en Plan 38-01:** mapeo directo, cero parsing extra.

**Impacto en Plan 38-03:** el dashboard puede usar `last_activity` para sortear las sesiones `idle` por reciente. NO está locked en D-04/D-06 — recomendación opcional.

## Implementation Survey

### S1. Patrones de migración state.json existentes

**Encontrado en:** `/Users/alex/dev/klab/kodo/src/session/state.js:39-94`

```js
// state.js:46-52 — migrateState (pure function)
export function migrateState(rawState) {
  if (rawState.schema_version === 2) return rawState;
  return {
    schema_version: 2,
    sessions: {},        // ⚠️ CRÍTICO: la migración v1→v2 BORRA sessions
  };
}

// state.js:81-94 — migrateStateIfNeeded (lazy, I/O)
function migrateStateIfNeeded() {
  if (!existsSync(STATE_PATH)) return;
  let raw;
  try {
    raw = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch { return; }
  if (raw.schema_version === 2) return;
  writeFileSync(STATE_PATH + '.bak', JSON.stringify(raw, null, 2) + '\n');
  const newState = migrateState(raw);
  writeFileSync(STATE_PATH, JSON.stringify(newState, null, 2) + '\n');
  console.log('[kodo] State migrado a schema_version 2 (backup: state.json.bak)');
}
```

**Confirmado por test:** `/Users/alex/dev/klab/kodo/test/migration.test.js:62-66` — `STAT-04: 'limpia las sesiones activas durante migración'` asegura `migrated.sessions = {}` post-v1→v2.

⚠️ **Anti-pattern para Phase 38:** la migración existente es **destructive** (clear de sessions). El D-05 de CONTEXT.md MANDA el contrario para v2→v3 (preservar + rescatar). **El planner NO debe copiar este patrón.** La migración v2→v3 debe:

1. **Preservar** todos los SessionRecords existentes en `state.sessions` con su shape — solo añadir los nuevos campos (`state`, `process_alive`, `tab_alive`, `needs_input`, `last_seen_alive`) como dimensiones derivadas:
   - `state` derivado del `status` actual: `running` → `running`; `done` → `idle` (compat shim D-12); `error` → `dead`; `review` → `idle`.
   - `process_alive` = `(status === 'running')`.
   - `tab_alive` = ❓ — no se sabe en tiempo de migración. **Recomendación:** `false` por default y dejar que el primer poll-tick de reconciliación (D-07) lo actualice.
   - `needs_input` = `false` por default.
   - `last_seen_alive` = `null` por default.
2. **Rescatar** entries de `state.history` con `ended_at < 30 días` cuya `workspace_ref` siga apareciendo en `host.listWorkspaces()` — pero ⚠️ la migración corre **lazy en `loadState()`**, ANTES del primer poll-tick → en ese momento NO hay acceso al host (lazy DI conflict). **Recomendación:** la migración pura solo bumpea schema + derive states; el rescate desde history se ejecuta como **primer tick de reconciliación post-migración** (D-07 step 3), no inline en la migración.
3. **Backup naming:** la migración v1→v2 usa `state.json.bak` (single overwrite). D-05 v2→v3 manda timestamped `state.json.bak.YYYYMMDD_HHMMSS` para no destruir backups anteriores. Pattern para el planner: usar `Date.now()` + formato `toISOString().replace(/[:.]/g, '').slice(0, 15)` o equivalent.

**Idempotencia:** la guarda `if (raw.schema_version === 2) return` es el patrón mínimo. v2→v3 debe usar `if (raw.schema_version === 3) return` con la MISMA semántica.

### S2. `markSessionStatus` callers — inventory completo

**Encontrados via grep:**

| Archivo:línea | Llamada | Estado D-12 |
|---|---|---|
| `src/gsd/verify.js:274` | `markSessionStatus(session.task_id, 'review', 'gate-passed', log, session.session_id)` | **NO afectado** — `'review'` queda igual (no es `'done'`). D-12 CONTEXT.md cita esta línea pero la lectura del código real muestra que verify ya emite `'review'`, NO `'done'`. **El planner debe corregir el CONTEXT.md aquí o validar conmigo en pre-plan**. Ver §Risk Update. |
| `src/hooks/stop.js:202` | `markSessionStatus(session.task_id, 'done', 'session-stop', log, session.session_id)` | **SÍ afectado** — `'done'` → `'idle'` con reason `'session-stop:lock-released'` (D-12 textual). |

**No hay otros call sites en producción.** Tests sí (5 archivos: `test/stop.test.js`, `test/stop-state-transition.test.js`, `test/gsd-verify-integration.test.js`, `test/session/mark-status.test.js`, `test/stop-worktree-cleanup.test.js`) — todos los fixtures requieren update para los nuevos estados.

**Compat shim `'done' → 'idle'`:** ubicarlo dentro de `markSessionStatus` (file `src/session/manager.js:366`), antes del `if (!taskId)` guard:

```js
// pseudo
export function markSessionStatus(taskId, nextStatus, reason, logger, sessionId) {
  if (nextStatus === 'done') {
    logger?.warn('markSessionStatus.deprecated', {
      input_status: 'done',
      mapped_to: 'idle',
      session_id: sessionId || 'unknown',
      reason,
    });
    nextStatus = 'idle';
  }
  // ... resto del cuerpo intacto
}
```

**Plan 38-02 task wiring:** el shim VA en una línea, pero el caller de `stop.js:202` debe actualizarse ADEMÁS para emitir el reason correcto `'session-stop:lock-released'` — no basta con dejar el shim hacer el trabajo (el reason es load-bearing para observabilidad).

### S3. Test fixture pattern para state migration

**Encontrado en:** `/Users/alex/dev/klab/kodo/test/migration.test.js:16-86` (describe block `'state migration'`).

**Pattern observado:**

```js
const OLD_STATE = {
  sessions: { /* shape v1 sin schema_version */ },
};
it('STAT-XX desc', () => {
  const migrated = migrateState(OLD_STATE);
  assert.equal(migrated.schema_version, 2);
  // ... asserts específicos
});
```

**Recomendación para `test/state/migration.test.js` (Plan 38-02):**

3 fixtures como D-05 manda:
- **F1:** state v2 vacío (`{schema_version: 2, sessions: {}, history: []}`) → asserta migración a v3 sin cambios efectivos (los 5 nuevos campos NO se materializan en sessions porque no hay sessions).
- **F2:** state v2 con `sessions` running + `history` reciente cubierta por `host.listWorkspaces()` mock → asserta:
  - `sessions[taskId].state === 'running'` (preserved),
  - `sessions[taskId].process_alive === true`,
  - `sessions[taskId].tab_alive === false` (default — el rescate vive en reconciliación, NO en migración pura).
  - El rescate desde history a sessions con state `idle` debe ser un test SEPARADO contra el reconciliador de D-07, NO contra `migrateState`. Esto mantiene `migrateState` puro.
- **F3:** state v2 con `sessions` con `status: 'done'` (caso degenerate degenerate — `markSessionStatus('done')` legacy quedó en sessions) → asserta el mapping legacy `done → idle` con reason `'migration:done-legacy'`. (Detail mainly tested via the compat shim, but the fixture documents the path.)
- **F4 (idempotence):** invocar `migrateState(migrateState(f2))` y assertar que el segundo call es no-op (referencia idéntica o deep-equal según el patrón ya usado en `migration.test.js:68-85`).

**Backup test:** `migrateStateIfNeeded` (la versión con I/O) requiere su propio test con `tmpdir` fixture (mismo idiom que `test/state/find-session.test.js` líneas 101+).

### S4. Walker pattern (`test/format-isolation.test.js`)

**Encontrado en:** `/Users/alex/dev/klab/kodo/test/format-isolation.test.js:1-220`.

**Mecanismo:**

```js
// líneas 15-16 — dos regex para cubrir las formas ESM
const IMPORT_FROM_RE = /^\s*(?:import|export)\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm;
const IMPORT_BARE_RE = /^\s*import\s+['"]([^'"]+)['"]/gm;

// líneas 40-52 — walkImports recursivo, solo specifiers relativos (./x.js, ../y.js)
function walkImports(entry, visited = new Set()) { /* ... */ }

// líneas 59-71 — listJsFiles para escaneo flat de un directorio
function listJsFiles(dir) { /* ... */ }
```

**Tests existentes (referencia para mirror):**

- `'src/cli/format.js does not import src/logger.js transitively'` (LOG-12 extension, líneas 73-96) — usa `walkImports` desde un entry point.
- `'only src/cli/format.js imports picocolors (single source of color)'` (D-07/D-08, líneas 98-129) — usa `listJsFiles(SRC)` flat.
- `'ningún archivo de src/cli/dashboard/ importa picocolors'` (TUI-04 D-13, líneas 199-220) — pattern DIRECTO a copiar para Phase 38 D-09.

**Adaptación para `test/host/cmux-isolation.test.js`:**

```js
// pseudo, espejo del bloque D-13 (líneas 199-220)
describe('Phase 38 SC#5 (cmux-isolation): cero refs a cmux/ fuera de src/host/cmux.js', () => {
  it('ningún archivo de src/cli/dashboard/ importa src/cmux/*', () => {
    const dashFiles = listJsFiles(SRC).filter(f => f.includes('/cli/dashboard/'));
    const leakers = dashFiles
      .filter(f => extractImports(readFileSync(f, 'utf-8')).some(s => /\/cmux\//.test(s)))
      .map(f => relative(REPO, f));
    assert.deepEqual(leakers, [], `Leak: ${leakers.join(', ')}`);
  });
  it('src/session/ no importa src/cmux/* (excepto cmux/colors.js)', () => { /* idem */ });
  it('src/cli/polling.js no importa src/cmux/*', () => { /* idem */ });
});
```

**Excepciones documentadas (D-09):**
- `src/host/cmux.js` puede importar `src/cmux/client.js` (delegation).
- `src/cli/dashboard/focus.js` ya existe (Phase 37) y NO importa `cmux/` — usa execFile inyectado. Test SC#5 sigue verde si el walker excluye explícitamente `src/host/` del scope (que es el único path donde cmux puede vivir).

⚠️ **Edge case que el walker debe cubrir:** `src/session/manager.js:6` y `src/session/health.js:4` AMBOS importan `'../cmux/client.js'` HOY. El Plan 38-01 debe refactorizar ambos para que pasen a `getHost('cmux')` antes de que el walker pase verde. Si el walker se añade en Plan 38-01 ANTES de refactorizar manager/health, el test falla rojo y bloquea el plan. **Orden secuencial obligatorio dentro del Plan 38-01:** primero refactor de los 2 callers, después añadir el walker test. Documentar como W-1 hard-blocking.

**Otros leak sites encontrados hoy (a refactorizar en Plan 38-01):**

| Archivo:línea | Llamada actual | Refactor target |
|---|---|---|
| `src/session/manager.js:6,7` | `import * as cmux from '../cmux/client.js'; import { colorForStatus } from '../cmux/colors.js'` | Mantener `colorForStatus` (es pure helper, no leak); reemplazar `cmux.*` por `getHost('cmux').*` |
| `src/session/manager.js:217,223,269,272,280` | `cmux.newWorkspace / setColor / send / notify / listWorkspaces` | `newWorkspace/setColor/send/notify` siguen siendo Cmux-specific (no migran al contract D-03; quedan en `cmux/client.js`). SOLO `cmux.listWorkspaces` (línea 280) migra a `host.listWorkspaces()`. Las demás son out-of-scope del WorkspaceHost contract — los plans NO las tocan. |
| `src/session/health.js:4-5,33` | `import * as cmux ... cmux.listWorkspaces()` | Reemplazar por `host.listWorkspaces()`. |
| `src/server.js:9,378` | `import * as cmux ... cmux.listWorkspaces()` | **server.js NO está en la lista del walker** (SC#5 cubre `src/cli/dashboard/`, `src/session/`, `src/cli/polling.js`). El leak está fuera del scope hard. Recomendación opcional: refactorizar también, pero es Plan 38-01 stretch. |
| `src/hooks/stop.js:84,407` | `cmuxClient.listWorkspaces()` | NO está bajo `src/cli/dashboard/` ni `src/session/` ni `src/cli/polling.js` — fuera del walker. Same as server.js. |
| `src/orchestrator/launch.js:136` | `cmux.listWorkspaces()` | NO está bajo los 3 paths del walker. Fuera de scope hard. |
| `src/triggers/dispatcher.js:47,353` | `cmux.listWorkspaces()` (DI-zable vía `listWorkspacesFn`) | NO está bajo los 3 paths del walker. Fuera de scope hard. |

**Conclusion:** el walker SC#5 (D-09) solo debe cubrir las 3 carpetas listadas en CONTEXT.md (dashboard, session, polling.js). Los demás callers (server.js, stop.js, launch.js, dispatcher.js) son leak legítimo HOY pero fuera del scope hard — el planner debe decidir si los incluye en plans stretch o los punt al backlog. **Recomendación:** punt al backlog (1 line item por archivo) y mantener el alcance del Phase 38 estricto.

### S5. Cadencia poll + budget `listWorkspaces`

**Encontrado en:** `/Users/alex/dev/klab/kodo/src/cli/dashboard/usePoll.js:44-48`.

```js
const BASE_MS = 2500;          // poll cadence default
const MAX_MS = 10000;          // backoff cap
const TICK_TIMEOUT_MS = 5000;  // timeout fetch por tick
```

**Coste medido de cmux invocations:**

| Comando | Latencia (3 runs) |
|---|---|
| `cmux list-workspaces --json` | 51.8 / 50.9 / 49.3 ms |
| `cmux rpc notification.list` | 46.3 / 47.9 ms |

**Budget análisis:**

- Hoy, `usePoll` invoca `fetchStatus` que llama a `GET /status` del kodo server, que A SU VEZ invoca `cmux.listWorkspaces()` (server.js:378) — ya hay un ~50ms cmux call por tick HOY.
- Post-Phase 38, el server (o el polling tick directo si D-07 mueve la reconciliación al cliente) invocará 2 comandos cmux (`list-workspaces --json` + `notification.list`) → ~100ms secuencial o ~50ms paralelo.
- Con `Promise.all` paralelizado, el budget total por tick es ~50ms — sin regression respecto a HOY.

**Recomendación load-bearing:** `CmuxHost.listWorkspaces()` invoca AMBOS comandos en paralelo con `Promise.all`:

```js
const [wsJson, notifJson] = await Promise.all([
  run(['list-workspaces', '--json']),
  run(['rpc', 'notification.list']),
]);
```

El timeout 5s (D-08) cubre ambos en paralelo. Si uno falla, el host emite `host.list_workspaces.fail` con el shape `{code, detail, duration_ms}` (D-13) y retorna array vacío para no romper el reconciliador downstream.

**No hay riesgo de bottleneck.** El polling actual ya paga el coste; Phase 38 lo mantiene constante.

### S6. SessionTable.js render cost

**Encontrado en:** `/Users/alex/dev/klab/kodo/src/cli/dashboard/SessionTable.js:1-227`.

**Render flow:**

- Componente presentational puro (`/* dumb: recibe la lista YA ordenada+filtrada */`, comment líneas 6-7).
- Recibe `rows`, `selectedIndex`, `counts`, `connected`, etc. como props.
- Render cost: 1 `LiveIndicator` + 1 `Text` header + 1 `Box` per row (con 6 `cell` calls).
- React memoization: **NO hay `React.memo`, `useMemo`, ni `useCallback` en este componente.** Hot-path al cambiar selectedIndex → re-render full tree.
- Color por status via `statusColor(s.status, s.alive)` (líneas 200, 214) — el wrapper retorna `{color, dim}`.

**Impacto de los 4 estados nuevos (D-06):**

1. **`statusColor` extensión:** el helper en `src/cli/dashboard/format.js` (no leído aquí, pero importado en SessionTable.js:25) debe aceptar los nuevos status. Map:
   - `running` → green (existe)
   - `idle` → yellow (nuevo)
   - `needs-input` → cyan (nuevo)
   - `dead` → red (nuevo, OR reusar el existing 'red' del zombie)
   - `review` / `done` / `error` → legacy, preservado.
2. **`countsLabel`** (SessionTable.js:64-72) — añadir entries para `idle`, `needs-input`, `dead` en el counter compacto del header (D-11 Phase 36).
3. **Badge glyph rendering:** D-06 manda glyphs explícitos (`▶ idle`, `⏸ idle`, `🔔 needs-input`, `✗ dead`). Hoy `SessionTable` solo muestra `status` en una celda — no hay columna de badge. El planner debe decidir si: (a) reemplaza el contenido de la celda `status` por `{glyph} {status}`, o (b) añade columna gutter-extra antes de `task_ref`. **Recomendación (a)** — menor blast radius en COLS shape. La celda `status` width=18 chars cabe `🔔 needs-input` (14 chars).
4. **Filtros `s:<state>` (D-06):** el parser de filtro vive en `src/cli/dashboard/select.js#parseFilter` (Phase 36 — no leído aquí pero referenced en App.js:61). El planner debe extender el parser para reconocer `s:running|idle|needs-input|dead|active`. El alias `s:active` (D-06) es `running OR idle OR needs-input`. **Plan 38-03 task.**

**Memoization:** NO se necesita añadir `React.memo` por Phase 38 — el render actual ya es flat y la lista de sesiones típica es <20. Si hay regression de render visible en UAT, hacer follow-up.

### S7. `runFocus` reuse path (D-08)

**Encontrado en:** `/Users/alex/dev/klab/kodo/src/cli/dashboard/focus.js:54-118`.

**Signature:**

```js
export const FOCUS_VERB = 'select-workspace';
export const FOCUS_FLAG = '--workspace';

export function runFocus({ exec, ref, binary, timeoutMs = 5_000 }) {
  // returns Promise<{ ok: true } | { ok: false, code: 'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail }>
}
```

**Características críticas:**

- `exec` es **REQUIRED** — no default, leak guard estructural (líneas 85-90). Si el caller no lo inyecta, lanza `TypeError` sincrónicamente (NO se degrada al SPAWN_ERROR).
- `binary` también required (línea 75 JSDoc: "path al binario cmux, resuelto por el caller vía loadConfig().cmux.binary").
- Timeout default 5s (D-07 Phase 37).
- Discriminated union return — patrón espejo de `fetchStatus` (Phase 35 D-07).

**DI shape para `CmuxHost.selectWorkspace`:**

`CmuxHost` debe ser instanciable con un `exec` injectable y `binary` resuelto desde config. Recomendación del shape de constructor (Plan 38-01):

```js
// src/host/cmux.js
export function createCmuxHost({ exec, binary, run }) {
  return {
    async listWorkspaces() { /* run(['list-workspaces', '--json']) + run(['rpc', 'notification.list']) */ },
    async selectWorkspace(ref) {
      return runFocus({ exec, ref, binary });  // ← REUSO DIRECTO, never-throws shape preservado
    },
    async isAlive(ref) { /* cache 1-tick + lookup en último snapshot */ },
    async needsInput(ref) { /* cache 1-tick + lookup en último snapshot */ },
  };
}
```

`exec` viene de `(await import('node:child_process')).execFile` en runtime. `binary` viene de `loadConfig().cmux.binary` (existe en src/config.js — el path default es `/Applications/cmux.app/Contents/Resources/bin/cmux`, ver config.js:213+).

**Cero cambios en `focus.js`:** Phase 37 dejó el módulo estable. El wiring de `App.js#onFocus` (Phase 37 D-01) NO cambia — sigue siendo `runDashboard` quien construye el callback. La diferencia es que en Phase 38, el callback se construye llamando `host.selectWorkspace` en vez de `runFocus` directamente:

```js
// pseudo — runDashboard (src/cli/dashboard/index.js, no leído pero documentado en App.js:34-46)
import { getHost } from '../../host/interface.js';
const host = getHost('cmux');
<App ... onFocus={(ref) => host.selectWorkspace(ref)} />
```

El shape `{ok: true} | {ok: false, code, detail}` que retorna `selectWorkspace` es **idéntico** al de `runFocus` — porque `selectWorkspace` lo delega. Zero changes en `App.js#handleFocusResult`.

**Wave 1 task ordering load-bearing dentro de Plan 38-01:**
1. Crear `src/host/interface.js` con `HOST_METHODS` + `getHost` + typedef `WorkspaceHost`.
2. Crear `src/host/cmux.js` con `createCmuxHost` (delega a runFocus para selectWorkspace).
3. Refactor `src/session/manager.js:280` (`cmux.listWorkspaces`) a `host.listWorkspaces` (mantiene `cmux.newWorkspace`, `cmux.send`, etc. — solo migra el ÚNICO método que el contract D-03 cubre).
4. Refactor `src/session/health.js:33` (`cmux.listWorkspaces`) a `host.listWorkspaces`.
5. Refactor `src/cli/dashboard/index.js` (runDashboard) para construir `host` y pasarlo a App.js via DI o module-level singleton.
6. AÑADIR el walker test SC#5 (last, una vez los 3 callers son verde).
7. AÑADIR contract test `test/host/contract.test.js` (mirror de `test/providers/contract.test.js`).

Si el walker se añade antes de los refactors → falla rojo + bloquea. Documentar este orden en Plan 38-01 SUMMARY.

## Pitfalls and Gotchas

- **P-1 (load-bearing):** la migración v1→v2 existente es **destructive** (clear sessions). NO copiarla para v2→v3 — la spec D-05 manda preservar. Ver §S1.
- **P-2 (CONTEXT-bug):** D-12 cita `verify.js#finalize rama pass` como caller de `markSessionStatus('done', ...)`. La realidad es que `verify.js:274` ya emite `'review'`, NO `'done'`. **El único caller real de `'done'` es `stop.js:202`.** El planner debe validar esta discrepancia (con human o pre-plan checklist) y NO migrar `verify.js` innecesariamente. Ver §S2.
- **P-3 (race):** la migración corre lazy en `loadState()`. Múltiples procesos kodo arrancando simultáneamente (e.g. daemon polling + dashboard) pueden disparar 2 backup files con timestamps cercanos. La idempotencia (`if schema_version === 3 return`) protege contra corruption, pero el segundo proceso escribirá un backup redundante. **Recomendación:** lock file `~/.kodo/state.migration.lock` con flock o equivalente. Punt si Phase 38 no quiere añadir filesystem locking — la corruption es imposible, solo backup ruido.
- **P-4 (cmux JSON sin window default):** `cmux list-workspaces --json` SIN `--window` retorna solo el window activo del caller. Si el usuario tiene N windows con workspaces de diferentes proyectos, kodo solo ve uno. El SessionRecord no almacena `window_ref` HOY → no se puede pasar el flag correcto. **Recomendación:** documentar como known limitation. Out-of-scope hard de Phase 38.
- **P-5 (notification.list scope):** `notification.list` retorna TODAS las notifications del binary cmux (cross-window). NO filtra por window. Al cruzar con workspace_ref hay match correcto si los refs son globalmente únicos (lo son — `workspace:N` es global a cmux, no per-window). ✓ Sin riesgo.
- **P-6 (cmux binary path drift):** el path `/Applications/cmux.app/Contents/Resources/bin/cmux` puede no existir en CI/Linux. El existing `getCmuxBinary()` (`src/cmux/client.js:5-7`) lee de `loadConfig().cmux.binary`. El CmuxHost debe seguir el mismo patrón. ✓ Sin riesgo si `loadConfig` se respeta.
- **P-7 (`needs_input` literal match fragile):** la derivación de `needs_input` depende de `subtitle === 'Waiting'`. Si cmux cambia el literal de la notification (versión futura) — silent break. **Mitigación:** documentar el assumption como locked en JSDoc de `CmuxHost.needsInput`, añadir test contract con fixture JSON capturado del cmux real. El test rompe loud si cmux cambia el literal en una versión futura.
- **P-8 (debouncing fragility):** D-07 manda 2-tick debouncing. El reconciliador debe mantener un `Map<workspace_ref, {lastState, ticksAtState}>` per session. Reseteo del Map al cambiar window (P-4 edge) puede causar drift. **Mitigación:** documentar en el contract test `test/host/reconciliation-debounce.test.js` (Plan 38-04). Out-of-scope para Plan 38-01.
- **P-9 (test fixture rot):** los 5 archivos de test que llaman `markSessionStatus` con `'done'` deben actualizarse en Plan 38-02 (no Plan 38-01). El planner debe listar las 5 ubicaciones como tasks en Plan 38-02 SUMMARY explícitamente.
- **P-10 (alt-screen drift):** el comment en `App.js:41` reserva `Esc` para overlays de "Phase 38". Si Plan 38-03 añade un overlay/panel que consume Esc, mantener el comportamiento documentado allí. NO emerge de la spec actual de Phase 38 — chequear si es residuo de la antigua planificación pre-renumber `536ad1d`. Probable falso positivo, pero documentar.

## Patterns to Follow (cross-reference)

| Patrón | Archivo:línea | Uso en Phase 38 |
|---|---|---|
| TaskProvider 9-method contract test (loop providers × asserts) | `test/providers/contract.test.js:36-467` (especialmente loop líneas 369-466) | Espejo para `test/host/contract.test.js` (loop CmuxHost + NullHost × 4 asserts D-03). |
| never-throws discriminated union | `src/cli/dashboard/focus.js:80-118` (runFocus) | Patrón EXACTO para `CmuxHost.selectWorkspace` (D-08 reuso directo). `CmuxHost.listWorkspaces` debe seguir mismo patrón `{ok, code, detail}` ante fallo cmux. |
| HOST_METHODS array + validation | `src/interface.js` (TASK_PROVIDER_METHODS) | Espejo `HOST_METHODS = ['listWorkspaces', 'selectWorkspace', 'isAlive', 'needsInput']` en `src/host/interface.js`. |
| Provider registry singleton lazy | `src/providers/registry.js:1-80` | `src/host/registry.js` (si el planner decide registry-style) o `getHost(name)` standalone simple — D-03 manda el simpler. |
| Walker estructural color-isolation | `test/format-isolation.test.js:199-220` (TUI-04 D-13 block) | Copy directo para `test/host/cmux-isolation.test.js`. Solo cambiar el regex `picocolors` por `/\/cmux\//` y el scope a 3 directorios. |
| State migration idempotente | `src/session/state.js:46-52` (estructura) y `:81-94` (lazy I/O) | Pattern de STRUCTURE preservar; PERO NO COPIAR el clear `sessions: {}`. v2→v3 debe preservar sessions y añadir nuevos campos. |
| State migration fixture | `test/migration.test.js:16-86` | Pattern de fixtures (OLD_STATE const + assertion shape). Reusar para `test/state/migration.test.js`. |
| Session record updates non-destructive | `src/session/state.js:158-168` (updateSession) | Las dimensiones nuevas (process_alive/tab_alive/...) deben usar `Object.assign` patrón existente, NO replace. |
| markSessionStatus non-throwing contract | `src/session/manager.js:366-397` | El shim `'done' → 'idle'` debe ir DENTRO de esta función, antes del guard. Discriminated union return preservado. |
| Lazy DI dynamic import | `src/hooks/stop.js:196` (`await import('../session/manager.js')`) | Pattern para evitar LOG-12 walker breaks. El planner debe verificar que `src/host/cmux.js` NO importe loger directamente (LOG-12 walker). |
| Logger event taxonomy expansion | `src/logger-events.js` (no leído aquí pero referenced en stop.js:218) | Donde añadir los 4 nuevos eventos D-13 (`host.list_workspaces.ok|fail`, `host.reconcile.tick`, `state.migration.v2_to_v3`). |
| alt-screen toggle preservation | `src/cli/dashboard/index.js:129/155` (referenced en CONTEXT.md §Invariants) | NO MUTAR — Phase 38 NO toca el alt-screen wire. Plan 38-03 puede añadir badges al render pero NO cambia el toggle. |
| Phase 37 UAT format | `.planning/phases/37-*/37-HUMAN-UAT.md` (existe — referenced en CONTEXT.md D-14) | Frontmatter `passed`/`approved_by`/`approved_at` debe copiarse para `38-HUMAN-UAT.md`. |

## Risk Update

Carry-over de CONTEXT.md §Risk flags + nuevos discovered:

| Risk | From | Severity | Mitigación documentada |
|---|---|---|---|
| **R-1** Migración state.json destructive si schema bump no idempotente | CONTEXT D-05 | Tier 3 | Backup automático ANTES + idempotencia + 3-fixture test (§S3). |
| **R-2** Reconciliación flicker idle↔running | CONTEXT D-07 | Tier 2 | Debouncing 2-tick + test `test/host/reconciliation-debounce.test.js` (§Pitfall P-8). |
| **R-3** `'done' → 'idle'` rompe test fixtures legacy | CONTEXT D-12 | Tier 2 | Compat shim + warn DEPRECATED hasta v0.10 (§S2). 5 archivos test a update en Plan 38-02 (§P-9). |
| **R-4** cmux JSON API uncertainty | CONTEXT §Risk flags | Tier 1 | **RESUELTO** — `--json` existe y funciona (§Q1). Parser textual descartado. |
| **R-5 NUEVO** Walker SC#5 falla en Plan 38-01 si añadido antes del refactor de manager/health | §S4 + §S7 W-1 | Tier 2 | Orden secuencial estricto dentro de Plan 38-01: refactor → walker. Documentar como W-1 hard-blocking en SUMMARY del Plan. |
| **R-6 NUEVO** CONTEXT D-12 cita `verify.js#finalize rama pass` como caller de `'done'` — empíricamente es `'review'` | §S2 + §P-2 | Tier 1 | Validar con human o pre-plan checklist. Si efectivamente verify ya emite `'review'`, D-12 sobre verify.js es no-op. NO descopa el work; solo aclara que el shim cubre solo `stop.js:202`. |
| **R-7 NUEVO** `needs_input` literal match `subtitle === 'Waiting'` es fragile | §Q2 + §P-7 | Tier 2 | Test contract con fixture JSON real. Documentar el assumption en JSDoc de `CmuxHost.needsInput`. |
| **R-8 NUEVO** Race condition migración en arranques paralelos | §P-3 | Tier 3 | Idempotencia previene corruption. Backup ruido es cosmético. Punt o flock — decisión del planner. |
| **R-9 NUEVO** cmux multi-window: kodo solo ve workspaces del window activo | §P-4 | Tier 2 | Known limitation, out-of-scope. Documentar en `38-HUMAN-UAT.md` precondiciones (usuario debe correr el dashboard desde el mismo window que las tabs kodo). |

## Recommendations for Planner

1. **Orden de plans (NO cambia D-15):** 38-01 → 38-02 → 38-03 → 38-04 secuencial. Wave 1→4. Cada plan debe shipear independientemente sin romper la suite.

2. **Plan 38-01 estructura interna load-bearing (W-1):** refactor 2 callers (`manager.js`, `health.js`) **antes** de añadir el walker test SC#5. El planner debe documentar este orden como hard-blocking en el SUMMARY del Plan 38-01.

3. **Plan 38-02 caller migration tasks explícitas:** lista los 5 archivos test que llaman `markSessionStatus('done')` como tasks separadas en el SUMMARY. Pre-plan checklist debe verificar la discrepancia D-12 vs realidad de verify.js (R-6) antes de iniciar.

4. **Plan 38-03 filtros + badges (D-06):** ampliar el parser de `select.js#parseFilter` para `s:<state>` con alias `s:active`. Update `statusColor` y `countsLabel` en SessionTable.js (§S6).

5. **Plan 38-04 reconciliación:** el rescate desde history a sessions vive AQUÍ (no en migración pura). Migración pura solo bumpea schema + deriva states.

6. **Donde NO tocar:** `cmux.newWorkspace/send/setColor/notify/rename` siguen en `cmux/client.js`. Solo `cmux.listWorkspaces` se migra al contract. El WorkspaceHost cubre lifecycle observation, NO management. Esto preserva el alcance del Phase 38 y deja `OrcaHost` libre para implementar los mismos 4 métodos sin asumir Cmux-specific create/send.

7. **Donde NO añadir overhead:** SessionTable.js NO necesita `React.memo` hoy. Si la UAT muestra render lag, follow-up post-ship.

8. **Documenta el `needs_input` literal match:** el JSDoc de `CmuxHost.needsInput` debe decir explícitamente: *"Mapping derivado de notification.list con subtitle === 'Waiting'. Si cmux cambia este literal en versiones futuras, este host requiere actualización — el test contract con fixture JSON real lo detectará."*

9. **Capturar el fixture real:** añadir `test/fixtures/cmux/list-workspaces.json` y `test/fixtures/cmux/notification-list.json` con capturas del cmux real (ya capturados en este research — el planner los puede pegar verbatim desde Q1 y Q2). Sirven como golden-byte para tests y como evidencia de la API observed-as-of-2026-05-30.

10. **NO añadir flock para race condition migración (P-3 / R-8):** la idempotencia ya previene corruption. Backup ruido es cosmético. Documentar como known minor en SUMMARY.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TUI-17 | WorkspaceHost provider contract (SC#1) | §S7 runFocus reuse + §Q1 cmux JSON + §S4 walker pattern. CmuxHost.selectWorkspace delega a runFocus (Phase 37). |
| TUI-18 | Estados ciclo de vida idle/needs-input/closed + migración (SC#2) | §S1 migration pattern + §S2 caller inventory + §S3 fixture pattern. ⚠️ NO copiar el destructive clear de v1→v2. |
| TUI-19 | Dashboard render multi-estado (SC#3) | §S6 SessionTable.js + §Q2 needs_input derivation + D-06 badges. statusColor extension + parseFilter `s:<state>` extension. |
| TUI-20 | Reconciliación host ↔ state (SC#4) | §S5 budget + §Pitfall P-8 debouncing + §Q1/Q2 list calls. Cada poll tick invoca CmuxHost.listWorkspaces (~50ms paralelo). |
| SC#5 | cmux-isolation walker | §S4 walker mirror. Solo 3 carpetas. Excepciones: src/host/cmux.js delegation. |
| SC#6 | Phase 37 UAT parity | §S7 — `selectWorkspace` retorna shape idéntico a runFocus → cero changes en App.js handleFocusResult. UAT debe pasar tal cual. |

## Sources

### Primary (HIGH confidence) — empirical evidence

- `/Applications/cmux.app/Contents/Resources/bin/cmux list-workspaces --json` (run 2026-05-30 00:31 GMT+2) — Q1 resuelto.
- `/Applications/cmux.app/Contents/Resources/bin/cmux rpc notification.list` (run 2026-05-30 00:31 GMT+2) — Q2 resuelto.
- `/Applications/cmux.app/Contents/Resources/bin/cmux capabilities` — confirmó NO method `workspace.needs_input` directo en los 193 métodos RPC.
- `/Applications/cmux.app/Contents/Resources/bin/cmux docs api` — confirmó convención global `--json` en cmux verbs (e.g. `cmux identify --json`).
- Latency measurements via python3 time.time() — 3 runs `list-workspaces --json`, 2 runs `rpc notification.list`.

### Secondary (HIGH confidence) — kodo source code reads

- `src/cmux/client.js:1-89` — existing cmux wrapper.
- `src/cli/dashboard/focus.js:1-118` — runFocus Phase 37 (D-08 reuso).
- `src/cli/dashboard/App.js:1-120` — onFocus prop wiring.
- `src/cli/dashboard/SessionTable.js:1-227` — render presentational layer.
- `src/cli/dashboard/usePoll.js:1-187` — BASE_MS=2500 + backoff.
- `src/session/state.js:1-256` — current state schema + migrateState destructive pattern (NO copiar).
- `src/session/manager.js:1-397` — markSessionStatus + 1 of 2 callers (verify.js dual call).
- `src/hooks/stop.js:170-220` — second markSessionStatus caller.
- `src/gsd/verify.js:250-290` — verify.js caller (empíricamente emite `'review'`, NO `'done'` — R-6).
- `src/server.js:370-410` — current dashboard endpoint with cmux.listWorkspaces inline.
- `test/format-isolation.test.js:1-220` — walker pattern espejo D-09.
- `test/migration.test.js:1-216` — migration fixture pattern.
- `test/providers/contract.test.js:1-467` — contract loop pattern espejo SC#1.
- `src/providers/registry.js:1-80` — provider registry pattern (no copiar 1:1 — D-03 prefiere simpler).

### Tertiary (MEDIUM confidence)

- `.planning/PROJECT.md:1-100` — project context, current state.
- `.planning/STATE.md:1-50` — milestone state.
- `.planning/REQUIREMENTS.md` (TUI-17..TUI-20 ID lookup) — phase ID mapping.
- Existing CONTEXT.md `.planning/phases/38-workspacehost-lifecycle-idle-needs-input/38-CONTEXT.md` — all 15 D-XX decisions.
- Existing SEED.md `.planning/phases/38-workspacehost-lifecycle-idle-needs-input/SEED.md` — 4 plans intent.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A-1 | cmux ≥ versión Q2-2026 expone `latest_submitted_at` field. NO he validado downgrade compat. | Q3 | Older cmux versions retornan undefined → `last_activity: null` fallback (D-03 ya cubre). Bajo riesgo. |
| A-2 | El literal `subtitle === 'Waiting'` es el ÚNICO indicador de needs_input. Otros tipos de waiting (e.g. notification de tool permission) no se cubren. | Q2 | Si Claude Code emite otras notifications de "needs human attention" con diferente subtitle, dashboard no las flagea. Mitigación: documentar como known limitation; ampliar el match en follow-up. |
| A-3 | `cmux list-workspaces --json` SIN `--window` retorna SOLO el window del proceso caller. NO testeé multi-window. | Q1 + P-4 | Multi-window users ven solo subset de sessions. Out-of-scope hard. |
| A-4 | `cmux capabilities` lista 193 métodos RPC representativos. NO hay método "hidden" para needs_input. | Q2 | Si existe método undocumented, la derivation via notification.list es subóptima pero NO incorrecta. Bajo riesgo. |
| A-5 | El comentario en `App.js:41` que reserva `Esc` para "Phase 38 — D-11/D-15" es residuo del renumber `536ad1d`. NO valida nada del Phase 38 actual. | P-10 | Si el planner asume que Phase 38 debe construir un overlay que consume Esc, gasta esfuerzo en algo no spec'd. Validar con human pre-plan. |
| A-6 | `loadConfig().cmux.binary` resuelve a un path ejecutable en runtime. El comentario `client.js:5-7` lo confirma como existing pattern usado por todos los callers. | S7 | Si CI/Linux no tiene cmux instalado, el CmuxHost falla early con HOST_ERR_UNAVAILABLE (D-06) — comportamiento esperado. |

## Open Questions (residual)

1. **`verify.js#finalize` rama pass — emite `'review'` o `'done'`?** Empíricamente emite `'review'`. CONTEXT.md D-12 dice `'done'`. Pre-plan checklist debe validar antes de iniciar Plan 38-02. Si confirmo `'review'`, el shim solo aplica a `stop.js`. (R-6)
2. **¿Plan 38-01 incluye refactor de server.js:378 + hooks/stop.js:407 + orchestrator/launch.js:136 + dispatcher.js:47,353?** Estos callers usan `cmux.listWorkspaces` pero NO están bajo los 3 paths del walker SC#5. Pre-plan decide scope.
3. **¿Phase 38 introduce lock file para race migración?** Bajo riesgo, decisión cosmética. Recomiendo punt al backlog. (R-8)

## Confidence Breakdown

- **Open Questions resolution:** HIGH — empirical evidence con cmux real.
- **Standard stack:** HIGH — no se introduce nueva lib; todo es Node core + ink + react existentes.
- **Architecture patterns:** HIGH — todos los patterns tienen archivos:línea source en kodo.
- **Pitfalls:** HIGH — los 10 pitfalls están atados a evidencia empírica + code reads.
- **Caller migration plan:** MEDIUM — depende de validar R-6 (verify.js emit value real). Si confirma `'review'`, el plan es simpler que CONTEXT.md sugiere.

**Research date:** 2026-05-30
**Valid until:** 2026-06-15 (cmux es fast-moving; revalidar `list-workspaces --json` + `notification.list` shape antes del plan kickoff si pasa más de 2 semanas).
