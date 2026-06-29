# Phase 53: Fontanería `src/adopt.js` - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-resueltas con la opción recomendada; ver DISCUSSION-LOG.md)

<domain>
## Phase Boundary

Phase 53 entrega la **base determinista 0-token de la adopción**: el módulo top-level `src/adopt.js`, inverso exacto de `manager.launchWorkItem` (`createTask → addSession` en lugar de `provider.fetch → addSession → cmux.send`). Es **provider-agnostic** y **host-agnostic** — los tres consumidores futuros (CLI Phase 54, tecla dashboard Phase 56, orquestador Phase 57) lo reusan sin poseerlo, recibiendo workspace/cwd como **datos** (nunca llama a cmux ni a un LLM).

**En scope (BIDIR-03/04/05/08):**
- `adoptSession()` async: capability-gate (`typeof provider.createTask`) → guard idempotencia → sanitizar → `createTask` (POST) → normalize → `addSession` (escritura local), retornando el discriminante never-throws universal `{ ok:true, task, session } | { ok:false, code, detail }`.
- `buildSessionFromAdoption()` **puro** — construye el `SessionRecord` desde el `TaskItem` + datos del host, inverso de `buildSessionFromTask`; **NO** escribe `dead_since` / `last_seen_alive` (reconcile-owned).
- Guard double-adopt (BIDIR-04): `findSession({ workspaceRef, cwd })` con `loadState()` fresco ANTES del POST.
- Atomicidad LOUD (BIDIR-05): orden POST-primero / escritura local último; persist-failure ruidoso con `task_id` + `task_url`.
- Sanitización de datos (BIDIR-08): título default `basename(cwd)`, strip de rutas absolutas, redacción del home dir, nunca embeber transcript.

**FUERA de scope (límites con otras fases):**
- `provider.createTask` (el método de transporte) → **Phase 52, ya completo**. La 53 solo lo *invoca* vía typeof-gate.
- CLI `kodo adopt` (parsing argv, exit codes, `--workspace`/`--cwd`/`--project`) → **Phase 54**. El core recibe los datos ya resueltos.
- Selección **interactiva** de proyecto destino vía `listProjects`, derivación de título *inteligente* → consumers (Phase 54/56/57). El core recibe `projectId` y `title` resueltos.
- Detección cmux (`describeSurface`) → **Phase 55**. `adopt.js` recibe `cwd`/`session_id`/`workspaceRef` como datos, jamás llama a `cmux`.
</domain>

<decisions>
## Implementation Decisions

### Taxonomía del discriminante de error (BIDIR-03 — cierra D-09 diferido de Phase 52)
- **D-01:** `adoptSession` retorna el discriminante never-throws del codebase (espejo de `kodo gsd verify` / `dismiss`). Codes mínimos:
  - `{ ok: true, task, session }` — éxito (tarea creada + fila sembrada en `state.json`).
  - `ALREADY_ADOPTED` — guard idempotencia hit; **NO** se crea tarea. `detail` incluye el `task_id` existente.
  - `UNSUPPORTED` — el provider no implementa `createTask` (typeof-gate falla). Carril de lectura: never-throws.
  - `CREATE_FAILED` — el POST `createTask` falló (403/404/5xx/red); `detail` propaga el contexto del provider (espejo D-08 Phase 52: LOUD ante scope insuficiente).
  - `PERSIST_FAILED` — el POST tuvo éxito pero la escritura local falló (ver D-03); `detail` **debe** embeber `task_id` + `task_url`.
- La taxonomía exacta de strings es coordinable por el planner, pero estos cinco estados son el contrato que los consumers (CLI Phase 54 deriva exit codes de aquí) consumen.

### Descomposición del módulo (BIDIR-03)
- **D-02:** Split puro/impuro explícito en `src/adopt.js` (top-level, **NO** bajo `src/gsd/` — la adopción no sabe de GSD):
  - `adoptSession({ provider, providerName, workspaceRef, cwd, sessionId, projectId, projectPath, title?, description? })` — orquestador **async** que hace toda la I/O (loadState, POST, addSession) y retorna el discriminante.
  - `buildSessionFromAdoption({ task, providerName, workspaceRef, cwd, sessionId, projectPath })` — **puro**, retorna el `SessionRecord` espejo de `buildSessionFromTask` (`status: 'running'`, `started_at`, sin GSD flags). Omite `dead_since` / `last_seen_alive` para preservar la invariante "`reconcileTick` único escritor de `alive`".
  - `sanitizeAdoptionData({ cwd, title?, description? })` — **puro**, aplica defaults + saneo (ver D-05) antes del POST. Aislado para testear sin I/O.

### Forma del fallo LOUD post-persist (BIDIR-05)
- **D-03:** El fallo "POST OK / escritura local KO" se modela **dentro del discriminante** como `{ ok:false, code:'PERSIST_FAILED', detail }`, **no** como excepción lanzada. Rationale: (1) los consumers ya ramifican sobre el discriminante (CLI deriva exit codes, orquestador inspecciona); un throw forzaría try/catch divergente del resto del API. (2) "LOUD" = code distinto + no-swallowable + `detail` con las coordenadas del huérfano (`task_id` + `task_url` + hint "recuperable por re-run idempotente"), **no** necesariamente una stack trace. El consumer es responsable de hacerlo ruidoso (CLI: exit ≠ 0 + banner en stderr). **Tensión reconocida con BIDIR-05** ("never-throws es solo para los carriles de lectura"): se resuelve haciendo el code *semánticamente* loud y obligando al consumer a no tratarlo como fallo benigno — no degradando la uniformidad del discriminante que toda la base usa.
- **Orden de operaciones:** guard (loadState fresco + `findSession`) → POST `createTask` → `addSession` (escritura local **último**). No hay `cmux.send` en adopción (la sesión ad-hoc ya existe), así que la secuencia es más corta que `launchWorkItem`.

### Contrato de input + idempotencia (BIDIR-04)
- **D-04:** El core recibe **datos resueltos**, nunca prompts ni detección. `projectId`, `projectPath` y (opcionalmente) `title`/`description` llegan ya resueltos por el consumer. `listProjects` (uno de los 9 FROZEN) lo consume la **UI de selección del consumer** (Phase 54/56), **no** `src/adopt.js` — esto preserva la propiedad 0-token / non-owner del núcleo. Default de título `basename(cwd)` se aplica **dentro** del core (única fuente de verdad) solo cuando `title` se omite.
- **Guard double-adopt:** `loadState()` fresco inmediatamente antes del POST (espejo del re-read fresco del 409 de `dismiss`, v0.10 Phase 42) → `findSession({ workspaceRef, cwd })` (escanea sessions **+** history, idiom `sessions > history` de LIFE-01). Si existe → `ALREADY_ADOPTED` sin POST. El mapeo autoritativo es **local** (`state.json`), no requiere búsqueda remota difusa. El residual de un double-adopt concurrente verdadero (mismo operador, mismo daemon) es despreciable y, si ocurre, es visible vía el marker `kodo:adopted` y recuperable por re-run idempotente.

### Atomicidad de la escritura local (BIDIR-05)
- **D-05:** Hoy `saveState` usa `writeFileSync` plano (`src/session/state.js:242`) — **sin** tmp+rename. BIDIR-05 exige atomicidad. Decisión: **upgrade del único writer chokepoint** `saveState` a tmp+rename (write a `${STATE_PATH}.tmp` + `renameSync`). Es la función única por la que pasan `addSession`/`updateSession`/`removeSession`; el cambio es quirúrgico (una función) y **todo** escritor de estado se beneficia (durabilidad correcta del fichero del que depende todo el modelo de corrección de kodo). Blast radius reconocido: cambia la semántica de durabilidad de cada escritura de estado — justificado porque la integridad de `state.json` es la invariante central. (Planner: confirmar que no rompe el `.bak` snapshot de migración en `state.js:202-208`.)

### Sanitización de datos (BIDIR-08)
- **D-06:** `sanitizeAdoptionData` (puro, D-02) aplica antes del POST: (1) título = `title ?? basename(cwd)`; (2) strip de rutas absolutas embebidas; (3) redacción del home dir → `~`; (4) **nunca** embeber bodies de transcript (el orquestador Phase 57 deriva título inteligente, pero el sanitizer del core es el **backstop** que lo garantiza aunque el consumer falle); (5) descripción opcional, saneada con las mismas reglas. El estado inicial de la tarea es **sano** (in-progress/activo, NO "sin triar") — ver carry-forward D-07.

### Carry-forward desde Phase 52 (no re-discutir)
- **D-07 (de Phase 52 D-04):** la tarea adoptada se crea en estado **in-progress / activo** (refleja que el humano ya trabaja en la sesión), nunca Backlog/pasivo.
- **D-08 (de Phase 52 D-01/D-02/D-06):** `createTask` ya crea **SIN label trigger** (`kodo:gsd`/`kodo:gsd-quick`) + marker `kodo:adopted` → la anti-recursión (BIDIR-06) ya está shipped en Phase 52; la 53 solo invoca el método. El 201 ya round-trippea a `TaskItem` canónico vía `normalizeWorkItem`/`normalizeIssue`, así que `adoptSession` consume un `TaskItem` shape-idéntico a uno fetcheado, sin caso especial.

### Claude's Discretion
- Strings exactas de los `code` del discriminante (la taxonomía D-01 es el contrato; la ortografía exacta la fija el planner coordinando con el CLI de Phase 54).
- Firma exacta del objeto de input de `adoptSession` (los campos de D-02/D-04 son el set mínimo; nombres concretos a discreción).
- Mecánica interna del tmp+rename (sufijo del temp, manejo de `fsync`) — D-05 fija el qué, no el cómo byte a byte.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap (este milestone)
- `.planning/REQUIREMENTS.md` — BIDIR-03 (fontanería + discriminante), BIDIR-04 (guard idempotencia/TOCTOU), BIDIR-05 (atomicidad LOUD), BIDIR-08 (datos auto-derivados + sanitización). Fuente de verdad del scope.
- `.planning/ROADMAP.md` §"Phase 53" — goal + 4 success criteria.

### Decisiones upstream (Phase 52, ya completa)
- `.planning/phases/52-createtask-contrato-anti-recursi-n/52-CONTEXT.md` — `createTask` typeof-detected, marker `kodo:adopted` + anti-recursión, normalización del 201 a `TaskItem` canónico (D-06), estado inicial in-progress (D-04). El core de Phase 53 *consume* lo que la 52 entregó.

### Research v0.13 (grounded en código real)
- `.planning/research/ARCHITECTURE.md` — wiring inverso `createTask → addSession`, build order, "una fontanería, tres consumidores".
- `.planning/research/PITFALLS.md` — invariante "`reconcileTick` único escritor de `alive`", FROZEN-9, 0-token.

### Decisiones de proyecto (no hay ADRs separados; viven en PROJECT.md)
- `.planning/PROJECT.md` §"Key Decisions" + §"Constraints" — 0-token determinista, "kodo no elimina tareas" (un huérfano se resuelve por re-run, nunca por borrado), contrato FROZEN en 9.

No hay specs/ADRs externos — kodo no usa un sistema de ADR separado; las decisiones canónicas viven en PROJECT.md, 52-CONTEXT.md y este CONTEXT.md.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/session/manager.js:32` (`buildSessionFromTask`) — **el inverso EXACTO a espejar.** `buildSessionFromAdoption` replica el shape (`workspace_ref`, `session_id`, `task_id`, `status: 'running'`, `started_at`, `task_url`, `project_*`) omitiendo los flags GSD y los campos reconcile-owned.
- `src/session/manager.js:170` (`launchWorkItem`) — el flujo directo del que `adoptSession` es inverso (sin la rama `cmux.newWorkspace`/`cmux.send`).
- `src/session/state.js:250` (`addSession`) — la **misma clase de escritura** que el launch; `adoptSession` la reusa para sembrar la fila. NO se escribe `dead_since`/`last_seen_alive`.
- `src/session/state.js:341` (`findSession`) — guard idempotencia (escanea sessions+history). `dismiss.js:114` documenta que **NO** keya por `task_id` — el guard keya por `{ workspaceRef, cwd }`.
- `src/session/state.js:241-242` (`saveState`) — **único writer chokepoint** a upgrar a tmp+rename (D-05).
- `src/server/dismiss.js:17,114` — precedente del re-read fresco + TOCTOU 409 (v0.10 Phase 42) a espejar para el guard pre-POST.
- `src/providers/*/provider.js` (`createTask`, typeof-detected, Phase 52) — invocado vía `typeof provider.createTask === 'function'`.

### Established Patterns
- **Discriminante never-throws** `{ ok:true, ... } | { ok:false, code, detail }` — presente en `src/session/manager.js`, `src/server/dismiss.js`, `src/cli/dashboard/*`. `adoptSession` lo replica.
- **Método opcional vía typeof-gate** (NO añadir a `TASK_PROVIDER_METHODS` FROZEN-9) — el call site de `adoptSession` detecta `createTask` por `typeof`, espejo de cómo el dispatcher detecta `getTaskState`.
- **`sessions > history`** (LIFE-01 / `src/logs/session-lookup.js:10`) — orden de precedencia del scan de `findSession`.

### Integration Points
- `src/adopt.js` (NUEVO, top-level) — `adoptSession` + `buildSessionFromAdoption` + `sanitizeAdoptionData`.
- `src/session/state.js` — upgrade de `saveState` a tmp+rename (D-05); reuse de `addSession`/`findSession`/`loadState`.
- Los consumers (Phase 54 CLI / 56 dashboard / 57 orquestador) shellearán/importarán `adoptSession` recibiendo `{ projectId, title?, ... }` resueltos. Phase 53 NO escribe ningún consumer — solo la fontanería + sus tests.
</code_context>

<specifics>
## Specific Ideas

- El core es **non-owner por construcción**: recibe `projectId`/`title` resueltos y datos de host como argumentos. Todo lo interactivo (`listProjects` para elegir proyecto, derivación inteligente de título) vive en los consumers. Esto es lo que mantiene los tres consumidores reusando una sola base sin que ninguno la posea.
- El sanitizer del core es un **backstop de seguridad**, no solo conveniencia: aunque el orquestador (Phase 57) construya el título/descripción, el strip de rutas absolutas + redacción de home + no-transcript se garantiza en el núcleo. Defensa en profundidad para datos que terminan en un sistema externo (el gestor de tareas).
- Reconciliación consciente con PROJECT.md "kodo no crea ni elimina tareas": v0.13 introduce el **create**; el **delete** sigue prohibido. Por eso un `PERSIST_FAILED` es un huérfano LOUD recuperable por re-run, nunca por borrado.
</specifics>

<deferred>
## Deferred Ideas

- **CLI `kodo adopt`** (argv parsing, `--workspace`/`--cwd`/`--project`, exit codes derivados del discriminante) → **Phase 54**.
- **Selección interactiva de proyecto** (`listProjects` como UI) + **derivación de título inteligente** (cwd/commits/transcript) → consumers (Phase 54/56/57, ORCH-01).
- **Detección cmux** (`describeSurface()` → `{ workspaceRef, cwd, sessionId, kind }`) → **Phase 55**. `adopt.js` recibe esos campos como datos.

None — la discusión se mantuvo dentro del scope de la fase.
</deferred>

---

*Phase: 53-fontaner-a-src-adopt-js*
*Context gathered: 2026-06-16*
