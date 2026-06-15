---
phase: 49-live-progress-spike-hard-gate
plan: 01
subsystem: research
tags: [spike, claude-code-hooks, TaskCreate, live-progress, correlation, session-state]

# Dependency graph
requires:
  - phase: 45-46 (lightweight plan seam)
    provides: "patrón mirror productor↔consumidor ~/.kodo/<dir>/<task_id> (readLightPlan, session-start.js HOOK-02) reusado como molde del artefacto de progreso"
provides:
  - "Veredicto empírico VIABLE para capturar progreso vivo N/M de sesiones Claude Code 2.1.175"
  - "Schema verificado del payload de hooks TaskCreated/TaskCompleted (incluye session_id, cwd, transcript_path, task_id)"
  - "Round-trip session_id→task_id demostrado en vivo vía findSession sobre ~/.kodo/state.json"
  - "Decisión de gate: proceder a Phase 50 con artefacto ~/.kodo/progress/<task_id>.json"
affects: [phase-50-progress-capture, PROG-02, PROG-03, dashboard live-progress display]

# Tech tracking
tech-stack:
  added: []  # spike throwaway — cero deps nuevas, cero código de producción
  patterns:
    - "Hook TaskCreated/TaskCompleted como trigger en tiempo real (aporta session_id + cwd)"
    - "Lectura never-throws de ~/.claude/tasks/<session_id>/ para N/M agregado (sin tomar .lock)"

key-files:
  created:
    - .planning/phases/49-live-progress-spike-hard-gate/49-SPIKE.md
  modified:
    - .planning/phases/49-live-progress-spike-hard-gate/49-VALIDATION.md

key-decisions:
  - "VIABLE: las 4 condiciones (a/b/c/d) demostradas con evidencia cruda para Surface 1 (hook) y Surface 3 (tasks-dir)"
  - "Superficie ganadora: hook TaskCreated/TaskCompleted (preferida, D-02) + ~/.claude/tasks/ como refuerzo del N/M autoritativo"
  - "El payload del hook SÍ lleva session_id/cwd/transcript_path — resuelve la incógnita #1 (A1, LOW-confidence)"
  - "Sonda ejecutada en sesión orquestadora interactiva (no worktree de kodo); supuesto residual A2 (disparo en execute-phase real) diferido a Phase 50"

patterns-established:
  - "Spike empírico throwaway: hook /tmp + backup/restore byte-idéntico de ~/.claude/settings.json; cero residuo, cero código de producción"
  - "Evidence Map de 4 condiciones × superficie con sesgo INVIABLE-por-defecto (D-04, sin crédito parcial)"

requirements-completed: [PROG-01]

# Metrics
duration: ~15min
completed: 2026-06-12
---

# Phase 49: Live-progress spike (HARD GATE) Summary

**Veredicto VIABLE: el progreso vivo N/M de una sesión Claude Code 2.1.175 ES capturable vía el hook `TaskCreated`/`TaskCompleted` (cuyo payload incluye `session_id`) reforzado por `~/.claude/tasks/<session_id>/`, correlacionable a `task_id` vía el `findSession` existente de kodo — gate abierto a Phase 50.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-06-12
- **Tasks:** 3/3 (Task 1 auto · Task 2 checkpoint:human-verify · Task 3 auto)
- **Files modified:** 2 (`.planning/` only)

## Accomplishments
- **Las 4 condiciones VIABLE demostradas con evidencia cruda en primera persona** sobre la build instalada 2.1.175 (no 2.1.174 — Pitfall 0 evitado): el hook dispara (4 payloads), payload estable que deriva `N/M=1/3`, correlación `session_id→task_id`, cero ruptura de sesión.
- **Incógnita #1 (A1, LOW-confidence) resuelta:** el payload de `TaskCreated`/`TaskCompleted` incluye `session_id`, `cwd`, `transcript_path`, `task_id` — correlación directa sin depender del dir-name.
- **Round-trip de correlación ejecutado en vivo** (`findSession` sobre `~/.kodo/state.json` real): `f8dcd7d6… → 297980b0…`, sin código de producción nuevo.
- **Gate decision: VIABLE → proceder a Phase 50** con artefacto `~/.kodo/progress/<task_id>.json` (espejo del seam plan-ligero, D-05). PROG-F1 no se activa.

## Task Commits

1. **Task 1: scaffold harness throwaway + esqueleto 49-SPIKE.md** - `52e5ef5` (docs)
2. **Tasks 2+3: sonda autónoma + veredicto VIABLE + sign-off** - `944e3ac` (docs)

## Files Created/Modified
- `.planning/phases/49-live-progress-spike-hard-gate/49-SPIKE.md` - Deliverable único (D-03): header de versión real, Evidence Map de 4 condiciones × 3 superficies, apéndice de evidencia cruda, veredicto VIABLE, decisión de gate Phase 50.
- `.planning/phases/49-live-progress-spike-hard-gate/49-VALIDATION.md` - Sign-off completo, `nyquist_compliant: true`, `verdict: VIABLE`.

## Deviations & Notes
- **Checkpoint humano (Task 2) resuelto vía sonda autónoma autorizada por el operador:** el usuario eligió que yo disparara `TaskCreate` en primera persona en esta sesión interactiva (en lugar de conducir una sesión worktree de kodo). Esto capturó el comportamiento del runtime (independiente del tipo de sesión) y resolvió las incógnitas de payload/schema/correlación.
- **Limitación de cobertura honesta (supuesto A2):** la sonda NO confirmó el disparo de `TaskCreate` en el flujo de producción específico (`claude --worktree` lanzado por el dashboard ejecutando `/gsd-execute-phase`). El research lo infiere (12/58 dirs `tasks/` son worktree sessions); Phase 50 debe confirmarlo en el primer execute-phase real instrumentado. El display ya tolera la cohorte sin-tasks (estado degradado `—`).
- **Cero residuo / cero código de producción:** `git diff -- src/ test/ bin/` vacío; `~/.claude/settings.json` restaurado byte-idéntico (`cmp` ✅); hook `/tmp` y `.bak` borrados. El tasks-dir físico de la sonda persiste en `~/.claude/tasks/` por diseño (D-04: internos de Claude Code son superficie de solo-lectura, el spike nunca los muta/borra).

## Self-Check: PASSED
- [x] 49-SPIKE.md con veredicto VIABLE explícito + header 2.1.175 + Evidence Map de 4 condiciones
- [x] Round-trip session_id→task_id adjunto (findSession en vivo)
- [x] Decisión de gate Phase 50 registrada
- [x] `git diff -- src/ test/ bin/` vacío
- [x] settings.json restaurado byte-idéntico (hook desregistrado)
- [x] 49-VALIDATION.md sign-off + nyquist_compliant: true
