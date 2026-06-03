---
phase: 31-phase-21-22-advisory-cleanup
verified: 2026-05-21T10:15:31Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
---

# Phase 31: Advisory Cleanup (ADVISORY-01/02/03) Verification Report

**Phase Goal:** Cierra los advisory items WR-04, WR-05, WR-06 de Phase 21/22 deferred a v0.8 (REQ-IDs ADVISORY-01, ADVISORY-02, ADVISORY-03).
**Verified:** 2026-05-21T10:15:31Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `syncSkill` acepta `onConsoleWarn` callback opcional; lo invoca en el prune path | VERIFIED | `src/skill/sync.js:56,60` — destructuring + `warn = onConsoleWarn ?? console.warn`; callsite `warn(...)` en línea 126 |
| 2 | Cuando `onConsoleWarn` no se provee, `syncSkill` llama `console.warn` directamente (back-compat byte-exact) | VERIFIED | Nullish coalescing `??` en línea 60; Test B en `test/skill-sync.test.js:309-335` blinda la regresión |
| 3 | Test captura el warning del prune sin monkey-patch global de `console.warn` | VERIFIED | Test A `test/skill-sync.test.js:275-307` — inyecta callback; assert `console.warn === beforeConsoleWarn` |
| 4 | `runSkillSyncCli` acepta `deps.cleanupFn` y lo ejecuta ANTES de retornar en las 3 ramas (0/1/2) | VERIFIED | `src/cli/skill-sync.js:60,99-103` — `try { ... } finally { if (cleanupFn) await cleanupFn(); }` envuelve el cuerpo entero |
| 5 | `runSkillSyncCli` preserva D-07: NO invoca `process.exit` | VERIFIED | `grep -c "process.exit" src/cli/skill-sync.js` = 0 |
| 6 | Test verifica exit ordering con `process.hrtime.bigint()` (cleanup_ts < return_ts) para las 3 ramas | VERIFIED | `test/skill-sync.test.js:352-462` — describe block con 3 tests, helper `captureOrdering`, asserts `ts[0].t < ts[1].t` |
| 7 | `launchOrchestrator` acepta `opts.spawnFn` opcional (default `undefined`); lo invoca post-cmux.send/notify pre-return en branch new-workspace | VERIFIED | `src/orchestrator/launch.js:229-237` — `if (opts.spawnFn) { await opts.spawnFn(ctx); }` |
| 8 | Test integration ejecuta `launchOrchestrator` real (no mockSpawn-only) y verifica observables: state.json mutado + NDJSON head-line con `event=session.start` + `transcript_path` populated | VERIFIED | `test/launch.test.js:278-411` — subprocess `node -e` con HOME=tmpHome; 3 niveles de assertions pasando |
| 9 | En producción (callers sin `spawnFn`), comportamiento byte-exact pre-Phase-31 preservado | VERIFIED | `if (opts.spawnFn)` guard sin default; bin/kodo no modificado; suite global 894 pass / 0 fail |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/skill/sync.js` | `onConsoleWarn` DI en typedef + destructuring + callsite | VERIFIED | 4 matches `grep -c "onConsoleWarn"` (typedef l.31, JSDoc l.48, destructuring l.56, resolution l.60); callsite usa `warn(...)` l.126 |
| `test/skill-sync.test.js` | Describe block `syncSkill onConsoleWarn DI (ADVISORY-01)` con 2 tests | VERIFIED | `grep -c "syncSkill onConsoleWarn DI"` = 1; 2 tests it() lines 275 y 309 |
| `src/cli/skill-sync.js` | `cleanupFn` en typedef + try/finally wrapper | VERIFIED | 6 matches `grep -c "cleanupFn"`; `} finally {` presente l.99 |
| `test/skill-sync.test.js` | Describe block `runSkillSyncCli cleanupFn ordering (ADVISORY-02)` con 3 tests | VERIFIED | `grep -c "runSkillSyncCli cleanupFn ordering"` = 1; 3 tests it() lines 391, 419, 442 |
| `src/orchestrator/launch.js` | `spawnFn` DI hook en JSDoc + invocación post-cmux | VERIFIED | 7 matches `grep -c "spawnFn"`; invocación `if (opts.spawnFn)` l.229 |
| `test/launch.test.js` | Describe block `launchOrchestrator real spawn observables (ADVISORY-03)` con ≥1 test integration | VERIFIED | `grep -c "launchOrchestrator real spawn observables"` = 1; 2 tests: SC#3 integration + source-hygiene |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `syncSkill` opts destructuring | `opts.onConsoleWarn \|\| console.warn` | nullish coalescing `??` | WIRED | `src/skill/sync.js:56,60` — `const { ..., onConsoleWarn } = opts; const warn = onConsoleWarn ?? console.warn;` |
| `syncSkill` prune callsite | `warn(...)` | local variable | WIRED | `src/skill/sync.js:126` — `warn(\`[kodo skill sync --prune] removing foreign: ${relPath}\`)` |
| `runSkillSyncCli` body | `if (cleanupFn) await cleanupFn()` | try/finally | WIRED | `src/cli/skill-sync.js:65-103` — try-block contiene las 3 ramas de return; finally corre en todas |
| `launchOrchestrator` new-workspace branch | `opts.spawnFn(ctx)` | if-guard post-cmux | WIRED | `src/orchestrator/launch.js:229-237` — invocado DESPUÉS de `cmux.send` + `cmux.notify` + `console.log`, ANTES del `return` |
| Test ADVISORY-03 | subprocess `node -e` con HOME=tmpHome | `runInlineNode` helper | WIRED | `test/launch.test.js:344-349` — `childResult = await runInlineNode(inlineScript, {HOME: _tmpHome})` |
| Inline script en test | `launchOrchestrator({logger: noopLog, spawnFn})` | dynamic import | WIRED | `test/launch.test.js:337` — `launchOrchestrator` importado dinámicamente dentro del subprocess |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `src/skill/sync.js` | `warn` callable | `onConsoleWarn ?? console.warn` | Yes — DI callback o fallback nativo | FLOWING |
| `src/cli/skill-sync.js` | `cleanupFn` | `deps.cleanupFn` (DI, no default) | Yes — caller provee o se elide vía if-guard | FLOWING |
| `src/orchestrator/launch.js` | `spawnFn` ctx | `{workspaceRef, sessionId, process.cwd(), homedir()+'/.kodo', ORCHESTRATOR_WORKSPACE_NAME}` | Yes — valores en scope real; `workspaceRef` retornado por cmux.newWorkspace; `sessionId` generado por `randomUUID()` | FLOWING |
| `test/launch.test.js` SC#3 | `state.sessions[taskId]` | subprocess llama `addSession` + `sessionStart` en tmpHome | Yes — filesystem mutado en tmpHome; readFileSync lo lee y parsea | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| ADVISORY-01: test suite completa | `node --test test/skill-sync.test.js` | 21 pass / 0 fail | PASS |
| ADVISORY-02: 3 ramas de cleanupFn ordering | `node --test test/skill-sync.test.js` (describe ADVISORY-02) | 3/3 pass (`Test 1`, `Test 2`, `Test 3`) | PASS |
| ADVISORY-03: integration test launch | `node --test test/launch.test.js` | 13 pass / 0 fail (incluye SC#3 + source-hygiene) | PASS |
| Suite global | `node --test` | 895 tests, 894 pass, 1 skip pre-existente, 0 fail | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ADVISORY-01 | 31-01 | `syncSkill` acepta `onConsoleWarn` callback; back-compat con default `console.warn`; tests sin spy global | SATISFIED | `src/skill/sync.js:31,56,60,126`; describe ADVISORY-01 en `test/skill-sync.test.js:261-336` (2 tests) |
| ADVISORY-02 | 31-02 | `runSkillSyncCli` cleanup ordering; `cleanupFn` DI; exit ordering test via `process.hrtime.bigint()` | SATISFIED | `src/cli/skill-sync.js:30,60,99-103`; describe ADVISORY-02 en `test/skill-sync.test.js:352-462` (3 tests) |
| ADVISORY-03 | 31-03 | `launchOrchestrator` test real (no mockSpawn-only); observables `state.json` + `session.start` NDJSON | SATISFIED | `src/orchestrator/launch.js:229-237`; describe ADVISORY-03 en `test/launch.test.js:170-431` (2 tests) |

**Nota documental:** Los tres ADVISORY IDs siguen marcados `[ ] Pending` en `.planning/REQUIREMENTS.md` traceability table. Este es un gap doc-only — la implementación está completa y verificada; la tabla requiere un commit doc de actualización.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/skill/sync.js` | 60 | `console.warn` referencia en runtime (el default de la nullish coalescing) | INFO | No es invocación directa — es la asignación del default `?? console.warn`. El único callsite de warning usa la variable local `warn(...)`. Desviación documentada en SUMMARY 31-01. No bloquea el objetivo. |

Sin TBD / FIXME / XXX / placeholder patterns en los archivos modificados.

---

### Human Verification Required

(Ninguna — todos los comportamientos verificados programáticamente.)

---

## Gaps Summary

No hay gaps. Todos los must-haves verificados con evidencia directa en el código.

**Desviación documentada (no bloqueante):** El criterio del plan `grep -v '^\s*[/*]' src/skill/sync.js | grep -c "console.warn"` = 0 retorna 1 porque la línea `const warn = onConsoleWarn ?? console.warn;` es código runtime que necesariamente referencia `console.warn` como default del fallback. No hay ningún `console.warn(...)` de invocación directa en runtime — solo la asignación del default. Esto fue documentado explícitamente en SUMMARY 31-01 como "edge case notado, no auto-fixed, decisión consciente" con razonamiento correcto: reescribirlo como indirection sería sobreingenierización. El assert source-hygiene del test sí excluye comentarios y pasa correctamente.

**Gap doc-only (no bloquea phase):** `.planning/REQUIREMENTS.md` traceability table aún muestra `Pending` para ADVISORY-01/02/03 y `[ ]` en los items de la lista. La implementación está completa; actualizar estos campos es trabajo de Phase 32 (BOOK-01 bookkeeping) o un commit doc independiente.

---

_Verified: 2026-05-21T10:15:31Z_
_Verifier: Claude (gsd-verifier)_
