---
phase: 64-editor-de-proyectos-en-el-dashboard
plan: 03
subsystem: tui-dashboard
tags: [tui, ink, async, request-token, projects-json, modules, never-throws, node-test]

# Dependency graph
requires:
  - phase: 64-02
    provides: "carril async base (modos projects/projects-loading/projects-edit/projects-error), projectsReqRef dedicado, text-input + validateExistingDir, snapshot congelado { remote, map }, constantes PROJECTS_*, props DI listProjectsFn/loadProjectsFn/saveProjectsFn"
  - phase: 64-01
    provides: "setModulePath/getModuleMap (forma dual { default, modules }) de src/projects-shape.js"
provides:
  - "App.js: modos projects-modules-loading/projects-modules/projects-modules-edit + handler `m` del 2º hop (mode:projects) + prop DI listModulesFn + constantes PROJECTS_MODULES_TITLE/PROJECTS_NO_MODULES"
  - "SessionTable.js: renderModulesLoading + renderModulesOverlay (lista de módulos con mapeo + text-input con cursor inverse, sin secretos)"
affects: [64-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Segundo hop async surfaced como estado de la TUI reusando el MISMO request-token dedicado del primer hop (Pitfall 3 — dos hops async, un ref)"
    - "Degradación informativa no-op (provider sin módulos → footer, never-throws) distinta del carril de error de red"

key-files:
  created: []
  modified:
    - src/cli/dashboard/App.js
    - src/cli/dashboard/SessionTable.js
    - test/dashboard-projects.test.js

key-decisions:
  - "El 2º hop (listModulesFn) reusa el MISMO projectsReqRef que el carril base — cada apertura (lista Y módulos) captura su reqId y descarta resultados tardíos (Pitfall 3: dos hops, un ref dedicado)"
  - "Modo dedicado `projects-modules-edit` (en vez de un flag de contexto sobre projects-edit) para que el Enter sepa llamar setModulePath (forma dual {default,modules}) y no setProjectPath"
  - "projectsSnapshot EXTENDIDO con modules + activeProjectId (no estado nuevo) — fieldCursor reutilizado para la lista de módulos (reset a 0 al entrar)"
  - "PROJECTS_NO_MODULES se muestra vía focusError en mode:'projects' (transitorio), no abre el sub-overlay — espejo del caso wizard cli.js:711-714"
  - "listModulesFn NO está en el contrato TaskProvider (solo PlaneClient); App consume el discriminado {ok}, el cableado condicional plane/github lo hace Plan 04"

patterns-established:
  - "Sub-máquina de modos anidada (módulos dentro del editor de proyectos) reusando text-input, validador y request-token del carril padre sin duplicar lógica"

requirements-completed: [PROJ-04]

coverage:
  - id: M1
    description: "tecla `m` en mode:'projects' dispara listModulesFn(projectId) con el MISMO projectsReqRef (2º hop); éxito con módulos → projects-modules con la lista y su mapeo"
    requirement: "PROJ-04"
    verification:
      - kind: integration
        ref: "test/dashboard-projects.test.js#PROJ-04 (mapear módulo)"
        status: pass
    human_judgment: false
  - id: M2
    description: "mapear la ruta de un módulo persiste projects[id] = {default, modules:{[mod.name]:ruta}} preservando default vía setModulePath + saveProjectsFn; ruta validada con validateExistingDir antes de guardar"
    requirement: "PROJ-04"
    verification:
      - kind: integration
        ref: "test/dashboard-projects.test.js#PROJ-04 (mapear módulo) assert deepEqual del spy"
        status: pass
    human_judgment: false
  - id: M3
    description: "listModulesFn lista vacía (github/sin módulos) → footer PROJECTS_NO_MODULES, no-op, sigue en projects, saveProjectsFn NO llamado (never-throws)"
    requirement: "PROJ-04"
    verification:
      - kind: integration
        ref: "test/dashboard-projects.test.js#PROJ-04 (sin módulos)"
        status: pass
    human_judgment: false
  - id: M4
    description: "Esc durante projects-modules-loading invalida el fetch en vuelo (projectsReqRef++) y vuelve a projects; el resultado tardío se descarta"
    requirement: "PROJ-04"
    verification:
      - kind: integration
        ref: "test/dashboard-projects.test.js#PROJ-04 (staleness 2º hop)"
        status: pass
    human_judgment: false

# Metrics
duration: 5min
completed: 2026-06-29
status: complete
---

# Phase 64 Plan 03: Soporte de módulos del editor de proyectos Summary

**Sub-editor de MÓDULOS (PROJ-04 / D-05) sobre el carril async del editor de proyectos: un SEGUNDO hop async (`listModulesFn`) guard-eado con el MISMO `projectsReqRef` (Pitfall 3 — dos hops, un ref), que mapea/edita la ruta de cada módulo (validada con `validateExistingDir`) y la persiste como `{ default, modules: { [mod.name]: ruta } }` vía `setModulePath` preservando la forma dual, degradando con un footer informativo no-op si el provider no tiene módulos — todo never-throws con DI fakes y 3 tests de integración nuevos.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-29
- **Completed:** 2026-06-29
- **Tasks:** 3 (App.js logic, SessionTable render, tests)
- **Files modified:** 3 (0 creados)

## Accomplishments
- **2º hop async (PROJ-04):** `m` en `mode:'projects'` (rama evaluada ANTES que `mode:'list'`, sin colisión — Pitfall 0) dispara `listModulesFn(projectId)` token-guarded con el MISMO `projectsReqRef` del carril base. `{ok:true, modules:[...]}` → congela la lista en `projectsSnapshot` (extendido con `modules` + `activeProjectId`) + `projects-modules`; `{ok:true, modules:[]}` → footer `PROJECTS_NO_MODULES` no-op; `{ok:false}` → footer error. Todo never-throws.
- **Persistencia forma dual (PROJ-04/D-06):** Enter en un módulo precarga su ruta actual (`getModuleMap`), Enter valida con `validateExistingDir` ANTES de tocar el disco, y `setModulePath(map, id, mod.name, value)` materializa `{ default, modules }` preservando el default y los otros módulos. El test asserta `deepEqual` del argumento del spy `saveProjectsFn`.
- **Degradación sin-módulos (D-05):** lista vacía (GitHub / provider sin módulos) → `PROJECTS_NO_MODULES` (informativo, no error), NO abre el sub-overlay, `saveProjectsFn` NO se llama — espejo del wizard `cli.js:711-714`.
- **Staleness 2º hop (Pitfall 3):** Esc durante `projects-modules-loading` avanza `projectsReqRef` → el resultado tardío de `listModulesFn` se descarta tras el await + vuelve a `projects`.
- **Render (SessionTable):** `renderModulesLoading` + `renderModulesOverlay` (lista de módulos con su mapeo derivado de `getModuleMap`, text-input con cursor `<Text inverse>`), reusando el molde de `renderProjectsOverlay` sin romper color-isolation (walker `format-isolation` verde) ni exponer secretos.
- 3 tests de integración nuevos (mapear / sin-módulos / staleness), todos verdes; suite completa sin regresión (1639 pass / 0 fail / 1 skip pre-existente).

## Task Commits

1. **Task 1: Modos de módulos + 2º hop async + persistencia en App.js** — `e8890b4` (feat)
2. **Task 2: Render del sub-overlay de módulos en SessionTable.js** — `a3c82d4` (feat)
3. **Task 3: Cobertura integration de módulos (PROJ-04)** — `9e79d0f` (test)

## Files Created/Modified
- `src/cli/dashboard/App.js` — prop DI `listModulesFn` (discriminado {ok}, asimetría no-contrato documentada en JSDoc), constantes `PROJECTS_MODULES_TITLE`/`PROJECTS_NO_MODULES`, handler `m` del 2º hop en `mode:'projects'`, modos `projects-modules-loading`/`projects-modules`/`projects-modules-edit`, `projectsSnapshot` extendido con `modules`+`activeProjectId`, import de `setModulePath`/`getModuleMap`.
- `src/cli/dashboard/SessionTable.js` — `renderModulesLoading`, `renderModulesOverlay` + early-returns para los modos de módulos, import de `PROJECTS_MODULES_TITLE` y `getModuleMap`.
- `test/dashboard-projects.test.js` — `injectProps` extendido con `listModulesFn` + `MODULES_FIXTURE`; 3 describe blocks nuevos (PROJ-04 mapear / sin-módulos / staleness).

## Decisions Made
- El 2º hop reusa el MISMO `projectsReqRef` (no un ref nuevo) — un único ref dedicado captura su reqId en cada apertura (lista Y módulos) y descarta resultados tardíos (Pitfall 3).
- Modo dedicado `projects-modules-edit` (en lugar de un flag de contexto sobre `projects-edit`) para que el Enter ramifique a `setModulePath` (forma dual) y no a `setProjectPath`.
- `projectsSnapshot` extendido con `modules` + `activeProjectId` (no estado nuevo); `fieldCursor` reutilizado para la lista de módulos (reset a 0 al entrar).
- `PROJECTS_NO_MODULES` se muestra vía `focusError` en `mode:'projects'` (transitorio), sin importar el constante en SessionTable (sólo `PROJECTS_MODULES_TITLE` se usa en el render).

## Deviations from Plan

None — el plan se ejecutó tal cual está escrito.

## Issues Encountered
None.

## User Setup Required
None — todo se opera con DI fakes; el cableado real de `listModulesFn` (condicional plane/github desde index.js) es Plan 04.

## Next Phase Readiness
- Plan 04 cablea `listModulesFn` desde `runDashboard`/index.js con un wrapper never-throws de `PlaneClient.listModules` (typeof-gated: github → `{ok:true, modules:[]}` por el contrato, no por el provider), junto a las 3 props DI del carril base.
- Cero dependencias nuevas; `package.json` intacto.

## Known Stubs
None — el carril de módulos está completamente cableado con DI; los defaults inertes (`listModulesFn = async () => ({ ok: true, modules: [] })`) son fallbacks para tests del módulo sin DI, no stubs de UI.

## Self-Check: PASSED

---
*Phase: 64-editor-de-proyectos-en-el-dashboard*
*Completed: 2026-06-29*
