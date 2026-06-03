# Phase 39: Paneles auxiliares — comentarios + logs - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

El operador inspecciona el detalle de una sesión sin salir del dashboard, vía dos
overlays sobre la fila seleccionada:
- **`c`** → comentarios de la tarea (`GET /comments/<task_id>`, resuelto por `task_id`).
- **`l`** → líneas de log que coinciden con la sesión (grep best-effort sobre el
  buffer COMPARTIDO de `GET /logs`, etiquetado honestamente como no-per-session).

Ambos overlays vuelven SIEMPRE al mismo cursor al cerrarse (Esc). Cierra TUI-15 /
TUI-16 + corrige el wording de PROJECT.md sobre `/logs`.

**Fuera de scope (diferido):** mostrar el estado del PROVIDER (Plane "In Review",
GitHub equivalente) en el dashboard — es una capacidad nueva, no comentarios/logs.

</domain>

<decisions>
## Implementation Decisions

### Overlay de comentarios (`c`)
- **D-01:** Overlay a PANTALLA COMPLETA — ocupa el área de la tabla mostrando los
  comentarios de la tarea seleccionada. Espejo del patrón modal del filtro
  existente (mode-gated `useInput`). Esc vuelve a la tabla con el mismo cursor.
- **D-02:** Resolución por `task_id` (no `task_ref`) — el server ya expone
  `GET /comments/<task_id>` consumiendo `provider.listComments`. El cliente TUI
  solo necesita un `fetchComments(baseUrl, taskId)` never-throws.

### Overlay de logs (`l`)
- **D-03:** Grep best-effort por SUBSTRING de `task_ref`/`workspace_ref` sobre el
  buffer compartido de `GET /logs`. NO intentar parsear session_id por línea —
  el buffer NO garantiza ese campo y arriesgaría overlay vacío con actividad real.
- **D-04:** Etiqueta de honestidad OBLIGATORIA en el header del overlay: indica
  explícitamente que es un grep de un buffer compartido y "may include other
  sessions" (no es un tail per-session). Cumple SC#3 del ROADMAP.

### Comportamiento de los overlays (común a c y l)
- **D-05:** SNAPSHOT CONGELADO — el overlay captura el contenido al abrirse y lo
  mantiene fijo hasta Esc. El polling de la tabla sigue corriendo por debajo (NO
  se detiene — keep-last-good Phase 35 intacto), pero el overlay no se redibuja
  con datos nuevos mientras el operador lee. Evita que el contenido salte.
- **D-06:** SCROLL con ↑/↓ DENTRO del overlay cuando el contenido excede la altura.
  Esto exige un SUB-MODO de input: en modo overlay, ↑/↓ hacen scroll del contenido
  (NO navegan filas de la tabla). El planner debe modelar el modo overlay como un
  estado de `useInput` separado de `list`/`filter` (p. ej. `mode: 'overlay'` +
  `overlayKind: 'comments'|'logs'` + `scrollOffset`). Esc sale del overlay y
  restaura `mode: 'list'` con el cursor preservado.

### Estados vacíos / error (ambos overlays)
- **D-07:** Mensajes DISTINTOS por caso, no genéricos:
  - comentarios vacíos → "no comments yet"
  - tarea no encontrada (404) → "task not found"
  - error de red/5xx → "error fetching comments/logs"
  - logs sin matches → "no log lines match this session"
  Espejo del manejo never-throws discriminado del cliente existente (`fetchStatus`
  retorna `{ok}`); `fetchComments`/`fetchLogs` deben seguir el mismo contrato.

### Corrección de documentación (SC#4)
- **D-08:** Verificar/corregir el wording de PROJECT.md sobre `/logs` para que diga
  "best-effort substring grep" (NO "filtrado por session_id"). NOTA: la línea ~32
  actual de PROJECT.md YA dice "grep best-effort sobre el buffer compartido... no
  hay session_id real" — el planner debe confirmar si queda algún wording residual
  incorrecto en otra parte de PROJECT.md y, si no, marcar SC#4 como ya satisfecho.

### Claude's Discretion
- Anchos/layout exactos del overlay (header + body + footer de hints), respetando
  color-isolation (solo `<Text color>` de ink, cero picocolors bajo `dashboard/`).
- Tecla de cierre adicional (¿`q` además de `Esc`?) — coherente con el resto del
  dashboard; Esc es el contrato mínimo.
- Número de líneas mostradas / tamaño del viewport del scroll.

### Reviewed Todos (not folded)
- **Surface provider state in dashboard** (`2026-05-28-surface-provider-state-in-dashboard-plane-in-review.md`,
  score 0.9) — REVISADO y DIFERIDO. Es una capacidad nueva (mostrar el estado del
  provider, ortogonal al lifecycle interno de kodo y a comentarios/logs). Driver
  real: ROMAN-150 movido a "In Review" en Plane vía MCP, bypaseando `kodo gsd
  verify`, desapareció del dashboard. Merece su propia fase/milestone. NO se
  foldea en Phase 39 (sería scope creep sobre el goal de overlays).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Endpoints del server (ya existen — NO añadir endpoints, invariante v0.9)
- `src/server.js` §`GET /comments/<task_id>` (líneas ~421-431) — resuelve via
  `provider.listComments`; el dashboard browser ya lo consume (líneas ~168-182).
- `src/server.js` §`GET /logs` (línea ~415) + `refreshLogs` (~225) — buffer
  compartido de logs (sin session_id).

### Cliente y render del dashboard (donde vive el trabajo)
- `src/cli/dashboard/client.js` — `fetchStatus` never-throws `{ok}`; documenta que
  `fetchComments`/`fetchLogs` están diferidos (YAGNI) — Phase 39 los implementa.
- `src/cli/dashboard/App.js` — `useInput` mode-gated (`mode: 'list'|'filter'`);
  `Esc` está RESERVADO explícitamente "para overlays de Phase 38/39" (comentario
  línea ~41/310). Aquí se añade `mode: 'overlay'`.
- `src/cli/dashboard/SessionTable.js` — patrón de render presentacional + footer
  (errorLine/filterLine) reusable para el chrome del overlay.
- `src/cli/dashboard/format.js` / `select.js` — helpers puros; el grep de logs
  (substring por task_ref/workspace_ref) encaja como función pura testeable.

### Requisitos y wording
- `.planning/REQUIREMENTS.md` — TUI-15, TUI-16.
- `.planning/PROJECT.md` línea ~32 — wording de `/logs` (D-08; ya parcialmente correcto).

### Patrones de fases previas (overlays/UI)
- `.planning/phases/36-tabla-viva-render-seleccion-filtros/36-CONTEXT.md` — filtro
  modal mode-gated, selección por task_id, color-isolation.
- `.planning/phases/37-attach-handoff-cmux/37-CONTEXT.md` — patrón footer-error +
  clear-on-any-input.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `GET /comments/<task_id>` y `GET /logs`: AMBOS endpoints ya existen y funcionan
  (el dashboard browser los usa). Phase 39 NO toca `src/server.js` salvo D-08 doc.
- `client.js#fetchStatus`: plantilla exacta para `fetchComments`/`fetchLogs`
  (never-throws, discriminated `{ok}`, fetch inyectable, AbortSignal).
- `App.js#useInput` mode-gated: el modo `overlay` se añade junto a `list`/`filter`.
- `SessionTable.js` errorLine/filterLine + `format.js` cell helper: chrome del
  overlay sin reinventar layout.

### Established Patterns
- **Cero endpoints nuevos** (invariante v0.9): Phase 39 consume el contrato JSON
  existente, no añade rutas al server.
- **Selección por `task_id`** (no índice): el overlay opera sobre la fila
  seleccionada resuelta por identidad (Phase 36).
- **Color SOLO de `<Text color>`** de ink, cero picocolors bajo `dashboard/`
  (`test/format-isolation.test.js` blinda).
- **Cliente never-throws `{ok}`**: `fetchComments`/`fetchLogs` siguen el contrato
  de `fetchStatus` (degradación elegante, nunca crash de render).

### Integration Points
- `App.js`: nuevo `mode: 'overlay'` + estado `overlayKind` + `scrollOffset` +
  `overlaySnapshot`; teclas `c`/`l` en modo lista abren overlay; ↑/↓ scrollean en
  modo overlay; Esc cierra y restaura cursor.
- `client.js`: +2 funciones (`fetchComments`, `fetchLogs`).
- `select.js` o `format.js`: +1 helper puro de grep substring para logs.

</code_context>

<specifics>
## Specific Ideas

- El overlay de logs debe ser HONESTO sobre su naturaleza best-effort — el operador
  no debe creer que es un tail per-session fiable (caso real: el buffer mezcla
  sesiones). La etiqueta es load-bearing, no cosmética.
- Snapshot congelado: leer no debe ser una experiencia donde el texto salta bajo
  el cursor del operador.

</specifics>

<deferred>
## Deferred Ideas

### Reviewed Todos (not folded)
- **Surface provider state in dashboard** (Plane "In Review" / GitHub equivalente)
  — capacidad nueva ortogonal a Phase 39. Driver: ROMAN-150 invisible tras mover a
  "In Review" vía MCP sin `kodo gsd verify`. Candidata a fase propia en v0.10+.
  Ver `.planning/todos/pending/2026-05-28-surface-provider-state-in-dashboard-plane-in-review.md`.

</deferred>

---

*Phase: 39-paneles-auxiliares-comentarios-logs*
*Context gathered: 2026-06-02*
