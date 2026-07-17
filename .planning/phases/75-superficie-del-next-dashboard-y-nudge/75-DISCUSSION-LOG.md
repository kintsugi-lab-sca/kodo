# Phase 75: Superficie del `NEXT:` — dashboard y nudge - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-17
**Phase:** 75-Superficie del `NEXT:` — dashboard y nudge
**Areas discussed:** Canal de datos NEXT→TUI, Columna NEXT en la tabla, Render markdown del plan, Nudge con contexto
**Mode:** `--auto` — todas las áreas auto-seleccionadas; cada pregunta resuelta con la opción recomendada, sin AskUserQuestion. Este log ES el registro de auditoría de esas selecciones.

---

## Canal de datos: cómo llega `state.tasks` a la TUI

| Option | Description | Selected |
|--------|-------------|----------|
| Lectura directa de `~/.kodo/state.json` desde la capa de datos de la TUI | Un reader puro never-throws (DI para tests) lee 1 fichero por tick, merge por `task_id` en derive. Cumple literalmente el criterio 1 y el precedente D-10 Phase 44 (la TUI ya lee filesystem local) | ✓ |
| Enriquecer el payload de `/status` con `state.tasks` | No es endpoint «nuevo», pero toca `server.js` sin necesidad y contradice la redacción del criterio («leyéndolo de state.json») | |
| Watcher de fichero (fs.watch) sobre `state.json` | Segundo mecanismo de refresco paralelo al poll — complejidad sin beneficio a la cadencia actual | |

**Selección (auto):** Lectura directa filesystem + piggyback en el tick de `usePoll` existente (recommended default).
**Notes:** Era la Open Question heredada explícitamente del research de la Phase 74 (74-CONTEXT.md §deferred). Limitación multi-nodo aceptada — coherente con overlays de plan y columna `prog`.

---

## Presentación del `NEXT:` en la tabla

| Option | Description | Selected |
|--------|-------------|----------|
| Columna condicional (precedente `prog`, Phase 50 D-06) | Aparece solo con ≥1 fila con `NEXT:`; celda vacía si falta; truncado con ellipsis | ✓ |
| Columna fija siempre visible | Roba ancho permanente incluso sin dato — contradice el precedente `deriveAnyGsd` | |
| Línea de detalle bajo la fila seleccionada | No cumple LIVE-05 («se ve en la lista») para todas las filas a la vez | |

**Selección (auto):** Columna condicional al final del orden actual, flexible (recommended default).
**Notes:** El valor ya llega acotado a 200 chars desde `state.json` (74 D-02).

---

## Render markdown del plan (LIVE-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Mini-renderer line-based in-house + strip de marcadores `kodo:handoff` | Función pura React-free línea→estilo ink (headings, bold, bullets, fences). Cero deps nuevas. Salda la promesa de invisibilidad del marcador (74 D-01 corrección) | ✓ |
| Dependencia `marked`/`ink-markdown` | Violaría «cero dependencias npm nuevas» (invariante cross-milestone) | |
| Texto plano + solo strip de marcadores | No cumple «renderizado» de LIVE-06 — es el estado actual con menos ruido | |

**Selección (auto):** Mini-renderer in-house, solo en el carril `readLightPlan` (rama `phaseId == null`), misma UX de overlay, D-02 LOCKED intacto (recommended default).

---

## Nudge con contexto (LIVE-07)

| Option | Description | Selected |
|--------|-------------|----------|
| `buildStopNudgeText` gana parámetro opcional; session-end threadea el `NEXT:` persistido | Función sigue pura (cero I/O), textos por-modo intactos sin `NEXT:` (byte-idénticos), semántica asimétrica heredada de `upsertTaskHandoff` | ✓ |
| `buildStopNudgeText` lee `state.json` por su cuenta | Rompe la pureza y la testabilidad actual de la función | |
| Nudge separado solo-NEXT adicional | Dos mensajes al orquestador por cierre — ruido; el nudge por-evento ya existe | |

**Selección (auto):** Parámetro opcional + threading desde `runSessionEndHook` (recommended default).
**Notes:** Aplica a TODOS los modos (quick/full/no-GSD) — grounded en REQUIREMENTS §Out of Scope («sí alimenta el nudge»).

---

## Claude's Discretion

- Nombre/ubicación del reader de `state.tasks` y del mini-renderer markdown.
- Ancho exacto y flex/fijo de la columna `next`; header abreviado.
- Redacción literal de la línea del nudge (ES, una línea, textos previos byte-idénticos).
- Mecanismo de threading del `NEXT:` en `runSessionEndHook` (preferencia: cero I/O extra).
- Estructura de tests (fixtures, aislamiento HOME, precedentes Phase 74).

## Deferred Ideas

- Servir `state.tasks` vía `/status` para dashboards remotos (multi-nodo) — otro milestone.
- Scroll/paginación del overlay de plan con handoffs acumulados — ligado a la poda diferida a v0.18 (M21, «medir antes de arreglar»).
- Generalizar el mini-renderer markdown a los overlays `c`/`l` o al plan GSD — fuera de scope (D-02 LOCKED).
