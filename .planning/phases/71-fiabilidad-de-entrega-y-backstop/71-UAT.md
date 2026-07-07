---
status: testing
phase: 71-fiabilidad-de-entrega-y-backstop
source: [71-VERIFICATION.md]
started: 2026-07-07T09:35:00Z
updated: 2026-07-07T09:35:00Z
---

## Current Test

number: 1
name: Backstop end-to-end contra Plane real
expected: |
  Matar una sesión kodo sin `/exit` limpio del LLM (provider Plane), con la tarea aún
  `in_progress`. Al `SessionEnd`, la tarea en Plane pasa a `In review` (o el `states.review`
  configurado) y recibe un comentario «cierre automático»; el evento NDJSON
  `session.backstop.review` se emite con `{session_id, task_id, from:'in_progress', to:reviewState}`.
awaiting: user response

## Tests

### 1. Backstop end-to-end contra Plane real
expected: La tarea en Plane transiciona a `In review` + comentario «cierre automático» + evento NDJSON `session.backstop.review`. (Provider Plane vivo; observar la UI. Cubre el happy-path que los mocks no sustituyen.)
result: [pending]

### 2. GitHub real — el backstop NUNCA cierra el issue
expected: En un repo GitHub real, un `SessionEnd` limpio con el issue aún `in_progress` deja el issue ABIERTO; se observa el log `session.backstop.skipped_terminal` en el NDJSON del hook. (Confirma contra la API real de GitHub el fix del gap 2 — el gate de estado no-terminal.)
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
