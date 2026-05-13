---
phase: 19-worktree-cleanup-integration
verified: 2026-05-12T17:30:00Z
status: human_needed
score: 10/10 must-haves verified
overrides_applied: 1
re_verification: true
overrides:
  - must_have: "SC#3 end-to-end orchestrator-led (CR-01)"
    reason: |
      WT-06 cubre el flujo embedded `/gsd-verify-work` (lectura desde worktree),
      verificado por verify.js:133 + T20-T27 + D-06/D-09. El flujo orchestrator-led
      post-stop está roto por findSession (state.js:180-194) no escaneando
      state.history y por cleanup/removeSession ejecutando antes del nudge.
      CONTEXT.md §D-07 y §Deferred declararon EXPLÍCITAMENTE que el bug latente
      de findSession→history queda fuera de scope de Phase 19 y se difiere a
      Phase 21+. El verifier escaló la decisión; el usuario (alex) confirma el
      deferral: Phase 19 cumple WT-06 a nivel embedded; el orchestrator-led
      verify queda como deuda explícita para Phase 21+.
    accepted_by: alex
    accepted_at: 2026-05-12T14:38:00+02:00
    deferred_to: "Phase 21+ (skill sync milestone) — capturar como issue dedicado al lifecycle del SessionRecord"
deferred:
  - truth: "SC#3 — kodo gsd verify <session-id> localiza VERIFICATION.md en el worktree del sesión (flujo orchestrator-led post-stop)"
    addressed_in: "Phase 21+"
    evidence: "Override D-07 aceptado por alex: findSession no escanea state.history y cleanup/removeSession ejecutan antes del nudge. Deuda arquitectural explícita deferida a Phase 21+ (skill sync milestone)."
human_verification:
  - test: "Smoke real orchestrator-led: arrancar kodo orchestrator, lanzar sesión GSD full con kodo run <task>, dejar que termine, observar que el nudge llega al orchestrator y que kodo gsd verify <session-id> ejecutado por el orchestrator NO falla con session not found"
    expected: "El verify localiza el VERIFICATION.md y comenta en Plane; exit code 0"
    why_human: "Requiere infraestructura real (orchestrator + cmux + plane API + git worktree) y el bug es de coordinación entre componentes — los unit tests no cubren la cadena completa porque mockean findSession y la sesión nunca pasa por history"
  - test: "Smoke dirty-state: ejecutar una sesión que deje working tree dirty, dejar que stop hook corra, verificar que <wt>.dirty/ existe en disco, que git worktree list lo lista, y que la branch sigue viva"
    expected: "El directorio .dirty/ está intacto con los cambios del usuario, accesible para inspección manual"
    why_human: "Los E2E smoke tests cubren el case en tmpdir aislado, pero la validación de UX en un repo real con archivos del usuario requiere visual inspection"
  - test: "Smoke session legacy v0.5: cargar una sesión con worktree_path: undefined (state.json antiguo) y confirmar que stop hook no toca git y que verify lee del project_path silently"
    expected: "Sin eventos worktree.cleanup.*, verify localiza VERIFICATION.md en el project_path, sin warn de fallback en logs"
    why_human: "Requiere fixture state.json migrado/desmigrado a v0.5 — los tests usan factories sintéticas pero no cubren la transición real"
---

# Phase 19: Worktree Cleanup & Integration — Verification Report (Re-verification)

**Phase Goal:** El ciclo de vida del worktree cierra limpio (fail-open en caso de dirty state) y el resto de subsistemas que tocan filesystem (`auto-commit` de la skill, `kodo gsd verify`) operan dentro del worktree correcto.
**Verified:** 2026-05-12T17:30:00Z
**Status:** human_needed (todos los gaps de código cerrados; override CR-01 honrado; quedan 3 items de smoke test que requieren infraestructura real)
**Re-verification:** Sí — tras ejecución de plan 19-03 que cierra CR-02 y CR-03

## Re-verification Summary

| Item | Verificación anterior | Estado actual |
|------|-----------------------|---------------|
| CR-01 (findSession no escanea history) | FAILED — override D-07 aplicado | DEFERRED (override honrado, sin cambios) |
| CR-02 (markSessionStatus solo en if session.gsd) | FAILED | CLOSED — 19-03 Task 1 |
| CR-03 (existsSync sigue symlinks) | FAILED | CLOSED — 19-03 Task 2 |
| Suite global | 564/564 pass + 0 skip | 567/568 pass + 1 skip pre-existente |

**Gaps cerrados:** 2/3 (CR-02 + CR-03). Gap CR-01 permanece como deuda deferida a Phase 21+ con override aceptado.
**Regresiones introducidas:** 0.

## Goal Achievement

### Observable Truths

| # | Truth (Source) | Status | Evidence |
|---|----------------|--------|----------|
| 1 | **SC#1** — Tras stop hook clean, `git worktree list` ya no incluye el worktree; si dirty, persiste con log warn | VERIFIED | `stop.js:261-343`: CLEAN path llama `worktree remove` + emite `worktree.cleanup.ok`; DIRTY path llama `worktree move <wt>.dirty` + emite `worktree.cleanup.dirty`. E2E tests `stop-worktree-cleanup.test.js:345-396` con git real verifican en disco. 10/10 unit tests + 2 E2E pasan. |
| 2 | **SC#2** — `auto-commit` produce commits dentro del worktree; `KODO_ROOT` env override preservado | VERIFIED | `handleOrchestratorStop` (stop.js:400+) preserva `cwd: KODO_ROOT`. Source-hygiene test `Phase 19 D-05` pasa (stop.test.js). `grep -c "cwd: KODO_ROOT" src/hooks/stop.js` = 2. Satisfied-by-design per D-05/D-06. |
| 3 | **SC#3 / WT-06** — `kodo gsd verify <session-id>` localiza VERIFICATION.md en el worktree (embedded flow) | VERIFIED (override CR-01 para orchestrator-led) | `verify.js:133`: `join(session.worktree_path ?? session.project_path, '.planning', 'phases')` — productivo y único. Tests T20-T27 + D-06/D-09 + source-hygiene pasan. El flujo orchestrator-led post-stop permanece roto (findSession no escanea history) — override D-07 aceptado por alex, deferido a Phase 21+. |
| 4 | **CR-02** — `markSessionStatus('done')` se ejecuta para TODAS las sesiones (GSD + no-GSD) ANTES de sessionEnd | VERIFIED (CLOSED por 19-03) | `stop.js:169-176`: `markSessionStatus(session.task_id, 'done', 'session-stop', log)` fuera del bloque `if (session.gsd)`. Catch usa `console.error` (WR-03). `sessionEnd` recibe `status: 'done'` literal (stop.js:186). Verificado por source-hygiene `Phase 19 CR-02` (stop.test.js:135-158). `grep -c "session-stop:lock-released" stop.js` = 0; `grep -c "status: session.status" stop.js` = 0. |
| 5 | **CR-03** — Pre-check del dirty target usa `lstatSync` (symlink-safe); symlinks colgantes disparan variante suffixed | VERIFIED (CLOSED por 19-03) | `stop.js:302-314`: `lstatSync(target)` en try/catch ENOENT. `grep -c "existsSync" stop.js` = 0. Tests DANGLING SYMLINK + REGULAR FILE (stop-worktree-cleanup.test.js:235-316) pasan. Source-hygiene `Phase 19 CR-03` verifica ausencia de existsSync. |
| 6 | **D-07** — Cleanup ocurre DESPUÉS de releaseGsdLock | VERIFIED | awk check: `releaseGsdLock` línea 199 < `worktreeCleanupOk` línea 216. Source-hygiene `Phase 19 D-07` pasa. |
| 7 | **D-08** — Branch name leído ANTES de worktree remove | VERIFIED | awk check: `--show-current` < `worktree remove`. Source-hygiene `Phase 19 D-08` pasa. |
| 8 | **D-09** — Legacy v0.5 sin worktree_path → skip silencioso en cleanup + fallback en verify | VERIFIED | `stop.js:212` guard `if (session.worktree_path)`. Test LEGACY (stop-worktree-cleanup.test.js:190) pasa con `calls.length === 0`. `verify.js:133` usa `??` fallback. |
| 9 | **D-10** — EVENTS exporta 11 strings incluyendo 3 nuevos `worktree.cleanup.*`; 3 helpers tipados | VERIFIED | `node -e` runtime check: EVENTS count 11, frozen: true, los 3 helpers typeof function. 15/15 tests logger-events pasan. |
| 10 | **WT-04 fail-open** — `runStopHook` nunca crashea; outer try/catch top-level intacto | VERIFIED | Test ERROR on remove (stop-worktree-cleanup.test.js:126) verifica que `worktreeCleanupError{phase:remove}` se emite y `await runStopHook` completa sin throw. Top-level catch stop.js:381. |

**Score:** 10/10 truths verified (CR-01 override aplicado cuenta como VERIFIED per frontmatter override)

### Deferred Items

Items no yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Flujo orchestrator-led: `kodo gsd verify <session-id>` post-stop falla porque `findSession` no escanea `state.history` y el worktree ya fue borrado antes del nudge | Phase 21+ | Override D-07 aceptado por alex (2026-05-12T14:38+02:00). CONTEXT.md §Deferred documenta explícitamente. Phase 21 (SKILL-01..04) es el milestone de skill sync donde se planea revisar el lifecycle del SessionRecord. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/logger-events.js` | EVENTS extendido + 3 helpers tipados worktreeCleanupOk/Dirty/Error | VERIFIED | 11 eventos, frozen, 3 helpers exportados con level info/warn/error correcto. Runtime check pasa. |
| `src/hooks/stop.js` | Cleanup fail-open + CR-02 fix + CR-03 fix | VERIFIED | `markSessionStatus` fuera de `if (session.gsd)` (línea 169-176). `lstatSync` reemplaza `existsSync` (línea 302-314). `cwd: KODO_ROOT` preservado. |
| `src/gsd/verify.js` | phasesRoot con `??` fallback | VERIFIED | Línea 133 productiva única. Línea 24 en comentario header (documentado como deviation intencional). `join(session.project_path, '.planning', 'phases')` ya NO existe (grep = 0). |
| `test/stop-worktree-cleanup.test.js` | 6 unit + 2 E2E + 2 CR-03 nuevos = 10 unit + 2 E2E | VERIFIED | 10 `it()` en unit describe + 2 en E2E. DANGLING SYMLINK + REGULAR FILE presentes. Todos pasan. |
| `test/gsd-verify-integration.test.js` | +3 tests (D-06, D-09, source-hygiene) | VERIFIED | Tests presentes. 11/11 pasan. |
| `test/stop.test.js` | 5 source-hygiene asserts (D-05/D-07/D-08 de 19-02 + CR-02/CR-03 de 19-03) | VERIFIED | Todos 5 presentes y pasan. Total 20 asserts en suite. |
| `test/stop-state-transition.test.js` | Sync al contrato CR-02 (3 asserts actualizados) | VERIFIED (deviation) | 4/4 pasan. Header comment documenta Phase 19 CR-02. `grep -c "Phase 19 CR-02"` = 7; `grep -c "session-stop'"` = 6. |
| `test/logger-events.test.js` | Contract tests + inventory actualizado | VERIFIED | 15/15 pasan. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `stop.js` | `logger-events.js` | `dynamic import { worktreeCleanupOk/Dirty/Error }` | WIRED | `stop.js:215-219` |
| `stop.js` | git CLI | `gitFn(cwd, args) → execFileSync('git', ['-C', cwd, ...args])` | WIRED | Default factory `stop.js:105-108`; producción usa execFileSync real |
| `stop.js` | `session/manager.js` | `markSessionStatus(task_id, 'done', 'session-stop', log)` fuera de `if (session.gsd)` | WIRED (CR-02 fix) | `stop.js:169-176`. TODAS las sesiones transitan a 'done'. |
| `stop.js` | `node:fs` | `lstatSync(target)` en try/catch ENOENT (CR-03 fix) | WIRED | `stop.js:302-314`. `existsSync` eliminado del archivo. |
| `verify.js` | `SessionRecord.worktree_path` | nullish coalescing en phasesRoot | WIRED | `verify.js:133` |
| `stop.js (nudge)` → `verify.js` | `findSession({ sessionId })` | state.json lookup | BROKEN (deferred CR-01) | `findSession` escanea solo `state.sessions`; sesión ya en `state.history` tras `removeSessionFn`. Override D-07 aceptado. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `stop.js` cleanup block | `session.worktree_path` | `findSession` → `SessionRecord` (Phase 18 D-03c) | YES (Phase 18 verificado) | FLOWING |
| `verify.js` phasesRoot | `session.worktree_path` | mismo source | YES (flujo embedded) / NO (orchestrator-led, CR-01 deferred) | FLOWING (embedded), DISCONNECTED (orchestrator-led, override) |
| Cleanup events NDJSON | `cleanupLog` payload | `worktreeCleanup{Ok,Dirty,Error}` helpers | YES | FLOWING |
| `sessionEnd` status field | `'done'` literal | hardcoded tras CR-02 fix (ya no `session.status` stale) | YES | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command / Check | Result | Status |
|----------|---------|--------|--------|
| EVENTS frozen + 11 strings + 3 helpers | `node -e "import('./src/logger-events.js').then(...)` runtime | count=11, frozen=true, helpers=function | PASS |
| Phase 19 specific tests (stop-cleanup + verify + logger + stop) | `node --test test/stop-worktree-cleanup.test.js test/stop.test.js test/gsd-verify-integration.test.js test/logger-events.test.js` | 56/56 pass | PASS |
| Suite global sin regresiones | `npm test` | **568 tests / 567 pass + 1 skip** (skip pre-existente) | PASS |
| awk D-07 (releaseGsdLock línea 199 < worktreeCleanupOk línea 216) | awk check | lock:199 cleanup:216 | PASS |
| awk D-08 (--show-current < worktree remove) | awk check | branch antes de remove | PASS |
| CR-02: markSessionStatus (línea 171) ANTES de if (session.gsd) (línea 196) | awk check | 171 < 196 | PASS |
| CR-02: `session-stop:lock-released` eliminado | `grep -c "'session-stop:lock-released'" stop.js` | 0 | PASS |
| CR-02: `status: session.status` eliminado | `grep -c "status: session\.status" stop.js` | 0 | PASS |
| CR-03: `lstatSync(target)` presente | `grep -c "lstatSync(target)" stop.js` | 1 | PASS |
| CR-03: `existsSync` ausente del archivo | `grep -c "existsSync" stop.js` | 0 | PASS |
| 5 commits 19-03 existen | `git log --oneline` | 26ec187, d688a04, caeca1b, 59654c1, a6586f1 | PASS |
| End-to-end orchestrator-led verify | Requiere infraestructura real | N/A | SKIP → human verification |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| **WT-04** | 19-01 + 19-02 + 19-03 | Stop hook hace cleanup del worktree fail-open; dirty state preserva con log warn | SATISFIED | 10/10 unit tests + 2 E2E (git real). CR-02/CR-03 cerrados por 19-03. |
| **WT-05** | 19-02 | `auto-commit` opera dentro del worktree; KODO_ROOT env override preservado | SATISFIED (satisfied-by-design) | `handleOrchestratorStop` preserva `cwd: KODO_ROOT`. Source-hygiene D-05 pasa. |
| **WT-06** | 19-02 | `kodo gsd verify` lee VERIFICATION.md desde el worktree | SATISFIED (embedded; orchestrator-led override CR-01) | `verify.js:133` cambiado. Tests T20-T27 + D-06/D-09 pasan. Override D-07 aceptado para el flujo orchestrator-led post-stop. |

**Orphaned requirements:** ninguno — WT-04/05/06 reclamados por 19-01/19-02/19-03. REQUIREMENTS.md marca WT-04/05/06 como `pending` (sync de status pertenece a fase posterior, no es gap de Phase 19).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/hooks/stop.js` | 220-228 | `cleanupLog` instancia un segundo logger con binding idéntico a `log` (línea 159-167) | Warning (WR-01 del REVIEW.md post-19-03) | Potencial duplicación de file descriptors NDJSON. No es bloqueante; fix sugerido: `const cleanupLog = log` |
| `src/hooks/stop.js` | 178-180 | Comentario dice "state.transition captured here" pero la transición ya ocurre en markSessionStatus (línea 169-171); sessionEnd solo emite session.end | Warning (WR-02 del REVIEW.md post-19-03) | Confunde al próximo reviewer. No es bloqueante. |
| `src/hooks/stop.js` | 105-108 | `gitFn` default re-importa `node:child_process` en cada invocación (5 veces por sesión CLEAN) | Warning (WR-04 del REVIEW.md post-19-03) | Latencia mínima (Node cachea módulos). No es bloqueante. |
| `src/hooks/stop.js` | 105-108 + 239/249 | `gitFn` default antepone `-C <project>` y los call-sites de branch/status pasan `-C <wt>` → `git -C <project> -C <wt> branch --show-current` | Warning (WR-05 del REVIEW.md post-19-03) | Git acepta múltiples `-C` y compone (funciona). Convención mezclada confunde; documentado en comentario 234-237. No es bloqueante. |

Todos los anti-patrones son warnings del REVIEW.md post-19-03 con severidad advisory. Ninguno bloquea el Phase Goal. WR-01/02/04/05 son tech debt menor identificado para un futuro refactor.

### Human Verification Required

**1. Smoke orchestrator-led verify**

**Test:** Arrancar `kodo orchestrator`, lanzar una sesión GSD full con `kodo run <task>`, dejar que termine, observar que el nudge llega al orchestrator y que `kodo gsd verify <session-id>` ejecutado por el orchestrator NO falla con `session not found`.
**Expected:** El verify localiza el VERIFICATION.md y comenta en Plane; exit code 0.
**Why human:** Requiere infraestructura real (orchestrator + cmux + plane API + git worktree). El bug CR-01 está deferido pero el smoke test puede confirmar si en la práctica el flujo embedded (ejecutado DENTRO de la sesión antes del stop hook) es suficiente para el workflow real.

**2. Smoke dirty-state en repo real**

**Test:** Ejecutar una sesión que deje `working tree dirty`, dejar que stop hook corra, verificar que `<wt>.dirty/` existe en disco, que `git worktree list` lo lista, y que la branch sigue viva.
**Expected:** El directorio `.dirty/` está intacto con los cambios del usuario, accesible para inspección manual.
**Why human:** Los E2E smoke tests cubren el caso en tmpdir aislado; la validación de UX en un repo real con archivos del usuario requiere visual inspection.

**3. Smoke legacy v0.5**

**Test:** Cargar una sesión con `worktree_path: undefined` (state.json antiguo de v0.5) y confirmar que stop hook no toca git y que verify lee del project_path silently.
**Expected:** Sin eventos `worktree.cleanup.*`; verify localiza VERIFICATION.md en el project_path; sin warn de fallback en logs.
**Why human:** Requiere fixture state.json migrado/desmigrado a v0.5; los tests usan factories sintéticas pero no cubren la transición real desde un state.json persistido.

### Gaps Summary

**Todos los gaps de código están cerrados:**
- CR-02 (markSessionStatus solo en if session.gsd) — CLOSED por 19-03 Task 1: mark relocated a línea 169-176, aplica a todas las sesiones, razón `'session-stop'`, catch `console.error` (WR-03).
- CR-03 (existsSync seguía symlinks) — CLOSED por 19-03 Task 2: `lstatSync` con ENOENT discrimination en línea 302-314. 2 tests DANGLING SYMLINK + REGULAR FILE blindan. `existsSync` eliminado del archivo entero.

**Deuda deferida (override CR-01):**
- El flujo orchestrator-led `kodo gsd verify <session-id>` post-stop sigue roto porque `findSession` no escanea `state.history`. Override D-07 aceptado por alex. Deferido a Phase 21+.

**Warnings advisory (no bloqueantes):**
- WR-01: doble logger instancing (cleanupLog ≡ log). Fix trivial: `const cleanupLog = log`.
- WR-02: comentario obsoleto en sessionEnd block.
- WR-04: `node:child_process` re-importado en cada llamada a gitFn default.
- WR-05: convención mixta de `-C <project>` + `-C <wt>` en gitFn call-sites.

Estos warnings son tech debt menor documentado en `19-REVIEW.md` (post-19-03). No bloquean el Phase Goal ni la promoción a la siguiente fase.

---

*Verified: 2026-05-12T17:30:00Z*
*Verifier: Claude (gsd-verifier)*
*Re-verification: Sí — tras plan 19-03 (CR-02 + CR-03 gap closure)*
