---
created: 2026-06-08T16:00:20.642Z
title: Reconcile keyea por workspace_ref reciclado → sesiones fantasma se quedan alive
area: general
severity: major
milestone: v0.10 (surfaced) — origen v0.9 Phase 38
source: dogfooding dashboard 2026-06-08 (ROMAN-160/167 cerradas en cmux pero idle)
files:
  - src/session/reconcile.js:79,93,148 (liveByRef keyed by workspace_ref)
  - src/host/cmux.js:94-105 (listWorkspaces → WorkspaceInfo, alive:true por presencia)
  - src/host/interface.js:16-18 (WorkspaceInfo: workspace_ref/alive/needs_input)
---

## Problem

cmux REUTILIZA los índices `workspace:N` cuando se cierra una tab y se crea otra.
La reconciliación host↔state (Phase 38) keyea la liveness por `session.workspace_ref`
(`liveByRef.get(session.workspace_ref)`), pero ese ref NO es identidad única estable.

Resultado: una sesión cerrada cuyo `workspace:N` fue reasignado a una sesión NUEVA y
viva hereda su `alive` → se queda `idle` para siempre (deriveTarget ve `live` presente).

Evidencia en vivo (2026-06-08):
  ROMAN-160 (optiai, session 319a60eb) ws_ref=workspace:4  ← stale
  ROMAN-170 (fvf,    session c7f85c74) ws_ref=workspace:4  ← vivo  → 160 viaja de polizón
  ROMAN-167 (fvf,    session d722d7dc) ws_ref=workspace:10 ← stale
  ROMAN-171 (fvf,    session 433bf4f2) ws_ref=workspace:10 ← vivo  → 167 de polizón

ROMAN-160 tiene `dead_since` puesto pero state=idle → ping-pong: se marca dead cuando
:4 desaparece un tick, y revive cuando cmux reasigna :4 a 170 (deriveTarget→idle, o el
rescate-desde-history reconcile.js:143-168, que también keyea por workspace_ref).

Identidad durable disponible: `session_id` (UUID) / `worktree_path`
(/...//.bg-shell/<session_id>). cmux `list-workspaces` NO expone session_id; su
`current_directory` es el path del PROYECTO (compartido por varias sesiones del mismo
repo → no distingue). La única señal de identidad en list-workspaces es el `title`
(kodo lo fija con el task_ref: "ROMAN-170 [FVF]: …").

Impacto: sesiones muertas no se detectan como dead → se acumulan en el dashboard como
`idle` y NO se pueden dismissear (el guard `alive` las bloquea). El dismiss en sí es
seguro (keyea por task_id, no workspace_ref → sanea el worktree correcto; cero borrado
cruzado). El defecto es de DETECCIÓN, no destructivo.

## Solution (opciones — requiere decisión de join key)

A. **Verificar identidad en el match (recomendado, acotado):** añadir `title` a
   WorkspaceInfo (host/interface.js + cmux.js); en reconcile, considerar `live` válido
   SOLO si `live` existe Y su identidad casa con la sesión (title contiene task_ref con
   límite de palabra — ojo ROMAN-17 vs ROMAN-170). Si el ref fue reciclado a otro task,
   la verificación falla → la sesión va a dead. Cambio en el contrato WorkspaceHost
   (Phase 38) + lógica de match + tests. Anti-ReDoS: match por substring/segmentos, no RegExp sobre title.

B. **Join por session_id real:** que kodo etiquete el workspace cmux con el session_id
   (si cmux lo permite vía metadata/título estructurado) y reconcile joinee por eso.
   Más robusto, más trabajo, depende de capacidades de cmux.

C. **Invalidar workspace_ref al cerrar:** detectar el reciclado comparando title del ref
   actual contra el esperado y limpiar el ref stale. Variante de (A).

Recomendación: (A) — usa la única señal de identidad que cmux ya expone (title con
task_ref), cambio contenido en la capa Phase 38. Validar con el caso real (160/167).

NOTA: no es Phase 43 ni los 2 fixes de hoy. Es deuda arquitectónica de v0.9 (la
suposición "workspace_ref = identidad canónica" en host/interface.js:16 es falsa porque
cmux recicla el índice). Probablemente merece su propia fase/tarea con decisión de diseño.

## RESOLVED 2026-06-08 (commit 9b090cd) — opción A + fix del debounce

Dos síntomas del mismo origen (cmux recicla workspace:N), ambos arreglados:
1. Match identidad-verificado: WorkspaceInfo expone `title`; `liveForSession` exige
   que el title identifique a la sesión (token con límite de palabra, anti-ReDoS).
   Ref reciclado a otro task -> dead. Compat: host sin title -> comportamiento previo.
2. `debounceStore` keyed por `task_id` (no `workspace_ref`): dos sesiones que comparten
   un ref reciclado ya no pelean por la misma entrada de debounce (era por lo que
   ROMAN-160 no llegaba a dead aun con el guard de (1)).
Verificado en vivo read-only: ROMAN-160/167 -> dead; 170/159 intactas. Suite 1213 pass.
