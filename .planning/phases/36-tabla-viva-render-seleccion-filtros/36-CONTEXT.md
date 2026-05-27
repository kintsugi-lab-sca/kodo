# Phase 36: Tabla viva — render + selección + filtros - Context

**Gathered:** 2026-05-27
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-seleccionadas = opción recomendada de cada gray area; revisar antes de planificar)

<domain>
## Phase Boundary

La **capa de presentación central** del dashboard: convierte el stream de datos de Phase 35
(`fetchStatus` + `usePoll`, ya fluyendo en `App.js`) en una **tabla viva navegable**. Reemplaza
la status line mínima (`● live` + `N sessions`, D-01 de Phase 35) por una tabla columnar
`task_ref · repo · phase/mode · status · age`, con selección por identidad, orden estable,
color semántico, header de contadores y filtros.

Cubre **TUI-07** (tabla columnar), **TUI-08** (selección rastreada por `task_id`, sobrevive al
refresh/reordenamiento), **TUI-09** (orden estable por `started_at`), **TUI-10** (color por
`status`+`alive`, incl. zombie `running`+`!alive`), **TUI-11** (header live + contadores por
estado; vacío → "no active sessions"), **TUI-12** (filtros `/` substring + prefijos `r:<repo>` /
`s:<state>`, cursor preservado).

**Fuera de esta fase (fases posteriores):** attach a cmux con `Enter` (Phase 37, FASE DE MAYOR
RIESGO), overlays de comentarios `c` y logs `l` (Phase 38). Esta fase **no** abre overlays, no
hace handoff TTY, y **no añade endpoints** (constraint dura del milestone — solo consume el
`/status` existente).

</domain>

<decisions>
## Implementation Decisions

### Render de la tabla columnar (TUI-07, TUI-09)
- **D-01:** Render con **ink puro** (`<Box flexDirection="column">` para la lista; cada fila un
  `<Box flexDirection="row">` con un `<Text>` por celda). **NO** reusar `formatTable`/`formatRow`
  de `src/cli/format.js` — ese helper es del CLI clásico (usa `picocolors`, strip-aware) y la
  invariante de color-isolation (D-12 Phase 34) prohíbe `picocolors` bajo `src/cli/dashboard/**`.
- **D-02:** **Anchos de columna fijos** (estáticos) con `padEnd` + **truncado con ellipsis `…`**
  para valores largos (`task_ref`, `repo` derivado, `summary`). NO layout responsive al ancho de
  terminal en esta fase (YAGNI — el research/planner puede ajustar si el ancho fijo desborda en
  terminales estrechas). Markup vía `React.createElement` plano (sin JSX, sin build step — patrón
  de Phase 34/35).
- **D-03 (GROUNDING CRÍTICO — el mapeo de columnas NO es 1:1 con `SessionRecord`):**
  - `task_ref` → **directo** (`session.task_ref`, p. ej. `"KL-42"`, `"#42"`).
  - `repo` → **DERIVADO** — **no existe campo `repo`** en SessionRecord. Usar
    `session.project_name ?? basename(session.project_path)`.
  - `phase/mode` → **`phase_id` + `gsd_mode`** (ambos opcionales, presentes SOLO en sesiones GSD).
    No-GSD → placeholder `—`. `gsd_mode ∈ {'full','quick'}`; `phase_id` p. ej. `"36"`.
  - `status` → **directo**, 4 valores: `'running' | 'done' | 'error' | 'review'`.
  - `age` → **humanizado** desde `elapsed_min` (el server ya lo computa en `/status`:
    `Math.floor((now - started_at)/60000)`) a formato compacto `Nm` / `Hh Mm` (p. ej. `5m`, `1h3m`).
    Preferir `elapsed_min` sobre recomputar desde `started_at` (single source server-side).
- **D-04:** **Orden estable por `started_at`** (TUI-09): sort determinista ascendente (o desc — el
  planner elige, pero **fijo**) con `started_at` como clave primaria y `task_id` como **desempate**
  para que dos sesiones con igual `started_at` nunca intercambien posición entre polls. El sort se
  aplica a una **copia** del array (no mutar el resultado de `usePoll`).

### Selección por identidad (TUI-08)
- **D-05:** El estado de cursor es **`selectedTaskId` (string | null)**, NO un índice numérico.
  El índice visible se **deriva** buscando `selectedTaskId` en la lista ya ordenada+filtrada en
  cada render. Esto es lo que hace que la selección "siga" a la sesión correcta aunque el orden
  cambie o aparezcan/desaparezcan filas (invariante load-bearing de TUI-08).
- **D-06:** **Cuando la fila seleccionada desaparece** en un refresh: fallback al row en el **mismo
  índice posicional previo, clampado** a `[0, len-1]` (vecino más cercano por posición), y se
  actualiza `selectedTaskId` al `task_id` de ese row. Lista resultante vacía → `selectedTaskId = null`.
  Nunca dejar el cursor apuntando a un id ausente.
- **D-07:** **Selección inicial** = primera fila (tras el orden de D-04) cuando hay ≥1 sesión;
  `null` cuando la lista está vacía. ↑/↓ mueven el índice derivado y re-fijan `selectedTaskId` al
  row resultante; **clamp en los extremos, sin wrap-around** (consistencia con una lista que cambia
  de tamaño).

### Color semántico (TUI-10)
- **D-08:** Paleta `status` + `alive` → color, **solo vía `<Text color>` de ink** (color-isolation):
  - `running` + `alive`            → **green**
  - `running` + `!alive` (ZOMBIE)  → **red** — el caso peligroso y explícito de TUI-10.
  - `review`                       → **cyan**
  - `done`                         → **dim/gray** (`dimColor`)
  - `error`                        → **magenta** (distinto del red del zombie, para no confundir
    "tarea con error" con "proceso muerto pero marcado running").
- **D-09:** **No depender solo del color** (accesibilidad / NO_COLOR): el zombie lleva además una
  **marca textual** (p. ej. sufijo `(zombie)` o un glifo distintivo en la celda `status`), de modo
  que `running`+`!alive` sea distinguible aun sin color.
- **D-10:** El **indicador "live" del header** (TUI-11) **reusa el connection state ya existente**
  en `App.js` de Phase 35 (`● live` verde cuando el último poll fue ok / `⚠ server caído` amarillo
  en degradación) — no se reinventa; se mueve/integra al header de la tabla.

### Header de contadores + estados vacíos (TUI-11)
- **D-11:** El header muestra el indicador live (D-10) **+ contadores por `status`** derivados de
  la lista actual, formato compacto tipo `3 running · 1 review` (omitir estados con count 0). El
  **zombie** (`running`+`!alive`) se cuenta aparte cuando hay ≥1 (p. ej. `2 running · 1 zombie`)
  para que el operador lo vea en el resumen, no solo en la fila.
- **D-12:** **Dos estados vacíos distintos:** (a) **lista realmente vacía** (poll ok, 0 sesiones)
  → `no active sessions`; (b) **filtro sin coincidencias** (hay sesiones pero ninguna matchea) →
  `no sessions match` — para no confundir "no hay nada" con "tu filtro las ocultó". El estado
  `waiting for server` / `server caído` de Phase 35 (keep-last-good) se conserva por encima de todo.

### Filtros (TUI-12)
- **D-13:** `/` abre un **modo filtro modal**: una línea de input al pie de la tabla. Filtrado
  **en vivo** (re-filtra a cada pulsación, no al pulsar Enter) — feedback inmediato.
- **D-14:** **Prefijos dentro de la misma query:** `r:<texto>` filtra por la columna `repo`
  derivada (D-03); `s:<estado>` por `status` (`running`/`done`/`error`/`review`). Query **sin
  prefijo** → substring global sobre celdas visibles (`task_ref` / `repo` / `phase/mode` /
  `summary`). Case-insensitive. (El planner decide si `r:` y `s:` combinan en una sola query o son
  mutuamente excluyentes — recomendado: combinables vía AND.)
- **D-15 (resuelve el conflicto con D-11 de Phase 34 — `Esc` reservado):** mientras el **input de
  filtro está activo**, `Esc` **cancela el filtro y sale del modo filtro** (scope MODAL). Esto
  **NO contradice** la D-11 de Phase 34 (que reserva `Esc` para los overlays de Phase 38): esa
  reserva aplica al **modo lista**; el input de filtro es un **contexto modal distinto** y los
  overlays `c`/`l` aún no existen. `Enter` confirma (mantiene el filtro aplicado y devuelve la
  navegación ↑/↓ a la lista). Backspace en query vacía también sale del modo. **Phase 38 debe
  honrar este límite:** `Esc` solo abre/cierra overlays cuando NO hay input de filtro con foco.
- **D-16:** **Preservación del cursor al filtrar/limpiar (TUI-12):** dado que el cursor se rastrea
  por `selectedTaskId` (D-05), al aplicar o limpiar el filtro el cursor **sigue a la misma sesión**
  si permanece visible; si el filtro la oculta, fallback clampado dentro de la **lista filtrada**
  (misma mecánica que D-06). Al limpiar el filtro, si la sesión seleccionada reaparece, el cursor
  vuelve a ella.

### Claude's Discretion
- Estructura de componentes: ¿un único `App.js` que crece, o extraer `SessionTable.js` /
  `useSelection.js` / `useFilter.js` / helpers de formato (`formatAge`, `deriveRepo`,
  `statusColor`)? Recomendado extraer helpers puros (testables sin ink, patrón DI del proyecto),
  pero el planner decide la granularidad.
- Dónde vive el estado de selección/filtro (hooks dedicados vs `useState` en `App`), respetando
  D-05/D-13/D-16.
- Si `r:` y `s:` combinan (AND) o son exclusivos (D-14) — recomendado AND.
- Dirección del sort por `started_at` (asc/desc) mientras sea **fija y estable** (D-04).
- Anchos exactos de columna y umbral de truncado (D-02).
- Si los contadores del header incluyen `done`/`error` o solo los "activos" (D-11).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + roadmap
- `.planning/ROADMAP.md` §"Phase 36: Tabla viva — render + selección + filtros" — Goal, los 5
  Success Criteria (tabla / selección por `task_id` / orden estable + color zombie / header
  contadores + vacío / filtros con cursor preservado), `UI hint: yes`.
- `.planning/REQUIREMENTS.md` — TUI-07, TUI-08, TUI-09, TUI-10, TUI-11, TUI-12 (cluster C —
  Tabla/selección, Phase 36); Out of Scope del milestone.

### Milestone research (patrones, pitfalls — verificados contra el codebase)
- `.planning/research/ARCHITECTURE.md` — patrones de render/estado de la TUI, Data Flow
  "Poll → render", Build Order, Testability Map (helpers puros + DI).
- `.planning/research/PITFALLS.md` — pitfalls de presentación: selección por identidad vs índice,
  re-render/reordenamiento, color por estado, filtrado. (El planner debe mapear qué pitfalls son
  "P-render" de esta fase.)
- `.planning/research/STACK.md` — `ink@6.x` + `react@19`, `useInput`, sin build step.
- *(El planner correrá `gsd-phase-researcher` para research phase-specific de Phase 36; lo anterior
  es el research a nivel milestone ya existente.)*

### Codebase (verificado en scout — READ ONLY, cero endpoints nuevos)
- `src/server.js:361-413` — handler `GET /status`: **shape exacto del payload** que consume la
  tabla. `sessions` = `listSessions()` **enriquecido** con `alive: boolean` (`workspaceList.includes(s.workspace_ref)`)
  y `elapsed_min: number` (ya computado). También `count`, `pending`, `history`, `metrics`, `uptime`.
- `src/session/state.js:11-30` — **typedef `Session` (SessionRecord)**: campos disponibles para las
  columnas — `task_ref`, `status` ('running'|'done'|'error'|'review'), `started_at`, `task_id`,
  `workspace_ref`, `project_name?`, `project_path`, `phase_id?`, `gsd_mode?` ('full'|'quick'),
  `summary`, `provider`. **CRÍTICO:** no hay campo `repo` (derivar de `project_name`/`project_path`)
  ni `phase`/`mode` literales (usar `phase_id`+`gsd_mode`) — ver D-03.
- `src/cli/dashboard/App.js` — **componente a extender**: ya cablea `usePoll(fetchStatus,…)` y
  mantiene `lastGoodCount`/`lastGoodAt`/`connected`/`lastAttemptAt`. La tabla sustituye la status
  line del cuerpo (D-01 Phase 35) y reusa el connection state para el indicador live (D-10). Ya
  tiene `useInput` gateado por `isRawModeSupported` y la salida `q` (D-08/D-11 Phase 34).
- `src/cli/dashboard/client.js` — `fetchStatus` never-throws `{ok,data}`; `data` es el payload
  `/status`. La tabla lee `data.sessions` / `data.count`.
- `src/cli/dashboard/usePoll.js` — hook self-scheduling; el `onResult` entrega `{ok, data}` por tick.
- `src/cli/format.js` — `formatTable`/`formatRow` del CLI clásico: **NO usar en el dashboard**
  (picocolors → rompe color-isolation). Referencia de qué NO importar (D-01).
- `test/format-isolation.test.js` — walker de color-isolation extendido a `src/cli/dashboard/**`;
  los nuevos archivos de tabla/selección/filtro **no deben importar `picocolors`**.
- `.planning/phases/34-fundacion-subcomando-ciclo-de-vida/34-CONTEXT.md` — D-11 (`Esc` reservado —
  ver resolución modal en D-15), D-12 (color-isolation), `useInput`/raw-mode guard.
- `.planning/phases/35-datos-cliente-http-polling/35-CONTEXT.md` — D-01 (status line viva a
  reemplazar), keep-last-good (D-06), edad por poll (D-08), connection state reusable.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `App.js` (Phase 35): `usePoll` ya cableado, `data.sessions`/`data.count` disponibles por tick,
  connection state (`connected`/`lastGoodAt`) reusable para el indicador "live" del header (D-10).
  `useInput` + raw-mode guard + salida `q` ya presentes.
- `data.sessions[*].alive` y `.elapsed_min` — **ya provistos por el server** (no recomputar en cliente).
- Patrón **helpers puros + DI** del proyecto (el runner de Node carece de `mock.module`): extraer
  `formatAge(elapsedMin)`, `deriveRepo(session)`, `statusColor(status, alive)`, `sortSessions(list)`,
  `applyFilter(list, query)`, `resolveSelection(list, selectedTaskId, prevIndex)` como funciones
  puras testables sin ink.

### Established Patterns
- **Color-isolation** (D-12 Phase 34): color SOLO de `<Text color>` de ink; cero `picocolors` bajo
  `src/cli/dashboard/**`. Verificado por `test/format-isolation.test.js`.
- **`React.createElement` plano** (sin JSX, sin build step) — patrón de Phase 34/35.
- **Selección por identidad, no índice** (decisión de proyecto ya anotada en memoria: "selection
  model requires task_id identity") → D-05.
- **Tests herméticos**: render con ink-testing-library `lastFrame()` + fixtures de `/status`
  inyectadas vía `fetchFn` prop; helpers puros testeados aislados.

### Integration Points
- `src/cli/dashboard/App.js` (MODIFICADO) — sustituye status line por la tabla; integra header,
  selección, filtro.
- Nuevos módulos probables (granularidad a decisión del planner): `SessionTable` (render),
  helpers puros de formato/orden/selección/filtro, posibles hooks `useSelection`/`useFilter`.
- `src/server.js` — **NO se modifica** (constraint dura del milestone: cero endpoints nuevos).
- `test/format-isolation.test.js` — cubre automáticamente los archivos nuevos (color-isolation).

</code_context>

<specifics>
## Specific Ideas

- Caso load-bearing de TUI-08: con la fila seleccionada por `task_id`, un refresh que **reordena**
  la lista o **elimina** la fila seleccionada NO debe dejar el cursor en la sesión equivocada
  (test: seleccionar B, refresh donde B sube/baja → cursor sigue en B; refresh donde B desaparece →
  cursor cae al vecino clampado, nunca a un id ausente).
- Caso load-bearing de TUI-10: una sesión `status:'running'` con `alive:false` (zombie) se ve
  **distinta** de una `running`+`alive` (color red vs green) **y** lleva marca textual (D-09).
- Caso load-bearing de TUI-12: aplicar `s:running` y luego limpiar el filtro **preserva** la
  sesión seleccionada (cursor sobre el mismo `task_id` antes/después).
- Header tipo `kodo dashboard   ● live    3 running · 1 review` (indicador reusado de Phase 35).

</specifics>

<deferred>
## Deferred Ideas

- **Attach con `Enter`** → `cmux attach <workspace_ref>` (handoff TTY) — **Phase 37** (TUI-13/14),
  la fase de mayor riesgo con UAT manual obligatorio. Esta fase deja `workspace_ref` disponible en
  la fila seleccionada pero NO hace el handoff.
- **Overlays `c` (comentarios por `task_id`) y `l` (logs grep best-effort)** — **Phase 38**
  (TUI-15/16). `Esc` cerrará overlays en modo lista (honrando el límite modal de D-15).
- **Layout responsive al ancho de terminal** (recompute de anchos de columna) — descartado por
  YAGNI en esta fase (D-02); reconsiderar si el ancho fijo desborda en terminales estrechas.
- **Ordenar por columnas distintas a `started_at`** (p. ej. por `status` o `age`) — fuera de scope;
  el orden estable por `started_at` es el requisito (TUI-09).

</deferred>

---

*Phase: 36-tabla-viva-render-seleccion-filtros*
*Context gathered: 2026-05-27*
