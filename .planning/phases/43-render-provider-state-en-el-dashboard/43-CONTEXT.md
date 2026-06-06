# Phase 43: Render — provider_state en el dashboard - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Phase Boundary

El dashboard TUI (ink) **muestra y permite filtrar** `provider_state` — el estado real de la tarea en su sistema de gestión (Plane/GitHub) — de forma legible y honesta, **separado** del estado de proceso local (`statusColor` v3). Es una capa fina de **presentación + filtro** sobre los datos que Phase 40 ya enriquece en `GET /status` (`provider_state` + `provider_state_reason`). Cierra la cadena provider_state end-to-end del milestone v0.10 (driver ROMAN-150: sesión "In Review" en Plane invisible tras `/exit`).

**En scope (Phase 43):**
- Render de `provider_state` en una **columna nueva dedicada** en la tabla viva — PSTATE-05
- Distinción visual de los **tres reason-states** (ok / unsupported / fetch-failed) reusando `provider_state_reason` de Phase 40 — criterio 2
- Filtro del dashboard por `provider_state` con prefijo dedicado **`ps:`** vía `String.includes` anti-ReDoS — PSTATE-06
- Tratamiento del estado como **dato crudo** (sobrevive a renombrados sin cambios de código) — criterio 4

**Fuera de scope:**
- Cualquier cambio al contrato del provider, al enrichment server-side o al cache (eso fue Phase 40 — PSTATE-01..04, ya completas)
- Escribir `provider_state` a `state.json` o acoplarlo a `alive`/`elapsed_min`/lifecycle (prohibido por invariante)
- Leer review-state de PRs linkeados en GitHub (deferred de Phase 40)
- Filtrar por los reason-states degradados (unsupported/fetch-failed) — ver D-09 (descartado en esta fase)

</domain>

<decisions>
## Implementation Decisions

### Render — forma (PSTATE-05)
- **D-01:** **Columna nueva dedicada**, NO badge anexado a una celda existente. Justificación: el criterio 1 exige separar inequívocamente los dos ejes (proceso local vs tarea en el sistema de gestión); una columna propia es la lectura más honesta y evita que el dato se confunda con el status local. Coste aceptado: ensancha la tabla ~10-12 chars sobre el layout de 7 columnas ya existente.
- **D-02:** **Posición:** insertar la columna **adyacente a `status`, antes de `age`**. Orden resultante: `gutter · state · task_ref · repo · phase/mode · status · TASK · age`. Razón: dejar los dos ejes contiguos hace el contraste didáctico (status = proceso local | task = estado en el sistema de gestión).
- **D-03:** **Cabecera de la columna: `task`** (corto, evoca "estado de la tarea"). Se prefirió sobre `provider` por brevedad en una fila ya ancha.

### Render — los tres reason-states (criterio 2)
- **D-04:** Render por `provider_state_reason` (campo de Phase 40 D-05), distinguible **sin color** (NO_COLOR-safe):
  - **ok** (`reason: null`, valor presente) → el **string crudo** del provider (`in_review`, `done`, …).
  - **unsupported** (`reason: 'unsupported'`, permanente) → **`—` en dim** ("este provider no expone estado").
  - **fetch-failed** (`reason: 'fetch-failed'`, transitorio) → **`?` en dim** ("falló ahora, reintentará").
  - Glyphs distintos (`—` vs `?`) = distinguibles sin color; el `dim` separa "sin dato" de un valor real.
- **D-05:** **El valor ok va en texto plano (sin color propio).** Solo el `dim` marca los estados degradados (`—`/`?`). Coherente con la preferencia de UI mínima del proyecto (bold+gutter sobre bloques inversos, dim para done) y con criterio 1: cero riesgo de que la paleta de la columna `task` colisione/se fusione con la de `statusColor` (eje local). NO se introduce una segunda paleta semántica para la columna provider.

### Filtro — semántica (PSTATE-06)
- **D-06:** **Prefijo dedicado `ps:`** (ej. `ps:review`), NO extender el `s:` actual con OR. El `s:` sigue filtrando SOLO el estado local v3 (`r.state ?? r.status`). Ejes de filtro separados y explícitos — coherente con la columna dedicada (D-01) y el texto plano (D-05). Coste aceptado: el operador aprende un prefijo más (documentar en el footer de hints).
- **D-07:** **Match por `String.includes` case-insensitive** sobre el string crudo (criterio 3 — anti-ReDoS, T-36-01, NUNCA `RegExp`). NOTA: difiere del `s:` actual, que hace match **exacto** (`st === parsed.status`). `ps:` es substring: `ps:rev` casa `in_review` (`'in_review'.includes('rev')`). Esto es lo que el criterio 3 fija explícitamente.
- **D-09:** **Alcance de `ps:`: solo el `provider_state` crudo.** Las filas degradadas (`provider_state === null` por unsupported/fetch-failed) **nunca casan** con `ps:` — el reason NO entra en el alcance del filtro. Lectura literal del criterio 3, mínimo código. Trade-off consciente: el operador no puede filtrar "muéstrame los que fallaron" (se descarta `ps:failed`/`ps:unsupported`); promover a deferred si surge la necesidad real.

### Vocabulario mostrado (criterio 4)
- **D-08:** **Verbatim + truncate.** Mostrar el string TAL CUAL del provider (`in_review`, `in_progress`), columna de ancho fijo con `wrap: 'truncate-end'` nativo de ink (ellipsis `…`) si desborda. **Cero transformación** = cero acoplamiento al vocabulario: un estado renombrado por el provider se muestra solo, sin tocar código (criterio 4 cumplido por construcción). Se descartó normalizar guiones (`in_review` → "in review") para no añadir una regla de formato; NUNCA una tabla de mapeo hardcoded (rompería criterio 4).

### Claude's Discretion
- **Ancho exacto de la columna `task`** (sugerencia: ~12 para que `in_progress` quepa, con truncate-end como red de seguridad). El planner decide el número final según el ancho real del terminal y el resto de columnas.
- **Glyph exacto** para unsupported/fetch-failed: las decisiones fijan `—`/`?` en dim; si el planner halla un glyph más legible bajo NO_COLOR puede ajustarlo manteniendo la distinción de los tres estados.
- **Actualización (o no) del header `countsLabel`** con un contador de provider_state: no se discutió; queda a criterio del planner si aporta sin saturar el header (probablemente NO en v1, mantener el header centrado en el eje local).
- **Wiring exacto del parser `ps:`** en `parseFilter`/`applyFilter` (rama nueva paralela a `r:`/`s:`): seguir el patrón existente de `select.js`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Datos de entrada (Phase 40 — el contrato que esta fase consume)
- `.planning/phases/40-provider-state-contrato-providers-enrichment/40-CONTEXT.md` §D-05/D-06/D-07 — **forma exacta** del campo: `provider_state: string|null` + `provider_state_reason: null|'unsupported'|'fetch-failed'`. Los 3 reason-states se diseñaron explícitamente para alimentar los 3 estados visuales de ESTA fase. **Lectura obligatoria.**
- `src/server.js:409-438` — handler `GET /status` que emite `provider_state`/`provider_state_reason` por fila (la fuente del dato que el dashboard renderiza).

### Requisitos y roadmap
- `.planning/REQUIREMENTS.md` §PSTATE-05, §PSTATE-06 — requisitos formales de esta fase
- `.planning/ROADMAP.md` §"Phase 43" — Goal, Success Criteria (4) e Invariantes/notas

### Código a tocar / reusar (capa dashboard)
- `src/cli/dashboard/SessionTable.js` — componente presentacional; `COLS` (anchos fijos, línea 44), `columnHeader` (línea 280) y el `.map` de `dataRows` (línea 293) donde se inserta la nueva columna `task`.
- `src/cli/dashboard/format.js` — capa de presentación pura (React-free); `rowCells` (línea 181) proyecta la fila a celdas. Aquí vive la lógica de derivar la celda `task` (valor crudo vs `—`/`?` por reason).
- `src/cli/dashboard/select.js` — capa de derive pura; `parseFilter` (línea 101) y `applyFilter` (línea 139) — añadir la rama `ps:` espejando `r:`/`s:`.
- `src/cli/dashboard/App.js:266` — wiring `applyFilter(sorted, parseFilter(query), deriveRepo)`; footer de hints en `src/cli/dashboard/App.js:575` (`↑↓ move · / filter · d dismiss · q quit`) — documentar `ps:` si procede.

### Tests
- `test/dashboard-format.test.js` — tests de `format.js` (celdas, colores) — extender para la celda `task` y los 3 reason-states.
- `test/dashboard-table.test.js` — tests byte-stables del render de la tabla (glyphs/colores) — la columna nueva debe cubrirse aquí.
- `test/format-isolation.test.js` — walker que verifica color-isolation (cero picocolors en `src/cli/dashboard/`); cubre los archivos tocados automáticamente.
- Tests de `select.js` (filtro) — añadir casos para `ps:` (substring, case-insensitive, filas null no casan).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`cell({width, text, color, dim, bold, truncate})`** en `SessionTable.js:60` — helper de celda de ancho fijo con `truncate-end` de ink. La columna `task` lo reusa directamente: valor crudo → `cell({width, text, truncate:true})`; degradado → `cell({width, text:'—'|'?', dim:true})`.
- **`rowCells(session)`** en `format.js:181` — proyector puro de celdas. Añadir aquí la derivación de la celda `task` (testeable sin ink). Patrón espejo: como `statusLabel` deriva el `(zombie)`, una función pura deriva el valor/glyph de provider_state desde `provider_state` + `provider_state_reason`.
- **`parseFilter`/`applyFilter`** en `select.js:101,139` — el patrón `r:`/`s:` (prefijo → branch → `String.includes` AND) se replica casi 1:1 para `ps:`. `parseFilter` ya baja a minúsculas; `applyFilter` ya hace AND anti-ReDoS.
- **`STATE_BADGES` / `stateBadge`** (format.js:132) — referencia del patrón "lookup con fallback `{}`", aunque la columna `task` NO usa badges con color (D-05 texto plano).

### Established Patterns
- **Color-isolation (D-12 v0.9):** todo color vía `<Text color>`/`dimColor` de ink (string name), CERO picocolors, CERO import de `src/cli/format.js`. La columna `task` usa solo `dimColor` (D-05). `test/format-isolation.test.js` lo verifica por walker.
- **Anti-ReDoS (T-36-01):** filtros con `String.includes` (lowercased), jamás `RegExp` sobre input del operador. `ps:` hereda esta disciplina.
- **Separación de capas:** derive puro (`select.js`) vs presentación pura (`format.js`) vs componente (`SessionTable.js`). La lógica de celda va en `format.js`; la del filtro en `select.js`; el render en `SessionTable.js`.
- **Byte-determinismo `--json`/NO_COLOR:** las funciones de presentación son puras sin I/O; la distinción de los 3 estados NO depende de color (glyphs `—`/`?`).
- **Selección por identidad `task_id`** (Phase 36, invariante) intacta — la columna nueva no la altera.

### Integration Points
- **Render:** `SessionTable.js` `COLS` + `columnHeader` + `dataRows.map` — insertar la columna `task` entre `status` y `age`.
- **Datos:** las filas de `props.rows` ya traen `provider_state`/`provider_state_reason` desde `GET /status` (Phase 40) — el dashboard solo los lee, no los computa.
- **Filtro:** `App.js:266` ya invoca `applyFilter(sorted, parseFilter(query), deriveRepo)` cada render — la rama `ps:` entra ahí sin cambiar el wiring.

</code_context>

<specifics>
## Specific Ideas

- El driver del milestone (ROMAN-150) es que `in_review` sea **visible**: aunque el valor ok va en texto plano (D-05), su sola presencia en una columna dedicada resuelve el caso — una sesión movida a "In Review" en Plane deja de ser invisible.
- La asimetría con el `s:` existente es deliberada y debe documentarse en el código: `s:` es match EXACTO del estado local; `ps:` es match por SUBSTRING (`String.includes`) del estado del provider (criterio 3). No "alinear" ambos — son ejes distintos con semánticas distintas.
- `provider_state` puede valer `'unknown'` (valor crudo real, `reason: null`) — esto es DISTINTO de `null`+`unsupported`/`fetch-failed`. `'unknown'` se muestra verbatim como cualquier otro valor ok (D-08), no como `—`/`?`.

</specifics>

<deferred>
## Deferred Ideas

- **Filtrar por los reason-states degradados** (`ps:failed` / `ps:unsupported` para triaje): descartado en esta fase (D-09 — `ps:` solo matchea el valor crudo). Promover si en uso real surge la necesidad de "muéstrame los que fallaron".
- **Contador de provider_state en el header `countsLabel`:** no discutido; probablemente innecesario en v1 (el header se mantiene centrado en el eje local). Reconsiderar si los operadores piden un resumen agregado del estado provider.
- **Acento de color en estados accionables** (`in_review`/`blocked` con color propio para que "salten"): descartado (D-05 texto plano). Reconsiderar solo si la visibilidad en texto plano resulta insuficiente en uso real, eligiendo una paleta que NO colisione con `statusColor`.
- **Normalización del vocabulario** (`in_review` → "in review", o humanización): descartado (D-08 verbatim) para no acoplar al vocabulario ni romper criterio 4.

None — discussion stayed within phase scope (las ideas anteriores son refinamientos descartados de ESTA fase, no nuevas capacidades).

</deferred>

---

*Phase: 43-render-provider-state-en-el-dashboard*
*Context gathered: 2026-06-06*
