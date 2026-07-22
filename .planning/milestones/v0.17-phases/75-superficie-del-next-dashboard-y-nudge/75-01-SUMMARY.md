---
phase: 75-superficie-del-next-dashboard-y-nudge
plan: 01
subsystem: ui
tags: [ink, dashboard, tui, react, state-json, reader-leaf, tdd]

# Dependency graph
requires:
  - phase: 74
    provides: "state.tasks[task_id] = { plan_path, next, updated_at } (upsertTaskHandoff) — el NEXT: por tarea persistido en ~/.kodo/state.json"
  - phase: 50
    provides: "patrón de columna condicional (prog) — deriveAnyProgress + header/celda condicionales al flag estructural"
  - phase: 44
    provides: "readLightPlan — molde del reader leaf síncrono never-throws con DI de HOME"
provides:
  - "readTasks(deps) — reader leaf never-throws del bloque tasks de state.json (nuevo módulo tasks.js)"
  - "deriveAnyNext(rows) — flag estructural de presencia de NEXT: (select.js)"
  - "nextCell(session) — proyección de la celda next sin placeholder (format.js)"
  - "Columna condicional `next` al final de la tabla del dashboard, mergeada por task_id y saneada"
affects: [dashboard, next-surface, nudge, LIVE-06, LIVE-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reader leaf never-throws con DI de HOME (kodoDir/homedirFn/readFileFn), importa SOLO builtins node:* — jamás loadState/config.js (no arrastra el migrador que escribe .bak)"
    - "Columna condicional al flag estructural derivado del set SIN filtrar (anyNext sobre enriched, no filtered) — la columna no parpadea bajo query /"
    - "Saneo del contenido LLM (stripControlChars) en el punto de proyección al render, ANTES de la celda"
    - "readTasksFn inyectable en App (default = readTasks) para aislar el HOME real en tests, coherente con la DI de fetchFn/loadConfigFn"

key-files:
  created:
    - "src/cli/dashboard/tasks.js — reader leaf readTasks(deps)"
    - "test/dashboard-tasks.test.js — cubre readTasks (Wave 0)"
  modified:
    - "src/cli/dashboard/select.js — deriveAnyNext exportada"
    - "src/cli/dashboard/format.js — nextCell exportada + clave next en rowCells"
    - "src/cli/dashboard/App.js — enrich row.next + anyNext + prop a SessionTable + readTasksFn inyectable"
    - "src/cli/dashboard/SessionTable.js — COLS.next + header y celda condicionales al final"
    - "test/dashboard-select.test.js, test/dashboard-format.test.js, test/dashboard-table.test.js — casos nuevos"

key-decisions:
  - "El NEXT: viaja en state.json que la TUI ya lee por tick (piggyback usePoll) — cero endpoint nuevo en src/server.js, cero watcher, cero loop nuevo (SC1)"
  - "readTasks importa SOLO builtins y nunca loadState: el reader es lectura pura never-throws, no dispara el migrador que escribe .bak en cada tick (RESEARCH Pitfall 1)"
  - "anyNext se computa sobre enriched (set SIN filtrar), NO sobre filtered — la columna no parpadea al teclear una query / (Pitfall 4)"
  - "readTasksFn se hizo inyectable en App (default readTasks) para tests deterministas que aíslan el ~/.kodo real (deviación Rule 3 — testabilidad)"

patterns-established:
  - "Reader leaf de state.json never-throws con DI de HOME, molde literal de readLightPlan"
  - "Columna condicional next al final de la tabla, espejo de la columna prog (Phase 50)"

requirements-completed: [LIVE-05]

coverage:
  - id: D1
    description: "readTasks lee state.tasks never-throws con DI de HOME; ENOENT/JSON corrupto/sin-tasks/tasks null → {}; importa solo builtins, nunca escribe"
    requirement: "LIVE-05"
    verification:
      - kind: unit
        ref: "test/dashboard-tasks.test.js"
        status: pass
    human_judgment: false
  - id: D2
    description: "deriveAnyNext (flag estructural sobre set sin filtrar) y nextCell (celda vacía '' sin placeholder), rowCells expone next como última clave tras age"
    requirement: "LIVE-05"
    verification:
      - kind: unit
        ref: "test/dashboard-select.test.js, test/dashboard-format.test.js"
        status: pass
    human_judgment: false
  - id: D3
    description: "Enrich por tick en App.js mergea next por task_id y lo sanea (stripControlChars); columna next condicional al final de SessionTable, truncada al ancho con ellipsis nativo"
    requirement: "LIVE-05"
    verification:
      - kind: integration
        ref: "test/dashboard-table.test.js (columna presente/ausente, merge por task_id, saneo OSC-52, truncado)"
        status: pass
      - kind: unit
        ref: "test/format-isolation.test.js (color-isolation intacta)"
        status: pass
    human_judgment: false
  - id: D4
    description: "El operador ve el NEXT: por tarea en la lista del dashboard, degradando limpio (celda vacía, cero ruido, TUI never-throws) cuando falta el dato"
    requirement: "LIVE-05"
    verification: []
    human_judgment: true
    rationale: "Verificación visual/funcional en el dashboard real (la columna aparece con dato vivo de una fase en curso y degrada sin ruido) requiere ojo humano — cubierto por UAT de fase."

# Metrics
duration: 10min
completed: 2026-07-17
status: complete
---

# Phase 75 Plan 01: Superficie del NEXT: en el dashboard Summary

**Columna condicional `next` en la tabla del dashboard que lee el `state.tasks[task_id].next` de `~/.kodo/state.json` por tick (piggyback), mergea por task_id, sanea el contenido LLM y degrada a celda vacía — sin abrir N planes ni endpoint nuevo.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-17T10:21:29Z
- **Completed:** 2026-07-17T10:31:24Z
- **Tasks:** 3
- **Files modified:** 8 (2 creados, 6 modificados)

## Accomplishments
- `readTasks` — reader leaf never-throws de `state.tasks` con DI de HOME, importa solo builtins y nunca dispara el migrador que escribe `.bak` (Pitfall 1).
- `deriveAnyNext` + `nextCell` — flag estructural y proyección de celda puras, React-free; celda vacía `''` sin placeholder (SC5).
- Columna `next` condicional al final de la tabla: enrich por tick mergeado por task_id, contenido LLM saneado con `stripControlChars` (T-75-01), truncado al ancho con ellipsis nativo (D-04).
- Cero endpoint nuevo en `src/server.js`, cero dependencia npm nueva (SC1) — verificado con `git diff --stat` vacío.

## Task Commits

Cada tarea se comiteó atómicamente (Tasks 1 y 2 en ciclo TDD RED→GREEN):

1. **Task 1 (RED): test readTasks** - `accffcb` (test)
2. **Task 1 (GREEN): readTasks reader leaf** - `d3c7c2d` (feat)
3. **Task 2 (RED): tests deriveAnyNext + nextCell** - `7e8b719` (test)
4. **Task 2 (GREEN): deriveAnyNext + nextCell** - `e136a6c` (feat)
5. **Task 3: enrich App.js + columna condicional SessionTable** - `6fa81f7` (feat)

_Task 3 no fue TDD estricto (type="auto" sin tdd), pero incluyó tests de render/integración en el mismo commit._

## Files Created/Modified
- `src/cli/dashboard/tasks.js` (nuevo) - reader leaf `readTasks(deps)` never-throws.
- `test/dashboard-tasks.test.js` (nuevo) - 7 casos de readTasks con DI de HOME.
- `src/cli/dashboard/select.js` - `deriveAnyNext(rows)` exportada.
- `src/cli/dashboard/format.js` - `nextCell(session)` exportada + clave `next` en `rowCells` (última, tras age).
- `src/cli/dashboard/App.js` - enrich `row.next` (merge por task_id + saneo), `anyNext`, prop a SessionTable, `readTasksFn` inyectable.
- `src/cli/dashboard/SessionTable.js` - `COLS.next` + header y celda condicionales al final.
- `test/dashboard-select.test.js`, `test/dashboard-format.test.js`, `test/dashboard-table.test.js` - casos nuevos.

## Decisions Made
- **readTasksFn inyectable en App:** el plan especificaba `const tasks = readTasks({})`, que lee el `~/.kodo/state.json` real del operador. Para tests deterministas y aislados del HOME (evita flakiness si el state.json real tuviera task_ids colisionantes), se añadió un prop `readTasksFn = readTasks` con default idéntico al comportamiento de producción. Coherente con la DI global de App (fetchFn, loadConfigFn, etc.). Ver Deviations.
- El resto se ejecutó exactamente como el plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] readTasksFn inyectable en App para testabilidad**
- **Found during:** Task 3 (enrich por tick en App.js + tests)
- **Issue:** El plan indicaba `const tasks = readTasks({})`, lectura directa del `~/.kodo/state.json` real. Los tests de merge por task_id y de saneo (casos c/d del plan) necesitan datos deterministas; leer el HOME real los volvería no-deterministas y frágiles (posible colisión con task_ids reales del operador).
- **Fix:** Se añadió el prop `readTasksFn = readTasks` (default = comportamiento de producción exacto) y se cambió la llamada a `readTasksFn({})`. Idéntico patrón DI al resto de readers/handlers inyectables de App.
- **Files modified:** src/cli/dashboard/App.js
- **Verification:** Los 4 tests de App-level (merge, saneo OSC-52, degradación) pasan con readTasksFn inyectado; el default preserva la producción intacta.
- **Committed in:** 6fa81f7 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking/testability)
**Impact on plan:** El default del prop preserva el comportamiento de producción byte-a-byte (piggyback sobre el tick, never-throws). Sin scope creep — solo habilita tests deterministas.

## Issues Encountered
None - los 3 tasks se ejecutaron sin fricción. Ciclo TDD RED confirmado en Tasks 1 y 2 (módulo/símbolos ausentes → fallo, luego GREEN).

## User Setup Required
None - no requiere configuración de servicios externos.

## Next Phase Readiness
- `readTasks`, `deriveAnyNext` y `nextCell` disponibles como cimientos para las plans 75-02/75-03 (nudge con contexto, LIVE-06/07).
- Suite completa verde: 2223 pass, 0 fail, 1 skipped. `git diff --stat src/server.js package.json package-lock.json` vacío (SC1 preservado).
- Pendiente UAT visual (D4): confirmar la columna next con dato vivo en el dashboard real durante una fase en curso.

---
*Phase: 75-superficie-del-next-dashboard-y-nudge*
*Completed: 2026-07-17*

## Self-Check: PASSED
- Todos los ficheros creados/modificados existen en disco (7/7).
- Todos los commits de tarea existen en git (5/5): accffcb, d3c7c2d, 7e8b719, e136a6c, 6fa81f7.
