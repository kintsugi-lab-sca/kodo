---
phase: 64-editor-de-proyectos-en-el-dashboard
plan: 02
subsystem: tui-dashboard
tags: [tui, ink, async, request-token, projects-json, never-throws, node-test]

# Dependency graph
requires:
  - phase: 64-01
    provides: "validateExistingDir (src/path-validate.js) + helpers de forma dual (src/projects-shape.js) consumidos por los handlers de projects-edit/quitar"
  - phase: 63-editor-de-configuracion-en-el-dashboard
    provides: "molde de text-input + snapshot congelado + footer transitorio + máquina de modos config/config-edit reusados verbatim"
provides:
  - "App.js: modos projects/projects-loading/projects-edit/projects-error + handler `m` + projectsReqRef dedicado + props DI listProjectsFn/loadProjectsFn/saveProjectsFn + constantes PROJECTS_*"
  - "SessionTable.js: renderProjectsOverlay + renderProjectsLoading + renderProjectsError (carril async surfaced como estado, sin secretos)"
affects: [64-03, 64-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fetch async surfaced como estado de la TUI con guard de request-token DEDICADO (no compartido) para staleness"
    - "Wrapper discriminado {ok} (no fail-open) para distinguir 0-resultados de error de red en un carril async never-throws"

key-files:
  created:
    - test/dashboard-projects.test.js
  modified:
    - src/cli/dashboard/App.js
    - src/cli/dashboard/SessionTable.js
    - test/dashboard/app-focus.test.js

key-decisions:
  - "projectsReqRef DEDICADO (no reusa overlayReqRef que comparten c/l/adopt/deriving) — un Esc en projects-loading no invalida un overlay legítimo en vuelo"
  - "Estados DEDICADOS projectsError (fetch) y projectsEditError (validación) separados de focusError — el clear-on-any-input no consume la tecla r/Esc/siguiente edición (Pitfall 2)"
  - "Tecla de quitar = `x` (directo, sin modal de confirmación — re-mapeable, no destructivo); `m` abre el editor desde mode:list"
  - "runProjectsFetch extraído como useCallback compartido por el handler `m` y el retry `r` (un único carril de fetch)"

patterns-established:
  - "Primer carril de error async del dashboard surfaced como estado explícito (projects-error) en vez de fail-open silencioso"
  - "Snapshot congelado { remote, map } al abrir; el poll /status sigue por debajo sin tocarlo (molde overlaySnapshot)"

requirements-completed: [PROJ-01, PROJ-02, PROJ-03, PROJ-05]

coverage:
  - id: D1
    description: "`m` abre el editor → listProjectsFn ok → lista con estado de mapeo [ruta]/[sin mapear]"
    requirement: "PROJ-01"
    verification:
      - kind: integration
        ref: "test/dashboard-projects.test.js#PROJ-01 (m abre, lista, mapeo)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Enter precarga la ruta, valida con validateExistingDir ANTES de saveProjectsFn; inválido → footer rojo, NO escribe, sigue en projects-edit"
    requirement: "PROJ-02"
    verification:
      - kind: integration
        ref: "test/dashboard-projects.test.js#PROJ-02-UI (válido + inválido)"
        status: pass
    human_judgment: false
  - id: D3
    description: "`x` quita el mapeo → saveProjectsFn con el mapa sin la key; la fila pasa a [sin mapear]"
    requirement: "PROJ-03"
    verification:
      - kind: integration
        ref: "test/dashboard-projects.test.js#PROJ-03 (quitar mapeo)"
        status: pass
    human_judgment: false
  - id: D4
    description: "listProjectsFn {ok:false} → projects-error; `r` reintenta, Esc sale; saveProjectsFn NUNCA se llama; Esc durante loading descarta el resultado tardío"
    requirement: "PROJ-05"
    verification:
      - kind: integration
        ref: "test/dashboard-projects.test.js#PROJ-05 (error+retry+esc) + PROJ-05 race"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-06-29
status: complete
---

# Phase 64 Plan 02: Carril async base del editor de proyectos Summary

**Editor de proyectos en el dashboard TUI (modos `projects`/`projects-loading`/`projects-edit`/`projects-error` en `App.js` + render en `SessionTable.js`): la primera fuente de datos ASYNC de red del dashboard surfaced como estado, con guard de request-token dedicado, validación de ruta pre-escritura, quitar mapeo, y degradación never-throws con retry — todo verificado end-to-end con 7 tests de integración y DI fakes.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-29
- **Completed:** 2026-06-29
- **Tasks:** 3 (Task 1 RED test, Tasks 2/3 implementación GREEN)
- **Files modified:** 1 creado + 3 modificados

## Accomplishments
- **Carril async (PROJ-01/05):** `m` en mode:list dispara `runProjectsFetch` (token-guarded con `projectsReqRef` dedicado) → `projects-loading` → `await listProjectsFn()` discriminado → `projects` (snapshot congelado `{ remote, map }`) o `projects-error`. El wrapper distingue 0-proyectos de error de red (no fail-open). El poll /status sigue por debajo sin tocar el snapshot.
- **Validación + guardado (PROJ-02):** Enter en `projects-edit` corre `validateExistingDir(buffer)` ANTES de `saveProjectsFn`; inválido → `projectsEditError` (estado dedicado) + sigue editando, una ruta inexistente jamás alcanza el disco. Válido → `setProjectPath` (preserva forma dual) + aviso de reinicio transitorio.
- **Quitar mapeo (PROJ-03):** `x` → `removeProjectMapping` + `saveProjectsFn(next)` + feedback ámbar; la fila pasa a `[sin mapear]`.
- **Degradación (PROJ-05/D-07):** `projects-error` con `r` reintenta y `Esc` sale; `saveProjectsFn` JAMÁS se llama en el carril de error; el panel ink permanece montado. Esc durante `projects-loading` invalida el fetch en vuelo (resultado tardío descartado), `selectedTaskId` intacto.
- **Render (SessionTable):** `renderProjectsOverlay` (lista navegable + text-input con cursor `<Text inverse>`) + `renderProjectsLoading` + `renderProjectsError`; sin exponer secretos (solo lista del provider + rutas locales) y sin romper color-isolation.
- 7 tests de integración nuevos (PROJ-01/02-UI×2/03/05×2/race), todos verdes; suite completa sin regresión (1636 pass / 0 fail).

## Task Commits

1. **Task 1: Test RED de integración** — `7f84802` (test, RED confirmado)
2. **Task 2: Modos async + handlers + validación en App.js** — `86222a4` (feat)
3. **Task 3: Render del overlay + estados loading/error en SessionTable.js** — `8785845` (feat + fix de test in-scope)

## Files Created/Modified
- `test/dashboard-projects.test.js` (creado) — harness de `dashboard-config.test.js` + `drain` extendido con los 3 `*Fn` DI; cubre los 6 comportamientos + la race con un fetch deferred manual.
- `src/cli/dashboard/App.js` — modos projects*, handler `m`, `runProjectsFetch` (useCallback compartido m/r), `projectsReqRef` dedicado, estados `projectsSnapshot`/`projectsError`/`projectsEditError`, constantes `PROJECTS_*`, props DI, footer hint `m projects`.
- `src/cli/dashboard/SessionTable.js` — `renderProjectsOverlay`/`renderProjectsLoading`/`renderProjectsError` + early-returns + props nuevas.
- `test/dashboard/app-focus.test.js` — assertion del footer hint extendida con `m projects` (cambio requerido por el footer de App.js).

## Decisions Made
- `projectsReqRef` dedicado (no reusa `overlayReqRef`) para aislar el carril async de proyectos del de c/l/adopt/deriving (Anti-pattern RESEARCH).
- `projectsError` y `projectsEditError` como estados dedicados (no `focusError`) para que el clear-on-any-input no consuma las teclas `r`/`Esc`/edición (Pitfall 2).
- Tecla de quitar = `x`, directo sin modal (re-mapeable, no destructivo); `m` abre el editor.
- Módulos (PROJ-04) NO incluidos en este plan (diferido a Plan 03), ni el cableado real (Plan 04) — aquí se opera 100% con DI fakes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Assertion stale del footer hint en app-focus.test.js**
- **Found during:** Task 3 (npm test full suite)
- **Issue:** `test/dashboard/app-focus.test.js` fijaba el footer como `/a adopt · e config · q quit/`; el footer hint requerido por el plan ahora intercala `· m projects`.
- **Fix:** Actualizada la regex a `/a adopt · e config · m projects · q quit/` (preserva el intent "footer restaurado").
- **Files modified:** test/dashboard/app-focus.test.js
- **Commit:** 8785845

## Issues Encountered
None.

## User Setup Required
None — todo se opera con DI fakes; el cableado real (`listProjectsFn`/`loadProjectsFn`/`saveProjectsFn` desde `runDashboard`) es Plan 04.

## Next Phase Readiness
- Plan 03 puede añadir los modos `projects-modules(-loading)` reusando el mismo `projectsReqRef`, text-input y validador de ruta.
- Plan 04 cablea las 3 props DI desde `index.js` (wrapper never-throws de `listProjects` + `loadProjects`/`saveProjects` de config.js).
- Cero dependencias nuevas; `package.json` intacto.

## Self-Check: PASSED

---
*Phase: 64-editor-de-proyectos-en-el-dashboard*
*Completed: 2026-06-29*
