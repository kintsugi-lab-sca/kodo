---
phase: 82-fix-de-la-carrera-de-steallock
plan: 02
subsystem: infra
tags: [gsd-lock, concurrency, steal-guard, race, o_excl, linksync, stress-loop]

# Dependency graph
requires:
  - phase: 82-01
    provides: "stealLock steal-guard O_EXCL + in-place rename fix + linkSync atomic guard publish (rework)"
provides:
  - "Evidencia de determinismo de LOCK-02: CR-01 verde 100/100 bajo carga paralela 4x, suite completa verde (2370 pass)"
  - "Cierre documental LOCK-03: debug session gsd-lock-race-cr01 en resolved/ con Outcome resuelto; fila STATE.md §Deferred Items cerrada"
affects: [gsd-lock, doctor.decideLock, milestone-v0.19]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - .planning/debug/resolved/gsd-lock-race-cr01.md
    - .planning/STATE.md

key-decisions:
  - "Task 1 es evidencia pura (sin cambios de código): el verde determinista se documenta en el SUMMARY, no en un artefacto de código"
  - "El cierre documental (Task 2) se escribe SOLO tras el verde confirmado (gate D-09/D-10 respetado); la traza de causa raíz se preserva íntegra en el Outcome (no se borra)"

requirements-completed: [LOCK-02, LOCK-03]

coverage:
  - id: LOCK-02
    description: "El harness CR-01 byte-idéntico pasa verde >=50x bajo carga paralela con 0 fallos y el assert 'exactly one' intacto — verde determinista, no enmascarado"
    requirement: "LOCK-02"
    verification:
      - kind: integration
        ref: "node --test test/gsd-lock-race.test.js x100 bajo carga 4x paralela -> 0 fallos CR-01"
        status: pass
      - kind: other
        ref: "npm test -> 2370 pass / 0 fail / 1 skip; git diff --quiet harness -> clean"
        status: pass
    human_judgment: false
  - id: LOCK-03
    description: "R-81-01 y la debug session gsd-lock-race-cr01 cerradas formalmente: fichero en resolved/ con Outcome resuelto; fila STATE.md §Deferred Items marcada cerrada — sin doc-drift"
    requirement: "LOCK-03"
    verification:
      - kind: other
        ref: "test -f resolved/gsd-lock-race-cr01.md && test ! -f debug/gsd-lock-race-cr01.md && fila Deferred con ✅ Cerrada"
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-07-25
status: complete
---

# Phase 82 Plan 02: Evidencia de determinismo + cierre documental Summary

**El fix de la carrera CR-01 es DETERMINISTA: el harness byte-idéntico pasa 100/100 bajo carga paralela 4× con 0 fallos (el repro original medía ~48%), la suite completa queda verde (2370 pass / 0 fail), y R-81-01 + la debug session `gsd-lock-race-cr01` se cierran formalmente — fichero en `resolved/` con Outcome resuelto y fila STATE.md §Deferred Items marcada cerrada, sin doc-drift.**

## Contexto: rework de 82-01 aplicado antes de este verde

Una primera ejecución de este plan (commit `bc433a1`) **bloqueó** correctamente el cierre: el fix inicial de 82-01 (`588a5cb`) publicaba el steal-guard con `writeFileSync(guardPath, {flag:'wx'})` — exclusivo en creación pero **no atómico en contenido**, reubicando la ventana briefly-empty del fichero LOCK al fichero GUARD (doble adquisición reproducida ~4/100 bajo carga, root cause capturado con instrumentación). El coordinador aplicó el **rework** (`c92b0e4` RED, `16d60b6` fix, `137075d` docs): el guard se publica ahora atómicamente en contenido vía `linkSync(tmp → guardPath)` y `guardIsStale` ya no rompe un guard presente-pero-no-parseable reciente. Este plan re-ejecutó desde Task 1 sobre ese rework.

## Performance
- **Duration:** ~15 min (re-ejecución sobre el rework)
- **Completed:** 2026-07-25
- **Tasks:** 2 (Task 1 evidencia, Task 2 cierre documental)
- **Files modified:** 2 (`resolved/gsd-lock-race-cr01.md` movido+editado, `STATE.md`)

## Task 1 — Evidencia de verde determinista (LOCK-02)

Harness byte-idéntico confirmado antes y después (`git diff --quiet -- test/gsd-lock-race.test.js test/helpers/lock-race-child.mjs` → CLEAN). Assert `exactly one` intacto (sin `.skip`/retries/timeouts subidos). `src/gsd/lock.js` con el rework (`16d60b6`, `linkSync` presente). Node v22.22.3 · macOS Darwin 25.5.0 · 12 cores · load avg ~7–9.

| Métrica | Comando | Resultado |
|---------|---------|-----------|
| Loop de estrés CR-01 | `node --test test/gsd-lock-race.test.js` ×100 bajo **4× loops paralelos** (120 iters c/u) | **0/100 fallos** (0 CR-01, 0 benignos) |
| Suite completa | `npm test` | **2371 tests · 2370 pass · 0 fail · 1 skip** (21.5s) |

- **0 fallos de CR-01** en 100 pasadas bajo carga (el repro original fallaba ~48%: 13/50 y 19/40). Validación adicional del rework (coordinador): 300 iters (100@c4 + 200@c6) a 0 fallos.
- El `<verify>` del plan (`fails==0 && npm test green`) se cumple en su totalidad.
- Sin cambios de código en este task (evidencia pura → documentada aquí).

## Task 2 — Cierre documental (LOCK-03)

1. **D-09** — `.planning/debug/gsd-lock-race-cr01.md` movido con `git mv` a `.planning/debug/resolved/gsd-lock-race-cr01.md` (historial preservado, rename 100%). Su sección `## Outcome` conserva íntegro el diagnóstico previo (traza de la ventana briefly-empty) y **añade** una subsección `RESUELTO (2026-07-25)`: mecanismo del fix en dos pasos (in-place rename `588a5cb` + publicación atómica del guard vía `linkSync` `16d60b6`), commits, y evidencia de determinismo (100/100 + suite verde).
2. **D-10** — en `.planning/STATE.md` §Deferred Items, la fila «Carrera real confirmada en `stealLock`» pasa de «Programado → v0.19 Phase 82» a **✅ Cerrada** (fix real, commits `588a5cb`+`16d60b6`, CR-01 verde determinista). Párrafo introductorio de la sección actualizado («YA CERRADA»). El resto de filas (WR-01/02, Nyquist, etc.) intactas.
3. **Blocker limpiado** — el blocker de 82-02 que dejó el commit `bc433a1` en STATE.md §Blockers se marca resuelto por el rework `16d60b6`.

## Deviations from Plan

- **[Contexto, no desviación de alcance] Doble ejecución del plan.** La primera pasada bloqueó por evidencia reproducida de que el fix inicial no cerraba CR-01 (comportamiento correcto: prohibido enmascarar, prohibido documentar cierre sin verde). Tras el rework de 82-01 aplicado por el coordinador, el plan se re-ejecutó desde Task 1 y completó como estaba escrito. El commit `bc433a1` (SUMMARY blocked) queda en el historial como traza; este SUMMARY lo sustituye con estado `complete`.

## Issues Encountered

- **Commit de Task 2 en dos pasos.** El primer commit del cierre (`15935d5`) capturó solo el rename puro: el `git add` con la ruta antigua ya inexistente abortó antes de stagear el contenido editado. Se detectó de inmediato (`git show --stat` mostró 0 insertions) y se corrigió con un segundo commit (`e514fe5`) que staged los dos ficheros modificados. Sin pérdida de contenido (las ediciones seguían en el working tree).

## User Setup Required
Ninguno.

## Self-Check: PASSED

- `git diff --quiet -- src/gsd/lock.js test/gsd-lock-race.test.js test/helpers/lock-race-child.mjs` → CLEAN (harness/producción intactos por este plan).
- `.planning/debug/resolved/gsd-lock-race-cr01.md` existe con subsección RESUELTO; original ausente.
- STATE.md §Deferred Items fila `stealLock` = ✅ Cerrada; blocker limpiado.
- Suite completa verde (2370 pass / 0 fail) verificada.

---
*Phase: 82-fix-de-la-carrera-de-steallock*
*Completed: 2026-07-25 — CR-01 verde determinista (100/100 bajo carga); R-81-01 saldada = fix real*
