---
phase: 19-worktree-cleanup-integration
verified: 2026-05-12T13:37:00Z
status: gaps_found
score: 3/3 must-haves verified (literal artifact level); 1/3 SCs end-to-end functional
overrides_applied: 0
re_verification: false
gaps:
  - truth: "SC#3 — `kodo gsd verify <session-id>` localiza VERIFICATION.md en el worktree de la sesión y produce los mismos exit codes deterministas + bytes Plane comment (Pitfall #6 Opción A invariante)"
    status: partial
    reason: |
      El cambio quirúrgico en verify.js:133 (`session.worktree_path ?? session.project_path`)
      es correcto AL NIVEL DE LECTURA (tests T20–T27 + D-06/D-09 pasan), pero el flujo
      end-to-end orchestrator-led está roto por dos eslabones en cadena identificados
      por gsd-code-review (CR-01):
        1. `runStopHook` invoca `removeSessionFn(id)` (stop.js:358) que archiva la
           sesión de `state.sessions` → `state.history` (state.js:127-141).
        2. `findSession()` (state.js:180-194) SOLO escanea `state.sessions`, NUNCA
           `state.history`. Cuando el orchestrator recibe el nudge "Ejecuta `kodo
           gsd verify <session-id>`" (buildStopNudgeText, stop.js:50) y lo ejecuta,
           verify.js:106 invoca findSessionFn que devuelve `null` → verify.js:107
           lanza `session not found: <sessionId>`.
        3. Aunque la sesión fuera recuperable, el cleanup ya borró el worktree
           (clean path) o lo movió a `.dirty/` (dirty path), así que
           `existsFn(phasesRoot)` retornaría false → verdict `'missing'`.
      Resultado: la promesa WT-06 ("verify lee del worktree") solo se sostiene
      cuando `/gsd-verify-work` se ejecuta DENTRO de la sesión Claude Code antes
      del stop hook. El camino orchestrator-led que el propio nudge anuncia ES
      una contradicción arquitectural.
      El 19-02-SUMMARY clasifica este bug como "deferido / deuda residual",
      pero el SC#3 del ROADMAP no admite caveat: "kodo gsd verify <session-id>
      localiza VERIFICATION.md" — el flujo entero falla en producción
      orchestrator-led.
    artifacts:
      - path: "src/session/state.js"
        line: "180-194"
        issue: "findSession() solo escanea state.sessions, no state.history"
      - path: "src/hooks/stop.js"
        line: "358"
        issue: "removeSessionFn(id) ejecuta ANTES de que el orchestrator pueda invocar verify"
      - path: "src/hooks/stop.js"
        line: "217-356"
        issue: "Cleanup del worktree (remove/move) ejecuta ANTES del nudge al orchestrator"
    missing:
      - "Extender findSession para escanear también state.history como fallback (mínimo invasivo) — o reordenar para que cleanup+removeSession ocurran DESPUÉS del nudge al orchestrator + grace window"
      - "Alternativa arquitectural: stop hook NUNCA borra worktree (solo emite metadata); orchestrator post-verify dispara cleanup explícito"
  - truth: "Stop hook nunca crashea (D-03 fail-open)"
    status: partial
    reason: |
      CR-02 (review): `markSessionStatus('done')` (stop.js:197) está SOLO dentro
      de `if (session.gsd)` (línea 179). Para sesiones no-GSD, la sesión transita
      a history (vía removeSessionFn línea 358) con `status: session.status`
      (típicamente 'review'), y `sessionEnd` (stop.js:171) emite el evento
      `session.end` con `status: session.status` — un valor PRE-removal, no el
      estado terminal real ('done'). El observable NDJSON contradice la realidad.
      No es crash, pero rompe la invariante implícita "session.end emite el
      estado terminal" para el 50% de sesiones (no-GSD).
    artifacts:
      - path: "src/hooks/stop.js"
        line: "179-208"
        issue: "markSessionStatus('done') está condicionado a session.gsd; sesiones no-GSD no transitan a 'done' antes de session.end"
    missing:
      - "Mover markSessionStatus FUERA del bloque if (session.gsd) — todas las sesiones deben transitar a 'done' antes de session.end + removeSession"
  - truth: "Si git worktree move falla por colisión de target, fallback a variante suffixed (Pitfall #1 mitigation)"
    status: partial
    reason: |
      CR-03 (review): `existsSync(target)` (stop.js:305) sigue symlinks por defecto
      en Node. Si `<wt>.dirty` es un symlink colgante (apuntando a un worktree
      previamente borrado), existsSync devuelve `false` — entonces el código
      intenta `git worktree move <wt> <wt>.dirty` directamente y git falla
      confusamente. El test TARGET COLLISION (stop-worktree-cleanup.test.js:153)
      solo cubre el caso `mkdirSync(dirty)`, no symlinks colgantes ni archivos
      regulares. La mitigación es funcional para el happy path pero no
      defensiva contra el caso patológico.
    artifacts:
      - path: "src/hooks/stop.js"
        line: "305"
        issue: "existsSync sigue symlinks; un symlink colgante evade la pre-check"
    missing:
      - "Sustituir existsSync por lstatSync con try/catch ENOENT — detecta archivos regulares, dirs, symlinks (colgantes y vivos) y dispara la variante .dirty-<ts> en todos los casos"
human_verification:
  - test: "Smoke real orchestrator-led: arrancar `kodo orchestrator`, lanzar una sesión GSD full con `kodo run <task>`, dejar que termine, observar que el nudge llega al orchestrator y que `kodo gsd verify <session-id>` ejecutado por el orchestrator NO falla con `session not found`"
    expected: "El verify localiza el VERIFICATION.md y comenta en Plane; exit code 0"
    why_human: "Requiere infraestructura real (orchestrator + cmux + plane API + git worktree) y el bug es de coordinación entre componentes — los unit tests no cubren la cadena completa porque mockean findSession y la sesión nunca pasa por history"
  - test: "Smoke dirty-state: ejecutar una sesión que deje `working tree dirty`, dejar que stop hook corra, verificar que `<wt>.dirty/` existe en disco, que `git worktree list` lo lista, y que la branch sigue viva"
    expected: "El directorio `.dirty/` está intacto con los cambios del usuario, accesible para inspección manual"
    why_human: "Los E2E smoke tests cubren el case en tmpdir aislado, pero la validación de UX en un repo real con archivos del usuario requiere visual inspection"
  - test: "Smoke session legacy v0.5: cargar una sesión con `worktree_path: undefined` (state.json antiguo) y confirmar que stop hook no toca git y que verify lee del project_path silently"
    expected: "Sin eventos worktree.cleanup.*, verify localiza VERIFICATION.md en el project_path, sin warn de fallback en logs"
    why_human: "Requiere fixture state.json migrado/desmigrado a v0.5 — los tests usan factories sintéticas pero no cubren la transición real"
---

# Phase 19: Worktree Cleanup & Integration — Verification Report

**Phase Goal:** El ciclo de vida del worktree cierra limpio (fail-open en caso de dirty state) y el resto de subsistemas que tocan filesystem (`auto-commit` de la skill, `kodo gsd verify`) operan dentro del worktree correcto.
**Verified:** 2026-05-12T13:37:00Z
**Status:** gaps_found (3 must-haves a nivel artefacto verificados; 1 gap end-to-end + 2 partial blockers identificados por code-review todavía sin closure plan)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must_haves)

| # | Truth (Source) | Status | Evidence |
|---|----------------|--------|----------|
| 1 | **SC#1**: Tras stop hook clean, `git worktree list` ya no incluye el worktree; si dirty, persiste con log warn | VERIFIED (con caveat CR-02/CR-03) | `src/hooks/stop.js:217-356` cablea cleanup fail-open. E2E CLEAN (`test/stop-worktree-cleanup.test.js:262`) verifica `existsSync(wt)===false` + branch borrada + evento `worktree.cleanup.ok`. E2E DIRTY (`stop-worktree-cleanup.test.js:282`) verifica `.dirty/` persiste + branch viva + evento `worktree.cleanup.dirty`. 8/8 tests pasan. |
| 2 | **SC#2**: `auto-commit` produce commits dentro del worktree; `KODO_ROOT` env override preservado | VERIFIED (satisfied-by-design D-05) | `handleOrchestratorStop` (`stop.js:393-427`) sigue con `cwd: KODO_ROOT` (líneas 414, 422). CONTEXT.md §D-05 interpreta WT-05 como "el cwd respeta el contrato D-06 por construcción" — la orchestrator session está excluida del worktree (Phase 18 D-06). Source-hygiene test `Phase 19 D-05` blinda el invariante. `test/skill-auto-commit.test.js` legacy verde (2/2). **Tensión semántica**: el texto literal de WT-05/SC#2 dice "opera DENTRO del worktree" mientras la implementación opera EN KODO_ROOT. Aceptado como deviation intencional documentada en CONTEXT D-05 (orchestrator no tiene worktree). |
| 3 | **SC#3 / WT-06**: `kodo gsd verify <session-id>` localiza VERIFICATION.md en el worktree con mismos exit codes + bytes Plane comment | **FAILED (end-to-end)** | A NIVEL DE LECTURA: `src/gsd/verify.js:133` con `??` fallback pasa los tests `T20-T27` + 3 nuevos (D-06 worktree, D-09 legacy, source-hygiene). PERO el FLUJO ORCHESTRATOR-LED está roto por CR-01: `findSession` (state.js:180-194) no escanea `state.history`, y `removeSessionFn` (stop.js:358) + cleanup (stop.js:217-356) ejecutan ANTES del nudge al orchestrator (stop.js:362-371). El orchestrator que recibe el nudge no puede invocar verify porque la sesión ya está en history y el worktree ya no existe. Ver gap detallado. |
| 4 | **PLAN must_have**: EVENTS exporta 11 strings incluyendo 3 nuevos `worktree.cleanup.*` (D-10) | VERIFIED | `src/logger-events.js:35-47` (12 matches grep). `test/logger-events.test.js` 15/15 pasan, inventory test confirma 11 strings ordenados. |
| 5 | **PLAN must_have**: 3 helpers tipados (`worktreeCleanupOk`/`Dirty`/`Error`) con level info/warn/error + shape exacto | VERIFIED | `src/logger-events.js:221, 237, 259`. Contract tests asertan `level`, `event`, y todos los campos del shape. 3/3 pasan. |
| 6 | **PLAN must_have**: handleOrchestratorStop preserva `cwd: KODO_ROOT` (D-05) | VERIFIED | `src/hooks/stop.js:414, 422` (2 matches grep). Source-hygiene test específico Phase 19 D-05 blinda con regex match. |
| 7 | **PLAN must_have**: Cleanup ocurre DESPUÉS de releaseGsdLock (D-07) | VERIFIED | awk check: `releaseGsdLock` línea 204 < `worktreeCleanupOk` línea 221. Source-hygiene test específico Phase 19 D-07 blinda. |
| 8 | **PLAN must_have**: Branch name leído ANTES de worktree remove (D-08 / Pitfall #2) | VERIFIED | awk check: `--show-current` línea 241 < `'worktree', 'remove'` línea 270. Source-hygiene test específico Phase 19 D-08 blinda. |
| 9 | **PLAN must_have**: Legacy v0.5 sin worktree_path → skip silencioso (D-09) | VERIFIED | `stop.js:217` guard `if (session.worktree_path)`. Test LEGACY (`stop-worktree-cleanup.test.js:190`) verifica `calls.length === 0` y sin eventos `worktree.cleanup.*`. Verify también con `??` fallback silent. |
| 10 | **PLAN must_have**: D-01 dirty = `git status --porcelain` no vacío (commits unpushed NO cuentan) | VERIFIED | `stop.js:254`. Test DIRTY usa `'M file.txt\n?? new.txt\n'` como dirty signal. Sin path que evalúe `git log @{u}..HEAD` o equivalentes. |

**Score (must-haves nivel artefacto):** 9/10 VERIFIED. **Score (Success Criteria end-to-end funcional):** 2/3 (SC#3 partial — flujo orchestrator-led roto por CR-01).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/logger-events.js` | EVENTS + 3 helpers tipados | VERIFIED | 268 líneas; 12 grep matches para `WORKTREE_CLEANUP_*`; helpers exportados línea 221, 237, 259 |
| `src/hooks/stop.js` | Cleanup fail-open tras releaseGsdLock + gitFn DI | VERIFIED (con caveats CR-02/CR-03) | 434 líneas; bloque cleanup 217-356; 21 grep matches para markers requeridos. `existsSync` sigue symlinks (CR-03) |
| `src/gsd/verify.js` | phasesRoot con `??` fallback + JSDoc | VERIFIED | Línea 133 productiva, línea 24 comentario header (`grep -c == 2` por la cita literal del codepoint, deviation documentada en 19-02-SUMMARY) |
| `test/logger-events.test.js` | Contract tests + inventory updated | VERIFIED | 15/15 pasan; inventory test refleja 11 strings |
| `test/stop-worktree-cleanup.test.js` | 6 unit + 2 E2E con git real | VERIFIED | 8/8 pasan (CLEAN, DIRTY, ERROR, COLLISION, LEGACY, BRANCH-D-FAIL + 2 E2E) |
| `test/gsd-verify-integration.test.js` | +3 tests (D-06, D-09, source-hygiene) | VERIFIED | 11/11 pasan (8 existentes + 3 nuevos) |
| `test/stop.test.js` | +3 source-hygiene asserts D-05/D-07/D-08 | VERIFIED | 18/18 pasan (15 existentes + 3 nuevos) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/hooks/stop.js` | `src/logger-events.js` | `dynamic import { worktreeCleanupOk/Dirty/Error }` | WIRED | `stop.js:220-224` |
| `src/hooks/stop.js` | git CLI | `gitFn(cwd, args) → execFileSync('git', ['-C', cwd, ...args])` | WIRED | Default factory `stop.js:105-108`; producción usa execFileSync real |
| `src/gsd/verify.js` | `SessionRecord.worktree_path` | nullish coalescing en phasesRoot | WIRED | `verify.js:133` |
| `test/stop-worktree-cleanup.test.js` | `src/hooks/stop.js` | `runStopHook({...}, { gitFn, loggerFactory, ... })` | WIRED | 8 invocaciones con stubs/E2E |
| **`src/hooks/stop.js` (nudge) → `src/gsd/verify.js`** | **`findSession({ sessionId })`** | **state.json lookup** | **BROKEN** | **CR-01**: `findSession` (state.js:180) escanea solo `state.sessions`; `removeSessionFn` (stop.js:358) movió la sesión a `state.history`. El orchestrator-led verify no puede recuperar la sesión |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `stop.js` cleanup block | `session.worktree_path` | `findSession` returns `SessionRecord` con campo aditivo Phase 18 D-03c | YES (Phase 18 verificado completo per ROADMAP) | FLOWING |
| `verify.js` phasesRoot | `session.worktree_path` | mismo source que arriba | YES (lectura) / **NO (end-to-end, session no recuperable post-removeSession)** | **DISCONNECTED end-to-end (CR-01)** |
| Cleanup events NDJSON | `cleanupLog` payload | `worktreeCleanup{Ok,Dirty,Error}` helpers | YES | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| EVENTS frozen + 11 strings + 3 helpers exportados | `node -e "import('./src/logger-events.js').then(m => console.log(Object.values(m.EVENTS).length === 11 && typeof m.worktreeCleanupOk === 'function'))"` | (asumido por test suite verde) | PASS (implícito por tests) |
| Phase 19 specific tests | `node --test test/stop-worktree-cleanup.test.js test/gsd-verify-integration.test.js test/logger-events.test.js test/stop.test.js` | 52/52 pass | PASS |
| Suite global sin regresiones | `npm test` | **564 tests / 563 pass + 1 skip** (skip pre-existente, no introducido por Phase 19) | PASS |
| awk D-07 (releaseGsdLock < worktreeCleanupOk) | `awk` over stop.js | lock:204 cleanup:221 | PASS |
| awk D-08 (--show-current < worktree remove) | `awk` over stop.js | branch:241 remove:270 | PASS |
| LOG-12 invariant | `grep -l "logger-events" src/check.js src/cli/format.js` | 0 matches | PASS |
| End-to-end orchestrator-led verify | (not testable automatically — requires real orchestrator + cmux + plane) | N/A | SKIP (→ human verification) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| **WT-04** | 19-01 + 19-02 | Stop hook hace cleanup del worktree (`git worktree remove`) tras release del lock, fail-open si dirty | SATISFIED (con caveats CR-02/CR-03) | 8/8 tests stop-worktree-cleanup pasan; 2 E2E con git real |
| **WT-05** | 19-02 | `auto-commit` opera dentro del worktree; KODO_ROOT env override preservado | SATISFIED (satisfied-by-design) | `handleOrchestratorStop` preserva `cwd: KODO_ROOT`; D-05 interpreta WT-05 como contrato D-06 por construcción. **Pero tensión semántica con la lectura literal de WT-05** — ver Truth #2 |
| **WT-06** | 19-02 | `kodo gsd verify` lee VERIFICATION.md desde el worktree | **PARTIAL** | El cambio quirúrgico verify.js:133 funciona en aislamiento (tests pasan), pero el flujo orchestrator-led (que es el caso de uso real para WT-06 + SC#3) está roto por CR-01 |

**Orphaned requirements:** ninguno detectado — los 3 IDs WT-04/05/06 están reclamados por 19-01/19-02. REQUIREMENTS.md todavía marca WT-04/05/06 como `pending` (línea 76-78); el sync de status pertenece a una fase posterior (no es gap de Phase 19).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/hooks/stop.js` | 305 | `existsSync(target)` (sigue symlinks) | Warning (CR-03) | Symlinks colgantes evaden la pre-check de Pitfall #1; git `worktree move` fallaría confusamente. Edge case raro pero la mitigación NO es defensiva |
| `src/hooks/stop.js` | 179-208 | `markSessionStatus('done')` solo en `if (session.gsd)` | Warning (CR-02) | Sesiones no-GSD emiten `session.end` con `status: 'review'` (stale) en lugar de `done` |
| `src/session/state.js` | 180-194 | `findSession` no escanea `state.history` | **Blocker (CR-01)** | Rompe el flujo orchestrator-led verify (WT-06 / SC#3 end-to-end) |
| `src/gsd/verify.js` | 24 | Comentario header cita el codepoint literal `??` | Info (deviation documentada en 19-02-SUMMARY) | `grep -c` da 2 en lugar de 1; el spirit del acceptance criterion (single source productiva) está respetado, pero el grep literal del plan no |

### Human Verification Required

(Ver `human_verification:` en frontmatter — 3 items: smoke orchestrator-led, smoke dirty-state, smoke legacy v0.5.)

### Gaps Summary

**Gap principal (BLOCKER end-to-end de SC#3):** El review del código (`19-REVIEW.md` CR-01) identifica que el cleanup del worktree + `removeSessionFn` ejecutan ANTES del nudge al orchestrator, y `findSession` NO escanea `state.history`. Esto significa que el caso de uso publicitado por el propio nudge ("Ejecuta `kodo gsd verify <session-id>`") **falla con `session not found`** en producción orchestrator-led. El 19-02-SUMMARY clasifica esto como "deuda residual deferida", pero la lectura estricta del Phase Goal y de SC#3 NO admite el caveat — el ciclo del worktree no "cierra limpio" si el verify orchestrator-led queda quebrado.

**Tensión documentada en SC#2 (WT-05):** El texto literal del requirement dice "auto-commit opera DENTRO del worktree", pero la implementación opera en `KODO_ROOT` con justificación D-05 (orchestrator excluido del worktree per Phase 18 D-06). Acceptable como deviation documentada pero el ROADMAP SC#2 debería actualizarse para reflejar el contrato real ("preserva el cwd de auto-commit per construcción D-06") — esto NO es bloqueante de Phase 19 si el equipo acepta la interpretación, pero conviene anotarlo.

**Warnings menores (CR-02, CR-03):** Anti-patrones que NO bloquean el goal pero degradan la robustez. CR-02 lleva a `session.end` con status stale para sesiones no-GSD (observable NDJSON inconsistente); CR-03 deja un edge case (symlinks colgantes) sin mitigación defensiva.

**Decisión de fase (recomendación para el orquestador humano):**

- **Si CR-01 se acepta como deuda explícita** (documentada en 19-CONTEXT.md §Deferred y referenciada en 19-02-SUMMARY) y el equipo afirma que `/gsd-verify-work` se ejecuta DENTRO de la sesión Claude Code (no via orchestrator post-stop), entonces el goal está cumplido para el flujo embedded y el override es procedente. **En ese caso conviene añadir un override formal en VERIFICATION.md frontmatter** con `must_have: "SC#3 end-to-end orchestrator-led"`, `reason: "WT-06 cubre el embedded /gsd-verify-work flow; el orchestrator-led queda fuera de scope hasta findSession extienda a history"`, `accepted_by: "<usuario>"`.
- **Si el flujo orchestrator-led ES parte del goal**, este es un BLOCKER y requiere closure plan (extender `findSession` para fallback a history, o reordenar stop hook).

Recomendación del verificador: **escalar la decisión** porque la lectura literal del Phase Goal ("ciclo de vida cierra limpio Y resto de subsistemas que tocan filesystem operan dentro del worktree correcto") + SC#3 sugiere que el verify orchestrator-led ES in-scope, y el `buildStopNudgeText` del propio stop.js publicita ese flujo al orchestrator. Si el equipo prefiere diferir, debe aceptarse explícitamente como override.

---

*Verified: 2026-05-12T13:37:00Z*
*Verifier: Claude (gsd-verifier)*
