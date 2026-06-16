# Phase 54: CLI `kodo adopt` - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-resueltas con la opción recomendada; ver DISCUSSION-LOG.md)

<domain>
## Phase Boundary

Phase 54 entrega el **CLI `kodo adopt`**: el primer consumidor — y referencia de diseño — de la fontanería determinista 0-token `adoptSession` (Phase 53). Es un **thin handler argv→delegación→render**, espejo exacto de `runGsdVerifyCli` (`src/cli/gsd-verify.js`): parsea flags explícitas, resuelve `provider`/`providerName`/`projectPath` desde la config local, invoca `adoptSession`, **deriva exit codes deterministas del discriminante de 6 estados**, y renderiza feedback (human + `--json`).

Es el carril **0-token / no-owner por excelencia**: recibe workspace/cwd/session-id como input explícito (no detección automática, no LLM, no prompts inteligentes). La tecla del dashboard (Phase 56) y el orquestador (Phase 57) lo **shellean** vía `execFile` con argv literal — esta fase fija el contrato de flags y exit codes que ellos consumen.

**En scope (BIDIR-07):**
- Comando `kodo adopt` registrado en `src/cli.js` (commander, con guard `ensureConfig()` — necesita provider) con flags explícitas: `--workspace <ref>`, `--cwd <path>`, `--session-id <id>`, `--project <id>`, `--title <t>`, `--description <d>`, `--json`.
- Handler nuevo `src/cli/adopt.js` (`runAdoptCli(opts, deps)`) con DI (`writeFn`/`errFn`/`formatterFn`/`adoptSessionFn`), espejo del molde de `runGsdVerifyCli`.
- Resolución local de `provider`/`providerName` (registry) y `projectPath` (desde `loadProjects()[projectId]`, espejo de `resolveProjectPath`) antes de invocar `adoptSession`.
- Mapeo determinista discriminante (6 estados) → exit codes (espejo Opción A de `gsd verify`).
- Render human-readable (TTY-aware vía `createFormatter`) + `--json` byte-determinista del discriminante completo.

**FUERA de scope (límites con otras fases):**
- La fontanería `adoptSession`/`buildSessionFromAdoption`/`sanitizeAdoptionData` → **Phase 53, ya completa**. La 54 solo la *invoca*.
- `provider.createTask` (transporte POST) → **Phase 52, ya completa**.
- Detección/auto-derivación de `--session-id`/`--cwd`/`workspaceRef` vía `describeSurface()` → **Phase 55** (la 54 recibe estos campos como flags explícitas; cuando exista, 55 los auto-derivará para los otros consumers).
- Selección **interactiva** de proyecto vía `listProjects` (UI) y derivación de **título inteligente** (cwd/commits/transcript) → consumers (dashboard Phase 56 / orquestador Phase 57). La 54 exige `--project` explícito.
- Tecla del dashboard que shellea `kodo adopt` → **Phase 56**.
</domain>

<decisions>
## Implementation Decisions

### Mapeo de flags → inputs de `adoptSession` (BIDIR-07, success criterion 1)
- **D-01:** El roadmap lista `--workspace/--cwd/--title/--project/--description`, pero `adoptSession` requiere también `sessionId` y `projectPath`. Resolución:
  - **`--session-id <id>` flag explícito (required)** — la 54 es el consumidor de input explícito independiente del spike; Phase 55 (`describeSurface`) lo auto-derivará para dashboard/orquestador, pero el CLI lo recibe como dato. Es `session.session_id` (= `resume_binding.checkpoint_id` de cmux en Phase 55, pero aquí el operador lo provee).
  - **`--project <id>` → `projectId`**; **`projectPath` se resuelve LOCALMENTE** desde `loadProjects()[projectId]` (espejo de `resolveProjectPath` en `manager.js`), **no es un flag**. Si el `projectId` no está mapeado en la config local → error de uso del CLI (exit 1) con mensaje listando los projectIds disponibles, ANTES de invocar `adoptSession` (fail-fast, sin POST).
  - **`--workspace <ref>` → `workspaceRef`** (required), **`--cwd <path>` → `cwd`** (required).
  - **`--title`/`--description` opcionales** — el default de título `basename(cwd)` y el saneo los aplica el CORE (`sanitizeAdoptionData`, Phase 53 D-06), única fuente de verdad; el CLI NO duplica esa lógica.

### Taxonomía de exit codes derivada del discriminante (BIDIR-07, success criterion 2)
- **D-02:** Mapeo determinista de los 6 estados de `adoptSession` a exit codes, **espejo de la Opción A de `gsd verify`** (`src/cli/gsd-verify.js`: 0=corrió/éxito, 1=error interno/input, 2=transient retryable):
  - `{ ok: true }` → **0** (tarea creada + fila sembrada).
  - `ALREADY_ADOPTED` → **0** (idempotente — re-run benigno: la sesión ya está adoptada; mensaje informativo con el `task_id` existente; NO es fallo. Un script que llama `kodo adopt` dos veces no debe romperse). *Tensión reconocida:* algún operador podría querer un código distinto de "no-op"; se resuelve haciéndolo 0 con mensaje explícito "ya adoptada" — preserva el contrato de idempotencia que toda la base usa.
  - `INVALID_INPUT` → **1** (flags requeridas ausentes / projectId sin mapeo — error de uso).
  - `UNSUPPORTED` → **1** (el provider configurado no implementa `createTask` — error de config, no transient).
  - `CREATE_FAILED` → **2** (POST al provider falló: 403/404/5xx/red — transient retryable por script operador, ÚNICO estado retryable, alineado con el exit 2 de `gsd verify`).
  - `PERSIST_FAILED` → **1** pero **LOUD**: banner en **stderr** con `task_id` + `task_url` + `hint` ("recuperable por re-run idempotente"). El POST tuvo éxito pero la escritura local falló → es un huérfano recuperable, NO transient del provider. El CLI es responsable de hacerlo ruidoso (Phase 53 D-03: el consumer hace loud el code semánticamente loud).

### Resolución del proyecto: explícito, no interactivo (BIDIR-07; cierra el deferred de Phase 53)
- **D-03:** `--project <id>` es **explícito y required en v1**. NO hay prompt interactivo ni selección vía `listProjects` en el CLI. Rationale: (1) success criterion 1 enfatiza "input **explícito** (no depende de detección automática)"; (2) el CLI es el consumidor determinista/scriptable de referencia que dashboard/orquestador shellean SIEMPRE con flags — un prompt interactivo rompería esa simetría y la scriptabilidad; (3) Karpathy regla 2 (simplicidad): no añadir UI especulativa. La UI de selección de proyecto (`listProjects`) y la derivación de título inteligente viven en los consumers con UX (Phase 56 dashboard / Phase 57 orquestador), tal como Phase 53 D-04 difirió.

### Forma del feedback de salida (BIDIR-07, success criterion 3)
- **D-04:** Handler `src/cli/adopt.js` espejo de `runGsdVerifyCli`:
  - **Default human-readable** vía `createFormatter(process.stdout)` (TTY-aware, color isolation — importa `src/cli/format.js`, jamás `picocolors` directo). Éxito → muestra `task_id`, `task_url` y el `session_id` sembrado (verde). Fallo → muestra `code` + `detail` legible coloreado por severidad (CREATE_FAILED transient amarillo / INVALID_INPUT|UNSUPPORTED|PERSIST_FAILED rojo).
  - **`--json`** byte-determinista (scriptable): emite el discriminante completo tal cual lo retorna `adoptSession` (`{ ok, code?, detail?, task?, session? }`) vía `JSON.stringify(result, null, 2)` — espejo exacto del `--json` de `gsd verify`/`gsd inspect`. NO se re-genera ni reordena el shape (una sola superficie de verdad: `adoptSession`).
  - **DI**: `runAdoptCli(opts, deps)` con `adoptSessionFn`/`writeFn`/`errFn`/`formatterFn` (molde idéntico a `runGsdVerifyCli`) → testeable sin tocar `process.stdout` ni `state.json` real.

### Claude's Discretion
- Texto exacto de los mensajes human-readable (banner PERSIST_FAILED, mensaje ALREADY_ADOPTED, ayuda de projectIds disponibles) — el planner los fija; el idioma sigue la convención del codebase (CLI handlers ES, mensajes a operador en ES — espejo de `gsd-verify.js` comentarios ES).
- Nombres exactos de las flags si commander exige un formato concreto (`--session-id` vs `--sessionId`) — D-01 fija el set semántico; la ortografía la fija el planner.
- Si `--cwd` debe usarse también como `projectPath` cuando `--project` se omite, o si `--project` es siempre obligatorio: D-03 recomienda `--project` required; el planner confirma si un fallback `projectPath = cwd` (proyecto no mapeado) tiene sentido o se rechaza con INVALID_INPUT.
- Posición exacta del comando en `src/cli.js` (top-level `kodo adopt` vs sub-comando) — D-04 asume top-level `program.command('adopt')`; confirmable.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap (este milestone)
- `.planning/REQUIREMENTS.md` — **BIDIR-07** (CLI `kodo adopt` consumidor determinista con input explícito + exit codes del discriminante). Fuente de verdad del scope.
- `.planning/ROADMAP.md` §"Phase 54" — goal + 3 success criteria (flags explícitas, exit codes derivados del discriminante, feedback task_id/task_url en éxito y code/detail en fallo).

### Decisiones upstream (dependencias completas)
- `.planning/phases/53-fontaner-a-src-adopt-js/53-CONTEXT.md` — la fontanería que la 54 invoca: discriminante de 6 estados (D-01), split puro/impuro (D-02), atomicidad LOUD/PERSIST_FAILED (D-03/D-05), guard idempotencia (D-04), saneo backstop (D-06). El CLI deriva sus exit codes de esta taxonomía.
- `.planning/phases/52-createtask-contrato-anti-recursi-n/52-CONTEXT.md` — `createTask` typeof-detected, marker `kodo:adopted` + anti-recursión, estado inicial in-progress. (Contexto del transporte que `adoptSession` usa.)

### Espejo de implementación (el patrón a replicar)
- `src/cli/gsd-verify.js` — **el molde EXACTO del handler**: thin argv→delegación→render, DI (`runVerifyFn`/`writeFn`/`errFn`/`formatterFn`), exit codes Opción A (0/1/2), `--json` byte-determinista, `renderHuman` con color semántico vía formatter.
- `src/cli.js` §"gsd verify" (líneas ~331-345) — el molde del registro del comando (commander, `ensureConfig()`, lazy import del handler, `process.exit(code)`, try/catch → exit 1).
- `src/adopt.js` — la firma de `adoptSession({ provider, providerName, workspaceRef, cwd, sessionId, projectId, projectPath, title?, description? }, deps?)` y la enumeración exacta de los 6 codes del discriminante (líneas ~135-140).

### Research v0.13 + decisiones de proyecto
- `.planning/research/ARCHITECTURE.md` — "una fontanería, tres consumidores"; el CLI es el consumidor de referencia 0-token.
- `.planning/PROJECT.md` §"Key context" / §"Constraints" — 0-token determinista, no-owner, cero endpoints nuevos (el CLI no toca el contrato HTTP del server), FROZEN-9.

No hay specs/ADRs externos — kodo no usa un sistema de ADR separado; las decisiones canónicas viven en PROJECT.md, 52/53-CONTEXT.md y este CONTEXT.md.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/gsd-verify.js` (`runGsdVerifyCli`) — **el handler a espejar 1:1**: estructura, DI, exit codes Opción A, `--json`, `renderHuman` con formatter.
- `src/cli/gsd-inspect.js` — segundo precedente de exit codes deterministas (`--json`) por si el planner quiere un segundo punto de referencia.
- `src/cli.js:331-345` — bloque del comando `gsd verify`: registro commander + `ensureConfig()` guard + lazy import + `process.exit(code)`.
- `src/adopt.js` (`adoptSession`) — la función a invocar; discriminante de 6 estados ya implementado y testeado (Phase 53).
- `src/providers/registry.js` (`initRegistry`, `getProvider`) — cómo obtener `provider`/`providerName` (visto en `src/cli.js:212-222`).
- `src/config.js` (`loadConfig`, `loadProjects`) — `loadProjects()` retorna `projectId → local path`; fuente para resolver `projectPath`.
- `src/session/manager.js:79-104` (`resolveProjectPath`) — la lógica existente de mapeo projectId→path a espejar para resolver `projectPath` (incl. el error canónico cuando no hay mapeo).
- `src/cli/format.js` (`createFormatter`) — color TTY-aware + `--json` strip; ÚNICA fuente de color (invariante de color isolation).

### Established Patterns
- **Thin CLI handler**: argv → `ensureConfig()` → lazy import → delegación a lógica de negocio → render → `process.exit(code)`. Toda la lógica vive fuera del handler (en `adoptSession`); el CLI solo orquesta y renderiza.
- **Exit codes Opción A** (0=corrió/éxito, 1=interno/input, 2=transient retryable) — convención del codebase (gsd verify/inspect, polling).
- **`--json` byte-determinista**: emitir el shape tal cual lo produce la capa de negocio, sin re-generar (una sola superficie de verdad).
- **DI con `*Fn` defaults**: `deps = {}` con fallbacks a los imports reales → tests inyectan stubs sin tocar I/O real (`state.json`, `process.stdout`, red).
- **Color isolation**: handlers importan `src/cli/format.js`, nunca `picocolors` directo (guard `test/format-isolation.test.js`).

### Integration Points
- `src/cli/adopt.js` (NUEVO) — `runAdoptCli(opts, deps)`.
- `src/cli.js` — registro del comando `kodo adopt` (commander + `ensureConfig()` + lazy import + `process.exit`).
- Importa `adoptSession` de `src/adopt.js`, `getProvider`/`initRegistry` de `src/providers/registry.js`, `loadConfig`/`loadProjects` de `src/config.js`, `createFormatter` de `src/cli/format.js`.
- **Cero endpoints nuevos** (invariante candidato) — el CLI vive enteramente en el carril CLI, no toca `src/server.js`.
- Probable extensión de `test/format-isolation.test.js` (nuevo callsite que importa `format.js`) — el planner confirma.
</code_context>

<specifics>
## Specific Ideas

- El CLI es la **referencia de contrato** para los otros dos consumidores: dashboard (Phase 56) y orquestador (Phase 57) shellean `kodo adopt` vía `execFile` con argv literal (espejo de `focus.js`/`runOpen`), así que el set de flags y los exit codes que esta fase fija son el API que ellos consumen. Diseñar las flags pensando en "¿el orquestador puede pasar esto programáticamente?" (sí: todo explícito, nada interactivo).
- El handler NO replica lógica del core: el default de título (`basename(cwd)`), el saneo de rutas/home, y el discriminante son responsabilidad de `adoptSession`. El CLI solo resuelve `provider`/`projectPath` (que el core no resuelve por diseño 0-token) y mapea el resultado a exit code + render. Defensa contra duplicación de la única fuente de verdad.
- `PERSIST_FAILED` es el único estado que merece tratamiento especial en el render: es un huérfano LOUD (tarea creada en el provider, fila local no escrita) → banner stderr con coordenadas (`task_id`/`task_url`) para que el operador pueda re-correr (idempotente) o inspeccionar. Refleja la constraint de PROJECT.md "kodo no elimina tareas": el huérfano se resuelve por re-run, nunca por borrado.
</specifics>

<deferred>
## Deferred Ideas

- **Auto-derivación de `--cwd`/`--session-id`/`workspaceRef`** vía `describeSurface()` → **Phase 55** (`HostProvider.describeSurface()` sobre cmux). La 54 los recibe como flags explícitas.
- **Selección interactiva de proyecto** (`listProjects` como UI) + **derivación de título inteligente** (cwd/commits/transcript) → consumers con UX: dashboard **Phase 56** / orquestador **Phase 57** (ORCH-01).
- **Tecla `a` del dashboard** que descubre + shellea `kodo adopt` → **Phase 56**.
- **Exit code distinto para ALREADY_ADOPTED** (no-op explícito ≠ éxito): considerado y rechazado en v1 (D-02) a favor de exit 0 idempotente; reconsiderable si un operador real lo pide.

None — la discusión se mantuvo dentro del scope de la fase.
</deferred>

---

*Phase: 54-cli-kodo-adopt*
*Context gathered: 2026-06-16*
