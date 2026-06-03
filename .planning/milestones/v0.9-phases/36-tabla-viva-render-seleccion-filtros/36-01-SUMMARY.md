---
phase: 36-tabla-viva-render-seleccion-filtros
plan: 01
subsystem: ui
tags: [ink, react, tui, dashboard, selection, filter, color-isolation, tdd]

# Dependency graph
requires:
  - phase: 35-datos-cliente-http-polling
    provides: "usePoll + fetchStatus fluyendo en App.js; payload /status enriquecido con alive/elapsed_min; patrón pure+DI y color-isolation"
provides:
  - "src/cli/dashboard/select.js — derive puro del cursor/orden/filtro: sortSessions, resolveSelection, parseFilter, applyFilter, countByStatus"
  - "src/cli/dashboard/format.js — derive puro de presentación: deriveRepo, formatAge, phaseMode, statusColor, statusLabel, rowCells"
  - "Cobertura PURA de las dos invariantes load-bearing: selección sobrevive al rebuild del array (TUI-08) y cursor preservado al filtrar/limpiar (TUI-12)"
affects: [36-02 render de la tabla, 36-03, 37-attach-cmux, 38-overlays-comentarios-logs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Derive puro React-free/ink-free testeable sin host React (extiende el pure+DI de usePoll/client de Phase 35)"
    - "Selección por identidad task_id (nunca índice) re-derivada cada render — clase ROMAN-132 evitada en la UI"
    - "Decisión de color como dato (nombre de color ink, nunca ANSI) — ink convierte vía su propio chalk, no picocolors (color-isolation D-12)"
    - "Filtro substring-only via String.includes — nunca new RegExp (anti-ReDoS de query del operador)"

key-files:
  created:
    - src/cli/dashboard/select.js
    - src/cli/dashboard/format.js
    - test/dashboard-select.test.js
    - test/dashboard-format.test.js
    - test/dashboard-filter.test.js
  modified: []

key-decisions:
  - "Sort DESC por started_at (newest primero) con tiebreak lexicográfico por task_id — UI-SPEC línea 157-160, fijo y determinista"
  - "Prefijo de filtro r:/s: reconocido case-insensitive (R:KODO == r:kodo); el valor se baja a minúsculas (D-14, contrato del plan línea 129)"
  - "statusColor devuelve {color:'red'} solo para el zombie; error usa magenta para no confundir proceso muerto con tarea con error (D-08)"
  - "Las dos invariantes load-bearing (TUI-08, TUI-12) se prueban como funciones PURAS de resolveSelection, no por frame-diffing de ink (ink-testing-library@4 carece de waitUntilExit)"

patterns-established:
  - "Pure derive layer: toda la lógica de orden/selección/filtro/color vive en funciones puras; el render (Plan 02) solo las consume"
  - "applyFilter recibe deriveRepo por DI — el filtro reusa exactamente el mismo mapeo de repo que la columna (sin duplicar la derivación)"

requirements-completed: [TUI-07, TUI-08, TUI-09, TUI-10, TUI-11, TUI-12]

# Metrics
duration: ~14min
completed: 2026-05-28
---

# Phase 36 Plan 01: Capa de derive pura para la tabla viva Summary

**Capa de presentación pura (React-free, ink-free) de la tabla viva del dashboard: orden DESC estable, selección rastreada por task_id con clamp, mapeo de campos D-03, color semántico como dato y filtro substring AND anti-ReDoS — con cobertura PURA de las dos invariantes load-bearing de la fase.**

## Performance

- **Duration:** ~14 min
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files created:** 5 (2 source, 3 test)
- **Files modified:** 0

## Accomplishments

- `src/cli/dashboard/select.js` con los cinco helpers puros: `sortSessions` (copia, DESC, tiebreak task_id), `resolveSelection` (identidad + clamp + lista vacía), `parseFilter` (prefijos r:/s: case-insensitive), `applyFilter` (AND vía `String.includes`, nunca regex), `countByStatus` (zombie contado aparte).
- `src/cli/dashboard/format.js` con los seis helpers de presentación: `deriveRepo`, `formatAge`, `phaseMode`, `statusColor` (nombres de color ink, nunca ANSI), `statusLabel` (marca `(zombie)`), `rowCells`.
- Cobertura PURA y verde de las dos invariantes load-bearing: la selección sigue a `task_id` al reordenar y clampa al vecino al desaparecer la fila (TUI-08/D-06); el cursor se preserva al aplicar y luego limpiar el filtro (TUI-12/D-16).
- Color-isolation preservada: cero `picocolors`/`cli/format`/`new RegExp` en código; el walker de `test/format-isolation.test.js` sigue verde.

## Task Commits

Cada tarea se committeó atómicamente (ciclo TDD):

1. **Task 1: Wave 0 RED tests del derive layer (TUI-07..12)** - `f8e1608` (test)
2. **Task 2: Implementar select.js + format.js hasta GREEN** - `bc8d154` (feat)

_Sin commit de REFACTOR: el código quedó mínimo y limpio en el paso GREEN._

## Files Created/Modified

- `src/cli/dashboard/select.js` - Derive puro de orden/selección/filtro/contadores (sortSessions, resolveSelection, parseFilter, applyFilter, countByStatus).
- `src/cli/dashboard/format.js` - Derive puro de presentación + decisión de color (deriveRepo, formatAge, phaseMode, statusColor, statusLabel, rowCells).
- `test/dashboard-select.test.js` - Tests puros de las dos invariantes load-bearing + sortSessions + countByStatus.
- `test/dashboard-format.test.js` - Tests puros del mapeo D-03 + color semántico (sin bytes ANSI).
- `test/dashboard-filter.test.js` - Tests puros de parseFilter/applyFilter incl. el caso anti-ReDoS literal `.*`.

## Decisions Made

- **Sort DESC** por `started_at` con tiebreak `task_id` (UI-SPEC línea 157-160; el plan especifica `tb - ta`). Fijo y determinista entre polls.
- **Prefijo de filtro case-insensitive:** `R:`/`S:` se reconocen igual que `r:`/`s:`; el valor se baja a minúsculas. Esto satisface el contrato del plan (línea 129, "R:KODO lowercased to 'kodo'") — ver Desviaciones.
- Las invariantes load-bearing se prueban como **funciones puras** de `resolveSelection`, no por frame-diffing, por la limitación de `ink-testing-library@4`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] parseFilter reconoce los prefijos r:/s: de forma case-insensitive**
- **Found during:** Task 2 (implementación GREEN)
- **Issue:** El test `case folding: R:KODO baja a kodo` (contrato del plan, línea 129) falló: mi `parseFilter` solo detectaba el prefijo en minúsculas (`w.startsWith('r:')`), de modo que `R:KODO` caía al texto global en vez de fijar `repo`.
- **Fix:** Se detecta el prefijo sobre la palabra en minúsculas (`w.toLowerCase().startsWith('r:'/'s:')`) y se baja el valor a minúsculas. El texto global sigue su propio lowercasing al final.
- **Files modified:** src/cli/dashboard/select.js
- **Verification:** El test de case folding y los 34 tests del Wave 0 pasan; suite completa verde.
- **Committed in:** bc8d154 (commit del Task 2 GREEN)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** El fix era necesario para cumplir el contrato de case-insensitivity de D-14 declarado en el propio plan. Sin scope creep.

## Issues Encountered

- Las referencias del prompt a `36-PATTERNS.md` no existían en el directorio de la fase (solo CONTEXT/RESEARCH/UI-SPEC/VALIDATION). Se obtuvieron las firmas de referencia y los sketches de `36-RESEARCH.md` (líneas 260-378, 590-616) y `36-UI-SPEC.md` (anchos/paleta/sort DESC), que contienen exactamente las implementaciones de referencia. Sin impacto en la ejecución.

## Threat Model Compliance

- **T-36-01 (Tampering/DoS, mitigate):** `applyFilter`/`parseFilter` usan exclusivamente `String.includes` — JAMÁS `new RegExp`. Verificado por el test literal `.*` (no lanza, matchea como substring) y por el grep de aceptación (cero `new RegExp` en código). Mitigación aplicada.
- **T-36-SC (npm installs, mitigate):** cero instalaciones de paquetes en este plan. Solo `node:path` (stdlib).

## TDD Gate Compliance

- RED gate: `f8e1608` (`test(36-01): add Wave 0 RED tests`) — suite roja solo por ERR_MODULE_NOT_FOUND (los módulos fuente no existían aún).
- GREEN gate: `bc8d154` (`feat(36-01): pure derive layer`) — 34 tests verdes.
- REFACTOR gate: no necesario (código mínimo en GREEN).

## Next Phase Readiness

- La capa de derive está lista para que Plan 02 (render de la tabla con ink) la consuma: `rowCells` proyecta cada sesión a celdas, `statusColor` da el color para `<Text color>`, `sortSessions`/`applyFilter`/`resolveSelection`/`countByStatus` alimentan el orden, filtro, cursor y header.
- Sin bloqueos. Color-isolation y la suite completa (941 pass / 1 skip preexistente / 0 fail) verdes.

## Self-Check: PASSED

- Archivos verificados en disco: select.js, format.js, los 3 test files y 36-01-SUMMARY.md (FOUND).
- Commits verificados en git: f8e1608 (RED), bc8d154 (GREEN) (FOUND).

---
*Phase: 36-tabla-viva-render-seleccion-filtros*
*Completed: 2026-05-28*
