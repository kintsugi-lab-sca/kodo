---
phase: 46
plan: 01
subsystem: cli-dashboard-tui
tags: [overlay, plan-ligero, fallback, never-throws, anti-redos, tdd]
requires:
  - "src/cli/dashboard/plan.js readPlan(row, deps) → { status, lines } (Phase 44)"
  - "~/.kodo/plans/<task_id>.md artefacto productor (Phase 45 PLAN-03)"
  - "mode:'overlay' + setOverlaySnapshot render machinery (Phase 44)"
provides:
  - "readLightPlan helper privado (leaf-safe, never-throws, anti-ReDoS) en plan.js"
  - "status 'no-light-plan' en la unión discriminada de readPlan"
  - "OVERLAY_PLAN_NO_LIGHT = 'session has not written a plan yet' (App.js, exportada)"
  - "rama de render dim para no-light-plan en SessionTable.js"
affects:
  - "src/cli/dashboard/plan.js"
  - "src/cli/dashboard/App.js"
  - "src/cli/dashboard/SessionTable.js"
tech-stack:
  added: []
  patterns:
    - "ENOENT-vs-error discrimination en try/catch propio (D-05, espejo de plan.js:86-92)"
    - "guard de contención String.includes en call-site (D-09, anti-ReDoS)"
    - "override DI kodoPlansDir/homedirFn para aislar HOME en tests (D-08)"
    - "leaf-isolation: import homedir de node:os, NO src/config.js (D-07)"
key-files:
  created: []
  modified:
    - "src/cli/dashboard/plan.js"
    - "src/cli/dashboard/App.js"
    - "src/cli/dashboard/SessionTable.js"
    - "test/dashboard-plan.test.js"
    - "test/dashboard-overlay.test.js"
decisions:
  - "Option A para la regresión: planStatus gana omitTaskId → fila sin task_id preserva no-phase puro"
  - "guard de contención en el call-site (readPlan), no dentro de readLightPlan"
  - "override DI nombrado kodoPlansDir (+ homedirFn secundario)"
  - "literal OVERLAY_PLAN_NO_LIGHT = 'session has not written a plan yet' (el recomendado en UI-SPEC)"
metrics:
  duration: ~25min
  tasks: 3
  files_changed: 5
  completed: 2026-06-10
requirements_completed: [PLAN-04]
---

# Phase 46 Plan 01: Overlay del plan ligero para sesiones quick/non-GSD Summary

Fallback read-only de plan ligero dentro de `readPlan`: una fila quick/non-GSD (`phaseId == null`) con `task_id` ahora lee `~/.kodo/plans/<task_id>.md` (artefacto de Phase 45) y lo muestra en el overlay `p` con UX indistinguible del overlay GSD; el caso sin artefacto gana copy honesta dim nueva (`OVERLAY_PLAN_NO_LIGHT`), el caso sin task_id sigue siendo `no-phase` terminal.

## What Was Built

- **`readLightPlan(taskId, deps)`** — helper privado (no exportado) en `plan.js`, leaf-safe (importa `homedir` de `node:os`, NO `config.js`), síncrono, never-throws. Ruta CONSTRUIDA `join(plansDir, taskId + '.md')` byte-idéntica al productor `session-start.js:85,145`. Mapeo D-05: contenido→`ok` (render plano línea a línea), ENOENT→`no-light-plan`, otro (EACCES/sin `.code`)→`error`.
- **Rama de fallback estrechada** en `readPlan` (antiguo `plan.js:69`): cuando `phaseId == null`, si `task_id` es truthy Y pasa el guard de contención (`String.includes('/')||('\\')||('..')`) → `readLightPlan`; en otro caso → `no-phase` terminal (D-06). El guard vive en el call-site para mantener un solo punto de decisión.
- **`OVERLAY_PLAN_NO_LIGHT`** exportada en `App.js` con el literal locked, comentario extendido para el 4º caso (dim/informativo, distinto de NO_PHASE/NO_PLAN/ERROR).
- **Rama de render dim** en `SessionTable.js` para `no-light-plan` (sin `color` → cae a `dimColor:true`), importa la constante (cero literal inline).
- **Tests:** 6 casos DI puros del fallback en `dashboard-plan.test.js` (ok/no-light-plan/error/no-phase/never-throws/contención) + fix de regresión Option A + 2 integraciones Ink con HOME aislado en `dashboard-overlay.test.js`.

## Declaraciones explícitas requeridas por el plan

- **Opción de fix de regresión: Option A.** `planStatus` gana un parámetro `omitTaskId`; el test `:499` (renombrado a "sin phase_id NI task_id") usa una fila sin `task_id` para que el fallback de plan ligero NO dispare y se preserve el `no-phase` terminal puro (D-06), sin depender del estado del HOME real. Elegida sobre Option B porque mantiene el caso `no-phase` puro determinista y no acopla ese test al filesystem.
- **Literal de `OVERLAY_PLAN_NO_LIGHT`:** `'session has not written a plan yet'` — el recomendado en UI-SPEC §Copywriting Contract / CONTEXT D-04. Sin desviación; lexicalmente distinto de las otras tres copies y NO_COLOR-legible.
- **Guard de contención:** vive **en el call-site** (rama `phaseId == null` de `readPlan`), no dentro de `readLightPlan`. Un `task_id` con separadores degrada a `no-phase` (mismo trato que falsy, D-06), de modo que `readLightPlan` solo se invoca con un `taskId` ya validado y nunca recibe rutas que escapen del root fijo.
- **Override DI:** `kodoPlansDir` (primario, usado por los tests de unidad para aislar el HOME) + `homedirFn` (secundario). Sin override, default `join(homedir(), '.kodo', 'plans')`.

## Deviations from Plan

None - el plan se ejecutó exactamente como estaba escrito. Las dos elecciones abiertas (Option A vs B, guard en call-site vs helper) se resolvieron dentro de los límites del plan y se documentan arriba.

## Verification Results

- `node --test test/dashboard-plan.test.js` → 21 pass / 0 fail (6 casos nuevos del fallback + GSD existentes intactos + estructural anti-ReDoS verde).
- `node --test test/dashboard-overlay.test.js` → 18 pass / 0 fail (no-phase puro preservado + plan ligero end-to-end: contenido en frame, ausente → OVERLAY_PLAN_NO_LIGHT).
- `node --test test/format-isolation.test.js` → 8 pass / 0 fail (color-isolation: cero picocolors bajo `src/cli/dashboard/`, incluido `plan.js`).
- `node --test` (full suite) → 1263 pass / 1 skip (startup-budget pre-existente, Decisión B) / 0 fail.
- `git grep "from './config.js'" src/cli/dashboard/plan.js` → vacío (leaf preservado, D-07).
- `git grep "new RegExp" src/cli/dashboard/plan.js` → vacío (anti-ReDoS, D-13).
- `git diff -- src/server.js` → vacío (cero endpoints; overlay read-only).

## Success Criteria

1. ✓ Sesión quick/non-GSD con artefacto presente muestra el plan ligero al pulsar `p` (test de integración Ink, contenido en frame).
2. ✓ Sin artefacto → `OVERLAY_PLAN_NO_LIGHT` dim, distinto de NO_PHASE/NO_PLAN/ERROR (end-to-end + DI).
3. ✓ Sin phase_id Y sin task_id → `OVERLAY_PLAN_NO_PHASE` (D-06 terminal preservado, Option A).
4. ✓ Artefacto ilegible (EACCES/no-ENOENT) → `error`; never-throws (`assert.doesNotThrow`).
5. ✓ Rama GSD (filas con phase_id) lee su PLAN.md igual — cero regresión (tests GSD verdes).
6. ✓ Cero endpoints en `src/server.js`; `plan.js` leaf (no config.js) + anti-ReDoS (sin `new RegExp`); read-only.

## Commits

- `71f9585` test(46-01): add failing tests for light-plan fallback in readPlan (RED)
- `38b2d20` feat(46-01): add light-plan fallback to readPlan (leaf-safe, never-throws) (GREEN)
- `584f9eb` feat(46-01): add OVERLAY_PLAN_NO_LIGHT copy + dim render branch
- `f4e9290` test(46-01): fix no-phase regression (Option A) + light-plan integration

## TDD Gate Compliance

Task 1 siguió el ciclo RED→GREEN: commit `test(...)` (71f9585) con 4 tests fallando antes de la implementación, seguido de `feat(...)` (38b2d20) con la suite verde. No fue necesario REFACTOR (código limpio). Tasks 2-3 son aditivas (copy/render + tests de regresión/integración), sin behavior nuevo que requiera RED separado.

## Self-Check: PASSED
