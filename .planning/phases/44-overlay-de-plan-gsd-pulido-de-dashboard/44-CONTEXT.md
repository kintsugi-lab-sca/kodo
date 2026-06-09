# Phase 44: Overlay de plan GSD + pulido de dashboard - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-resueltas con la opción recomendada; revisar antes de ejecutar)

<domain>
## Phase Boundary

El operador puede ver el/los `PLAN.md` de la fase GSD de la tarea seleccionada **sin salir de la TUI**, mediante un overlay nuevo (tecla dedicada junto a `c`/`l`), y el dashboard se pule según el dogfooding de v0.10: la columna `phase/mode` se oculta cuando ninguna sesión activa es GSD, y el estado zombie se marca por-fila en la columna `state`.

**Cubre:** PLAN-01, PLAN-02 (overlay de plan GSD), TUI-18 (ocultar `phase/mode`), TUI-19 (zombie por-fila).

**NO cubre (otras fases / out of scope):**
- Captura de plan de sesiones **no-GSD/quick** vía hook → Phase 45 (spike) + Phase 46 (condicional).
- Parsear transcript JSONL crudo, `~/.claude/plans/`, `~/.claude/todos/` → out of scope (formato no documentado).
- Editar/escribir `PLAN.md` desde el dashboard → el overlay es **read-only**; la única superficie read-write de la TUI sigue siendo el dismiss de v0.10.
- Nuevos endpoints en `src/server.js` → el overlay lee el filesystem directamente (espejo de `focus.js` con cmux).

</domain>

<decisions>
## Implementation Decisions

### Tecla y modo del overlay (PLAN-01)
- **D-01:** La tecla del overlay de plan es **`p`** (mnemónico "plan"). Verificado libre en el `useInput` mode-gated de `App.js` (ocupadas: `q`, `/`, `c`, `l`, `d`, flechas, Enter, Esc). Espejo exacto del patrón de los overlays `c`/`l`.
- **D-02:** El overlay es el `mode:'overlay'` ya existente (cuarto modo junto a `list`/`filter`/`confirm`). Reusa el snapshot **congelado** (`setOverlaySnapshot`), el scroll por `scrollOffset` + `OVERLAY_VIEWPORT`, y el cierre con `Esc` que **preserva el cursor por `task_id`** (no se toca `selectedTaskId`, cursor gratis al volver — D-05/D-06 de Phase 39). El guard anti-stale `overlayReqRef` (CR-01 de Phase 39) se reusa: una apertura en vuelo que se supera/cierra durante el `await` no reabre un overlay obsoleto.

### Resolución tarea→fase y lectura de PLAN.md (PLAN-01, PLAN-02)
- **D-03:** Fuente de la fase: **`row.phase_id` ya persistido** en la fila del dashboard como fuente primaria (`GET /status` propaga `...s` del `SessionRecord`, así que `phase_id`, `project_path`, `worktree_path`, `task_id`, `task_ref` están disponibles en la fila — **sin `findSession`**). Si `phase_id` está ausente (sesión no resuelta), fallback a `resolvePhase({ projectPath: worktree_path ?? project_path, task })` reusando el resolver de v0.3 Phase 9. El overlay deriva todo de la **fila revalidada por `task_id`**, no de un re-fetch de estado.
- **D-04:** Ruta de lectura: el directorio de fase se localiza por **prefijo de número** bajo `.planning/phases/` (glob `<phase_id>-*/`) desde **`worktree_path ?? project_path`** (fallback transparente, espejo de cómo `kodo gsd verify` lee `VERIFICATION.md`). Los ficheros de plan se recogen por patrón **`*-PLAN.md`** dentro de ese directorio.
- **D-05:** **never-throws / best-effort:** TODA la lectura (resolución de directorio, glob, `readFile`) está envuelta de modo que ningún error de filesystem llega a React. Cualquier fallo colapsa a un `status` discreto (ver D-07), nunca a un throw. Espejo del contrato never-throws de `client.js`/overlays `c`/`l`. El handler del overlay **nunca hace `await` desnudo** que pueda rechazar sin capturar.

### Presentación de varios PLAN.md (PLAN-02)
- **D-06:** Cuando la fase tiene **varios** `PLAN.md` (p. ej. `44-01-PLAN.md`, `44-02-PLAN.md`), se muestran **concatenados** en el mismo snapshot plano `lines[]`, separados por una **cabecera por fichero** (p. ej. `── 44-01-PLAN.md ──`), ordenados ascendente por nombre de fichero. Reusa el viewport scrollable existente — **cero nueva sub-navegación / sub-modo**. (Decisión por simplicidad: la infra de overlay ya es un `lines[]` scrollable; una lista navegable exigiría estado de selección y un modo nuevo, sobreingeniería para el caso de uso.)

### Copy honesto de estados sin contenido (PLAN-02)
- **D-07:** Constantes `OVERLAY_PLAN_*` en `App.js`, espejo léxico de `OVERLAY_COMMENTS_*`, con copy **distinta por caso**:
  - Tarea no-GSD / sin fase resuelta → p. ej. `'not a GSD session / no phase resolved'`
  - Fase resuelta pero sin ningún `PLAN.md` → p. ej. `'phase has no PLAN.md yet'`
  - Error de lectura de fichero/FS → p. ej. `'error reading plan'`
  - (Varios `PLAN.md` no es un estado vacío: se concatenan, D-06.)
  El status discrimina estos casos igual que el overlay `c` discrimina `unsupported`/`empty`/`not-found`/`error`.

### TUI-18 — ocultar columna phase/mode
- **D-08:** Derivación **PURA React-free** en `select.js`/`format.js`: `anyGsd = rows.some(r => r.phase_id != null)` sobre el conjunto de **sesiones activas** (las filas de `/status`), **no** sensible al texto del filtro `/` (la columna es estructural, no debe parpadear al teclear). Si `anyGsd === false`, la columna `phase/mode` **no se renderiza** y su ancho se recupera/reasigna al resto de columnas; reaparece automáticamente al entrar una fila con `phase_id`. Espejo del resto del derive layer (sort/selección/filtros).

### TUI-19 — zombie por-fila en columna state
- **D-09:** En la **celda `state`**, cuando la fila es zombie (`running` + `alive === false`), se añade una **marca textual `(zombie)`** y color **rojo**, ambos provenientes de `statusColor(status, alive, state)` que **ya es v3-aware** y tiene el rojo del zombie LOCKED (Phase 36/39.1). **Cero color nuevo, cero picocolors** — el color sale solo de `<Text color>` de ink. El contador de zombies del header se **mantiene** (la marca por-fila es aditiva, no lo reemplaza).

### Invariantes confirmadas (no se discuten — se honran)
- **D-10:** **Cero endpoints nuevos.** El overlay lee el filesystem (glob + `readFile`), espejo de `focus.js` invocando cmux. No se toca `src/server.js`.
- **D-11:** **Read-only.** El overlay nunca escribe `PLAN.md`. La única superficie read-write de la TUI sigue siendo el dismiss de v0.10.
- **D-12:** **Color isolation.** `src/cli/dashboard/` no importa `picocolors` (incluido el zombie por-fila de TUI-19). Blindado por `test/format-isolation.test.js`.
- **D-13:** **Anti-ReDoS.** Cualquier matching/filtro nuevo usa `String.includes`, nunca `new RegExp`.

### Claude's Discretion
- Wording exacto de las constantes `OVERLAY_PLAN_*` (D-07) y formato de la cabecera separadora (D-06) — el planner/executor afina copy; el contrato es "distinta por caso" + "honesta".
- Helper(s) de lectura de plan: módulo puro testeable con DI (espejo de `grepLogs`/`fetchComments`) vs inline en el handler — decisión del planner, manteniendo el contrato never-throws (D-05).
- Mecánica exacta del recálculo de anchos al ocultar `phase/mode` (D-08) — depende del layout columnar actual de `SessionTable.js`/`format.js`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos y alcance de la fase
- `.planning/ROADMAP.md` §"Phase 44" — Goal + 4 Success Criteria + Notes (cero-endpoints, color isolation, never-throws, coordinación de ediciones compartidas).
- `.planning/REQUIREMENTS.md` §"Plan Visibility (PLAN)" + §"Dashboard Polish (TUI)" — PLAN-01, PLAN-02, TUI-18, TUI-19 + tabla "Out of Scope".

### Reuso del overlay y derive layer (código a imitar/extender)
- `src/cli/dashboard/App.js` — overlays `c`/`l` (líneas ~391-463): patrón de snapshot congelado, `overlayReqRef` anti-stale (CR-01), `Esc` preserva cursor, constantes `OVERLAY_COMMENTS_*`/`OVERLAY_LOGS_*`, `OVERLAY_VIEWPORT`, `mode:'overlay'`. **Espejo directo para el overlay de plan.**
- `src/cli/dashboard/select.js` — derive PURO React-free (sort, `resolveSelection` por identidad, `applyFilter`/`parseFilter` anti-ReDoS). **Aquí vive la derivación `anyGsd` de TUI-18.**
- `src/cli/dashboard/format.js` — `statusColor(status, alive, state)` v3-aware (zombie rojo LOCKED), `STATE_BADGES`, celdas de columna. **Aquí vive la marca zombie por-fila de TUI-19 y el layout columnar de TUI-18.**
- `src/cli/dashboard/SessionTable.js` — render columnar ink (anchos fijos, truncado). Layout afectado por TUI-18.
- `src/cli/dashboard/client.js` — contrato never-throws de la capa de datos (modelo para el helper de lectura de plan, D-05).
- `src/cli/dashboard/focus.js` — `runFocus` lee/invoca fuera de React sin endpoints (modelo de "leer el filesystem como focus.js", D-10).

### Resolución de fase
- `src/gsd/resolver.js` — `resolvePhase({ projectPath, task })` discriminated union (`phase`/`bootstrap`/`error` con `no-match`/`multi-match`/`roadmap-missing`). Debe tolerarse sin crashear el overlay (PLAN-02 never-throws, D-03).

### Estado y posición
- `.planning/STATE.md` §"Critical Invariants to Preserve" — invariantes cross-milestone que Phase 44 debe honrar (resumidas en D-10..D-13).
- `src/server.js` §`GET /status` (líneas ~420-440) — confirma que las filas propagan `...s` (incluye `phase_id`/`project_path`/`worktree_path`). **No se modifica** (D-10).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Overlay `mode:'overlay'` + snapshot congelado + scroll** (`App.js`): el overlay de plan es un cuarto consumidor del mismo modo; reusa `setOverlaySnapshot`/`scrollOffset`/`OVERLAY_VIEWPORT` y el cierre `Esc`.
- **`overlayReqRef` (CR-01 Phase 39)**: guard anti-stale ya probado; el overlay de plan lo reusa para sus lecturas async.
- **`statusColor` v3-aware** (`format.js`): ya devuelve rojo+semántica para zombie; TUI-19 lo consume en la celda `state` sin añadir color.
- **`resolvePhase`** (`resolver.js`): mapeo tarea→fase reutilizable como fallback de D-03.
- **Patrón never-throws** (`client.js`, `grepLogs`, `fetchComments`): plantilla para el helper de lectura de plan (DI, colapsa errores a discriminante).

### Established Patterns
- **Derive PURO React-free** en `select.js`/`format.js`: TUI-18 (`anyGsd`) sigue este patrón — función pura testeable, sin estado React.
- **Selección por identidad `task_id`**: el overlay se abre sobre la fila revalidada por `task_id`; cursor preservado por identidad.
- **Color solo de `<Text>` de ink**: cero picocolors en `src/cli/dashboard/` (blindado por test de isolation).

### Integration Points
- `App.js` `useInput` (rama `mode==='list'`): nuevo branch `input === 'p'` (espejo de `c`/`l`/`d`).
- `select.js`/`format.js`/`SessionTable.js`: edición compartida para TUI-18 (ocultar columna) y TUI-19 (celda `state`). **⚠ Coordinar:** overlay + TUI-18 + TUI-19 tocan los mismos 3 ficheros — planificar el orden de ediciones para evitar conflictos (nota explícita del ROADMAP).
- Nuevo helper puro de lectura de plan (probable `src/cli/dashboard/plan.js` o similar) — read-only filesystem, never-throws.

</code_context>

<specifics>
## Specific Ideas

- El overlay de plan debe **sentirse idéntico** a los overlays `c`/`l`: misma mecánica de apertura, scroll, congelado bajo el poll vivo, y `Esc`. No reinventar la UX — extender la existente.
- Copy "honesta": el usuario debe poder distinguir de un vistazo "esta tarea no es GSD" de "esta fase aún no tiene PLAN.md" de "hubo un error leyendo" — son tres mensajes distintos, no uno genérico.

</specifics>

<deferred>
## Deferred Ideas

- **Captura/visualización de plan de sesiones no-GSD/quick** → Phase 45 (spike PLAN-03) decide viabilidad; Phase 46 (PLAN-04, condicional/cuttable) implementa si VIABLE. El overlay de Phase 44 está diseñado para **reusarse** para esas sesiones si Phase 46 procede (mismo `mode:'overlay'`, mismo snapshot).
- **Mostrar todos/Tasks en vivo de una sesión** → v2 (PLAN-F1/PLAN-F2): sin fuente de datos soportada hoy.
- **Lista navegable multi-PLAN.md** (vs concatenado de D-06) → si en uso real el concatenado resulta incómodo con muchos planes, reconsiderar en un pulido futuro. No ahora (YAGNI).

None — la discusión se mantuvo dentro del scope de la fase.

</deferred>

---

*Phase: 44-overlay-de-plan-gsd-pulido-de-dashboard*
*Context gathered: 2026-06-09*
