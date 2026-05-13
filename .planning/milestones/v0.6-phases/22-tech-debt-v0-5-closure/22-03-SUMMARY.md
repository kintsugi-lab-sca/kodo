---
phase: 22-tech-debt-v0-5-closure
plan: 03
status: complete
date: 2026-05-13
key_files:
  modified:
    - src/triggers/dispatcher.js
    - src/hooks/stop.js
    - test/dispatcher.test.js
    - test/dispatcher-isolation.test.js
    - test/gsd-verify-integration.test.js
    - test/stop-state-transition.test.js
requirements_addressed:
  - DEBT-05
  - DEBT-06
commits:
  - fix(22-03): close Phase 16 debt — WR-04/06/08 + IN-01/02 + WR-05 (WR-07 deferred)
---

# Plan 22-03 — Phase 16 closure (DEBT-05 + DEBT-06)

## Outcome por item

| ID | Status | Notes |
|----|--------|-------|
| **WR-01** stop.js doble logger | satisfied-by-Phase-19 | 1 logger reusado entre sessionEnd + markSessionStatus (verificado in-plan) |
| **WR-02** stop.js catch-todo | satisfied-by-Phase-19 | `console.error('[kodo:stop] markSessionStatus failed: ...')` ya presente |
| **WR-03** verify.js triple child binding | satisfied-by-existing-tests | R-04 RESEARCH: merge validado indirectamente por from='review'/'running' en stop-state-transition |
| **WR-04** Test D-04 invariante asserta `from` | **closed** | `expectedFrom` paramétrico añadido por modo full/quick |
| **WR-05** T27 claration JSDoc | **closed** | Comment JSDoc añadido (order vs presence claration) |
| **WR-06** dispatcher.js doble import | **closed** | `gsdPhaseResolved`+`gsdBootstrap` consolidados eager en L13; dynamic L307 eliminada |
| **WR-07** manager.js markSessionStatus early-return | **deferred** | Implementado pero genera regression en T20 (gsd-verify-integration espera `from='unknown'` para sessions no-en-state.json). Revertido durante ejecución; documentado como deuda residual para v0.7+ |
| **WR-08** stripComments JSDoc inline-not-stripped | **closed** | Comment documental añadido al JSDoc |
| **IN-01** stop.js lazy DI doc | **closed** | JSDoc bloque añadido al final de `runStopHook` doc-comment |
| **IN-02** dispatcher.test.js payload deepEqual | **closed** | Test directo sobre `gsdPhaseResolved` helper con canonical keys (event/phase_id/match_heading/mode) |
| **IN-03** verify.js comment "header line 26" | satisfied-by-Phase-16-CR-01 | grep negativo verde |
| **IN-04** stop.js comment "line 116" | satisfied-by-Phase-19 | grep negativo verde |

**9 items closed (5 active fixes + 4 satisfied-by-existing); 1 deferred (WR-07).**

## Decisions honored

- D-01..D-09 CONTEXT.md respetadas; D-02b documentar > refactor cuando breaking (IN-01 inline doc, no signature change).
- D-04: tests defensivos donde behavior change (WR-04 paramétrico, IN-02 payload assert).
- D-04b: refactors puros sin test nuevo (WR-06 eager imports, WR-08 JSDoc).
- D-06b: stop.js / verify.js / dispatcher.js / manager.js tasks agrupadas por archivo.
- D-07/D-07b: cita por contenido en comentarios actualizados.
- D-09: commit cita IDs (WR-04/06/08 + IN-01/02 + WR-05).

## Deviation: WR-07 deferred

**Original plan:** añadir early-return en `markSessionStatus` cuando `listSessions().find` no encuentra la session, emitiendo `state.transition.skipped` warn en su lugar.

**Reality:** la implementación rompe T20 (`gsd-verify-integration.test.js`) que asume `from='unknown'` cuando la session no está en state.json (el fixture usa `findSessionFn` mock pero no seedea state.json). T20 valida explícitamente que `state.transition` se emite con `from.length > 0`.

**Action taken:** revertir el WR-07 fix (back a comportamiento `from = current?.status || 'unknown'`) y eliminar el test nuevo. WR-07 queda como deuda residual:
- **Opción correcta para v0.7+:** seedear state.json en `gsd-verify-integration.test.js` `beforeEach` (no solo mock `findSessionFn`), o introducir DI explícito de `listSessionsFn` en `markSessionStatus`. Cualquiera de los dos cambia el contrato de tests Phase 16 LOG-13/14/15 — requiere phase dedicada.
- **Impacto operativo:** mínimo. El `from='unknown'` ruido solo aparece cuando `markSessionStatus` se llama post-`removeSession` (caso edge — el orden actual stop.js Phase 19 CR-02 evita esto).

## Verification

- `grep -c "import { EVENTS, gsdPhaseResolved, gsdBootstrap }" src/triggers/dispatcher.js` → 1 ✓
- `grep -c "await import('../logger-events.js')" src/triggers/dispatcher.js` → 0 ✓
- `grep -c "await import('../logger.js')" src/triggers/dispatcher.js` → 3 ✓ (createLogger dynamic preservado LOG-12)
- `grep -c 'Lazy DI pattern' src/hooks/stop.js` → 1 ✓
- `grep -c 'expectedFrom' test/stop-state-transition.test.js` → 1 ✓
- `grep -c 'WR-04 Phase 16' test/stop-state-transition.test.js` → 1 ✓
- `grep -c 'WR-05 Phase 16' test/gsd-verify-integration.test.js` → 1 ✓
- `grep -c "inline comments at end of code lines are NOT stripped" test/dispatcher-isolation.test.js` → 1 ✓
- `grep -c 'IN-02 Phase 16 closure' test/dispatcher.test.js` → 1 ✓
- `grep -c 'header line 26' src/gsd/verify.js` → 0 ✓ (satisfied-by-Phase-16-CR-01)
- `grep -c 'line 116' src/hooks/stop.js` → 0 ✓ (satisfied-by-Phase-19)
- Suite global: 614 pass + 1 skip pre-existente / 0 fail (delta +2 vs 612 baseline post-22-02).

## Invariants preserved

- LOG-12: `kodo check` sin imports transitivos a logger.js (createLogger dynamic en dispatcher.js preservado).
- LOG-13: dispatcher source-hygiene intacto (literal `gsd.phase.resolved` solo en comentarios).
- Pitfall #6 Opción A: exit codes deterministas de `kodo gsd verify` intactos (WR-07 deferred no toca verify.js).
- Lock idempotencia (Phase 8 GSD-10): `releaseGsdLock`/`acquireGsdLock` no tocados.
- Phase 18 D-06: orchestrator EXCLUIDO de worktree (comment preservado).
- Phase 19 cleanup fail-open + auto-commit cwd intactos.
