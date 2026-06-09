# Phase 40: Provider State — contrato + providers + enrichment - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

`GET /status` enriquece cada sesión activa con un campo `provider_state` que refleja el estado **real** de la tarea en su sistema de gestión (Plane + GitHub), como un carril **read-only** completamente desacoplado del lifecycle local de kodo (`alive`, `status`, `elapsed_min`). Cierra el driver del milestone ROMAN-150: una sesión movida a "In Review" en Plane (vía MCP, bypasseando `kodo gsd verify`) desaparecía del dashboard tras `/exit` pese a seguir siendo trabajo abierto.

**En scope (Phase 40):**
- `getTaskState(taskId)` como método **opcional** del provider (Plane + GitHub) — PSTATE-01, PSTATE-02
- Assert capability-gated en la cross-provider contract matrix — PSTATE-03
- Enrichment server-side en `GET /status` con cache por `task_id` + fail-open por fila — PSTATE-04
- Evento NDJSON `provider.state.fetch.failed`
- Doc-work: actualizar la nota del invariante "9-method contract" en STATE.md

**Fuera de scope (otras fases):**
- Render de `provider_state` en el dashboard (columna/badge/color) → **Phase 43** (PSTATE-05)
- Filtro del dashboard por `provider_state` (`s:` vs `ps:`) → **Phase 43** (PSTATE-06)
- Cualquier escritura a `state.json` o acoplamiento con `alive`/`elapsed_min` (prohibido por invariante)

</domain>

<decisions>
## Implementation Decisions

### Cache (PSTATE-04)
- **D-01:** Cache **independiente** `Map<task_id, {state, reason, ts}>` (NO reusar el objeto `pendingCache` de `listPendingTasks`, que es una forma distinta: un único `{data, ts}` por provider). El `provider_state` requiere cache **por fila**.
- **D-02:** TTL **30s**, reusando la constante `PENDING_CACHE_TTL_MS` ya existente en `src/server.js` (consistencia, no introducir un segundo número). Cumple el criterio de éxito 3 (dos polls dentro del TTL → ≤N llamadas, no 2N).
- **D-03:** **Dedup in-flight** por `task_id` vía `Map<task_id, Promise>`: si una llamada a `getTaskState(task_id)` está en vuelo, los polls solapados la esperan en vez de disparar fetches concurrentes duplicados.
- **D-04:** Clave del cache: **`task_id` sólo** (no `task_id+provider`). El provider es único por instancia de server — no hay colisión cross-provider en runtime.

### Forma de la fila en el JSON de `/status` (PSTATE-04)
- **D-05:** Forma **flat** con reason explícito:
  - `provider_state: string|null` — el estado normalizado, o `null` cuando no hay dato
  - `provider_state_reason: null | 'unsupported' | 'fetch-failed'`
  - **ok:** `{ provider_state: 'in_review', provider_state_reason: null }`
  - **no soportado (permanente):** `{ provider_state: null, provider_state_reason: 'unsupported' }`
  - **fetch falló (transitorio):** `{ provider_state: null, provider_state_reason: 'fetch-failed' }`
- **D-06:** **Reinterpretación deliberada de PSTATE-04.** El requirement dice "omite el campo si la llamada falla o el provider no soporta el método". Se reinterpreta como **`provider_state = null` con `reason` poblado**, NO como campo ausente. Razón: **Phase 43 / criterio 2** exige distinguir tres estados visuales (ok / unsupported / fetch-failed) "reusando el campo `supported`/`reason` de Phase 40". Omitir silenciosamente haría imposible esa distinción — exactamente la lección que v0.9 aprendió con `listComments`/`supported` (campo aditivo que distingue "no soportado" permanente de "vacío" transitorio). Documentar este cambio en el PLAN para que el reviewer no lo lea como bug.
- **D-07:** Ambos campos son **byte-additivos**: clientes viejos los ignoran (invariante v0.9 "respuestas JSON aditivas"). El bool `supported` de v0.9 se considera **redundante** aquí — `provider_state_reason === 'unsupported'` lo deriva; no se emite un tercer campo.

### Mapeo Plane → vocabulario normalizado (PSTATE-01)
- **D-08:** **Precedencia: substring del `name` PRIMERO, luego `group`.** Justificación: los estados "In Review"/"Blocked" viven típicamente dentro del grupo `started` de Plane; mapear sólo por grupo perdería la señal — que es precisamente el driver ROMAN-150 ("In Review").
- **D-09:** Tabla de mapeo:
  ```
  name.toLowerCase() incluye 'review' → in_review
  name incluye 'block'                → blocked
  (el substring del name gana sobre el grupo)
  else según group:
    completed → done
    cancelled → done        (terminal/cerrado)
    started   → in_progress
    unstarted → in_progress
    backlog   → unknown
  sin estado / desconocido → unknown
  ```
- **D-10:** Comparación con **`String.includes` case-insensitive** (anti-ReDoS — sin regex). El provider Plane hoy cachea `UUID → name` (`stateCache` en `src/providers/plane/provider.js`); para `getTaskState` necesitará también el `group` del estado (disponible en `listStates`, que devuelve objetos con `group` + `name`).

### Mapeo GitHub → vocabulario normalizado (PSTATE-02) — decidido por defecto del roadmap (área no seleccionada en discuss)
- **D-11:** **Convention-driven por labels, NO automático** (documentar explícitamente en el adapter como convención):
  ```
  label cuyo name incluye 'review' → in_review
  label cuyo name incluye 'block'  → blocked
  (mismo String.includes case-insensitive anti-ReDoS que Plane)
  else fallback por estado del issue:
    open   → in_progress
    closed → done
  ```
- **D-12:** **Sin llamadas API extra**: usa los labels ya presentes en el issue/`TaskItem` (GitHub Issues no tiene "review" nativo). NO leer review-state de PRs linkeados (descartado por coste + acoplamiento; queda como deferred si la convención por labels resulta insuficiente).

### Contrato del provider (PSTATE-01, PSTATE-03)
- **D-13:** `getTaskState` es **opcional** — NO entra en `TASK_PROVIDER_METHODS` (FROZEN en 9 métodos en `src/interface.js`). El registry loop lanza para métodos ausentes del array; añadir el 10º rompería el arranque. Patrón: método opcional + `typeof provider.getTaskState === 'function'` → deriva `supported`. Espejo exacto de cómo v0.9 trató `listComments`.
- **D-14:** El assert de la contract matrix es **capability-gated**: si el provider no implementa `getTaskState`, el assert se skipea sin romper el determinismo `PROVIDERS × N_asserts` (espejo del patrón `listComments` en `test/providers/contract.test.js`).

### Observabilidad
- **D-15:** Registrar el evento `provider.state.fetch.failed` en el registro `EVENTS` de `src/logger-events.js` (junto a `plane.api.call.failed` / `github.api.call.failed`). Emitirlo cuando un `getTaskState` falle — el fail-open NUNCA es silencioso en el log. Token=0: `getTaskState` son HTTP calls al provider, no llamadas al modelo; el redactor NDJSON cubre el nuevo evento.

### Claude's Discretion
- **Concurrencia del enrichment** (serial vs `Promise.allSettled` con cap): el criterio de éxito 3 ya acota el comportamiento (≤N llamadas dentro del TTL). Con N típicamente <10 sesiones, serial o `Promise.allSettled` son ambos aceptables — decisión del planner/researcher. Fail-open por fila implica `allSettled` (no `all`) si se paraleliza.
- **Firma exacta de `getTaskState`** (`taskId` string vs `{id, projectId}` como hace `listComments`): seguir el patrón del provider correspondiente; Plane necesita `projectId` además del id.
- **Forma exacta de los fields del evento NDJSON** `provider.state.fetch.failed` (task_id, provider, error): seguir la forma de los eventos `*.api.call.failed` existentes.

### Folded Todos
- **`2026-05-28-surface-provider-state-in-dashboard-plane-in-review.md`** (origen ROMAN-150, ya etiquetado `resolves_phase: 40`). Es el spec-narrativo completo del milestone: documenta por qué Option 3 (enrichment desacoplado) vs Option 2 (stop-hook lee provider), el caso reproducible, y los pitfalls predecibles (N+1 calls, coupling al vocabulario de Plane, fail-open silencioso). Sus items 1/2/5 (contrato + adapters + enrichment + tests) son Phase 40; sus items 3/4 (render + filtro) son **Phase 43**.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Driver y requisitos
- `.planning/todos/pending/2026-05-28-surface-provider-state-in-dashboard-plane-in-review.md` — spec-narrativo completo del milestone (ROMAN-150): Option 2 vs Option 3, caso reproducible, pitfalls. **Lectura obligatoria.**
- `.planning/REQUIREMENTS.md` §PSTATE-01..04 — requisitos formales de esta fase
- `.planning/ROADMAP.md` §"Phase 40" — Goal, Success Criteria e Invariantes/notas

### Código a tocar / reusar
- `src/interface.js:52` — `TASK_PROVIDER_METHODS` (FROZEN en 9; `getTaskState` NO se añade)
- `src/providers/registry.js:102` — loop de validación capability (patrón `typeof === 'function'`)
- `src/providers/plane/provider.js` — `stateCache` (UUID→name), donde vive el mapeo Plane
- `src/providers/plane/client.js:95` — `listStates` (devuelve `group` + `name`)
- `src/providers/github/provider.js` — adapter GitHub, donde vive el mapeo por labels
- `src/server.js:364-413` — handler `GET /status` + enrichment (hoy sólo añade `elapsed_min`); `PENDING_CACHE_TTL_MS` (línea 18)
- `src/logger-events.js:51` — registro `EVENTS` (añadir `provider.state.fetch.failed`)
- `src/config.js:42-43` — `states: {review, done}` config de Plane existente

### Tests
- `test/providers/contract.test.js` — cross-provider contract matrix (patrón capability-gated `listComments` a espejar)
- `test/plane-provider.test.js`, `test/providers/github/provider.test.js` — tests por-provider

### Patrón de referencia v0.9 (capability flag)
- Buscar `supported` en `src/server.js:179,433-443` — implementación de `listComments` opcional con campo `supported` aditivo (el patrón que `getTaskState` espeja).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Patrón `listComments`/`supported` (v0.9):** método opcional del provider + `typeof === 'function'` + campo aditivo en `/status`. `getTaskState` lo replica casi 1:1 (server.js:438-443).
- **`PENDING_CACHE_TTL_MS` (server.js:18):** constante de TTL ya existente (30s) — reusar, no duplicar.
- **`stateCache` en plane/provider.js:36:** cache UUID→name ya poblado en `init`; el mapeo Plane puede apoyarse en él (necesitará además `group`).
- **`EVENTS` registry (logger-events.js):** convención `<provider>.api.call.failed` — el nuevo evento sigue el mismo molde.

### Established Patterns
- **Contract matrix capability-gated:** asserts opcionales se skipean si el provider no implementa el método, preservando determinismo `PROVIDERS × N_asserts`.
- **`reconcileTick` = único escritor de `alive`** (D-04 de v0.9). `provider_state` es read-only en `/status`, JAMÁS escrito a `state.json`.
- **Respuestas JSON aditivas:** clientes viejos ignoran campos nuevos — `provider_state` + `provider_state_reason` son seguros de añadir.
- **Anti-ReDoS:** comparaciones de strings con `String.includes`, nunca regex sobre input del provider.

### Integration Points
- `GET /status` → `enriched = sessions.map(...)` en `src/server.js:382` — aquí se inyecta `provider_state`/`provider_state_reason` por fila.
- El registry (`src/providers/registry.js`) debe seguir arrancando con providers que NO implementen `getTaskState` (no romper el boot).

</code_context>

<specifics>
## Specific Ideas

- El campo `provider_state_reason: 'fetch-failed'` (transitorio) vs `'unsupported'` (permanente) está diseñado explícitamente para alimentar los **tres estados visuales** de Phase 43 (ok / unsupported / fetch-failed, ej. dim + `?`). No colapsar ambos en un solo `null`.
- La honestidad del mapeo GitHub es un requisito de diseño, no incidental: el adapter debe **documentar en comentario** que `in_review`/`blocked` son convención por labels, no estado nativo de GitHub Issues.

</specifics>

<deferred>
## Deferred Ideas

- **Leer review-state de PRs linkeados en GitHub** (en vez de sólo labels): descartado para Phase 40 por coste de API + acoplamiento. Reconsiderar sólo si la convención por labels resulta insuficiente en uso real.
- **`provider_state` por env-configurable TTL** (`KODO_PROVIDER_STATE_TTL_MS`): descartado para v1 (knob extra que documentar/testear). El TTL fijo de 30s es suficiente; promover si operadores con muchas sesiones lo piden.
- **Render + filtro de `provider_state`** (columna/badge/color, semántica `s:`/`ps:`): es **Phase 43** (PSTATE-05/06), no deferred — ya está en el roadmap.

</deferred>

---

*Phase: 40-provider-state-contrato-providers-enrichment*
*Context gathered: 2026-06-03*
