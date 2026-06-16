# Requirements: kodo v0.13 — kodo bidireccional

**Defined:** 2026-06-15
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones. v0.13 cierra el puente en la dirección inversa: una sesión Claude Code creada ad-hoc en cmux (no nacida de una tarea) se promueve a una **tarea persistente** del gestor, para que el trabajo ad-hoc no se evapore. Arquitectura **"una fontanería, tres consumidores"**: una base determinista 0-token (`createTask` + `adoptSession`) reusada por el CLI, la tecla del dashboard (gated) y el orquestador (único carril LLM) — ninguno dueño del flujo.

## v1 Requirements

Requirements del milestone v0.13. Cada uno mapea a una fase del roadmap.

### Adopción bidireccional — núcleo determinista (BIDIR)

Driver: el flujo inverso `sesión → tarea`. El research (`.planning/research/`) verificó que la fontanería es el **inverso exacto** de `manager.launchWorkItem` (`getTask → newWorkspace → addSession`): `adoptSession` hace `createTask → (workspace ya existe) → addSession`, reusando `addSession` verbatim. Todo el transporte POST con auth ya existe (`plane/client.js` y `github/client.js` ya hacen POST para `addComment`). `createTask` se añade como **método OPCIONAL typeof-detected FUERA de los 9 FROZEN** (espejo exacto de `getTaskState`, Phase 40, cuyo comentario `"OPTIONAL method (NOT in TASK_PROVIDER_METHODS — FROZEN at 9, D-13)"` ya vive en ambos `provider.js`). Esta es la **primera vez que kodo crea tareas** — revisa conscientemente el Out of Scope histórico *"kodo no crea ni elimina tareas"*. La base es **determinista y 0-token** (preserva la constraint "solo el orquestador usa LLM").

- [x] **BIDIR-01**: `createTask` implementado como método **opcional typeof-detected** en el adapter **Plane** (`POST .../work-items/`, solo `name` required, `X-API-Key` ya presente en `PlaneClient.request()`), normalizando la respuesta 201 de vuelta a `TaskItem` canónico vía el `normalizeWorkItem` existente. `TASK_PROVIDER_METHODS` permanece FROZEN en 9; el loop de validación de `registry.js` queda intacto; un `it()` capability-gated en `test/providers/contract.test.js` espeja el test B8 de `getTaskState`.
- [x] **BIDIR-02**: `createTask` implementado igualmente en el adapter **GitHub** (`POST /repos/{o}/{r}/issues`, solo `title` required, body en **Markdown** — divergencia ya conocida del split de `addComment`), con el scope PAT mínimo (`issues:write`/`repo`) documentado. Contract matrix Plane+GitHub itera la capability como en v0.10.
- [x] **BIDIR-03**: Fontanería `src/adopt.js` (`adoptSession()` + `buildSessionFromAdoption()` puro) — capability-gate → `createTask` → normalize → `addSession`, retornando el discriminante never-throws universal del codebase `{ ok:true, task, session } | { ok:false, code, detail }`. Vive como módulo top-level provider-agnostic (NO bajo `src/gsd/` — la adopción no sabe de GSD). `adoptSession` **siembra** la fila en `state.json` vía el `addSession` existente (misma clase de escritura que el launch); NO escribe `dead_since`/`last_seen_alive` (reconcile-owned) — la invariante "`reconcileTick` único escritor de `alive`" se preserva.
- [x] **BIDIR-04**: **Guard de idempotencia / double-adopt** — `findSession({ workspaceRef, cwd })` (escanea sessions+history) ANTES del POST; si la sesión ya está adoptada → `ALREADY_ADOPTED` sin crear tarea (cero duplicados). Re-check TOCTOU con `loadState()` fresco al estilo del 409 del dismiss (v0.10 Phase 42). La ventaja estructural de kodo: el mapeo autoritativo es **local** (`state.json`), no requiere búsqueda remota difusa.
- [x] **BIDIR-05**: **Atomicidad create+adopt** — orden POST-primero, escritura local `state.json` último (tmp+rename atómico). Si el POST tiene éxito pero la escritura local falla → fallo **LOUD** con `task_id` + `task_url` en el mensaje (never-throws es solo para los carriles de lectura; un huérfano de proveedor es irrecuperable porque kodo no borra tareas), recuperable vía re-run idempotente (BIDIR-04).
- [x] **BIDIR-06**: **Anti-recursión** — una tarea recién adoptada **NUNCA** debe ser re-despachada por el poller/webhook lanzando una segunda sesión que colisione con la sesión ad-hoc viva. El `first-tick skip` (`polling.js:173`) NO protege el caso de una tarea creada mientras el daemon ya corre. Mitigación espejo del corte `isGsdChild` (`dispatcher.js:68`, ANTES de lock/resolver/launch, `--force` no bypasea) + crear en estado **no-trigger** para que `listPendingTasks` no la devuelva. Propiedad de corrección del núcleo, construida junto a `createTask` (precedente: anti-recursión shipped *con* el reporting en Phase 29, no después).
- [x] **BIDIR-07**: Comando CLI **`kodo adopt`** (consumidor determinista, 0-token) con flags `--workspace`/`--cwd`/`--title`/`--project`/`--description`. Recibe el workspace/cwd **explícito** → no depende de la detección automática; **ships sí o sí** con independencia del veredicto del spike. Exit codes deterministas desde el discriminante; feedback de éxito con `task_id` + `task_url`.
- [x] **BIDIR-08**: **Datos auto-derivados editables + sanitización** — título default `basename(cwd)`, editable (nunca commit silencioso); proyecto destino vía `listProjects` (ya en los 9 FROZEN — reuse directo); descripción opcional. Sanitizar antes del POST: strip de rutas absolutas, redacción del home dir, nunca embeber bodies de transcript. Estado inicial sano (in-progress/todo) — la tarea adoptada no cae en "sin triar".

### Detección de sesiones ad-hoc + tecla del dashboard (DETECT)

Driver: descubrir las sesiones `claude` ad-hoc para adoptarlas desde el dashboard. **El gate duro original (spike) está RESUELTO: VIABLE.** El research empírico `.planning/research/CMUX-CAPABILITIES.md` (P0, cmux 0.64.15 verificado) encontró que `cmux surface resume show --json` entrega por surface `cwd` + `resume_binding.checkpoint_id` (= el `session_id` de Claude Code) + `kind` — exactamente cwd + UUID de sesión estable + identidad del agente, sin screen-scraping ni heurística. Eso responde la única incógnita del spike. **Regla transversal (LOCKED):** toda capacidad cmux-específica entra por el contrato `HostProvider` (`src/host/interface.js`, Phase 38) e implementada en `src/host/cmux.js` (el único llamador autorizado, never-throws, `run` DI-injectable), con detección `typeof` para degradar fail-open — NO esparcir llamadas a `cmux` por `adopt.js`/`reconcile.js`/hooks. La superficie sigue sin estar docs-pinned (el proyecto se quemó dos veces en superficies version-specific: Phase 50→50.1, Phase 43), así que el contrato se **fixture-lockea** (assert vía el `run` DI) para que un cambio de cmux falle ruidosamente.

- [ ] **DETECT-01** *(contrato HostProvider — ya NO un spike)*: Método opcional typeof-detected en el contrato `HostProvider` (`src/host/interface.js`), p. ej. `describeSurface(ref)` / `listAgentSurfaces()`, implementado en `src/host/cmux.js` sobre `cmux surface resume show --json`. Devuelve por surface los campos consumidos `{ workspaceRef, cwd, sessionId (= resume_binding.checkpoint_id), kind }`. Debe: (a) **fixture-lockear** la salida real de cmux 0.64.15 y asertarla vía el `run` DI (un cambio de contrato falla ruidosamente); (b) manejar los modos de fallo fail-open — `cleared: true`, `resume_binding` ausente, `source != agent-hook`, socket de cmux no disponible → degrada sin romper; (c) el set-difference de "sesiones adoptables" contra `state.json` se keyea por `sessionId`/`cwd` estable, NUNCA por el `workspace_ref` reciclable (defensa Phase 43). `adopt.js`/`reconcile.js` permanecen host-agnósticos: reciben estos campos como datos, jamás llaman a `cmux`.
- [ ] **DETECT-02** *(consumidor — ya NO condicional)*: Tecla dedicada (`a`) en el dashboard sobre una sesión ad-hoc descubierta vía `DETECT-01` → shells **`kodo adopt`** vía `execFile` sin shell (argv literal, espejo de `focus.js`/`runOpen`), **cero endpoints nuevos** en `src/server.js` (preserva el invariante "cero endpoints nuevos desde v0.10"). Sesiones adoptables = surfaces con `kind == "claude"` cuyo `sessionId` no está ya en `state.json`. Discovery on-demand al pulsar la tecla (NO un poll loop); double-confirm (espejo del dismiss Phase 42); never-throws (el panel ink permanece montado).

### Adopción asistida por el orquestador (ORCH)

Driver: el orquestador es el **único carril con LLM** (constraint "vigilante/server 0 tokens"), así que es quien puede derivar un título *bueno* del contexto real de la sesión en vez de `basename(cwd)` = `agent-xyz`. Es un **consumidor** de la misma fontanería, no dueño ni mecanismo paralelo. No depende del spike (deriva el título y shells `kodo adopt` con input explícito) → paralelizable con DETECT-02.

- [ ] **ORCH-01**: El orquestador propone proactivamente adoptar una sesión ad-hoc y deriva un **título inteligente** del contexto real (cwd / commits / transcript), que pasa por el sanitizador del núcleo (BIDIR-08) y se confirma (humano/CLI) antes de crear. Implementado shelleando el mismo `kodo adopt --title "<derived>"` — el carril 0-token del núcleo se preserva, el LLM vive estrictamente en el consumidor (prosa del skill `kodo-orchestrate` actualizada; cero lógica de negocio nueva en el orquestador).

### Deuda heredada de v0.12 (DEBT)

Driver: saldar los 2 items diferidos al cierre de v0.12 (STATE.md `## Deferred Items`), schedulables independientemente del flujo de adopción.

- [ ] **DEBT-01** *(security)*: Hardening del **XSS latente WR-01** — el carril HTML del dashboard (`src/server.js`) renderiza `task_url` como `<a href>` sin la allowlist de protocolo `http(s)` que el carril TUI sí aplica (`runOpen`); un `javascript:`/`data:` en `task_url` es inyectable en el HTML servido. Aplicar la misma allowlist `http(s)` (con `new URL()`) + escaping antes de renderizar el `<a href>`.
- [ ] **DEBT-02** *(uat)*: Cerrar el **HUMAN-UAT diferido de Phase 50.1** — los 3 escenarios + `50.1-VERIFICATION.md` (`human_needed`, 8/8 must-haves auto-verificados) del display de progreso vivo `N/M`, verificados visualmente en un TTY real con una sesión GSD viva (montable ahora que el milestone retoma trabajo activo).

### Ciclo de vida de cierre (LIFE)

Driver: hoy una sesión cerrada por `/exit` queda colgada como `dead` en el dashboard hasta el sellado a 30 días. **Causa raíz confirmada por spike** (Claude Code 2.1.177, doc oficial de hooks): `/exit` emite el evento **`SessionEnd`** (`end_reason: "prompt_input_exit"`), **NO** `Stop`; kodo solo registra `SessionStart` + `Stop` (`install.js:38,41`), así que el cierre interactivo no dispara ningún hook de kodo y `reconcileTick` solo lo marca `dead` vía `pgrep` (nunca hace `removeSession`). El spike también verificó que `SessionEnd` no puede bloquear (solo side-effects, ideal para cleanup), su payload trae `session_id`/`cwd`/`transcript_path`/`end_reason` (correlación a la tarea vía el `findSession` existente), y soporta matcher por `end_reason`. Continúa la numeración histórica LIFE-01/02 (v0.8 Phase 30). **Nota:** la *sincronización con el provider al cerrar* (transicionar la tarea en Plane/GitHub) queda explícitamente FUERA — una sesión cerrada con `/exit` no implica "done" (el trabajo puede estar a medias) y rompería la invariante "el agente posee las interacciones con el provider"; diferida como LIFE-F1.

- [ ] **LIFE-03**: kodo registra un hook **`SessionEnd`** que dispara **cleanup terminal limpio** cuando una sesión termina por `/exit` (u otros `end_reason`) — la fila desaparece del dashboard (`removeSession` + worktree cleanup + release del lock GSD) en vez de quedar colgada como `dead`. Reusa el cleanup compartido de `stop.js` (NO duplica). Resuelve la **separación de responsabilidades** entre los dos hooks: `Stop` (que dispara al final de **cada turno**) queda para el estado ligero (`idle`, lock liberado, esperando humano), y el cleanup **destructivo** (`removeSession`/worktree) se concentra en `SessionEnd`. **Idempotente**: ambos hooks pueden coexistir sin pelear (guard `source === 'history'` ya presente en `stop.js:153` + re-check). El handler `SessionEnd` es never-throws / fail-open como el resto de hooks (jamás crashea Claude Code). `install.js`/`uninstall` extendidos al tercer evento; golden-bytes de los hooks existentes preservados.

## v2 Requirements

Diferidos a un milestone futuro. Reconocidos pero fuera del roadmap actual.

### Adopción — alcance futuro (BIDIR-F)

- **BIDIR-F1** *(RESUELTO — ya no aplica)*: era el fallback si DETECT-01 salía INVIABLE. La detección quedó probada **VIABLE** empíricamente (`CMUX-CAPABILITIES.md` P0, `surface resume show --json`), así que DETECT-02 deja de estar gated y se entrega en v0.13. Conservado como traza histórica.
- **BIDIR-F2**: Backfill de la descripción de la tarea adoptada desde el transcript/diff de la sesión (resumen automático del trabajo ya hecho).
- **BIDIR-F3**: `createTask` / adopt hacia ClickUp y el adapter local (JSON/Markdown) cuando esos adapters existan.

### Ciclo de vida — alcance futuro (LIFE-F)

- **LIFE-F1**: Sincronización del estado del provider al cerrar una sesión (transicionar la tarea en Plane/GitHub a `review`/`done` cuando la sesión termina). Diferido: requiere decidir *qué* estado representa un cierre por `/exit` (el trabajo puede estar a medias) y revisa conscientemente la invariante "el agente posee las interacciones con el provider". Candidato a un milestone de lifecycle dedicado.

### Provider reach (heredados, sin cambios)

- **CLICKUP-F1**: Adapter ClickUp como 3er `TaskProvider`.
- **LOCAL-F1**: Adapter local (JSON/Markdown) + file watcher.
- **GH-F1**: Webhook GitHub ingress real-time · GitHub Enterprise (`base_url`) · OAuth GitHub App.

## Out of Scope

Explícitamente excluido. Documentado para prevenir scope creep.

| Feature | Reason |
|---------|--------|
| CRUD completo de tareas | kodo crea (nuevo en v0.13) y lee/actualiza, pero **nunca elimina** tareas — un huérfano de proveedor se resuelve por re-run idempotente, no por delete |
| Auto-adopt silencioso de sesiones ad-hoc | La adopción es siempre una acción consciente del operador (CLI/tecla) o una propuesta confirmada (orquestador); nunca automática sin confirmación |
| Nuevo endpoint HTTP `POST /adopt` en `src/server.js` | La adopción vive en CLI + acción de dashboard que shellea el CLI vía `execFile`; preserva "cero endpoints nuevos desde v0.10" |
| Búsqueda remota de duplicados | La idempotencia se resuelve con el mapeo local autoritativo (`state.json`), no con una query difusa al proveedor |
| Sync bidireccional continuo gestor↔sesión | v0.13 es un puente puntual de promoción (sesión→tarea una vez), no una sincronización viva permanente |
| Filas ad-hoc permanentes en la tabla principal del dashboard | Una sesión sin `task_id`/`provider_state`/plan sería ciudadano de segunda clase; la detección es on-demand al pulsar la tecla, no una sección más en la tabla |
| `createTask` como 10º método del contrato | Rompería "FROZEN en 9"; es opcional typeof-detected (espejo `getTaskState`) |

## Traceability

Qué fases cubren qué requirements. La llena el roadmapper durante la creación del roadmap.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BIDIR-01 | Phase 52 | Complete |
| BIDIR-02 | Phase 52 | Complete |
| BIDIR-03 | Phase 53 | Complete |
| BIDIR-04 | Phase 53 | Complete |
| BIDIR-05 | Phase 53 | Complete |
| BIDIR-06 | Phase 52 | Complete |
| BIDIR-07 | Phase 54 | Complete |
| BIDIR-08 | Phase 53 | Complete |
| DETECT-01 | Phase 55 | Pending |
| DETECT-02 | Phase 56 | Pending |
| ORCH-01 | Phase 57 | Pending |
| DEBT-01 | Phase 58 | Pending |
| DEBT-02 | Phase 58 | Pending |
| LIFE-03 | Phase 58 | Pending |
