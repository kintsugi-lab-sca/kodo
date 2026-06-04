---
phase: 41-doctor-m-dulo-puro-de-saneo-cli
plan: 02
subsystem: gsd / saneo
tags: [doctor, sanitization, pure-DI, never-throws, fail-open, TOCTOU, lock, worktree]
requires:
  - src/hooks/worktree-cleanup.js (Plan 01 — cleanupWorktree helper consumido)
  - src/logger-events.js (Plan 01 — doctor.* helpers consumidos)
  - src/gsd/lock.js (isPidAlive + readLock + LOCK_FILE + DEFAULT_TTL_HOURS)
  - src/session/state.js (loadState/listSessions/computeWorktreePath/removeSession)
  - src/cli/polling-logfile.js (DEFAULT_RETENTION_DAYS/MS_PER_DAY — exportadas aquí)
provides:
  - scan (detección PURA de las 4 categorías → report serializable)
  - execute (saneo I/O con re-check de liveness por acción destructiva + scope por taskId)
affects:
  - src/cli/polling-logfile.js (DEFAULT_RETENTION_DAYS/MS_PER_DAY ahora exportadas)
  - Phase 42 dismiss (consumirá execute({taskId}) como contrato de saneo scopeado)
tech-stack:
  added: []
  patterns:
    - "scan/execute split espejo de reconcile.js (PURA detección + I/O sanitizadora)"
    - "DI + lazy real defaults (espejo gsd-inspect.js:58-65) + never-throws fail-open per item"
    - "detección compartida DRY entre scan y execute (D-06: execute re-detecta, no consume snapshot)"
    - "lock state machine espejo de acquireGsdLock (decideLock); liveness de sesión via alive===true"
key-files:
  created:
    - src/gsd/doctor.js
    - test/gsd-doctor.test.js
  modified:
    - src/cli/polling-logfile.js
decisions:
  - "D-04 implementado: scan() report {worktrees,zombies,locks,logs,protected,hasGarbage} vs execute() result {worktrees:{removed,moved,pruned,skipped},...} — shapes distintos"
  - "D-05 implementado: execute({taskId}) scope a worktree+lock+state.json de esa sesión; categoría de logs EXCLUIDA bajo scope"
  - "D-06 implementado: execute RE-detecta via los helpers compartidos; NO consume el report de scan como plan"
  - "D-10/D-12/D-13/D-14 implementados: pure+DI+never-throws fail-open; log unlink ENTERO; lock state machine espejo acquireGsdLock; jamás toca worktree/lock de sesión viva"
  - "Liveness de sesión = alive===true (Session no persiste pid; alive lo escribe solo reconcileTick). isPidAlive se re-chequea sobre locks, que sí llevan pid."
  - "listLockProjects añadido como dep DI (default: projectPaths de state.sessions+history+cwd) — los locks no dependen de que haya sesiones activas en state.json"
metrics:
  duration: ~40min
  completed: 2026-06-04
  tasks: 2
  files: 3
---

# Phase 41 Plan 02: Doctor — módulo puro de saneo (scan + execute) Summary

Construido `src/gsd/doctor.js`, el módulo PURO de saneo espejo arquitectónico de `reconcile.js`: `scan(deps)` detecta las 4 categorías de basura (worktrees huérfanos, zombies, locks colgados, logs viejos) sin mutar nada, y `execute(deps, opts)` las sanea re-detectando y re-chequeando liveness IMMEDIATELY antes de cada acción destructiva (TOCTOU guard D-14), con fail-open per item, never-throws, y scope opcional por `taskId` que excluye logs (D-05). Es DOCTOR-04 y el contrato que Phase 42 (dismiss) consumirá.

## What was built

**Task 1 — `scan()` detección pura de 4 categorías (commit a688727)**
- `scan(deps)` → report serializable `{ worktrees, zombies, locks, logs, protected: {sessions, locks}, hasGarbage }`. Cada item lleva `{ id, path, action, reason }` con su acción exacta (worktree `remove`, lock `steal`, log `unlink`).
- Helpers de detección compartidos (DRY, reusados por execute): `detectOrphanWorktrees` (scope `.bg-shell/<sessionId>` cruzado contra state.json — JAMÁS enumerando los worktrees de git, T-41-05), `detectZombies` (`alive===false`), `detectHungLocks` (state machine espejo de `acquireGsdLock` via `decideLock`: PID muerto/TTL vencido → steal; PID vivo+TTL ok → keep), `detectOldLogs` (mtime > `DEFAULT_RETENTION_DAYS` de sesión no viva).
- Pureza verificada: dos llamadas no mutan el state inyectado. never-throws: un fallo de detección deja su categoría vacía + warn. Las sesiones/locks vivos se reportan en `protected`, nunca en las categorías de basura.
- DI con defaults reales lazy (espejo `gsd-inspect.js:58-65`): `loadState/readLock/isPidAlive/listLogFiles/statFile/listWorktreeDirs/listLockProjects/now/logger`.

**Task 2 — `execute()` saneo con re-check de liveness (commit 335704d)**
- `execute(deps, opts={})` async. `fix` falsy → no-op (la CLI usa scan para dry-run). `fix=true` → sanea las 4 categorías; `taskId` → scope a worktree+lock+state de esa sesión, logs EXCLUIDOS (D-05).
- RE-detecta via los helpers compartidos (D-06, no consume el snapshot de scan) y re-chequea `isSessionLive` JUST before cada acción destructiva (D-14): un worktree/lock que pasó a vivo entre scan y execute se SALTA (`result.worktrees.skipped++`).
- Worktree → `cleanupWorktree` (remove/moved/prune según el return estructurado). Lock → `unlinkFile(<project>/.planning/.kodo.lock)` si steal, KEEP si vivo. Log → `unlinkFile` ENTERO (nunca truncate, D-12). Zombie → `removeSession`.
- fail-open per item (D-10): cada acción en try/catch → `doctorFixError` + continuar. never-throws top-level (outer try/catch → result parcial + `errors[]`). Result shape distinto de scan (D-04): `{ worktrees:{removed,moved,pruned,skipped}, zombies:{removed}, locks:{stolen,kept}, logs:{unlinked}, errors:[] }`.

## Verification

- `node --test test/gsd-doctor.test.js` → 20/20 pass (10 scan + 10 execute).
- `grep -c "rm -rf" src/gsd/doctor.js` → 0 (literales eliminados de comentarios para no romper la guarda anti-regresión).
- `grep -c "worktree list" src/gsd/doctor.js` → 0.
- `grep ... "/logger.js'" src/gsd/doctor.js` → 0 (LOG-12 preservado: logger inyectado, logger-events.js static OK).
- `grep -c "RETENTION_DAYS\|MS_PER_DAY" src/gsd/doctor.js` → 4 (reusa el cutoff, no hardcodea 7).
- scan + execute ambos exportados.
- Suite completa: **1133 pass / 0 fail / 1 skip** (startup-budget pre-existente).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exporté DEFAULT_RETENTION_DAYS / MS_PER_DAY desde polling-logfile.js**
- **Found during:** Task 1 (GREEN — import falló).
- **Issue:** El plan (interfaces) afirma `DEFAULT_RETENTION_DAYS`/`MS_PER_DAY` "REUSE, do not hardcode 7", pero ambas estaban declaradas como `const` privadas (sin `export`) en `polling-logfile.js`. El import de doctor.js fallaba con SyntaxError.
- **Fix:** Añadí `export` a ambas constantes (cero cambios de comportamiento — siguen consumiéndose igual internamente en `sweepRetention`). Doctor las importa ahora en vez de hardcodear 7 (D-12 satisfecho).
- **Files modified:** src/cli/polling-logfile.js
- **Commit:** a688727

### Design decisions (no permiso requerido — dentro del scope del plan)

**2. [Rule 2 - Diseño] `listLockProjects` añadido como dep DI**
- El plan describe detección de locks reusando `readLock`, pero no especifica de qué projectPaths. Reimplementar la detección sobre `state.sessions` solo dejaría los locks sin detectar cuando state.json está vacío (caso real: la basura sobrevive a la limpieza de sesiones). Añadí `listLockProjects` (default: projectPaths de `state.sessions` + `state.history` + `process.cwd()`) para que doctor encuentre el `.kodo.lock` del repo donde corre aunque no haya sesiones activas. DI-testable sin tocar disco.

**3. [Aclaración] Liveness de sesión = `alive===true`, no PID**
- El plan dice "alive===true o PID alive". `Session` no persiste el pid del proceso Claude (la liveness agregada vive en `alive`, escrito SOLO por `reconcileTick` — invariante "fuente única de alive"). Por tanto la liveness de sesión se deriva de `alive===true`; `isPidAlive` se re-chequea sobre los **locks**, que sí llevan `pid`. Esto respeta el invariante cross-milestone "ni doctor ni dismiss escriben alive" y "doctor reusa isPidAlive/readLock — no reimplementa liveness".

## Threat Surface

Sin nueva superficie de amenaza fuera del threat_model del plan. Mitigaciones implementadas verbatim: T-41-04 (TOCTOU — re-check de liveness por acción, test que flipa alive false→true entre scan y execute → target skipped), T-41-05 (scope `.bg-shell`+state.json, nunca enumera worktrees de git — grep guard 0), T-41-06 (sin borrado recursivo forzado; worktree→cleanupWorktree, log unlink entero — grep guard 0), T-41-07 (live-guard: test asserta cero llamadas destructivas con PID/alive vivo), T-41-08 (solo logs no-vivos > cutoff; unlink entero, nunca truncate). Sin instalación de paquetes (T-41-SC accept).

## Self-Check: PASSED

- FOUND: src/gsd/doctor.js
- FOUND: test/gsd-doctor.test.js
- FOUND: commit a688727
- FOUND: commit 335704d
