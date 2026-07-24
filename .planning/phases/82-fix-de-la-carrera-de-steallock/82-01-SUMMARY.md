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
      - kind: unit
        ref: "test/gsd-lock-guard.test.js#(e) recent unparseable guard -> NOT broken"
        status: pass
      - kind: unit
        ref: "test/gsd-lock-guard.test.js#(f) aged unparseable guard -> broken by mtime, steals"
        status: pass
      - kind: integration
        ref: "CR-01 stress loop: 300 iters (100@conc4 + 200@conc6) under parallel load -> 0 double-acquire"
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

- **Duration:** ~20 min (+ rework tras hallazgo del stress loop de 82-02)
- **Completed:** 2026-07-24
- **Tasks:** 2 (TDD: RED + GREEN) + 1 rework (RED + GREEN, bug de concurrencia)
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
3. **Rework (Rule 1): casos de guard vacío/no-parseable (RED)** - `c92b0e4` (test)
4. **Rework (Rule 1): publicación atómica del guard vía `linkSync` (GREEN)** - `16d60b6` (fix)

_TDD gate sequence: `test(...)` (RED, 3/4 casos rojos) -> `feat(...)` (GREEN, 23/23 verdes) -> `test(...)` (RED, caso (e) rojo) -> `fix(...)` (GREEN, 25/25 verdes + stress 300×/0 fallos)._

## Files Created/Modified
- `test/gsd-lock-guard.test.js` - Nuevo. 4 casos deterministas del guard (huérfano-PID-muerto, vivo+fresco-bloquea, viejo-por-edad-rompe, crash-mid-steal) vía `acquireGsdLock` + seeding de `.kodo.lock` y `.kodo.lock.steal-guard`; cabecera documenta que A1 (dos breakers concurrentes) la cubre el harness CR-01 + estrés de 82-02.
- `src/gsd/lock.js` - `stealLock` reescrito + docblock (D-11); nuevos helpers privados `readGuard`, `acquireStealGuard`, `guardIsStale`, `breakStaleGuard`, `sleepShort`; constante `STEAL_GUARD_STALE_MS`. Sin exports nuevos (count == 5). `AcquireResult`, formato JSON, Cases 1-5 y consumidores intactos (D-08).
- `.gitignore` - Entradas defensivas: `.planning/.kodo.lock`, `.planning/.kodo.lock.steal-guard`, `.planning/.kodo.lock.tmp.*`.

## Decisions Made
- **Umbral del guard = 5000ms.** Orden de segundos, >1000x el peor caso de la sección crítica (~1ms). PID-muerto es el criterio primario y siempre seguro; la edad es respaldo para un PID reciclado (A2).
- **`existsSync` como discriminador presente/ausente** en lugar de `readLockContent()==null`. Un lock corrupto está PRESENTE pero no parseable: debe tomar la rama de reemplazo in-place (segura, ningún Case-1 fresco puede aparecer sobre bytes presentes), NO la rama absent-O_EXCL. Esto preserva el Case 5 (corrupt) del contrato D-08.
- **Backoff síncrono vía `Atomics.wait`** (best-effort, degrada a no-op si `SharedArrayBuffer` no está disponible) para la contención acotada del perdedor del guard.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] La ventana briefly-empty se había MOVIDO del lock al guard**
- **Found during:** Rework tras el stress loop de 82-02 (dobles adquisiciones reproducibles: 2/60, 5/80, 4/100 iteraciones, todas N=5, firma `got: acquired,acquired`).
- **Issue:** `acquireStealGuard` usaba `writeFileSync(guardPath, json, {flag:'wx'})` — exclusivo en la CREACIÓN pero NO atómico en CONTENIDO. Entre el `open` `O_EXCL` (fichero vacío) y el `write`, un stealer perdedor leía el guard vacío → `readGuard` → null → `guardIsStale(null)` → `true` → rompía un guard VIVO y re-entraba en la sección crítica → dos stealers renombraban a la vez. El fix del Plan 82-01 cerró la ventana del fichero LOCK pero la reabrió en el fichero GUARD.
- **Fix:** (1) Publicación atómica en contenido del guard: escribir el JSON a un tmp único y publicarlo con `linkSync(tmp → guardPath)` — `link(2)` es atómico y falla `EEXIST` si el guard existe; el guard aparece ya con contenido completo (D-01 aplicado al guard). tmp con `unlink` best-effort en todos los caminos. (2) `guardIsStale` defensivo: un guard presente-pero-no-parseable NO se considera stale por no parsear; se rompe solo por PID muerto / edad `ts` (parseable) o edad de fichero (mtime) para contenido no-parseable. (3) `.gitignore` cubre el tmp del guard.
- **Files modified:** `src/gsd/lock.js`, `.gitignore`, `test/gsd-lock-guard.test.js` (casos (e)/(f)).
- **Verification:** `node --test` lock+guard+race verde (25/25); **stress loop CR-01: 300 iteraciones (100@conc4 + 200@conc6) bajo carga paralela de suites → 0 dobles adquisiciones.** Export count == 5; harness byte-idéntico (D-07); `package.json` intacto (cero deps, D-08).
- **Committed in:** `c92b0e4` (test RED, caso (e)), `16d60b6` (fix GREEN).

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug de concurrencia reproducido y cerrado).
**Impact on plan:** El fix es necesario para la correctitud (LOCK-01/LOCK-02): sin él la garantía "exactamente uno adquiere" es falsa bajo estrés. Sin scope creep — mismo mecanismo (guard `O_EXCL`-exclusivo), reforzado para atomicidad de contenido. Discreción del implementador previa (`existsSync` para discriminar presente/ausente y preservar el Case 5 corrupt) se mantiene.

## Issues Encountered
- **Riesgo detectado y evitado durante Task 2:** un primer borrador de la rama "absent" usaba `readLockContent()==null` como señal de ausencia, lo que habría enviado un lock CORRUPTO (presente pero no parseable) a la rama `O_EXCL`, y el fallback de agotamiento habría hecho `JSON.parse` sobre bytes corruptos y lanzado — rompiendo el Case 5 del contrato. Se corrigió antes de commitear discriminando con `existsSync(lockPath)` y usando `readLockContent` (que traga errores) en el fallback. Verificado: `test/gsd-lock.test.js` 15/15 verde.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 82-02 (loop de estrés >=50x + cierre de docs) puede proceder: el guard ahora resiste el estrés — **300 iteraciones del harness CR-01 bajo carga paralela, 0 dobles adquisiciones** (A1 validada empíricamente: la ventana briefly-empty ya no existe ni en el lock ni en el guard).
- Suite completa verde: 2370 pass / 0 fail / 1 todo (pre-existente).

## Self-Check: PASSED

- Files verified on disk: `test/gsd-lock-guard.test.js`, `src/gsd/lock.js`, `.gitignore`, `82-01-SUMMARY.md`.
- Commits verified in git: `17ef347` (test/RED), `588a5cb` (feat/GREEN), `c92b0e4` (test/RED rework), `16d60b6` (fix/GREEN rework).

---
*Phase: 82-fix-de-la-carrera-de-steallock*
*Completed: 2026-07-24*
