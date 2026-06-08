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

## Diagnóstico CONFIRMADO (2026-06-08, comprobación directa contra la API)

`client.getWorkItem(projectId, uuid)` y `getWorkItemBySequence` devuelven el work item
SIN `state_detail` (`undefined`), aunque la request incluye `expand=state_detail,project_detail`.
La API v1 de esta instancia (`tasks.kintsugi-lab.com`) NO puebla `state_detail` — el work
item solo trae `state` como UUID. Por tanto:

    detail.state         = 'cd88d322-1f54-4ba5-b756-42c89e393734'  (UUID)
    detail.state_detail  = undefined
    → mapPlaneState(undefined, undefined) → switch default → 'unknown'  (SIEMPRE)

No es el caso benigno "backlog": es un bug de fetch real, reproducible para todas las tareas.

El endpoint `/projects/{pid}/states/` SÍ devuelve `{id, name, group}` por estado (el mismo
que init usa para `stateCache`). Mapa real de ROMAN:
    Backlog→backlog · Todo→unstarted · In Progress→started · Done→completed ·
    Cancelled→cancelled · In review→started
ROMAN-162 (`cd88d322`) = **"Done" / completed** → debería renderizar `done`, no `unknown`.
"In review" existe (group started) → mapPlaneState lo caza por name.includes('review') →
`in_review`: el driver ROMAN-150 funcionaría tras el fix.

## Solution

En `getTaskState` (src/providers/plane/provider.js): dejar de leer `workItem.state_detail`.
En su lugar resolver `workItem.state` (UUID vivo, de getWorkItem) contra un mapa
UUID→`{name, group}` construido desde `listStates(projectId)` y cachearlo junto al
`stateCache` de init (que hoy solo guarda UUID→name; añadir el `group`). Refresco con el
INIT_TTL_MS=5min existente. Sigue siendo estado VIVO (el UUID viene de getWorkItem); solo
se cachea la metadata estable de definiciones de estado (las columnas del workflow, que no
cambian por tarea). El comentario actual "never relies on stateCache since state changes
after init" confunde la ASIGNACIÓN (cambia, viva) con las DEFINICIONES (estables, cacheables).

Anti-ReDoS (D-10): mantener `String.includes`, jamás RegExp sobre name/group del provider.
Re-verificar con una tarea real en "In review" (cerrar ROMAN-150).

Nota lateral (no bloqueante): PlaneClient constructor lee `config.plane.base_url` (schema v1)
en el fallback sin opts; loadConfig migra a `config.providers.plane`. Solo funciona porque el
factory siempre pasa opts. Fragilidad latente, fuera de scope de este todo.
