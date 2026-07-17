---
status: complete
phase: 75-superficie-del-next-dashboard-y-nudge
source: [75-VERIFICATION.md]
started: 2026-07-17T11:05:00Z
updated: 2026-07-17T11:35:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Columna `next` con dato vivo en el dashboard real
expected: En el dashboard TUI (`kodo dashboard`), con al menos una tarea con `NEXT:` persistido en `state.json`, la columna `next` aparece al final de la tabla con el dato vivo, truncado con ellipsis si excede el ancho; sin dato, celda vacía sin placeholder.
result: pass
notes: |
  Verificado en vivo por el operador (delegado a Claude con seed mock, sembrado vía writers de
  producción addSession/upsertTaskHandoff bajo lock). Captura de la TUI real (cmux workspace):
  columna `next` al final del orden, fila UAT-75 con «Configurar el webhook de Plane y relanz…»
  (truncado con ellipsis nativo), fila UAT-75B con celda vacía sin placeholder (criterio 5).
  Las filas zombie (workspace inexistente) renderizaron sin crash — TUI never-throws.
  Incidencia inicial reportada ({"error":"unauthorized"}) diagnosticada como NO-gap: era el
  default-deny de v0.16 sobre el dashboard WEB abierto sin ?token= (por diseño, D-05 Phase 69);
  la superficie de la fase 75 es la TUI.

### 2. Entrega real del nudge con contexto al orquestador
expected: Al cerrar una sesión cuya tarea dejó (o heredó) un `NEXT:`, el nudge recibido en el workspace `kodo-orchestrator` (vía cmux) incluye la línea «Siguiente paso sugerido por la sesión: …» — no el texto genérico.
result: pass
notes: |
  Verificado end-to-end por el código REAL: runSessionEndHook disparado sobre la sesión mock
  (provider anulado por DI — cero red; cmux real). La cadena completa funcionó: detección del
  bloque por marcador de sesión → extractNext → upsert en state.tasks (devolvió el entry
  persistido) → threading post-upsert → buildStopNudgeText añadió la línea ES → cmux send
  entregó al workspace kodo-orchestrator (temporal, shell plano). Captura del workspace:
  texto por-modo base + «Siguiente paso sugerido por la sesión: Configurar el webhook de
  Plane y relanzar el polling con el token nuevo (mock UAT-75)».

### 3. Fidelidad del render markdown best-effort (backstop)
expected: Desde una fila no-GSD (`phaseId == null`) con un plan ligero real (headings, `**Label:**`, bullets, code fences, marcador `kodo:handoff`, handoffs acumulados), pulsar `p` muestra el markdown renderizado read-only, el marcador NO aparece, `Esc` preserva el cursor, y el operador confirma que la fidelidad line-based es suficiente para LIVE-06.
result: pass
notes: |
  Verificado en la TUI real: overlay `plan · UAT-75` read-only con footer «↑↓ scroll · Esc close»;
  el heading de handoff renderiza «## Handoff 2026-07-17 13:15» con el marcador
  `<!-- kodo:handoff … -->` INVISIBLE (strip D-06 cumple la promesa de 74 D-01); headings,
  labels, bullets y fences presentes line-based; `Esc` volvió a la lista con el cursor en la
  misma fila (task_id). Caveat explícito del contrato best-effort: los caracteres `#`/`**`
  inline permanecen visibles (solo styling por línea, sin parsing inline) — dentro del alcance
  declarado (NO CommonMark); si al operador le molesta en uso real, es fricción para v0.18,
  no un gap de esta fase.

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
