---
phase: 62-adopci-n-inteligente-desde-el-dashboard
plan: 01
subsystem: cli/dashboard
tags: [orch-02, llm-derivation, never-throws, fail-open, dashboard, adopt]
requirements_completed: [ORCH-02]
requires:
  - resolveTranscriptPath (src/logger-events.js)
  - isGsdProject (src/adopt.js)
provides:
  - deriveAdoptionMeta (derivador LLM one-shot never-throws, DI)
  - spawnDerive (spawn claude -p + parse doble capa, fail-open a {})
  - firstUserPrompt (primer prompt real del transcript .jsonl)
  - SCHEMA (json-schema estricto para structured output)
affects:
  - src/cli/dashboard/App.js (consumirá onDerive — Plan 03)
  - src/cli/dashboard/index.js (cableará onDerive — Plan 03)
tech_stack:
  added: []
  patterns:
    - "never-throws / fail-open a {} (molde runAdopt)"
    - "leak guard estructural DI sin default (spawnFn)"
    - "execFile argv literal injection-inerte (D-13)"
    - "--json-schema structured output (parse trivial sin fence)"
    - "color-isolation: cero child_process/color inline (D-12)"
key_files:
  created:
    - src/cli/dashboard/enrich.js
    - test/dashboard/enrich.test.js
    - test/dashboard/fixtures/transcript-variable-line.jsonl
    - test/dashboard/fixtures/transcript-tool-result-only.jsonl
  modified: []
decisions:
  - "Timeout 25s (NO 8s): Pitfall 1 — latencias reales 8.7-21.9s cortarían casi todas las derivaciones"
  - "'claude' por PATH (NO config.claude.binary): Pitfall 3 — el path config apunta a binario inexistente"
  - "--json-schema fuerza result JSON estricto: Pitfall 2 — sin schema viene con fence markdown"
  - "spawnFn DI sin default (leak guard): omitirlo lanza TypeError, nunca toca claude real"
metrics:
  duration: ~12min
  completed: 2026-06-25
  tasks: 2
  files: 4
  tests_added: 18
---

# Phase 62 Plan 01: enrich.js derivador LLM never-throws Summary

Derivador LLM one-shot `claude -p --model claude-haiku-4-5 --json-schema` que produce `{title, description}` desde la memoria del proyecto (GSD: PROJECT.md/ROADMAP.md/STATE.md; non-GSD: git log + primer prompt del transcript), con fail-open a `{}` ante CUALQUIER fallo — aísla todo el carril LLM en un único módulo DI-inyectable que preserva el suelo 0-token del core (D-11).

## What Was Built

- **`spawnDerive({ spawnFn, prompt, timeoutMs })`** — spawn one-shot con leak guard estructural (TypeError si `spawnFn` ausente, ANTES del `new Promise`), argv literal `['-p','--model','claude-haiku-4-5','--output-format','json','--json-schema',SCHEMA,prompt]`, parse de doble capa (envelope → `result`), fail-open a `{}` ante ENOENT/timeout/exit≠0/is_error/parse-fail/sync-throw. Timeout default 25s.
- **`firstUserPrompt({ cwd, sessionId, readFileFn })`** — primer turno `type:'user'` con texto real del transcript `.jsonl` vía `resolveTranscriptPath` (reusado, NO reinventado), saltando líneas no-parseables (`queue-operation`) y turnos tool_result-only; content string o array; cap 1500 chars; never-throws → `''`.
- **`deriveAdoptionMeta({ spawnFn, readFileFn, existsSyncFn, cwd, sessionId })`** — ramifica GSD vs non-GSD vía `isGsdProject` (reusado), construye el contexto inline capeado (Pitfall 4: PROJECT≤3000/ROADMAP≤2000/STATE≤2000; git log `--oneline -20`≤2000; intent≤1500), delega en `spawnDerive`. Never-throws total → `{}`.
- **`SCHEMA`** exportado — json-schema estricto `{title, description}` required, additionalProperties:false.
- **Suite unit** (18 tests) con fakes DI (`spawnFn`/`readFileFn`/`existsSyncFn`) que NO invocan `claude` real + 2 fixtures `.jsonl` sintéticos.

## How to Verify

```bash
node --test test/dashboard/enrich.test.js   # 18/18 pass
npm test                                     # 1527 pass / 0 fail / 1 skip (pre-existente)
```

## TDD Gate Compliance

- RED gate: `test(62-01)` commit `f5d5c76` — 13 comportamientos fallando (enrich.js ausente, "Cannot find module").
- GREEN gate: `feat(62-01)` commit `c58479b` — suite enrich verde, full suite sin regresión.
- REFACTOR: no necesario (código limpio sobre moldes existentes de `runAdopt`).

## Deviations from Plan

None — plan ejecutado exactamente como está escrito. El módulo, la firma DI, los caps, el timeout 25s y el conjunto exportado coinciden con PATTERNS/RESEARCH.

Nota de proceso (no es una desviación funcional): el acceptance grep `grep -v '^#' ... -cE 'picocolors|\x1b['` daba 1 por la palabra literal `picocolors` en un comentario JS (el `grep -v '^#'` solo descarta comentarios de shell, no `//` de JS). Se reformuló el comentario para no contener la palabra; el guard canónico comment-aware (`test/format-isolation.test.js`, walker del grafo de imports) pasa 8/8 — cero leak real de color.

## Self-Check: PASSED

- src/cli/dashboard/enrich.js — FOUND
- test/dashboard/enrich.test.js — FOUND
- test/dashboard/fixtures/transcript-variable-line.jsonl — FOUND
- test/dashboard/fixtures/transcript-tool-result-only.jsonl — FOUND
- commit f5d5c76 (RED) — FOUND
- commit c58479b (GREEN) — FOUND
