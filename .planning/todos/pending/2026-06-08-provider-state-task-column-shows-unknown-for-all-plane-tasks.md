---
created: 2026-06-08T10:00:28.904Z
title: provider_state (columna task) muestra unknown para todas las tareas Plane
area: api
severity: major
milestone: v0.10
source: 43-HUMAN-UAT.md Test 1
files:
  - src/providers/plane/provider.js:70-87 (mapPlaneState)
  - src/providers/plane/provider.js:236-239 (getTaskState)
  - src/providers/plane/client.js:115-119 (getWorkItem, expand=state_detail)
  - src/server/provider-state.js (resolver)
  - src/cli/dashboard/format.js:201-207 (taskCell — render OK, no es el bug)
---

## Problem

La columna `task` del dashboard ink (Phase 43, eje `provider_state`) muestra `unknown`
para TODAS las tareas de Plane observadas durante el UAT humano — incluida la sesión
ACTIVA (ROMAN-162 / ROMAN-165 / ROMAN-170). Solo `KL-ok-1` muestra `?` (fetch-failed,
que sí es correcto).

El render de Phase 43 está verificado correcto (posición entre `status` y `age`, valor
verbatim, dim states). El `unknown` NO es un bug del render: lo produce upstream
`mapPlaneState` (src/providers/plane/provider.js), que devuelve `'unknown'` en la rama
`default`/`backlog` del switch sobre `state_detail.group`.

Señal de alarma: una tarea en la que se trabaja activamente debería estar en group
`started`/`unstarted` → `in_progress`, NO `unknown`. Que la activa caiga en `unknown`
sugiere que `state_detail.group` no llega desde `client.getWorkItem` (el `expand` no se
honra, o Plane devuelve el group con otra forma/capitalización que el switch no reconoce
→ siempre cae a `default`). Alternativa benigna: las tareas están realmente en `backlog`.

Impacto: el DRIVER del milestone v0.10 (ROMAN-150 — ver una tarea "In Review" tras
`/exit`) queda SIN demostrar empíricamente. No se puede cerrar v0.10 "limpio" sin
resolver esto.

## Solution

1. Diagnóstico (5-10 min): inspeccionar la respuesta CRUDA de `client.getWorkItem` para
   ROMAN-162/165 — ¿llega `state_detail.group`? ¿con qué valor exacto y capitalización?
   - Si `group` es `undefined` → el `expand=state_detail,project_detail` no se está
     honrando (o la respuesta anida el group en otra clave). Bug de fetch.
   - Si `group` llega como p.ej. `"Started"` (capitalizado) y el switch compara
     `'started'` lowercase → bug de mapeo (normalizar a lowercase antes del switch).
   - Si `group` es realmente `backlog` → comportamiento correcto; reconsiderar si
     colapsar todo lo no-trackeado a `unknown` es el UX deseado (opción: mostrar el
     nombre crudo del estado en vez de `unknown`).
2. Aplicar el fix mínimo según el hallazgo. Anti-ReDoS (D-10): seguir usando
   `String.includes`, jamás RegExp sobre el name del provider.
3. Re-verificar con una tarea real en "In Review" en Plane (cerrar ROMAN-150).
