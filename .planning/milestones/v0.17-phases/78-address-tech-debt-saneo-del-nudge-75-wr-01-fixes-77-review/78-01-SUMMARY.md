---
phase: 78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review
plan: 01
subsystem: hooks
tags: [security, terminal-escape, stripControlChars, orchestrator-nudge, tdd]

# Dependency graph
requires:
  - phase: 75
    provides: "buildStopNudgeText con 2º param `next` (LIVE-07) + carril de render ya blindado con stripControlChars (App.js:752-753)"
provides:
  - "buildStopNudgeText sanea los 3 campos LLM (task_ref/summary/next) con stripControlChars en el punto de composición — cierra la asimetría de saneo del nudge (R-75-02 / T-78-01)"
affects: [session-end, orchestrator, hooks, security-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Saneo en el ÚNICO punto de composición (Opción 1): un solo diff cubre los 3 sinks, mantiene la pureza de la función"
    - "Simetría de saneo entre carril de render (dashboard) y carril de nudge (orquestador): mismo helper stripControlChars"

key-files:
  created: []
  modified:
    - src/hooks/stop.js
    - test/stop.test.js

key-decisions:
  - "Opción 1 (RESEARCH §Scope A): sanear en buildStopNudgeText, no en cada sink ni en session-end.js — mantiene la pureza y no toca el threading de handoffNext"
  - "El import de stripControlChars desde ../cli/format.js NO viola format-isolation: el walker solo prohíbe picocolors directo (verificado: 18 tests de isolation verdes)"

patterns-established:
  - "Todo campo de origen LLM/hand-editable que cruce a un terminal se sanea con stripControlChars antes de interpolarse"

requirements-completed: ["75/WR-01"]

coverage:
  - id: D1
    description: "buildStopNudgeText sanea task_ref, summary y next — ninguna secuencia de escape de terminal (CSI/OSC/C0/C1/DEL/CR) sobrevive en el texto del nudge"
    requirement: "75/WR-01"
    verification:
      - kind: unit
        ref: "test/stop.test.js#78/WR-01: sanea `task_ref` inyectado — CSI y BEL no sobreviven"
        status: pass
      - kind: unit
        ref: "test/stop.test.js#78/WR-01: sanea `summary` inyectado — OSC-52 simulado y CR no sobreviven"
        status: pass
      - kind: unit
        ref: "test/stop.test.js#78/WR-01: sanea `next` inyectado — CSI y C1 (\\x9b/\\x9d) no sobreviven"
        status: pass
    human_judgment: false
  - id: D2
    description: "No-regresión D-09: inputs ASCII limpios producen texto byte-idéntico en los 3 modos (goldens y LIVE-07 intactos); buildStopNudgeText sigue pura"
    requirement: "75/WR-01"
    verification:
      - kind: unit
        ref: "test/stop.test.js#78/WR-01: no-regresión D-09 — inputs ASCII limpios producen texto byte-idéntico en los TRES modos"
        status: pass
      - kind: unit
        ref: "test/stop.test.js#LIVE-07: buildStopNudgeText permanece PURA — cero I/O en su cuerpo (D-08)"
        status: pass
    human_judgment: false

# Metrics
duration: 2min
completed: 2026-07-21
status: complete
---

# Phase 78 Plan 01: Saneo del nudge del orquestador Summary

**buildStopNudgeText ahora pasa task_ref, summary y next por `stripControlChars` en el punto de composición — neutraliza CSI/OSC/C0/C1/DEL/CR desde contenido no confiable hacia el terminal del orquestador, cerrando la asimetría de saneo R-75-02 (T-78-01) con simetría exacta frente al carril de render ya blindado.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-07-21T23:29:04Z
- **Completed:** 2026-07-21T23:30:31Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Los 3 campos LLM del nudge (`task_ref`, `summary`, `next`) se sanean con `stripControlChars` — ninguna secuencia de escape de terminal sobrevive hacia `cmuxClient.send`.
- Simetría con el carril de render del dashboard (App.js:752-753): mismo helper, mismo patrón, cerrando el hueco donde el nudge emitía crudo.
- No-regresión byte-idéntica (D-09): sobre ASCII limpio `stripControlChars` es la identidad — los 5 goldens por-modo y los 4 tests LIVE-07 siguen verdes sin tocarlos.
- `buildStopNudgeText` sigue pura (cero I/O): el test de pureza sigue verde; cero dependencias npm nuevas (import relativo a un símbolo existente).

## Task Commits

Ejecución TDD, cada task committeado atómicamente:

1. **Task 1: Regresión RED — el nudge sanea los 3 campos LLM y sigue byte-idéntico** - `5e6814d` (test)
2. **Task 2: GREEN — sanear los 3 campos LLM en buildStopNudgeText** - `fd9bcb2` (feat)

_Nota: ciclo TDD RED→GREEN (sin REFACTOR — el diff GREEN ya era mínimo)._

## Files Created/Modified
- `test/stop.test.js` - 4 casos nuevos en el describe `QUICK-08 — buildStopNudgeText switch`: 3 teeth de saneo (task_ref/summary/next inyectando CSI/OSC/C0/C1/DEL/CR) + 1 no-regresión D-09 byte-idéntica por-modo.
- `src/hooks/stop.js` - Import de `stripControlChars` desde `../cli/format.js`; `session.task_ref`, `session.summary` y `next` interpolados a través de `stripControlChars(...)` en `buildStopNudgeText`. Firma, switch por-modo, textos base y guard del `next` sin cambios.

## Decisions Made
- **Opción 1 (punto de composición) sobre Opción 2 (por sink):** sanear dentro de `buildStopNudgeText` cubre los 3 sinks con un solo diff y mantiene la función pura; no toca `session-end.js` (el threading de `handoffNext` queda intacto).
- **El import no viola `format-isolation`:** el walker solo prohíbe importar `picocolors` directo, no `stripControlChars`. Verificado empíricamente: 18/18 tests de isolation verdes tras el cambio.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Las 3 teeth quedaron rojas con la implementación actual (bytes de control sobrevivían) y verdes tras el fix; goldens/LIVE-07/pureza intactos en ambos estados.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- R-75-02 / T-78-01 cerrado: el nudge del orquestador ya no transporta secuencias de escape de terminal.
- Plan 02 de la Phase 78 (fixes 77-REVIEW) queda pendiente e independiente de este diff (cero solapamiento de ficheros).

## TDD Gate Compliance
- RED gate: `5e6814d` (test) — 3 teeth rojas verificadas antes del fix.
- GREEN gate: `fd9bcb2` (feat) — suite completa verde (30/30).

## Self-Check: PASSED

- FOUND: src/hooks/stop.js
- FOUND: test/stop.test.js
- FOUND: 78-01-SUMMARY.md
- FOUND commit: 5e6814d (test RED)
- FOUND commit: fd9bcb2 (feat GREEN)

---
*Phase: 78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review*
*Completed: 2026-07-21*
