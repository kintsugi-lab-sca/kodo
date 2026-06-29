# Phase 56: Tecla del dashboard - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-resueltas con la opción recomendada; ver DISCUSSION-LOG.md)

<domain>
## Phase Boundary

Phase 56 cierra el flujo `sesión → tarea` por el lado del **operador**: una tecla dedicada (`a`) en el `kodo dashboard` **descubre on-demand** las sesiones `claude` ad-hoc de cmux (vía el seam `listAgentSurfaces()` de Phase 55) y **adopta** la elegida shelleando `kodo adopt` (CLI de Phase 54) vía `execFile` sin shell. El panel ink permanece montado pase lo que pase (never-throws), con double-confirm espejo del dismiss de Phase 42.

Es un **CONSUMIDOR puro** de la arquitectura "una fontanería, tres consumidores": NO añade lógica de negocio (el descubrimiento lo hace `src/host/cmux.js`, la creación de la tarea la hace `kodo adopt`). El dashboard solo orquesta: descubre → diff contra lo ya trackeado → confirma → shellea.

**En scope (DETECT-02):**
- Tecla `a` en `App.js` que dispara descubrimiento **on-demand** (al pulsar, NO un poll loop) llamando `host.listAgentSurfaces()` typeof-detected.
- Set-difference "sesiones adoptables" = surfaces con `kind == "claude"` cuyo `sessionId` ∉ las sesiones ya trackeadas, keyeado por `sessionId` (NUNCA `workspaceRef`).
- Presentación de las surfaces adoptables (las ad-hoc NO están en `state.json` → no son filas de la tabla existente) y selección por el operador.
- Shell de `kodo adopt` vía `execFile` argv-literal sin shell (espejo de `focus.js`/`open.js`), never-throws `{ok}`, resultado al footer.
- Double-confirm (segunda `a` ejecuta, Esc cancela), armado por identidad (`sessionId` de la surface elegida).
- **Cero endpoints nuevos** en `src/server.js` (preserva el invariante "cero endpoints nuevos desde v0.10").

**FUERA de scope (límites con otras fases):**
- **Título inteligente** derivado del contexto real (cwd/commits/transcript) → **Phase 57 / ORCH-01** (el orquestador es el único carril con LLM). La tecla del dashboard usa el default del core (`basename(cwd)`, Phase 54).
- **Auto-derivar los flags de `kodo adopt`** para el CLI/orquestador desde el seam → refinamiento Phase 54/57.
- Cualquier llamada a `cmux` desde `adopt.js`/`reconcile.js`/hooks → **prohibida por la regla transversal LOCKED** (todo lo cmux-específico vive en `src/host/`).
- Nuevos endpoints HTTP (`GET /surfaces`, etc.) → **rechazado**; el descubrimiento vive in-process en el proceso del dashboard (D-01).
- Modos de fallo del propio `listAgentSurfaces` (cleared / source≠agent-hook / socket caído) → ya resueltos fail-open en Phase 55; el consumer solo recibe el array ya filtrado.
</domain>

<decisions>
## Implementation Decisions

### Wiring del descubrimiento sin endpoint nuevo (success criteria 1, 3)
- **D-01:** El dashboard **instancia el host cmux in-process** vía `getHost('cmux', { exec/run, binary, logger })` y llama `host.listAgentSurfaces()` detectado por `typeof` al pulsar `a`. `src/host/interface.js:91` ya designa explícitamente "el wiring del dashboard" como consumidor de `getHost`. NO se añade endpoint al server (preserva el invariante). Es la **extensión natural** de `focus.js`, que ya shellea `cmux select-workspace` directamente vía `execFile` desde el proceso del dashboard. Si el host no soporta el método (typeof falla) o devuelve `[]` → footer informativo, nunca rompe.
- **D-02:** El **set-difference** se hace contra el snapshot vivo de `GET /status` que el dashboard YA tiene polleado — adoptables = surfaces `kind=="claude"` cuyo `sessionId` NO está entre los `session_id` de las sesiones activas del último `/status`. **Keyeado por `sessionId`, NUNCA por `workspaceRef`** (cmux recicla `workspace:N` — defensa Phase 43, D-06 Phase 55). NO se hace un read nuevo de `state.json`: se reusa el dato ya polleado. Vive en un helper puro React-free (p. ej. `computeAdoptable(surfaces, statusSessions)`), molde de `select.js`.

### Presentación + selección de las surfaces descubiertas (success criterion 1)
- **D-03:** Descubrimiento **on-demand** (NO poll loop): `a` → discover. Como las sesiones ad-hoc NO están en `state.json`, no pueden ser filas de la tabla existente → se presentan en un **overlay picker** (`mode:'overlay'`, el 5º consumidor tras `c`/`l`/`p`) listando las adoptables (cwd + `sessionId` corto + `kind`), snapshot congelado bajo el poll vivo, `Esc` preserva cursor. 0 adoptables / host sin soporte → footer informativo (`no adoptable sessions found`), sin abrir overlay.
- **D-04:** **Double-confirm espejo de Phase 42**: dentro del picker, seleccionar una surface y armar adopt → prompt `adopt <ref>? press a again · Esc cancel`, armado por **identidad** (`sessionId` de la surface elegida, NUNCA índice ni snapshot de fila) → segunda `a` ejecuta, `Esc` cancela. Espejo 1:1 del doble-`d` del dismiss (`DISMISS_CONFIRM`/armed-by-task_id en `App.js`).

### Resolución del proyecto destino (success criterion 1)
- **D-05:** `kodo adopt` exige `--project <id>` (mapeado en `~/.kodo/projects.json`), pero el descubrimiento NO devuelve proyecto. Decisión: un **helper puro hace reverse-lookup `cwd → projectId`** contra el mismo mapa que lee `adopt.js` (`loadProjects()`). Match único e inequívoco → se usa ese `projectId`. Sin match o ambiguo → **footer never-throws** (`no/ambiguous project for <cwd> — adopt via kodo adopt --project <id>`) y NO se shellea. Rationale: mantiene el dashboard como consumidor fino (cero lógica de creación de tarea), determinista 0-token, y falla ruidoso hacia el escape-hatch del CLI. **⚠ FLAG para el planner:** confirmar el shape real de `projects.json` (`Record<projectId, string | {default}>`) y decidir la semántica de match (`cwd` exacto vs `projectPath` ancestro más cercano).

### argv literal a `kodo adopt` + estrategia de título (success criterion 1)
- **D-06:** `runAdopt({ exec, binary, ... })` **molde de `runFocus`/`runOpen`**: never-throws `{ok}` discriminado, `exec` inyectado (leak guard ESTRUCTURAL, sin default → TypeError si se omite), timeout 5s. argv **LITERAL sin shell**: `['adopt', '--workspace', workspaceRef, '--cwd', cwd, '--session-id', sessionId, '--project', projectId]`. `binary` = el ejecutable kodo (resolución vía config o `process.argv[1]` — discreción del planner, espejo de cómo `focus.js` resuelve el binario cmux desde config). **SIN `--title`** desde el dashboard → el core aplica `basename(cwd)` (Phase 54); el título inteligente es Phase 57. **SIN `--json`** (footer interactivo, no scripted).

### never-throws + resultado al footer (success criterion 3)
- **D-07:** El resultado de `runAdopt` `{ok}` se mapea al **footer transitorio** (verde éxito / rojo error con `code`/exit code), espejo de `OPEN_OK`/`DISMISS_ERR` (copies literal-estables en `App.js`). never-throws end-to-end: ningún throw llega a React, cero `unmount` del panel ink. Los exit codes de `kodo adopt` (Opción A: 0 ok / 1 config / 2 transient POST) se reflejan como detalle del footer; el dashboard NO los reimplementa — shellea y reporta.
- **D-08:** **Color isolation preservado** (invariante cross-milestone Phase 34 D-12): los módulos nuevos (`runAdopt`, helper de diff) importan SOLO `node:*` o internos puros; CERO `picocolors`, CERO `src/cli/format.js`. El walker `test/format-isolation.test.js` (escanea `src/cli/dashboard/**`) lo verifica automáticamente.

### Claude's Discretion
- **Nombres exactos de sub-modos** del picker + máquina de confirm (`mode:'adopt-pick'` vs reuso de `overlay` + `confirm`) — el planner elige el state-machine mínimo que respete D-03/D-04.
- **Semántica del reverse-lookup `cwd → projectId`** (match exacto del `cwd` vs `projectPath` ancestro más cercano que contenga el `cwd`).
- **Resolución del path del binario kodo** (`process.argv[1]` vs `loadConfig().kodo.binary` vs `'kodo'` en PATH).
- **Copy exacta del footer y eventos NDJSON** (`adopt.shell.ok/fail`, siguiendo la taxonomía existente).
- **Estructura del helper de diff** (puro separado `computeAdoptable` vs inline) — recomendado puro testeable, molde de `select.js`.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap (este milestone)
- `.planning/REQUIREMENTS.md` — **DETECT-02** (tecla `a`, `execFile` sin shell espejo `focus.js`/`runOpen`, cero endpoints nuevos, adoptables = `kind=="claude"` ∧ `sessionId` ∉ `state.json`, discovery on-demand, double-confirm Phase 42, never-throws). Fuente de verdad del scope. Incluye DETECT-01 como contexto del seam consumido.
- `.planning/ROADMAP.md` §"Phase 56" — goal + 3 success criteria. §"Progress" — **regla transversal LOCKED** (todo lo cmux-específico entra por `src/host/`, nunca esparcido).

### El seam consumido (Phase 55 — LEER PRIMERO)
- `.planning/phases/55-contrato-hostprovider-describesurface-cmux/55-CONTEXT.md` — el contrato de `listAgentSurfaces()`: shape `{ workspaceRef, cwd, sessionId, kind }`, D-06 (set-difference keyeado por `sessionId`/`cwd` vive en ESTE consumer), fail-open semantics.
- `src/host/cmux.js` — `createCmuxHost` + `listAgentSurfaces()` (el método typeof-detected que el dashboard llama). El `run`/`exec` DI.
- `src/host/interface.js` — `getHost('cmux', opts)` factory (`:91` designa "el wiring del dashboard"), `HOST_METHODS` congelado en 4 (el método NO está ahí).
- `.planning/research/CMUX-CAPABILITIES.md` §P0 — `sessionId == resume_binding.checkpoint_id`; fuente de enumeración.

### El CLI shelleado (Phase 54)
- `src/cli/adopt.js` — `runAdoptCli`: shape de entrada `{ workspaceRef, cwd, sessionId, projectId, title?, description? }`, resolución de `projectPath` vía `loadProjects()[projectId]` (fail-fast si no mapeado), exit codes Opción A (0/1/2).
- `src/cli.js:248-270` — el comando `adopt` registrado: `--workspace` `--cwd` `--session-id` `--project` (required) + `--title` `--description` `--json` (optional). El argv que `runAdopt` construye literal.

### Moldes a replicar en el dashboard (espejo de implementación)
- `src/cli/dashboard/focus.js` — `runFocus` (`FOCUS_VERB`/`FOCUS_FLAG`): el molde execFile never-throws `{ok}`, `exec` inyectado sin default (leak guard), argv literal fijo, timeout 5s. **El patrón exacto que `runAdopt` clona.**
- `src/cli/dashboard/open.js` — `runOpen`: variante con `binary` con default + union de `FocusResult`. Segundo análogo.
- `src/cli/dashboard/App.js` — `useInput` mode-gated (`list`/`filter`/`overlay`/`confirm`), el doble-`d` del dismiss (`DISMISS_CONFIRM`, armed-by-task_id, `mode:'confirm'`), los overlays `c`/`l`/`p` (`mode:'overlay'` + snapshot congelado + Esc preserva cursor), las copies literal-estables del footer (`OPEN_OK`/`DISMISS_*`), la línea de ayuda del footer (`↑↓ move · c comments …`) a extender con `a adopt`.
- `src/cli/dashboard/select.js` — helpers derive PUROS React-free (sort/filter/selección por identidad) — molde de `computeAdoptable`.
- `src/cli/dashboard/index.js` — wiring del `runDashboard` (DI, `resolveBaseUrl`) — donde se inyectaría el host/exec.

### Tests / invariantes
- `test/format-isolation.test.js` — walker color-isolation sobre `src/cli/dashboard/**` (D-08).
- `test/host/contract.test.js` — la contract matrix con la fixture `surface-resume-show.json` (Phase 55), por si se necesita un stub de host en el test del dashboard.

No hay specs/ADRs externos — kodo no usa un sistema de ADR separado; las decisiones canónicas viven en PROJECT.md, los CONTEXT.md de fase y CMUX-CAPABILITIES.md.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `runFocus` (`focus.js`) / `runOpen` (`open.js`) — molde directo de `runAdopt`: copiar la forma (`exec` inyectado sin default, argv literal, never-throws `{ok, code, detail}`, timeout 5s), cambiar el binario y el argv.
- `getHost('cmux', opts)` (`interface.js`) — factory ya preparada para el wiring del dashboard; instancia el host in-process sin tocar el server.
- `mode:'overlay'` machinery en `App.js` (c/l/p) — snapshot congelado + `Esc` preserva cursor: reusable como picker de surfaces adoptables.
- Máquina `mode:'confirm'` del dismiss (armed-by-identity + segunda tecla ejecuta) — molde del double-confirm de adopt.
- `select.js` (derive puro React-free) — molde de `computeAdoptable(surfaces, statusSessions)`.
- Copies literal-estables del footer (`OPEN_OK`/`DISMISS_OK`/`DISMISS_ERR`) — molde de las copies de adopt.

### Established Patterns
- **Opcional typeof-detected**: el call site hace `typeof host.listAgentSurfaces === 'function'` → degrada fail-open (espejo de `provider-state.js:78` con `getTaskState`).
- **execFile sin shell, never-throws, `exec` inyectado sin default** (leak guard estructural) — `focus.js`/`open.js`.
- **Selección por identidad, NUNCA por índice/workspaceRef** — `select.js` (TUI) + D-06 Phase 55 (set-difference por `sessionId`).
- **Cero endpoints nuevos desde v0.10** — el descubrimiento vive in-process, no en el server.
- **Color isolation** — `src/cli/dashboard/` no importa `picocolors`; color solo de `<Text color>` de ink.
- **Una fontanería, tres consumidores** — el dashboard NO crea la tarea ni descubre por su cuenta; orquesta seam (host) + CLI (adopt).

### Integration Points
- `src/cli/dashboard/App.js` — nuevo handler de `a` en el `useInput` mode-gated; nuevo `mode` para el picker; footer + línea de ayuda.
- `src/cli/dashboard/index.js` — inyectar el host cmux (`getHost`) y el `execFile` real en `runDashboard` (DI mínima, sin tocar el lifecycle de 34/36/37).
- Snapshot de `GET /status` (ya polleado por `usePoll`) — fuente del set-difference (D-02).
- `kodo adopt` (proceso hijo vía execFile) — la única mutación; el dashboard solo lee su exit code.
</code_context>

<specifics>
## Specific Ideas

- El flujo completo de operador: `a` → discover in-process → overlay lista adoptables → ↑↓ + `a`/Enter selecciona → prompt double-confirm → segunda `a` shellea `kodo adopt` → footer verde/rojo → la fila aparecerá en el próximo `/status` (la sesión queda trackeada).
- La adopción NO bloquea el panel: `runAdopt` es async never-throws, el poll sigue corriendo; el resultado llega al footer transitorio.
- El reverse-lookup `cwd → projectId` (D-05) es el único punto que puede impedir el shell — y falla ruidoso hacia el CLI, nunca silencioso.
</specifics>

<deferred>
## Deferred Ideas

- **Título inteligente** derivado de cwd/commits/transcript → **Phase 57 (ORCH-01)** — el orquestador es el único carril con LLM.
- **Auto-derivar los flags de `kodo adopt`** desde el seam `listAgentSurfaces()` para el CLI/orquestador → refinamiento **Phase 54/57**.
- **Backfill de la descripción** de la tarea adoptada desde el transcript/diff de la sesión → **BIDIR-F2**.
- **Endpoint `GET /surfaces`** en el server → **rechazado** (violaría "cero endpoints nuevos"); se eligió el wiring in-process (D-01).
- **`createTask`/adopt hacia ClickUp + adapter local** → **BIDIR-F3** (cuando esos adapters existan).

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 56-tecla-del-dashboard*
*Context gathered: 2026-06-17*
