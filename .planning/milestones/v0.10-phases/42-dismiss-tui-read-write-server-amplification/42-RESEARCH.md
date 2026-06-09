# Phase 42: Dismiss — TUI read-write + server amplification - Research

**Researched:** 2026-06-05
**Domain:** Node CLI / ink@6 + react@19 TUI · HTTP server amplification · destructive-mutation safety (TOCTOU, never-throws, defense-in-depth)
**Confidence:** HIGH (todo verificado contra el código real del repo; cero dependencias externas nuevas)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Nuevo `mode:'confirm'` modal en el union de `mode` (`list|filter|overlay|confirm`). `d` sobre fila `alive===false` entra en `confirm` capturando el `task_id` objetivo; teclado enrutado modal (espejo de `filter`/`overlay`).
- **D-02:** Doble-`d` arma + confirma. Primera `d` arma; segunda `d` ejecuta.
- **D-03:** Sin auto-cancel por tiempo. Sin `setTimeout` que limpiar.
- **D-04:** Cualquier tecla ≠ `d`/`Esc` CANCELA el armado (clear-on-any-input, espejo Phase 37). `Esc` también cancela.
- **D-05:** Bajo `confirm` el render NO se congela — el poll de Phase 35 sigue actualizando. Re-check `alive===false` al segundo `d` contra snapshot MÁS reciente.
- **D-06:** `DELETE /sessions/{id}` devuelve `{ok, removed, actions:[{type:'worktree'|'lock'|'state', result:'removed'|'pruned'|'moved-dirty'|'kept'|'error'}]}`. Reemplaza el `{ok, removed}` mínimo actual.
- **D-07:** Guard `alive===false` en 3 capas (TUI inverso del guard de Enter / Server re-lee `alive` fresco vía `loadState` → 409 ANTES de execute / Doctor re-check por acción).
- **D-08:** El guard server-side ES el re-check TOCTOU de SC#3. El server lee el estado más reciente al recibir el DELETE.
- **D-09:** Footer distinguible según `actions[]` (éxito total / parcial `.dirty` / avisos). La TUI deriva el matiz del `actions[]`.
- **D-10:** `dismissSession(baseUrl, taskId, fetchFn?)` never-throws en `client.js`, espejo de `fetchComments`/`fetchLogs`. `{ok:true, data:{removed, actions}}` | `{ok:false, error}`. El handler `useInput` async lo `await`-ea.
- **D-11:** La fila desaparece por el poll natural (≤2.5s). Sin optimistic UI ni refresh forzado.
- **D-12:** Mensaje de footer efímero, clear-on-any-input (espejo Phase 37).
- **D-13:** Cursor tras desaparecer la fila ya resuelto por `resolveSelection` (Phase 36). Sin código nuevo de cursor.

### Claude's Discretion
- Firma exacta de `dismissSession` y de la DI del handler de `d` (`fetchFn`, baseUrl, accessor de fila).
- De dónde re-lee el server el `alive` fresco para el 409 (`loadState`+`findSession`, o el mismo derive de `/status`). Reusar lo existente.
- Eventos NDJSON del path dismiss (`session.dismissed` nuevo, o reusar `doctor.fix.*`). El server loguea el agregado; doctor emite el detalle por ítem.
- Si el server reusa `execute({taskId})` tal cual o añade un wrapper que traduzca su reporte al body `actions[]`.
- Copy literal exacta del footer (armado/éxito/parcial/error) — constantes literal-estables EXPORTADAS.

### Deferred Ideas (OUT OF SCOPE)
- Dismiss de sesiones vivas / "force kill" desde la TUI (DISMISS-04 lo prohíbe).
- Auto-cancel del armado por timeout (D-03 lo descarta para v1).
- Refresh optimista / quitar la fila al instante (D-11 lo descarta).
- Borrar el `.ndjson` de la sesión al descartarla (retención global por mtime>7d).
- Flags/acciones por-categoría en el DELETE (YAGNI).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DISMISS-01 | Amplificar `DELETE /sessions/{id}` para delegar en `doctor.execute({taskId})` + guard server-side `alive` (409) + body `actions[]` | §Verificación de Drift (el shape real de `execute` NO es `actions[]` → necesita wrapper-traductor); §Architecture Pattern 1 (server amplification); §Validation Architecture (server tests) |
| DISMISS-02 | Confirmación inline `mode:'confirm'` + handler `d` doble-pulsación + Esc/any-key cancel | §Architecture Pattern 2 (mode machine); §Code Examples (handler `d`); §Validation (state machine tests via ink-testing-library) |
| DISMISS-03 | `dismissSession()` never-throws en `client.js` + mapeo de fallo parcial (`.dirty`) al footer | §Verificación de Drift (molde `fetchComments`); §Architecture Pattern 3; §Validation (never-throws end-to-end) |
| DISMISS-04 | Guard inverso `alive===false`: `d` jamás descarta sesión viva (defensa en 3 capas) | §Verificación de Drift (guard de Enter es el espejo); §Architecture Pattern 4 (3-layer guard); §Validation (3-layer guard tests) |
</phase_requirements>

## Summary

Esta fase es **net-new wiring sobre cinco módulos ya estables** — cero dependencias externas nuevas, cero APIs que investigar fuera del repo. El trabajo de investigación de alto valor NO es "qué librería usar" (la respuesta es: ninguna nueva — ink@6/react@19/node:http/node:test ya están), sino **verificar las firmas reales contra lo que CONTEXT.md asume** y **diseñar la arquitectura de validación de una mutación destructiva**.

He verificado las cinco superficies. **Hallazgo de drift crítico (HIGH):** `doctor.execute()` NO devuelve un `actions[]`. Devuelve un `DoctorResult` con **contadores agregados por categoría** (`{worktrees:{removed,moved,pruned,skipped}, zombies:{removed}, locks:{stolen,kept}, logs:{unlinked}, errors:[]}`). El body `actions[]` de D-06 es un **shape que el server debe SINTETIZAR** traduciendo esos contadores — no existe tal cual en el reporte de Phase 41. Esto convierte la "discreción del planner" sobre el wrapper (CONTEXT.md Claude's Discretion #4) en una **necesidad obligatoria**, no opcional. Segundo drift (HIGH): el handler `DELETE` del server **no es testeable en aislamiento** hoy — vive dentro del closure de `createServer`, importa `removeSession`/`loadState` estáticamente (NO vía deps inyectados), y NO tiene un solo test. Phase 40 ya estableció el precedente de extraer la lógica riesgosa a un módulo puro DI (`server/provider-state.js`); esta fase debería espejarlo.

**Primary recommendation:** Extraer la lógica amplificada del DELETE a un módulo puro DI testeable (`src/server/dismiss.js` — espejo de `server/provider-state.js`) que reciba `{loadState, executeFn, taskId}`, haga el guard 409 `alive` y traduzca el `DoctorResult` de contadores → `actions[]`. El handler HTTP del server queda como un thin adapter. En la TUI, espejar VERBATIM el molde `fetchComments`/`fetchLogs` para `dismissSession` y el handler async `c`/`l` para `d`. Validar las tres capas del guard, el TOCTOU determinista (fake `loadState` que muta entre arm y confirm), y el never-throws end-to-end por separado en cada capa.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Armar/confirmar dismiss (UX state machine) | TUI (`App.js` useInput) | — | El estado de interacción modal vive donde ya viven `filter`/`overlay` |
| Guard `alive` TUI-side (no-entrar-en-confirm) | TUI (`App.js`) | — | Espejo invertido del guard de Enter; primera línea, UX (no es la autoridad) |
| Never-throws HTTP collapse | Data layer (`client.js`) | — | Molde exacto de `fetchComments`; React nunca ve un throw |
| **Autoridad del guard `alive` (TOCTOU re-check)** | **Server** (`dismiss.js` nuevo) | Doctor (red final) | El server re-lee `loadState` fresco al recibir el DELETE — D-07/D-08, SC#3 |
| Traducción `DoctorResult` → `actions[]` | Server (`dismiss.js` nuevo) | — | El shape de D-06 NO existe en doctor; el server lo sintetiza |
| Saneo real (worktree+lock+state, re-check por acción) | Doctor (`doctor.execute`) | — | Phase 41, consumido tal cual con `opts.taskId` |
| Refresco de la tabla post-dismiss | Poll (Phase 35) | — | Único escritor del estado de la tabla (D-11) |
| Clamp de cursor post-desaparición | Derive puro (`select.js`) | — | `resolveSelection` ya resuelto (Phase 36, D-13) |

## Standard Stack

**Cero dependencias nuevas.** Toda la fase se construye sobre lo ya instalado y verificado.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ink | ^6.8.0 (instalado) | TUI render + `useInput` para el handler `d` y `mode:'confirm'` | Ya es el motor del dashboard; el `mode` machine ya existe |
| react | ^19.2.0 (instalado) | `useState` para `mode`/footer message/armed target | Ya en uso (App.js) |
| node:http | builtin | `DELETE /sessions/{id}` (ya existe el handler a amplificar) | Server actual |
| node:test | builtin (node v25.9.0) | Runner de toda la validación | `package.json` test script ya lo usa |
| ink-testing-library | ^4.0.0 (devDep) | Render hermético del `App` + `stdin.write` para simular teclas | Molde exacto en `test/dashboard-overlay.test.js` |

### Supporting (módulos internos reusados — NO librerías)
| Módulo | Purpose | When to Use |
|--------|---------|-------------|
| `src/gsd/doctor.js` `execute({taskId, fix:true})` | El saneo real (worktree+lock+state de UNA sesión) | El server lo invoca; ⚠ ver `fix:true` obligatorio abajo |
| `src/session/state.js` `loadState`/`findSession` | Re-lectura fresca del `alive` server-side para el 409 | Guard TOCTOU (D-07/D-08) |
| `src/cli/dashboard/client.js` `fetchComments` | Molde literal de `dismissSession` | Copiar la forma never-throws |
| `src/logger-events.js` `doctorFix*` / nuevo evento | Eventos NDJSON del path dismiss | Discreción D — molde `doctorFix*` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extraer `dismiss.js` puro DI | Inline en el closure de `createServer` | Inline = NO testeable sin boot HTTP + red; rompe el precedente Phase 40. **NO recomendado.** |
| Wrapper que traduce `DoctorResult`→`actions[]` | Cambiar el shape de retorno de `doctor.execute` | Modificar doctor está FUERA de scope (entregado Phase 41) y rompería `gsd-doctor.test.js`. **NO.** El wrapper vive en el server. |

**Installation:** Ninguna. `npm install` no añade nada esta fase.

## Package Legitimacy Audit

No se instalan paquetes externos en esta fase. Sección N/A — slopcheck no aplica.

| Package | Disposition |
|---------|-------------|
| (ninguno) | — |

## Verificación de Drift (NET-NEW — el corazón de esta investigación)

CONTEXT.md mapeó los archivos por número de línea. Verifiqué las firmas REALES. Drift encontrado:

### ⚠ DRIFT #1 (HIGH) — `doctor.execute` NO devuelve `actions[]`. El server debe sintetizarlo.

CONTEXT.md D-06 asume que `execute` "ya produce" el reporte estructurado `actions[]`. **Falso.** El shape real (`src/gsd/doctor.js:430-447`, typedef `DoctorResult`) son **contadores agregados**:

```js
// Lo que execute() REALMENTE devuelve (verificado src/gsd/doctor.js:439-447):
{
  worktrees: { removed: 0, moved: 0, pruned: 0, skipped: 0 },
  zombies:   { removed: 0 },           // ← la entrada state.json se borra aquí
  locks:     { stolen: 0, kept: 0 },
  logs:      { unlinked: 0 },          // siempre 0 bajo taskId (logs excluidos, D-05)
  errors:    [ { category, target, reason } ],  // fail-open per-item
}
```

El `actions:[{type, result}]` de D-06 **no existe**. El server (en `dismiss.js`) debe **traducir** contadores→acciones. Mapeo concreto (el planner lo formaliza):

| Contador en `DoctorResult` | `actions[]` entry (D-06 shape) |
|----------------------------|--------------------------------|
| `worktrees.removed > 0` | `{type:'worktree', result:'removed'}` |
| `worktrees.moved > 0` | `{type:'worktree', result:'moved-dirty'}` ← dispara `DISMISS_PARTIAL_DIRTY` |
| `worktrees.pruned > 0` | `{type:'worktree', result:'pruned'}` |
| `worktrees.skipped > 0` | sesión pasó a viva entre re-checks → tratar como guard (no debería ocurrir tras 409) |
| `zombies.removed > 0` | `{type:'state', result:'removed'}` |
| `locks.stolen > 0` | `{type:'lock', result:'removed'}` (o `pruned`) |
| `locks.kept > 0` | `{type:'lock', result:'kept'}` (lock vivo de otra cosa → no se tocó) |
| `errors[]` no vacío | un `{type:<cat>, result:'error'}` por error → dispara `DISMISS_PARTIAL_WARN` |

**Implicación para el planner:** la "discreción #4 sobre el wrapper" es OBLIGATORIA. El test del mapeo contador→`actions[]` es una unidad pura de alto valor (byte-determinista, D-06).

### ⚠ DRIFT #2 (HIGH) — `execute` es un **no-op silencioso sin `fix:true`**.

`src/gsd/doctor.js:468`: `if (!opts.fix) return result;` — devuelve un `emptyResult()` **sin sanear nada**. El server DEBE invocar `execute(deps, { taskId, fix: true })`. Olvidar `fix:true` produce un dismiss que reporta `{ok:true, removed}` pero **deja el worktree/lock/state intactos** — un fallo silencioso peligroso en una op destructiva. El planner debe lockear esto explícitamente y testearlo (un test que verifica que `fix:true` se pasa).

### ⚠ DRIFT #3 (HIGH) — el handler DELETE no es testeable hoy; rompe el precedente Phase 40.

`src/server.js:495-501`: el handler es **3 líneas dentro del closure de `createServer`**, llama `removeSession(taskId)` (import estático, NO un dep inyectado — verificado: `startServer` solo inyecta deps a `startReconcileLoop`, no al handler HTTP), y **NO tiene un solo test** (`grep DELETE test/` → vacío). Phase 40 extrajo la lógica riesgosa (`createProviderStateResolver` en `src/server/provider-state.js`) precisamente para testearla sin boot HTTP (`test/server/provider-state.test.js` lo confirma: "extracted out of server.js precisely so it is testable WITHOUT booting the HTTP server"). **Esta fase debe espejar ese precedente** o la lógica destructiva quedará sin cobertura unitaria.

### ✓ SIN DRIFT — confirmados exactos como CONTEXT.md asume:
- **`fetchComments`/`fetchLogs` never-throws** (`client.js:95-145`): molde exacto. `dismissSession` es un calco con `method:'DELETE'`. ✓
- **Handler async `c`/`l`** (`App.js:317-390`): `await fetch... ; if (!res.ok)...` dentro de `useInput(async ...)`. ✓ El handler ya es async (`App.js:245`).
- **Clear-on-any-input** (`App.js:252-255`): `if (focusError != null){ setFocusError(null); return; }` al inicio del useInput. El handler de `d` debe respetar este orden de precedencia. ✓
- **Guard de Enter** (`App.js:412-418`): `if (row.alive === false){ setFocusError(FOCUS_ERR_ZOMBIE); return; }`. El guard de `d` es el **espejo invertido**: `if (row.alive === true){ setFooter(DISMISS_GUARD_ALIVE); return; }`. ✓
- **Constantes exportadas** (`App.js:69-104`): `FOCUS_ERR_*`/`OVERLAY_*` exportadas, importadas por tests. El patrón `DISMISS_*` lo replica. ✓
- **`resolveSelection`** (`select.js:78-84`): clamp por identidad, `prevIndex` fallback. Resuelve el cursor post-dismiss GRATIS. ✓
- **`removeSession`** (`state.js:242-256`): archiva a `history` antes de borrar de `sessions`. ⚠ Nota: `doctor.execute` ya llama `removeSession` para la categoría zombie (`doctor.js:527`) — el server NO debe llamarlo OTRA VEZ además de `execute`, o se archivaría dos veces. El server delega 100% en `execute`.
- **`EVENTS` registry** (`logger-events.js:57-86`): `DOCTOR_FIX_*` ya emitidos por `execute` internamente. Para el evento agregado del server, añadir `SESSION_DISMISSED` al registro (molde `worktreeCleanupOk`).

## Architecture Patterns

### System Architecture Diagram

```
   operator                 TUI (App.js)                client.js          server (HTTP)        dismiss.js (NUEVO, puro DI)      doctor.js (P41)
   ────────                 ────────────                ─────────          ────────────         ──────────────────────────      ───────────────
      │  press d              │                            │                   │                          │                          │
      │ ───────────────────▶ │ guard: row.alive===true?   │                   │                          │                          │
      │                       │   YES → red footer, abort  │                   │                          │                          │
      │                       │   NO  → setMode('confirm') │                   │                          │                          │
      │                       │        capture task_id     │                   │                          │                          │
      │  press d again        │                            │                   │                          │                          │
      │ ───────────────────▶ │ await dismissSession ─────▶│ DELETE /sessions/ │                          │                          │
      │                       │   (never-throws)           │   {task_id} ─────▶│ thin adapter ──────────▶ │ loadState() FRESH       │
      │                       │                            │                   │                          │ findSession(task_id)    │
      │                       │                            │                   │                          │ alive===true?           │
      │                       │                            │                   │  ◀── 409 {ok:false,──────│   YES → reject (TOCTOU) │
      │                       │                            │  ◀── {ok:false,   │       error:'alive'}     │   NO  → execute({taskId,│
      │                       │                            │      error:'alive'}│                          │            fix:true}) ──▶│ re-detect + re-check
      │                       │                            │                   │                          │                          │ liveness PER action
      │                       │                            │                   │                          │ translate DoctorResult   │ worktree→.dirty if dirty
      │                       │                            │  ◀── 200 {ok,─────│  ◀── {ok, removed,───────│   counters → actions[]   │ lock steal / state rm
      │                       │  ◀── {ok:true,data}────────│      removed,     │       actions[]}         │                          │
      │                       │ map actions[]→footer       │      actions[]}   │                          │                          │
      │                       │ setMode('list')            │                   │                          │                          │
      │                       │                            │                   │                          │                          │
      │                       │ ◀═══ poll (Phase 35, único escritor de la tabla) ═══ row disappears ≤2.5s, resolveSelection clamps cursor
```

**Decisión load-bearing del diagrama:** el 409 `alive` se decide en `dismiss.js` (server-side), NO en la TUI. La TUI tiene un guard de UX, pero la AUTORIDAD TOCTOU (SC#3, D-08) es la re-lectura fresca de `loadState` en el server. Esto es lo que hace correcto el race "fila viva entre arm y confirm".

### Recommended Project Structure (cambios)
```
src/
├── server/
│   ├── provider-state.js     # existe (Phase 40) — el PRECEDENTE a espejar
│   └── dismiss.js            # NUEVO — guard 409 + traducción DoctorResult→actions[], puro DI
├── server.js                 # handler DELETE pasa de 3 líneas a thin adapter sobre dismiss.js
├── cli/dashboard/
│   ├── client.js             # + dismissSession (calco de fetchComments)
│   └── App.js                # + mode:'confirm', handler d, DISMISS_* consts, footer message state
└── logger-events.js          # + SESSION_DISMISSED event (molde worktreeCleanupOk)
test/
├── server/
│   └── dismiss.test.js       # NUEVO — guard 409, translate, fix:true, never-throws server-side
├── dashboard/
│   └── app-dismiss.test.js   # NUEVO — state machine, 3-layer guard TUI, footer mapping
└── dashboard-client.test.js  # + dismissSession never-throws cases
```

### Pattern 1: Server amplification vía módulo puro DI (espejo Phase 40)
**What:** Extraer la lógica del DELETE a `src/server/dismiss.js` con la forma de `createProviderStateResolver`.
**When to use:** Siempre que el handler tenga lógica de riesgo (aquí: guard `alive` + traducción + delegación destructiva).
**Example:**
```js
// src/server/dismiss.js (NUEVO) — Source: espejo de src/server/provider-state.js (Phase 40)
import { loadState as realLoadState, findSession as realFindSession } from '../session/state.js';
import { execute as realExecute } from '../gsd/doctor.js';

/**
 * @param {{ loadState?, findSession?, executeFn?, logger? }} deps
 */
export function createDismissHandler(deps = {}) {
  const loadState = deps.loadState || realLoadState;
  const findSession = deps.findSession || realFindSession;
  const executeFn = deps.executeFn || realExecute;

  /** @returns {Promise<{ status:number, body:object }>} */
  return async function dismiss(taskId) {
    // D-07/D-08: re-lee el alive FRESCO (autoridad TOCTOU). NO confía en el cliente.
    const found = findSession({ workspaceRef: taskId }); // o el accessor correcto por task_id
    const session = found?.session;
    if (session && session.alive === true) {
      return { status: 409, body: { ok: false, error: 'alive' } };  // SC#2/D-07 server guard
    }
    // DRIFT #2: fix:true OBLIGATORIO o no sanea nada.
    const result = await executeFn({}, { taskId, fix: true });       // never-throws (Phase 41)
    const actions = translateToActions(result);                       // DRIFT #1: sintetizar
    return { status: 200, body: { ok: true, removed: taskId, actions } };
  };
}
```
**El handler HTTP queda thin** (`server.js`): `const { status, body } = await dismissHandler(taskId); res.writeHead(status,...); res.end(JSON.stringify(body))`.

### Pattern 2: `mode:'confirm'` state machine en useInput (espejo `filter`/`overlay`)
**What:** Añadir una rama `mode === 'confirm'` ANTES del bloque `mode === 'list'`, después del clear-on-any-input.
**When to use:** El routing modal de teclado de esta fase.
**Example:**
```js
// src/cli/dashboard/App.js — Source: espejo de la rama mode==='filter' (App.js:282-306)
// ORDEN dentro de useInput (verificado App.js:252-308):
//   1. clear footer message (clear-on-any-input, App.js:252)
//   2. mode==='overlay'  (existente)
//   3. mode==='confirm'  ← NUEVO
//   4. mode==='filter'   (existente)
//   5. mode==='list'     (existente) + nuevo handler `d`

if (mode === 'confirm') {
  if (input === 'd') {                          // D-02: segunda d → ejecuta
    const res = await dismissSession(baseUrl, armedTaskId, fetchFn);  // D-10 never-throws
    setFooter(mapDismissResult(res, armedTaskRef));                   // D-09 actions[]→copy
    setArmedTaskId(null);
    setMode('list');
    return;
  }
  // D-04: Esc Y cualquier otra tecla cancelan (solo d ejecuta).
  setArmedTaskId(null);
  setMode('list');
  return;                                        // D-03: sin timer que limpiar
}
```
**Nota:** capturar `armedTaskId` por IDENTIDAD (D-13), nunca un índice. El `armedTaskRef` (legible) se captura al armar para el copy del footer (`task_ref`, no `task_id` — UI-SPEC).

### Pattern 3: `dismissSession` never-throws (calco de `fetchComments`)
```js
// src/cli/dashboard/client.js — Source: calco de fetchComments (client.js:95-116)
export async function dismissSession(baseUrl, taskId, fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn(`${baseUrl}/sessions/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const status = res.status;
      // El server 409 lleva {error:'alive'} en el body — extraerlo para el footer honesto (D-07).
      let error = `HTTP ${status}`;
      try { const b = await res.json(); if (b && b.error) error = b.error; } catch {}
      return { ok: false, error };          // 'alive' surfacea el race cazado
    }
    const data = await res.json();          // puede lanzar → catch
    if (!Array.isArray(data.actions)) return { ok: false, error: 'bad shape' };
    return { ok: true, data: { removed: data.removed, actions: data.actions } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };  // red/abort/JSON
  }
}
```
⚠ `encodeURIComponent(taskId)` OBLIGATORIO (anti path-traversal, mismo T-39-01 que `fetchComments`). El server hace `decodeURIComponent` simétrico (`server.js:496`, ya lo hace).

### Pattern 4: Guard `alive` en 3 capas (defensa en profundidad, D-07)
1. **TUI** (`App.js`, handler `d` en `list`): `if (row.alive === true){ setFooter(DISMISS_GUARD_ALIVE); return; }` — UX, primera línea. Espejo invertido de `App.js:412`.
2. **Server** (`dismiss.js`): re-lee `loadState` fresco → `alive===true` → 409. **Autoridad TOCTOU (D-08).**
3. **Doctor** (`execute`, `doctor.js:493`): `if (isSessionLive(session)){ result.worktrees.skipped++; continue; }` — última red por acción.

### Anti-Patterns to Avoid
- **Inline en el closure de `createServer`:** mata la testabilidad. Extraer a `dismiss.js`.
- **`await` desnudo en useInput:** `dismissSession` never-throws garantiza que no haga falta try/catch, pero NO añadir un `fetch` crudo en el handler (siempre vía `dismissSession`).
- **Optimistic UI / quitar la fila al instante:** prohibido (D-11). El poll es el único escritor.
- **`setTimeout` para auto-cancel del armado:** prohibido (D-03). Nada que limpiar en teardown.
- **Llamar `removeSession` en el server ADEMÁS de `execute`:** doble archivado en `history`. `execute` ya lo hace (`doctor.js:527`).
- **Olvidar `fix:true`:** dismiss silencioso que no sanea (DRIFT #2).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Saneo worktree/lock/state | Lógica de borrado en el server | `doctor.execute({taskId, fix:true})` | Phase 41 ya tiene re-check liveness + dirty→.dirty + fail-open |
| Re-check TOCTOU del cursor | Snapshot del cliente | `loadState` fresco server-side | El cliente puede tener un snapshot stale; el server lee el estado real |
| Clamp del cursor post-dismiss | Aritmética de índices | `resolveSelection` (Phase 36) | Ya clampa por identidad (D-13) |
| Footer transitorio | Estado nuevo desde cero | Generalizar `focusError` (App.js:160) | El clear-on-any-input + precedencia ya existen (D-12) |
| HTTP error collapse | try/catch ad-hoc en el handler | molde `fetchComments` | Never-throws ya resuelto y testeado |

**Key insight:** Esta fase NO escribe lógica de saneo, ni de cursor, ni de never-throws — REUSA cinco máquinas ya probadas y las CABLEA. El único código verdaderamente nuevo es: (1) el traductor `DoctorResult→actions[]`, (2) el guard 409 server-side, (3) la rama `mode:'confirm'`. Todo lo demás es calco.

## Runtime State Inventory

> Esta es una fase de mutación destructiva, no un rename. Pero la disciplina aplica al revés: ¿qué estado runtime TOCA el dismiss?

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `state.json` → `sessions[taskId]` se borra y se archiva en `history` (vía `execute`→`removeSession`, `doctor.js:527`+`state.js:242`). | Ninguna nueva — `execute` lo maneja. NO llamar `removeSession` doble. |
| Live service config | El worktree `.bg-shell/<sessionId>` se elimina o se mueve a `.dirty` (`cleanupWorktree`). El `.kodo.lock` per-repo se roba si PID muerto/TTL. | Ninguna nueva — `execute({taskId})` acota a ESA sesión. |
| OS-registered state | Ninguno — el dismiss no toca Task Scheduler/launchd/systemd. **Verificado: doctor solo toca FS + git worktree + state.json.** | None |
| Secrets/env vars | Ninguno — el dismiss no lee ni escribe secrets. | None |
| Build artifacts | Ninguno — sin recompilación. El `.ndjson` de la sesión NO se borra (retención global mtime>7d, D-05/D-12 deferred). | None — deferred explícitamente |

**Punto crítico de la inversión:** el `alive` NUNCA lo escribe el dismiss (sigue siendo `reconcileTick` el único escritor). El dismiss solo borra la ENTRADA `sessions[taskId]`, no muta `alive`. Verificado: `removeSession` hace `delete state.sessions[taskId]`, no toca `alive` de otras sesiones.

## Common Pitfalls

### Pitfall 1: Asumir que `execute` devuelve `actions[]`
**What goes wrong:** El server pasa el `DoctorResult` de contadores tal cual al body → el cliente hace `data.actions.find(...)` sobre `undefined` → el `bad shape` guard de `dismissSession` lo rechaza, o peor, el render crashea.
**Why it happens:** CONTEXT.md D-06 dice "reusando el reporte estructurado que doctor.execute ya produce" — pero ese reporte son contadores, no acciones.
**How to avoid:** El traductor `translateToActions(DoctorResult)` en `dismiss.js`. Test unitario byte-determinista.
**Warning signs:** `data.actions is not iterable`, footer siempre `bad shape`.

### Pitfall 2: Olvidar `fix:true` → dismiss fantasma
**What goes wrong:** `execute({taskId})` sin `fix` devuelve `emptyResult()` → server responde `{ok:true, actions:[]}` → footer dice "dismissed" → pero el worktree/lock siguen ahí.
**Why it happens:** `fix` es falsy por defecto (`doctor.js:468`).
**How to avoid:** Lockear `fix:true` en `dismiss.js` + test que verifica que el `executeFn` mock recibió `{taskId, fix:true}`.
**Warning signs:** dismiss "exitoso" pero la fila reaparece tras el poll (porque la sesión sigue en state.json).

### Pitfall 3: Race arm→confirm cazado en el cliente en vez del server
**What goes wrong:** Si el re-check `alive` solo vive en la TUI, una sesión que revive entre el primer y segundo `d` se descarta igual (el snapshot del cliente decía dead).
**Why it happens:** D-05 dice que el render no se congela — pero el snapshot del React state puede estar 1 tick atrás.
**How to avoid:** La AUTORIDAD es el server (`loadState` fresco → 409). El guard TUI es solo UX. D-08 es explícito.
**Warning signs:** test TOCTOU que solo mockea el estado del cliente, no `loadState`.

### Pitfall 4: Precedencia del clear-on-any-input rompe el segundo `d`
**What goes wrong:** Si un mensaje de footer transitorio (p.ej. el `DISMISS_GUARD_ALIVE` de un intento previo) está presente, el clear-on-any-input (`App.js:252`) **consume el keystroke y hace return ANTES** de llegar a la rama `confirm`. El operador pulsa `d` esperando confirmar y solo limpia un mensaje.
**Why it happens:** El clear-on-any-input es lo PRIMERO en el useInput (D-12, by design).
**How to avoid:** Decidir conscientemente: el `DISMISS_CONFIRM` armado NO es transitorio (UI-SPEC §142 lo dice — persiste hasta d/Esc). El footer message transitorio (éxito/error) SÍ. Asegurar que entrar en `confirm` NO setea el footer transitorio, solo el armed prompt. El planner debe separar "armed prompt" (persistente) de "result message" (transitorio) — UI-SPEC §49 recomienda `confirmLine ?? resultLine ?? errorLine ?? filterLine`.
**Warning signs:** el segundo `d` no ejecuta, solo limpia el footer.

### Pitfall 5: Timing del `await` en useInput (ink no awaitea el handler)
**What goes wrong:** ink NO espera a que la promise del handler async resuelva. Los `setState` post-`await dismissSession` llegan cuando la promise resuelve, no síncronamente. En tests, un solo `await drain()` puede no bastar.
**Why it happens:** Comportamiento documentado de ink (verificado en `App.js:240-243` comentario: "ink permite handlers async — no awaitea el return").
**How to avoid:** En los tests, espejar el molde `dashboard-overlay.test.js`: `stdin.write('d'); await drain();` y si hace falta un segundo `await drain()` tras la resolución del fetch fake. El `drain()` helper ya existe verbatim.
**Warning signs:** assert sobre el footer falla intermitentemente (el setState aún no llegó).

### Pitfall 6: `findSession` por la clave correcta
**What goes wrong:** `findSession` (`state.js:319`) busca por `{sessionId, cwd, workspaceRef}` — NO por `task_id` directamente. El DELETE llega con un `task_id`. El server debe re-leer por la clave correcta. El `/comments/` handler usa `listSessions().find(s => s.task_id === taskId)` (`server.js:470`) — ese es el patrón correcto para buscar por `task_id`, NO `findSession`.
**Why it happens:** `findSession` tiene una firma de 3 claves que no incluye `task_id` como clave de primer nivel.
**How to avoid:** En `dismiss.js`, re-leer `alive` con `loadState().sessions[taskId]` directo (más simple) o `listSessions().find(s => s.task_id === taskId)` (espejo del `/comments` handler). NO `findSession({...})` salvo que se confirme que matchea por task_id.
**Warning signs:** el guard 409 nunca dispara porque `findSession` devuelve null.

## Code Examples

### Mapeo `dismissSession` result → footer (D-09, desde UI-SPEC §148-156)
```js
// src/cli/dashboard/App.js — el matiz se deriva de actions[], NO de un color lookup (D-09)
function mapDismissResult(res, taskRef) {
  if (!res.ok) return { text: DISMISS_ERR(res.error), color: 'red' };   // incl. 'alive' (409)
  const actions = res.data.actions || [];
  if (actions.some(a => a.result === 'error'))      return { text: DISMISS_PARTIAL_WARN(taskRef), color: 'yellow' };
  if (actions.some(a => a.result === 'moved-dirty')) return { text: DISMISS_PARTIAL_DIRTY(taskRef), color: 'yellow' };
  return { text: DISMISS_OK(taskRef), color: 'green' };
}
// Precedencia error>dirty (UI-SPEC §156): un sub-fallo es señal más fuerte que un .dirty preservado.
```

## State of the Art

No aplica drift de ecosistema — esta fase es 100% código interno sobre librerías ya fijadas. ink@6/react@19/node:test no cambian nada relevante aquí.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| TUI read-only (v0.9) | TUI read-write (esta fase) | Phase 42 | Primera ruptura consciente del invariante. Documentar en STATE.md el cambio de identidad (observabilidad→gestión). |

## Validation Architecture

> nyquist_validation no está deshabilitado en config (verificar; si ausente, habilitado). Esta es la sección de MÁXIMO valor para esta fase de mutación destructiva.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (builtin, node v25.9.0) + `node:assert/strict` |
| UI render harness | `ink-testing-library` ^4.0.0 (`render`, `stdin.write`, `lastFrame`, `unmount`) |
| Config file | none — `package.json` script: `node --test $(find test -name '*.test.js' -type f)` |
| Quick run command | `node --test test/server/dismiss.test.js test/dashboard/app-dismiss.test.js` |
| Full suite command | `npm test` |

### Test layering — qué es unit-testable en aislamiento vs. integración

| Behavior | Layer | Test type | Why this layer |
|----------|-------|-----------|----------------|
| Traducción `DoctorResult`→`actions[]` | `dismiss.js` puro | **unit** (sin red, sin HTTP) | byte-determinista, DI; el output más crítico de D-06 |
| Guard 409 `alive` server-side | `dismiss.js` puro | **unit** (fake `loadState`) | la AUTORIDAD TOCTOU (D-08); fake `loadState` que devuelve `alive:true` |
| `fix:true` se pasa a `execute` | `dismiss.js` puro | **unit** (executeFn spy) | anti-Pitfall #2 |
| never-throws server-side (execute rechaza) | `dismiss.js` puro | **unit** (executeFn que rejecta — pero execute es never-throws, así que también el caso de errors[] no vacío) | fail-open |
| `dismissSession` never-throws (red/HTTP/JSON/409) | `client.js` | **unit** (fetchFn fake) | molde `dashboard-client.test.js` |
| State machine arm/confirm/cancel | `App.js` | **integration-light** (ink-testing-library) | `stdin.write('d')` × secuencias |
| Guard `alive` TUI (no entra en confirm sobre viva) | `App.js` | **integration-light** | render con fila `alive:true` |
| Footer mapping (actions[]→copy) | `App.js` o `mapDismissResult` puro | **unit** si se extrae `mapDismissResult` | recomendado extraer puro |
| Race TOCTOU end-to-end | `dismiss.js` unit + `App.js` | **unit (determinista)** | ver abajo |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISMISS-01 | DELETE delega en execute, guard 409, body actions[] | unit | `node --test test/server/dismiss.test.js` | ❌ Wave 0 |
| DISMISS-02 | doble-d arma+confirma, Esc/any-key cancela | integration-light | `node --test test/dashboard/app-dismiss.test.js` | ❌ Wave 0 |
| DISMISS-03 | dismissSession never-throws + footer parcial/.dirty | unit + integration | `node --test test/dashboard-client.test.js test/dashboard/app-dismiss.test.js` | ⚠ client test existe, añadir casos |
| DISMISS-04 | guard alive===false 3 capas | unit (server+doctor) + integration (TUI) | `node --test test/server/dismiss.test.js test/dashboard/app-dismiss.test.js` | ❌ Wave 0 |

### Cómo testear el TOCTOU DETERMINISTA (el test estrella de esta fase)

El race "fila viva entre arm y confirm" se testea en `dismiss.js` SIN timing real, inyectando un `loadState` que muta entre llamadas:

```js
// test/server/dismiss.test.js — TOCTOU determinista (D-07/D-08, SC#3)
it('rechaza con 409 si la sesión revivió entre arm y confirm (TOCTOU)', async () => {
  let alive = false;                          // estado al armar (dead)
  const loadState = () => ({ sessions: { 'T-1': { task_id: 'T-1', alive } } });
  let executed = false;
  const executeFn = async () => { executed = true; return emptyResult(); };
  const dismiss = createDismissHandler({ loadState, executeFn });

  alive = true;                               // ← la sesión revive ANTES del DELETE (server re-lee fresco)
  const { status, body } = await dismiss('T-1');
  assert.equal(status, 409);
  assert.equal(body.error, 'alive');
  assert.equal(executed, false, 'execute NUNCA se invoca sobre una sesión viva');  // SC#3
});
```
**Clave:** el test no necesita simular dos pulsaciones de `d` ni timers — basta con que `loadState` devuelva `alive:true` en el momento del DELETE. Eso ES el TOCTOU re-check de D-08.

### Cómo testear la state machine de confirm (molde `dashboard-overlay.test.js`)

```js
// test/dashboard/app-dismiss.test.js — espejo VERBATIM de dashboard-overlay.test.js
// stdin.write('d') × secuencias, fetchFn fake responde a /status y DELETE /sessions/<id>.
// - d sobre dead → frame muestra DISMISS_CONFIRM
// - d otra vez   → fetchFn fake recibe DELETE → frame muestra DISMISS_OK / DISMISS_PARTIAL_DIRTY
// - d sobre viva → frame muestra DISMISS_GUARD_ALIVE, NO entra en confirm
// - d (arma) luego 'x' → cancela, vuelve a list, NO hay DELETE (fetchFn DELETE call count === 0)
// - d (arma) luego Esc → cancela
// Importar DISMISS_* consts de App.js y assert.match (mata drift code/render, molde overlay test).
```
⚠ Aplicar la disciplina del overlay test: `unmount()` en `finally`, `await drain()` tras cada `stdin.write`. Para la rama async (segundo `d`), puede requerir DOS `await drain()` (Pitfall 5).

### Sampling Rate
- **Per task commit:** `node --test test/server/dismiss.test.js test/dashboard/app-dismiss.test.js test/dashboard-client.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green + (probable) UAT manual (espejo cierre v0.9 Phases 37/38, mutación destructiva — CONTEXT.md §specifics).

### Wave 0 Gaps
- [ ] `test/server/dismiss.test.js` — guard 409 TOCTOU, translate DoctorResult→actions[], fix:true, never-throws server-side (cubre DISMISS-01, DISMISS-04 server+doctor layers)
- [ ] `test/dashboard/app-dismiss.test.js` — state machine, guard TUI, footer mapping (cubre DISMISS-02, DISMISS-04 TUI layer)
- [ ] `test/dashboard-client.test.js` — AÑADIR casos `dismissSession` never-throws (network/HTTP/409/JSON corrupto) — el archivo existe
- [ ] Framework: ninguno a instalar — `node:test` + `ink-testing-library` ya disponibles

## Security Domain

> security_enforcement habilitado (ausente=habilitado). Fase de mutación destructiva → relevante.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | Guard `alive===false` server-side (409) — la AUTORIDAD que impide descartar sesiones vivas (DISMISS-04, SC#2). No es auth de usuario (server local), pero es control de acceso a la operación destructiva. |
| V5 Input Validation | yes | `encodeURIComponent(taskId)` en el path (anti path-traversal, T-39-01 ya establecido). El server hace `decodeURIComponent` simétrico. |
| V6 Cryptography | no | — |
| V2/V3 Auth/Session | no | server local, sin auth (fuera de scope del proyecto) |

### Known Threat Patterns for {Node HTTP + destructive mutation}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal vía `task_id` en `/sessions/<id>` | Tampering | `encodeURIComponent`/`decodeURIComponent` (ya en `server.js:496`) + `doctor` jamás hace `rmSync` recursivo (Phase 41 threat register) |
| Descartar sesión viva (race / cliente ajeno) | Tampering / DoS | Guard server-side 409 `alive` (D-07/D-08); doctor re-check por acción (última red) |
| Dismiss fantasma (`fix` falsy) reporta éxito falso | Repudiation | `fix:true` lockeado + test; evento NDJSON `session.dismissed` agregado (auditable) |
| Worktree con trabajo sin commit borrado | Tampering (pérdida de datos) | `cleanupWorktree` mueve a `.dirty` en vez de borrar (Phase 41 D-11); footer lo comunica (D-09) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `nyquist_validation` está habilitado (config no leído en esta sesión) | Validation Architecture | Si está `false`, la sección sobra (pero no daña) |
| A2 | El proyecto cerrará esta fase con UAT manual (espejo 37/38) | Validation / specifics | Inferido de CONTEXT.md §specifics; el planner confirma con ROADMAP §Phase 42 |
| A3 | `findSession` no matchea por `task_id` directo → usar `loadState().sessions[taskId]` o `listSessions().find` | Pitfall 6 | Verificado parcialmente (firma `state.js:316` toma sessionId/cwd/workspaceRef); el planner confirma leyendo `findSession` completo (`state.js:319+`) |

**Nota:** A3 es la única asunción con riesgo real de implementación — el planner DEBE leer `findSession` completo (`src/session/state.js:319-360`) para confirmar la clave correcta del re-check antes de cablear el guard 409.

## Open Questions

1. **¿`SESSION_DISMISSED` evento nuevo o reusar `doctor.fix.*`?**
   - What we know: `execute` ya emite `doctor.fix.worktree/lock/log/error` por ítem (`doctor.js:507+`). El registro `EVENTS` no tiene un evento agregado de dismiss.
   - What's unclear: si el server debe emitir un evento agregado además del detalle de doctor.
   - Recommendation: añadir `SESSION_DISMISSED: 'session.dismissed'` al registro + helper `sessionDismissed(logger, {task_id, actions_count})` (molde `worktreeCleanupOk`, `logger-events.js:315`). Doctor ya cubre el detalle; el server cubre el agregado auditable. Token≈0.

2. **¿`mapDismissResult` se extrae a un módulo puro o vive inline en App.js?**
   - What we know: la lógica de mapeo actions[]→copy es pura y byte-determinista.
   - What's unclear: extraerla a `select.js` o `format.js` (testeable sin React) vs. inline.
   - Recommendation: extraer a una función pura (p.ej. en `select.js` junto a la otra lógica de derive) para test unitario sin host React. Discreción del planner, pero el test puro es de alto valor para D-09.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | todo | ✓ | v25.9.0 | — |
| ink | TUI | ✓ | ^6.8.0 | — |
| react | TUI | ✓ | ^19.2.0 | — |
| ink-testing-library | tests TUI | ✓ | ^4.0.0 (devDep) | — |
| node:test / node:http | runtime+tests | ✓ | builtin | — |

**Missing dependencies:** ninguna. Fase 100% sobre stack ya instalado.

## Sources

### Primary (HIGH confidence — código real del repo, verificado esta sesión)
- `src/gsd/doctor.js` — DoctorResult shape (`:430-447`), `fix:true` guard (`:468`), re-check liveness (`:493`), `removeSession` call (`:527`)
- `src/server.js` — DELETE handler actual (`:495-501`), startServer deps (`:337-572`), imports estáticos de state (`:7`), patrón `/comments` find-by-task_id (`:470`)
- `src/cli/dashboard/client.js` — molde never-throws `fetchComments` (`:95-116`)
- `src/cli/dashboard/App.js` — useInput async (`:244`), clear-on-any-input (`:252`), guard Enter (`:412`), constantes exportadas (`:69-104`)
- `src/cli/dashboard/select.js` — `resolveSelection` clamp por identidad (`:78-84`)
- `src/session/state.js` — `loadState` (`:208`), `removeSession` archiva a history (`:242`), `findSession` firma 3-claves (`:316`)
- `src/logger-events.js` — registro EVENTS (`:57-86`), `doctorFix*` (`:707+`), molde `worktreeCleanupOk` (`:315`)
- `test/dashboard-overlay.test.js` — molde de test de useInput async (drain/stdin.write/unmount finally)
- `test/server/provider-state.test.js` — precedente Phase 40 de extracción puro DI testeable sin HTTP
- `test/dashboard/app-focus.test.js` — molde de test de clear-on-any-input + guard de Enter

### Secondary
- 42-CONTEXT.md / 42-UI-SPEC.md — decisiones locked D-01..D-13 + contrato de copy/color

### Tertiary
- ninguna (cero búsquedas web — fase 100% interna)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cero dependencias nuevas, todo verificado en package.json + imports
- Architecture: HIGH — los 3 patrones nuevos espejan código existente verificado (Phase 40 provider-state, Phase 37 footer, Phase 39 overlay)
- Drift findings: HIGH — leídos los typedefs y firmas reales línea por línea
- Pitfalls: HIGH — derivados del código real, no de training
- Validation: HIGH — moldes de test verificados (overlay/provider-state/app-focus existen y se citan)

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 (estable — código interno, sin dependencias volátiles)
