---
phase: 36-tabla-viva-render-seleccion-filtros
plan: 02
subsystem: cli-dashboard
tags: [tui, ink, render, table, selection, color-isolation]
requires:
  - "src/cli/dashboard/select.js (sortSessions/applyFilter/parseFilter/resolveSelection/countByStatus) — Plan 36-01"
  - "src/cli/dashboard/format.js (rowCells/statusColor/deriveRepo) — Plan 36-01"
  - "src/cli/dashboard/App.js connection state (connected/lastGoodCount/lastGoodAt/lastAttemptAt) — Phase 35"
provides:
  - "src/cli/dashboard/SessionTable.js — presentational ink table (header live indicator + per-status counters, fixed-width columns, semantic status color, selected-row treatment, dual empty-state precedence)"
  - "src/cli/dashboard/App.js — table-rendering root: stores sessions + selectedTaskId, runs sort→filter→resolveSelection pipeline, initial-selection write-back"
affects:
  - "Plan 36-03 (↑/↓ navigation + / filter live query) consumes the pipeline shape and SessionTable hasQuery prop established here"
tech-stack:
  added: []
  patterns:
    - "React.createElement plano (no JSX, no build step) — Phase 34/35 pattern"
    - "Color-isolation: color only via ink <Text color>/dimColor/inverse; zero picocolors, zero src/cli/format.js"
    - "Selección por identidad (selectedTaskId), índice derivado por render via resolveSelection"
    - "Hermetic ink-testing-library render tests with injected fetchFn + fake clock"
key-files:
  created:
    - "src/cli/dashboard/SessionTable.js"
    - "test/dashboard-table.test.js"
  modified:
    - "src/cli/dashboard/App.js"
    - "test/dashboard-status-line.test.js"
decisions:
  - "El contador `N sessions` del live (Phase 35) se reemplaza por contadores por estado (D-11); el contador del estado stale (`⚠ server caído  N sessions … retrying…`) se conserva intacto en LiveIndicator."
  - "La query del filtro se pasa como '' en este plan (Plan 03 cablea la query en vivo); el pipeline ya tiene su FORMA final (sort→filter→resolveSelection) para minimizar el delta de 36-03."
  - "SessionTable expone `hasQuery` (default false) para distinguir `no sessions match` (Plan 03) de `no active sessions`, sin reabrir el componente en 36-03."
metrics:
  duration: "7m"
  completed: "2026-05-27"
  tasks: 2
  files: 4
---

# Phase 36 Plan 02: Tabla viva — render + selección + filtros (render) Summary

Tabla viva columnar del dashboard `kodo dashboard` con orden estable DESC, color semántico por estado + marca `(zombie)`, header con indicador live reusado de Phase 35 + contadores por estado (zombie aparte), selección inicial por identidad con gutter `›`, y doble estado vacío con precedencia degradada — renderizada con ink puro (`<Box>`/`<Text>`) y color-isolation preservada.

## What Was Built

- **`src/cli/dashboard/SessionTable.js` (NEW):** componente presentacional ink. Renderiza (1) header con `LiveIndicator` (port EXACTO de las tres ramas live/stale/waiting de App.js Phase 35 — D-10) + contadores compactos por estado (`countsLabel`, zombie aparte, counts en cero omitidos — D-11); (2) precedencia de estados vacíos (D-12: waiting/stale gana siempre → `no active sessions` → `no sessions match` con query, Plan 03); (3) cabecera de columnas `dimColor` con anchos fijos `{ gutter:2, task_ref:10, repo:18, phasemode:11, status:18, age:7 }`; (4) filas de datos con gutter `› ` de selección (redundancia NO_COLOR), celdas en `<Box width>` fijos, truncado `…` (`wrap='truncate-end'`) salvo en `status` (la marca `(zombie)` es load-bearing, NO se trunca — D-09), color semántico SOLO en la celda `status` vía `statusColor` (D-08), e `inverse` en la fila seleccionada. React key = `task_id` (NUNCA índice — Pitfall 7).
- **`src/cli/dashboard/App.js` (MODIFY):** añade estado `sessions` (keep-last-good: se setea solo en `onResult` ok, intacto en !ok) y `selectedTaskId` (cursor por identidad, D-05). Corre el pipeline OBLIGATORIO en orden fijo cada render: `sortSessions(sessions)` → `applyFilter(sorted, parseFilter(''), deriveRepo)` → `resolveSelection(filtered, selectedTaskId, 0)`, más `countByStatus(filtered)`. Write-back de la selección inicial vía `useEffect` keyed en `sel.taskId` (D-07: el cursor nunca apunta a un id ausente). Reusa el connection state de Phase 35 (no lo reinventa) pasándolo a `SessionTable`. Footer actualizado a `↑↓ move · / filter · q quit`.
- **`test/dashboard-table.test.js` (NEW):** 7 tests de render herméticos (ink-testing-library + fetchFn inyectado + fake clock, harness reusado verbatim de dashboard-status-line.test.js). Cubre columnas (TUI-07), marca zombie (TUI-10), contadores con zombie aparte + `● live` (TUI-11), orden DESC (TUI-09), gutter de selección inicial (D-07), y los dos estados vacíos con precedencia (D-12). Fixture D-03 de dos sesiones (GSD running+alive + non-GSD zombie running+!alive).

## How to Verify

- `node --test test/dashboard-table.test.js` → 7/7 green (columnas, orden, zombie, contadores, vacíos, selección inicial).
- `node --test test/format-isolation.test.js` → 8/8 green (el walker confirma cero picocolors bajo `src/cli/dashboard/**` con los archivos nuevos).
- `npm test` → 949 tests, 948 pass, 1 skipped (pre-existente), 0 fail.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tests de Phase 35 (dashboard-status-line.test.js) asertaban el contador `N sessions` del estado live, que este plan reemplaza por contadores por estado**
- **Found during:** Task 2 (full-suite gate `npm test`)
- **Issue:** El objetivo del plan es REEMPLAZAR el cuerpo de la status line de Phase 35 por la tabla. Tres tests de `dashboard-status-line.test.js` asertaban literales `3 sessions` / `5 sessions` / `2 sessions` en el estado **live** — copy que la tabla elimina (el contador del live se movió a contadores por estado D-11; el del estado **stale** se conserva). Sin migrar, `npm test` quedaba en rojo (3 fallos), incumpliendo el success-criterion del plan.
- **Fix:** Migradas las tres asertivas de **live** a `● live` + presencia de la tabla (`task_ref`), preservando intactas TODAS las asertivas de resiliencia (keep-last-good, estado stale con `N sessions … retrying`, no-crash ante JSON corrupto) — las semánticas bajo prueba (TUI-06) siguen verificadas porque `LiveIndicator` porta las tres ramas exactas. Además se endureció el `drain()` del harness a doble `setImmediate` para absorber el re-render del nuevo write-back de selección (`useEffect`, D-07) de forma determinista.
- **Files modified:** test/dashboard-status-line.test.js
- **Commit:** 65e3c0f

**2. [Rule 3 - Blocking] Flakiness de profundidad de microtasks en los render tests por el write-back de selección**
- **Found during:** Task 2 (GREEN run, fallos intermitentes mostrando `waiting for server`)
- **Issue:** El `useEffect` de write-back de la selección inicial (D-07) agenda un segundo render asíncrono tras el `onResult` del kick-off. Un solo `setImmediate` de `drain()` capturaba el frame de forma no determinista entre los dos renders en el proceso compartido del runner (verificado: el render es correcto con dos drains en aislamiento).
- **Fix:** `drain()` doble `setImmediate` en `test/dashboard-table.test.js` (y en `dashboard-status-line.test.js`). Es un fix de robustez del harness — no debilita ninguna asertiva de comportamiento.
- **Files modified:** test/dashboard-table.test.js, test/dashboard-status-line.test.js
- **Commit:** 65e3c0f

## TDD Gate Compliance

- RED gate: `test(36-02): add Wave 0 RED render tests` (497e485) — 7 tests, 6 RED contra App.js Phase 35, 1 pass (el caso `waiting for server` que Phase 35 ya preserva). Exit non-zero confirmado.
- GREEN gate: `feat(36-02): live session table render` (65e3c0f) — 7/7 green tras implementar App.js + SessionTable.js.
- REFACTOR: no necesario (código mínimo y limpio).

## Self-Check: PASSED
