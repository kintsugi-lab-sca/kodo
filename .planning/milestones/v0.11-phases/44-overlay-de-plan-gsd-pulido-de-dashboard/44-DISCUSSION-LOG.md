# Phase 44: Overlay de plan GSD + pulido de dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-09
**Phase:** 44-overlay-de-plan-gsd-pulido-de-dashboard
**Mode:** `--auto` (todas las áreas auto-resueltas con la opción recomendada; sin prompts interactivos)
**Areas discussed:** Tecla del overlay, Resolución tarea→fase, Presentación multi-PLAN.md, Copy sin-contenido, TUI-18 ocultar columna, TUI-19 zombie por-fila

---

## Tecla y modo del overlay (PLAN-01)

| Option | Description | Selected |
|--------|-------------|----------|
| `p` (plan) | Mnemónico, libre en `useInput`, espejo de `c`/`l` | ✓ |
| `v` (view) | Genérico, menos mnemónico | |
| `Tab`/tecla compuesta | Más teclas para memorizar, rompe el patrón de letra única | |

**Selección (auto):** `p` — reusa el `mode:'overlay'` existente, snapshot congelado, `Esc` preserva cursor.
**Notes:** Verificado libre vs ocupadas `q`/`/`/`c`/`l`/`d`/flechas/Enter/Esc.

---

## Resolución tarea→fase y ruta de PLAN.md (PLAN-01, PLAN-02)

| Option | Description | Selected |
|--------|-------------|----------|
| `row.phase_id` primario + `resolvePhase` fallback | La fila ya trae `phase_id`/`project_path`/`worktree_path` (`...s` de `/status`) | ✓ |
| Siempre re-ejecutar `resolvePhase` | Redundante: el dispatch ya persistió `phase_id` | |
| `findSession` para obtener paths | Innecesario; la fila del dashboard ya los expone | |

**Selección (auto):** Primario `row.phase_id`; fallback `resolvePhase({projectPath: worktree_path ?? project_path, task})`. Lectura desde `worktree_path ?? project_path`, directorio por prefijo de número, ficheros `*-PLAN.md`. Never-throws.
**Notes:** Honra los invariantes "deriva de la fila, no de findSession" y "worktree_path ?? project_path" de STATE.md.

---

## Presentación de varios PLAN.md (PLAN-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Concatenado con cabecera por fichero | Reusa el snapshot plano `lines[]` + scroll; cero sub-navegación | ✓ |
| Lista navegable (seleccionar fichero) | Requiere sub-modo + estado de selección nuevos (sobreingeniería) | |

**Selección (auto):** Concatenado, ordenado ascendente por nombre, separador `── NN-PLAN.md ──`.
**Notes:** Simplicidad-first. La infra de overlay ya es un `lines[]` scrollable. Lista navegable diferida como pulido futuro si el uso real lo pide (YAGNI).

---

## Copy honesto de estados sin contenido (PLAN-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Constantes `OVERLAY_PLAN_*` distintas por caso | Espejo de `OVERLAY_COMMENTS_*`; distingue no-GSD / sin-PLAN.md / error | ✓ |
| Un solo mensaje genérico "sin plan" | No distingue causa; UX pobre | |

**Selección (auto):** 3 copys distintos: no-GSD/sin-fase, fase-sin-PLAN.md, error-de-lectura. never-throws.
**Notes:** Wording exacto a discreción del planner/executor; el contrato es "distinta por caso + honesta".

---

## TUI-18 — ocultar columna phase/mode

| Option | Description | Selected |
|--------|-------------|----------|
| `anyGsd = rows.some(phase_id!=null)` sobre sesiones activas | Derive puro React-free; columna estructural, no parpadea con el filtro | ✓ |
| Basarlo en el conjunto filtrado (`/`) | La columna parpadearía al teclear el filtro — peor UX | |

**Selección (auto):** Derivación pura en `select.js`/`format.js` sobre las filas activas; oculta y recupera ancho si `false`, reaparece al entrar GSD.
**Notes:** Mecánica de recálculo de anchos a discreción del planner (depende del layout columnar actual).

---

## TUI-19 — zombie por-fila en columna state

| Option | Description | Selected |
|--------|-------------|----------|
| `(zombie)` + rojo vía `statusColor` v3-aware en celda `state` | Reusa paleta LOCKED; cero color nuevo, cero picocolors | ✓ |
| Color nuevo / glyph nuevo | Rompe color isolation y la paleta LOCKED | |

**Selección (auto):** Marca textual `(zombie)` + rojo de `statusColor(status, alive, state)` en la celda `state`. El contador del header se mantiene (aditivo).
**Notes:** Color solo de `<Text>` de ink; blindado por `test/format-isolation.test.js`.

---

## Claude's Discretion

- Wording exacto de constantes `OVERLAY_PLAN_*` y formato de la cabecera separadora multi-PLAN.md.
- Helper de lectura de plan: módulo puro con DI (espejo de `grepLogs`/`fetchComments`) vs inline, manteniendo never-throws.
- Mecánica del recálculo de anchos columnar al ocultar `phase/mode`.

## Deferred Ideas

- Captura/visualización de plan de sesiones no-GSD/quick → Phase 45 (spike) + Phase 46 (condicional). El overlay se diseña para reusarse si Phase 46 procede.
- Mostrar todos/Tasks en vivo → v2 (PLAN-F1/PLAN-F2).
- Lista navegable multi-PLAN.md → pulido futuro si el concatenado resulta incómodo (YAGNI).
