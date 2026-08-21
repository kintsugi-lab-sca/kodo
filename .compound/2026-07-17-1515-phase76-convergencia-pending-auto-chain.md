---
fecha: 2026-07-17
proyecto: kodo
slug: phase76-convergencia-pending-auto-chain
---

## Resumen
Cadena `--auto` completa de la Phase 76 (discuss → plan → execute → verify): ORCH-05/ORCH-06 cerrados extrayendo el carril `pending` a la hoja de cero imports `src/tasks/pending.js` (dos exports: `fetchFreshPending` crudo para check, `createPendingResolver` TTL discriminado `{tasks, fetched_at, stale}` para `/status`) + campos aditivos `pending_stale`/`pending_fetched_at`.
Verificación 11/11 must-haves PASSED, suite 2271 verde, code review 0 blockers / 4 warnings advisory; fase marcada completa en ROADMAP/STATE/REQUIREMENTS/PROJECT.

## Reto
El gate post-merge de la wave 1 falló con 3 tests flaky bajo carga de suite completa (el `gsd-lock-race` ya documentado + 2 subtests de `dashboard-table` ajenos a la superficie tocada) — hubo que discriminar flaky-vs-regresión con re-runs aislados antes de continuar; el flaky de `dashboard-table` (orden DESC/selección con timestamps) no estaba documentado y puede volver a ensuciar gates.

## Propuesta de skill
Un skill `flaky-triage` que, ante un gate de tests fallido, re-ejecute automáticamente solo los ficheros fallidos N veces aislados + compare con la superficie del diff de la wave, y emita verdicto flaky/regresión con evidencia — hoy ese triage es manual en cada gate.
