---
phase: 14-cli-format-foundation
plan: 03
subsystem: testing
tags: [picocolors, cli, smoke-test, spawn, version, project-md, dx-07]

# Dependency graph
requires:
  - phase: 14-cli-format-foundation/14-01
    provides: picocolors@^1.1.1 instalado en package.json + lockfile (dependencia que el smoke test verifica que no rompe el path de bin/kodo)
  - phase: 14-cli-format-foundation/14-02
    provides: test/format-isolation.test.js — referenciado por nombre en el nuevo bullet de PROJECT.md como guard del single-source invariant (creado en wave 2 paralelo)
provides:
  - "PROJECT.md §Constraints documenta el invariante 'picocolors solo desde src/cli/format.js' — single-source contract anclado a un test guard explícito"
  - "test/version-smoke.test.js — spawn-based regression test que falla si bin/kodo --version pierde exit 0, cambia su stdout, o emite stderr (deprecation, install warning, módulo faltante)"
affects: [phase-14-close, phase-15-cli-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Spawn-based smoke test (process.execPath + spawnSync) en lugar de unit-mock — verifica el grafo real de imports/install"
    - "PKG_VERSION leído desde package.json para que la aserción no se quede atrás en bumps"
    - "Aserción de stderr vacío como guard de install-time deprecations (más sensible que solo exit code)"

key-files:
  created:
    - test/version-smoke.test.js
  modified:
    - .planning/PROJECT.md

key-decisions:
  - "Bullet en §Constraints (no en §Key Decisions): el invariante es una regla dura (mismo nivel que LOG-12 logger-isolation), no una decisión arquitectónica con rationale histórico"
  - "Smoke test sin env override (NO_COLOR/FORCE_COLOR): testeamos la install en su forma real, no una variante TTY-aware (eso pertenece a tests unit de format.js de Plan 14-01)"
  - "PKG_VERSION dinámico (read package.json) en lugar de hard-code '0.1.0' — un bump futuro no genera false-fail"
  - "process.execPath en lugar de literal 'node' — el test corre bajo la misma versión de Node que invocó node --test, evitando PATH skew"

patterns-established:
  - "Spawn-based smoke test pattern para CLI entry points: tests que ejecutan el binario real vía spawnSync(process.execPath, [BIN, ...args], { cwd: REPO, encoding: 'utf-8' }) y asertan exit + stdout + stderr cleanliness conjuntamente"

requirements-completed: [DX-07]

# Metrics
duration: ~10min
completed: 2026-05-04
---

# Phase 14 Plan 03: Picocolors Single-Source Doc + CLI Smoke Test Summary

**Cierre documental + smoke regression de Phase 14: §Constraints declara el invariante picocolors-solo-desde-format.js y un test spawn-based asegura que `bin/kodo --version` sigue verde tras meter la dep**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-04T16:05Z (post worktree base reset)
- **Completed:** 2026-05-04T16:15:54Z
- **Tasks:** 2
- **Files modified:** 2 (1 doc append, 1 new test)

## Accomplishments

- `.planning/PROJECT.md` §Constraints gana un 7º bullet "Color isolation" que ancla el invariante de single-source (picocolors solo desde `src/cli/format.js`) y referencia explícitamente a `test/format-isolation.test.js` como guard ejecutable.
- `test/version-smoke.test.js` creado: spawn real (`process.execPath` + `spawnSync`) sobre `bin/kodo --version`, aserta exit 0, stdout = `PKG_VERSION` (leído de `package.json` para no quedarse atrás en bumps), y stderr vacío (cualquier deprecation/warning de install lo rompe).
- ROADMAP SC#4 cerrado al 100% (package.json + lockfile via Plan 14-01, doc + smoke via 14-03).
- Suite global: **455 tests, 454 pass + 1 skip + 0 fail**, mismo número esperado por el orquestador de wave 2.

## Task Commits

Cada tarea committeada atómicamente con `--no-verify` (parallel-executor convention):

1. **Task 1: Append "Color isolation" bullet to PROJECT.md §Constraints** — `0b1d0d2` (docs)
2. **Task 2: Create spawn-based version smoke test** — `1d1f26b` (test)

_Plan metadata commit (este SUMMARY) — pendiente, lo aplica el closing commit._

_Nota TDD:_ El plan declara `tdd="true"` en Task 2, pero el comportamiento bajo prueba (`commander --version` imprimiendo el campo `version` de `package.json`) ya está enviado en producción. No hay un RED genuino: el test es un *regression guard* sobre comportamiento existente, así que no hay un commit `feat()` que lo siga. Se etiqueta correctamente como `test(...)` y el cycle queda en una sola fase verde — lo opuesto de lo que el TDD-purist espera, pero alineado con la intención del plan: defender contra regresiones futuras introducidas por la nueva dep.

## Files Created/Modified

- `.planning/PROJECT.md` — Append-only: nuevo bullet "Color isolation" en §Constraints (1 línea añadida, 0 removidas, diff puramente aditivo verificado).
- `test/version-smoke.test.js` — Archivo nuevo, 39 líneas, 1 suite con 1 it.

## Smoke Test Results (Manual Confirmation)

Plan output spec exige documentar el resultado del smoke en el SUMMARY:

```text
$ node bin/kodo --version > /tmp/stdout 2> /tmp/stderr; echo $?
0

$ cat /tmp/stdout
0.1.0

$ wc -c /tmp/stderr
0
```

- **Exit code:** `0` ✓
- **stdout (trimmed):** `0.1.0` ✓ (matches `package.json:version`)
- **stderr (raw byte count):** `0` ✓ (no deprecation, no install warning, no node experimental flag noise)

`node --test test/version-smoke.test.js` aislado: 1 test pass en ~82ms.
`node --test "test/**/*.test.js"` full suite: 455 tests, 454 pass + 1 skip pre-existente (startup-budget Decisión B), 0 fail, 0 cancelled, en ~677ms.

## Confirmation: §Current Milestone Block NOT Edited

Plan 14-03 lo exigió explícitamente. Verificado:

- `grep -n "picocolors" .planning/PROJECT.md` muestra 4 hits, todos pre-existentes a este plan (líneas 22, 27, 72 + el nuevo bullet en línea 122).
- El bloque `## Current Milestone: v0.5 ...` (líneas 17–29) ya menciona picocolors como 2ª dep del proyecto (línea 27) — no requiere edición y no se tocó.
- El footer `*Last updated: 2026-05-04 ...*` se mantuvo intacto (next bump al cierre de v0.5, no a mitad de phase).
- §Key Decisions table no se tocó (el invariante es regla dura → §Constraints, no decisión histórica → §Key Decisions).

## Decisions Made

- **Bullet en §Constraints, no en §Key Decisions** — mismo razonamiento que LOG-12 (logger-isolation): es una regla dura sobre el grafo de imports, no un trade-off histórico que justificar. Sigue el patrón ya establecido en líneas 120–121.
- **Smoke sin env override** — testear la install en su forma real captura más regresiones que filtrar `NO_COLOR`/`FORCE_COLOR`. Ese tipo de aserciones TTY-aware vive en `test/format.test.js` (Plan 14-01) sobre la API de `_resolveUseColor`.
- **`PKG_VERSION` leído de `package.json`** — un bump v0.1.0 → v0.2.0 no debe romper el smoke. Esa es la diferencia entre un guard mantenible y deuda técnica de día 1.
- **`process.execPath` en lugar de literal `'node'`** — alinea el child con el binario que corrió `node --test` (evita PATH skew en CI o nvm shells).

## Deviations from Plan

None — plan executed exactly as written. El único matiz es la nota TDD anterior: el plan especifica `tdd="true"` para Task 2 pero el comportamiento ya existía, así que el cycle RED → GREEN → REFACTOR colapsó a un solo commit `test(...)` verde de entrada. No es una deviation de scope ni de archivos; es una observación sobre la naturaleza del test (regression guard, no spec previa).

## Issues Encountered

- **Worktree base mismatch detectado al arranque** — `git rev-parse HEAD` mostró `ad2cd88` mientras el orquestador esperaba `3a38e19...`. Resuelto exactamente como prescribe `<worktree_branch_check>`: `git reset --hard 3a38e192c9eba43c17116b022f15cc12bfd4678c` colocó al worktree en la base correcta y los archivos `.planning/phases/14-*` aparecieron. No hubo pérdida de cambios (la rama no tenía nada propio).
- **`node_modules/` ausente** — al instalar (`npm install`) aparecieron `commander` y `picocolors` (2 paquetes, 0 vulns, 628ms). Necesario para que el smoke test corriera al spawnar `bin/kodo`. No es una decisión de plan: el worktree simplemente arrancó sin install.

## Threat Model Verification

Plan 14-03 declaró 4 amenazas STRIDE (T-14-10..13):

- **T-14-10 (Documentation drift):** mitigate. El bullet de PROJECT.md referencia `test/format-isolation.test.js` por path. Si Plan 14-02 falla en wave 2 o el archivo se borra después, el bullet apunta a un archivo inexistente. **Aceptado:** un doc-link checker está fuera de scope; el merge orchestrator de wave 2 verá ambos plans converger antes de tocar main.
- **T-14-11 (DoS via spawn hang):** accept. `bin/kodo --version` es commander built-in, sale en ms. `spawnSync` es síncrono. Sin timeout explícito en el test (no necesario).
- **T-14-12 (Info disclosure via inherited env):** accept. El test sólo lee `process.execPath` y `cwd`. No propaga secrets.
- **T-14-13 (Picocolors transitive warn):** **verified by test.** Empíricamente: stderr 0 bytes con picocolors@1.1.1 instalado. El test fallará si una versión futura introduce deprecation, lo cual es exactamente la intención.

No surgieron threat flags adicionales.

## Self-Check

- [x] `.planning/PROJECT.md` existe y contiene "Color isolation" bullet — `grep -c "Color isolation" .planning/PROJECT.md` = 1 ✓
- [x] `test/version-smoke.test.js` existe (39 líneas) ✓
- [x] Commit `0b1d0d2` (Task 1) presente en el git log de la rama ✓
- [x] Commit `1d1f26b` (Task 2) presente en el git log de la rama ✓
- [x] Suite global verde: 455 tests, 0 fail ✓
- [x] Diff de PROJECT.md puramente aditivo (0 líneas removidas) ✓
- [x] §Current Milestone block intacto, footer intacto, §Key Decisions intacto ✓

## Self-Check: PASSED

## User Setup Required

None — no external service configuration. La install de `npm install` ya quedó hecha antes del primer commit.

## Next Phase Readiness

- ROADMAP SC#4 (`picocolors` aparece en package.json + PROJECT.md documenta el bump + `kodo --version` sigue verde) **cerrado completo** tras el merge de wave 2.
- ROADMAP SC#5 parcial: full suite verde post-install confirma que ningún callsite existente se rompe por la mera presencia de picocolors en `package.json`. Wiring real al CLI llega en Phase 15.
- Sin blockers para cierre de Phase 14.

---
*Phase: 14-cli-format-foundation*
*Plan: 14-03*
*Completed: 2026-05-04*
