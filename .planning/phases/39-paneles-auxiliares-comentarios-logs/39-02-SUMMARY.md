---
phase: 39-paneles-auxiliares-comentarios-logs
plan: 02
subsystem: ui
tags: [tui, ink, overlay, snapshot-congelado, sub-modo-scroll, color-isolation, honesty-label]

# Dependency graph
requires:
  - phase: 39-paneles-auxiliares-comentarios-logs
    plan: 01
    provides: "fetchComments (404 discriminable code) + fetchLogs (buffer crudo) + grepLogs (substring OR anti-ReDoS)"
  - phase: 36-tabla-viva
    provides: "useInput mode-gated (list/filter) + resolveSelection por identidad (cursor sobrevive rebuild)"
  - phase: 35-tui-datos
    provides: "patrón never-throws {ok} + fetchFn/clock inyectables (render hermético en tests)"
provides:
  - "mode:'overlay' como TERCER sub-modo del useInput de App.js (c=comentarios, l=logs, Esc cierra, ↑↓ scroll)"
  - "overlaySnapshot congelado al abrir (D-05): el poll sigue por debajo pero el contenido del overlay no salta"
  - "6 constantes OVERLAY_* literal-estables exportadas (copy D-07 + etiqueta honesta D-04)"
  - "renderOverlay full-screen en SessionTable.js (header + body scrollable + footer, color SOLO ink)"
affects: [dashboard, App.js, SessionTable.js, TUI-15, TUI-16]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "sub-modo overlay como guard al tope del mode-gate: ↑/↓ scrollean (no navegan filas), Esc cierra sin tocar selectedTaskId (cursor GRATIS via resolveSelection)"
    - "snapshot congelado al abrir (D-05): el estado del overlay NO se re-escribe por onResult del poll → cero thrash de re-render mientras el operador lee"
    - "ciclo de import seguro App.js<->SessionTable.js: las constantes OVERLAY_* se consumen en runtime (dentro de render), no en tiempo de carga del módulo"

key-files:
  created:
    - test/dashboard-overlay.test.js
  modified:
    - src/cli/dashboard/App.js
    - src/cli/dashboard/SessionTable.js

key-decisions:
  - "Esc preserva el cursor GRATIS: setMode('list')+setOverlayKind(null) NUNCA tocan selectedTaskId → resolveSelection re-deriva la misma fila al volver (D-06, sin estado extra)"
  - "overlaySnapshot es un objeto FROZEN { kind, taskRef, status, lines } proyectado a strings al abrir: status discrimina la copy (ok/empty/not-found/error) sin re-fetch ni re-cálculo en el render"
  - "clamp superior del scroll contra overlaySnapshot.lines.length-1 en el handler (App.js); el render slicea contra OVERLAY_VIEWPORT (18) — mitiga T-39-04 (DoS de render con buffers largos)"
  - "renderOverlay como early-return en SessionTable (no archivo Overlay.js separado): mantiene SessionTable como único punto de render y queda cubierto por el walker format-isolation sin tocar su lista de archivos"
  - "etiqueta honesta OVERLAY_LOGS_LABEL en línea propia del header (yellow): SOLO en el overlay de logs, load-bearing D-04/SC#3 (declara el grep best-effort sobre buffer compartido sin session_id)"

patterns-established:
  - "overlay = tercer sub-modo del useInput existente (NO un segundo useInput): la rama overlay consume Esc antes que el mode-gate de filtro/lista"
  - "snapshot congelado: freeze-on-open + el poll de la tabla intacto por debajo (keep-last-good vivo, contenido del overlay estable)"

requirements-completed: [TUI-15, TUI-16]

# Metrics
duration: ~25min
completed: 2026-06-02
---

# Phase 39 Plan 02: Overlays full-screen comentarios (c) + logs (l) Summary

**Dos overlays a pantalla completa sobre la fila seleccionada como un TERCER `mode:'overlay'` del useInput mode-gated: `c` (comentarios por task_id, copy D-07 distinta por 404/vacío/error) y `l` (logs por grep substring con etiqueta honesta D-04), con snapshot congelado bajo el poll vivo (D-05) y Esc que preserva el cursor gratis (D-06). Cierra TUI-15/TUI-16 y satisface SC#1/SC#2/SC#3.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-06-02
- **Tasks:** 2 (Task 1 TDD RED→GREEN; Task 2 GREEN sobre los mismos tests)
- **Files modified:** 3 (1 nuevo test)

## Accomplishments
- `c` abre el overlay de comentarios de la fila seleccionada, resueltos por `task_id` (D-02): mapea el discriminante never-throws de `fetchComments` a copy distinta — `OVERLAY_COMMENTS_NOT_FOUND` (404), `OVERLAY_COMMENTS_EMPTY` (vacío), `OVERLAY_COMMENTS_ERROR` (5xx/red). SC#1 cumplido.
- `l` abre el overlay de logs filtrados por `grepLogs` (substring OR de task_ref/workspace_ref) sobre el buffer compartido; no-match → `OVERLAY_LOGS_EMPTY`, error → `OVERLAY_LOGS_ERROR`. SC#2 cumplido.
- La ETIQUETA HONESTA `OVERLAY_LOGS_LABEL` ("grep of shared buffer — may include other sessions") aparece en el header del overlay de logs en línea propia (yellow). Load-bearing D-04/SC#3 — no es cosmética; declara la limitación del buffer compartido sin session_id (T-39-03 disposition accept+disclose).
- Snapshot congelado (D-05): el contenido del overlay se congela al abrir en `overlaySnapshot`; el poll de la tabla sigue corriendo por debajo (keep-last-good intacto) pero `onResult` no re-escribe el snapshot → el texto no salta bajo el lector. Verificado por test (un `flushTick` con datos distintos NO cambia el overlay).
- Sub-modo de scroll (D-06): en `mode:'overlay'` ↑/↓ mueven `scrollOffset` (clamp 0..lines.length-1) en vez de navegar filas; Esc cierra restaurando `mode:'list'` SIN tocar `selectedTaskId` → `resolveSelection` re-deriva la misma fila (cursor preservado gratis, cero estado extra).
- Mitigación T-39-04 (DoS de render): el body slicea `[scrollOffset, scrollOffset+OVERLAY_VIEWPORT)` (18 líneas) — el render nunca intenta pintar miles de líneas de golpe.

## Task Commits

1. **Task 1 (RED): overlay tests c/l/Esc/snapshot+label** - `529717b` (test)
2. **Task 1 (GREEN): mode:'overlay' en App.js (estado + handlers + snapshot)** - `5117438` (feat)
3. **Task 2 (GREEN): overlay chrome en SessionTable.js** - `77f75ef` (feat)

_Nota: STATE.md/ROADMAP.md NO modificados (worktree mode — el orchestrator los actualiza post-merge)._

## Files Created/Modified
- `src/cli/dashboard/App.js` - Imports de `fetchComments`/`fetchLogs`/`grepLogs`. 6 constantes `OVERLAY_*` literal-estables exportadas. Estado `overlayKind`/`scrollOffset`/`overlaySnapshot` + tipo de `mode` ensanchado a `'list'|'filter'|'overlay'`. Rama `mode==='overlay'` en el useInput (Esc/↑/↓/traga-resto). Handlers `c` y `l` con snapshot congelado. Props del overlay threadeadas a SessionTable.
- `src/cli/dashboard/SessionTable.js` - Función `renderOverlay` (header + body scrollable sliceado + footer; color SOLO de nombres ink). Early-return cuando `mode==='overlay' && overlaySnapshot`. Props `overlayKind`/`scrollOffset`/`overlaySnapshot` en la firma. Import de las constantes `OVERLAY_*` de App.js (mata drift code/test).
- `test/dashboard-overlay.test.js` - Suite nueva (9 tests) reusando el harness `makeFakeClock`/`injectProps`/`drain`/`okResponse` de dashboard-table.test.js. `fetchFn` enrutado por URL (`/status`→sesiones, `/comments/<id>`→comentarios, `/logs`→buffer). Casos: c abre comments, 404→not found, vacío→no comments yet, 500→error, Esc restaura cursor; l abre logs+label, no-match→empty, error→error; snapshot congelado. Cada render con `unmount()` en `finally` (cinturón anti-cuelgue).

## Decisions Made
- **Esc preserva el cursor sin estado extra**: nunca se toca `selectedTaskId` al abrir ni al cerrar el overlay; `resolveSelection` re-deriva la misma fila por identidad al volver a `mode:'list'`. D-06 gratis.
- **Snapshot como objeto frozen proyectado a strings**: el handler proyecta comentarios/logs a `lines: string[]` y congela `status` en el objeto; el render solo slicea y elige copy — cero re-fetch o re-cálculo bajo el poll.
- **renderOverlay early-return (no Overlay.js)**: menor diff, SessionTable sigue siendo el único punto de render y queda cubierto por el walker format-isolation sin ampliar su lista de archivos.

## Deviations from Plan

Ninguna desviación de comportamiento. El plan se ejecutó tal como está escrito (RED → GREEN Task 1, GREEN Task 2 sobre los mismos tests).

## Issues Encountered
- **Ciclo de import App.js ↔ SessionTable.js**: SessionTable importa las constantes `OVERLAY_*` de App.js, que a su vez importa SessionTable. Es seguro porque las constantes solo se consumen en runtime (dentro de `renderOverlay`, no en tiempo de carga del módulo) — verificado: la suite completa pasa 111/111 sin error de inicialización. Alternativa rechazada (mover las constantes a un tercer módulo) por añadir un archivo sin beneficio.

## Observaciones (fuera de scope, NO corregidas)
- **Falso positivo del acceptance criterion `grep -n "new RegExp\|picocolors" App.js`**: el criterio del plan exige que ese grep no devuelva nada, pero el HEADER de App.js (línea 52, escrito en Phase 36) contiene la cadena literal "picocolors" en un comentario que DOCUMENTA la invariante de color-isolation ("cero import del helper de color del CLI clásico / picocolors"). Es un comentario preexistente, load-bearing como documentación, y NO es código ni un import. El grep no es comment-aware (el SUMMARY del Plan 39-01 documentó el mismo patrón de falso positivo con `new RegExp`). El walker real `test/format-isolation.test.js` (que SÍ verifica imports de color de verdad) pasa verde 8/8. No se borra el comentario (Regla 3: cambios quirúrgicos — no tocar lo que no está roto). El intento de cero-picocolors en CÓDIGO sí se cumple: cero imports de color, todo via `<Text color>` de ink.

## Threat Surface Scan
- T-39-03 (info disclosure, buffer compartido): mitigado por disclosure honesta — `OVERLAY_LOGS_LABEL` en el header del overlay de logs (acceptance criterion verificado por test).
- T-39-04 (DoS de render): mitigado — snapshot congelado + body sliceado por `OVERLAY_VIEWPORT` (18 líneas), el poll no re-escribe el snapshot.
- Sin superficie de amenaza nueva fuera del `<threat_model>` del plan: el overlay es read-only, renderiza texto plano via `<Text>` de ink, no muta nada en el server, no añade dependencias.

## Next Phase Readiness
- TUI-15 y TUI-16 cerrados. SC#1/SC#2/SC#3 satisfechos por el Plan 02; SC#4 lo cubrió el Plan 39-01. Los tres overlays (status/tabla + comentarios + logs) están integrados en un único `App` con un solo useInput mode-gated.

## Self-Check: PASSED

- Archivos verificados: App.js, SessionTable.js, test/dashboard-overlay.test.js, 39-02-SUMMARY.md (todos FOUND).
- Commits verificados: 529717b, 5117438, 77f75ef (todos FOUND).
- Suite: `node --test test/dashboard-*.test.js` → 111 pass / 0 fail (incluye overlay 9/9, table 32/0 sin regresión, format-isolation 8/8).

---
*Phase: 39-paneles-auxiliares-comentarios-logs*
*Completed: 2026-06-02*
