# DEBT-04 — Nota de resolución: diagnóstico del flaky `gsd-lock-race` (CR-01)

**Fecha:** 2026-07-24
**Requirement:** DEBT-04 (v0.18 Phase 81) — flaky preexistente de v0.16 Phase 70 (CONC-02).
**Artefacto de diagnóstico:** [`.planning/debug/gsd-lock-race-cr01.md`](../../debug/gsd-lock-race-cr01.md)

## Outcome

**CAUSA CONFIRMADA — bug de PRODUCTO (no del harness). Sin fix (gated por D-09).**

El flaky «concurrent dead-holder steal» (CR-01, `test/gsd-lock-race.test.js:153`, N=5) se reproduce ~48% en loop aislado bajo carga. La causa raíz, confirmada con un experimento instrumentado (copia de `lock.js` en scratchpad, producción intacta), es una **carrera real en `stealLock` (`src/gsd/lock.js:283-351`)**: la secuencia `renameSync` move-aside → `writeFileSync {wx}` create **no es atómica** y abre una ventana «briefly-empty» en `lockPath`. Con N≥2 procesos robando el MISMO lock stale a la vez, dos ventanas de move-aside solapadas dejan que **dos O_EXCL-create independientes ganen ambos** → dos procesos reciben `{ acquired: true }`. Es la hipótesis A1 (briefly-empty window) de 81-RESEARCH.md, ahora VERIFICADA.

Descartado hold-expiry/spawn-jitter para CR-01: subir `--hold` de 500→3000 ms NO baja la tasa (40% a 3000 ms); ambos ganadores están vivos y ven el dead-PID simultáneamente (`attemptDelayMs` ~30 ms « hold). Ese mecanismo de harness solo explica el fallo raro (1/40) del OTRO bloque `raceGsdChildren` (:131), sin pre-siembra.

## Condiciones de reproducción

- **Sí reproduce:** loop aislado `for i in $(seq 1 50); do node --test test/gsd-lock-race.test.js; done` con la máquina moderadamente cargada y cores libres para solapamiento real (13/50 y 19/40 en dos batches). Node v22.22.3, macOS Darwin 25.5.0, 12 cores, load ~5–8.
- **No reproduce (en esta corrida):** suite completa en paralelo (`node --test $(find test ...)`), 0/10 — la saturación de 174 ficheros espacia los spawns de los 5 hijos y reduce el solapamiento temporal tenso que la carrera necesita. La ventana briefly-empty exige que los N stealers coincidan en el tramo move-aside→create.

## Decisiones aplicadas (gate D-09/D-10)

- **`src/gsd/lock.js` NO modificado** — `git diff --quiet -- src/gsd/lock.js` verde. Invariante v0.16 LOCKED protegido. Un fix cambia la semántica del steal ⇒ fuera de alcance de este item diagnóstico; requiere decisión del mantenedor (Rule 4).
- **Cero remedios a ciegas** — sin `.skip`, sin retries, sin subir timeouts. El test permanece **flaky-red a propósito**: captura un bug real; ponerlo verde sería enmascarar la carrera (prohibido, T-81-03-02). Los casos CR-01 NO quedan `.skip`.
- **Sin instrumentación al helper** — volcar la rama del CAS exigiría tocar `lock.js` (READ-ONLY); el test ya imprime `verdicts` al fallar. La instrumentación cara no se justifica con la causa ya confirmada (D-10 aplicaría a un escenario de no-repro; aquí SÍ reprodujo).

## Follow-up (nuevo item de deuda para el mantenedor)

**Carrera real de doble-adquisición en `stealLock` (steal concurrente del mismo dead lock).** Toca T-81-03-01 (TOP THREAT). Direcciones de fix con gate en el artefacto §Suggested Fix Direction (steal atómico sin ventana vacía vía lock por directorio / `link()` con CAS por inodo; o serializar el steal). Alternativa: aceptar el riesgo documentado (multi-steal simultáneo del mismo dead lock es un peor-caso sintético) y dejar el test como red-esperado hasta un esfuerzo con gate. **Decisión del mantenedor.**

## Verificación del cierre de DEBT-04 (diagnóstico)

- [x] Artefacto `/gsd-debug` con estructura canónica y Root Cause con evidencia verificada — `.planning/debug/gsd-lock-race-cr01.md`
- [x] Nota de resolución con outcome + condiciones — este fichero
- [x] `git diff --quiet -- src/gsd/lock.js` (exit 0) — producción intacta
- [x] Cero remedios a ciegas; CR-01 no `.skip`
