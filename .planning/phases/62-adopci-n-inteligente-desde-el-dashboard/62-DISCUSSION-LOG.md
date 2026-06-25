# Phase 62: Adopción inteligente desde el dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-25
**Phase:** 62-adopci-n-inteligente-desde-el-dashboard
**Areas discussed:** Acceso a datos, Alcance non-GSD, Prompt de derivación

> Nota: varias decisiones (carril one-shot `claude -p` Haiku, UX derive-then-confirm, fail-open a basename, v1 no-editable, derivación antes de createTask por FROZEN-9) se acordaron en la conversación de diseño previa al `/gsd:discuss-phase` y se arrastran como locked. Este log cubre las 3 áreas grises restantes formalmente presentadas.

---

## Acceso a datos (¿cómo accede el `claude -p` a los datos?)

| Option | Description | Selected |
|--------|-------------|----------|
| Contexto inline (pre-leído) | kodo lee PROJECT.md/ROADMAP/STATE + primer prompt + git log e inyecta en el prompt; Haiku solo razona; sin tools, determinista, coste acotado | ✓ |
| Agéntico (con tools) | El `claude -p` lleva Read/Bash y explora él mismo; flexible pero lento, no determinista, superficie de tools | |
| Híbrido | Inline lo esencial + Read acotado | |

**User's choice:** Contexto inline (pre-leído)
**Notes:** Prioriza determinismo, latencia baja y coste acotado. El subproceso no lleva tools.

---

## Alcance non-GSD (¿se enriquece un repo sin .planning/?)

| Option | Description | Selected |
|--------|-------------|----------|
| Sí, con git log + primer prompt | Sin PROJECT.md, deriva de git log + primer prompt del transcript; cubre todos los repos | ✓ |
| No, solo GSD por ahora | Sin .planning/ → cae a basename(cwd) | |

**User's choice:** Sí, con git log + primer prompt
**Notes:** El uso real (dev solo + equipo, todos con Claude) hace que las sesiones ad-hoc non-GSD sean mayoría; dejarlas fuera vaciaría la feature.

---

## Prompt de derivación (¿reutiliza la prosa del orquestador o nuevo?)

| Option | Description | Selected |
|--------|-------------|----------|
| Nuevo, dedicado y mínimo | Prompt propio; shell-safety vía execFile (charset mandate redundante) | ✓ |
| Reutiliza skill.md §Adopción asistida | Consistencia con ORCH-01, pero arrastra reglas redundantes aquí | |

**User's choice:** Nuevo, dedicado y mínimo
**Notes:** `execFile` con argv literal hace inerte la inyección; no se necesita el mandato charset/single-quote de ORCH-01.

## Claude's Discretion

- Valor exacto del timeout (~8s de referencia).
- Ubicación/firma del módulo nuevo (sugerencia `src/cli/dashboard/enrich.js`).
- Forma del prompt y parse del `--output-format json` de `claude -p`.
- Presupuesto de contexto inline (caps de PROJECT.md/transcript).

## Deferred Ideas

- Edición del título/descripción en el overlay ink (v2).
- Integrar el derivador con `kodo comment` para enriquecer tareas ya adoptadas.
- Backfill del título de tareas ya creadas (bloqueado por ausencia de updateTask, FROZEN-9).
- claude-mem como fuente de memoria adicional (v1 se mantiene filesystem-based).
