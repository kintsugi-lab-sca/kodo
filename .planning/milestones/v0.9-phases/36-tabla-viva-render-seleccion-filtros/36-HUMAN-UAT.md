---
status: passed
phase: 36-tabla-viva-render-seleccion-filtros
source: [36-VERIFICATION.md]
started: 2026-05-28
updated: 2026-05-28
approved_by: human
approved_at: 2026-05-28
fixture: scripts/dev-dashboard-fixture.mjs
hot_patches_validated: [116cb1e (alt-screen), ca61733 (bold+gutter)]
---

## Current Test

[all passed — UAT closed]

## Tests

### 1. Layout visual de la tabla
expected: En `kodo dashboard` con el server vivo y ≥3 sesiones, la tabla muestra las columnas `task_ref · repo · phase/mode · status · age` con anchos fijos alineados; los valores largos se truncan con `…` sin romper la alineación de columnas.
result: passed
verified_via: fixture server (`scripts/dev-dashboard-fixture.mjs`) — 6 filas alineadas en TTY real, sin desbordes.

### 2. Color semántico visible
expected: Las filas se colorean por `status`+`alive` en TTY real — `running`+alive en verde, zombie `running`+`!alive` en rojo con marca textual `(zombie)`, `review` en cyan, `error` en magenta, `done` atenuado. El indicador del header muestra `● live` verde (o `⚠ server caído` amarillo en degradación).
result: passed
verified_via: fixture cubre los 6 estados (VAMP-7/12 green, KL-42 red+`(zombie)`, KL-99 cyan, ORCA-3 magenta, KL-7 dim). Indicador live verde confirmado contra server vivo en sesiones reales.

### 3. UX del filtro modal
expected: Pulsar `/` abre la línea de filtro al pie (`/ <query>▏`); teclear filtra en vivo; prefijos `r:`/`s:` combinan (AND); `Esc` cancela y sale del filtro (y NO sale en modo lista); `Enter` confirma; al limpiar un filtro sin coincidencias el cursor vuelve a la sesión seleccionada originalmente (no salta a la primera fila). Navegación ↑/↓ con cursor estable por identidad.
result: passed
verified_via: prefijos `r:vamp` / `s:review` combinables verificados; Esc modal-scope OK; **regresión CR-01 confirmada en vivo** (seleccionar KL-99 → `/noexiste` → `no sessions match` → Esc → cursor vuelve a KL-99). Selected-row con bold + gutter `›` (no inverse) tras hot-patch `ca61733`. Sin frames apilados al redimensionar tras hot-patch `116cb1e`.

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

(none)
