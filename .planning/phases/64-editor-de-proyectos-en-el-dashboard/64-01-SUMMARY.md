---
phase: 64-editor-de-proyectos-en-el-dashboard
plan: 01
subsystem: testing
tags: [tui, ink, projects-json, validation, dual-shape, never-throws, node-test]

# Dependency graph
requires:
  - phase: 63-editor-de-configuracion-en-el-dashboard
    provides: "patrón de validadores puros {ok,value}|{ok,error} y la convención never-throws + copy estable reusados aquí"
provides:
  - "src/path-validate.js — validateExistingDir(raw) never-throws (ÚNICO validador con I/O del milestone, adyacente a config-validate.js)"
  - "src/projects-shape.js — helpers puros de forma dual (setProjectPath/removeProjectMapping/setModulePath/getProjectPath/getModuleMap) que preservan string|{default,modules}"
affects: [64-02, 64-03, 64-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Validador con I/O aislado en módulo adyacente para preservar el invariante 0-I/O de config-validate.js"
    - "Helpers puros de mutación de mapa con clon superficial (nunca mutan el argumento)"

key-files:
  created:
    - src/path-validate.js
    - src/projects-shape.js
    - test/path-validate.test.js
    - test/projects-shape.test.js
  modified: []

key-decisions:
  - "Validador de ruta en src/path-validate.js (módulo adyacente), NO dentro de config-validate.js, para no romper su invariante 0-I/O declarado (D-04, RESEARCH Pitfall 4)"
  - "setModulePath sobre entrada-string materializa {default: <string previo>, modules:{...}} preservando el default legacy"

patterns-established:
  - "Never-throws con I/O: statSync envuelto en try/catch (symlink roto/permisos) devuelve {ok:false} en vez de lanzar"
  - "Pureza por clon superficial: {...map} + delete/asignación → mapa nuevo, argumento intacto (verificado por referencia en tests)"

requirements-completed: [PROJ-02, PROJ-03, PROJ-04]

coverage:
  - id: D1
    description: "validateExistingDir acepta directorios existentes y rechaza vacío/inexistente/archivo/symlink-roto/input-arbitrario sin lanzar (never-throws con I/O)"
    requirement: "PROJ-02"
    verification:
      - kind: unit
        ref: "test/path-validate.test.js#validateExistingDir (ruta-directorio, never-throws con I/O)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Helpers de forma dual: editar la ruta de una entrada-objeto preserva modules; removeProjectMapping borra solo la key; setModulePath materializa {default,modules}; ninguna función muta su entrada"
    requirement: "PROJ-03"
    verification:
      - kind: unit
        ref: "test/projects-shape.test.js#setProjectPath/removeProjectMapping/setModulePath"
        status: pass
    human_judgment: false
  - id: D3
    description: "setModulePath mapea un módulo preservando default y otros módulos previos (forma {default, modules:{[mod.name]:ruta}})"
    requirement: "PROJ-04"
    verification:
      - kind: unit
        ref: "test/projects-shape.test.js#PROJ-04/D-05 — setModulePath (materializa forma objeto)"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-06-29
status: complete
---

# Phase 64 Plan 01: Fundación pura del editor de proyectos Summary

**Validador de ruta-directorio never-throws (`src/path-validate.js`) + helpers puros de forma dual de `projects.json` (`src/projects-shape.js`), construidos y verificados en aislamiento (28 tests, sin ink ni red) para que la TUI de los planes 02-04 los consuma ya probados.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-29
- **Completed:** 2026-06-29
- **Tasks:** 2 (ambas TDD)
- **Files modified:** 4 creados

## Accomplishments
- `validateExistingDir(raw)` — formaliza el `existsSync` plano del wizard añadiendo `statSync().isDirectory()` + never-throws (try/catch sobre symlink roto/permisos, Pitfall 2). Vive en módulo adyacente para preservar el invariante 0-I/O de `config-validate.js` (D-04).
- `src/projects-shape.js` — 5 helpers puros (`setProjectPath`, `removeProjectMapping`, `setModulePath`, `getProjectPath`, `getModuleMap`) que preservan EXACTAMENTE la forma dual `string | {default, modules}` consumida por `manager.js:88` y `adopt.js:126` (T-64-03).
- 28 tests nuevos (9 path-validate + 19 projects-shape), todos verdes; suite completa sin regresión (1629 pass / 0 fail).

## Task Commits

Cada tarea se ejecutó en ciclo TDD (RED → GREEN):

1. **Task 1: Validador de ruta-directorio** - `c6d678c` (test) → `cb35907` (feat)
2. **Task 2: Helpers puros de forma dual** - `2cbc489` (test) → `6498974` (feat)

## Files Created/Modified
- `src/path-validate.js` - `validateExistingDir(raw)` never-throws, `{ok:true,value}|{ok:false,error}`, único validador con I/O.
- `src/projects-shape.js` - helpers puros de mutación/lectura del mapa `projects.json` (forma dual preservada, sin mutar el argumento).
- `test/path-validate.test.js` - tabla dir-existe/archivo/no-existe/vacío/symlink-roto con `mkdtempSync` (sin tocar HOME).
- `test/projects-shape.test.js` - preservación de forma dual al editar, delete-key, set-módulo, y pureza por referencia.

## Decisions Made
- Validador de ruta en módulo adyacente `src/path-validate.js` en vez de extender `config-validate.js` — preserva su invariante 0-I/O declarado (`:14-15`) y su test hermético (D-04 / RESEARCH Pitfall 4, recomendación explícita).
- `setModulePath` sobre una entrada-string materializa `{default: <ruta string previa>, modules:{...}}` preservando el default legacy; sobre `{}` deja `default: ''`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 02 puede importar `validateExistingDir` y correrlo antes de `saveProjectsFn` en `mode:'projects-edit'`.
- Planes 02/03 pueden importar `setProjectPath`/`removeProjectMapping`/`setModulePath`/`getProjectPath`/`getModuleMap` para mutar el snapshot antes de persistir.
- Cero dependencias nuevas; `package.json` intacto (D-09).

## Self-Check: PASSED

---
*Phase: 64-editor-de-proyectos-en-el-dashboard*
*Completed: 2026-06-29*
