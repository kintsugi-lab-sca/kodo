---
status: testing
phase: 75-superficie-del-next-dashboard-y-nudge
source: [75-VERIFICATION.md]
started: 2026-07-17T11:05:00Z
updated: 2026-07-17T11:05:00Z
---

## Current Test

number: 1
name: Columna `next` con dato vivo en el dashboard real
expected: |
  La celda `next` muestra el valor real del `NEXT:` de la tarea, truncado con ellipsis si
  excede el ancho de columna; en tareas sin dato, la celda queda vacía y sin ruido visual.
awaiting: user response

## Tests

### 1. Columna `next` con dato vivo en el dashboard real
expected: En el dashboard TUI (`kodo dashboard`), con al menos una tarea con `NEXT:` persistido en `state.json`, la columna `next` aparece al final de la tabla con el dato vivo, truncado con ellipsis si excede el ancho; sin dato, celda vacía sin placeholder.
result: [pending]

### 2. Entrega real del nudge con contexto al orquestador
expected: Al cerrar una sesión cuya tarea dejó (o heredó) un `NEXT:`, el nudge recibido en el workspace `kodo-orchestrator` (vía cmux) incluye la línea «Siguiente paso sugerido por la sesión: …» — no el texto genérico.
result: [pending]

### 3. Fidelidad del render markdown best-effort (backstop)
expected: Desde una fila no-GSD (`phaseId == null`) con un plan ligero real (headings, `**Label:**`, bullets, code fences, marcador `kodo:handoff`, handoffs acumulados), pulsar `p` muestra el markdown renderizado read-only (headings bold/cyan, labels bold, bullets planos, fences dim), el marcador NO aparece, `Esc` preserva el cursor, y el operador confirma que la fidelidad line-based es suficiente para LIVE-06.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
