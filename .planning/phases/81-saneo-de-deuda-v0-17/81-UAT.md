---
status: testing
phase: 81-saneo-de-deuda-v0-17
source: [81-VERIFICATION.md]
started: 2026-07-24T08:22:00Z
updated: 2026-07-24T08:22:00Z
---

## Current Test

number: 1
name: Disposición de WR-01/WR-02 (hallazgos del code review propio de la fase)
expected: |
  Una decisión explícita del mantenedor — (a) corregir el typedef `TaskHandoff`
  (`src/session/state.js:53`, aún documenta la semántica PRE-DEBT-01) y alinear
  `deriveAnyNext` (`src/cli/dashboard/select.js:258`) con el colapso de whitespace
  de `nextCell` (`src/cli/dashboard/format.js`), o (b) aceptar/diferir ambos
  explícitamente como deuda conocida (nota en STATE.md §Deferred Items o item de
  backlog), igual que 75/WR-02 y 75/WR-04 fueron absorbidos como DEBT-02.
awaiting: user response

## Tests

### 1. Disposición de WR-01/WR-02 (hallazgos del code review propio de la fase)
expected: Decisión explícita — arreglar antes de dar la fase por cerrada (typedef `TaskHandoff` + `deriveAnyNext`↔`nextCell`), o diferir con constancia escrita. Evidencia confirmada y reproducida en 81-REVIEW.md y 81-VERIFICATION.md §Anti-Patterns; 0 blockers, no son must_haves literales.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
