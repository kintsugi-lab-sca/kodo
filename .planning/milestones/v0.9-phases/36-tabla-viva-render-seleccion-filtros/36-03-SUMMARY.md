---
phase: 36-tabla-viva-render-seleccion-filtros
plan: 03
subsystem: ui
tags: [ink, react, tui, useInput, keyboard-nav, filter, dashboard]

# Dependency graph
requires:
  - phase: 36-02
    provides: "tabla viva (SessionTable) + pipeline sortSessions→applyFilter(parseFilter(''))→resolveSelection en App.js, con placeholder de query vacía"
  - phase: 36-01
    provides: "select.js puro (parseFilter/applyFilter/resolveSelection/countByStatus/sortSessions) + format.js (deriveRepo/statusColor/rowCells)"
provides:
  - "useInput mode-gated (list/filter) en App.js — enruta teclas por un flag mode"
  - "navegación ↑/↓ que mueve el cursor por identidad (selectedTaskId), clamp sin wrap (TUI-08/D-07)"
  - "filtro modal '/' con query EN VIVO que alimenta parseFilter/applyFilter cada render (TUI-12/D-13)"
  - "Esc modal cancela (limpia query) / Enter confirma / Backspace-vacío sale (D-15); cursor preservado (D-16)"
  - "Esc en modo lista deliberadamente ignorado, reservado Phase 38 (D-15)"
  - "línea de filtro '/ <query>▏' al pie + rama de estado vacío 'no sessions match' (D-12b)"
affects: [phase-37-attach-cmux, phase-38-overlays-comentarios-logs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "mode-gated useInput: un flag de estado (list|filter) enruta las teclas en un único useInput gateado por isRawModeSupported"
    - "query EN VIVO en el render pipeline: el estado query alimenta parseFilter/applyFilter cada render (re-filtra al teclear, sin Enter)"
    - "prevIndexRef (useRef) para el clamp posicional de D-06 sin provocar re-render"
    - "conducción de teclado en tests de render: stdin.write con códigos crudos (arrow \\x1b[A/B, Esc \\x1b, Enter \\r) + drain() para absorber el flush diferido del Esc"

key-files:
  created: []
  modified:
    - src/cli/dashboard/App.js
    - src/cli/dashboard/SessionTable.js
    - src/cli/dashboard/select.js
    - test/dashboard-table.test.js

key-decisions:
  - "El cursor `▏` del prompt de filtro ('/ <query>▏') se usa como marcador inequívoco de la línea de filtro modal en los tests, distinguiéndola del '/ filter' del footer de hints"
  - "La línea de filtro se anexa al pie en TODAS las ramas de render de SessionTable (incluidos los estados vacíos/degradados) para que el operador siga viendo su query"
  - "prevIndexRef se actualiza en el useEffect de write-back de selección (a sel.index) para que el clamp de D-06 use el índice posicional previo real"

patterns-established:
  - "mode-gated useInput: routing de teclado por flag de estado en un solo handler gateado"
  - "live-query render pipeline: el filtro se re-aplica en cada render desde el estado query"

requirements-completed: [TUI-08, TUI-12]

# Metrics
duration: 30min
completed: 2026-05-27
---

# Phase 36 Plan 03: Navegación + filtro modal (TUI-08/TUI-12) Summary

**Teclado mode-gated sobre la tabla viva: ↑/↓ mueven el cursor rastreado por task_id (clamp sin wrap) y `/` abre un filtro modal que re-filtra en vivo, con Esc cancelar / Enter confirmar y el cursor preservado por identidad.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-27T21:55Z (aprox.)
- **Completed:** 2026-05-27T22:25Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `useInput` mode-gated en `App.js`: un flag `mode: 'list'|'filter'` enruta las teclas en un único handler gateado por `isRawModeSupported`, conservando el `q`→exit() de Phase 34.
- Navegación ↑/↓ (TUI-08/D-07): mueve el índice DERIVADO y re-fija `selectedTaskId` al row resultante; clamp en los extremos, sin wrap-around. El cursor sigue a la sesión por identidad.
- Filtro modal `/` (TUI-12/D-13): la query EN VIVO reemplaza el placeholder `''` de Plan 02 y alimenta `parseFilter`/`applyFilter` en cada render — teclear re-filtra al instante (`r:`/`s:` AND + substring global, case-insensitive).
- Resolución del Esc modal (D-15): en modo filtro, Esc cancela (limpia query) / Enter confirma (mantiene el filtro) / Backspace en query vacía sale; en modo lista, Esc es un no-op reservado para Phase 38.
- `SessionTable.js`: línea de filtro `/ <query>▏` al pie cuando `mode==='filter'` + la rama de estado vacío `no sessions match` (D-12b), distinta de `no active sessions` (D-12a).
- Cursor preservado al filtrar/limpiar (D-16): como el cursor se rastrea por `selectedTaskId`, al cancelar el filtro la lista completa vuelve y el cursor sigue en la misma sesión.

## Task Commits

Each task was committed atomically (TDD: RED → GREEN):

1. **Task 1: Wave 0 RED interaction tests (nav + modal filter)** - `ab576fb` (test)
2. **Task 2: Mode-gated useInput + live filter + filter line / no-match** - `347a927` (feat)

_No fue necesario un commit refactor: la implementación quedó minimal y limpia tras GREEN._

## Files Created/Modified
- `src/cli/dashboard/App.js` - useInput mode-gated (list/filter); estado `mode`/`query` + `prevIndexRef`; query EN VIVO en el pipeline (`parseFilter(query)`); ↑/↓ clamp re-fijando selectedTaskId; `/` abre filtro; Esc modal cancel + Esc lista no-op; pasa `mode`/`query`/`hasQuery` a SessionTable.
- `src/cli/dashboard/SessionTable.js` - línea de filtro modal `/ <query>▏` al pie (todas las ramas); props `mode`/`query`; rama `no sessions match` ya soportada vía `hasQuery`.
- `src/cli/dashboard/select.js` - solo comentarios: se eliminó la cadena literal `new RegExp` de la documentación para satisfacer el gate de seguridad `grep -REn "new RegExp"` de este plan (la lógica de substring-only de Plan 01 no cambió).
- `test/dashboard-table.test.js` - dos describe blocks nuevos (TUI-08 nav clamp + TUI-12 filtro modal/live/Esc/Enter/no-match/Esc-lista-ignorado), conducidos con `stdin.write` de códigos crudos + `drain()`.

## Decisions Made
- **Cursor `▏` como marcador de la línea de filtro:** el prompt modal lleva el cursor `▏` (UI-SPEC:191), usado en los tests como marcador inequívoco de que el input de filtro tiene el foco — evita ambigüedad con el `/ filter` del footer de hints.
- **Línea de filtro al pie en TODAS las ramas:** SessionTable anexa la línea de filtro también en los estados vacíos/degradados, no solo cuando hay filas, para que el operador siga viendo su query mientras teclea aunque oculte todo.
- **prevIndexRef actualizado en el useEffect de write-back:** el índice posicional previo se memoriza tras cada render (a `sel.index`) para que el clamp de D-06 caiga al vecino correcto cuando la fila seleccionada desaparece.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Eliminada la cadena literal `new RegExp` de comentarios para satisfacer el gate de seguridad**
- **Found during:** Task 2 (verificación de criterios de aceptación)
- **Issue:** El criterio de aceptación del plan exige que `grep -REn "new RegExp" src/cli/dashboard/` no devuelva nada (mitigación T-36-01, anti-ReDoS). Los comentarios de `select.js` (Plan 01) y los nuevos comentarios de `App.js` contenían la frase literal `new RegExp` para DOCUMENTAR que el filtro NO la usa, lo que disparaba un falso positivo del grep.
- **Fix:** Reformulados los comentarios a "jamás compila un patrón regex desde la query" / "esta query nunca se compila a un patrón regex", preservando el significado sin la cadena literal. Cero cambios de lógica.
- **Files modified:** src/cli/dashboard/App.js, src/cli/dashboard/select.js
- **Verification:** `grep -REn "new RegExp" src/cli/dashboard/` ahora no devuelve nada; suite completa verde.
- **Committed in:** 347a927 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** El ajuste es solo de comentarios para alinear con el gate de seguridad literal del plan (T-36-01). Sin scope creep, sin cambio de comportamiento. La invariante de matching substring-only ya estaba garantizada por `applyFilter` (Plan 01, String.includes).

## Issues Encountered
- **node_modules ausente en el worktree:** el worktree spawneado no comparte `node_modules` del repo principal. Resuelto con un symlink (`ln -s` al `node_modules` del repo principal); el symlink queda untracked (`.gitignore` ya cubre `node_modules/`) y nunca se commiteó.
- **Flush diferido del Esc solitario:** ink emite el Escape solitario (`\x1b`) vía un `setImmediate` (input-parser pending-escape), no de forma síncrona. El `drain()` del harness (doble `setImmediate`) ya lo absorbe, así que basta `await drain()` tras cada `stdin.write` — no hizo falta tocar el harness.

## Threat Flags

Ninguna superficie nueva fuera del threat model. La única entrada mutable (query del operador) se mantiene como substring puro vía `String.includes` (Plan 01), nunca compila un patrón regex (T-36-01 mitigado, verificado por el gate `grep -REn "new RegExp"`). El Esc se maneja solo en modo filtro (T-36-04, verificado por el dual `key.escape` grep + el test de Esc-en-lista-ignorado). Cero dependencias nuevas (T-36-SC).

## TDD Gate Compliance
- RED gate: `ab576fb` (test) — tests de interacción fallando contra el App.js de Plan 02 (sin mode/query).
- GREEN gate: `347a927` (feat) — implementación que hace pasar los tests.
- REFACTOR gate: no necesario (implementación minimal y limpia tras GREEN).

## Self-Check: PASSED
- Archivos verificados: src/cli/dashboard/App.js, src/cli/dashboard/SessionTable.js, src/cli/dashboard/select.js, test/dashboard-table.test.js — todos FOUND.
- Commits verificados: ab576fb (RED), 347a927 (GREEN) — ambos FOUND.

## Verification Results
- `node --test test/dashboard-table.test.js` — verde (14/14: 7 Plan 02 + 7 Plan 03).
- `node --test test/dashboard-select.test.js test/dashboard-filter.test.js` — verde (cobertura pura de Plan 01 intacta).
- `node --test test/format-isolation.test.js` — verde (color-isolation: cero picocolors bajo src/cli/dashboard/).
- `npm test` — suite completa verde (955 pass, 0 fail, 1 skipped pre-existente).
- `grep -REn "new RegExp" src/cli/dashboard/` — sin coincidencias (gate de seguridad T-36-01).
- `key.escape` aparece DOS veces en App.js: cancel en filter mode + no-op comment reservando Phase 38 en list mode.

## Next Phase Readiness
- La superficie interactiva de la fase 36 está completa: render (Plan 02) + navegación + filtro (Plan 03). Las dos invariantes load-bearing (TUI-08 selección por identidad, TUI-12 cursor preservado) tienen cobertura PURA (Plan 01) y de render (Plan 03).
- **Phase 37 (attach con `Enter`):** la tecla `Enter` NO está manejada en modo lista (solo `q`/`/`/`↑`/`↓`); queda libre para el handoff TTY a cmux. El `workspace_ref` de la fila seleccionada está disponible.
- **Phase 38 (overlays `c`/`l`):** debe honrar el límite modal de D-15 — `Esc` solo abre/cierra overlays cuando NO hay input de filtro con foco. En modo lista el Esc está reservado y hoy es un no-op explícito.

---
*Phase: 36-tabla-viva-render-seleccion-filtros*
*Completed: 2026-05-27*
