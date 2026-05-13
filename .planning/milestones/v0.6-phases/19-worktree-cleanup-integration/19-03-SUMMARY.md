---
phase: 19-worktree-cleanup-integration
plan: 03
subsystem: stop-hook
tags:
  - worktree-cleanup
  - stop-hook
  - phase-19
  - gap-closure
  - cr-02
  - cr-03
  - wr-03
dependency_graph:
  requires:
    - 19-02 (worktree cleanup + gitFn DI completos)
    - REVIEW.md (CR-02 + CR-03 fix blocks verbatim)
    - VERIFICATION.md (override D-07 sobre CR-01 honrado)
  provides:
    - markSessionStatus aplica a todas las sesiones (GSD + no-GSD) con reason 'session-stop'
    - lstatSync pre-check del dirty target (symlink-safe)
    - 2 tests dedicados CR-03 + 2 source-hygiene asserts Phase 19 CR-02/CR-03
  affects:
    - src/hooks/stop.js (relocate del bloque session-end/lock + dirty-target pre-check)
    - test/stop-worktree-cleanup.test.js (10 tests, 8 originales + 2 CR-03)
    - test/stop.test.js (20 asserts, 18 originales + 2 CR-02/CR-03)
    - test/stop-state-transition.test.js (deviation: sync de 3 asserts pre-existentes al nuevo contrato CR-02)
tech_stack:
  added: []
  patterns:
    - "lstatSync en try/catch con discriminación ENOENT (defensiva ante symlinks colgantes)"
    - "console.error en lugar de silent swallow para mutaciones de state.json (WR-03)"
    - "Logger compartido entre markSessionStatus + sessionEnd (factory pattern, 19-02 carry-forward)"
key_files:
  created: []
  modified:
    - src/hooks/stop.js
    - test/stop-worktree-cleanup.test.js
    - test/stop.test.js
    - test/stop-state-transition.test.js
decisions:
  - "CR-02 fix: markSessionStatus se relocaliza FUERA del bloque if (session.gsd) — aplica a todas las sesiones (GSD + no-GSD) antes de sessionEnd. sessionEnd emite status: 'done' literal."
  - "CR-02 fix: razón canónica del mark cambia de 'session-stop:lock-released' → 'session-stop' (el mark ya no ocurre PRE-lock-release, sino antes del bloque session-end + GSD lock entero)."
  - "WR-03 fix: catch alrededor del mark usa console.error (no silent) — markSessionStatus muta state.json, un fallo merece diagnóstico explícito."
  - "CR-03 fix: existsSync → lstatSync(target) en try/catch con discriminación ENOENT — symlinks colgantes ya no evaden la pre-check de Pitfall #1."
  - "CR-01 NO se toca: overrideado por D-07 (VERIFICATION.md overrides_applied: 1, accepted_by: alex, deferred_to: Phase 21+)."
  - "Deviación Rule 1: test/stop-state-transition.test.js (Phase 16 LOG-15 SC#5 pre-existente) sincronizado al nuevo contrato — 3 asserts actualizados (reason + non-GSD emite state.transition)."
metrics:
  duration_min: 126
  duration_s: 7563
  completed_date: "2026-05-12T15:19:57Z"
  tasks_completed: 4
  files_modified: 4
  commits: 5
  test_count_global: 568
  test_pass: 567
  test_skip: 1
  test_fail: 0
---

# Phase 19 Plan 03: Worktree Cleanup CR-02 + CR-03 Gap Closure Summary

## One-liner

CR-02 + CR-03 cerrados: `markSessionStatus` aplica a todas las sesiones ANTES de `sessionEnd` (con `console.error` no silent), y el pre-check del dirty-target usa `lstatSync` (symlink-safe). CR-01 honrado como deuda diferida.

## Context

Gaps WARNING del code review de Phase 19 (`19-REVIEW.md` CR-02 + CR-03 + WR-03). El override D-07 en `19-VERIFICATION.md` deja CR-01 fuera de scope (deferido a Phase 21+ con `overrides_applied: 1`, `accepted_by: alex`); este plan es gap closure quirúrgico de las dos WARNINGs restantes.

## Tasks Completed

### Task 1: CR-02 — Mover `markSessionStatus` fuera de `if (session.gsd)` y propagar `status: 'done'` a `sessionEnd`

**Commit:** `26ec187` — `fix(19-03): relocate markSessionStatus outside if (session.gsd) [CR-02]`

**Cambios en `src/hooks/stop.js`:**

- Logger se construye UNA sola vez antes del bloque session-end + lock (pattern 19-02 carry-forward) y se comparte entre `markSessionStatus` + `sessionEnd`.
- `markSessionStatus(session.task_id, 'done', 'session-stop', log)` ahora se ejecuta para TODAS las sesiones, ANTES de `sessionEnd`. Razón canónica cambia de `'session-stop:lock-released'` (antiguo D-06 Phase 16) a `'session-stop'` (CR-02 fix block REVIEW.md verbatim).
- `sessionEnd` emite `status: 'done'` literal (no `session.status` pre-removal). El observable NDJSON refleja ahora el estado terminal real para sesiones no-GSD.
- Catch del mark usa `console.error('[kodo:stop] markSessionStatus failed: ${err.message}')` — WR-03 fix. Sigue fail-open: `runStopHook` nunca crashea.
- `releaseGsdLock` sigue dentro de `if (session.gsd)` — solo el mark se relocaliza. Bloque cleanup (líneas ~215-360) y `removeSessionFn(id)` intactos en su orden (CR-01 NO tocado).

**Líneas relevantes post-cambio (stop.js):**
- `152-188` — bloque CR-02 relocated (logger + mark + sessionEnd).
- `195-203` — bloque `if (session.gsd) { releaseGsdLock }` con comentario actualizado referenciando CR-02.

### Task 2: CR-03 — Reemplazar `existsSync(target)` por `lstatSync(target)` en pre-check Pitfall #1

**Commit:** `d688a04` — `fix(19-03): replace existsSync with lstatSync for dirty-target pre-check [CR-03]`

**Cambios en `src/hooks/stop.js`:**

- Destructuring de `node:fs` ahora importa `lstatSync` en lugar de `existsSync`.
- Pre-check del dirty target reformulado en `try { lstatSync(target) } catch (err) { ... }`:
  - **ENOENT** → mantener `target = `${wt}.dirty`` canónico.
  - **Cualquier otro error** (EACCES, ELOOP, etc.) → variante `${wt}.dirty-${Date.now()}` (defensivo).
  - **Stat exitoso** (file/dir/symlink vivo/symlink colgante) → variante suffixed.
- `existsSync` eliminado completamente del archivo (era el único callsite).
- Comentario referencia explícitamente `Phase 19 CR-03` para traceability.

**Líneas relevantes post-cambio (stop.js):**
- `224` — destructuring `const { lstatSync, renameSync } = await import('node:fs')`.
- `294-316` — bloque DIRTY pre-check con try/catch ENOENT.

### Task 3: Tests CR-03 — `DANGLING SYMLINK` + `REGULAR FILE` (test/stop-worktree-cleanup.test.js)

**Commit:** `caeca1b` — `test(19-03): cover dangling symlink + regular file in <wt>.dirty [CR-03]`

**Tests añadidos al describe `'Phase 19 WT-04: worktree cleanup — unit (gitFn stub)'`:**

1. **DANGLING SYMLINK** — `<wt>.dirty` es symlink apuntando a un path inexistente. Pre-Task-2 (`existsSync` seguía el symlink → false) → target era el `.dirty` canónico y `git worktree move` fallaba. Post-Task-2 (`lstatSync` ve el symlink en sí mismo) → target usa variante `.dirty-<Date.now()>`. Importa `symlinkSync` dinámicamente dentro del test (blast-radius minimization en CI sin symlinks).

2. **REGULAR FILE** — `<wt>.dirty` es archivo regular (no directorio). Path ya cubierto pre-Task-2 vía `existsSync=true`, pero el test sirve como red contra regresiones si alguien revierte a `existsSync` con bug.

**Pattern:** ambos tests usan el shape del test TARGET COLLISION existente (mkdtempSync + helpers + try/finally con rmSync) y aseveran `target.startsWith(`${wt}.dirty-`)` (REVIEW IN-03).

**Test count:** `test/stop-worktree-cleanup.test.js` ahora corre 10 tests (8 originales 19-02 + 2 nuevos CR-03), todos verdes.

### Task 4: Source-hygiene asserts CR-02 + CR-03 (test/stop.test.js)

**Commit:** `59654c1` — `test(19-03): add source-hygiene asserts for CR-02 + CR-03 (living docs)`

**Asserts añadidos al describe `'stop.js source hygiene'`:**

1. **`Phase 19 CR-02`** — verifica que `markSessionStatus(session.task_id, 'done', 'session-stop'` aparece ANTES del bloque `if (session.gsd) { ... releaseGsdLock }`. Sanity: la razón antigua `'session-stop:lock-released'` ya NO aparece en el source.

2. **`Phase 19 CR-03`** — verifica que el source contiene `lstatSync(target)` y NO contiene `existsSync` (eliminado del archivo entero). El comentario de traceability `Phase 19 CR-03` está presente.

**Test count:** `test/stop.test.js` ahora corre 20 asserts (18 originales + 2 CR-02/CR-03), todos verdes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tests pre-existentes en `test/stop-state-transition.test.js` rotos por CR-02 contract change**

- **Found during:** verificación global tras Task 4 (`npm test` completo).
- **Issue:** 3 tests de Phase 16 LOG-15 SC#5 fallaban porque afirmaban:
  - Tests `full mode` + `quick mode`: `reason: 'session-stop:lock-released'` (CR-02 lo cambia a `'session-stop'`).
  - Test `non-GSD`: `state.transition` NO debe emitirse (CR-02 lo invierte — ahora SÍ emite porque mark aplica a todas las sesiones).
- **Fix:** sincronizar los 3 asserts al nuevo contrato (reason actualizada, non-GSD invierte a `assert.ok(transition)`). Header comment del test file documenta la decisión Phase 19 CR-02 que overridea la premisa D-07 original.
- **Files modified:** `test/stop-state-transition.test.js`.
- **Commit:** `a6586f1` — `test(19-03): sync stop-state-transition asserts to CR-02 contract [deviation]`.
- **Justificación:** el plan tenía `files_modified` listando 3 archivos, pero el cambio CR-02 toca un contrato observable (reason + scope del mark) que también está blindado por estos tests pre-existentes. Rule 1 aplica: el "bug" es el desfase entre el contrato nuevo (CR-02) y los asserts antiguos. La alternativa (revertir CR-02 o introducir un flag opt-in) violaría el plan explícito.

## Auth Gates

Ninguno — todo el trabajo es local (filesystem + tests).

## Verification

### Source-hygiene grep manual (`src/hooks/stop.js`)

| Check | Expected | Actual |
|-------|----------|--------|
| `markSessionStatus(session.task_id` invocations | 1 | 1 ✓ |
| `'session-stop:lock-released'` count | 0 | 0 ✓ |
| `status: session.status` count | 0 | 0 ✓ |
| `lstatSync(target)` count | ≥ 1 | 1 ✓ |
| `existsSync` count | 0 | 0 ✓ |
| `Phase 19 CR-03` references | ≥ 1 | 1 ✓ |
| `cwd: KODO_ROOT` preserved | ≥ 1 | 2 ✓ |
| `removeSessionFn(id)` preserved | ≥ 1 | 1 ✓ |
| `markSessionStatus` order: BEFORE `if (session.gsd)` | true | true ✓ |

### Test counts

| Suite | Before | After | Status |
|-------|--------|-------|--------|
| `test/stop-worktree-cleanup.test.js` | 8/8 (19-02) | 10/10 (8 + 2 CR-03) | ✓ |
| `test/stop.test.js` | 18/18 (19-02) | 20/20 (18 + 2 CR-02/CR-03) | ✓ |
| `test/stop-state-transition.test.js` | 4/4 | 4/4 (3 asserts updated) | ✓ deviation |
| **Full suite (`npm test`)** | 506/507 pre-19 | **567/568 + 1 skip** | ✓ |

(Skip pre-existente: LOG-12 startup-budget Decisión B, sin relación con este plan.)

### CR-01 override preservation

| Check | Expected | Actual |
|-------|----------|--------|
| `src/session/state.js` diff vs main | 0 lines changed | 0 lines ✓ |
| `buildStopNudgeText` modifications | 0 | 0 ✓ |
| `handleOrchestratorStop` modifications | 0 | 0 ✓ |
| `src/gsd/verify.js` modifications | 0 | 0 ✓ |
| `src/logger-events.js` modifications | 0 | 0 ✓ |
| `.claude/skills/kodo-orchestrate/skill.md` modifications | 0 | 0 ✓ |
| Cleanup → `removeSessionFn(id)` → nudge order preserved | yes | yes ✓ |

## Files Modified

| File | Purpose | Commit |
|------|---------|--------|
| `src/hooks/stop.js` | CR-02 relocate + CR-03 lstatSync replace | `26ec187`, `d688a04` |
| `test/stop-worktree-cleanup.test.js` | 2 tests nuevos CR-03 (DANGLING SYMLINK + REGULAR FILE) | `caeca1b` |
| `test/stop.test.js` | 2 source-hygiene asserts CR-02 + CR-03 | `59654c1` |
| `test/stop-state-transition.test.js` | Sync de 3 asserts al nuevo contrato CR-02 [deviation] | `a6586f1` |

## Success Criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | CR-02 cerrado: mark a todas las sesiones, `status: 'done'` literal, console.error no silent | ✓ |
| 2 | CR-03 cerrado: lstatSync con ENOENT discrimination, 2 tests dedicados + 2 asserts source-hygiene | ✓ |
| 3 | CR-01 override honrado: cero cambios fuera del scope | ✓ |
| 4 | Fail-open preservado: `runStopHook` sin nuevos paths de crash | ✓ |
| 5 | `handleOrchestratorStop` intacto (D-05): `cwd: KODO_ROOT` preservado | ✓ |
| 6 | `npm test` verde end-to-end | ✓ (567/568 + 1 skip pre-existente) |
| 7 | 2 source-hygiene asserts nuevos Phase 19 CR-02 + CR-03 | ✓ |

Todos cumplidos.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `26ec187` | fix | Relocate markSessionStatus outside if (session.gsd) [CR-02] |
| `d688a04` | fix | Replace existsSync with lstatSync for dirty-target pre-check [CR-03] |
| `caeca1b` | test | Cover dangling symlink + regular file in <wt>.dirty [CR-03] |
| `59654c1` | test | Add source-hygiene asserts for CR-02 + CR-03 (living docs) |
| `a6586f1` | test | Sync stop-state-transition asserts to CR-02 contract [deviation] |

## Threat Flags

Ninguno — el plan analizó STRIDE en frontmatter:
- T-19-03-01 (Tampering markSessionStatus): accept (mutación ya autorizada en 19-02).
- T-19-03-02 (DoS lstatSync): accept (μs sync sobre paths locales, try/catch fail-open).
- T-19-03-03 (Info disclosure console.error en mark): mitigate (mismo riesgo que el `console.error` existente en `releaseGsdLock` — stderr capturado por cmux, no exfiltrado).

No se introduce nueva superficie de ataque.

## Self-Check: PASSED

- [x] `src/hooks/stop.js` modified — verified by `git log --oneline 0ae7202..HEAD`.
- [x] `test/stop-worktree-cleanup.test.js` modified — DANGLING SYMLINK + REGULAR FILE assertions present.
- [x] `test/stop.test.js` modified — Phase 19 CR-02 + CR-03 source-hygiene asserts present.
- [x] `test/stop-state-transition.test.js` modified — 3 asserts sync'd to CR-02 contract.
- [x] All 5 commits exist in `git log`: `26ec187`, `d688a04`, `caeca1b`, `59654c1`, `a6586f1`.
- [x] `npm test` final: 567/568 pass + 1 skip + 0 fail.
- [x] Override D-07 honored: `src/session/state.js` + `buildStopNudgeText` + `handleOrchestratorStop` + `verify.js` + `logger-events.js` untouched.
