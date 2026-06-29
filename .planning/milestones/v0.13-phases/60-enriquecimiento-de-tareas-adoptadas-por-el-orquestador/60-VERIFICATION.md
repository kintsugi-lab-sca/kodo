---
phase: 60-enriquecimiento-de-tareas-adoptadas-por-el-orquestador
status: passed
verified: 2026-06-19
suite: 1489 pass / 0 fail / 1 skip (full) · 8/8 isolation walkers · 12/12 comment-cli
---

# Phase 60 Verification — Enriquecimiento de tareas adoptadas

## Success Criteria

### SC1 — El orquestador deriva título inteligente Y descripción-resumen, ambos por el sanitizador BIDIR-08 ✅ PASSED

**Evidencia:**
- Skill `kodo-orchestrate/skill.md` §"Adopción asistida" paso **2b** (nuevo): deriva un resumen de 2-4 frases de `git log`/diff/transcript, **summarizado nunca verbatim** (mandato BIDIR-08 explícito: "NUNCA embebas bodies crudos de transcript").
- El sanitizador del núcleo se aplica deterministamente en los consumidores CLI: `src/cli/comment.js` PASO 3 (`sanitizeAdoptionData({ description: rawBody })`) y `kodo adopt --description` ya enruta por el mismo backstop (`src/adopt.js` `sanitizeAdoptionData`, BIDIR-08, Phase 53).
- Distinción de capas documentada: el saneo de rutas/home es del núcleo; la seguridad shell (charset + single-quote) es del orquestador (prosa).

### SC2 — Camino at-adopt: shellea `kodo adopt --title --description` ✅ PASSED

**Evidencia:**
- El plumbing `--description` ya existía (Phase 54, `src/cli.js` + `src/cli/adopt.js:174`). Phase 60 lo **habilita en la prosa**: skill §6 reemplaza "OMITE `--description` (diferido a una fase futura)" por el uso real con ejemplo SAFE single-quoted; espejo en `src/orchestrator/prompt.md:42`.
- Mandato shell-seguro Phase 57 extendido a `--description` (free-text, fail-closed sobre `'`, newlines OK dentro de comillas simples).

### SC3 — Camino backfill: enriquece tareas ya adoptadas vía `addComment` (NO updateTask) ✅ PASSED

**Evidencia:**
- Consumidor CLI nuevo `kodo comment <ref> --body <text>` (`src/cli/comment.js`, registrado en `src/cli.js`) que resuelve provider → `getTask(ref)` → sanea → `addComment(task, body)`.
- `addComment` es uno de los 9 FROZEN (`src/interface.js:56`) — **cero superficie de provider nueva, contrato intacto**. Decisión LOCKED `addComment` sobre `updateTask` respetada.
- Host-agnóstico: resuelve el provider por registry/config; funciona para Plane y GitHub sin lógica condicional en el orquestador.
- Skill §"Backfill: enriquecer una tarea YA adoptada (`kodo comment`)" documenta el flujo + shell-safety + exit codes.
- Tests `test/comment-cli.test.js`: 12/12 pass (validación, happy path, sanitización, fallos transient, --json, wiring estático).

### SC4 — Confirmación humana antes de escribir; carril 0-token intacto; LLM solo en el orquestador ✅ PASSED

**Evidencia:**
- Skill §"Adopción asistida" paso 4 + §Backfill paso 2: "propón + ESPERA aprobación/confirmación del operador antes de postear" (backstop humano, espejo Phase 57 D-03).
- `kodo comment` y `kodo adopt` son deterministas 0-token (sin LLM); el LLM (derivación de título/resumen) vive estrictamente en la prosa del skill del orquestador.
- Invariantes preservados: TaskProvider FROZEN-9 (reusa addComment, no añade métodos); cero endpoints nuevos en `src/server.js`; color isolation (walker `format-isolation` verde); cmux isolation (walker verde — comment.js no toca cmux).

## Tests (live, 2026-06-19)

```
npm test → tests 1490 · pass 1489 · fail 0 · skipped 1 (pre-existente)
node --test test/comment-cli.test.js → 12 pass / 0 fail
node --test test/format-isolation.test.js test/cmux-isolation.test.js → 8 pass / 0 fail
```

## Veredicto

**PASSED.** Los 4 success criteria se cumplen. Backfill vía `addComment` (FROZEN-9, decisión LOCKED), at-adopt vía `--description`, ambos caminos shell-seguros con confirmación humana. Contrato intacto, suite verde, walkers verde. Sin gaps.
</content>
