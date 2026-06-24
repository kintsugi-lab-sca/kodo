---
phase: 61-progreso-vivo-para-sesiones-adoptadas
plan: 01
status: complete
requirements_completed: [PROG-04]
subsystem: dashboard, adopt
completed: 2026-06-24
tags: [dashboard, progress, adopt, gsd, prog-04]
---

# Phase 61 Plan 01: Progreso vivo para sesiones adoptadas — Summary

**Una sesión GSD adoptada ahora muestra su `N/M` en el dashboard igual que una lanzada. El gate del progreso pasó de "flag `gsd`" a "STATE.md GSD legible en el path resuelto" (dinámico), el lector resuelve el path con fallback worktree→project_path, y la adopción marca `gsd`/`gsd_mode` para las columnas phase/mode.**

## Accomplishments

1. **`src/cli/dashboard/App.js`** (D-1 + D-2) — el enrich del progreso:
   - **Gate dinámico (D-1):** eliminado el corte `if (row.gsd !== true) → no-progress`; ahora toda fila usable resuelve el path e invoca `readGsdProgress`. Una sesión adoptada que se vuelve GSD después se enciende sola.
   - **Fallback de path (D-2):** `existsSync(worktreeBase) ? computeRealWorktreePath : project_path`. Lanzada → worktree (Pitfall 1 intacto); adoptada → `<project_path>/.planning/STATE.md`. Guard anti-traversal del session_id preservado.
2. **`src/adopt.js`** (D-3) — `isGsdProject(projectPath, existsSyncFn)` (helper puro, never-throws, DI) + `buildSessionFromAdoption` setea `gsd:true`/`gsd_mode:'full'` cuando `.planning/PROJECT.md`|`STATE.md` existe. `phase_id` NO se deriva (un adopt no mapea a una fase del roadmap). 0-token, solo fs read, sin cmux/provider.
3. **Tests:** `test/dashboard/app-progress-adopted.test.js` (3 casos: adoptada-sin-flag→N/M, lanzada→worktree no project_path, sin-STATE→'—') + `test/adopt.test.js` (detección GSD: positivo/negativo, `isGsdProject` true/false/vacío/never-throws).

## Por qué funciona

El read-path probado (`readGsdProgress` + keep-last-good) queda intacto — Phase 61 solo cambia QUÉ se lee (gate dinámico) y DÓNDE (fallback de path). El gate dinámico desacopla el progreso del flag `gsd` persistido, resolviendo de raíz el caso adoptado (cuyo flag no se seteaba) Y el caso "se vuelve GSD después". `adopt.js` igualmente marca el flag para las columnas phase/mode.

## Tests
- `npm test` → 1509 pass / 0 fail / 1 skip.
- Walkers `format-isolation` + `cmux-isolation` → 8 pass.

## Key Files
- modified: `src/cli/dashboard/App.js`, `src/adopt.js`, `test/adopt.test.js`
- created: `test/dashboard/app-progress-adopted.test.js`

## Limitación conocida / scope
- **Implicación de D-1:** una sesión NO-GSD en un repo que SÍ es proyecto GSD mostraría el progreso del proyecto (el path resuelto tiene STATE.md GSD). Aceptado en discuss (si hay STATE.md GSD en el path, se muestra).
- **Fuera de scope:** bootstrap/creación de GSD al adoptar (PROG-F1). `phase_id` para adoptadas (no mapea a fase del roadmap).
- **Verificación en vivo pendiente:** validado por tests de componente; una pasada en TTY real con una sesión adoptada GSD confirmaría end-to-end (la sesión ROMAN-175 del UAT ya no existe).
</content>
