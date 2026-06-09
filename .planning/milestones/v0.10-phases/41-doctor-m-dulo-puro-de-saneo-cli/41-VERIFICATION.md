---
phase: 41-doctor-m-dulo-puro-de-saneo-cli
verified: 2026-06-04T00:00:00Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
---

# Phase 41: Doctor — Módulo puro de saneo CLI — Verification Report

**Phase Goal:** El operador dispone de `kodo gsd doctor` para detectar y sanear la basura del ciclo de vida (worktrees huérfanos, sesiones zombie, locks colgados, logs viejos) sin tocar jamás recursos vivos, y deja un módulo puro reusable que DISMISS (Phase 42) consumirá — una sola fuente de saneo.
**Verified:** 2026-06-04
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `kodo gsd doctor` (sin flags) reporta las 4 categorías en dry-run sin mutar nada | ✓ VERIFIED | `src/cli/gsd-doctor.js` llama solo `scanFn()` cuando `opts.fix` es falsy (línea 70-73); registered en `src/cli.js:348-364` con `--fix` como único opt-in de mutación |
| 2 | `kodo gsd doctor --fix` re-chequea liveness ANTES de cada acción destructiva, NUNCA toca un recurso vivo | ✓ VERIFIED | `execute()` llama `isSessionLive(session)` en línea 493 antes de `cleanupWorktree`; `decideLock(lock, d.isPidAlive, nowMs)` re-invocado en línea 547; `isSessionLive(liveById.get(f.sessionId))` en línea 573 para logs. `result.worktrees.skipped++` cuando vivo. |
| 3 | Exit code determinista: 0=limpio / 1=basura; `report.protected` NO afecta el exit code | ✓ VERIFIED | `const exitCode = report.hasGarbage ? 1 : 0` (línea 66 de `gsd-doctor.js`) calculado ANTES de render; `protected` solo va al render humano, no entra en `hasGarbage` |
| 4 | `--json` byte-determinista (idéntico TTY/no-TTY) = report serializado de scan() | ✓ VERIFIED | `write(JSON.stringify(payload, null, 2) + '\n')` sin ninguna condición `isTTY` (línea 78); 13/13 tests pasan incluyendo el test de byte-determinismo |
| 5 | `src/gsd/doctor.js` es módulo puro DI never-throws exportando `scan` y `execute`, espejo de `reconcile.js` | ✓ VERIFIED | `export function scan(deps = {})` y `export async function execute(deps = {}, opts = {})` presentes; 604 líneas con doc-banner de invariantes; outer try/catch en execute; `0` ocurrencias de `rm -rf` o `worktree list` |
| 6 | Detección de worktrees scoped a `.bg-shell/<sessionId>` cruzado contra state.json — JAMÁS `git worktree list` | ✓ VERIFIED | `grep -c "worktree list" src/gsd/doctor.js` = 0; `defaultListWorktreeDirs` enumera `.bg-shell` via `readdirSync` y cruza con `computeWorktreePath` (líneas 128-168); el comentario explícito refuerza el invariante T-41-05 |
| 7 | LOG-12 preservado: `doctor.js` y `worktree-cleanup.js` NO importan `logger.js` | ✓ VERIFIED | `grep -v '^//' src/gsd/doctor.js \| grep -c "logger.js'"` = 0; `grep -v '^//' src/hooks/worktree-cleanup.js \| grep -c "logger.js'"` = 0; logger inyectado via deps con default `noopLogger` |
| 8 | No `rm -rf`, no `rmSync` de directorios; worktree removal via `git worktree remove` SIN `--force`; dirty → `.dirty` preservado | ✓ VERIFIED | `rm -rf` = 0 en ambos ficheros; `'--force'` ausente en `worktree-cleanup.js`; dirty path usa `gitFn(project, ['worktree', 'move', wt, target])` con fallback `renameSync` + `worktree repair`, NUNCA delete |
| 9 | `execute({taskId})` scopes a worktree+lock+state.json de esa sesión; logs EXCLUIDOS bajo scope | ✓ VERIFIED | `if (taskId && ...) continue` en líneas 491, 525, 546; `if (!taskId) { ... }` guarda toda la categoría de logs (línea 564) |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/hooks/worktree-cleanup.js` | Helper compartido fail-open; exports `cleanupWorktree`; min 60 líneas | ✓ VERIFIED | 194 líneas; exporta `cleanupWorktree`; consumido por `stop.js` (dynamic import) y `doctor.js` (static import) |
| `src/gsd/doctor.js` | Módulo puro DI; exports `scan` + `execute`; min 150 líneas | ✓ VERIFIED | 604 líneas; ambas funciones exportadas; DI con defaults lazy; never-throws |
| `src/cli/gsd-doctor.js` | CLI handler; exports `runGsdDoctor`; dry-run/--fix/--json | ✓ VERIFIED | 180 líneas; `runGsdDoctor` exportado; flujo scan→exitCode→execute→render correcto |
| `src/cli.js` | `gsd.command('doctor')` con `--fix` y `--json` | ✓ VERIFIED | Registrado en líneas 347-364; sin flags por-categoría, sin `ensureConfig`, sin confirmación |
| `src/logger-events.js` | 5 eventos `DOCTOR_*` + helpers `doctorScan/doctorFixWorktree/doctorFixLock/doctorFixLog/doctorFixError` | ✓ VERIFIED | Los 5 eventos en el objeto `EVENTS` congelado; los 5 helpers exportados y token-free |
| `test/worktree-cleanup.test.js` | Cobertura directa del helper (clean/dirty/error) | ✓ VERIFIED | 10/10 pass |
| `test/gsd-doctor.test.js` | Cobertura hermética DI: scan purity, execute liveness re-check, fail-open, taskId scoping | ✓ VERIFIED | 20/20 pass |
| `test/gsd-doctor-cli.test.js` | Exit codes, dry-run vs --fix, --json determinism, protected-not-counted | ✓ VERIFIED | 13/13 pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/hooks/stop.js` | `src/hooks/worktree-cleanup.js` | dynamic `import { cleanupWorktree }` | ✓ WIRED | `grep` confirma `await import('./worktree-cleanup.js')` y `await cleanupWorktree({...})`; `grep -c "worktree.*remove\|worktree.*move\|worktree.*prune" stop.js` = 0 |
| `src/gsd/doctor.js` | `src/hooks/worktree-cleanup.js` | static import `cleanupWorktree` | ✓ WIRED | `import { cleanupWorktree as realCleanupWorktree }` en línea 41; invocado en `execute()` línea 498 |
| `src/gsd/doctor.js` | `src/gsd/lock.js` | `isPidAlive` + `readLock` + `DEFAULT_TTL_HOURS` | ✓ WIRED | Import en línea 39; `decideLock` usa `isPidAlive` y `DEFAULT_TTL_HOURS`; `readLock` en `detectHungLocks` y `execute()` |
| `src/gsd/doctor.js` | `src/cli/polling-logfile.js` | `DEFAULT_RETENTION_DAYS` / `MS_PER_DAY` | ✓ WIRED | Import en línea 56; usados en `detectOldLogs` y el bloque de logs en `execute()` (5 ocurrencias en total) |
| `src/cli/gsd-doctor.js` | `src/gsd/doctor.js` | `scan()` para dry-run/--json, `execute({fix:true})` para --fix | ✓ WIRED | `import { scan as realScan, execute as realExecute }` línea 30; ambas invocadas en `runGsdDoctor` |
| `src/cli.js` | `src/cli/gsd-doctor.js` | lazy import `runGsdDoctor` + `process.exit(code)` | ✓ WIRED | `await import('./cli/gsd-doctor.js')` línea 357; `process.exit(code)` línea 359 |

---

### Requirements Coverage

| Requirement | Phase | Description | Status | Evidence |
|-------------|-------|-------------|--------|----------|
| DOCTOR-01 | Phase 41 | `kodo gsd doctor` detecta y reporta (dry-run) las 4 categorías | ✓ SATISFIED | CLI registrado; `scan()` detecta las 4 categorías; render humano agrupa por categoría; 13/13 CLI tests pasan |
| DOCTOR-02 | Phase 41 | `--fix` re-chequea liveness; reusa `git worktree remove/prune`; no `rm -rf` | ✓ SATISFIED | Re-check de liveness verificado en código (líneas 493, 547, 573); `rm -rf` = 0; `cleanupWorktree` usa `git worktree remove` sin `--force` |
| DOCTOR-03 | Phase 41 | Output agrupado; exit code determinista 0/1 | ✓ SATISFIED | `renderCategory()` agrupa por categoría; `exitCode = report.hasGarbage ? 1 : 0` calculado antes de render |
| DOCTOR-04 | Phase 41 | Módulo puro `src/gsd/doctor.js`, reusable por CLI y dismiss — una sola fuente | ✓ SATISFIED | `src/gsd/doctor.js` existe, 604 líneas, DI+pure+never-throws; exporta `scan`+`execute`; Phase 42 (dismiss) consumirá `execute({taskId})` per SUMMARY-03 |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | Ninguno encontrado |

Sin `TBD`, `FIXME`, `XXX`, `rm -rf`, `worktree list`, ni `--force` en las rutas destructivas. No hay `console.log` stubs en producción (solo `console.error` de fallback en `worktree-cleanup.js` para fallos de branch -D, coherente con el comportamiento fail-open documentado).

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `worktree-cleanup.test.js` — 10 casos (clean/dirty/error/never-throws) | `node --test test/worktree-cleanup.test.js` | 10 pass / 0 fail | ✓ PASS |
| `gsd-doctor.test.js` — 20 casos (scan purity + execute liveness re-check) | `node --test test/gsd-doctor.test.js` | 20 pass / 0 fail | ✓ PASS |
| `gsd-doctor-cli.test.js` — 13 casos (exit codes, --json, DI) | `node --test test/gsd-doctor-cli.test.js` | 13 pass / 0 fail | ✓ PASS |

---

### Human Verification Required

_Ningún ítem pendiente de verificación humana._ El checkpoint `Task 2` del Plan 03 (UAT humano bloqueante del `--fix` destructivo) fue completado durante la ejecución de la fase: 18/18 aserciones en sandbox aislado (`/tmp/kodo-doctor-uat.sh`), incluyendo los críticos #3 (foreign `.claude/worktrees` jamás reportado ni tocado) y #4/#5 (worktree/lock/log de sesión VIVA intactos tras `--fix`). Script archivado en `/tmp/kodo-doctor-uat.sh`.

---

### Gaps Summary

Sin gaps. Todos los must-haves verificados directamente en el código fuente.

El gap de integración de `gitFn`/`logger` ausentes en `resolveDeps` que habría dejado `--fix` inoperante en la CLI fue detectado correctamente por el UAT humano (commit `1a8e80d`) — exactamente el tipo de punto ciego entre tests herméticos e integración real que el checkpoint bloqueante estaba diseñado para capturar.

---

_Verified: 2026-06-04_
_Verifier: Claude (gsd-verifier)_
