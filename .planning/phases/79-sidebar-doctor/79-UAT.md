---
status: testing
phase: 79-sidebar-doctor
source: [79-VERIFICATION.md]
started: 2026-07-23T08:40:00Z
updated: 2026-07-23T08:40:00Z
---

## Current Test

number: 1
name: Convergencia real del sidebar con `--fix` (SDR-05)
expected: |
  Con ≥1 sesión kodo suelta real (workspace vivo en state.json sin su grupo esperado):
  1. `kodo sidebar doctor` (dry-run) lista la acción (`add` o `create`+`add`+`set-anchor`) y sale con exit 1.
  2. `kodo sidebar doctor --fix` ejecuta el allowlist.
  3. `cmux workspace-group list --json` muestra el workspace dentro de `member_workspace_refs` del grupo esperado, sin grupos duplicados.
awaiting: user response

## Tests

### 1. Convergencia real del sidebar con `--fix` (SDR-05)
expected: Tras un pase de `--fix` con una sesión kodo suelta real, el workspace aparece agrupado bajo su grupo esperado en `cmux workspace-group list --json`; sin duplicados; una 2ª pasada del dry-run sale limpia (exit 0).
result: [pending]

### 2. Supuestos A1/A2/A5 del binario cmux real
expected: `create` crea el grupo (el código no depende de su stdout — A1 informativo); `add` mueve/añade el workspace al grupo indicado (A2); los verbos mutan correctamente aunque kodo corra bajo daemon headless (A5 — relevante para Phase 80, no bloquea esta).
result: [pending]

### 3. D-04 — workspaces del operador intactos tras `--fix`
expected: Ningún workspace no-kodo (sin sesión en state.json) fue movido, re-anclado ni des-agrupado por el pase de `--fix`.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
