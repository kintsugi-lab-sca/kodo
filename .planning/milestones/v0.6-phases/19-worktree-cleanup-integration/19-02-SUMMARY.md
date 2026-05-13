---
phase: 19-worktree-cleanup-integration
plan: 02
subsystem: hooks
tags:
  - worktree-cleanup
  - stop-hook
  - gsd-verify
  - phase-19
  - WT-04
  - WT-05
  - WT-06
requires:
  - src/hooks/stop.js (runStopHook DI, releaseGsdLock order)
  - src/gsd/verify.js (phasesRoot resolution)
  - src/logger-events.js (worktreeCleanup{Ok,Dirty,Error} helpers, Plan 19-01)
  - src/session/state.js (SessionRecord.worktree_path field, Phase 18)
provides:
  - "Worktree cleanup fail-open en stop hook: remove (clean) | move (dirty/.dirty) + branch -D + prune oportunista"
  - "verify.js phasesRoot resuelve session.worktree_path ?? session.project_path"
  - "5 try/catch internos (status/remove/move/branch/prune) emiten cleanup.error{phase} pero NUNCA crashean el hook"
  - "Pitfall #1 (collision pre-check via existsSync) + Pitfall #2 (branch read antes de remove) mitigados"
  - "Source-hygiene asserts D-05/D-07/D-08 en test/stop.test.js (living documentation)"
affects:
  - test/stop-worktree-cleanup.test.js (NEW — 6 unit + 2 E2E)
  - test/gsd-verify-integration.test.js (+3 tests: D-06 worktree, D-09 legacy, source-hygiene)
  - test/stop.test.js (+3 source-hygiene asserts)
tech-stack:
  added: []
  patterns:
    - "Dependency injection: deps.gitFn inyectable + default execFileSync wrapper (espejo Phase 16 W-4 DI pattern)"
    - "Fail-open con outer try/catch + 5 inner try/catch por sub-fase (espejo session.end + releaseGsdLock pattern)"
    - "Source-hygiene asserts: grep contra el source para blindar invariantes de orden"
    - "Pre-check existsSync antes de git worktree move (mitigación Pitfall #1)"
key-files:
  created:
    - test/stop-worktree-cleanup.test.js
  modified:
    - src/hooks/stop.js
    - src/gsd/verify.js
    - test/gsd-verify-integration.test.js
    - test/stop.test.js
decisions:
  - "D-01 dirty = git status --porcelain output no vacío (NO incluye commits unpushed)"
  - "D-02 dirty preserva via worktree move → <wt>.dirty (con fallback renameSync+repair y collision-suffix .dirty-<ts>)"
  - "D-03 fail-open: console.error + continuar, NUNCA crash stop hook"
  - "D-04 prune oportunista al final del cleanup, su propio try/catch"
  - "D-05 satisfied-by-design: handleOrchestratorStop SIN cambios funcionales (cwd: KODO_ROOT preservado)"
  - "D-06 verify.js: phasesRoot = join(session.worktree_path ?? session.project_path, '.planning', 'phases')"
  - "D-07 cleanup OCURRE DESPUÉS de releaseGsdLock (source-hygiene assert)"
  - "D-08 branch --show-current se lee ANTES de worktree remove (Pitfall #2 mitigación)"
  - "D-09 legacy v0.5 sin worktree_path → skip silencioso (cleanup) + fallback silent (verify)"
  - "D-10 imports dinámicos de logger-events (lazy + sin LOG-12 regression)"
metrics:
  duration: "~25m"
  completed: "2026-05-12T11:35:00Z"
  tests_added: 14
  tests_total_after: 564
  global_suite: "564 tests / 563 pass + 1 skip pre-existing"
requirements:
  - WT-04 (worktree cleanup en stop hook)
  - WT-05 (handleOrchestratorStop cwd: KODO_ROOT — satisfied-by-design)
  - WT-06 (verify.js lee VERIFICATION.md del worktree)
---

# Phase 19 Plan 02: Worktree Cleanup & Verify Integration — Summary

One-liner: Phase 19 cierra el ciclo de vida del worktree creado por Phase 18 cableando cleanup fail-open en `src/hooks/stop.js` (5 try/catch internos + collision pre-check + branch-before-remove + prune oportunista), reapuntando `kodo gsd verify` para leer VERIFICATION.md desde el worktree con fallback nullish coalescing (`session.worktree_path ?? session.project_path`), y blindando D-05/D-07/D-08 con source-hygiene asserts ejecutables.

## Decisions Applied

- **D-01 — Dirty = `git status --porcelain` output no vacío** sobre el worktree. Commits unpushed NO cuentan como dirty (driver ROMAN-113…118: lo que se pierde es trabajo sin commit, no commits unpushed). Verificado en tests CLEAN (status vacío) + DIRTY (`'M file.txt\n?? new.txt\n'`).
- **D-02 — DIRTY preserva trabajo via `git worktree move <wt> <wt>.dirty`** + fallback `renameSync + git worktree repair` si el move nativo falla. Branch se PRESERVA (no `branch -D`). Test E2E DIRTY corre git real y verifica `existsSync(<wt>.dirty)` + branch sigue listada.
- **D-03 — Fail-open**: 5 try/catch internos (status / remove / move / branch -D / prune) + 1 outer try/catch defensivo. `runStopHook` NUNCA crashea Claude Code aún si todos fallan. Verificado en test ERROR on remove (lanza `EBUSY` → emite `cleanup.error{phase:remove}` y await completa sin throw).
- **D-04 — `git worktree prune` oportunista** al final del cleanup, en su propio try/catch fail-open. Verificado en test CLEAN (assert orden `pruneIdx > branchDelIdx`).
- **D-05 — `handleOrchestratorStop` satisfied-by-design**: ningún cambio funcional. Sigue corriendo con `cwd: KODO_ROOT` (env override `process.env.KODO_ROOT || join(__dirname, '..', '..')` intacto desde Phase 999.1 D-16). Source-hygiene assert garantiza que `cwd: KODO_ROOT` aparece dentro del bloque de la función.
- **D-06 — `verify.js:133` (post-edit) resuelve `phasesRoot` con `session.worktree_path ?? session.project_path`**. Sesión v0.6+ con worktree → lee VERIFICATION.md de ahí; legacy v0.5 sin campo → fallback transparente (D-09).
- **D-07 — Cleanup OCURRE DESPUÉS de `releaseGsdLock`** (cuando aplica) Y ANTES de `removeSessionFn(id)`. Bloque está fuera del `if (session.gsd)` porque cleanup también aplica a sesiones no-GSD (worktree-only). Source-hygiene assert `lockIdx < cleanupIdx` blinda el orden.
- **D-08 — `branch --show-current` se lee ANTES de `worktree remove`** (Pitfall #2). Si se invierte el orden, `git -C <wt> branch --show-current` falla con exit 128 (worktree ya no existe) y el catch fail-open silencia → branch zombie. Source-hygiene assert `showCurrentIdx < removeIdx` blinda.
- **D-09 — Legacy v0.5 silencioso**: `if (session.worktree_path)` guard al entrar al cleanup; sesiones sin el campo NO emiten `worktree.cleanup.*` ni invocan `gitFn`. Verify hace el mismo skip via nullish coalescing. Tests dedicados (LEGACY + D-09 verify) blindan ambos paths.
- **D-10 — Imports dinámicos** de `logger-events.js`, `fs.existsSync/renameSync`, `logger.js` dentro del bloque cleanup. Preserva LOG-12 (cleanup no es parte del grafo de `src/check.js`) y aísla el cost.

## Sitio Exacto del Cleanup en `src/hooks/stop.js`

- **DI default añadido** al destructuring de `runStopHook` (post línea 101, ahora `const gitFn = deps.gitFn || (async (cwd, args) => ...)`).
- **Bloque cleanup insertado** entre líneas 201 (cierre del `if (session.gsd)` con `releaseGsdLock`) y 203 (`removeSessionFn(id)`). Espejo del orden D-07.
- **handleOrchestratorStop** (líneas finales del archivo) intacto: `cwd: KODO_ROOT` + `execSync` patterns sin tocar (D-05 / WT-05 satisfied-by-design).
- 5 try/catch internos en el bloque cleanup mapeados a las 5 sub-fases del flujo: `status` (lectura porcelain), `remove` (clean path), `move` (dirty path con fallback), `branch` (warn-only fail-open per Pitfall #3), `prune` (oportunista final).

## Pitfalls Mitigados

| Pitfall | Mitigación | Test que blinda |
| ------- | ---------- | --------------- |
| **#1** `git worktree move` mete A DENTRO de B si B existe | `existsSync(<wt>.dirty)` pre-check → variante `<wt>.dirty-<Date.now()>` | TARGET COLLISION (unit, crea `.dirty` real con `mkdirSync`) |
| **#2** Leer branch DESPUÉS de remove → branch zombie | Orden estricto: `branch --show-current` → `status --porcelain` → `worktree remove` → `branch -D` | CLEAN unit asserts orden + Phase 19 D-08 source-hygiene en `test/stop.test.js` |
| **#3** `branch -D` con branch in-use por otro worktree → exit 128 | Try/catch warn-only fail-open. Emite `cleanup.ok` con `branch_deleted: false` (NO `cleanup.error`) | BRANCH-D FAILURE unit |
| **#4** Race con cmux dejando FDs abiertos → EBUSY | Try/catch `cleanup.error{phase:'remove'}` fail-open | ERROR on remove unit |
| **#6** verify.js Opción A: exit codes + bytes Plane comment invariantes | Cambio quirúrgico de 1 línea + JSDoc; orchestratorReview emitido en TODAS las ramas (D-17 intacto) | T20–T27 existentes siguen verdes |

## Cobertura WT-04 / WT-05 / WT-06

| Requirement | Cubierto por | Tests |
| ----------- | ------------ | ----- |
| **WT-04** Stop hook cleanup fail-open | `src/hooks/stop.js` bloque cleanup tras releaseGsdLock | `test/stop-worktree-cleanup.test.js` (6 unit + 2 E2E git real) + `test/stop.test.js` 3 source-hygiene asserts |
| **WT-05** auto-commit corre con `cwd: KODO_ROOT` | `handleOrchestratorStop` sin cambios (satisfied-by-design, D-05) | `test/skill-auto-commit.test.js` legacy + Phase 19 D-05 source-hygiene assert |
| **WT-06** `kodo gsd verify` lee VERIFICATION.md del worktree | `src/gsd/verify.js:133` con `??` fallback + JSDoc | `test/gsd-verify-integration.test.js` +3 (D-06 worktree, D-09 legacy fallback, source-hygiene regex) |

## Tasks Executed

| # | Task | Commit |
| - | ---- | ------ |
| 1 | RED: test scaffold (6 unit + 2 E2E) | `f6f1ce2` |
| 2 | GREEN: cleanup fail-open en stop.js | `9c24a97` |
| 3 | verify.js phasesRoot + 3 tests gsd-verify-integration | `b07af23` |
| 4 | 3 source-hygiene asserts D-05/D-07/D-08 en stop.test.js | `5308218` |

## Verification Results

- `node --test test/stop-worktree-cleanup.test.js` → **8/8 pass** (6 unit + 2 E2E)
- `node --test test/gsd-verify-integration.test.js` → **11/11 pass** (8 existentes + 3 nuevos)
- `node --test test/stop.test.js` → **18/18 pass** (15 existentes + 3 source-hygiene nuevos)
- `node --test test/logger-events.test.js` → **15/15 pass** (Plan 19-01 sin regresión)
- `node --test test/skill-auto-commit.test.js` → **2/2 pass** (D-05 / WT-05 satisfied-by-design preservado)
- `npm test` → **564 tests / 563 pass + 1 skip pre-existente** (suite global, sin regresiones)

### Source-hygiene grep checks (manual)

```
awk '/releaseGsdLock\(session\.project_path/{lock=NR} /worktreeCleanupOk/{wt=NR; exit} END{exit !(lock < wt)}' src/hooks/stop.js  → exit 0 ✓
awk '/--show-current/{br=NR} /worktree.+remove/{rm=NR; exit} END{exit !(br < rm)}' src/hooks/stop.js                                → exit 0 ✓
grep -c "cwd: KODO_ROOT" src/hooks/stop.js                                                                                            → 2 (≥ 1) ✓
grep -c "session.worktree_path ?? session.project_path" src/gsd/verify.js                                                             → 2 (línea productiva 133 + comentario header 24)
```

## Deviations from Plan

**1. [Rule 2 — Documentation completeness] Header comment en verify.js cita el codepoint `??` literal**

- **Discovered during:** Task 3 (verify.js edit).
- **Issue:** El acceptance criterion del Task 3 dice `grep -c "session\.worktree_path \?\? session\.project_path" src/gsd/verify.js == 1`, pero el `<action>` Step 2 del mismo task EXIGE actualizar el JSDoc/header con una nota explicando el fallback. Mi implementación añadió la cita exacta del codepoint (`session.worktree_path ?? session.project_path`) en el header comment línea 24 para que el agente futuro vea el snippet sin tener que saltar a la línea 133. Resultado: count = 2 (línea productiva + cita en comentario).
- **Fix:** None — la cita en comentario es intencional y deseable (documentación referencia el codepoint exacto). El test de source-hygiene en `gsd-verify-integration.test.js` usa `/regex/.test()` (no count), por lo que pasa correctamente. El spirit del acceptance criterion — single source of truth productiva — está respetado: hay **una sola línea de código** que ejecuta el fallback.
- **Files modified:** `src/gsd/verify.js` (header comment + línea 133).
- **Commit:** `b07af23`.

No hay otras deviations. Plan ejecutado verbatim en estructura, behavior y orden TDD (Task 1 RED → Task 2 GREEN).

## Auth Gates

None.

## Known Stubs

None — la implementación es completa. Todo path emite el evento NDJSON correcto, todo error es catch-eado en su propio nivel, y los tests cubren los 7 escenarios del plan más 2 E2E con git real.

## Threat Flags

None — el cleanup opera SOLO sobre `session.worktree_path` (campo controlado por kodo, no entrada externa) y `session.project_path` (config interno). El `gitFn` default usa `execFileSync('git', [...])` con array literal de args (no `execSync(cmdString)`), inmune a shell injection. El move-aside dirty preserva el trabajo del usuario en disco con timestamp predictable; no introduce nueva superficie de red/auth.

## Deferred / Residual Debt

- **CR-02 (Phase 18 → Phase 19 cleanup)**: SessionRecord huérfano si `cmux.send` falla post-`addSession`. NO se aborda en este plan — el stop hook solo cleanea cuando hay sesión registrada **y** termina normalmente. El caso CR-02 (sesión registrada pero cmux falló pre-spawn) genera worktree zombie sin sesión correspondiente. Mitigación parcial: `git worktree prune` oportunista al final del cleanup recoge worktrees con metadata desaparecida, pero NO recoge dirs cuyo `.git` apunte a una entry válida en `.git/worktrees/`. Resolución completa requiere watchdog separado o pre-spawn rollback en dispatcher — deferido fuera de Phase 19.
- **`findSession` no busca en `state.history`** (mencionado en 19-CONTEXT.md §Deferred): si una sesión moved-to-history conserva `worktree_path`, el stop hook no la encuentra y el cleanup nunca corre. Bug latente pre-existente, no introducido por este plan. Deferido.

## TDD Gate Compliance

- **RED commit Task 1**: `f6f1ce2` — 7/8 tests fallan por diseño (cleanup no existe; LEGACY pasa porque el guard `if (session.worktree_path)` aún no se evalúa pero ningún assert depende de que se ejecute código nuevo).
- **GREEN commit Task 2**: `9c24a97` — implementación añade el bloque cleanup; 8/8 tests verdes.
- Tasks 3 y 4 no son TDD-cycled (refactor + asserts source-hygiene): el cambio en verify.js es 1 línea + JSDoc, blindado por el nuevo test source-hygiene en el mismo commit; los 3 asserts del Task 4 se añaden post-Task-2 sobre source que ya contiene los markers esperados.

Gate sequence RED → GREEN respetada para el ciclo principal (Task 1 → Task 2).

## Self-Check: PASSED

- `src/hooks/stop.js` — modified, FOUND.
- `src/gsd/verify.js` — modified, FOUND.
- `test/stop-worktree-cleanup.test.js` — created, FOUND.
- `test/gsd-verify-integration.test.js` — modified, FOUND.
- `test/stop.test.js` — modified, FOUND.
- Commit `f6f1ce2` (RED scaffold) — FOUND in `git log`.
- Commit `9c24a97` (GREEN cleanup) — FOUND in `git log`.
- Commit `b07af23` (verify.js D-06) — FOUND in `git log`.
- Commit `5308218` (source-hygiene asserts) — FOUND in `git log`.
- Suite global: 564 tests / 563 pass + 1 skip — VERIFIED.
