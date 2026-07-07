# Phase 71: Fiabilidad de entrega y backstop - Research

**Researched:** 2026-07-07
**Domain:** Fiabilidad de entrega de dispatches y cierre de ciclo de vida (Node.js ESM, `node:test`, provider-agnostic Plane/GitHub)
**Confidence:** HIGH (todos los anchors verificados contra código actual; dos puntos externos —semántica `since` de GitHub y valores `reason` de SessionEnd— documentados con su fuente)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** En `processRepo` (`src/triggers/polling.js`), el dispatch del **carril polling** deja de ser fire-and-forget: se `await`ea con **timeout** acotado. Solo se incorpora el `updated_at` de un issue a `maxUpdatedAt` cuando su dispatch **resolvió OK** (o `shouldDispatch===false`). Dispatch que rechaza/timeout NO avanza cursor sobre ese issue → reintento el tick siguiente. Se reemplaza el `.catch()` fire-and-forget (`:362-383`) por un `await` con captura del resultado.
- **D-02 [SUTILEZA obligatoria]:** el cursor es un **watermark escalar** (`last_updated_at = max(updated_at)`). Un issue fallido con `updated_at` **menor** que otro exitoso posterior sería **saltado** si el watermark avanza al del exitoso (el filtro `since` lo excluiría). Regla correcta: (a) watermark = max(updated_at de exitosos/no-dispatch) **acotado a** `< min(updated_at de fallidos)`; o (b) hold total del cursor ante cualquier fallo. **Recomendado (a).** Verificar semántica inclusiva/exclusiva de `since` en Plane/GitHub para el epsilon.
- **D-03:** El **timeout** de confirmación es parámetro nuevo (DI/config, default sensato); su vencimiento cuenta como **no confirmado** (reintento), nunca error fatal (never-throws/warn-and-continue). El webhook (`src/triggers/webhook.js`) **NO se toca**.
- **D-04:** **Centinela explícito** en `cache[key]` (p.ej. `observed:true` o `first_tick_done`), **desacoplado** de `last_updated_at`. Separa «cache ausente» (nunca observado → skip+poblar+marcar) de «observado con cursor vacío/perdido» (dispatch normal por `updated_at > cursor`).
- **D-05:** El centinela se persiste **aunque el primer tick no traiga items** (hoy `cache[key]` solo se escribe en path 200 con items, `:391-395`). Escritura **atómica** vía `saveStateCache` (tmp+rename).
- **D-06:** Preservar invariantes anti-storm: primer tick real **no dispara** (T-25-04); path 304 **preserva cursor sin escribir** (`:310-328`). El centinela es **aditivo**.
- **D-07:** DELIV-03 cubre eje **distinto** del guard `sessionId` (`adopt.js:245`, `ALREADY_ADOPTED`). Cierra la ventana en que un adopt **creó la tarea en el provider pero falló al persistir localmente** (`PERSIST_FAILED`, `:283-294`, devuelve `task_url`) → un re-run llamaría a `createTask` otra vez → tarea duplicada.
- **D-08:** Añadir **lookup por `task_url` antes de `createTask`** (`:259`): si la identidad ya tiene `task_url` conocido (estado local `state.json` sessions+history y/o pasado por el caller), se **reutiliza/reconcilia**. **Recomendado:** resolver por **estado local determinista** (0-token); provider-side por url como fallback. Reproducir la ventana exacta con test (adopt crea tarea + PERSIST_FAILED → re-run → verificar **un solo** `createTask`).
- **D-09:** Mantener **never-throws** y discriminated returns (`UNSUPPORTED`/`INVALID_INPUT`/`ALREADY_ADOPTED`/`CREATE_FAILED`/`PERSIST_FAILED`). El camino idempotente devuelve `ok:true` (reutilizado) o discriminante nuevo, sin romper consumidores (CLI `kodo adopt`, tecla `a` del dashboard, orquestador).
- **D-10:** El backstop vive en `runSessionEndHook` (`src/hooks/session-end.js`). Antes del cleanup terminal (o coordinado): si la tarea sigue «In Progress» y la sesión terminó limpia → `updateTaskState(task, reviewState)` + `createComment("cierre automático")`. Reusa la fontanería de `src/gsd/verify.js:257-265` (resolver `config.providers[provider].states.review`, default `'In review'`, **Pitfall #1: bajo `providers`, NO top-level**).
- **D-11 [gating de estado]:** el backstop solo actúa si `getTaskState()` reporta trigger/«In Progress». Si el LLM ya transicionó, **no-op**.
- **D-12 [«sesión limpia»]:** decidido por `reason`/`end_reason` de SessionEnd. **Recomendado:** fail-open a transicionar salvo fallo explícito. Enumerar los `reason` conocidos y fijar el criterio.
- **D-13 [capability-gating + never-throws]:** todo el backstop es capability-gated por `typeof provider.getTaskState/updateTaskState/createComment === 'function'` y **fail-open por paso** (un fallo de red no crashea el hook ni bloquea cleanup). Emitir evento NDJSON tipado.
- **D-14 [alcance]:** aplica a sesiones trackeadas con tarea de provider (`findSession` con `task_id`/`task_url`). Ad-hoc no adoptadas / orquestador son no-op por el guard `!result` (`:61-64`).

### Claude's Discretion
- Valor exacto del **timeout** de confirmación (D-03) y del backoff/reintento — mientras el vencimiento cuente como reintento, no error fatal.
- Nombre exacto del centinela (`observed` vs `first_tick_done`) y su forma en `cache[key]` (D-04).
- Elección final entre watermark-acotado (a) y hold-total (b) (D-02) — con (a) recomendado.
- Clave y mecanismo exactos del lookup por `task_url` (estado local vs provider-side) y forma del retorno idempotente (D-08).
- Criterio preciso de «reason limpio» según los `end_reason` reales (D-12).
- Ubicación y estilo de los tests (`node:test`).

### Deferred Ideas (OUT OF SCOPE)
- **HYG-04** (mover `color/notify/nudge` de `Stop` a `SessionEnd`) → **Fase 72**. No adelantar; dejar el backstop en un punto del hook que no obstaculice ese movimiento.
- `Retry-After` en 429 del cliente Plane (PLANE-F1/M7) → v2.
- Unificar el carril webhook con la garantía de entrega del polling → **explícitamente rechazado** (webhook confía en re-entrega de Plane).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DELIV-01 | El cursor de polling solo incorpora `updated_at` de un issue a `maxUpdatedAt` si su dispatch resolvió (`await`+timeout); fallido se reintenta; webhook sigue fire-and-forget (A7) | §DELIV-01 (await+timeout+regla de watermark), §Pitfall #1/#2, §Code Examples #1/#2 |
| DELIV-02 | El primer tick distingue "cache ausente" de "primer tick observado" — centinela (M10) | §DELIV-02 (centinela + persistencia sin items), §Runtime State Inventory (migración de shape), §Code Examples #3 |
| DELIV-03 | `adopt` idempotente — busca por `task_url` antes de `createTask` (M11) | §DELIV-03 (lookup local determinista), §Pitfall #5, §Code Examples #4 |
| DELIV-04 | Si al `SessionEnd` la tarea sigue "In Progress" y la sesión terminó limpia → transición a "In Review" + comentario "cierre automático"; backstop mecánico (T5) | §DELIV-04 (backstop capability-gated), §Pitfall #1/#3/#4, §Code Examples #5 |
</phase_requirements>

## Summary

Esta fase convierte cuatro puntos de «best-effort» en cuatro garantías mecánicas, todas sobre fontanería determinista 0-token ya existente. No introduce dependencias nuevas ni un carril LLM: cada requisito reusa un patrón ya probado en el repo (retry-loop de polling, discriminated returns de adopt, transición `states.review` de `verify.js`, capability-gating por `typeof`).

El núcleo técnico —y el punto donde un plan ingenuo fallará— es **DELIV-01/D-02**: el cursor de polling es un **watermark escalar** compartido por todos los issues de un repo. Convertir el dispatch a `await` y «no sumar el `updated_at` del fallido» **no basta**: si un issue fallido tiene `updated_at` menor que uno exitoso posterior, avanzar el watermark al exitoso deja al fallido por debajo del cursor y el filtro `since` (path GitHub) o el comparador local `shouldDispatch` (path provider) lo **excluye para siempre**. La regla correcta es acotar el watermark por debajo de `min(updated_at de fallidos)`. Esto aplica en **ambos** paths de `processRepo`, y en el path provider (Plane, sin `since`) es incluso más crítico porque el único filtro es el comparador local estricto `>`.

Los otros tres son más acotados pero exigen cuidado con los invariantes: DELIV-02 debe persistir el centinela **sin romper** el anti-storm (T-25-04) ni la rama 304; DELIV-03 debe cerrar la ventana `PERSIST_FAILED` **sin** romper los cinco discriminated returns ni los tres consumidores de `adoptSession`; DELIV-04 debe insertar la transición en `session-end.js` de forma capability-gated, fail-open por paso, e idempotente frente al LLM, **y** dejar sitio para el movimiento de HYG-04 en Fase 72.

**Primary recommendation:** Implementar DELIV-01 con la regla de watermark **acotado** (opción a) como pieza más delicada y con mayor cobertura de test; reusar verbatim los patrones de `verify.js` (transición) y del retry-loop de `polling.js` (never-throws) para el resto; todos los cambios de estado persistido (centinela en `polling-state.json`) deben ser retrocompatibles con entradas legacy que no tengan el campo.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Confirmación de entrega de dispatch (DELIV-01) | Trigger/polling (`src/triggers/polling.js`) | Dispatcher (`dispatchTrigger`) | El polling es la única fuente de verdad de su propio cursor; debe garantizar entrega antes de avanzar. El dispatcher ya devuelve un `{action}` discriminado que el polling puede inspeccionar. |
| Distinción cache-ausente vs observado (DELIV-02) | Trigger/polling (state cache `~/.kodo/polling-state.json`) | Persistencia FS (`saveStateCache`) | El centinela es estado de polling; su persistencia atómica ya existe. |
| Idempotencia de creación de tarea (DELIV-03) | Core de adopción (`src/adopt.js`) | Estado local (`state.js` sessions+history) + Provider (fallback url) | La identidad de adopción y su reconciliación viven en la capa determinista; el estado local es la fuente 0-token. |
| Backstop de cierre de ciclo (DELIV-04) | Hook SessionEnd (`src/hooks/session-end.js`) | Provider (Plane `updateTaskState`/`getTaskState`/`createComment`) | El cierre real dispara una vez en SessionEnd; la transición es responsabilidad del provider, gated por capability. |

## Standard Stack

No se introduce **ninguna** dependencia externa nueva. La fase es 100% código interno + `node:test`. El «stack» es el conjunto de módulos internos y APIs de proveedor ya presentes.

### Core (módulos internos reusados)
| Módulo | Rol en esta fase | Por qué es el estándar del repo |
|--------|------------------|--------------------------------|
| `src/triggers/polling.js` | Sede de DELIV-01 y DELIV-02 (`processRepo`, `shouldDispatch`, `saveStateCache`) | Único dueño del cursor de polling; ya tiene retry-loop never-throws y clock inyectable. |
| `src/triggers/dispatcher.js` | `dispatchTrigger` — devuelve `{action}` discriminado que DELIV-01 debe inspeccionar para «confirmar» | Ya es el punto único de dispatch provider-agnostic; sus guards (in-flight, cross-process, already-active) hacen idempotentes los reintentos. |
| `src/adopt.js` | Sede de DELIV-03 (`adoptSession`, `createTask`, `buildSessionFromAdoption`) | Núcleo determinista 0-token con contrato never-throws + 5 discriminantes. |
| `src/session/state.js` | `findSession` (lookup por sessionId/workspaceRef/cwd + history), `listSessions`, `listHistory` | Fuente de verdad local para el lookup de `task_url` de DELIV-03 y la reconstrucción de `task` de DELIV-04. |
| `src/hooks/session-end.js` | Sede de DELIV-04 (`runSessionEndHook`) | Hook que dispara una vez al cierre real; ya tiene outer try/catch never-throws. |
| `src/gsd/verify.js` (`:236-265`) | Patrón de referencia de transición `getTask → addComment → updateTaskState(reviewState)` | Ya resuelve `states.review` correctamente (Pitfall #1) y hace fail-open por paso. **Reusar, no reinventar.** |
| `src/providers/plane/provider.js` | `getTaskState` (`:251`), `updateTaskState` (`:203`), `addComment` (`:223`), `createTask` (`:282`) | Métodos ya implementados; `getTaskState` mapea a `'in_progress'`/`'in_review'`/`'done'`/`'blocked'`/`'unknown'` vía `mapPlaneState`. |

### Supporting
| Módulo | Rol | Cuándo se usa |
|--------|-----|---------------|
| `src/logger-events.js` | Helpers NDJSON tipados (`pollingDispatch`, `pollingError`, `sessionEnd`, …) | DELIV-04 debe emitir un evento tipado nuevo para el cierre automático (D-13). |
| `src/config.js` | Shape de `config.providers[provider].states` (`trigger`/`review`/`done`) | Resolución de `reviewState` en DELIV-04. |
| `src/interface.js` (`TASK_PROVIDER_METHODS`, FROZEN-9) | Define qué métodos están dentro/fuera del contrato congelado | `getTaskState`/`createTask`/`createComment` están **fuera** del 9 → gating obligatorio por `typeof`. |

### Alternatives Considered
| En vez de | Se podría | Tradeoff |
|-----------|-----------|----------|
| Watermark acotado (D-02 opción a) | Hold total del cursor ante cualquier fallo (opción b) | (b) es trivialmente correcta pero re-dispara issues exitosos el tick siguiente (los guards de `dispatchTrigger` los absorben como `already_active`/`ignored`, pero gasta llamadas `getTask`). (a) minimiza pérdida de progreso a costa de más complejidad de test. **Recomendado (a)**; (b) es un fallback aceptable si (a) resulta frágil. |
| Lookup de `task_url` en estado local (D-08) | Lookup provider-side por url | Provider-side rompe el 0-token/determinismo y añade una llamada de red por adopt. Local es coherente con la arquitectura; provider-side solo como fallback si la identidad no es recuperable localmente. |
| `getTaskState()` para el gate (D-11) | Leer `session.status` local | `session.status` local puede estar desincronizado con Plane (el LLM pudo transicionar sin que kodo lo sepa). `getTaskState()` lee el estado **vivo** → única fuente fiable para el gate idempotente. |

**Installation:** N/A — no hay paquetes que instalar.

**Version verification:** N/A — sin dependencias externas nuevas. Los módulos internos se verificaron por lectura directa el 2026-07-07 (anchors abajo). `[VERIFIED: lectura de código 2026-07-07]`

## Package Legitimacy Audit

No aplica: esta fase **no instala ningún paquete externo**. Todo el trabajo es sobre módulos internos ya presentes y la stdlib de Node (`node:fs`, `node:path`, `node:test`, `node:assert`). No hay superficie de slopsquatting.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────── DELIV-01 / DELIV-02 (carril polling) ───────────────┐
                          │                                                                     │
  tick() ──► processRepo(owner,repo,cache) ──► [client.listIssues(since,etag)  path A]          │
                          │                    [provider.listPendingTasks()     path B]          │
                          │                            │                                         │
                          │                    ┌───────┴────────┐                                │
                          │        304 (path A)│                │ 200 / items                    │
                          │        preserva    │                ▼                                │
                          │        cursor,     │      por cada issue (no-PR):                     │
                          │        no escribe  │        shouldDispatch(issue,prev)?               │
                          │                    │            │ sí                                  │
                          │                    │            ▼                                     │
                          │        DELIV-01:    await dispatchFn(...) con TIMEOUT                  │
                          │                    │        ┌───┴────┐                                │
                          │                    │   OK   │        │ reject / timeout               │
                          │                    │        ▼        ▼                                │
                          │            candidato a watermark   NO avanza sobre este issue         │
                          │                    │        │   (registra updated_at en "fallidos")  │
                          │                    │        ▼                                         │
                          │        DELIV-01/D-02: newCursor = max(exitosos) ACOTADO A            │
                          │                        < min(updated_at de fallidos)                  │
                          │        DELIV-02: cache[key] = {last_updated_at, etag?, observed:true} │
                          │                        (se escribe SIEMPRE tras 1er tick, con o sin   │
                          │                         items; nunca en la rama 304)                  │
                          └─────────────────────────────────────────────────────────────────────┘

  ─────────────── DELIV-03 (adopt idempotente) ───────────────
  adoptSession(...) ──► gate typeof createTask ──► guard sessionId (ALREADY_ADOPTED)
                    ──► NUEVO: lookup por task_url en state.json (sessions+history)
                            │ encontrado                    │ no encontrado
                            ▼                                ▼
                       reconcilia/reutiliza            createTask (POST) ──► addSession
                       (ok:true, sin createTask)              │ throw addSession
                                                              ▼
                                                       PERSIST_FAILED{task_url} ──(re-run)──► lookup lo encuentra

  ─────────────── DELIV-04 (backstop In Review) ───────────────
  runSessionEndHook(input) ──► findSession(sessionId,cwd) ──► guards (!result / history)
                    ──► reconstruye task desde SessionRecord (task_id/task_ref/project_id/task_url)
                    ──► NUEVO backstop (capability-gated, fail-open por paso):
                            typeof getTaskState/updateTaskState/createComment === 'function' ?
                            estado == in_progress/trigger  &&  reason limpio ?
                                ──► updateTaskState(task, reviewState) + createComment("cierre automático")
                                ──► emite NDJSON tipado
                    ──► session.end event (existente) ──► lock release ──► performTerminalCleanup
```

### Component Responsibilities
| Símbolo / archivo | Responsabilidad tras la fase |
|-------------------|------------------------------|
| `processRepo` (`polling.js:246-448`) | Await del dispatch con timeout; separar issues en «exitosos/no-dispatch» vs «fallidos»; calcular watermark acotado; escribir centinela. |
| `shouldDispatch` (`polling.js:172-175`) | Cambiar de `!prev.last_updated_at` a un check del **centinela** (`prev.observed !== true`) para el skip de primer tick. |
| `saveStateCache` (`polling.js:149-154`) | Sin cambios de firma; ahora persiste también el campo `observed`. |
| `adoptSession` (`adopt.js:196-300`) | Insertar el lookup por `task_url` entre el guard `sessionId` (`:245`) y `createTask` (`:259`). |
| `runSessionEndHook` (`session-end.js:50-125`) | Insertar el backstop de transición antes de `performTerminalCleanup`, dentro del outer try/catch. |

### Recommended Project Structure
No hay estructura nueva. Los cinco archivos ya existen; los tests van en sus ubicaciones espejo:
```
src/triggers/polling.js        # DELIV-01, DELIV-02
src/adopt.js                   # DELIV-03
src/hooks/session-end.js       # DELIV-04
test/triggers/polling.test.js  # DELIV-01, DELIV-02 (42 it() actuales — añadir casos)
test/adopt.test.js             # DELIV-03 (28 it() actuales — añadir la ventana PERSIST_FAILED)
test/hooks/session-end.test.js # DELIV-04 (5 it() actuales — añadir el backstop)
```

### Pattern 1: Transición a review reusable (referencia viva = `verify.js:257-265`)
**What:** Resolver el nombre del estado review bajo `providers[provider]` y transicionar + comentar, cada paso en su propio try/catch fail-open.
**When to use:** DELIV-04, verbatim.
```javascript
// Source: src/gsd/verify.js:258-265 [VERIFIED: lectura de código 2026-07-07]
// Pitfall #1: config.providers[provider].states.review — NO top-level.
const config = loadConfigFn();
const providerName = session.provider || config.provider;
const providerCfg = (config.providers && config.providers[providerName]) || {};
const reviewState = (providerCfg.states && providerCfg.states.review) || 'In review';
try {
  await provider.updateTaskState(task, reviewState);
} catch (err) { /* fail-open por paso: log + continuar */ }
```

### Pattern 2: Capability-gating por `typeof` (métodos fuera de FROZEN-9)
**What:** `createTask`, `getTaskState`, `createComment` NO están en `TASK_PROVIDER_METHODS`. Detectar en el call site.
**When to use:** DELIV-04 (gate del backstop) y como precedente para DELIV-03.
```javascript
// Source: src/adopt.js:207 + interface.js:52 [VERIFIED: lectura de código 2026-07-07]
if (!provider || typeof provider.updateTaskState !== 'function'
    || typeof provider.getTaskState !== 'function'
    || typeof provider.createComment !== 'function') {
  return; // degrade silenciosamente (GitHub no transiciona como Plane)
}
```

### Pattern 3: Discriminated returns never-throws (adopt)
**What:** Todo camino devuelve `{ok:true,...}` o `{ok:false, code, detail}`; nunca throw.
**When to use:** DELIV-03 — el camino idempotente encaja como `{ok:true, task, session, reused:true}` o discriminante nuevo.

### Anti-Patterns to Avoid
- **«No sumar el `updated_at` del fallido» a secas (DELIV-01).** Insuficiente: deja al fallido por debajo del watermark si otro exitoso posterior lo eleva. Hay que **acotar** el watermark bajo `min(fallidos)`. Ver Pitfall #2.
- **Usar `!prev.last_updated_at` como señal de primer tick (DELIV-02).** Es exactamente el bug M10: confunde «cache ausente» con «cursor legítimamente vacío». Usar el centinela explícito.
- **`await` del dispatch sin timeout (DELIV-01).** Un dispatch colgado congelaría el tick entero (recursive setTimeout ⇒ no hay siguiente tick). El timeout es obligatorio (D-03).
- **Transicionar en el backstop sin `getTaskState()` (DELIV-04).** Rompería la idempotencia frente al LLM (D-11): re-comentaría/re-transicionaría una tarea ya en review.
- **Añadir un throw en el backstop (DELIV-04).** Crashearía el hook SessionEnd de Claude Code. Fail-open por paso (D-13).
- **Bloquear/reordenar el cleanup terminal por el backstop (DELIV-04).** Fase 72 (HYG-04) moverá `color/notify/nudge` a este mismo hook; el backstop debe ir en un punto que no obstaculice ese movimiento (colocarlo **antes** de `performTerminalCleanup`, tras los guards de idempotencia, es lo más limpio).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timeout de una promesa (DELIV-01) | Un scheduler de timeouts a mano | `Promise.race([dispatchFn(...), timeoutPromise])` con el **clock inyectable** ya presente (`sleep(clock, ms)` en `polling.js:203`) | El clock mock (`createTestClock`, `polling.test.js:60`) ya controla el tiempo virtual; reusarlo mantiene los tests deterministas y sin timers reales. |
| Escritura atómica del state cache (DELIV-02) | Un tmp+rename nuevo | `saveStateCache` (`polling.js:149`) | Ya hace tmp+rename POSIX; el centinela es un campo más en el mismo objeto. |
| Lookup de sesión por identidad (DELIV-03/04) | Un scan manual de `state.json` | `findSession({sessionId})` / `listSessions()` / `listHistory()` (`state.js`) | `findSession` ya escanea sessions **y** history con prioridad correcta; DELIV-03 puede extender la query o hacer un scan de `task_url` sobre esas mismas fuentes. |
| Resolución del nombre de estado review (DELIV-04) | Leer config a mano | El bloque de `verify.js:258-262` | Ya evita el Pitfall #1 (`providers[provider].states`, no top-level). |
| Mapear estado Plane → semántica (DELIV-04) | Parsear el nombre de estado | `getTaskState()` → `mapPlaneState` (`provider.js:76-92`) | Ya devuelve `'in_progress'`/`'in_review'`/`'done'`/`'blocked'`/`'unknown'`; el gate es una comparación contra `'in_progress'`. |

**Key insight:** Los cinco archivos ya contienen el 90% de la fontanería. El riesgo NO está en construir mecanismos nuevos, sino en **componer los existentes sin violar sus invariantes** (anti-storm, never-throws, discriminated returns, FROZEN-9, Pitfall #1).

## Runtime State Inventory

> DELIV-02 **cambia el shape** de las entradas de `~/.kodo/polling-state.json` (añade `observed`). DELIV-03 **lee** `state.json`. Esto exige análisis de retrocompatibilidad.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (shape mutation) | `~/.kodo/polling-state.json`: hoy cada entrada es `{ last_updated_at?, etag? }` (`polling.js:121`). DELIV-02 añade `observed?: boolean` (o `first_tick_done?`). | **Retrocompat, no migración destructiva.** `loadStateCache` ya hace fail-open a `{}` ante shape inválido, pero NO valida campos internos. Una entrada legacy sin `observed` debe tratarse como **cache ausente** (primer tick → skip+poblar+marcar), lo cual es el comportamiento seguro por defecto. Verificar que `shouldDispatch` con `prev.observed===undefined` haga skip (no dispatch). **No** se requiere script de migración: la primera pasada tras el deploy re-marca cada repo. Documentar que un repo con backlog histórico observado bajo el esquema viejo hará **un** primer-tick-skip extra tras el upgrade (aceptable, anti-storm lo cubre). |
| Stored data (read-only) | `~/.kodo/state.json`: `sessions{}` + `history[]`, cada `Session` con `task_id`, `task_ref`, `task_url`, `project_id` (`adopt.js:146-160`). | DELIV-03 **lee** `task_url` de aquí para el lookup idempotente; DELIV-04 reconstruye el `task` (TaskItem) desde estos campos. Sin migración: solo lectura. Confirmar que las filas creadas por `buildSessionFromAdoption` siempre pueblan `task_url` (`:158`, `task.url`) — sí lo hacen. |
| Live service config | Ninguno propio de la fase. El estado de la tarea en Plane (columna workflow) NO se cachea de forma persistente para el gate — `getTaskState()` lo lee vivo (cache de 30s en el resolver de `/status`, no en el hook). | None — verificado: el backstop lee estado vivo vía `getTaskState`, no depende de estado cacheado en disco. |
| OS-registered state | Ninguno. La fase no registra tasks del SO, procesos pm2/launchd ni nada persistente fuera de los dos JSON anteriores. | None — verificado por lectura de los tres módulos de sede. |
| Secrets/env vars | Un posible env/config nuevo para el **timeout** de dispatch (D-03), p.ej. `config.polling.dispatch_timeout_ms`. No es secreto. | Añadir con default sensato (recomendado 30000 ms) y DI para tests. No requiere `chmod`/SOPS. |
| Build artifacts | Ninguno. Sin cambios en `pyproject`/`package.json` deps ni binarios. | None. |

**Nothing found in categories OS-registered / Live-service-persisted / Secrets(secret) / Build:** State explícito arriba.

## Common Pitfalls

### Pitfall 1: `states.review` bajo `providers[provider]`, NUNCA top-level (DELIV-04)
**What goes wrong:** Leer `config.states.review` (top-level) devuelve `undefined` → el backstop transiciona a `'In review'` por defecto aunque el operador configuró otro nombre, o falla al resolver el estado.
**Why it happens:** Hay DOS shapes en el repo: `config.states.trigger` (top-level, usado por `createTask`/`listPendingTasks` en `plane/provider.js:289,378`) y `config.providers[provider].states.review` (usado por `verify.js`/`session-start.js`). Son **distintos**.
**How to avoid:** Copiar verbatim `verify.js:258-262`. `[VERIFIED: código 2026-07-07]`
**Warning signs:** El estado configurado por el operador se ignora; test con config custom de `review` falla.

**Nota adicional de inconsistencia (documentar, no necesariamente arreglar):** `verify.js:262` usa default `'In review'` (r minúscula) mientras `session-start.js:29` usa `'In Review'` (R mayúscula). El default de `config.js` es `'In review'`. Para el backstop usar `'In review'` (coherente con `verify.js` y con el default de config). `[VERIFIED: código 2026-07-07]`

### Pitfall 2: Watermark escalar y el issue fallido «por debajo» (DELIV-01/D-02) — LA trampa central
**What goes wrong:** Un tick trae issues A(`updated_at=10:00`, dispatch **falla**) y B(`updated_at=10:05`, dispatch **OK**). Si el watermark avanza a `10:05`, el siguiente tick usa `since=10:05` (path GitHub) o `shouldDispatch(A)= A.updated_at > 10:05 = false` (path provider) → **A nunca se reintenta**. El «reintento el tick siguiente» de DELIV-01 queda anulado.
**Why it happens:** El cursor es un único escalar por repo (`maxUpdatedAt`, `polling.js:332,340-342`), compartido por todos los issues. Avanzarlo al máximo exitoso «entierra» cualquier fallido con timestamp menor.
**How to avoid:** Regla de watermark **acotado** (D-02 opción a): recolectar `failedUpdatedAts[]` durante el loop; `newCursor = max({ updated_at de exitosos/no-dispatch : updated_at < min(failedUpdatedAts) })`; si ese conjunto es vacío, **no avanzar** (mantener `prev.last_updated_at`). Alternativa correcta y simple (opción b): si `failedUpdatedAts.length > 0`, no persistir cursor nuevo este tick. **Aplica a AMBOS paths** — en el path provider (sin `since`) es aún más crítico porque el comparador local estricto `>` es el único filtro.
**Warning signs:** Test con [A-falla-antes, B-ok-después] donde A no re-dispara en el 2º tick.

### Pitfall 3: Semántica de `since` (GitHub) vs comparador local estricto (DELIV-01)
**What goes wrong:** Elegir mal el epsilon/comparador al acotar el watermark, re-disparando o saltando el issue de la frontera.
**Why it happens:** La doc de GitHub describe `since` como «results that were last updated **after** the given time» `[CITED: docs.github.com/en/rest/issues/issues]` — literalmente exclusivo. Empíricamente, sin embargo, es común que `since` sea inclusivo (`>=`) en issues, y el repo NO confía en ello: usa un segundo filtro **local** estricto `shouldDispatch: updated_at > prev.last_updated_at` (`polling.js:174`) como gate preciso. `[VERIFIED: código 2026-07-07]` Es decir, el `since` es un **pre-filtro grueso** y el comparador local es la verdad.
**How to avoid:** No depender de la inclusividad exacta de `since`. Diseñar la regla de watermark de modo que el comparador **local** `>` siga siendo la verdad: para garantizar que A(fallido) re-dispare, el cursor debe quedar **estrictamente menor** que `A.updated_at`. Por eso «cap bajo `min(fallidos)`» significa el mayor exitoso **estrictamente menor** que `min(fallidos)`; nunca igualar el cursor a `min(fallidos)` (el `>` local lo excluiría). En el path provider, `listPendingTasks` no usa `since` en absoluto → solo importa el comparador local, y la misma regla aplica idéntica.
**Warning signs:** El issue con `updated_at === cursor` se salta o se re-dispara inesperadamente en un test de frontera.

### Pitfall 4: Dispatch colgado congela el loop recursivo (DELIV-01)
**What goes wrong:** `await dispatchFn(...)` sin timeout, con un dispatch que nunca resuelve, bloquea `processRepo` → `tick()` no llega a `clock.setTimeout(tick, intervalMs)` → el daemon deja de pollear silenciosamente.
**Why it happens:** El loop es recursive setTimeout por diseño (previene ticks solapados, Pitfall #4 del header de `polling.js`); un await sin cota rompe esa cadena.
**How to avoid:** `Promise.race` con un timeout basado en `clock.setTimeout` (mockeable). El vencimiento cuenta como dispatch **no confirmado** (issue va a `failedUpdatedAts`), nunca como throw (D-03). Default recomendado 30000 ms.
**Warning signs:** Un test con dispatch que nunca resuelve debe terminar por timeout y clasificar el issue como fallido, no colgar el test.

### Pitfall 5: La ventana `PERSIST_FAILED` y de dónde viene el `task_url` (DELIV-03)
**What goes wrong:** El re-run de recuperación llama a `createTask` otra vez → tarea duplicada en Plane, porque el guard existente solo mira `sessionId` (`adopt.js:245`) y en la ventana `PERSIST_FAILED` **no hay fila local** (el `addSession` falló, `:284`), así que `findSession({sessionId})` no encuentra nada.
**Why it happens:** `createTask` (`:259`) tuvo éxito pero `addSession` (`:284`) lanzó → return `PERSIST_FAILED` con `task_url` (`:288-294`). La tarea existe en el provider pero no localmente. Un re-run con el mismo `sessionId` pasa el guard (no hay fila) y re-crea.
**How to avoid:** Antes de `createTask`, hacer un lookup por `task_url`:
- **Fuente primaria (0-token, recomendada):** si el caller del re-run de recuperación pasa el `task_url` que recibió en el `PERSIST_FAILED` (el detalle lo lleva, `:291`), `adoptSession` acepta un `task_url` opcional en args; si está presente, **reconcilia** (reconstruye la fila local y hace `addSession` sin `createTask`) y devuelve `{ok:true, reused:true}`.
- **Fuente secundaria (barrido local):** escanear `sessions{}`+`history[]` (`listSessions`/`listHistory`) buscando una fila con ese `task_url` — cubre el caso de re-adopción de una tarea ya adoptada cuya fila SÍ se persistió.
- **Fallback (provider-side por url):** solo si la identidad no es recuperable localmente; rompe el 0-token, usar únicamente como último recurso.

**Detalle crítico a reproducir en test:** el `task_url` en el path recuperación viene del **detalle del `PERSIST_FAILED` que el caller guardó**, no del estado local (que no existe en esa ventana). El barrido local cubre el OTRO caso (fila ya persistida). Ambos caminos deben existir. `[VERIFIED: código adopt.js:283-294 2026-07-07]`
**Warning signs:** Test: adopt que crea tarea + `addSession` inyectado que throw → `PERSIST_FAILED` → re-run con el `task_url` devuelto → assert **exactamente un** `createTask`.

### Pitfall 6: Reconstruir el `task` (TaskItem) desde la SessionRecord (DELIV-04)
**What goes wrong:** `updateTaskState(task, state)` y `getTaskState({id, projectId})` esperan un objeto con `{id, projectId}` (Plane, `provider.js:203,251`), pero la SessionRecord no es un TaskItem — hay que reconstruirlo.
**Why it happens:** El backstop parte de `session` (SessionRecord), no de un TaskItem. `getTaskState` usa `{id, projectId}`; `updateTaskState` usa `task.projectId` + `task.id`.
**How to avoid:** Dos opciones:
- **(preferida, más fiel)** `provider.getTask(session.task_ref)` — exactamente lo que hace `verify.js:237` — devuelve un TaskItem canónico completo, y de paso confirma que la tarea existe. Coste: una llamada de red extra.
- **(0-red)** construir un TaskItem mínimo `{ id: session.task_id, projectId: session.project_id, url: session.task_url, ref: session.task_ref }` desde la SessionRecord (`buildSessionFromAdoption` garantiza esos campos). Suficiente para `getTaskState`/`updateTaskState` de Plane, que solo leen `id`/`projectId`. `addComment` de Plane usa `task.projectId`+`task.id` (`provider.js:223-225`) → también basta.
**Recomendación:** usar el TaskItem mínimo reconstruido (0-red, coherente con el resto del hook que ya opera sobre la SessionRecord); reservar `getTask` solo si algún método del provider necesita más campos. Verificar con el mock del provider en test.
**Warning signs:** `updateTaskState` falla con `undefined` en `task.projectId`.

### Pitfall 7: Secuenciación con Fase 72 / HYG-04 (DELIV-04)
**What goes wrong:** Colocar el backstop en un punto de `session-end.js` que HYG-04 tendrá que reordenar → conflicto de merge y re-trabajo.
**Why it happens:** HYG-04 (Fase 72) moverá `color/notify/nudge` de `Stop` a `SessionEnd`, tocando el mismo hook.
**How to avoid:** Insertar el backstop como un bloque autónomo **tras los guards de idempotencia** (`:61-72`) y **antes** de `performTerminalCleanup` (`:115`), sin entrelazarlo con el `session.end` event ni el lock release. Así HYG-04 puede añadir sus piezas alrededor sin tocar el backstop.

## Code Examples

### Ejemplo 1: Await del dispatch con timeout (DELIV-01)
```javascript
// Source: patrón derivado de polling.js:203 (sleep) + dispatcher return shape [VERIFIED: código 2026-07-07]
// dispatchFn devuelve Promise<{action: 'launched'|'ignored'|'already_active'|...}> (dispatcher.js:46)
// "Confirmado" = la promesa RESUELVE (cualquier action) antes del timeout.
// "Fallido"    = rechaza O vence el timeout.
const DISPATCH_TIMEOUT_MS = opts.dispatchTimeoutMs ?? 30000; // D-03, configurable
async function confirmDispatch(event, clock) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = clock.setTimeout(() => reject(new Error('dispatch-timeout')), DISPATCH_TIMEOUT_MS);
  });
  try {
    await Promise.race([dispatchFn(event, {}), timeout]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  } finally {
    clock.clearTimeout(timer);
  }
}
```

### Ejemplo 2: Regla de watermark acotado (DELIV-01/D-02, opción a)
```javascript
// Source: diseño para polling.js processRepo loop [VERIFIED contra semántica shouldDispatch:174]
let maxUpdatedAt = prev.last_updated_at || '';
const failedUpdatedAts = [];
for (const issue of result.items) {
  if (issue.pull_request) continue;
  const willDispatch = shouldDispatch(issue, prev);
  if (!willDispatch) {
    // no-dispatch (ya visto): candidato normal al watermark
    if (issue.updated_at && issue.updated_at > maxUpdatedAt) maxUpdatedAt = issue.updated_at;
    continue;
  }
  const res = await confirmDispatch({ taskRef: task.ref, action: 'polling', provider: 'github', raw: issue }, clock);
  if (res.ok) {
    if (issue.updated_at && issue.updated_at > maxUpdatedAt) maxUpdatedAt = issue.updated_at;
    dispatched++;
  } else {
    // fallido: NO sube el watermark; se registra para acotar
    if (issue.updated_at) failedUpdatedAts.push(issue.updated_at);
    pollingError(logger, { owner, repo, status: 0, attempt: 0, error: 'dispatch-unconfirmed' });
  }
}
// D-02: acotar el cursor por debajo del menor fallido (comparación de strings ISO 8601 = orden lexicográfico correcto)
let newCursor = maxUpdatedAt;
if (failedUpdatedAts.length > 0) {
  const minFailed = failedUpdatedAts.reduce((a, b) => (a < b ? a : b));
  // el mayor updated_at exitoso ESTRICTAMENTE menor que minFailed; si maxUpdatedAt >= minFailed, retrocede a prev
  newCursor = maxUpdatedAt < minFailed ? maxUpdatedAt : (prev.last_updated_at || '');
}
```
> Nota: las comparaciones son sobre strings ISO 8601 (`YYYY-MM-DDTHH:MM:SSZ`), cuyo orden lexicográfico coincide con el cronológico — es exactamente lo que ya hace `shouldDispatch`/`classifyPattern`. No parsear a `Date` salvo necesidad. Si hay varios exitosos entre `prev` y `minFailed`, la opción (a) más precisa recorre y toma el mayor exitoso `< minFailed`; la versión simplificada de arriba retrocede a `prev` si el máximo global cruza `minFailed` (correcta pero pierde algo de progreso — aceptable, equivale a un (a)/(b) híbrido).

### Ejemplo 3: Centinela de primer tick (DELIV-02)
```javascript
// Source: diseño para polling.js shouldDispatch + processRepo [VERIFIED contra :173, :391-395]
// (1) shouldDispatch pasa a mirar el centinela, no last_updated_at:
function shouldDispatch(task, prev) {
  if (prev.observed !== true) return false; // primer tick real: no dispara (T-25-04)
  return task.updated_at > (prev.last_updated_at || '');
}
// (2) el centinela se escribe SIEMPRE tras procesar el repo (con o sin items), en el path 200:
cache[key] = {
  last_updated_at: newCursor || prev.last_updated_at,
  observed: true,                                   // D-05: se marca aunque items = []
  ...(result.etag ? { etag: result.etag } : {}),
};
saveStateCache(cache, statePath); // atómico (D-05)
// (3) rama 304: NO tocar cache (D-06) — sigue devolviendo sin escribir.
```
> Retrocompat (Runtime State Inventory): una entrada legacy `{last_updated_at}` sin `observed` cae en `prev.observed !== true` → se trata como primer tick (skip+poblar+marcar). Comportamiento seguro; anti-storm lo cubre.

### Ejemplo 4: Lookup idempotente por task_url (DELIV-03)
```javascript
// Source: diseño para adopt.js, entre :248 (guard sessionId) y :253 (createTask) [VERIFIED]
// (a) recuperación explícita: el caller pasa el task_url del PERSIST_FAILED previo
if (typeof knownTaskUrl === 'string' && knownTaskUrl.length > 0) {
  // reconstruye/reconcilia SIN createTask; reintenta solo el addSession
  const reconciledTask = { id: knownTaskId, url: knownTaskUrl, projectId, ... };
  const session = buildSessionFromAdoption({ task: reconciledTask, providerName, workspaceRef, cwd, sessionId, projectPath });
  try { addSessionFn(reconciledTask.id, session); }
  catch (err) { return { ok: false, code: 'PERSIST_FAILED', detail: { task_id: reconciledTask.id, task_url: knownTaskUrl, hint: 'recoverable via idempotent re-run', message: err?.message ?? String(err) } }; }
  return { ok: true, task: reconciledTask, session, reused: true };
}
// (b) barrido local: fila ya persistida con ese task_url (re-adopción de tarea ya adoptada)
const localMatch = [...listSessionsFn(), ...listHistoryFn()].find((s) => s.task_url && s.task_url === candidateTaskUrl);
if (localMatch) return { ok: false, code: 'ALREADY_ADOPTED', detail: { task_id: localMatch.task_id } };
// (c) si no hay task_url conocido ni match local → flujo normal createTask (sin cambios)
```
> El planner decide si el retorno reutilizado es `{ok:true, reused:true}` (D-08/D-09) o un discriminante nuevo. Debe verificar que CLI `kodo adopt`, tecla `a` del dashboard y orquestador no rompan al ver `reused:true` (los tres ya distinguen `ok:true`/`ok:false`).

### Ejemplo 5: Backstop In Review en SessionEnd (DELIV-04)
```javascript
// Source: diseño para session-end.js, tras guards (:72) y antes de performTerminalCleanup (:115) [VERIFIED]
// Reusa verify.js:258-265 para reviewState. Capability-gated + fail-open por paso.
async function runReviewBackstop({ session, input, provider, config, log }) {
  if (!provider
      || typeof provider.getTaskState !== 'function'
      || typeof provider.updateTaskState !== 'function'
      || typeof provider.addComment !== 'function') return; // D-13 gate (GitHub degrada)
  // D-12: "sesión limpia" = fail-open. SessionEnd solo dispara en cierres no-crash;
  // reason ∈ {clear, logout, prompt_input_exit, bypass_permissions_disabled, other}.
  // No hay reason que signifique crash (un crash no dispara SessionEnd limpio).
  // Transicionar salvo que un futuro reason señale fallo explícito.
  const task = { id: session.task_id, projectId: session.project_id, url: session.task_url, ref: session.task_ref };
  let state;
  try { state = await provider.getTaskState(task); }
  catch (err) { log.warn('session.backstop.getstate_failed', { error: err?.message }); return; } // fail-open: sin estado, no arriesgar
  if (state !== 'in_progress') return; // D-11: idempotente frente al LLM (ya en review/done → no-op)
  const providerName = session.provider || config.provider;
  const providerCfg = (config.providers && config.providers[providerName]) || {};
  const reviewState = (providerCfg.states && providerCfg.states.review) || 'In review'; // Pitfall #1
  try { await provider.updateTaskState(task, reviewState); }
  catch (err) { log.warn('session.backstop.transition_failed', { error: err?.message }); return; }
  try { await provider.addComment(task, 'cierre automático'); }
  catch (err) { log.warn('session.backstop.comment_failed', { error: err?.message }); }
  log.info('session.backstop.review', { session_id: session.session_id, task_id: session.task_id, from: 'in_progress', to: reviewState }); // D-13 NDJSON tipado
}
```
> El `provider`/`config`/`log` se inyectan como deps (mismo patrón que `runSessionEndHook` ya usa para `findSessionFn`/`loggerFactory`/`gitFn`). Nota Plane: `addComment` es el método del contrato (`interface.js:56`), no `createComment` — el header de CONTEXT menciona `createComment` (nombre del cliente); en el provider de Plane el método público es `addComment` (`provider.js:223`) que internamente llama `client.createComment`. **Usar `provider.addComment`.** `[VERIFIED: código 2026-07-07]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dispatch del polling fire-and-forget (`.catch()`, `polling.js:362-383`) | `await`+timeout con confirmación antes de avanzar cursor | Esta fase (DELIV-01) | El cursor solo avanza sobre entregas confirmadas; el webhook conserva fire-and-forget (Plane re-entrega). |
| Primer tick inferido de `!prev.last_updated_at` (`:173`) | Centinela explícito `observed` desacoplado del cursor | Esta fase (DELIV-02) | Distingue cache-ausente de cursor-vacío; evita storms diferidos. |
| Idempotencia de adopt solo por `sessionId` (`:245`) | + lookup por `task_url` antes de `createTask` | Esta fase (DELIV-03) | Cierra la ventana PERSIST_FAILED / re-adopción → sin tareas duplicadas. |
| Cierre de ciclo delegado 100% al LLM | Backstop mecánico en SessionEnd (LLM = optimización) | Esta fase (DELIV-04, decisión de producto 2026-07-05) | La tarea nunca queda colgada en «In Progress»; el mecanismo es el suelo. |

**Deprecated/outdated:** El comentario «NEVER `await`» en `polling.js:362` deja de aplicar al carril polling (sigue vigente para `webhook.js`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Los valores de `reason` de SessionEnd son `{clear, logout, prompt_input_exit, bypass_permissions_disabled, other}` y ninguno representa un crash (un crash no dispara SessionEnd limpio) | DELIV-04 / D-12 | Bajo. Si apareciera un `reason` de fallo, el fail-open podría transicionar una tarea de una sesión abortada; coste = un humano la devuelve de «In Review». Es exactamente el tradeoff que D-12 acepta. Fuente: docs Claude Code (WebSearch). |
| A2 | GitHub `since` en issues es tratado por el repo como pre-filtro grueso; la verdad es el comparador local estricto `>` (`shouldDispatch`) | DELIV-01 / Pitfall #3 | Bajo. La doc dice «after» (exclusivo) `[CITED]`; el diseño de watermark acotado NO depende de la inclusividad exacta porque el gate local `>` decide. Verificable con un test de frontera. |
| A3 | Reconstruir un TaskItem mínimo `{id, projectId, url, ref}` basta para `getTaskState`/`updateTaskState`/`addComment` de Plane | DELIV-04 / Pitfall #6 | Medio. Si algún método leyera más campos del TaskItem, habría que usar `provider.getTask(task_ref)`. Mitigable: verificar con el mock del provider en test; fallback trivial a `getTask`. |
| A4 | Default de timeout de dispatch = 30000 ms es sensato | DELIV-01 / D-03 | Bajo. Es discreción del planner (D-03); ajustable por config/DI. |

## Open Questions

1. **¿Retorno idempotente de DELIV-03: `{ok:true, reused:true}` o discriminante nuevo?**
   - What we know: los 3 consumidores distinguen `ok:true`/`ok:false`; `ALREADY_ADOPTED` ya existe para el caso sessionId.
   - What's unclear: si el caso «reconciliado tras PERSIST_FAILED» debe ser `ok:true` (la adopción efectivamente quedó completa) o un discriminante propio para observabilidad.
   - Recommendation: `{ok:true, reused:true}` para el camino de reconciliación exitosa (la sesión SÍ queda adoptada); reservar `ALREADY_ADOPTED` para el barrido local que detecta una fila ya viva. Confirmar en discuss/plan.

2. **¿Opción (a) precisa (recorrer exitosos < minFailed) vs simplificada (retroceder a prev si el máx cruza minFailed)?**
   - What we know: ambas son correctas (garantizan re-dispatch del fallido); difieren en progreso conservado.
   - What's unclear: si el coste de complejidad de la versión precisa vale la pena vs (b) hold-total.
   - Recommendation: empezar con la versión que retrocede a `prev` ante cualquier cruce (cercana a (b) pero conserva progreso cuando todos los exitosos están por debajo de los fallidos); es la de menor superficie de bug. Medir si hace falta la precisión de (a) plena.

3. **¿El backstop reconstruye el TaskItem o llama `getTask`?**
   - Recommendation: TaskItem mínimo reconstruido (0-red); ver A3/Pitfall #6.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (ESM, `node:test`) | Toda la fase | ✓ | runtime del repo | — |
| `node --test` runner | Suite de tests | ✓ | script `npm test` (`package.json`) | — |
| Provider Plane (métodos `getTaskState`/`updateTaskState`/`addComment`/`createTask`) | DELIV-03, DELIV-04 (en runtime real) | ✓ (en tests: mock) | `src/providers/plane/provider.js` | GitHub degrada por capability-gating (DELIV-04 no-op) |

**Missing dependencies with no fallback:** Ninguna.
**Missing dependencies with fallback:** GitHub provider no implementa transición de estado como Plane → el backstop de DELIV-04 hace no-op por `typeof` gate (comportamiento correcto por diseño, D-13).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + `node:assert/strict` |
| Config file | none — se descubre por `find test -name '*.test.js'` |
| Quick run command | `node --test test/triggers/polling.test.js test/adopt.test.js test/hooks/session-end.test.js` |
| Full suite command | `npm test` (= `node --test $(find test -name '*.test.js' -type f)`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DELIV-01 | dispatch que rechaza → su `updated_at` NO entra en cursor; se reintenta el tick siguiente | unit | `node --test test/triggers/polling.test.js` | ✅ (42 it() — añadir casos) |
| DELIV-01 | dispatch que **timeout** (nunca resuelve) → clasificado fallido vía clock virtual, no cuelga | unit | idem | ✅ |
| DELIV-01/D-02 | [A-falla `10:00`, B-ok `10:05`] → 2º tick RE-dispara A (watermark acotado bajo `min(fallidos)`) | unit | idem | ✅ |
| DELIV-01 | webhook.js intacto (sigue fire-and-forget) | unit | `node --test test/webhook.test.js` | ✅ |
| DELIV-02 | primer tick (cache ausente) → NO dispara, marca `observed`, puebla cursor | unit | `node --test test/triggers/polling.test.js` | ✅ |
| DELIV-02 | primer tick **sin items** → igualmente persiste `observed:true` (no re-storm futuro) | unit | idem | ✅ |
| DELIV-02 | 2º tick (observado, cursor vacío) → dispatch normal, no re-dispara todo lo visto | unit | idem | ✅ |
| DELIV-02 | rama 304 → cursor preservado, cache NO escrito (invariante D-06) | unit | idem | ✅ |
| DELIV-02 | entrada legacy sin `observed` → tratada como primer tick (retrocompat) | unit | idem | ✅ |
| DELIV-03 | adopt crea tarea + `addSession` inyectado throw → `PERSIST_FAILED{task_url}` → re-run con ese url → **un solo** `createTask` | unit | `node --test test/adopt.test.js` | ✅ (28 it() — añadir) |
| DELIV-03 | re-adopción de tarea ya adoptada (fila viva con ese `task_url`) → sin duplicado | unit | idem | ✅ |
| DELIV-03 | los 5 discriminated returns siguen intactos + never-throws | unit | idem | ✅ |
| DELIV-04 | sesión con tarea `in_progress` + provider mock + reason limpio → `updateTaskState(review)` + `addComment('cierre automático')` + evento NDJSON | unit | `node --test test/hooks/session-end.test.js` | ✅ (5 it() — añadir) |
| DELIV-04 | tarea ya en `in_review`/`done` (LLM ya transicionó) → no-op (idempotencia D-11) | unit | idem | ✅ |
| DELIV-04 | provider sin `getTaskState`/`updateTaskState` (GitHub) → no-op por capability-gate | unit | idem | ✅ |
| DELIV-04 | fallo de red en `updateTaskState` → hook NO crashea, cleanup terminal SÍ corre (fail-open) | unit | idem | ✅ |

### Sampling Rate
- **Per task commit:** `node --test test/triggers/polling.test.js test/adopt.test.js test/hooks/session-end.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** `npm test` verde (baseline 1885 pass + 1 skip tras Fase 70; esta fase añade casos, el nº sube) antes de `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] Ninguno de infraestructura: los tres archivos de test existen y tienen helpers reusables:
  - `polling.test.js`: `createTestClock()` (clock virtual con `advance`), `fakeClient`, `fakeProvider`, `fakeLogger`, `tempStatePath`, `makeIssue` — reusar para DELIV-01/02.
  - `adopt.test.js`: DI de `addSession`/`findSession` throwing ya usada para PERSIST_FAILED — reusar para DELIV-03.
  - `session-end.test.js`: `makeLogger()`, `makeSession(overrides)`, DI de `findSessionFn`/`removeSessionFn`/`loggerFactory` — extender con un `provider` mock (spy de `getTaskState`/`updateTaskState`/`addComment`) para DELIV-04.
- [ ] Mock de provider para DELIV-04 con contadores de llamada: precedente en `test/server/provider-state.test.js:35` («Mock provider with a getTaskState spy + call counter») y `test/plane-provider.test.js`.

*(Infra de test completa — no hay que crear archivos nuevos; solo añadir `it()` y un mock de provider.)*

## Security Domain

> `security_enforcement` ausente en config = habilitado. Esta fase es fontanería de fiabilidad interna, sin superficie de red nueva ni entrada de usuario nueva; el impacto ASVS es acotado.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Sin auth nueva (la red se cerró en Fase 69). |
| V3 Session Management | no | El «session» aquí es de kodo, no HTTP. |
| V4 Access Control | no | Sin endpoints nuevos. |
| V5 Input Validation | parcial | El `reason` de SessionEnd (DELIV-04) es entrada externa: tratar como enum cerrado, no interpolar en comandos. El `task_url` (DELIV-03) ya pasa por `sanitizeAdoptionData` en el path de creación; el lookup solo compara igualdad de strings (sin ejecución). |
| V6 Cryptography | no | Sin cripto. |
| V7 Error Handling & Logging | **sí** | Contrato never-throws (hooks + adopt) es la propiedad de seguridad central: un fallo de red/timeout NUNCA debe crashear Claude Code ni el daemon. Todo paso fail-open + evento NDJSON tipado (sin fugar contenido de usuario — T-25-02 sigue vigente en el carril polling). |

### Known Threat Patterns for esta fase
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Dispatch colgado congela el daemon (DoS accidental) | Denial of Service | Timeout acotado en `Promise.race` (Pitfall #4); vencimiento = reintento, no cuelgue. |
| Re-dispatch infinito de un issue fallido (storm) | Denial of Service | Los guards de `dispatchTrigger` (in-flight, cross-process, already-active) absorben re-dispatches; el retry es por-tick (bounded), no un loop apretado. |
| Fuga de contenido de usuario en el evento del backstop | Information Disclosure | Emitir solo `{session_id, task_id, from, to}` en el NDJSON — nunca título/descripción (mismo guardrail que T-25-02 en polling). |
| Tarea duplicada en el provider (integridad de datos externos) | Tampering | DELIV-03 lookup idempotente por `task_url` antes de `createTask`. |
| Backstop transiciona una sesión abortada | (falso positivo) | Aceptado por D-12 (fail-open); coste = revisión humana. `getTaskState` gate evita re-transicionar lo ya movido. |

## Sources

### Primary (HIGH confidence)
- Lectura directa del código (2026-07-07): `src/triggers/polling.js`, `src/triggers/dispatcher.js`, `src/adopt.js`, `src/hooks/session-end.js`, `src/gsd/verify.js`, `src/providers/plane/provider.js`, `src/interface.js`, `src/session/state.js`, `src/providers/github/client.js`, `src/config.js`, `test/triggers/polling.test.js`, `test/hooks/session-end.test.js`, `test/adopt.test.js`.
- `.planning/phases/71-fiabilidad-de-entrega-y-backstop/71-CONTEXT.md` — decisiones D-01..D-14 y canonical refs.
- `.planning/REQUIREMENTS.md` — DELIV-01..04 normativos.

### Secondary (MEDIUM confidence)
- [Claude Code hooks docs — SessionEnd reason values](https://code.claude.com/docs/en/hooks-guide) — valores `reason` (WebSearch, corroborado en múltiples fuentes).

### Tertiary (LOW confidence)
- [GitHub REST — List repository issues (`since`)](https://docs.github.com/en/rest/issues/issues) — descripción literal «after the given time»; el diseño no depende de la inclusividad exacta (Pitfall #3).

## Metadata

**Confidence breakdown:**
- Standard stack (módulos internos): HIGH — todos verificados por lectura directa el 2026-07-07.
- Architecture (composición de patrones): HIGH — cada requisito mapea a un patrón ya presente en el repo.
- Pitfalls: HIGH — Pitfall #2 (watermark escalar) y #5 (ventana PERSIST_FAILED) derivados directamente del código y de las anclas de CONTEXT.
- Puntos externos (SessionEnd `reason`, GitHub `since`): MEDIUM/LOW — documentados con fuente y con diseño robusto a su ambigüedad.

**Research date:** 2026-07-07
**Valid until:** 2026-08-06 (estable; módulos internos maduros. Revalidar si Fase 72/HYG-04 aterriza antes y reordena `session-end.js`).

Sources:
- [Claude Code hooks guide](https://code.claude.com/docs/en/hooks-guide)
- [GitHub REST API — Issues](https://docs.github.com/en/rest/issues/issues)
</content>
</invoke>
