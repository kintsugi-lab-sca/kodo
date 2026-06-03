# Phase 39: Paneles auxiliares — comentarios + logs - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-02
**Phase:** 39-paneles-auxiliares-comentarios-logs
**Areas discussed:** Todo provider-state, Comentarios UI, Logs honestidad, Estados vacíos, Overlay+polling, Scroll overlay

---

## Todo provider-state (cross-reference)

| Option | Description | Selected |
|--------|-------------|----------|
| Diferir | Backlog; Phase 39 mantiene su scope (overlays c/l) | ✓ |
| Foldear en Phase 39 | Ampliar scope para incluir estado del provider | |

**User's choice:** Diferir
**Notes:** El todo (score 0.9, "Surface provider state in dashboard") es capacidad nueva ortogonal a comentarios/logs. Driver real ROMAN-150. Candidata a fase propia v0.10+.

---

## Comentarios UI

| Option | Description | Selected |
|--------|-------------|----------|
| Overlay a pantalla completa | Panel ocupa el área de la tabla; Esc vuelve al cursor | ✓ |
| Panel lateral/inferior | Sección bajo la tabla, tabla visible pero compite por espacio | |

**User's choice:** Overlay a pantalla completa
**Notes:** Espejo del patrón modal de filtro existente.

---

## Logs honestidad

| Option | Description | Selected |
|--------|-------------|----------|
| Etiqueta + grep substring | Header honesto "may include other sessions"; grep task_ref/workspace_ref | ✓ |
| Solo líneas con match exacto | Parsear session_id/task_id por línea | |

**User's choice:** Etiqueta + grep substring
**Notes:** Cumple SC#3 ROADMAP. El buffer /logs no garantiza session_id → match exacto arriesga overlay vacío.

---

## Estados vacíos

| Option | Description | Selected |
|--------|-------------|----------|
| Mensajes distintos por caso | vacío / 404 / error / no-match diferenciados | ✓ |
| Mensaje genérico | Un solo "nothing to show" | |

**User's choice:** Mensajes distintos por caso
**Notes:** Espejo del manejo never-throws discriminado de fetchStatus.

---

## Overlay + polling

| Option | Description | Selected |
|--------|-------------|----------|
| Snapshot congelado | Contenido fijo al abrir; polling de tabla sigue por debajo | ✓ |
| Refresco en vivo | Re-consulta cada poll; contenido salta | |

**User's choice:** Snapshot congelado
**Notes:** Evita que el texto salte mientras el operador lee.

---

## Scroll overlay

| Option | Description | Selected |
|--------|-------------|----------|
| Mostrar lo que cabe + truncar | Primeras/últimas N líneas + "… N more", sin scroll | |
| Scroll con flechas | ↑/↓ scrollean dentro del overlay | ✓ |

**User's choice:** Scroll con flechas
**Notes:** Exige sub-modo de input (overlay-scroll vs list-nav). Documentado en D-06 para el planner.

---

## Claude's Discretion

- Anchos/layout exactos del overlay (header/body/footer), respetando color-isolation.
- Tecla de cierre adicional (¿`q` además de Esc?).
- Tamaño del viewport del scroll / nº de líneas.

## Deferred Ideas

- **Surface provider state in dashboard** — capacidad nueva, candidata a fase propia v0.10+ (ROMAN-150 driver).
