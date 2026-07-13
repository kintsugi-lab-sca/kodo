---
status: testing
phase: 72-higiene-dx-y-verdad-documental
source: [72-VERIFICATION.md]
started: 2026-07-13T15:30:00Z
updated: 2026-07-13T15:30:00Z
---

## Current Test

number: 1
name: Propagación empírica de KODO_ORCHESTRATOR=1 al hook del orquestador (D5)
expected: |
  Lanzar el orquestador real (`kodo orchestrate`) en un workspace cmux+claude vivo.
  Al cerrar esa sesión orquestadora con cambios en .claude/skills/kodo-orchestrate/,
  el stop hook DEBE auto-commitear (la env var cruza como prefijo del command string
  vía cmux.send, no como env de spawn — es lo que se verifica).
  Comprobación inversa: una sesión NORMAL en el repo kodo con cambios staged ajenos
  NO debe auto-commitear nada (gate cerrado sin la var).
awaiting: user response

## Tests

### 1. Propagación empírica de KODO_ORCHESTRATOR=1 al hook del orquestador (D5)
expected: Sesión orquestadora real auto-commitea la skill con pathspec `.claude/skills/kodo-orchestrate/`; sesión normal no auto-commitea. El modo de fallo es seguro por diseño (sin var → skip, cero commits fantasma).
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
