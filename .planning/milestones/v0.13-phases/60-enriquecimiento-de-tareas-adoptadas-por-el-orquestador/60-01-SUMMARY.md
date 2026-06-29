---
phase: 60-enriquecimiento-de-tareas-adoptadas-por-el-orquestador
plan: 01
status: complete
requirements_completed: [BIDIR-F2]
subsystem: cli, orchestrator-skill
completed: 2026-06-19
tags: [orchestrator, adopt, addComment, enrichment, backfill, bidir-f2, shell-safety]
---

# Phase 60 Plan 01: Enriquecimiento de tareas adoptadas — Summary

**Una tarea adoptada ahora acaba con información real: el orquestador deriva un título inteligente Y un resumen-descripción del contexto real, rellenando la tarea al adoptar (`kodo adopt --description`) o enriqueciéndola a posteriori con un comentario-resumen (`kodo comment` → `addComment`). El LLM vive solo en el orquestador (prosa); los consumidores CLI son deterministas 0-token.**

## Decisión de diseño (LOCKED por el operador)

Backfill vía **`addComment`** (uno de los 9 FROZEN, `src/interface.js:56`), NO un `updateTask` nuevo. Cero superficie de provider nueva, contrato intacto, menor riesgo para un milestone que se cierra. El resumen vive como comentario, no edita el cuerpo de la tarea in-place.

## Accomplishments

1. **CLI `kodo comment <ref> --body <text>`** (`src/cli/comment.js`, registrado en `src/cli.js`) — consumidor determinista host-agnóstico: resuelve provider → `getTask(ref)` → sanea el body con `sanitizeAdoptionData` (BIDIR-08) → `addComment(task, body)`. Exit codes 0/1/2 (espejo de `kodo adopt`). Cero métodos nuevos en el contrato.
2. **Tests** (`test/comment-cli.test.js`, 12 tests) — validación, happy path, sanitización BIDIR-08, fallos transient (fetch/post → exit 2), --json byte-determinista, wiring estático.
3. **Prosa del skill `kodo-orchestrate`** (`skill.md` + espejo `src/orchestrator/prompt.md`):
   - Paso 2b: derivar el resumen-descripción (summarizado, nunca verbatim).
   - §6: habilitado `--description` (antes "OMITE, diferido a fase futura") con ejemplo SAFE single-quoted.
   - Nueva sub-sección §"Backfill: enriquecer una tarea YA adoptada (`kodo comment`)".
   - Mandato shell-seguro Phase 57 extendido a `--description`/`--body` (free-text, fail-closed sobre `'`).

## Por qué funciona

`addComment` ya estaba en el contrato FROZEN-9 y testeado en la contract matrix Plane+GitHub — el backfill lo reusa sin tocar el contrato. El at-adopt reusa el `--description` que Phase 54 ya había cableado; Phase 60 solo lo desbloquea en la prosa. Todo el LLM (derivación de título/resumen) vive en el skill; los CLI son 0-token y deterministas.

## Tests

- `npm test` → 1489 pass / 0 fail / 1 skip (pre-existente).
- `test/comment-cli.test.js` → 12 pass.
- Walkers `format-isolation` + `cmux-isolation` → 8 pass (comment.js no leakea color ni cmux).

## Key Files

- created: `src/cli/comment.js`, `test/comment-cli.test.js`
- modified: `src/cli.js` (registro del comando), `.claude/skills/kodo-orchestrate/skill.md`, `src/orchestrator/prompt.md`

## Limitación conocida

La detección de "tareas adoptadas peladas" para backfill es del operador/orquestador (prosa): no hay un marcador automático de "ya enriquecida". La idempotencia recae en el juicio del orquestador (no re-postear el mismo resumen). Aceptable — el backfill es on-demand, con confirmación humana.
</content>
