---
status: partial
phase: 43-render-provider-state-en-el-dashboard
source: [43-VERIFICATION.md]
started: 2026-06-08T07:56:53.423Z
updated: 2026-06-08T07:56:53.423Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Render visual de la columna `task` en terminal real
expected: La columna dedicada `task` aparece entre `status` y `age`, ancho 12 con truncado-end de ink; el valor crudo de `provider_state` (ok) se lee en texto plano sin color propio, `—` (unsupported) y `?` (fetch-failed) se ven atenuados (dim). Legibilidad correcta con sesiones reales.
result: [pending]

### 2. Filtro `ps:` end-to-end en terminal
expected: En modo filtro, teclear `ps:review` acota las filas por `provider_state` vía substring case-insensitive; el camino completo `stdin → parseFilter → applyFilter → SessionTable → frame` funciona. Eje separado del `s:` (estado local v3, match exacto). No existe test de integración render para esto (IN-01 del code review).
result: [pending]

### 3. Footer hint visible
expected: El footer muestra `↑↓ move · / filter (ps:state) · d dismiss · q quit` y el hint `(ps:state)` es legible en distintas anchuras de terminal.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
