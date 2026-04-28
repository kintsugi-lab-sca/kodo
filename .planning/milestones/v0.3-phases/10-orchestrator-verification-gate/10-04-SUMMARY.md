---
phase: 10-orchestrator-verification-gate
plan: 04
subsystem: orchestrator
tags: [gsd, orchestrator, prompt, nudge, context-summary, integration, tdd]

# Dependency graph
requires:
  - phase: 10-orchestrator-verification-gate
    plan: 01
    provides: "parser VERIFICATION.md + verdict discriminado (src/gsd/verification.js)"
  - phase: 09-phase-resolver-bootstrap
    provides: "session.phase_id persistido por el dispatcher; `kodo gsd inspect` como referencia del CLI sibling"
  - phase: 08-gsd-label-session-plumbing
    provides: "session.gsd persistido en state.json (D-10); nudge orchestrator existente en stop.js (líneas 115-125)"
provides:
  - "prompt.md con sección `## Sesiones GSD` que instruye al orquestador a ejecutar `kodo gsd verify <session-id>` tras el cierre de una sesión GSD"
  - "buildContextSummary exportado — etiqueta sesiones activas con `[GSD phase N]` o `[GSD bootstrap]` según session.gsd / session.phase_id"
  - "buildStopNudgeText helper puro — el nudge al orquestador ahora es condicional: menciona `kodo gsd verify <session-id>` solo para sesiones GSD"
affects: [10-03 runGsdVerify consumption by the orchestrator, stop.js → orquestador loop]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure helper extraction del texto inline del cmux.send (patrón §7 PATTERNS Opción A) para tests sin mocks de I/O"
    - "Export de función previamente privada (`buildContextSummary`) para test aislado (patrón §6 Opción A)"
    - "Condicional con fallback 'bootstrap' cuando `session.phase_id` es undefined (Pitfall #4 Phase 9 D-11)"
    - "Tests Nyquist-compliant con verificación de contenido renderizado (no solo existencia de archivo) para el prompt.md — cierra Dim 8a para la fase 10"

key-files:
  created:
    - "test/orchestrator-gsd.test.js (108 → 173 líneas) — 20 tests en 3 suites (PM1..PM7 prompt, L1..L6 buildContextSummary, S1..S7 buildStopNudgeText)"
  modified:
    - "src/orchestrator/prompt.md (72 → 88 líneas) — append de la sección `## Sesiones GSD` con los 4 verdicts explícitos y referencia a `kodo gsd inspect`"
    - "src/orchestrator/launch.js (127 líneas) — export de buildContextSummary + tag GSD condicional en el loop de sesiones activas"
    - "src/hooks/stop.js (196 líneas) — helper puro buildStopNudgeText al tope del archivo + consumo desde el bloque cmux.send existente"

key-decisions:
  - "Opción A del PATTERNS §6: exportar buildContextSummary en vez de introducir argumentos DI/factory. Cambio quirúrgico, consumidores internos de launch.js no se afectan."
  - "Opción A del PATTERNS §7: extraer el texto del cmux.send a un helper puro `buildStopNudgeText(session)` en lugar de inlinear la lógica condicional en handleStop. Permite testing sin mockear cmux.listWorkspaces ni cmux.send."
  - "Pitfall #4 resuelto idénticamente en launch.js y stop.js: cuando `session.phase_id` es undefined, usar literal string 'bootstrap'. Consistencia cross-file — el orquestador ve el mismo label (`[GSD bootstrap]`) tanto en el prompt context summary como en el nudge."
  - "Idioma: prompt.md + nudge + helpers en español (D-16). Excepción consciente respecto al inglés de `buildGsdContext` (Phase 8 D-04): el canal es distinto — el orquestador Claude lee el prompt como humano operador, la sesión GSD lo recibe como agente y espera inglés."
  - "Test para prompt.md usa `readFileSync` + regex sobre el contenido renderizado (PM1..PM7), no solo `grep` shell. Cumple la observación Nyquist Dim 8a de la fase: no basta comprobar la existencia del archivo."
  - "El helper buildStopNudgeText usa literal `\\\\n` (doble escape) en el return — mantiene el contrato existente del cmux.send que ya tenía `\\\\n` inline en el texto original. El test S6 asserta `text.endsWith('\\\\n')` para blindar contra una refactorización accidental a `\\n` real."

patterns-established:
  - "Nudge condicional GSD: `buildStopNudgeText(session)` como helper puro al tope del archivo hook, consumido en el bloque cmux.send existente. Replicable para futuros nudges específicos por flag en la sesión."
  - "Tag visual GSD en el context summary del orquestador: backtick-envuelto markdown (`[GSD phase N]`) entre el task_ref y el summary. Formato greppable y visualmente distinguible en el prompt generado."
  - "Tests Nyquist-compliant sobre prompts estáticos: importar con `readFileSync`, assertear sobre contenido (headings, comandos, idioma) en lugar de únicamente validar existencia del archivo."

requirements-completed: [GSD-07]

# Metrics
duration: ~25min
completed: 2026-04-22
commits:
  - "ee322da — feat(10-04): añade sección GSD al prompt.md del orquestador (Task 1)"
  - "de5db3e — feat(10-04): buildContextSummary exportada + tag GSD por sesión (Task 2, TDD)"
  - "706c0f8 — feat(10-04): buildStopNudgeText helper + nudge condicional GSD (Task 3, TDD)"
tasks-completed: 3/3
tests-added: 20 (7 PM + 6 L + 7 S)
tests-total-project: 314 (313 pass, 1 skip, 0 fail)
---

# Phase 10 Plan 04: Integración GSD del orquestador (prompt + launch + stop) Summary

Conecta el CLI `kodo gsd verify` (Plan 10-03) con el lifecycle real del orquestador: el prompt del orquestador ahora tiene instrucciones explícitas en español sobre sesiones GSD; el context summary taggea visualmente las sesiones GSD activas con `[GSD phase N]` / `[GSD bootstrap]`; y el nudge que dispara `stop.js` al cerrarse una sesión menciona el comando `kodo gsd verify <session-id>` solo cuando `session.gsd === true`. Todo el flujo es ahora observable para el orquestador Claude sin tocar `buildGsdContext` ni romper las sesiones no-GSD.

## What Changed

### 1. `src/orchestrator/prompt.md` (+16 líneas)

Append de una sección `## Sesiones GSD` al final del archivo:

- 4 bullets numerados: (1) leer artefactos — PROJECT.md, ROADMAP.md, PLAN.md; (2) ejecutar `kodo gsd verify <session-id>`; (3) switch exhaustivo sobre los 4 verdicts (pass/fail/missing/malformed) con acción concreta por caso; (4) referencia a `kodo gsd inspect <task-id>` como debug opcional.
- Cierre con nota imperativa: "No dupliques el gate en comentarios manuales."
- Reusa el placeholder `{{provider_name}}` existente — cero placeholders nuevos.

### 2. `src/orchestrator/launch.js` (función exportada + tag GSD)

- `function buildContextSummary` → `export function buildContextSummary`. Consumidor interno (línea 62 del mismo archivo) no afectado.
- Nuevo en el loop de sesiones activas (3 líneas):
  ```js
  const gsdTag = s.gsd ? ` \`[GSD ${s.phase_id ? `phase ${s.phase_id}` : 'bootstrap'}]\`` : '';
  lines.push(`- **${s.task_ref}**${gsdTag}: ${s.summary}`);
  ```
- Comentario explícito referenciando Pitfall #4 + Phase 10 D-19.

### 3. `src/hooks/stop.js` (helper puro + consumo)

- Nuevo helper exportado al tope (22 líneas incluyendo JSDoc): `buildStopNudgeText(session)`. Puro, sin I/O.
  - Sesiones GSD → `La sesión X (summary) ha terminado y está en Review. Es una sesión GSD (fase N | bootstrap). Ejecuta \`kodo gsd verify <session_id>\` y actúa según el verdict.\n`
  - Sesiones no-GSD → `La sesión X (summary) ha terminado y está en Review. Revisa el resultado y decide si pasa a Done o necesita más trabajo.\n` (texto original preservado, sin regresión)
- El bloque `cmux.send` existente consume el helper (`text: buildStopNudgeText(session)`).
- NO toca: lock release, removeSession, handleOrchestratorStop, sessionEnd, cmux color/notify.

### 4. `test/orchestrator-gsd.test.js` (nuevo archivo, 173 líneas, 20 tests)

- **PM1..PM7** (prompt.md, readFileSync): heading, comando `kodo gsd verify <session-id>`, 4 verdicts como palabras literales, 4 artefactos, placeholder, `kodo gsd inspect`, ausencia de frases inglesas.
- **L1..L6** (buildContextSummary): phase tag, bootstrap fallback, no-tag cuando gsd=false/undefined, mix de sesiones, preservación de workspace + elapsed + project_path.
- **S1..S7** (buildStopNudgeText): GSD con phase, bootstrap fallback, rama no-GSD sin `kodo gsd verify`, gsd undefined, prefijo común "La sesión KL-42", `\\n` al final, idioma español.

## Deviations from Plan

None — plan ejecutado exactamente como escrito:
- Task 1 (append prompt.md + test PM1..PM7): ejecutado, 7 tests pass, 88 líneas en prompt.md (≥ 85 requerido).
- Task 2 (export + tag GSD en launch.js + L1..L6): TDD completo (RED confirmado por error de import → GREEN tras cambio). 13 tests totales pass tras este commit.
- Task 3 (helper + refactor stop.js + S1..S7): TDD completo (RED por import fail → GREEN tras añadir helper). 20 tests totales pass.

No se invocaron reglas 1/2/3 de auto-fix; no hubo checkpoints ni architectural escalations (Regla 4); no auth gates.

## Verification

| Check | Result |
|---|---|
| `node --test test/orchestrator-gsd.test.js` | 20/20 pass (3 suites) |
| `npm test` (suite completa) | 314 tests: 313 pass, 1 skip pre-existente (`startup-budget`), 0 fail |
| `grep -qF "## Sesiones GSD" src/orchestrator/prompt.md` | match |
| `grep -qF "export function buildStopNudgeText" src/hooks/stop.js` | match |
| `grep -qF "export function buildContextSummary" src/orchestrator/launch.js` | match |
| `grep "kodo gsd verify" src/hooks/stop.js src/orchestrator/prompt.md` | matches en ambos |
| `git diff --name-only` contra base | 4 archivos: prompt.md, launch.js, stop.js, test/orchestrator-gsd.test.js (session-start.js intacto — sin regresión D-04 Phase 8) |

## Invariantes preservados

- **Idioma de buildGsdContext (Phase 8 D-04):** `src/hooks/session-start.js` NO modificado. Sigue en inglés.
- **Lock-release logic (Phase 8):** `src/hooks/stop.js` líneas 102-110 intactas.
- **Nudge original para sesiones no-GSD:** texto literal `"Revisa el resultado y decide si pasa a Done o necesita más trabajo."` preservado en el helper (rama else).
- **Consumidor interno de buildContextSummary:** línea 62 de `launch.js` no modificada — el export añadido no altera el call-site.
- **Lista de placeholders en prompt.md:** sin nuevos tokens. Solo reusa `{{provider_name}}`.

## Self-Check: PASSED

Archivos creados/modificados verificados presentes en disk:
- `src/orchestrator/prompt.md` — FOUND (88 líneas, incluye `## Sesiones GSD`)
- `src/orchestrator/launch.js` — FOUND (export buildContextSummary + gsdTag)
- `src/hooks/stop.js` — FOUND (export buildStopNudgeText + consumo en cmux.send)
- `test/orchestrator-gsd.test.js` — FOUND (20 tests, 3 describe suites)

Commits verificados vía `git log --oneline e2758217..HEAD`:
- `ee322da` — FOUND
- `de5db3e` — FOUND
- `706c0f8` — FOUND
