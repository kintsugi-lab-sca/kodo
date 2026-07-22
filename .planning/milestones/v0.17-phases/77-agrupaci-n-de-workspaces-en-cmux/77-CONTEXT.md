# Phase 77: Agrupación de workspaces en cmux - Context

**Gathered:** 2026-07-16
**Mode:** `--auto` (pase único; todas las áreas auto-seleccionadas con la opción recomendada)
**Status:** Ready for planning

<domain>
## Phase Boundary

Al lanzar una sesión de tarea, el workspace de cmux aterriza dentro del grupo de la sidebar que corresponde a su **path resuelto** (varias issues del mismo módulo de ROMAN, juntas y colapsables). kodo **consume** grupos que el operador crea a mano una vez — nunca los crea, renombra ni borra (GRP-04). Sin grupo coincidente, o con cualquier fallo en la resolución, la sesión se lanza **exactamente como hoy**: el grupo es cosmético, la sesión es la carga útil (GRP-03).

Superficie tocada: `src/cmux/client.js` (+1 passthrough), `src/host/cmux.js` (`_legacy` +1), `src/session/manager.js` (derivación + resolución + flag). NO toca hooks, `state.json`, `src/server.js` ni el reconcile loop.

**Pre-decidido al crear la fase (ROADMAP/REQUIREMENTS, no re-discutir):** clave de agrupación = path resuelto (GRP-02) · resolución nombre→ref en fresco por lanzamiento (GRP-03) · fail-open total (GRP-03) · kodo no gestiona grupos ni persiste refs `workspace_group:N` (GRP-04) · `--group` en el `new-workspace` existente (GRP-01) · `HOST_METHODS` congelado en 4 · cero deps npm nuevas · cero endpoints nuevos.

</domain>

<decisions>
## Implementation Decisions

### Contrato de nombre de grupo (matching operador ↔ kodo)

- **D-01: Derivación determinística del nombre esperado.** Path resuelto == `default` del proyecto (o entrada flat string) → nombre esperado = **identifier humano del proyecto** (p. ej. `ROMAN`, `KODO`). Módulo con path propio distinto del default → nombre esperado = **`IDENTIFIER/Módulo`** (p. ej. `ROMAN/FVF`), usando el nombre de módulo tal cual aparece en `projects.json`.
- **D-02: El compuesto es obligatorio, no estético.** El nombre pelado de módulo es ambiguo: `DEV` existe como módulo en dos proyectos distintos del `projects.json` real (LIKEN y personalreply). Nunca matchear por módulo a secas.
- **D-03: Match case-insensitive + trim** contra el campo `name` de `workspace-group list --json`. Los grupos reales del operador (`Kodo`, `SCRIBBA`) deben matchear con los identifiers `KODO`/`SCRIBBA` sin renombrarlos. Empate múltiple (dos grupos con el mismo nombre normalizado) → tomar el primero de la lista; determinista y documentado.
- **D-04: Descartado** el match por `current_directory` del anchor (es el cwd VIVO del terminal — deriva cuando el operador hace `cd`) y **descartado** un campo `cmux_group` en `projects.json` (superficie de config nueva sin necesidad demostrada).

### Ubicación arquitectónica de la resolución

- **D-05: `client.js` gana UN passthrough fino** `listWorkspaceGroups()` → `run(['workspace-group', 'list', '--json'])`, mismo patrón una-función-por-comando del fichero. El parseo del JSON NO vive en client.js.
- **D-06: `host._legacy` expone `listWorkspaceGroups`** igual que expone `newWorkspace` (`src/host/cmux.js:359` — lazy import passthrough). El contrato `HOST_METHODS` (4 métodos) NO se toca; el walker `test/host/cmux-isolation.test.js` debe seguir verde.
- **D-07: La resolución es una función PURA** — `(groupsJson, expectedName) → ref | null` — defensiva ante shapes inesperados (precedente `normalizeSurface`/`buildTitleMap` en `host/cmux.js`: claves ausentes → null, never-throws). Testeable con fixtures JSON, sin cmux.
- **D-08: La derivación del nombre esperado es otra función pura** al lado de `deriveModuleName` (`manager.js:107`) — recibe task/projects-entry/path resuelto, devuelve el nombre esperado. Misma casa, mismo estilo.

### Mecánica fail-open (GRP-03 fija el resultado; esto fija el mecanismo)

- **D-09: Capa 1 — resolución.** `listWorkspaceGroups` falla (cmux viejo sin subcomando, daemon headless, socket roto) o no hay match → se lanza **sin** `--group`. Sin version-check de cmux: el soporte se deriva del éxito/fallo de la propia llamada.
- **D-10: Capa 2 — TOCTOU en el launch.** Si `newWorkspace` CON `--group` falla, **reintentar una vez SIN `--group`**. Verificado en vivo: un ref inválido es fatal (`exit=1`, el workspace no se crea) — un grupo borrado entre la resolución y el launch mataría la sesión sin esta capa. El reintento es solo para el fallo con `--group` presente; un fallo del reintento propaga como hoy.
- **D-11: Observabilidad de la degradación.** Un `console.log` de una línea (`[kodo] group_skipped — <motivo corto>`), precedente exacto `worktree_skipped_nongit` (`manager.js:312`). Sin contenido de usuario en el log, solo identifier/motivo. NO se añade logger a `client.js` más allá del param opcional que ya tiene.
- **D-12: La resolución añade como mucho UNA llamada cmux extra por lanzamiento** (~50ms, presupuesto RESEARCH §S5 de v0.9). Cero llamadas nuevas en el reconcile loop.

### Alcance: qué lanzamientos se agrupan

- **D-13: SOLO sesiones de tareas** — el `newWorkspace` de `launchWorkItem` (`src/session/manager.js:280`). El workspace del orquestador (`src/orchestrator/launch.js:220`) queda SIN grupo (no es una sesión de tarea). Las sesiones adoptadas (workspaces preexistentes que kodo no crea) quedan fuera — moverlas exigiría `workspace-group add`, que es gestión de grupos (frontera GRP-04-adyacente).

### Claude's Discretion

- `--group-placement`: default (`top`) salvo que research encuentre motivo para `afterCurrent`.
- Normalización exacta de strings en el match (casefold Unicode vs `toLowerCase`; NFC/NFD para nombres tipo `Traça Web`).
- Si las dos funciones puras viven en `manager.js` o en un módulo pequeño propio.
- Estructura de tests: DI del `run`/exec como en los tests existentes de `client.js`, fixtures del JSON real de `workspace-group list` (shape capturado en ROADMAP §Phase 77).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Hechos verificados en vivo (NO re-derivar, NO re-probar contra la app del operador)
- `.planning/ROADMAP.md` §Phase 77 — bloque «Verificado en vivo (cmux 0.64.19, 2026-07-16)»: `--group` solo acepta refs (`invalid_params` con nombres), ref inválido FATAL exit=1 sin workspace creado, membresía solo visible en `workspace-group list --json` (`member_workspace_refs`), anchor siempre nuevo, grupos por ventana, `new-workspace` = alias legacy de `workspace create` (aviso en output; el regex `workspace:\d+` de `client.js:39` lo tolera).
- `.planning/REQUIREMENTS.md` §GRP — GRP-01..04 con trazabilidad.

### Código existente (seams y patrones)
- `src/cmux/client.js` — patrón thin-client una-función-por-comando; `run()` con logger inyectable; regex de extracción de ref en `newWorkspace` (`:32-41`).
- `src/session/manager.js:243-283` — seam del launch: `resolveProjectPath` (`:80`), `deriveModuleName` (`:107`), construcción de `workspaceName` (`:278`), llamada `host._legacy.newWorkspace` (`:280`).
- `src/host/cmux.js:359-361` — patrón `_legacy` passthrough con lazy import; `normalizeSurface`/`buildTitleMap` como precedente de parseo JSON defensivo never-throws.
- `src/host/interface.js` — `HOST_METHODS` congelado en 4; `_legacy` documentado; NullHost con `_legacy.rename` no-op como precedente de degradación para hosts no-cmux.
- `test/host/cmux-isolation.test.js` — walker que fuerza que solo `src/host/` + `src/cmux/` hablen con el binario cmux.
- `~/.kodo/projects.json` (shape real) — entradas flat string (`kodo`), `{default}` y `{default, modules}`; módulos con espacios/Unicode (`Traça Web`, `F0 · Cierre…`); colisión `DEV` entre proyectos.

### Documentación externa (con jerarquía de autoridad)
- `cmux workspace-group --help` y `cmux new-workspace --help` del binario instalado — **AUTORIDAD**. Los docs web/GitHub divergen del binario (p. ej. la semántica de cerrar el anchor, y `--group` en `new-workspace` no está documentado fuera del `--help`).
- https://cmux.com/es/docs/workspace-groups y https://github.com/manaflow-ai/cmux/blob/main/docs/workspace-groups.md — contexto secundario.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resolveProjectPath` / `deriveModuleName` (`manager.js`) — ya computan el path resuelto y el módulo en el launch; la derivación del nombre de grupo consume sus outputs, no los duplica.
- `run()` de `client.js` — ejecución cmux con timeout 15s y logger opcional; el passthrough nuevo lo reusa tal cual.
- Patrón de parseo defensivo de JSON cmux (`buildTitleMap`, `extractSurfaceRefs`, `normalizeSurface` en `host/cmux.js`) — shape inesperado → resultado vacío/null, jamás throw.

### Established Patterns
- cmux confinado a `src/host/` + `src/cmux/` (walker test). La resolución NO ejecuta cmux directamente desde `manager.js` — pasa por `host._legacy`.
- Fail-open con `console.log` de una línea en el launch path (`worktree_skipped_nongit`, `manager.js:312`).
- `HOST_METHODS` congelado — extensiones van por `_legacy` (Phase 59 precedente: `rename`).

### Integration Points
- `manager.js:280` — punto exacto donde `opts` de `newWorkspace` gana `group: ref | undefined`.
- `client.js:32` (`newWorkspace`) — `if (opts.group) args.push('--group', opts.group)`, calcado de `--cwd`/`--command`.

### Open question para el researcher (única — verificar empíricamente, NO asumir)
- **Ventana del daemon headless:** los grupos son por ventana y `workspace-group list` opera sobre «la ventana enfocada». ¿Qué devuelve bajo `brew services`/launchd sin sesión GUI? Precedente 66-06: el binario cmux imprime broken-pipe a stderr en headless — probable fallo limpio de la llamada → cubre la capa 1 de fail-open, pero hay que confirmarlo. Multi-ventana: si el grupo vive en otra ventana, el no-match degrada a sin-grupo (aceptado, documentar).
</code_context>

<specifics>
## Specific Ideas

- Los grupos reales del operador hoy: `Kodo` y `SCRIBBA` (creados a mano en la sidebar). El matching D-01/D-03 debe funcionar con ellos SIN renombrarlos — es el caso de aceptación natural.
- Motivación original del operador: «varias issues de un módulo de roman van al mismo grupo». ROMAN/FVF, ROMAN/WAG etc. son repos distintos → grupos distintos; las F0..F6 de SCP-CMRI comparten path → un solo grupo.

</specifics>

<deferred>
## Deferred Ideas

- **Agrupar el workspace del orquestador** (`orchestrator/launch.js:220`) — fuera de D-13; si duele, fase futura de una línea.
- **`workspace-group add` para sesiones adoptadas** — gestión de membresía de workspaces que kodo no creó; revisitar si la adopción lo pide.
- **Auto-crear el grupo si no existe** (`workspace-group create --from <workspace-recién-creado>`) — técnicamente seguro con `--from` explícito, pero es gestión de grupos (GRP-04). Candidata v0.18 si el operador se cansa de crear grupos a mano.
- **Color/icono de grupo por proyecto** (`workspace-group set-color/set-icon`) — cosmético sobre cosmético.

</deferred>

---

*Phase: 77-agrupaci-n-de-workspaces-en-cmux*
*Context gathered: 2026-07-16*
