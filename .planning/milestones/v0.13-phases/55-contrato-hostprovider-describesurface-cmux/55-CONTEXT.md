# Phase 55: Contrato `HostProvider.describeSurface()` (cmux) - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-resueltas con la opción recomendada; ver DISCUSSION-LOG.md)

<domain>
## Phase Boundary

Phase 55 añade al contrato `WorkspaceHost` (`src/host/interface.js`, Phase 38) un método **opcional typeof-detected** que descubre las sesiones `claude` ad-hoc de cmux y las devuelve como datos host-agnósticos `{ workspaceRef, cwd, sessionId, kind }` por surface. La implementación vive en `src/host/cmux.js` sobre `cmux surface resume show --json` (cmux 0.64.15), **fixture-lockeada** y **fail-open**.

Es el **seam del host** de la dirección bidireccional: el dato que consumen Phase 56 (tecla `a` del dashboard → descubrir sesiones adoptables), opcionalmente Phase 54 (auto-derivar `--cwd`/`--session-id`) y Phase 57 (orquestador). NO es un spike — la viabilidad ya está probada empíricamente (`.planning/research/CMUX-CAPABILITIES.md` P0: `resume_binding.checkpoint_id` == `session_id` de Claude Code). El deliverable es **código de producción + fixture**, no un veredicto.

**En scope (DETECT-01):**
- Método opcional nuevo en `src/host/cmux.js` (NO en `HOST_METHODS`), detectado por `typeof` en el call site — espejo exacto de `getTaskState`/`createTask` (degrada fail-open si el host no lo soporta).
- Parseo de `cmux surface resume show --json` → array de surfaces con `{ workspaceRef, cwd, sessionId (= resume_binding.checkpoint_id), kind }`.
- Fixture con la salida real de cmux 0.64.15 (`test/fixtures/cmux/`), asertada vía el `run` DI; un cambio de contrato de cmux falla ruidosamente.
- Manejo fail-open de los modos de fallo: `cleared: true`, `resume_binding` ausente, `source != agent-hook`, socket de cmux no disponible → degrada sin romper (never-throws).

**FUERA de scope (límites con otras fases):**
- La **tecla `a`** del dashboard que consume este método + el **set-difference** "sesiones adoptables = `kind=="claude"` ∧ `sessionId` ∉ `state.json`" → **Phase 56** (el método solo *descubre y devuelve*; la diferencia contra `state.json` la hace el consumidor).
- **Auto-derivación** de los flags de `kodo adopt` desde este método → **Phase 54/57** (la 54 sigue recibiendo input explícito; cuando exista este seam, el consumidor lo auto-deriva).
- Capacidades cmux P1/P2/P3 (event bus, `set-progress`, `notify` rico) → futuros milestones (`CMUX-CAPABILITIES.md`), no esta fase.
- Cualquier llamada a `cmux` desde `adopt.js`/`reconcile.js`/hooks → **prohibida por la regla transversal LOCKED**: todo lo cmux-específico vive aquí.
</domain>

<decisions>
## Implementation Decisions

### Forma y nombre del método (DETECT-01, success criteria 1-2)
- **D-01:** **Método primario `listAgentSurfaces()` (enumeración → array)**, NO `describeSurface(ref)` como entrada única. Rationale: el consumidor crítico (Phase 56) necesita **descubrir todas** las surfaces ad-hoc para hacer el set-difference contra `state.json`, no consultar una `ref` ya conocida. Devuelve `AgentSurface[]`. Si un consumer quiere una sola surface por `ref` (Phase 54), filtra el array por `workspaceRef` — no se añade un segundo método salvo que el planner confirme que cmux ofrece una consulta per-ref más barata (Karpathy regla 2: una superficie, no dos especulativas). El roadmap nombra `describeSurface(ref)`/`listAgentSurfaces()` como alternativas — **se elige la enumeración** por ser lo que los 3 consumers pueden construir encima.

### Esquema de los campos devueltos (DETECT-01)
- **D-02:** **camelCase `{ workspaceRef, cwd, sessionId, kind }`** — alineado EXACTAMENTE con la firma de entrada de `adoptSession` (`{ workspaceRef, cwd, sessionId, projectId, ... }`, Phase 53) y con la literal de DETECT-01/roadmap. Divergencia *consciente* del `WorkspaceInfo` existente (snake_case: `workspace_ref`, `last_activity`): aquel es un shape de **observación de lifecycle**; éste es un shape de **input de adopción**, y debe encajar sin transformación en el consumer (`adopt.js` recibe los campos como datos). `sessionId` se mapea desde `resume_binding.checkpoint_id`; `cwd` desde `resume_binding.cwd`; `kind` desde `resume_binding.kind`; `workspaceRef` desde `workspace_ref` del surface.

### Opcional typeof-detected, FUERA del contrato congelado (DETECT-01, success criterion 1)
- **D-03:** El método NO se añade a `HOST_METHODS` (que sigue congelado en 4: `listWorkspaces`/`selectWorkspace`/`isAlive`/`needsInput`) ni a `validateHost`. Se detecta por `typeof host.listAgentSurfaces === 'function'` en el call site — espejo 1:1 de cómo `getTaskState` (Phase 40) y `createTask` (Phase 52) se añadieron FUERA de `TASK_PROVIDER_METHODS`. `NullHost` puede stubear el método retornando `[]` para alimentar la contract matrix sin cmux real (mismo patrón que sus otros 4 stubs neutros). Un host que no lo implemente → el consumer degrada fail-open (no descubre nada), nunca rompe.

### Fixture + contract-lock (DETECT-01 (a), success criterion 3)
- **D-04:** Nueva fixture **`test/fixtures/cmux/surface-resume-show.json`** con la salida cruda real de `cmux surface resume show --json` en 0.64.15 (espejo de las fixtures existentes `list-workspaces.json`/`notification-list.json`). Aserción vía el **`run` DI** existente de `createCmuxHost` (`fakeExecFromFixtures` ya enruta por argv en `test/host/contract.test.js`): un test nuevo sirve esta fixture cuando el argv incluye `surface resume show` y asierta el array normalizado campo a campo. La fixture incluye al menos: 1 surface adoptable (`kind:"claude"`, `source:"agent-hook"`, `cleared:false`) + 1+ casos de fallo (cleared / sin resume_binding / source≠agent-hook) para cubrir D-05 en el mismo test. El walker `test/host/cmux-isolation.test.js` ya garantiza que solo `src/host/cmux.js` habla con cmux — no requiere cambios salvo confirmar cobertura.

### Modos fail-open y dónde vive el filtrado (DETECT-01 (b)(c), success criteria 4-5)
- **D-05:** El método es **never-throws** y degrada fila-a-fila:
  - Socket cmux caído / exec error / JSON corrupto → captura, `logger?.warn?.('host.list_agent_surfaces.fail', …)`, retorna `[]` (mismo molde que `listWorkspaces`).
  - Por surface: `cleared:true`, `resume_binding` ausente, o `source != 'agent-hook'` → **se omite del array** (no es una sesión-agente válida).
  - El array devuelto contiene las surfaces-agente válidas con su `kind` tal cual (no se filtra por `kind=="claude"` aquí — el consumer decide qué `kind` adopta).
- **D-06:** El **set-difference contra `state.json`** (sesiones adoptables = no presentes ya) vive en el **CONSUMIDOR (Phase 56)**, NO en este método. Y se keyea por **`sessionId`/`cwd` estable, NUNCA por `workspaceRef`** (defensa Phase 43: cmux recicla `workspace:N`). Este método solo descubre; la dedup es responsabilidad del consumer. La **regla transversal LOCKED** se preserva: `adopt.js`/`reconcile.js` permanecen host-agnósticos.

### Claude's Discretion
- **Nombre final del método** (`listAgentSurfaces` vs `describeSurfaces` plural): D-01 fija la *semántica* (enumeración → array); la ortografía exacta la fija el planner para encajar con la convención de `src/host/`.
- **Estructura interna del parseo** (helper puro `normalizeSurface(raw)` separado vs inline en el método) — el planner elige; recomendado un helper puro testeable espejo de cómo `listWorkspaces` mapea `WorkspaceInfo`.
- **Si `NullHost` stubea el método** o se deja ausente para probar la rama "host no lo soporta" en la contract matrix — el planner decide según convenga al test de degradación.
- **Eventos NDJSON exactos** (`host.list_agent_surfaces.ok/fail`) — nombres siguiendo la taxonomía existente de `host.list_workspaces.*`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research que prueba la viabilidad (LEER PRIMERO)
- `.planning/research/CMUX-CAPABILITIES.md` §P0 — **la fuente de verdad de esta fase**: salida cruda real de `cmux surface resume show --json` en 0.64.15, mapeo `checkpoint_id → session_id`, modos de fallo, recomendación de reconvertir el spike en contrato. Incluye la fuente cruda alternativa `~/.cmuxterm/claude-hook-sessions.json`.

### Requirements & roadmap (este milestone)
- `.planning/REQUIREMENTS.md` — **DETECT-01** (contrato HostProvider, campos consumidos, 3 sub-requisitos (a) fixture-lock (b) fail-open (c) set-difference keyed por sessionId/cwd). Fuente de verdad del scope.
- `.planning/ROADMAP.md` §"Phase 55" — goal + 5 success criteria + la nota 2026-06-16 que reconvirtió el spike en contrato. §"Progress" — regla transversal LOCKED.

### Contrato y código a extender (espejo de implementación)
- `src/host/interface.js` — el contrato `WorkspaceHost` (Phase 38): `HOST_METHODS` congelado en 4, `validateHost`, `getHost` factory, `createNullHost`. El método nuevo se añade **fuera** de `HOST_METHODS`.
- `src/host/cmux.js` — `createCmuxHost`: el `run` DI (`makeRun`/`execFileSync`), el molde de `listWorkspaces` (parseo never-throws + `logger?.warn`), la caché `lastSnapshot`, el bloque `_legacy`. El método nuevo se implementa aquí siguiendo este molde.
- `src/adopt.js` — la firma de `adoptSession` (líneas ~135-175): los campos `{ workspaceRef, cwd, sessionId }` que este método debe producir para encajar sin transformación (D-02).

### Patrón typeof-detected opcional (el precedente a replicar)
- `src/providers/plane/provider.js:237,267` y `src/providers/github/provider.js:169,184` — cómo `getTaskState`/`createTask` se documentan como opcionales detectados por `typeof` en el call site, FUERA del contrato congelado.
- `src/server/provider-state.js:78` — el call site real que hace `typeof provider.getTaskState !== 'function'` → degrada. Molde del call site que el consumer (Phase 56) replicará.

### Tests a extender
- `test/host/contract.test.js` — la contract matrix `IMPLS = ['cmux','null']` + `fakeExecFromFixtures` (enruta por argv). El nuevo test sirve la fixture `surface resume show` por aquí.
- `test/host/cmux-isolation.test.js` — el walker SC#5 que confina cmux a `src/host/cmux.js`. Verificar que sigue verde.
- `test/fixtures/cmux/list-workspaces.json` + `notification-list.json` — el molde de fixture a replicar para `surface-resume-show.json`.

No hay specs/ADRs externos — kodo no usa un sistema de ADR separado; las decisiones canónicas viven en PROJECT.md, CMUX-CAPABILITIES.md y los CONTEXT.md de fase.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/host/cmux.js` (`createCmuxHost`, `makeRun`) — el `run` DI ya existe y es exactamente el seam para inyectar la fixture en test; el método nuevo lo reusa sin tocar la infraestructura de exec.
- `listWorkspaces` (mismo archivo) — molde directo: `try { await run([...]) } catch { logger?.warn; return [] }` + `JSON.parse` con segundo try/catch `PARSE_ERROR` + `.map()` normalizador. Copiar la forma, cambiar el comando y el shape de salida.
- `test/host/contract.test.js` (`fakeExecFromFixtures`, `loudExec`) — el fake exec que enruta por argv (`includes('list-workspaces')`, `includes('notification.list')`) — añadir una rama `includes('surface resume show')`.
- `NullHost` (`createNullHost` en interface.js) — para el caso "host sin soporte" (retorna `[]` o se omite el método).

### Established Patterns
- **Opcional typeof-detected fuera del contrato congelado**: `getTaskState`/`createTask` (no en `TASK_PROVIDER_METHODS`); `listAgentSurfaces` no va en `HOST_METHODS`. El call site hace `typeof host.X === 'function'`.
- **never-throws + logger inyectado**: `src/host/` NO importa `src/logger.js` (LOG-12 walker); el logger entra por `opts.logger`, todas las ramas de fallo loguean `warn` y retornan neutro.
- **Fixture-lock vía `run` DI**: la salida cruda real de cmux se congela como JSON y se asierta campo a campo — un cambio de contrato de cmux rompe el test ruidosamente (DETECT-01 (a)).
- **Identidad estable ≠ workspaceRef**: el set-difference downstream se keyea por `sessionId`/`cwd` (cmux recicla `workspace:N` — defensa Phase 43).

### Integration Points
- `src/host/cmux.js` — el método nuevo se añade al objeto retornado por `createCmuxHost` (junto a los 4 del contrato + `_legacy`).
- `src/host/interface.js` — posible `@typedef AgentSurface` documentando el shape `{ workspaceRef, cwd, sessionId, kind }` (paralelo a `WorkspaceInfo`); `HOST_METHODS` NO cambia.
- `test/host/` — fixture nueva + test nuevo (o extensión de `contract.test.js`).
- **Consumidores futuros** (NO en esta fase): Phase 56 (dashboard) hará `typeof host.listAgentSurfaces === 'function'` y el set-difference contra `state.json`.
</code_context>

<specifics>
## Specific Ideas

- **Pregunta abierta para el researcher/planner (verificar contra cmux 0.64.15 real):** `cmux surface resume show --json` en la fixture de `CMUX-CAPABILITIES.md` muestra **un solo surface** (el del caller). Para que `listAgentSurfaces()` *enumere todas* las surfaces hay que confirmar el comando correcto de enumeración: ¿`cmux surface resume show --json` sin `--surface` lista todas? ¿`cmux surface resume list`? ¿O se itera sobre `~/.cmuxterm/claude-hook-sessions.json` (mapa `surfaceUUID → {sessionId}`)? **Esto gobierna la implementación del comando** y debe resolverse empíricamente antes de fijar la fixture. La fuente cruda `~/.cmuxterm/claude-hook-sessions.json` (citada en CMUX-CAPABILITIES.md) es el fallback de enumeración si el comando no la ofrece directa.
- La fixture debe capturarse de la **versión instalada real** (0.64.15) — no inventar el JSON. Si el researcher corre `cmux surface resume show --json` en una sesión claude viva, ese output crudo es el contrato a congelar.
- `sessionId` DEBE ser `resume_binding.checkpoint_id` literal (== `session_id` de Claude Code, verificado en P0) — es la clave estable que `state.json` usa para la dedup. No usar `surface_ref` ni `workspace_ref` como identidad.
</specifics>

<deferred>
## Deferred Ideas

- **Set-difference + tecla `a`** "sesiones adoptables descubiertas" → **Phase 56** (DETECT-02): este método solo descubre y devuelve; el consumer hace el diff contra `state.json` y la UX.
- **Auto-derivar los flags de `kodo adopt`** (`--cwd`/`--session-id`/`--workspace`) desde este seam → **Phase 54** (futuro refinamiento) / **Phase 57** (orquestador).
- **P1 — reconcile event-driven** (`cmux events` + `top --processes`) → futuro milestone v0.14 (`CMUX-CAPABILITIES.md` §P1); fast-path con el reconcile actual como red de seguridad.
- **P2 — sidebar nativo** (`set-progress`/`set-status` empujando el progreso `N/M` ya calculado) → mejora oportunista de v0.12 vía `CmuxHost`, fuera de v0.13.
- **P3 — `notify` rico + `send-key`** → oportunista, fuera de scope.

</deferred>

---

*Phase: 55-contrato-hostprovider-describesurface-cmux*
*Context gathered: 2026-06-16*
</content>
</invoke>
