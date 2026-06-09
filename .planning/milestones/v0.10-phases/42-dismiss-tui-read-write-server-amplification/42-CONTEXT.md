# Phase 42: Dismiss — TUI read-write + server amplification - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Phase Boundary

La tecla `d` en el dashboard descarta sesiones **dead** (`alive===false`) reusando el saneo de `doctor` (Phase 41), promoviendo la TUI de read-only a **read-write** — **primera ruptura consciente del invariante "TUI read-only" de v0.9** (backlog 999.1). Dos mitades acopladas:

1. **Server amplification** — `DELETE /sessions/{id}` hoy solo hace `removeSession(taskId)` (`src/server.js:495-500`). Se **amplifica** para delegar en `doctor.execute({taskId})` (worktree + lock + entrada `state.json` de ESA sesión, SIN logs — 41-D-05), devolviendo el detalle estructurado del saneo.
2. **TUI read-write** — `d` sobre fila dead → confirmación inline modal → `dismissSession()` never-throws en `client.js` → DELETE → footer refleja el resultado.

**En scope (Phase 42):**
- Modo de confirmación inline (`mode:'confirm'`) + handler `d` con guard inverso — DISMISS-01, DISMISS-02, DISMISS-04
- `dismissSession()` never-throws en `src/cli/dashboard/client.js` — DISMISS-03
- Amplificación de `DELETE /sessions/{id}` para delegar en `doctor.execute({taskId})` + guard server-side `alive` (409) + body con `actions[]`
- Mapeo del resultado al footer (éxito / parcial `.dirty` / error), reusando el patrón de footer transitorio de Phase 37

**Fuera de scope (otras fases / locked en otro lado):**
- El módulo de saneo en sí (`src/gsd/doctor.js`) — entregado en **Phase 41**; Phase 42 solo lo CONSUME vía el server.
- `reconcileTick` sigue siendo el ÚNICO escritor de `alive` — el dismiss jamás escribe `alive`, solo invoca saneo vía server.
- Borrar el `.ndjson` de la sesión al descartarla — retención global por mtime>7d (41-D-05/D-12).
- Render/filtro de `provider_state` — Phase 43.

</domain>

<decisions>
## Implementation Decisions

### UX de confirmación inline (DISMISS-02)
- **D-01:** **Nuevo `mode:'confirm'` modal.** Añadir `'confirm'` al union de `mode` (`list|filter|overlay|confirm`, `App.js:172`). Al pulsar `d` sobre fila `alive===false` se entra en `confirm` capturando el `task_id` objetivo; el teclado se enruta modal (espejo de `filter`/`overlay`). Consistente con el patrón establecido en Phases 36/39.
- **D-02:** **Doble-`d` arma + confirma.** Primera `d` arma sobre la fila seleccionada (entra en `confirm`); segunda `d` ejecuta el dismiss. Es lo que pide DISMISS-02 literalmente ("doble `d` / `Esc`").
- **D-03:** **Sin auto-cancel por tiempo.** El armado persiste hasta `d` (confirma) o cancelación. Sin `setTimeout` que limpiar en transiciones/teardown; el re-check `alive===false` al confirmar (D-05/server 409) ya protege contra un armado stale.
- **D-04:** **Cualquier tecla ≠ `d`/`Esc` CANCELA el armado** (clear-on-any-input, espejo del footer-error de Phase 37 `App.js:252`). Para una op destructiva, solo la repetición explícita de `d` ejecuta; un keystroke despistado siempre aborta y vuelve a `list`. (`Esc` también cancela explícitamente.)
- **D-05:** **Bajo `confirm` el render NO se congela** — el poll de Phase 35 sigue actualizando la tabla. Así el re-check `alive===false` en el momento del segundo `d` se hace contra el snapshot MÁS reciente (TOCTOU correcto, SC#3). A diferencia del overlay de Phase 39 (que congela para lectura estable), aquí queremos datos frescos para revalidar antes de mutar.

### Contrato del server amplificado (DISMISS-01)
- **D-06:** **`DELETE /sessions/{id}` devuelve detalle de acciones.** Shape `{ok, removed, actions:[{type:'worktree'|'lock'|'state', result:'removed'|'pruned'|'moved-dirty'|'kept'|'error'}]}`, reusando el reporte estructurado que `doctor.execute` ya produce (41-Claude's-Discretion). Habilita el footer distinguible (D-09) y es byte-determinista para tests/`--json`. Reemplaza el `{ok, removed}` mínimo actual.
- **D-07:** **Guard `alive===false` en defensa en profundidad (3 capas).**
  - **TUI:** guard inverso en `d` — no entra en `confirm` ni manda DELETE si `alive===true` (SC#2, DISMISS-04). Espejo invertido del guard de Enter (`App.js`, focus solo sobre `alive===true`).
  - **Server:** re-lee el `alive` fresco (vía `loadState`) y rechaza explícito un DELETE sobre sesión viva con `{ok:false, error:'alive'}` + HTTP **409** ANTES de `execute`. El server deja de confiar ciegamente en que el cliente filtró (defensa contra races/clientes ajenos).
  - **Doctor:** el re-check liveness por acción (41-D-06/D-14) nunca toca recursos vivos — última red.
- **D-08:** El guard server-side (D-07) ES el re-check TOCTOU que pide SC#3 ("re-checando `alive===false` en el momento del DELETE"). El server lee el estado más reciente al recibir el DELETE, no un snapshot del cliente.

### Fallo parcial / worktree dirty (DISMISS-03)
- **D-09:** **Footer distinguible según `actions[]`.** Éxito total → `dismissed <task>`. Parcial (worktree movido a `.dirty`, o un sub-fallo fail-open de doctor) → mensaje que lo señale, p.ej. `dismissed <task> — worktree preservado (.dirty)` / `… con avisos`. La TUI deriva el matiz del `actions[]` del body (D-06). El operador se entera de que quedó un `.dirty` para inspeccionar sin abrir logs (lección de v0.9: transparencia sobre mutaciones).
- **D-10:** **`dismissSession(baseUrl, taskId, fetchFn?)` never-throws en `client.js`**, espejo exacto de `fetchComments`/`fetchLogs` (`src/cli/dashboard/client.js`): colapsa cualquier fallo de red/HTTP/JSON al discriminante `{ok:false, error}`; en éxito devuelve `{ok:true, data:{removed, actions}}`. El handler `useInput` async (ya lo es, `App.js:245`) lo **`await`-ea** y mapea el resultado al footer. Cumple la regla "no `await` desnudo" del ROADMAP porque `dismissSession` nunca lanza — ningún throw llega a React (invariante v0.9, SC#4).

### Feedback de éxito + refresco
- **D-11:** **La fila desaparece por el poll natural** (≤2.5s, backoff `[2500,5000,10000]` de Phase 35). Sin optimistic UI ni refresh forzado: el poll sigue siendo el ÚNICO escritor del estado de la tabla, imposible que diverja del server. El lag <2.5s es aceptable para una op deliberada de doble-`d`.
- **D-12:** **Mensaje de footer efímero, clear-on-any-input** (espejo Phase 37, `App.js:252`). `dismissed <task>` (o variante parcial/error) se limpia con la siguiente tecla. Un único patrón de footer transitorio para éxito/parcial/error, reusando el estado y el clear ya existentes (probablemente generalizar el `focusError` actual a un "footer message" o un estado hermano — discreción del planner).
- **D-13:** **Cursor tras desaparecer la fila:** ya resuelto por `resolveSelection` de Phase 36 (clamp posicional por identidad cuando la fila objetivo desaparece). No requiere código nuevo de cursor.

### Claude's Discretion
- **Firma exacta de `dismissSession`** y de la DI del handler de `d` (qué se inyecta para testear: `fetchFn`, baseUrl, el accessor de la fila seleccionada). Seguir el molde de `fetchComments`/`fetchLogs` y del handler de `c`/`l`.
- **De dónde re-lee el server el `alive` fresco para el 409** (D-07): `loadState` + búsqueda por `task_id` en `state.sessions`/`state.history` (`findSession`), o el mismo derive que usa `/status`. Reusar lo existente, no reimplementar liveness.
- **Eventos NDJSON del path dismiss** (p.ej. `session.dismissed`, o reusar los `doctor.fix.*` que `execute` ya emite): seguir el molde de `worktreeCleanup*`/`doctor.*` en `logger-events.js`. El server probablemente solo loguea el resultado agregado; doctor emite el detalle por ítem. Token=0.
- **Si el server reusa la rama `execute({taskId})` tal cual o añade un wrapper** que traduzca su reporte al body `actions[]` de D-06. Mapeo fino, no re-saneo.
- **Copy literal exacta del footer** en `confirm` (armado) y en éxito/parcial/error — constantes literal-estables EXPORTADAS, como las de Phase 37 (`App.js:69`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Driver y requisitos
- `.planning/REQUIREMENTS.md` §DISMISS-01..04 — requisitos formales de esta fase
- `.planning/ROADMAP.md` §"Phase 42" — Goal, Success Criteria e **Invariantes/notas** (TOCTOU, no-await-desnudo, ruptura del invariante read-only: lectura obligatoria)
- `.planning/ROADMAP.md` §Backlog 999.1 — justificación de la promoción a read-write

### Dependencia dura — el módulo que se consume (Phase 41)
- `.planning/phases/41-doctor-m-dulo-puro-de-saneo-cli/41-CONTEXT.md` — el contrato de `doctor`: **D-04** (`scan()`+`execute()` separados), **D-05** (`execute({taskId})` acota a worktree+lock+entrada, logs FUERA), **D-06** (re-detección + re-check liveness por acción), **D-11** (worktree dirty→`.dirty`), **D-14** (nunca toca vivo). El reporte estructurado de `execute` es la fuente del `actions[]` de D-06.
- `src/gsd/doctor.js` — el módulo real entregado en Phase 41 (API `scan`/`execute`). **Leer su firma y el shape de su reporte antes de cablear el server.**

### Server (la otra mitad de la fase)
- `src/server.js:495-500` — el handler `DELETE /sessions/{id}` ACTUAL (bare `removeSession`) que se amplifica
- `src/server.js:383-461` — handlers `GET /status` (provider-state enrichment Phase 40) y `/logs` como molde de respuesta JSON + error handling del server
- `src/session/state.js` — `loadState` (`:208`), `findSession`/`removeSession` (`:242`), `listSessions` (`:287`) para el re-check `alive` server-side (D-07)

### TUI (dashboard)
- `src/cli/dashboard/App.js:244-340` — `useInput` mode-gated: el patrón de modos (`list`/`filter`/`overlay`), el handler async de `c`/`l` (await never-throws + token de generación), el footer-error clear-on-any-input (`:252`), las constantes de copy EXPORTADAS (`:69`). El nuevo `mode:'confirm'` y el handler de `d` espejan esto.
- `src/cli/dashboard/client.js:49-135` — `fetchStatus`/`fetchComments`/`fetchLogs` never-throws: el molde EXACTO de `dismissSession` (D-10)
- `src/cli/dashboard/select.js` — `resolveSelection` (clamp por identidad, Phase 36) que ya resuelve el cursor post-dismiss (D-13)
- `src/logger-events.js` — registro `EVENTS` (eventos del dismiss, molde `worktreeCleanup*`/`doctor.*`)

### Precedente de fase de alto riesgo (mutación destructiva)
- `.planning/milestones/v0.9-phases/37-*` y `38-*` (UAT manual obligatorio) — patrón de cierre por verificación humana que esta fase probablemente espeja

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`doctor.execute({taskId})` (Phase 41):** la lógica de saneo completa, puro + DI + never-throws + re-check liveness por acción. El server la invoca; el dashboard NO reimplementa nada (SC#1).
- **`fetchComments`/`fetchLogs` never-throws (`client.js`):** molde literal de `dismissSession` — colapso de errores a `{ok:false,error}`, `fetchFn` inyectable, sin throws.
- **`useInput` mode-gated + handler async de `c`/`l` (`App.js`):** el `mode:'confirm'` y el handler de `d` reusan el routing modal, el `await` de un helper never-throws, y el token de generación si hiciera falta.
- **Footer-error transitorio de Phase 37 (`App.js:252`, `setFocusError`/clear-on-any-input + constantes exportadas):** se generaliza/reusa para el mensaje de éxito/parcial/error del dismiss (D-12).
- **`resolveSelection` (`select.js`, Phase 36):** clamp del cursor por identidad — el cursor post-dismiss ya está resuelto (D-13).

### Established Patterns
- **`reconcileTick` = único escritor de `alive`** (invariante v0.9). El dismiss jamás escribe `alive`; solo invoca saneo vía server (que delega en doctor).
- **El poll = único escritor del estado de la tabla** (Phase 35). Sin optimistic UI (D-11).
- **Never-throws de punta a punta:** data layer (`client.js`) + doctor + server fail-open → ningún throw llega a React (SC#4).
- **Guard de Enter sobre `alive===true` (Phase 37):** el guard de `d` es su espejo invertido (`alive===false`).

### Integration Points
- `src/server.js` `DELETE /sessions/{id}` → `doctor.execute({taskId})` + guard 409 `alive` + body `actions[]`. **El punto de "server amplification".**
- `src/cli/dashboard/client.js` — nuevo `dismissSession()`.
- `src/cli/dashboard/App.js` — `mode:'confirm'`, handler de `d`, mapeo del resultado al footer.
- `src/logger-events.js` — eventos del path dismiss.

</code_context>

<specifics>
## Specific Ideas

- **TOCTOU explícito (ROADMAP):** re-validar `alive===false` contra el estado MÁS reciente al CONFIRMAR (segundo `d` → server lee `loadState` fresco al recibir el DELETE), NO al pulsar la primera `d`. Por eso el render no se congela bajo `confirm` (D-05) y el guard duro vive server-side (D-07/D-08).
- **Transparencia sobre el `.dirty` (lección v0.9 37/38):** el operador debe poder confiar en el dismiss en producción; un worktree preservado como `.dirty` se comunica en el footer (D-09), no se entierra solo en logs.
- **Fase de alto riesgo:** mutación destructiva desde la TUI — probable UAT/verificación humana explícita (espejo de cómo v0.9 cerró 37/38). Documentar en STATE.md el cambio de identidad de la superficie (observabilidad → gestión).

</specifics>

<deferred>
## Deferred Ideas

- **Dismiss de sesiones vivas / "force kill" desde la TUI:** explícitamente FUERA — `d` jamás descarta `alive===true` (DISMISS-04). Matar una sesión viva sería otra capacidad (otra fase), no un saneo de huérfanos.
- **Auto-cancel del armado por timeout (D-03):** descartado para v1; reconsiderar solo si UAT revela armados stale problemáticos.
- **Refresh optimista / quitar la fila al instante (D-11):** descartado — el poll natural basta y evita un 2º escritor del estado de la tabla. Promover solo si el lag <2.5s molesta en uso real.
- **Borrar el `.ndjson` de la sesión al descartarla:** descartado (41-D-05/D-12) — el log caduca por mtime>7d globalmente; acoplarlo al dismiss borraría logs aún útiles.
- **Flags/acciones por-categoría en el DELETE** (descartar solo worktree, solo lock…): YAGNI; `execute({taskId})` barre las 3 (worktree+lock+entrada) de esa sesión en bloque.

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 42-dismiss-tui-read-write-server-amplification*
*Context gathered: 2026-06-05*
