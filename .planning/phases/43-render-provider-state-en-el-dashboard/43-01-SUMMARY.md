---
phase: 43-render-provider-state-en-el-dashboard
plan: 01
subsystem: ui
tags: [ink, react, dashboard, tui, provider-state, color-isolation]

# Dependency graph
requires:
  - phase: 40-provider-state-contrato-providers-enrichment
    provides: "GET /status enriquece cada fila con provider_state + provider_state_reason (null|'unsupported'|'fetch-failed')"
provides:
  - "taskCell(session) puro en format.js: deriva la celda task (eje provider) de los 3 reason-states sin color"
  - "rowCells(session).task con la forma { text, dim }"
  - "Columna dedicada 'task' en SessionTable.js entre status y age (header + celda con dimColor para degradados)"
affects: [43-02, provider-state-filter, dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Derivación pura de celda (format.js) testeable sin ink, espejo de statusLabel"
    - "Verbatim + truncate-end: cero tabla de mapeo, valor crudo del provider sobrevive renombrados"
    - "Distinción de 3 estados SIN color (glyphs —/? + dim), NO_COLOR-safe"

key-files:
  created: []
  modified:
    - src/cli/dashboard/format.js
    - src/cli/dashboard/SessionTable.js
    - test/dashboard-format.test.js
    - test/dashboard-table.test.js

key-decisions:
  - "taskCell deriva SOLO de provider_state + provider_state_reason; reason 'unsupported' → {—,dim}, 'fetch-failed' → {?,dim}, null → valor crudo verbatim (fallback — sin dim)"
  - "'unknown' (reason null) es ok-value verbatim, NO un glyph degradado (specifics CONTEXT.md)"
  - "Columna task width 12 entre status y age; valor ok en texto plano sin color propio (D-05), solo dim marca los degradados"
  - "unmount() en los renders de test nuevos evita interferencia de stdin con el test de navegación (fix flaky cross-test)"

patterns-established:
  - "taskCell: función pura React-free para la celda del eje provider, espejo de statusLabel (zombie)"
  - "Color-isolation mantenida: dim vía dimColor de ink, cero picocolors, cero ANSI"

requirements-completed: [PSTATE-05]

# Metrics
duration: ~18min
completed: 2026-06-08
---

# Phase 43 Plan 01: Render provider_state en el dashboard Summary

**Columna dedicada `task` en la tabla viva del dashboard ink que renderiza `provider_state` verbatim (eje provider) separado del `status` local, distinguiendo los 3 reason-states sin color: valor crudo / `—` dim (unsupported) / `?` dim (fetch-failed)**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-08
- **Completed:** 2026-06-08
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `taskCell(session)` puro en `format.js`: deriva la celda del eje provider de `provider_state` + `provider_state_reason`, distinguiendo los 3 reason-states SIN color (NO_COLOR-safe). `rowCells` extendido con la clave `task` `{ text, dim }`.
- Columna dedicada `task` renderizada en `SessionTable.js` entre `status` y `age` (D-01/D-02/D-03): header literal `task`, valor ok en texto plano, degradados `—`/`?` con `dimColor` de ink.
- Cierre de la parte visual de la cadena provider_state end-to-end de v0.10 (driver ROMAN-150): una sesión "In Review" en Plane ahora es visible en una columna propia.
- Vocabulario tratado como dato crudo (criterio 4): cero tabla de mapeo, un estado renombrado por el provider se muestra verbatim sin tocar código.

## Task Commits

Each task was committed atomically:

1. **Task 1: Derivación pura de la celda task (TDD)** - `ed0d701` (test RED) → `8b0c67e` (feat GREEN)
2. **Task 2: Render de la columna task en SessionTable** - `db6a960` (feat)

_Task 1 fue TDD: commit RED (test fallido) seguido de commit GREEN (implementación). No requirió refactor (implementación minimalista)._

## Files Created/Modified
- `src/cli/dashboard/format.js` - Añadido `taskCell(session)` puro (3 reason-states); `rowCells` extendido con la clave `task`; typedef `EnrichedSession` extendido con `provider_state`/`provider_state_reason`.
- `src/cli/dashboard/SessionTable.js` - `COLS.task` (width 12) entre `status` y `age`; cabecera `task`; celda de datos consumiendo `cells.task.text`/`cells.task.dim`.
- `test/dashboard-format.test.js` - 8 casos: 6 de `taskCell` (ok verbatim, 'unknown' verbatim, unsupported `—`, fetch-failed `?`, ausencia → fallback `—`, valor inventado verbatim) + 2 de `rowCells().task`.
- `test/dashboard-table.test.js` - FIXTURE extendido con campos provider; `FIXTURE_PSTATE` con los 3 reason-states; 3 casos de render (header entre status/age, valor verbatim, glyphs `—`/`?`).

## Decisions Made
- **taskCell deriva SOLO de los dos campos de Phase 40** — sin computar ni escribir nada (carril read-only). `reason 'unsupported'` → `{ text:'—', dim:true }`; `'fetch-failed'` → `{ text:'?', dim:true }`; reason null/ausente → valor crudo verbatim, fallback `'—'` sin dim si `provider_state` es null/undefined.
- **'unknown' es ok-value verbatim** (reason null), distinto de null+degradado — documentado inline (specifics CONTEXT.md).
- **Valor ok en texto plano sin color propio (D-05)** — solo `dim` marca los degradados; cero segunda paleta semántica (el color queda reservado al eje local del zombie).
- **Width 12 + truncate-end** (D-08) — cabe `in_progress`; el truncado de ink es la red de seguridad anti-DoS (T-43-03) si el provider emite un string largo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `unmount()` en los renders de test nuevos para evitar interferencia cross-test**
- **Found during:** Task 2 (render de la columna)
- **Issue:** Al añadir `FIXTURE_PSTATE` (3 sesiones) en un describe nuevo justo antes del describe de navegación de teclado, el test `TUI-08: navegación ↑/↓` empezó a fallar de forma determinista. Causa: ink-testing-library no desmonta los renders; el `useInput`/stdin del último render (`FIXTURE_PSTATE`) quedaba activo e interfería con el `stdin.write` del siguiente test. El test de navegación pasaba aislado (3/3) pero fallaba en suite.
- **Fix:** Añadir `unmount()` al final de los 3 tests nuevos del describe `PSTATE-05` (higiene: no dejar instancias de render con stdin activo colgando para el siguiente test).
- **Files modified:** `test/dashboard-table.test.js`
- **Verification:** `node --test test/dashboard-table.test.js` verde 3/3 ejecuciones consecutivas (36/36); suite dashboard completa 145/145.
- **Committed in:** `db6a960` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug en el harness de test)
**Impact on plan:** El fix es de higiene de test (no toca `src/`), necesario para que la suite sea determinista. Sin scope creep — el código de producción de Task 2 es exactamente el del plan.

## Issues Encountered
- **Grep gate literal de color-isolation:** el acceptance criterion `grep -v '^//' ... | grep -c picocolors == 0` da >0 porque hay menciones de la palabra `picocolors` en docstrings preexistentes (Phase 36/38/39) que documentan "cero picocolors". Mi diff NO añade ninguna mención nueva (verificado: `git diff | grep '^+' | grep -c picocolors == 0`) y el test autoritativo `test/format-isolation.test.js` (walker de imports reales, no grep ingenuo) pasa verde. El grep literal es un proxy imperfecto del invariante real ("no importar picocolors"), que se cumple.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- La columna `task` (render) está completa. El filtro `ps:` (PSTATE-06) queda para el plan 43-02 (toca `select.js`, no incluido en este plan).
- `taskCell`/`rowCells().task` exponen el dato derivado de forma pura; cualquier consumidor futuro (filtro, contadores) puede reusarlos sin tocar el render.

---
*Phase: 43-render-provider-state-en-el-dashboard*
*Completed: 2026-06-08*

## Self-Check: PASSED

Todos los archivos creados/modificados existen en disco; los 4 commits (test RED + feat GREEN x2 + docs) están en la historia.
