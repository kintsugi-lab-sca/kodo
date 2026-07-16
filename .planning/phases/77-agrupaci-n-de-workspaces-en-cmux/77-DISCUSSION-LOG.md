# Phase 77: Agrupación de workspaces en cmux - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-16
**Phase:** 77-agrupaci-n-de-workspaces-en-cmux
**Areas discussed:** Contrato de nombre de grupo, Ubicación arquitectónica de la resolución, Mecánica fail-open, Alcance de lanzamientos agrupados
**Mode:** `--auto` — todas las áreas auto-seleccionadas; en cada pregunta se eligió la opción recomendada sin prompt interactivo. Pase único (cap `workflow.max_discuss_passes = 3`, consumido 1). Base empírica: prueba en vivo contra cmux 0.64.19 realizada en la sesión previa a la creación de la fase (hechos en ROADMAP §Phase 77).

---

## Contrato de nombre de grupo (matching operador ↔ kodo)

| Option | Description | Selected |
|--------|-------------|----------|
| Nombre derivado determinístico + match case-insensitive | `IDENTIFIER` si path == default; `IDENTIFIER/Módulo` si el módulo tiene path propio. Funciona con los grupos reales `Kodo`/`SCRIBBA` sin renombrarlos | ✓ |
| Match por `current_directory` del anchor | Sin convención de nombres, pero el cwd del anchor es el cwd VIVO del terminal — deriva con cada `cd` del operador | |
| Campo `cmux_group` en `projects.json` | Explícito al máximo, pero añade superficie de config sin necesidad demostrada | |

**Elección auto:** derivación determinística (recomendada) → D-01..D-04.
**Notas:** El compuesto `IDENTIFIER/Módulo` no es estético: `DEV` existe como módulo en dos proyectos distintos del `projects.json` real (LIKEN y personalreply) — el módulo pelado es ambiguo. Empate de nombres normalizados → primero de la lista, determinista.

---

## Ubicación arquitectónica de la resolución

| Option | Description | Selected |
|--------|-------------|----------|
| Passthrough fino en `client.js` + `_legacy` + funciones puras | `listWorkspaceGroups()` una-función-por-comando; resolución y derivación puras testeables sin cmux | ✓ |
| Resolución dentro de `newWorkspace` | Esconde una segunda llamada cmux dentro de lo que parece un comando; rompe el patrón thin-client | |
| Extender `HOST_METHODS` | Prohibido — contrato congelado en 4 desde Phase 38 | |

**Elección auto:** passthrough + puras (recomendada) → D-05..D-08.
**Notas:** El walker `test/host/cmux-isolation.test.js` fuerza que solo `src/host/` + `src/cmux/` hablen con cmux — la resolución pasa por `host._legacy`, nunca ejecuta cmux desde `manager.js`.

---

## Mecánica fail-open

| Option | Description | Selected |
|--------|-------------|----------|
| Dos capas: resolución + reintento sin `--group` en el launch | Capa 1 cubre list fallido/cmux viejo/sin match; capa 2 cubre el TOCTOU (grupo borrado entre resolución y launch) | ✓ |
| Solo capa 1 | Deja fatal la ventana TOCTOU — un ref inválido mata el `new-workspace` entero (verificado: exit=1) | |
| Pre-verificar el grupo justo antes del launch | Llamada extra y sigue siendo racy — no elimina la ventana, solo la encoge | |

**Elección auto:** dos capas (recomendada) → D-09..D-12.
**Notas:** Sin version-check de cmux: el soporte se deriva del éxito/fallo de la propia llamada de list. Observabilidad con `console.log` de una línea, precedente exacto `worktree_skipped_nongit` (`manager.js:312`).

---

## Alcance de lanzamientos agrupados

| Option | Description | Selected |
|--------|-------------|----------|
| Solo sesiones de tareas (`launchWorkItem`) | El goal de la fase habla de issues/tareas; quirúrgico | ✓ |
| También el workspace del orquestador | `orchestrator/launch.js:220` — no es una sesión de tarea | |
| También sesiones adoptadas vía `workspace-group add` | Workspaces que kodo no creó; `add` es gestión de membresía (GRP-04-adyacente) | |

**Elección auto:** solo tareas (recomendada) → D-13.
**Notas:** Orquestador y adoptadas quedan como deferred ideas explícitas.

---

## Claude's Discretion

- `--group-placement` (default `top` salvo hallazgo del research).
- Normalización exacta del match (casefold vs `toLowerCase`, NFC/NFD para `Traça Web`).
- Módulo propio vs funciones en `manager.js` para las dos puras.
- Estructura de tests (DI del exec, fixtures del JSON real de `workspace-group list`).

## Deferred Ideas

- Agrupar el workspace del orquestador.
- `workspace-group add` para sesiones adoptadas.
- Auto-crear grupo si no existe (`create --from <ws-nuevo>`) — candidata v0.18 si crear grupos a mano cansa.
- Color/icono de grupo por proyecto (`set-color`/`set-icon`).
