# Phase 36: Tabla viva — render + selección + filtros - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-27
**Phase:** 36-tabla-viva-render-seleccion-filtros
**Mode:** `--auto` (autonomous single-pass — Claude selected the recommended option for every gray area; no interactive prompts)
**Areas discussed:** Tabla columnar (render/layout/columnas), Selección por task_id, Color semántico, Filtros

---

## Tabla columnar — render, anchos, mapeo de columnas, formato de age

| Option | Description | Selected |
|--------|-------------|----------|
| ink puro `<Box>`/`<Text>`, anchos fijos + truncado, age humanizado desde `elapsed_min` | Render React-free-of-picocolors; columnas estáticas con ellipsis; `repo`/`phase·mode` derivados (no son campos directos) | ✓ |
| Reusar `formatTable`/`formatRow` de `src/cli/format.js` | Helper de tabla existente del CLI clásico | (descartado: usa picocolors → rompe color-isolation D-12) |
| Layout responsive al ancho de terminal | Recompute de anchos según `process.stdout.columns` | (deferido — YAGNI en esta fase) |

**Selección:** opción recomendada. **Notas:** grounding crítico capturado en D-03 — `repo` no existe como campo (derivar de `project_name`/`project_path`), `phase/mode` = `phase_id`+`gsd_mode` (solo GSD), `status` tiene 4 valores. `age` desde `elapsed_min` server-provided. Orden estable por `started_at` con `task_id` de desempate (D-04).

---

## Selección por task_id — cursor cuando la fila desaparece, selección inicial

| Option | Description | Selected |
|--------|-------------|----------|
| Cursor por `selectedTaskId` (identidad); fallback a índice clampado si desaparece; inicial = primera fila | Índice visible derivado por búsqueda del id en cada render; sigue a la sesión aunque reordene | ✓ |
| Cursor por índice numérico | Más simple pero apunta a la sesión equivocada al reordenar/eliminar | (descartado: viola TUI-08) |

**Selección:** opción recomendada. **Notas:** D-05/D-06/D-07. Fallback al vecino por posición clampado cuando el id seleccionado desaparece; sin wrap en ↑/↓.

---

## Color semántico — status+alive, caso zombie, indicador live

| Option | Description | Selected |
|--------|-------------|----------|
| Paleta por estado (running+alive=green, zombie=red+marca textual, review=cyan, done=dim, error=magenta); live reusa connection state de Phase 35 | Color solo de `<Text>`; zombie distinguible sin color | ✓ |
| Solo color, sin marca textual | Más simple | (descartado: accesibilidad/NO_COLOR — D-09) |

**Selección:** opción recomendada. **Notas:** D-08/D-09/D-10. Zombie (`running`+`!alive`) en red + glifo/sufijo textual; `error` en magenta para no confundir con zombie.

---

## Filtros — input `/`, prefijos r:/s:, tecla de salida, live vs Enter, cursor

| Option | Description | Selected |
|--------|-------------|----------|
| Modo modal con `/`, prefijos `r:`/`s:`, filtrado en vivo, `Esc` cancela SOLO en modo filtro, cursor preservado por identidad | Esc contextual resuelve el conflicto con D-11 (reservado para overlays en modo lista) | ✓ |
| Aplicar filtro al pulsar Enter (no en vivo) | Menos re-renders pero peor feedback | (descartado: feedback inmediato preferido) |
| Evitar Esc por completo (otra tecla para salir) | Respeta D-11 literalmente | (descartado: Esc modal es estándar TUI y no colisiona con overlays) |

**Selección:** opción recomendada. **Notas:** D-13/D-14/D-15/D-16. **Decisión que Phase 38 debe honrar:** `Esc` solo cierra overlays cuando NO hay input de filtro con foco. Cursor preservado por `selectedTaskId` al aplicar/limpiar filtro.

---

## Claude's Discretion

- Granularidad de componentes/hooks (extraer `SessionTable`, `useSelection`, `useFilter`, helpers puros vs todo en `App`).
- Si `r:` y `s:` combinan (AND, recomendado) o son exclusivos.
- Dirección del sort por `started_at` (asc/desc) mientras sea fija y estable.
- Anchos exactos de columna y umbral de truncado.
- Si los contadores del header incluyen `done`/`error` o solo estados activos.

## Deferred Ideas

- Attach con `Enter` → `cmux attach <workspace_ref>` — Phase 37 (TUI-13/14).
- Overlays `c` (comentarios) y `l` (logs) — Phase 38 (TUI-15/16); honran el límite modal de Esc (D-15).
- Layout responsive al ancho de terminal — YAGNI esta fase.
- Ordenar por columnas distintas a `started_at` — fuera de scope (TUI-09 exige orden estable por `started_at`).
