---
phase: 82-fix-de-la-carrera-de-steallock
plan: 01
subsystem: infra
tags: [gsd-lock, concurrency, file-locking, o_excl, atomic-rename, node-fs]

# Dependency graph
requires:
  - phase: 70-...
    provides: "acquireGsdLock/stealLock O_EXCL create path + CR-01 race harness"
provides:
  - "stealLock rewritten: O_EXCL steal-guard serializes the critical section; lock ownership via renameSync(tmp->lockPath), never briefly-empty (D-01/D-02)"
  - "Breakable guard (dead-PID primary, age>threshold backstop) closing the DoS on orphaned guards (D-05)"
  - "Targeted guard unit tests via public API + on-disk seeding (no private exports, D-08)"
affects: [82-02-stress-loop, gsd-lock, doctor.decideLock]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Steal-guard: ownership conferred ONLY by O_EXCL create; breaking clears an orphan but confers no ownership"
    - "Atomic in-place replacement via unique tmp (pid+randomUUID) + renameSync in the same dir (session-end.js WR-02 analog)"
    - "existsSync-gated branch: present (stale/corrupt) => rename-replace; absent => O_EXCL create (Pitfall 2)"

key-files:
  created:
    - test/gsd-lock-guard.test.js
  modified:
    - src/gsd/lock.js
    - .gitignore

key-decisions:
  - "Guard staleness threshold STEAL_GUARD_STALE_MS = 5000ms (>1000x the ~1ms critical section); dead-PID is the primary always-safe break criterion"
  - "Absent-holder branch uses O_EXCL (writeFileSync wx) not rename, so a fresh acquireGsdLock Case-1 creator is respected, not clobbered (Pitfall 2)"
  - "Discriminate present-stale/corrupt (rename-replace, safe) from absent (O_EXCL) via existsSync, not readLockContent==null — corrupt files are present and must not take the absent branch"

patterns-established:
  - "Guard-serialized critical section with finally-release; bounded MAX_STEAL_ATTEMPTS budget; backoff via Atomics.wait synchronous sleep"

requirements-completed: [LOCK-01, LOCK-02]

coverage:
  - id: D1
    description: "stealLock closes the move-aside->O_EXCL window by construction: O_EXCL steal-guard serializes stealers, lock replaced atomically via renameSync(tmp->lockPath)"
    requirement: "LOCK-01"
    verification:
      - kind: integration
        ref: "test/gsd-lock-race.test.js#2/5 processes observing the SAME dead-PID stale lock -> exactly one steals"
        status: pass
      - kind: unit
        ref: "test/gsd-lock-guard.test.js#(a) orphan guard (dead PID) + stale lock -> steals; no guard/tmp residue"
        status: pass
    human_judgment: false
  - id: D2
    description: "Breakable guard: orphaned (dead-PID / aged) guards are broken and recovered; a live+fresh guard is never broken (no double-acquire)"
    requirement: "LOCK-02"
    verification:
      - kind: unit
        ref: "test/gsd-lock-guard.test.js#(b) live+fresh guard + stale lock -> does not steal past a valid guard"
        status: pass
      - kind: unit
        ref: "test/gsd-lock-guard.test.js#(c) live but very old guard + stale lock -> broken by age, steals"
        status: pass
      - kind: unit
        ref: "test/gsd-lock-guard.test.js#(d) simulated crash mid-steal -> consistent"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-08 contract intact: Cases 1-5, AcquireResult shape, JSON lock format, exports (==5), consumers unchanged; harness byte-identical (D-07); zero new deps"
    verification:
      - kind: unit
        ref: "node --test test/gsd-lock.test.js (15 tests pass)"
        status: pass
      - kind: other
        ref: "grep -cE '^export ' src/gsd/lock.js == 5; git diff --quiet -- test/gsd-lock-race.test.js test/helpers/lock-race-child.mjs; git diff --quiet -- package.json"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-24
status: complete
---

# Phase 82 Plan 01: Fix de la carrera de `stealLock` Summary

**`stealLock` reescrito con steal-guard `O_EXCL` + reemplazo in-place atómico (`renameSync(tmp->lockPath)`): la ventana move-aside->`O_EXCL` queda cerrada por construcción; con N>=2 stealers del mismo lock muerto, exactamente uno adquiere (CR-01 verde).**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-24
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- Eliminada la causa raíz de la doble adquisición: el move-aside (`renameSync(lockPath -> aside)`) desaparece; el único rename del lock es `renameSync(tmp -> lockPath)`, que jamás deja `lockPath` ausente (D-01/D-02).
- Steal-guard `O_EXCL` (`${lockPath}.steal-guard`) serializa el cuerpo crítico entre stealers; la propiedad del guard la confiere SOLO el `O_EXCL`-create, nunca la rotura.
- Guard breakable por PID muerto (primario, siempre seguro) o edad>`STEAL_GUARD_STALE_MS` (backstop, margen >1000x sobre ~1ms de sección crítica) — un poseedor que crashea no bloquea steals para siempre (D-05).
- Rama `lockPath` ausente respeta a un creador fresco vía `O_EXCL` (Pitfall 2); rama presente (stale/corrupt) hace reemplazo in-place seguro (discriminado por `existsSync`).
- Unit tests dirigidos del guard vía API pública + seeding (4 casos deterministas), sin exponer helpers privados (D-08).

## Task Commits

Cada tarea se commiteó atómicamente (TDD):

1. **Task 1: Unit tests dirigidos del steal-guard (RED)** - `17ef347` (test)
2. **Task 2: Reescribir `stealLock` — guard `O_EXCL` + rename in-place + docblock + .gitignore (GREEN)** - `588a5cb` (feat)

_TDD gate sequence: `test(...)` (RED, 3/4 casos rojos) -> `feat(...)` (GREEN, 23/23 verdes)._

## Files Created/Modified
- `test/gsd-lock-guard.test.js` - Nuevo. 4 casos deterministas del guard (huérfano-PID-muerto, vivo+fresco-bloquea, viejo-por-edad-rompe, crash-mid-steal) vía `acquireGsdLock` + seeding de `.kodo.lock` y `.kodo.lock.steal-guard`; cabecera documenta que A1 (dos breakers concurrentes) la cubre el harness CR-01 + estrés de 82-02.
- `src/gsd/lock.js` - `stealLock` reescrito + docblock (D-11); nuevos helpers privados `readGuard`, `acquireStealGuard`, `guardIsStale`, `breakStaleGuard`, `sleepShort`; constante `STEAL_GUARD_STALE_MS`. Sin exports nuevos (count == 5). `AcquireResult`, formato JSON, Cases 1-5 y consumidores intactos (D-08).
- `.gitignore` - Entradas defensivas: `.planning/.kodo.lock`, `.planning/.kodo.lock.steal-guard`, `.planning/.kodo.lock.tmp.*`.

## Decisions Made
- **Umbral del guard = 5000ms.** Orden de segundos, >1000x el peor caso de la sección crítica (~1ms). PID-muerto es el criterio primario y siempre seguro; la edad es respaldo para un PID reciclado (A2).
- **`existsSync` como discriminador presente/ausente** en lugar de `readLockContent()==null`. Un lock corrupto está PRESENTE pero no parseable: debe tomar la rama de reemplazo in-place (segura, ningún Case-1 fresco puede aparecer sobre bytes presentes), NO la rama absent-O_EXCL. Esto preserva el Case 5 (corrupt) del contrato D-08.
- **Backoff síncrono vía `Atomics.wait`** (best-effort, degrada a no-op si `SharedArrayBuffer` no está disponible) para la contención acotada del perdedor del guard.

## Deviations from Plan

None - plan executed exactly as written. (El uso de `existsSync` para discriminar presente/ausente es discreción del implementador explícitamente permitida por el plan — "nombres/detalle exacto = discreción del implementador" — y necesaria para no romper el Case 5 corrupt; no constituye una desviación de alcance.)

## Issues Encountered
- **Riesgo detectado y evitado durante Task 2:** un primer borrador de la rama "absent" usaba `readLockContent()==null` como señal de ausencia, lo que habría enviado un lock CORRUPTO (presente pero no parseable) a la rama `O_EXCL`, y el fallback de agotamiento habría hecho `JSON.parse` sobre bytes corruptos y lanzado — rompiendo el Case 5 del contrato. Se corrigió antes de commitear discriminando con `existsSync(lockPath)` y usando `readLockContent` (que traga errores) en el fallback. Verificado: `test/gsd-lock.test.js` 15/15 verde.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 82-02 (loop de estrés >=50x + cierre de docs) puede proceder: la implementación del guard está en verde bajo una pasada de CR-01 (N=2/N=5); 82-02 evidencia el determinismo bajo estrés y cubre la propiedad concurrente A1 (dos breakers del mismo guard huérfano).
- Suite completa verde: 2368 pass / 0 fail / 1 todo (pre-existente).

## Self-Check: PASSED

- Files verified on disk: `test/gsd-lock-guard.test.js`, `src/gsd/lock.js`, `.gitignore`, `82-01-SUMMARY.md`.
- Commits verified in git: `17ef347` (test/RED), `588a5cb` (feat/GREEN).

---
*Phase: 82-fix-de-la-carrera-de-steallock*
*Completed: 2026-07-24*
