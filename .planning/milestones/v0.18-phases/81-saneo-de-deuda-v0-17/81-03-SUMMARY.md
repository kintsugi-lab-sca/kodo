---
phase: 81-saneo-de-deuda-v0-17
plan: 03
subsystem: gsd-lock / test-diagnostics
tags: [debt, diagnosis, concurrency, lock, flaky-test, security]
requires: [v0.16 Phase 70 CONC-02 (acquireGsdLock + stealLock CAS)]
provides: [DEBT-04 root-cause diagnosis, confirmed stealLock double-acquire race]
affects: [src/gsd/lock.js (READ-ONLY, unchanged), test/gsd-lock-race.test.js (unchanged)]
tech_stack_added: []
patterns: [instrumented-copy diagnosis (production untouched), hold-sensitivity discriminator]
key_files_created:
  - .planning/debug/gsd-lock-race-cr01.md
  - .planning/phases/81-saneo-de-deuda-v0-17/81-DEBT-04-DIAGNOSIS.md
key_files_modified: []
decisions:
  - "DEBT-04 root cause CONFIRMED as a product race (not harness): stealLock move-aside->create is non-atomic, opening a briefly-empty window at lockPath; N>=2 concurrent stealers of the same dead lock let two O_EXCL creates both win -> double-acquire"
  - "src/gsd/lock.js kept READ-ONLY (D-09); the fix alters v0.16 steal semantics -> out of scope for this diagnosis-only item, deferred to maintainer (Rule 4)"
  - "test kept flaky-red by design: it catches a real race; greening it (skip/retry/timeout) is prohibited masking (T-81-03-02)"
metrics:
  duration_min: 17
  tasks: 2
  files_created: 2
  completed: 2026-07-24
status: complete
---

# Phase 81 Plan 03: Diagnóstico DEBT-04 flaky `gsd-lock-race` (CR-01) Summary

Confirmé, con un experimento instrumentado (copia de `lock.js` en scratchpad, producción intacta), que el flaky «concurrent dead-holder steal» (CR-01) es una **carrera de producto real** en `stealLock`: la secuencia move-aside → O_EXCL-create no es atómica y abre una ventana briefly-empty que deja que dos stealers concurrentes adquieran ambos — no un artefacto del harness. Entregable = artefacto de diagnóstico + nota de resolución; `src/gsd/lock.js` sin tocar; cero remedios a ciegas.

## What Was Built

- **`.planning/debug/gsd-lock-race-cr01.md`** — artefacto `/gsd-debug` con estructura canónica (Síntoma → Evidencia verificada → Root Cause → Files Involved → Suggested Fix Direction → Outcome). Documenta el interleaving mínimo de doble-adquisición (dos ventanas move-aside solapadas → dos O_EXCL-create ganadores) y por qué la guarda ABA no lo cierra.
- **`.planning/phases/81-saneo-de-deuda-v0-17/81-DEBT-04-DIAGNOSIS.md`** — nota de resolución: outcome (causa confirmada, sin fix, gated), condiciones de repro (sí en loop aislado, no en suite paralela), decisiones del gate D-09/D-10, y un follow-up para el mantenedor.

## Key Evidence (reproduced, not inferred)

- **Repro:** loop aislado 50x → 13/50 y 19/40 (~48%) fallos, **todos N=5, todos exactamente 2 `acquired`, cero en N=2**. Node v22.22.3, macOS Darwin 25.5.0, 12 cores, load ~5–8.
- **Discriminador hold:** hold 100/500/3000 ms → 65% / ~48% / 40% de doble-adquisición. **No baja con hold mayor** ⇒ descarta hold-expiry/spawn-jitter (harness); confirma la ventana briefly-empty (producto). Ambos ganadores vivos y viendo el dead-PID simultáneamente (delay ~30 ms « hold).
- **Traza CAS:** dos procesos ganan `writeFileSync {wx}` sobre la misma ruta (ej. dos `FRESH_CREATE_WON`) — solo posible si el fichero se eliminó entre ambos creates, y el único que lo elimina es el move-aside de `stealLock`.
- **Condición de repro afinada:** el fallo aparece en el loop del fichero aislado (spawns tensos y solapados) pero NO en la suite completa en paralelo (0/10 — la saturación de 174 ficheros espacia los spawns y rompe el solapamiento que la carrera necesita).

## Deviations from Plan

**Framing deviation (dentro de los outcomes válidos del plan):** el plan asumía CR-01 como foco pero contemplaba explícitamente (must_have backstop, línea 20) verificar si dos stealers pueden AMBOS adquirir. La evidencia confirma que **sí** — es un bug de producto, no del harness. Por tanto:

- **No se aplicó fix a `lock.js`** (D-09 LOCKED: el fix altera la semántica del steal de v0.16 ⇒ fuera de alcance de un item diagnóstico). Documentado como follow-up con gate del mantenedor.
- **No se aplicó fix al test/helper** ni instrumentación: exponer la rama del CAS exige tocar `lock.js` (READ-ONLY); el test ya vuelca `verdicts` al fallar. Con la causa confirmada, la instrumentación cara/arriesgada no se justifica (D-10 aplica a no-repro; aquí SÍ reprodujo).
- **El test permanece flaky-red a propósito.** Captura un bug real; ponerlo verde con skip/retry/timeout sería enmascarar la carrera (prohibido, T-81-03-02). Los casos CR-01 NO quedan `.skip`.

Sin remedios a ciegas. `git diff --quiet -- src/gsd/lock.js` verde; `test/` sin cambios.

## Verification Status

- [x] Artefacto de diagnóstico con Root Cause y evidencia verificada — existe
- [x] Nota de resolución con outcome + condiciones — existe
- [x] `git diff --quiet -- src/gsd/lock.js` exit 0 (invariante v0.16 protegido)
- [x] `test/gsd-lock-race.test.js` y `test/helpers/lock-race-child.mjs` sin cambios; CR-01 no `.skip`
- [~] `node --test test/gsd-lock-race.test.js` — **flaky-red a propósito** (~48% fallo bajo carga en loop aislado; verde en corridas individuales sin solapamiento). NO se fuerza a verde: el rojo es correcto porque captura la carrera real confirmada. Esta es la desviación consciente frente al criterio de aceptación literal de Task 2, respaldada por el must_have «el entregable es el artefacto, no un test verde» y por la prohibición T-81-03-02.

## Threat / Security Note

El diagnóstico **confirma la realización del TOP THREAT T-81-03-01** (Tampering: doble adquisición del lock cross-proceso → dos agentes GSD sobre un repo → posible corrupción de estado) como carrera real en `stealLock`, latente desde v0.16 Phase 70. No es superficie nueva introducida por este plan (solo se crearon docs), sino un hallazgo verificado sobre código existente. Mitigación inmediata respetada: `lock.js` intacto, sin enmascarar (T-81-03-02). Fix real gated → mantenedor.

## Known Stubs

Ninguno. Solo se crearon dos artefactos de documentación con contenido sustantivo verificado.

## Follow-ups

- **Nuevo item de deuda (mantenedor):** fix de la carrera de `stealLock` con gate D-09. Direcciones en el artefacto §Suggested Fix Direction (steal atómico sin ventana vacía vía lock por directorio / `link()` con CAS por inodo; o serializar la sección crítica del steal). Alternativa: aceptar el riesgo documentado (multi-steal simultáneo del mismo dead lock es un peor-caso sintético) con test red-esperado.

## Self-Check: PASSED

- FOUND: `.planning/debug/gsd-lock-race-cr01.md`
- FOUND: `.planning/phases/81-saneo-de-deuda-v0-17/81-DEBT-04-DIAGNOSIS.md`
- FOUND: `.planning/phases/81-saneo-de-deuda-v0-17/81-03-SUMMARY.md`
- FOUND commits: 9f9cf0e (deliverables), db7768f (summary)
- `git diff --quiet -- src/gsd/lock.js` verde (producción intacta)
