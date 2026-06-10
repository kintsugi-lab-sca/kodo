# Phase 46: Overlay del plan ligero para sesiones quick/non-GSD - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 46-Overlay del plan ligero para sesiones quick/non-GSD
**Mode:** `--auto` (Claude seleccionó la opción recomendada en cada área; sin prompts interactivos)
**Areas discussed:** Ubicación del fallback, Precedencia del fallback, Taxonomía de status + copy honesta, Resolución de ruta y pureza de plan.js

---

## Ubicación del fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Extender `readPlan` en `plan.js` | Único entry point, App.js ya lo llama; un solo reader/contrato | ✓ |
| Reader separado (`readLightPlan`) | Función nueva paralela; App.js orquesta cuál llamar | |
| Lógica en el handler `p` de App.js | App.js decide GSD vs ligero antes de leer | |

**User's choice:** Extender `readPlan` (recommended default)
**Notes:** El fallback es una rama nueva antes del `return no-phase` (plan.js:69). El handler `p` de App.js no cambia su forma.

---

## Precedencia del fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Solo en la rama `no-phase` | Dispara cuando `phaseId` queda null tras phase_id + resolvePhaseFn | ✓ |
| También para GSD sin PLAN.md | Una fila GSD con phase_id pero sin PLAN.md también probaría el artefacto | |

**User's choice:** Solo en la rama `no-phase` (recommended default)
**Notes:** Phase 45 D-04 excluye GSD full/bootstrap de escribir el artefacto → nunca hay artefacto para filas con phase_id. Correlación por `task_id` (Phase 45 D-02); `row.task_id` confirmado disponible.

---

## Taxonomía de status + copy honesta

| Option | Description | Selected |
|--------|-------------|----------|
| Añadir status/copy nuevo | `no-light-plan` + copy honesta ("session has not written a plan yet"); reusa ok/error | ✓ |
| Reusar `no-plan` existente | Artefacto ausente muestra "phase has no PLAN.md yet" | |

**User's choice:** Añadir status/copy honesta distinta (recommended default)
**Notes:** Reusar `no-plan` mentiría sobre una sesión quick (no tiene "phase"). El contrato honest-copy de Phase 44 D-07 exige distinción visible. Mapeo: ok→leído, no-light-plan→ENOENT, error→EACCES, no-phase→sin phase_id ni task_id.

---

## Resolución de ruta y pureza de plan.js

| Option | Description | Selected |
|--------|-------------|----------|
| Importar `homedir` de `node:os` inline | Builtin, mantiene plan.js leaf; patrón config.js; override por deps en tests | ✓ |
| Inyectar la ruta completa por deps | App.js calcula `~/.kodo/plans/` y la pasa | |
| Importar `src/config.js` | Reusar KODO_DIR directamente | |

**User's choice:** Importar `homedir` de `node:os` inline (recommended default)
**Notes:** `node:os` es builtin → no rompe WARNING-01 ni color-isolation (D-12 Phase 44). No se importa config.js (evita acoplar el leaf). Override opcional en `deps` (`kodoPlansDir`/`homedirFn`) para aislar el HOME en tests; lectura reusa `deps.readFileFn`.

---

## Claude's Discretion

- Literal exacto de la copy nueva (`OVERLAY_PLAN_NO_LIGHT` u otro) dentro del contrato D-04.
- Nombre exacto del status nuevo (`no-light-plan`) y del override de deps.
- Necesidad del guard de contención sobre `task_id` (D-09), según la forma real del `task_id`.

## Deferred Ideas

- Limpieza/retención de `~/.kodo/plans/` (heredado de Phase 45) — higiene futura (`doctor`/cleanup).
- Lista navegable multi-artefacto — no aplica (un fichero por `task_id`).
- Frontmatter con metadata verificable — descartado en Phase 45 D-05.
