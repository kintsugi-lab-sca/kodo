---
status: partial
phase: 56-tecla-del-dashboard
source: [56-VERIFICATION.md]
started: 2026-06-17
updated: 2026-06-17
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live adoption flow (happy path)
expected: Con al menos una sesión `claude` ad-hoc viva en cmux (aún NO en `state.json`), pulsar `a` en el dashboard abre el picker overlay listando la(s) surface(s), el cursor empieza en 0, ↑/↓ lo mueven, pulsar `a` muestra `ADOPT_CONFIRM`, una segunda `a` shellea `kodo adopt`, y en éxito el footer muestra verde `adopted <ref>…`; la fila aparece trackeada en el siguiente poll de `/status`.
result: [pending]

### 2. Empty discovery path
expected: Sin sesiones ad-hoc adoptables (todas ya en `state.json`, o el host no soporta `listAgentSurfaces`), pulsar `a` muestra el footer informativo `no adoptable sessions found` y NO abre overlay.
result: [pending]

### 3. No/ambiguous project guard
expected: Con una surface cuyo `cwd` no mapea a ningún proyecto de `~/.kodo/projects.json` (o mapea ambiguamente), confirmar la adopción muestra el footer never-throws apuntando al CLI (`adopt via kodo adopt --project <id>`) y NO shellea; el panel ink permanece montado.
result: [pending]

### 4. Pitfall 2 — confirm-key isolation in live TTY
expected: `a` (adopt) y `d` (dismiss) permanecen aislados en sus respectivos flujos de double-confirm; armar uno no dispara el otro. Cubierto por `app-dismiss.test.js` + `app-adopt.test.js` con stubs; el TTY real confirma que el aislamiento es perceptible para el operador.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
