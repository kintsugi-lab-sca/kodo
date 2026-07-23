---
status: testing
phase: 80-carril-orquestador-reconciliaci-n-documental
source: [80-VERIFICATION.md]
started: 2026-07-23T20:25:00Z
updated: 2026-07-23T20:25:00Z
---

## Current Test

number: 1
name: Convergencia real del sidebar en ≤1 pase motivado (SC1 ROADMAP, T5 80-01)
expected: |
  Tras un pase de `kodo check` ya motivado (stuck/review/pending), el sidebar de cmux
  muestra el workspace suelto ya agrupado (o el grupo vacío disuelto) sin intervención
  humana, con la línea `[kodo:check] Sidebar: N acción(es) aplicadas` en la salida.
  Un 2º pase motivado inmediato no vuelve a mover nada (`Sidebar: 0 acción(es) aplicadas`).
awaiting: user response

## Tests

### 1. Convergencia real del sidebar en ≤1 pase motivado (SC1 ROADMAP, T5 80-01)
expected: Lanzar (o dejar) una sesión kodo con su workspace suelto de su grupo cmux esperado, o un grupo cmux vacío tras cerrar sus miembros. Disparar un pase de `kodo check` que ya esté motivado por otra razón (sesión stuck, en review, o con tareas pendientes). Observar `[kodo:check] Sidebar: N acción(es) aplicadas` y confirmar en la sidebar real de cmux que el workspace quedó agrupado / el grupo vacío se disolvió. Un 2º pase motivado inmediato ejecuta 0 acciones.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
