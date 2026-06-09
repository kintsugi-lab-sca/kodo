---
phase: 41-doctor-m-dulo-puro-de-saneo-cli
plan: 03
subsystem: gsd / cli
tags: [doctor, cli, dry-run, fix, json, exit-code, human-uat, gap-fix]
requires:
  - src/gsd/doctor.js (Plan 02 — scan/execute consumidos por el handler)
  - src/cli/gsd-inspect.js (mold del handler: writeFn/errFn DI, exit-before-render, --json)
  - src/cli/format.js (createFormatter — color isolation)
  - src/cli.js (registro gsd.command alongside inspect/verify)
provides:
  - runGsdDoctor (handler CLI: dry-run/--fix/--json, exit 0/1 determinista, DI render)
  - "kodo gsd doctor" (subcomando: dry-run por defecto, --fix único opt-in de mutación)
affects:
  - src/cli.js (registro del subcomando doctor)
  - src/gsd/doctor.js (gap fix: defaults reales de gitFn + logger en resolveDeps)
  - Phase 42 dismiss (consumirá el report --json + execute({taskId}))
tech-stack:
  added: []
  patterns:
    - "handler CLI espejo de gsd-inspect.js: writeFn/errFn/formatterFn DI, exit-code antes de render"
    - "dry-run por defecto; --fix único opt-in de mutación (D-03/D-07, sin prompt)"
    - "--json byte-determinista (idéntico TTY/no-TTY) = report serializado de scan (D-01)"
    - "registro sin ensureConfig (saneo local, no toca provider — precedente skill sync)"
key-files:
  created:
    - src/cli/gsd-doctor.js
    - test/gsd-doctor-cli.test.js
  modified:
    - src/cli.js
    - src/gsd/doctor.js
decisions:
  - "D-01 implementado: --json byte-determinista, report serializado de scan; execute result mergeado bajo --fix"
  - "D-02 implementado: sin flags por-categoría; las 4 categorías siempre juntas; sin ensureConfig"
  - "D-03 implementado: sin --dry-run; default = dry-run; --fix único opt-in de mutación"
  - "D-07 implementado: --fix ejecuta directo, sin prompt de confirmación"
  - "D-08 implementado: dry-run previsualiza la acción EXACTA por item (remove/prune/move/steal/keep/unlink)"
  - "D-09 implementado: resumen de protegidos NO afecta el exit code (live-only → exit 0)"
  - "GAP FIX (descubierto en UAT humano): resolveDeps de doctor.js no daba default real a gitFn/logger → --fix inoperante fuera de tests con stubs. Añadidos defaults espejo de stop.js:122-126 (execFileSync) + noopLogger (LOG-12 ok)."
metrics:
  duration: ~25min (Task 1) + UAT humano + gap fix
  completed: 2026-06-04
  tasks: 2
  files: 4
---

# Phase 41 Plan 03: Subcomando `kodo gsd doctor` Summary

Cableado el subcomando `kodo gsd doctor`: handler `src/cli/gsd-doctor.js` (espejo de `gsd-inspect.js`) que corre `scan()` para dry-run/`--json` y `execute({fix:true})` para `--fix`, más el registro `gsd.command('doctor')` en `src/cli.js`. Cierra DOCTOR-01 (reporte dry-run de las 4 categorías) y DOCTOR-03 (salida agrupada, exit 0/1 determinista). El UAT humano del `--fix` destructivo destapó y corrigió un gap de integración real (defaults de DI ausentes).

## What was built

**Task 1 — handler `runGsdDoctor` + registro `gsd.command('doctor')` (commit ce888e1)**
- `runGsdDoctor(opts, deps={})` con `opts={fix,json}` y DI `scanFn/executeFn/writeFn/errFn/formatterFn` (defaults reales `scan`/`execute` de `../gsd/doctor.js`).
- Flujo: SIEMPRE `scan()` primero → `exitCode = report.hasGarbage ? 1 : 0` computado ANTES de render (D-03); el resumen `protected` NO afecta el exit (D-09). Con `--fix`: `execute(deps,{fix:true})` DESPUÉS de scan y se renderiza lo realmente saneado + errores.
- Render: `--json` (D-01) byte-determinista = report serializado de scan (execute result mergeado bajo `--fix`); modo humano agrupa por las 4 categorías con la acción EXACTA por item (D-08) + línea de protegidos (D-09). Cero ANSI inline (solo el formatter inyectado).
- Registro en `src/cli.js` bajo el bloque `const gsd`: `gsd.command('doctor')` con `--fix` y `--json`, sin flags por-categoría (D-02), sin `--dry-run` (D-03), sin `--yes`/confirmación (D-07), `ensureConfig` omitido con comentario justificativo (saneo local, no toca provider).

**Task 2 — UAT humano del `--fix` destructivo (checkpoint blocking)**
- Verificado en un sandbox 100% aislado (`HOME` falso en `/tmp`, worktrees git reales) reproduciendo las 4 categorías de basura + recursos vivos/ajenos protegidos. Script: `/tmp/kodo-doctor-uat.sh`.
- Los 6 checks del plan pasan (18/18 aserciones), incluidos los críticos #3 (foreign `.claude/worktrees` jamás reportado ni tocado) y #4/#5 (worktree/lock/log de sesión VIVA intactos).
- Evidencia `--fix`: `worktrees: 2 removed, 1 moved (.dirty), 0 pruned, 1 skipped (live)` · `locks: 1 stolen, 1 kept` · `logs: 2 unlinked` · zombie fuera de state.json · re-scan → exit 0.

## Verification

- `node --test test/gsd-doctor-cli.test.js` → 13/13 pass (exit codes, dry-run vs --fix, --json determinismo, protected-not-counted, cero picocolors).
- `kodo gsd doctor` → exit 1 con basura, exit 0 limpio; `--json` parseable e idéntico TTY/pipe.
- UAT humano aislado: 18/18 checks (los 6 del plan).
- Suite completa: **1143 pass / 0 fail / 1 skip** (startup-budget pre-existente).

## Deviations from Plan

### Gap fix (descubierto por el checkpoint human-verify — su razón de ser)

**1. [Blocking] `resolveDeps` de doctor.js no inyectaba defaults reales de `gitFn`/`logger` (commit 1a8e80d)**
- **Found during:** Task 2 (UAT humano del `--fix` real).
- **Issue:** `execute()` pasaba `gitFn=undefined` a `cleanupWorktree` (el CLI no inyecta gitFn) → `gitFn is not a function`; y `logger=undefined` rompía la emisión de eventos con `reading 'error'`. El *fail-open* per-item evitaba el crash global pero dejaba los worktrees huérfanos SIN limpiar. Los tests herméticos de 41-02 pasaban porque inyectaban stubs — punto ciego clásico de auto-evaluación; solo un test de integración real (el UAT) lo detecta.
- **Fix:** Defaults reales en `resolveDeps` espejo de `stop.js:122-126`: `gitFn` → wrapper `execFileSync('git', ['-C', cwd, ...args])`; `logger` → `noopLogger` (zero-import, LOG-12 ok como en state.js). Cambio acotado a `src/gsd/doctor.js`.
- **Files modified:** src/gsd/doctor.js
- **Commit:** 1a8e80d

## Threat Surface

Mitigaciones del threat_model verificadas por el UAT humano: T-41-09 (dry-run por defecto, `--fix` único opt-in — sin ruta de mutación silenciosa), T-41-10 (preview muestra la acción EXACTA por item — coincide con la mutación real), T-41-11 (foreign-worktree jamás reportado ni tocado — check #3 ✅), T-41-12 (live-resource protegido — checks #4/#5 ✅). Sin instalación de paquetes (T-41-SC accept).

## Self-Check: PASSED

- FOUND: src/cli/gsd-doctor.js
- FOUND: test/gsd-doctor-cli.test.js
- FOUND: commit ce888e1 (Task 1)
- FOUND: commit 1a8e80d (gap fix)
- VERIFIED: UAT humano 18/18 (los 6 checks del plan)
