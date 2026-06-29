# Phase 60: Enriquecimiento de tareas adoptadas por el orquestador - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning
**Mode:** Autonomous (decisión de diseño central resuelta por el operador)

<domain>
## Phase Boundary

El orquestador (único carril LLM) hace que una tarea adoptada acabe con **información real**: un título inteligente (ya entregado en Phase 57) **y** una **descripción-resumen** del trabajo real (cwd / git log / transcript / diff). Cierra la queja "la tarea se crea sin información" (BIDIR-F2, materializada del Deferred al activo).

Dos caminos:
1. **At-adopt** (adopción nueva vía orquestador): la tarea nace rellena. Shellea `kodo adopt --title '<t>' --description '<resumen>'` — el plumbing `--description` YA existe (Phase 54). Solo prosa del skill + el mandato shell-seguro de Phase 57.
2. **Backfill** (tareas ya adoptadas vía dashboard con título basename y sin descripción): el orquestador las detecta y las enriquece a posteriori.

Ambos resúmenes pasan por el sanitizador del núcleo (BIDIR-08): strip de rutas absolutas, redacción del home dir, **nunca** embeber bodies crudos de transcript.

</domain>

<decisions>
## Implementation Decisions

### LOCKED por el operador (2026-06-19)
- **Backfill vía `addComment`, NO `updateTask`.** El orquestador postea un **comentario-resumen** en la tarea existente reusando `provider.addComment(task, markdownText)` — que **ya es uno de los 9 FROZEN** (`src/interface.js:56`). NO se añade un método `updateTask` nuevo. Contrato `TaskProvider` intacto (9 FROZEN + getTaskState/createTask opcionales). Cero superficie de provider nueva, cero PATCH endpoints, cero tests de contrato nuevos. La descripción del *cuerpo* de la tarea no se edita in-place; el resumen vive como primer comentario.
  - **Rationale:** el milestone v0.13 está cerrándose; minimizar riesgo. `addComment` ya está testeado en la contract matrix Plane+GitHub. La pérdida (resumen como comentario vs. cuerpo editado) es aceptable y reversible — un futuro `updateTask` puede promoverse en otro milestone si se demuestra necesario.

### A resolver en plan-phase
- **Call-site del backfill `addComment`:** ¿el orquestador shellea un consumidor CLI determinista (¿`kodo comment <task> <body>`? espejo de `kodo adopt`, host-agnóstico vía el provider registry) o invoca el provider por otra vía? Mantener el principio "cero lógica de negocio nueva en el orquestador (solo prosa del skill)" + simetría host-agnóstica Plane/GitHub. Preferencia: si hace falta un call-site, que sea un consumidor CLI delgado y determinista (la fontanería ya existe: `addComment`), no lógica en el skill.
- **Detección de tareas enriquecibles** (backfill): cómo el orquestador identifica una tarea adoptada "pelada" (título = basename(cwd), sin descripción/comentario de resumen) sin re-enriquecer las ya enriquecidas (idempotencia / marcador).
- **Derivación del resumen:** qué fuentes reales consume el LLM (git log acotado, diff, cwd) y cómo se acota para no inflar tokens; el sanitizador BIDIR-08 es obligatorio antes de cualquier POST.

### Claude's Discretion
Forma exacta de la prosa del skill, estructura del comentario markdown, acotación del git log/diff.

</decisions>

<code_context>
## Existing Code Insights

- `addComment` ∈ `TASK_PROVIDER_METHODS` FROZEN-9 (`src/interface.js:52-62`); firma `(task: TaskItem, markdownText: string) => Promise<void>`. Implementado en Plane + GitHub adapters.
- `kodo adopt --description <d>` ya existe (Phase 54, `src/cli/adopt.js` / `src/cli.js:250`).
- Skill del orquestador: `kodo-orchestrate` (prosa en `skill.md` + `prompt.md`). Phase 57 ya añadió §"Adopción asistida" con el mandato shell-seguro (single-quote en TODOS los args — corrección CR-01).
- Sanitizador BIDIR-08: vive en la fontanería `src/adopt.js` (`sanitizeAdoptionData`); cualquier resumen debe pasar por la misma regla.
- Comandos CLI registrados: `src/cli.js` (commander) — `adopt` en :250; NO existe `comment` todavía.

</code_context>

<specifics>
## Specific Ideas

- Reusar el mandato shell-seguro de Phase 57 (single-quote en todos los args) para cualquier shell-out con el resumen derivado.
- Confirmación humana antes de escribir (espejo Phase 57 D-03): el orquestador propone título+resumen, el humano/CLI confirma, ENTONCES se postea.
- Carril 0-token del núcleo intacto: el LLM vive estrictamente en el orquestador (prosa del skill). `addComment`/`adopt` son deterministas.

</specifics>

<deferred>
## Deferred Ideas

- `updateTask` (edición in-place de título+descripción del cuerpo) — descartado para v0.13; promovible en un milestone futuro si el resumen-como-comentario resulta insuficiente.

</deferred>
</content>
</invoke>
