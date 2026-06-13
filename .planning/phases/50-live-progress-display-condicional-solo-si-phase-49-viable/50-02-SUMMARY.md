---
phase: 50-live-progress-display-condicional-solo-si-phase-49-viable
plan: 02
subsystem: hooks
tags: [hooks, capture, progress, task-events, never-throws]
dependency_graph:
  requires: ["50-01 (gate A2 CONFIRMA)"]
  provides: ["~/.kodo/progress/<task_id>.json (productor)", "src/hooks/task-progress.js", "registro TaskCreated/TaskCompleted en install.js"]
  affects: ["50-03 (display — consumidor del artefacto)"]
tech_stack:
  added: []
  patterns: ["hook separado never-throws (mold session-start.js)", "recuento autoritativo self-healing (D-04)", "anti-traversal String.includes (mold plan.js)", "DI para HOME-isolation (mold readLightPlan)"]
key_files:
  created:
    - src/hooks/task-progress.js
    - test/hooks/task-progress.test.js
    - test/hooks/task-progress-install.test.js
  modified:
    - src/hooks/install.js
decisions:
  - "Registro PLANO (sync, sin async/timeout) — gate A2 validó ~35ms/evento imperceptible"
  - "Artefacto nombrado con found.session.task_id (UUID kodo), NUNCA input.task_id"
  - "Helpers puros con DI (deriveProgress/runProgressHook) para tests sin spawn"
metrics:
  duration: "~4 min"
  completed: "2026-06-13"
  tasks: 2
  files: 4
requirements_completed: ["PROG-02"]
---

# Phase 50 Plan 02: Hook de captura task-progress Summary

Hook SEPARADO `src/hooks/task-progress.js` que en cada disparo `TaskCreated`/`TaskCompleted` recuenta autoritativamente `~/.claude/tasks/<session_id>/`, deriva `N/M` (self-healing), correlaciona `session_id→task_id` (UUID kodo) vía `findSession`, y escribe `~/.kodo/progress/<task_id>.json` — never-throws fire-and-forget, registrado vía `installHooks()` sin perturbar HOOK-02.

## Qué se construyó

- **`src/hooks/task-progress.js` (NUEVO):** hook never-throws con cuerpo mínimo (modo síncrono, validado por gate A2). Tres helpers:
  - `deriveProgress(tasksDir, deps)` — recuento autoritativo (D-04): `readdir` never-throws (ENOENT/EACCES → `null`), filtra `.lock`/`.highwatermark` (`f.endsWith('.json') && !f.startsWith('.')`), parsea cada `N.json` en su propio try/catch (JSON corrupto → no cuenta, self-heal), `n = count(status === 'completed')` con igualdad ESTRICTA.
  - `runProgressHook(input, deps)` — núcleo testeable: correlación vía `findSession` (import lazy si no se inyecta), `taskId = found.session.task_id` (UUID, NUNCA `input.task_id`), guard anti-traversal con los TRES checks `/`/`\`/`..` ANTES de construir la ruta, escritura write-owner a ruta byte-idéntica al consumidor.
  - `main()` + guard `import.meta.url` — testeable sin spawn.
- **`src/hooks/install.js` (MODIFICADO):** `installHooks()` declara `taskProgressCmd` y registra `TaskCreated`/`TaskCompleted` vía el `addHook` existente (idempotente, sin clobber); `uninstallHooks()` barre los 4 eventos. El helper `addHook` no se tocó.

## Decisión load-bearing: modo de registro (gate A2)

El gate `50-A2-GATE.md` recomendó **modo SÍNCRONO + cuerpo mínimo** (~35ms/evento, por debajo del umbral de perceptibilidad ~100ms). Por tanto el registro es **PLANO** (mismo shape que SessionStart/Stop, vía `addHook` sin modificar): NO se añadió `async:true`/`asyncRewake:true` ni `timeout`. El gate marcó async como optimización OPCIONAL no necesaria para v1. El cuerpo se mantuvo mínimo (`readdir` + N parseos baratos + 1 `writeFile`) con `findSession` por import dinámico lazy.

## Verificación

- `node --test test/hooks/task-progress.test.js` → 15/15 verde (9 behaviors + casos de escritura/correlación).
- `node --test test/hooks/task-progress-install.test.js` → 5/5 verde.
- `npm test` → **1299 pass, 0 fail, 1 skip** (cero regresiones).
- `git diff --quiet src/hooks/session-start.js` → INTACTO (hash `9dfa58d`, idéntico al inicio — HOOK-02 golden-bytes preservados).
- `grep -v '^[[:space:]]*//' src/hooks/task-progress.js | grep -c 'input\.task_id'` → 0 (el artefacto usa `found.session.task_id`).

## Threat model

- **T-50-traversal (HIGH):** guard `String.includes('/')`/`'\\'`/`'..'` sobre `found.session.task_id` ANTES de la ruta; root FIJO `join(homedir(),'.kodo','progress')`. Cubierto por Test 8.
- **T-50-redos:** cero regex desde input — solo `String.endsWith/startsWith/includes`.
- **T-50-dos-internals:** lectura never-throws SIN tomar el `.lock`; filtra `.lock`/`.highwatermark`; ENOENT/EACCES → return silencioso.
- **T-50-latency:** cuerpo mínimo + import lazy de `findSession` + modo síncrono validado.
- **T-50-corrupt:** cada `readFile`+`JSON.parse` en su propio try/catch (Test 6).
- **T-50-clobber:** `addHook` idempotente; install/uninstall solo tocan entries kodo (Tests 2/3/4).
- **T-50-SC:** cero paquetes nuevos (solo Node builtins + `state.js` ya presente).

## Deviations from Plan

None — el plan se ejecutó exactamente como estaba escrito. El modo de registro siguió la recomendación del gate A2 (síncrono/plano).

## Known Stubs

None — el hook es funcional end-to-end. El consumidor del artefacto (display) es responsabilidad del Plan 03.

## Self-Check: PASSED

- FOUND: src/hooks/task-progress.js
- FOUND: src/hooks/install.js
- FOUND: test/hooks/task-progress.test.js
- FOUND: test/hooks/task-progress-install.test.js
- FOUND commits: 4c27c28 (RED), 7d917c8 (GREEN t1), cbfb9b5 (RED t2), 5ec62b9 (GREEN t2)

## TDD Gate Compliance

Ambas tareas siguieron RED → GREEN. Commits `test(...)` preceden a sus `feat(...)`:
- Task 1: `4c27c28 test` → `7d917c8 feat`
- Task 2: `cbfb9b5 test` → `5ec62b9 feat`
REFACTOR no requerido (código limpio en GREEN).
