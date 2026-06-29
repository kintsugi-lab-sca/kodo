---
phase: 58-ciclo-de-vida-de-cierre-deuda-heredada-de-v0-12
plan: 01
status: complete
requirements_completed: [LIFE-03, DEBT-01]
requirements_human_needed: [DEBT-02]
subsystem: hooks, session-lifecycle
completed: 2026-06-19
tags: [hooks, session-end, stop, lifecycle, worktree, idempotency, xss]
---

# Phase 58 Plan 01: Hook SessionEnd + deuda v0.12 — Summary

**kodo ahora escucha `SessionEnd`: el cleanup terminal destructivo (removeSession + worktree + promptFile) ocurre UNA vez al cierre real de la sesión (`/exit`), mientras `Stop` (per-turn) queda solo para el estado ligero (idle/lock/color/nudge). Una sesión cerrada desaparece del dashboard en vez de quedar colgada como `dead`.**

## Decisiones de diseño (locked en discuss, 58-CONTEXT.md)

- **D-1 Stop→idle / SessionEnd→cleanup terminal** (helper compartido, sin duplicar).
- **D-2 Conservar el rescate desde history** de reconcileTick como defensa en profundidad (reconcile.js NO tocado).
- **D-3 Idempotencia por guard `source==='history'`** (espejo del existente), cero estado nuevo.
- **D-4 never-throws / fail-open**, install/uninstall al tercer evento, golden-bytes preservados.

## Accomplishments

1. **`src/hooks/terminal-cleanup.js`** — helper `performTerminalCleanup` (worktree + promptFile + removeSession), fail-open por paso, reusa `cleanupWorktree` (Phase 41).
2. **`src/hooks/session-end.js`** — `runSessionEndHook(input, deps)` espejo de runStopHook: guards de idempotencia → typed session.end event (movido desde Stop) → lock backstop → performTerminalCleanup. never-throws.
3. **`src/hooks/stop.js`** — refactor: quitado el cleanup destructivo + el typed event; conservado idle/lock/color/nudge/orchestrator. Imports y deps muertos (removeSession/removePromptFile/gitFn) eliminados.
4. **`src/hooks/install.js`** — `SessionEnd` registrado + uninstall extendido, sin clobber.
5. **Tests** — nuevo `test/hooks/session-end.test.js` (7) + cobertura SessionEnd en install.test.js; migrados stop-worktree-cleanup / stop-idempotency a runSessionEndHook; ajustados stop-state-transition / stop.test.js source-hygiene al split.

## DEBT-01 (XSS WR-01) — ya cerrado
El item estaba stale: mitigado en `77a5c0c` (allowlist safeHref http(s)). Test de regresión `test/server-xss-allowlist.test.js` (`976f8a6`).

## DEBT-02 (HUMAN-UAT 50.1) — pendiente humano
Los 3 escenarios del progreso vivo `N/M` requieren TTY real con sesión GSD viva. Solo el operador. VERIFICATION.md status=human_needed.

## Tests
- `npm test` → 1499 pass / 0 fail / 1 skip.
- Walkers `format-isolation` + `cmux-isolation` → 8 pass.

## Key Files
- created: `src/hooks/terminal-cleanup.js`, `src/hooks/session-end.js`, `test/hooks/session-end.test.js`, `test/server-xss-allowlist.test.js`
- modified: `src/hooks/stop.js`, `src/hooks/install.js`, `test/stop.test.js`, `test/stop-worktree-cleanup.test.js`, `test/stop-state-transition.test.js`, `test/hooks/stop-idempotency.test.js`, `test/hooks/install.test.js`

## Limitación conocida
DEBT-02 (HUMAN-UAT 50.1) no se puede automatizar — requiere TTY real. El milestone v0.13 se cierra en CÓDIGO; la verificación humana del display de progreso vivo es la única deuda pendiente (reconocida, no bloqueante para el código).
</content>
