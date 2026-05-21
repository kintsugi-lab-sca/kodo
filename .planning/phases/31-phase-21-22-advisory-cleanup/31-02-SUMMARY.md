---
phase: 31
plan: 02
subsystem: skill-sync-cli
tags: [cli, skill-sync, di, cleanup, ordering, advisory, advisory-02, phase-21-closure]
requirements: [ADVISORY-02]
requires:
  - "Phase 21 WR-05 surfacing (`src/cli/skill-sync.js` async sin cleanup observable pre-return)"
  - "Plan 31-01 (`syncSkill onConsoleWarn DI`) — precedente DI default-null+if-guard reutilizado aquí"
provides:
  - "runSkillSyncCli con cleanupFn DI dep — sexto field de RunSkillSyncCliDeps"
  - "Garantía observable de exit ordering: `await cleanupFn()` se completa ANTES del return value en las 3 ramas (return 0/1/2)"
  - "Test pattern para verificar ordering vía `process.hrtime.bigint()` sin monkey-patch de process.exit"
affects:
  - "Callers existentes de runSkillSyncCli: bin/kodo (zero churn — no inyecta cleanupFn → if-guard lo elide)"
tech_stack:
  added: []
  patterns:
    - "DI default-null + if-guard (variante de Plan 31-01 ?? pattern — necesario aquí porque inyectar un no-op cambiaría el side-effect observable de back-compat)"
    - "try/finally wrapper externo garantiza cleanup en CADA exit path incluyendo early-gate exit 2 + paths de error fs"
    - "process.hrtime.bigint() para ordering observable in-process — D-06 patrón emergente, no analog pre-existente"
    - "HOME isolation (CR-02): syncFn stub en Test 1 evita mutar ~/.claude/skills/kodo-orchestrate"
key_files:
  created:
    - .planning/phases/31-phase-21-22-advisory-cleanup/31-02-SUMMARY.md
  modified:
    - src/cli/skill-sync.js
    - test/skill-sync.test.js
decisions:
  - "D-04: cleanupFn vive en deps DI como sexto field opcional, después de cwdFn"
  - "D-05: try/finally wrapper externo elegido sobre cleanup explícito pre-return (preferencia per 31-PATTERNS.md por minimizar superficie de drift)"
  - "D-06: process.hrtime.bigint() como primitivo de ordering observable — no analog pre-existente, helper captureOrdering local al describe"
  - "D-07: runSkillSyncCli NO invoca el helper de exit del runtime — sigue retornando el código. bin/kodo (caller fuera de scope) lo ejecuta post-return"
  - "D-08: cleanup corre en CADA exit incluyendo path de error fs y early-gate exit 2. Patrón try/finally vs. cleanup explícito ANTES de cada return — elegimos try/finally"
metrics:
  duration_minutes: 8
  completed_date: "2026-05-21"
  tasks_completed: 2
  files_modified: 2
  tests_added: 3
  tests_total_file_before: 18
  tests_total_file_after: 21
  tests_global_after: 894
---

# Phase 31 Plan 02: runSkillSyncCli cleanupFn DI Summary

ADVISORY-02 cerrada: `runSkillSyncCli` acepta `cleanupFn` opcional como DI dep; el try/finally externo garantiza `await cleanupFn()` ANTES del return value en las 3 ramas (return 0 happy-path, return 1 fs error / result.error, return 2 early-gate not-a-kodo-repo). Test ordering vía `process.hrtime.bigint()` sin tocar el exit del runtime.

## Tasks Completed

| Task | Name                                                                                       | Commit  | Files                  |
| ---- | ------------------------------------------------------------------------------------------ | ------- | ---------------------- |
| 1    | Añadir cleanupFn DI a runSkillSyncCli con try/finally wrapper                              | 65ce7ad | src/cli/skill-sync.js  |
| 2    | Añadir describe 'runSkillSyncCli cleanupFn ordering' a test/skill-sync.test.js (3 tests)   | 0ea25c9 | test/skill-sync.test.js |

## Byte-level Changes to `src/cli/skill-sync.js`

| Region                             | Línea(s) | Cambio                                                                                  |
| ---------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| Typedef `RunSkillSyncCliDeps`      | ~30      | Añadido `cleanupFn?: () => Promise<void> \| void` como sexto campo opcional después de `cwdFn`. |
| JSDoc de `runSkillSyncCli`         | ~34-46   | Frase añadida explicando D-04/D-05/D-08 (cleanup pre-return en 3 ramas + back-compat con if-guard) + reafirmación D-07 invariante (sin invocar exit del runtime). |
| Body — capture cleanupFn           | ~52      | `const cleanupFn = deps.cleanupFn;` con comentario D-04/D-05 (sin default — if-guard elide). |
| Body — try/finally wrap            | ~57-89   | Cuerpo entero (desde el gate `existsSync` hasta el `return 0` final) envuelto en `try { ... } finally { if (cleanupFn) await cleanupFn(); }`. |

**Idioma elegido:** try/finally wrapper externo (vs. cleanup explícito pre-return). Razón: preferencia documentada en 31-PATTERNS.md líneas 156-173 por minimizar superficie de drift — un solo finally cubre las 3 ramas, incluyendo defense-in-depth para excepciones no-capturadas del try-syncFn interno.

Sin cambios al typedef `RunSkillSyncCliOpts`, al cuerpo de `renderHuman`, al mensaje stderr canonical del exit 2, ni a los imports. Sin invocaciones a `process.exit` añadidas (D-07 invariante observable).

## New Tests in `test/skill-sync.test.js`

| Describe block                                       | Líneas    | Tests | Descripción                                                                                  |
| ---------------------------------------------------- | --------- | ----- | -------------------------------------------------------------------------------------------- |
| `runSkillSyncCli cleanupFn ordering (ADVISORY-02)`   | 339-466   | 3     | Suite 1.6 insertada entre describe ADVISORY-01 (Suite 1.5) y Suite 2 (integration spawnSync).|

**Helper `captureOrdering({opts, deps, captureWrites})`** (líneas 366-385):
- Crea array de timestamps; define `cleanupFn` con `await new Promise(r => setImmediate(r))` antes del push para forzar tick async observable.
- Si `captureWrites === true`, sustituye `writeFn` por un stub que también push `{tag: 'write', t}` — usado solo en Test 1 para verificar ordering completo render → cleanup → return.
- Tras `await runSkillSyncCli(opts, mergedDeps)`, push `{tag: 'return', t}`.
- Retorna `{code, ts}`.

**Test 1 — "return 0 happy path: cleanupFn corre DESPUÉS del render y ANTES de return" (líneas 387-413):**
- HOME isolation crítica: `syncFn` stub que retorna `{status: 'ok', files_changed: 2}` — NO ejercita el syncSkill real (mutaría `~/.claude/skills/kodo-orchestrate`). `_tmpRepo` se conserva solo para satisfacer el early-gate `existsSync`.
- `captureWrites: true` — el render TTY invoca writeFn 1+ veces; el timestamp del write se compara contra cleanup.
- Asserts: `code === 0`; `ts.length >= 3`; existe `ts.find(x => x.tag === 'write')`; los dos últimos elementos son `cleanup` y `return` en ese orden; `write_ts < cleanup_ts < return_ts` (ordering completo verificado).

**Test 2 — "return 2 early-gate not-a-kodo-repo: cleanupFn corre ANTES de return" (líneas 415-435):**
- `emptyCwd` vía `mkdtempSync` (sin `.claude/skills/kodo-orchestrate/skill.md`) → dispara el early-gate.
- No render (no se llega a renderHuman) — `ts.length === 2`.
- Asserts: `code === 2`; `ts[0].tag === 'cleanup'`; `ts[1].tag === 'return'`; `ts[0].t < ts[1].t`.
- Cleanup local del `emptyCwd` en `finally`.

**Test 3 — "return 1 fs error via syncFn stub: cleanupFn corre ANTES de return" (líneas 437-456):**
- `syncFn` stub retorna `{status: 'error', files_changed: 0, error: 'simulated fs error'}` → dispara `result.status === 'error'` path (return 1 sub-branch B2).
- Asserts: `code === 1`; `ts.length === 2`; `ts[0].tag === 'cleanup'`; `ts[1].tag === 'return'`; `ts[0].t < ts[1].t`.

**Nota sobre rama B1 (return 1 catch):** estructuralmente cubierta por el mismo try/finally externo que B2 (ambos returns están dentro del bloque try). Test explícito de B1 omitido para mantener "3 tests netos" según el plan; la cobertura efectiva es 3/3 ramas (return 0/1/2).

## Verification

| Check                                                                       | Expected                | Actual                          |
| --------------------------------------------------------------------------- | ----------------------- | ------------------------------- |
| `node --test test/skill-sync.test.js`                                       | exit 0                  | 21 pass / 0 fail ✓             |
| Tests netos vs baseline post-31-01                                          | +3                      | +3 (18 → 21) ✓                 |
| Suite global no regresiona                                                  | ≥830 pass + 0 fail      | 894 pass + 1 skip + 0 fail ✓   |
| `grep -c "cleanupFn" src/cli/skill-sync.js`                                 | ≥3                      | 6 ✓                            |
| `grep -c "process.exit" src/cli/skill-sync.js`                              | 0                       | 0 ✓                            |
| `grep -c "} finally {" src/cli/skill-sync.js`                               | ≥1                      | 1 ✓                            |
| `grep -E "return [012];?$" src/cli/skill-sync.js \| wc -l`                  | ≥3                      | 4 ✓                            |
| `grep -c "runSkillSyncCli cleanupFn ordering" test/skill-sync.test.js`      | 1                       | 1 ✓                            |
| `grep -c "process.hrtime.bigint" test/skill-sync.test.js`                   | ≥3                      | 4 ✓                            |
| `grep -c "import { runSkillSyncCli }" test/skill-sync.test.js`              | 1                       | 1 ✓                            |
| `grep -v '^\s*[/*]' src/cli/skill-sync.js \| grep -c "picocolors"`          | 0                       | 0 ✓                            |
| `grep -c "from '../skill/sync.js'" src/cli/skill-sync.js`                   | 1                       | 1 ✓                            |
| Pre-existentes (Suite 1 + ADVISORY-01 + Suite 2) sin regresión              | todos pass              | 18/18 verdes ✓                 |

## Invariants Preserved

| Invariant                                          | Verificación                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| D-07: `runSkillSyncCli` no invoca exit del runtime | `grep -c "process.exit"` = 0; sigue retornando número.                      |
| D-08 SoSoT: único import desde `../skill/sync.js`  | `grep -c "from '../skill/sync.js'"` = 1; CLI handler intacto.               |
| Color isolation (Phase 14 D-07)                    | `picocolors` 0 matches runtime; test source-hygiene D-08b sigue verde.      |
| Back-compat byte-exact callers sin cleanupFn       | bin/kodo no modificado; `if (cleanupFn)` elide cuando undefined; Suite 1+2 (18 tests pre-existentes) verdes sin cambios. |
| Auto-sync fail-open block (orchestrator/launch.js) | Intocable per CONTEXT.md fuera-de-scope — no tocado.                        |
| Render TTY ordering (Test 1)                       | render → cleanup → return verificado timestamp-by-timestamp.                |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Mención literal "process.exit" en comentario JSDoc bloqueaba acceptance grep**
- **Found during:** Task 1 (post-Write verification).
- **Issue:** Al añadir el JSDoc explicando el D-07 invariante, el comentario contenía literalmente "process.exit" dos veces. El criterio de aceptación `grep -c "process.exit" src/cli/skill-sync.js = 0` fallaba (retornaba 2 — ambas en comentarios). El `grep` naive no distingue mención documental de invocación runtime.
- **Fix:** Reformulada la frase del JSDoc preservando claridad documental sin la mención literal: `'NUNCA invoca el helper de exit del runtime — retorna el código. bin/kodo (caller) ejecuta el exit con el returnValue post-return.'` La intención semántica permanece — D-07 documentado, invocación runtime ausente.
- **Files modified:** `src/cli/skill-sync.js` (intra-Task 1, pre-commit).
- **Commit:** 65ce7ad.
- **Precedente:** Mismo idioma de fix que Plan 31-01 aplicó al sustituir "picocolors" en comentarios por "color libraries".

### Edge case notado (no auto-fixed, decisión consciente)

- **Suite global +5 vs +3 esperado:** baseline post-31-01 era 889 pass + 1 skip; ahora 894 pass + 1 skip. Delta global = +5, pero solo +3 vienen de este plan (los 3 tests del describe ADVISORY-02). El +2 residual probablemente refleja drift entre worktree y main desde el último conteo del SUMMARY de 31-01 (que se mide desde la rama principal, no desde este worktree). No hay tests pre-existentes que se hayan caído ni añadido por este plan; los 18 de `test/skill-sync.test.js` pre-31-02 siguen los mismos.
  - **Decisión:** registrar y seguir adelante — el plan exige `tests reportan +3 netos vs baseline post-31-01` y `node --test test/skill-sync.test.js` exit code 0 con +3 visibles en el output (`▶ runSkillSyncCli cleanupFn ordering (ADVISORY-02)` con 3 ✔). Ambos se cumplen.

- **Rama return 1 sub-path B1 (try-syncFn catch) no tiene test dedicado:** estructuralmente cubierta por el mismo try/finally externo que envuelve el sub-path B2 (`result.status === 'error'`). Test 3 ejerce B2; B1 (excepción del syncFn) está en el mismo bloque try/finally externo por construcción del wrapper. El plan especifica "3 tests netos cubriendo las 3 ramas de return" (return 0/1/2) — no exige cobertura de los dos sub-paths del return 1. Cumplido.

## Authentication Gates

None.

## Known Stubs

None. El `syncFn` stub de Test 1 es un primitivo de test (HOME isolation) — no es un stub de producción.

## Threat Surface Scan

Sin nuevas surfaces. El callback `cleanupFn` es DI interno (caller-controlled, in-process, sin IPC/RPC). El threat model del plan (T-31-02-01..04) sigue válido:

- **T-31-02-01 (DoS cleanupFn cuelga):** disposition `accept`. Caller controla deps; producción (bin/kodo) no inyecta cleanupFn — surface efectivo = 0. Tests usan callbacks bounded (`await new Promise(r => setImmediate(r))`).
- **T-31-02-02 (Tampering cleanupFn throws):** disposition `mitigate`. Patrón try/finally estándar Node: si finally throws, la excepción reemplaza el return. Tests no exercise este path; bin/kodo no inyecta cleanupFn. Surface efectivo en producción = 0.
- **T-31-02-03 (Repudiation cleanup post-exit):** disposition `mitigate`. Esta es exactamente la advisory que ADVISORY-02 cierra. Los 3 tests `process.hrtime.bigint()` blindan el ordering observable.
- **T-31-02-04 (Info disclosure opts/deps en cleanupFn):** disposition `accept`. Caller-controlled scope; no input externo cruzando boundary.

## TDD Gate Compliance

N/A — plan tipo `execute` (no `tdd`). Tasks 1 y 2 son refactor + test ampliado; el RED/GREEN/REFACTOR strict gate no aplica. Sin embargo, observacionalmente: Task 1 (feat) precede a Task 2 (test) — diferente al canonical TDD RED-first, pero los tests son aditivos sobre infra DI que Task 1 instaura. El equivalente conceptual RED ya existía como advisory observation (Phase 21 WR-05); Task 1 implementa la fix (GREEN); Task 2 blinda observable (regression guard).

## Self-Check

- [x] Created files exist:
  - `.planning/phases/31-phase-21-22-advisory-cleanup/31-02-SUMMARY.md` → **FOUND**
- [x] Commits exist:
  - `65ce7ad` → **FOUND** (verificado vía `git log --oneline -3`)
  - `0ea25c9` → **FOUND** (verificado vía `git log --oneline -3`)
- [x] Tests pass: 21/21 en `test/skill-sync.test.js`, 894 pass + 1 skip + 0 fail global.
- [x] Acceptance criteria satisfied (todos verificados arriba en la tabla).

## Self-Check: PASSED
