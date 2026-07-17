# Phase 75: Superficie del `NEXT:` — dashboard y nudge - Context

**Gathered:** 2026-07-17 (modo `--auto` — decisiones auto-seleccionadas sobre la opción recomendada; auditar contra `75-DISCUSSION-LOG.md`)
**Status:** Ready for planning

<domain>
## Phase Boundary

El operador y el orquestador **consumen** el estado vivo que la Phase 74 produce, sin abrir
ficheros a mano. Tres superficies:

1. **Lista del dashboard (LIVE-05):** el `NEXT:` de cada tarea se ve en la tabla, leído de
   `state.json` — la TUI **no** abre N ficheros de plan para pintar la tabla y no aparece ningún
   endpoint nuevo en `src/server.js`.
2. **Overlay de plan en la rama `phaseId == null` (LIVE-06):** desde la fila de una sesión no-GSD
   el operador abre el markdown completo del plan **renderizado y de solo lectura**; `Esc` vuelve
   preservando el cursor por `task_id`. Las filas GSD siguen abriendo su overlay GSD exactamente
   igual que hoy (D-02 intacto — el handoff no se surface en esa rama aunque esté en disco).
3. **Nudge del orquestador (LIVE-07):** con un `NEXT:` presente, el nudge lo usa como contexto
   concreto en vez del genérico.

Transversal (success criterion 5): sin `NEXT:` (tarea recién creada, handoff mecánico sin `NEXT:`,
plan ausente o ilegible) todo degrada limpio — celda vacía, nudge sin contexto, TUI never-throws,
cero ruido.

**Fuera:** producir el dato (Phase 74, cerrada), poda/cap de handoffs, edición del plan desde la
TUI, surface del handoff en el overlay GSD (rompería D-02 LOCKED), endpoint nuevo para servir el
`NEXT:`, convergencia del conteo `pending` (Phase 76).

</domain>

<decisions>
## Implementation Decisions

### Canal de datos: cómo llega `state.tasks` a la TUI (Open Question heredada de la 74)

- **D-01: Lectura directa de `~/.kodo/state.json` desde la capa de datos de la TUI** — resuelve la
  Open Question que la 74 dejó explícitamente para este discuss. `/status` sirve `listSessions()`
  (`server.js:589`), no el fichero entero, así que `state.tasks` no viaja hoy al dashboard. Se
  elige el carril filesystem: un reader puro never-throws (con DI de `readFileFn`/`kodoDir` para
  aislar `HOME` en tests, espejo de `plan.js` D-08) lee **un solo fichero** por tick y colapsa
  cualquier fallo (ausente, corrupto, sin clave `tasks`) a `{}` — celdas vacías, cero ruido.
  Razones duras: el success criterion 1 lo pide literalmente («leyéndolo de `state.json`», «no
  aparece ningún endpoint nuevo en `src/server.js`»), y la TUI ya lee el filesystem local
  directamente (precedente D-10 Phase 44: `plan.js` lee `~/.kodo/plans/`; Phase 50: `progress.js`
  lee STATE.md del worktree). Rechazado: enriquecer el payload de `/status` — tocaría `server.js`
  sin necesidad y contradice la redacción del criterio.
  Limitación conocida y aceptada: en topología multi-nodo (dashboard remoto) el `NEXT:` no viaja —
  misma limitación que ya tienen los overlays de plan y la columna `prog`, coherente con el
  precedente.

- **D-02: Cadencia piggyback sobre el poll existente** — la lectura de `state.json` se engancha al
  tick de `usePoll` que ya refresca `/status` (misma frecuencia, sin segundo loop ni watcher). El
  merge con las filas se hace por `task_id` en la capa derive (pura, React-free), nunca en el
  render.

### Presentación del `NEXT:` en la tabla

- **D-03: Columna condicional siguiendo el precedente `prog` (Phase 50 D-06)** — la columna `next`
  solo aparece cuando ≥1 fila visible tiene un `NEXT:` no vacío (mismo mecanismo que
  `deriveAnyGsd` oculta `phase/mode`); reaparece sola cuando hay dato. Fila sin `NEXT:` → celda
  vacía (success criterion 5), sin placeholder ruidoso.

- **D-04: Truncado al ancho disponible, última posición** — el valor ya llega acotado a 200 chars
  desde `state.json` (74 D-02); la celda trunca adicionalmente al ancho del terminal con ellipsis
  (`truncate` de las celdas existentes en `SessionTable.js`). La columna va al final del orden
  actual (`… → task → age → next`) como columna flexible — el ancho exacto y el comportamiento
  flex/fijo es Claude's Discretion del planner respetando `COLS` (`SessionTable.js:95`).

### Render del plan completo (LIVE-06)

- **D-05: Mini-renderer markdown line-based in-house, cero deps nuevas** — el overlay actual pinta
  `md.split('\n')` plano (`plan.js:72`). Se sustituye por una función pura React-free que mapea
  línea→estilo ink: headings (bold/color), líneas `**Label:**` (bold), bullets, code fences (dim).
  Best-effort, NO un parser CommonMark completo. Rechazado: dependencia tipo `marked`/
  `ink-markdown` (violaría «cero dependencias npm nuevas»). Color exclusivamente vía props de ink
  `<Text>` — jamás picocolors (color isolation, `test/format-isolation.test.js` escanea
  `src/cli/dashboard/**`).

- **D-06: Strip de los marcadores de handoff** — el render nuevo elimina/oculta el
  marcador HTML `<!-- kodo:handoff … -->` del heading de handoff. Esto **cumple la promesa de invisibilidad** que la 74
  documentó como deuda de esta fase (corrección post-research de 74 D-01: «la Phase 75 debe saber
  que su renderizador es lo que hace cierta la promesa de invisibilidad»). El strip usa el
  conocimiento del contrato de `src/session/handoff.js` — no una regex ad-hoc divergente (74 D-13:
  un solo módulo dueño del contrato).

- **D-07: Solo el carril `readLightPlan`, misma UX de overlay** — el render aplica únicamente a la
  rama `phaseId == null` (readPlan sigue priorizando GSD — D-02 LOCKED de v0.11). Misma mecánica
  de overlay que `c`/`l`/`p`: `mode:'overlay'`, snapshot congelado, read-only, `Esc` preserva
  cursor por `task_id`. No se añade tecla nueva si la `p` existente ya cubre el gesto — si el
  planner detecta que hace falta discriminar, es Claude's Discretion, pero el default es reutilizar
  el binding `p` actual.

### Nudge con contexto (LIVE-07)

- **D-08: `buildStopNudgeText` gana un parámetro opcional con el `NEXT`** — la función sigue pura
  (cero I/O); `session-end.js` (bloque «3. Nudge al orquestador», `:243-253`) le threadea el valor
  que quedó **persistido en `state.tasks`** para esa tarea tras el paso de handoff (`:123-128`),
  heredando la semántica asimétrica de `upsertTaskHandoff` (si esta sesión no dejó `NEXT:` pero la
  tarea tiene uno previo, se usa el previo — el dato es de la tarea, no de la sesión). El mecanismo
  exacto (threading del valor en memoria vs relectura) es Claude's Discretion con preferencia por
  threading sin I/O extra. Rechazado: que `buildStopNudgeText` lea `state.json` por su cuenta —
  rompería su pureza y su testabilidad actual.

- **D-09: Formato — línea adicional en español, textos por-modo intactos** — con `NEXT:` presente
  se añade una línea concreta al final del texto por-modo existente (p. ej. `Siguiente paso
  sugerido por la sesión: <next>`), conservando el switch quick/full/no-GSD de `stop.js:40` y la
  convención de escape `\\n` (D-04 Phase 10). Sin `NEXT:` → el texto actual queda **byte-idéntico**
  (degradación limpia del criterio 5, y los tests existentes del nudge no se rompen).

- **D-10: El nudge con `NEXT` aplica a TODOS los modos (quick/full/no-GSD)** — grounded en
  REQUIREMENTS §Out of Scope: el handoff GSD «sí alimenta el nudge — solo no se pinta en el
  overlay». D-02 restringe el *pintado*, no el nudge.

### Claude's Discretion

- Nombre/ubicación del reader de `state.tasks` (módulo nuevo en `src/cli/dashboard/` vs helper en
  `client.js`) y del mini-renderer markdown.
- Ancho exacto y comportamiento flex/fijo de la columna `next`; abreviación del header.
- Redacción literal de la línea del nudge (mientras sea ES, una línea, y los textos sin `NEXT:`
  queden byte-idénticos).
- Mecanismo de threading del `NEXT:` dentro de `runSessionEndHook` (valor en memoria vs return del
  writer) — con preferencia por cero I/O extra.
- Estructura de tests (fixtures, aislamiento de HOME vía `kodoPlansDir`/`homedirFn`, precedentes de
  la 74).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Contrato de la fase
- `.planning/REQUIREMENTS.md` — LIVE-05..07, tabla de **Constraints** (invariantes del milestone) y
  **Out of Scope** (overlay GSD, edición TUI, endpoint nuevo, poda)
- `.planning/ROADMAP.md` §Phase 75 — goal + los 5 success criteria que verificará `/gsd-verify-work`
- `.planning/STATE.md` §Critical Invariants to Preserve — invariantes cross-milestone vivos
- `.planning/phases/74-handoff-acumulativo-al-cierre/74-CONTEXT.md` — el contrato completo del
  productor (D-01 formato+marcador, D-02 extracción/truncado 200, D-05 `state.tasks`, D-13 módulo
  único del contrato) y las DOS correcciones post-research que esta fase hereda (render del
  marcador + `/status` no sirve `state.tasks`)

### Productor (Phase 74 — leer, no tocar)
- `src/session/handoff.js` — módulo dueño del contrato: `findSessionBlock` `:200`,
  `hasSessionHandoff` `:244`, `extractNext` `:261`. El strip de marcadores de D-06 se apoya aquí
- `src/session/state.js:416` — `upsertTaskHandoff`: shape `state.tasks[task_id] = { plan_path,
  next, updated_at }`, semántica asimétrica de `next` (ausente preserva el previo), typedef `:61`
- `src/hooks/session-end.js` — paso de handoff `:123-128` (donde el `NEXT:` está en memoria) y
  bloque «3. Nudge al orquestador» `:243-253` (donde se consume, D-08)

### Superficies a tocar (consumidores)
- `src/cli/dashboard/plan.js` — `readPlan` `:91` (prioridad GSD, D-02 LOCKED), `readLightPlan`
  `:65` (render plano actual `md.split('\n')` `:72` que D-05 sustituye), patrón DI
  `kodoPlansDir`/`homedirFn`
- `src/cli/dashboard/SessionTable.js:95` — `COLS` y precedente de columna condicional `prog`
  (Phase 50 D-06) que D-03 replica
- `src/cli/dashboard/client.js:51` — `fetchStatus`, la forma never-throws discriminada que el
  reader de D-01 debe replicar
- `src/cli/dashboard/App.js` — wiring `usePoll(fetchStatus, …)` donde engancha el piggyback D-02,
  y mecánica de overlays (snapshot, Esc por `task_id`)
- `src/hooks/stop.js:40` — `buildStopNudgeText`, la función pura que D-08 extiende (switch
  por-modo, ES, escape `\\n`)
- `src/server.js:588-589` — `/status` sirve `listSessions()`: la evidencia de por qué D-01 va por
  filesystem. **No se toca.**

### Precedentes de diseño
- `.planning/milestones/` (v0.11 Phase 46) — D-02: prioridad GSD sobre plan ligero, LOCKED
- Phase 50 D-06 (v0.12) — columna condicional `prog`: el molde exacto de D-03
- `test/format-isolation.test.js` — guard de color isolation que escanea `src/cli/dashboard/**`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/session/handoff.js`** — hoja pura de cero imports con el parser del contrato; D-06 lo
  reutiliza para identificar/strippear marcadores sin duplicar el formato.
- **`readLightPlan` + patrón DI de `plan.js`** — ya lee `~/.kodo/plans/<taskId>.md` con guard
  anti-path-traversal y aislamiento de HOME; LIVE-06 extiende su render, no su lectura.
- **Celdas `cell({width, truncate})` de `SessionTable.js`** — truncado ya resuelto para D-04.
- **`fetchStatus` (client.js)** — la forma never-throws discriminada `{ok:true,data}|{ok:false}` a
  replicar en el reader de `state.tasks`.
- **`usePoll`/`runPollLoop`** — self-scheduling con backoff; el piggyback D-02 se monta encima sin
  loop nuevo.

### Established Patterns
- **TUI never-throws** — todo fallo colapsa a estado renderizable; ningún throw llega a React.
- **Derive puro React-free** — sort/filtros/merge viven en capa derive testeable sin ink; el merge
  por `task_id` de D-02 va ahí.
- **Columna condicional** — `deriveAnyGsd` oculta `phase/mode` cuando no aplica; D-03 lo replica.
- **Color isolation** — `src/cli/dashboard/**` no importa picocolors; estilos vía props ink.
- **Overlay con snapshot congelado + Esc preserva cursor por `task_id`** — mecánica compartida de
  `c`/`l`/`p` que LIVE-06 hereda.
- **Función pura para texto de hooks** — `buildStopNudgeText` se testea sin I/O; D-08 lo preserva.

### Integration Points
- **`state.json` clave `tasks`** (filesystem, lectura defensiva `state.tasks || {}`) → capa de
  datos TUI (D-01/D-02).
- **`runSessionEndHook`** — el `NEXT:` en memoria del paso `:123` fluye al nudge `:243` (D-08).
- **`readPlan` rama `phaseId == null`** — único punto donde entra el render nuevo (D-07).

</code_context>

<specifics>
## Specific Ideas

- La 74 dejó DOS deudas nominales explícitas para esta fase, ambas saldadas aquí: (1) la Open
  Question «cómo llega `state.tasks` a la TUI» → D-01/D-02; (2) la promesa de invisibilidad del
  marcador `kodo:handoff` en el render → D-06.
- El success criterion 3 es un test de NO-regresión explícito: las filas GSD abren su overlay GSD
  **exactamente igual que hoy** — el planner debe incluir verificación de que la rama GSD queda
  byte-idéntica en comportamiento.
- Success criterion 5 pide «cero ruido»: ni logs nuevos ni placeholders visibles cuando falta el
  dato.

</specifics>

<deferred>
## Deferred Ideas

- **Servir `state.tasks` vía `/status` para dashboards remotos** — la limitación multi-nodo de
  D-01 es real pero coherente con los precedentes (overlays de plan y columna `prog` ya son
  local-only). Si algún día duele, es un cambio de payload del endpoint existente — decisión de
  otro milestone.
- **Scroll/paginación del overlay de plan** — con handoffs acumulándose el fichero crece; hoy los
  overlays pintan snapshot sin scroll propio. Ligado a la poda diferida a v0.18 («medir antes de
  arreglar», M21) — no se aborda aquí.
- **Render markdown para los overlays `c`/`l` o el plan GSD** — el mini-renderer de D-05 nace para
  el carril light-plan; generalizarlo es tentador pero fuera del scope (D-02 LOCKED para GSD).

</deferred>

---

*Phase: 75-Superficie del `NEXT:` — dashboard y nudge*
*Context gathered: 2026-07-17 (auto mode)*
