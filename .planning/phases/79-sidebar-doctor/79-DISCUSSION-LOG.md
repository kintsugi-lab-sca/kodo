# Phase 79: Sidebar Doctor - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-23
**Phase:** 79-Sidebar Doctor
**Mode:** `--auto` — todas las áreas auto-seleccionadas con la opción recomendada (sin AskUserQuestion)
**Areas discussed:** Fuente de datos del scan, Alcance de workspaces, Grupo disuelto y política de anchor, Shape del módulo y CLI, Guards SDR-02/SDR-04

---

## Fuente de datos del scan

| Option | Description | Selected |
|--------|-------------|----------|
| Re-derivación offline | `state.json` + `projects.json` + cmux list; módulo por reverse-lookup de `project_path` en `entry.modules`; reusa `deriveExpectedGroupName` con task-like reconstruido | ✓ |
| Persistir `expected_group` al lanzar | Escribir el grupo esperado en el session record en launch/adopt | |
| Consultar el provider en el scan | Recuperar el task real para derivar el grupo | |

**[auto] Selected:** Re-derivación offline (recommended default)
**Notes:** La opción 2 tocaría el launch path (riesgo SDR-04) y añade un escritor de `state.json`; la opción 3 rompe el constraint 0-tokens/0-red del carril determinista y acopla el doctor al provider.

---

## Alcance de workspaces

| Option | Description | Selected |
|--------|-------------|----------|
| Solo workspaces kodo-managed | Agrupar/mover solo workspaces correlacionados por `workspace_ref` en `state.json`; `ungroup` solo sobre grupos con 0 miembros | ✓ |
| Todo el sidebar | Aplicar la derivación a cualquier workspace visible | |

**[auto] Selected:** Solo workspaces kodo-managed (recommended default)
**Notes:** Los workspaces del operador no son de kodo — moverlos sería sorpresa destructiva de UX. `ungroup` de grupos vacíos es aceptable sobre cualquier grupo porque no cierra workspaces y el milestone lo pide explícitamente.

---

## Grupo disuelto y política de anchor

| Option | Description | Selected |
|--------|-------------|----------|
| Disuelto ≡ faltante con miembros esperados | Sin historial de grupos; remedio idéntico: `create` → `add`(s) → `set-anchor` al `started_at` más antiguo | ✓ |
| Persistir historial de grupos | Guardar qué grupos existieron para distinguir "disuelto" de "nunca existió" | |

**[auto] Selected:** Disuelto ≡ faltante con miembros esperados (recommended default)
**Notes:** La distinción no cambia la acción correctiva; persistir historial añade un escritor de estado sin valor. La sintaxis real de `workspace-group create/add/set-anchor/ungroup` se verifica empíricamente en research (precedente: `rename` documentado ≠ real).

---

## Shape del módulo y CLI

| Option | Description | Selected |
|--------|-------------|----------|
| Espejo exacto del patrón gsd-doctor | `src/cmux/sidebar-doctor.js` (puro, DI) + `src/cli/sidebar-doctor.js` + namespace `sidebar` en `src/cli.js`; allowlist en `src/cmux/client.js` vía `run()`; exit codes/`--json` espejo | ✓ |
| Extender `src/gsd/doctor.js` | Añadir categoría sidebar al doctor existente | |

**[auto] Selected:** Espejo exacto del patrón gsd-doctor (recommended default)
**Notes:** El gsd doctor sanea filesystem local; el sidebar doctor opera contra cmux — dominios distintos, mismo patrón. Mezclarlos acoplaría ciclos de vida y exit codes.

---

## Guards SDR-02/SDR-04

| Option | Description | Selected |
|--------|-------------|----------|
| Test source-hygiene + golden intactos | Test que falla si `workspace-group delete` aparece cableado; launch path sin editar y tests GRP-01..03 pasando sin modificación | ✓ |
| Verificación manual en review | Confiar en la revisión de código | |

**[auto] Selected:** Test source-hygiene + golden intactos (recommended default)
**Notes:** SDR-02 exige el guard automático explícitamente; la verificación por construcción (no editar launch path) es la única evidencia fuerte de byte-identidad.

---

## Claude's Discretion

- Naming interno de las categorías del report, formato de salida humana del CLI, taxonomía de eventos nuevos en `logger-events.js`, estructura de tests — siguiendo convenciones de `gsd-doctor`.

## Deferred Ideas

- FUT-03 — puerta LLM para ambigüedad de agrupación (YAGNI, constraint de origen)
- FUT-02 — `kodo doctor --fix` asistido config.json↔projects.json (v2)
- FUT-01 — fidelidad markdown del overlay del plan (solo si molesta en uso real)
