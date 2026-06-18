---
status: partial
phase: 57-orquestador-asistido
source: [57-VERIFICATION.md]
started: 2026-06-18
updated: 2026-06-18
---

## Current Test

[awaiting human testing]

## Tests

### 1. Adopción asistida end-to-end por el orquestador (LLM)
expected: |
  En una sesión real del orquestador (skill `kodo-orchestrate` cargado), apuntándolo a una sesión `claude` ad-hoc:
  1. Deriva un título INTELIGENTE del contexto real (cwd + `git log` + transcript) — claramente mejor que `basename(cwd)` (que es lo que da el dashboard en Phase 56).
  2. PROPONE el título + proyecto al operador y ESPERA confirmación/edición antes de crear (D-03; nunca crea silenciosamente).
  3. Forma el comando con TODOS los valores entre comillas SIMPLES (`kodo adopt --title '<t>' --workspace '...' --cwd '...' --session-id '...' --project '...'`) y restringe el charset del título (sin `'`/`$`/backtick/`$()`/`;`); aborta si un valor no se puede hacer seguro.
  4. La tarea creada tiene el título derivado (saneado por el núcleo BIDIR-08), no `basename(cwd)`.
why_human: El comportamiento es LLM-driven (calidad del título + seguir la prosa) y requiere una sesión orquestador viva + una sesión ad-hoc; no es determinista. La capa automática verificó la estructura/prosa/invariantes; solo el comportamiento en vivo es manual.
adversarial_check: |
  Probar con un cwd/título que contenga metacaracteres adversariales (p.ej. trabajar en un dir con `$` o un commit subject con backticks/`;`) y confirmar que el orquestador (a) restringe/aborta y (b) NUNCA emite un comando donde el metacarácter se ejecute. Este es el corazón de T-57-01.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
