---
status: complete
phase: 79-sidebar-doctor
source: [79-VERIFICATION.md]
started: 2026-07-23T08:40:00Z
updated: 2026-07-23T10:35:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Convergencia real del sidebar con `--fix` (SDR-05)
expected: Tras un pase de `--fix` con una sesión kodo suelta real, el workspace aparece agrupado bajo su grupo esperado en `cmux workspace-group list --json`; sin duplicados; una 2ª pasada del dry-run sale limpia (exit 0).
result: issue
reported: "Al ejecutar kodo sidebar doctor --fix se ha cargado una sesión en vivo y ha cerrado todo lo que había para meterlo en el grupo. Fatal!"
refined: "No se eliminó la sesión — el workspace vivo se convirtió en la base del grupo, perdiendo el título y demás info (al menos en la sidebar). Captura: sidebar muestra el grupo con entrada base sin título original."
severity: blocker

### 2. Supuestos A1/A2/A5 del binario cmux real
expected: `create` crea el grupo (el código no depende de su stdout — A1 informativo); `add` mueve/añade el workspace al grupo indicado (A2); los verbos mutan correctamente aunque kodo corra bajo daemon headless (A5 — relevante para Phase 80, no bloquea esta).
result: pass
notes: "A2 verificado manualmente: `cmux workspace-group add --group workspace_group:1 --workspace workspace:4` → OK. El verbo `add` requiere id de grupo (workspace_group:N) e id de workspace (workspace:N)."

### 3. D-04 — workspaces del operador intactos tras `--fix`
expected: Ningún workspace no-kodo (sin sesión en state.json) fue movido, re-anclado ni des-agrupado por el pase de `--fix`.
result: pass

## Summary

total: 3
passed: 2
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-79-1
  truth: "Tras un pase de `--fix` con una sesión kodo suelta real, el workspace aparece agrupado bajo su grupo esperado en `cmux workspace-group list --json`; sin duplicados; una 2ª pasada del dry-run sale limpia (exit 0)."
  status: failed
  reason: "User reported: Al ejecutar kodo sidebar doctor --fix se ha cargado una sesión en vivo y ha cerrado todo lo que había para meterlo en el grupo. Fatal! — Refinado tras inspección: la sesión NO se eliminó; el workspace vivo se convirtió en la BASE del grupo creado, perdiendo el título y demás info en la sidebar. Probable causa a investigar: el verbo `create` de cmux convierte/absorbe el workspace como base del grupo en vez de crear un grupo vacío, o el doctor pasa el workspace vivo como base al crear el grupo."
  severity: blocker
  test: 1
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis
