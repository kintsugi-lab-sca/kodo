---
status: partial
phase: 36-tabla-viva-render-seleccion-filtros
source: [36-VERIFICATION.md]
started: 2026-05-28
updated: 2026-05-28
---

## Current Test

[awaiting human testing in a real TTY]

## Tests

### 1. Layout visual de la tabla
expected: En `kodo dashboard` con el server vivo y ≥3 sesiones, la tabla muestra las columnas `task_ref · repo · phase/mode · status · age` con anchos fijos alineados; los valores largos se truncan con `…` sin romper la alineación de columnas.
result: [pending]

### 2. Color semántico visible
expected: Las filas se colorean por `status`+`alive` en TTY real — `running`+alive en verde, zombie `running`+`!alive` en rojo con marca textual `(zombie)`, `review` en cyan, `error` en magenta, `done` atenuado. El indicador del header muestra `● live` verde (o `⚠ server caído` amarillo en degradación).
result: [pending]

### 3. UX del filtro modal
expected: Pulsar `/` abre la línea de filtro al pie (`/ <query>▏`); teclear filtra en vivo; prefijos `r:`/`s:` combinan (AND); `Esc` cancela y sale del filtro (y NO sale en modo lista); `Enter` confirma; al limpiar un filtro sin coincidencias el cursor vuelve a la sesión seleccionada originalmente (no salta a la primera fila). Navegación ↑/↓ con cursor estable por identidad.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
