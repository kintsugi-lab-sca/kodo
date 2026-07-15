# Phase 71: Fiabilidad de entrega y backstop - Pattern Map

**Mapped:** 2026-07-07
**Files analyzed:** 6 (3 de código, 3 de test) — todos MODIFICADOS, ninguno nuevo
**Analogs found:** 6 / 6 (los analogs son patrones YA presentes en los mismos ficheros o en `verify.js`)

Nota de fase: esta fase NO crea módulos nuevos. Cada requisito (DELIV-01..04) edita un fichero existente y debe **imitar un patrón ya presente en el repo**. Por eso el "analog" de cada fichero es, en la mayoría de casos, código vivo del propio fichero o de `src/gsd/verify.js`. El planner debe componer los patrones existentes sin violar sus invariantes (anti-storm, never-throws, discriminated returns, FROZEN-9, Pitfall #1).

## File Classification

| Fichero modificado | Rol | Data Flow | Analog más cercano | Calidad del match |
|--------------------|-----|-----------|--------------------|-------------------|
| `src/triggers/polling.js` (DELIV-01/02) | trigger / daemon loop | event-driven + request-response | patrón propio: retry-loop never-throws + `sleep(clock,ms)` (`:203`), cursor loop (`:332-395`) | exact (self) |
| `src/adopt.js` (DELIV-03) | service / core determinista | CRUD (create idempotente) | patrón propio: discriminated returns + guard `sessionId` (`:245-248`), `PERSIST_FAILED` (`:283-296`) | exact (self) |
| `src/hooks/session-end.js` (DELIV-04) | hook / lifecycle | event-driven | `src/gsd/verify.js:236-265` (transición `getTask→addComment→updateTaskState`) | role+flow match |
| `test/triggers/polling.test.js` | test (unit) | — | patrón propio: `createTestClock` (`:60`), `makeIssue`/`makeFakeProvider`/`tempStatePath` | exact (self) |
| `test/adopt.test.js` | test (unit) | — | patrón propio: `fakeProvider` (`:48`), DI de `addSession`/`findSession` throwing | exact (self) |
| `test/hooks/session-end.test.js` | test (unit) | — | patrón propio: `makeLogger` (`:15`), `makeSession` (`:27`), DI de `findSessionFn`/`loggerFactory` | exact (self); extender con provider mock |

## Pattern Assignments

### `src/triggers/polling.js` — DELIV-01 (await+timeout) y DELIV-02 (centinela)

**Analog:** el propio fichero. Tres piezas vivas a imitar/modificar.

**1. Timeout mockeable — imitar `sleep(clock,ms)` (`polling.js:203-205`):**
```javascript
function sleep(clock, ms) {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
}
```
DELIV-01 construye un `Promise.race([dispatchFn(...), timeoutPromise])` donde el timeout usa `clock.setTimeout` (NO `globalThis.setTimeout`) para que `createTestClock` lo controle. El vencimiento cuenta como dispatch NO confirmado (issue va a `failedUpdatedAts`), nunca throw (D-03, Pitfall #4). Default recomendado 30000 ms (config/DI).

**2. Reemplazar el fire-and-forget (`polling.js:362-386`) — sitio exacto del cambio DELIV-01:**
```javascript
          // Fire-and-forget — espejo `webhook.js:46-48`. NEVER `await`. Any
          // rejection is logged but not propagated; loop continues.
          dispatchFn(
            { taskRef: task.ref, action: 'polling', provider: 'github', raw: issue },
            {},
          ).catch((err) => { /* logger.error('polling.dispatch.failed', ...) */ });
          dispatched++;
```
DELIV-01 sustituye este `.catch()` por un `await confirmDispatch(...)` con captura del resultado. Si `ok` → el `updated_at` es candidato al watermark; si falla/timeout → `failedUpdatedAts.push(issue.updated_at)`. El comentario «NEVER await» deja de aplicar SOLO aquí (el webhook `src/triggers/webhook.js` NO se toca).

**3. Cursor + persistencia (`polling.js:332-395`) — sitio del watermark acotado (D-02) y del centinela (D-04/05):**
```javascript
      let maxUpdatedAt = prev.last_updated_at || '';
      for (const issue of result.items) {
        if (issue.pull_request) continue;
        if (issue.updated_at && issue.updated_at > maxUpdatedAt) {
          maxUpdatedAt = issue.updated_at;      // ← HOY sube incondicionalmente (raíz T4)
        }
        if (shouldDispatch(issue, prev)) { /* ...dispatch fire-and-forget... */ }
      }
      cache[key] = {
        last_updated_at: maxUpdatedAt || prev.last_updated_at,
        ...(result.etag ? { etag: result.etag } : {}),   // ← DELIV-02 añade: observed: true
      };
      saveStateCache(cache, statePath);
```
Cambios:
- **DELIV-01/D-02 (Pitfall #2, LA trampa central):** el `updated_at` solo sube el watermark cuando el issue NO se despacha o su dispatch confirmó; los fallidos se recogen aparte y el cursor final se **acota estrictamente por debajo de `min(failedUpdatedAts)`** (comparación lexicográfica de ISO 8601, como ya hace `shouldDispatch`). Si el máximo cruza `minFailed`, retroceder a `prev.last_updated_at`. Aplica en AMBOS paths (client GitHub y provider Plane); en el path provider es más crítico porque el único filtro es el `>` local.
- **DELIV-02/D-04:** añadir `observed: true` al objeto `cache[key]`.
- **DELIV-02/D-05:** `saveStateCache` debe ejecutarse SIEMPRE tras el primer tick (con o sin items), NO solo cuando hay items. `saveStateCache` (`:149-154`) ya es tmp+rename atómico — sin cambio de firma.

**4. `shouldDispatch` (`polling.js:172-175`) — sitio del centinela DELIV-02/D-04:**
```javascript
function shouldDispatch(task, prev) {
  if (!prev.last_updated_at) return false; // first-tick skip (T-25-04)  ← BUG M10: conflaciona
  return task.updated_at > prev.last_updated_at;
}
```
Cambiar `!prev.last_updated_at` por `prev.observed !== true`. Retrocompat (Runtime State Inventory): una entrada legacy `{last_updated_at}` sin `observed` cae en `observed !== true` → tratada como primer tick (skip+poblar+marcar); comportamiento seguro, anti-storm lo cubre.

**Invariantes a preservar (D-06):** rama 304 (`:310-328`) sigue devolviendo sin escribir cache; primer tick real no dispara (T-25-04). El centinela es aditivo.

---

### `src/adopt.js` — DELIV-03 (idempotencia por `task_url`)

**Analog:** el propio `adoptSession` (`:196-300`). El nuevo camino se inserta entre el guard `sessionId` (`:245-248`) y `createTask` (`:259`), reusando el contrato existente.

**Guard de idempotencia existente (`adopt.js:245-248`) — eje DISTINTO (sessionId), a preservar intacto:**
```javascript
  const existing = findSessionFn({ sessionId });
  if (existing) {
    return { ok: false, code: 'ALREADY_ADOPTED', detail: { task_id: existing.session.task_id } };
  }
```

**Ventana `PERSIST_FAILED` (`adopt.js:283-296`) — la que DELIV-03 cierra:**
```javascript
  try {
    addSessionFn(task.id, session);
  } catch (err) {
    return {
      ok: false, code: 'PERSIST_FAILED',
      detail: { task_id: task.id, task_url: task.url, hint: 'recoverable via idempotent re-run', message: ... },
    };
  }
```
Aquí `createTask` YA tuvo éxito (`:259`) pero `addSession` falló → tarea en Plane sin fila local. Un re-run con el mismo `sessionId` pasa el guard `:245` (no hay fila) y **re-crea** → duplicado (Pitfall #5).

**Cambio DELIV-03 (D-08):** insertar, antes de `createTask` (`:259`), un lookup por `task_url`:
- **(a) recuperación explícita:** aceptar un `task_url`/`task_id` opcional en args; si el caller del re-run lo pasa (del detalle del `PERSIST_FAILED`, `:291`), reconstruir la fila con `buildSessionFromAdoption` y reintentar SOLO `addSession` (sin `createTask`) → `{ ok: true, task, session, reused: true }`.
- **(b) barrido local:** escanear `listSessions()`+`listHistory()` buscando `s.task_url === candidateTaskUrl` (re-adopción de tarea ya persistida) → `ALREADY_ADOPTED`.
- **(c) sin match:** flujo normal `createTask` (sin cambios).

**Contrato a NO romper (D-09, Pattern 3):** los 5 discriminantes (`UNSUPPORTED`/`INVALID_INPUT`/`ALREADY_ADOPTED`/`CREATE_FAILED`/`PERSIST_FAILED`) + never-throws. El retorno reutilizado recomendado es `{ ok: true, reused: true }` (Open Question #1 — confirmar en plan). Los 3 consumidores (CLI `kodo adopt`, tecla `a` del dashboard, orquestador) distinguen `ok:true`/`ok:false` → `reused:true` no los rompe.

**Capability gate existente a imitar (`adopt.js:207`):**
```javascript
  if (!provider || typeof provider.createTask !== 'function') {
    return { ok: false, code: 'UNSUPPORTED', detail: { providerName } };
  }
```

---

### `src/hooks/session-end.js` — DELIV-04 (backstop In Review)

**Analog primario:** `src/gsd/verify.js:236-265` — patrón vivo de transición. **Sede:** `runSessionEndHook` (`:50-125`).

**Patrón de transición a reusar VERBATIM (`verify.js:237,247,258-265`):**
```javascript
  task = await provider.getTask(session.task_ref);         // :237 (o TaskItem mínimo reconstruido, Pitfall #6)
  ...
  await provider.addComment(task, markdown);               // :247 (fail-open por paso)
  ...
  // Pitfall #1: config.providers[provider].states.review — NO top-level.
  const config = loadConfigFn();
  const providerName = session.provider || config.provider;
  const providerCfg = (config.providers && config.providers[providerName]) || {};
  const reviewState = (providerCfg.states && providerCfg.states.review) || 'In review';
  await provider.updateTaskState(task, reviewState);       // :264
```
**Pitfall #1 (crítico):** `states.review` vive bajo `config.providers[provider]`, NO top-level. Default `'In review'` (r minúscula, coherente con `verify.js:262` y `config.js`; NO `'In Review'` de `session-start.js:29`). Método de comentario: `provider.addComment` (contrato, `provider.js:223`), NO `createComment`.

**Sitio de inserción (session-end.js) — tras los guards de idempotencia (`:61-72`), ANTES de `performTerminalCleanup` (`:115`):**
```javascript
    if (!result) { /* :61-64 no-op: orquestador / ad-hoc no adoptada */ return; }
    if (result.source === 'history') { /* :69-72 ya archivada → skip */ return; }
    const { id, session } = result;
    // ← DELIV-04: runReviewBackstop({ session, input, provider, config, log }) aquí (D-10, Pitfall #7)
    ...
    await performTerminalCleanup({ id, session, ... });   // :115
```
Colocar el backstop como bloque autónomo, sin entrelazarlo con el `session.end` event ni el lock release, para dejar sitio a HYG-04 (Fase 72) que reordenará este mismo hook (Pitfall #7).

**Reglas del backstop (D-11..D-14):**
- **Capability gate (D-13, Pattern 2):** `typeof provider.getTaskState/updateTaskState/addComment === 'function'` — GitHub degrada a no-op.
- **Gate de estado (D-11):** transicionar SOLO si `getTaskState(task) === 'in_progress'` (estado vivo, no `session.status` local). Si el LLM ya transicionó → no-op idempotente.
- **TaskItem (Pitfall #6):** reconstruir mínimo `{ id: session.task_id, projectId: session.project_id, url: session.task_url, ref: session.task_ref }` (0-red) — basta para `getTaskState`/`updateTaskState`/`addComment` de Plane.
- **«Sesión limpia» (D-12):** fail-open — transicionar salvo `reason` de fallo explícito. `reason ∈ {clear, logout, prompt_input_exit, bypass_permissions_disabled, other}`; ninguno es crash.
- **Never-throws + fail-open por paso (D-13):** cada paso en su try/catch; un fallo de red loguea y sigue, NUNCA crashea el hook ni bloquea el cleanup (imitar el outer try/catch de `runSessionEndHook:53/122`).
- **Evento NDJSON tipado (D-13):** emitir solo `{ session_id, task_id, from, to }` — NUNCA título/descripción (guardrail T-25-02).

**getTaskState de Plane (`provider.js:251`) — capability-gated, mapea vía `mapPlaneState` (`:76`):** devuelve `'in_progress'`/`'in_review'`/`'done'`/`'blocked'`/`'unknown'`. El gate es `=== 'in_progress'`.

---

### Ficheros de test (extender, no crear)

**`test/triggers/polling.test.js` (DELIV-01/02):** reusar `createTestClock()` (`:60-98`, con `advance(ms)` de tiempo virtual y `clock.setTimeout/clearTimeout/now`), `makeFakeProvider` (`:129`), `makeFakeClient` (`:111`), `makeIssue` (`:190`), `tempStatePath` (`:176`). Casos nuevos: dispatch que rechaza → `updated_at` NO entra en cursor; dispatch que timeout (nunca resuelve) → clasificado fallido vía `advance`, no cuelga; [A-falla `10:00`, B-ok `10:05`] → 2º tick RE-dispara A; primer tick sin items → persiste `observed:true`; rama 304 → cursor preservado, cache NO escrito; entrada legacy sin `observed` → tratada como primer tick.

**`test/adopt.test.js` (DELIV-03):** reusar `fakeProvider` (`:48`, `createTask` con contador) y la DI de `addSession`/`findSession` throwing ya usada para `PERSIST_FAILED`. Caso clave: adopt crea tarea + `addSession` inyectado throw → `PERSIST_FAILED{task_url}` → re-run con ese url → assert **exactamente un** `createTask`. Además: re-adopción de tarea ya persistida (barrido local) → sin duplicado; los 5 discriminantes intactos.

**`test/hooks/session-end.test.js` (DELIV-04):** reusar `makeLogger()` (`:15`, captura eventos en array) y `makeSession(overrides)` (`:27`), DI de `findSessionFn`/`removeSessionFn`/`loggerFactory` (patrón de `:49-56`). **Extender con un provider mock** (spy de `getTaskState`/`updateTaskState`/`addComment` + contadores) — precedente en `test/server/provider-state.test.js:35` y `test/plane-provider.test.js`. Casos: `in_progress`+reason limpio → transición+comment+NDJSON; ya `in_review`/`done` → no-op (D-11); provider sin `getTaskState` (GitHub) → no-op por gate; fallo de red en `updateTaskState` → hook NO crashea, cleanup SÍ corre.

## Shared Patterns

### Capability-gating por `typeof` (métodos fuera de FROZEN-9)
**Source:** `src/adopt.js:207`, `src/interface.js:52` (`TASK_PROVIDER_METHODS`)
**Apply to:** DELIV-03 (gate `createTask`), DELIV-04 (gate `getTaskState`/`updateTaskState`/`addComment`)
`createTask`, `getTaskState`, `createComment`/`addComment` están FUERA del contrato congelado de 9 métodos → detectar en el call site con `typeof x === 'function'`; GitHub degrada silenciosamente. Guardar null/undefined del provider PRIMERO para que el `typeof` no lance.

### Never-throws + fail-open por paso
**Source:** `src/hooks/session-end.js:53/122` (outer try/catch), `src/gsd/verify.js:238-254` (cada paso su try/catch), `src/adopt.js` (discriminated returns)
**Apply to:** DELIV-01 (timeout = reintento, no throw), DELIV-03 (discriminantes), DELIV-04 (cada paso del backstop)
Un fallo de red/timeout NUNCA debe crashear Claude Code ni el daemon. Es la propiedad de seguridad central de la fase (ASVS V7).

### Escritura atómica del state cache
**Source:** `src/triggers/polling.js:149-154` (`saveStateCache`, tmp+rename)
**Apply to:** DELIV-02 (persistir el centinela `observed` sin fontanería nueva)

### Resolución de `states.review` (Pitfall #1)
**Source:** `src/gsd/verify.js:258-262`
**Apply to:** DELIV-04
`config.providers[provider].states.review || 'In review'` — NUNCA `config.states.review` top-level (ese shape existe pero es para `states.trigger`).

### Comparación de cursores por string ISO 8601
**Source:** `src/triggers/polling.js:172-193` (`shouldDispatch`, `classifyPattern` usan `>` sobre strings)
**Apply to:** DELIV-01/D-02 (watermark acotado)
El orden lexicográfico de ISO 8601 coincide con el cronológico; no parsear a `Date`. El cap debe ser ESTRICTAMENTE menor que `min(failedUpdatedAts)` porque el gate local `>` es la verdad (el `since` de GitHub es pre-filtro grueso, Pitfall #3).

## No Analog Found

Ninguno. Los 6 ficheros ya existen y cada requisito mapea a un patrón vivo del repo. No hay que inventar mecanismos nuevos — el riesgo está en componer los existentes sin violar sus invariantes.

Único elemento sin analog directo: el **evento NDJSON tipado del backstop** (D-13). El planner debe añadir un helper en `src/logger-events.js` imitando los existentes (`sessionEnd`, `pollingDispatch`); emitir solo `{session_id, task_id, from, to}`.

## Metadata

**Analog search scope:** `src/triggers/`, `src/adopt.js`, `src/hooks/`, `src/gsd/verify.js`, `src/providers/plane/provider.js`, `test/triggers/`, `test/adopt.test.js`, `test/hooks/`
**Files scanned:** 8 (6 sede + `verify.js` + `plane/provider.js`)
**Pattern extraction date:** 2026-07-07
