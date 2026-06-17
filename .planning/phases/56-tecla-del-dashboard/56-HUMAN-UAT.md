---
status: partial
phase: 56-tecla-del-dashboard
source: [56-VERIFICATION.md]
started: 2026-06-17
updated: 2026-06-17
---

## Current Test

[testing paused — blocker found on Test 1]

## Tests

### 1. Live adoption flow (happy path)
expected: Con al menos una sesión `claude` ad-hoc viva en cmux (aún NO en `state.json`), pulsar `a` en el dashboard abre el picker overlay listando la(s) surface(s), el cursor empieza en 0, ↑/↓ lo mueven, pulsar `a` muestra `ADOPT_CONFIRM`, una segunda `a` shellea `kodo adopt`, y en éxito el footer muestra verde `adopted <ref>…`; la fila aparece trackeada en el siguiente poll de `/status`.
result: issue
reported: "El adopt no ha funcionado: no ha hecho nada tras confirmar; la sesión adoptada no aparece como fila en el dashboard."
severity: blocker
root_cause: |
  El picker y el núcleo discrepan en la IDENTIDAD de sesión.
  - Phase 56 `computeAdoptable` (select.js) keyea por `sessionId` (correcto, Phase 55 D-06: nunca workspaceRef).
  - Phase 53 `adoptSession` guard de idempotencia (src/adopt.js:201-205) keyea por `{ workspaceRef, cwd }` → `findSession({workspaceRef, cwd})`, NO por sessionId.
  Con dos sesiones claude ad-hoc en el MISMO cwd (f5969cde y 0b748c77, ambas /Users/alex/dev/klab/kodo), el dashboard ofrece 0b748c77 como adoptable (por sessionId), pero el núcleo lo matchea contra una sesión previa ya adoptada en ese mismo cwd/workspace → devuelve ALREADY_ADOPTED (exit 0) → runAdopt lee exit 0 → footer verde "adopted…" → pero NO crea nada nuevo y la fila no aparece ("no ha hecho nada").
  Secundario: ALREADY_ADOPTED mapea a exit 0 (idempotente por diseño, adopt.js:147-148), así que runAdopt/App.js no pueden distinguir un adopt real de un no-op duplicado — el footer verde es engañoso.

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
issues: 1
pending: 3
skipped: 0
blocked: 0

## Gaps

- truth: "Adoptar una sesión ad-hoc descubierta la convierte en una tarea trackeada visible en el dashboard"
  status: failed
  reason: "Identity mismatch: computeAdoptable (Phase 56) keys by sessionId; adoptSession idempotency guard (Phase 53 src/adopt.js:201-205, findSession) keys by {workspaceRef, cwd}. Two ad-hoc sessions sharing a cwd → core falsely returns ALREADY_ADOPTED (exit 0) for a genuinely-new session → green 'adopted' footer but no task created, no row appears."
  severity: blocker
  test: 1
  artifacts:
    - src/adopt.js:201-205    # findSession({workspaceRef, cwd}) — wrong key
    - src/session/state.js    # findSession impl (match predicate)
    - src/cli/adopt.js:147-148 # ALREADY_ADOPTED → exit 0 (ambiguous to runAdopt)
    - src/cli/dashboard/select.js # computeAdoptable keys by sessionId (correct, source of disagreement)
  missing:
    - "findSession/adopt guard keyed by sessionId (== resume_binding.checkpoint_id), consistent with Phase 55 D-06 + Phase 56 computeAdoptable"
    - "A way for runAdopt/App.js to distinguish a real adopt from an ALREADY_ADOPTED no-op (so the footer doesn't show false success)"

- truth: "(secondary) ad-hoc claude session at ~/dev/roman/fvf appears as adoptable"
  status: not_a_bug
  reason: "The fvf surface (sessionId 72ac6713) IS the kodo-launched ROMAN-182 session already in state.json — computeAdoptable correctly excludes it. Working as designed."
  test: 1
