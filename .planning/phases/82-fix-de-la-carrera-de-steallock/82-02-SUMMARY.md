---
phase: 82-fix-de-la-carrera-de-steallock
plan: 02
subsystem: infra
tags: [gsd-lock, concurrency, steal-guard, race, o_excl, briefly-empty-window]

# Dependency graph
requires:
  - phase: 82-01
    provides: "stealLock steal-guard O_EXCL + in-place rename fix"
provides:
  - "Evidencia REPRODUCIDA de que el fix de 82-01 NO cierra CR-01: el steal-guard tiene una ventana briefly-empty propia (mismo tipo de bug que el move-aside original)"
  - "Root cause preciso del residual (guard reads null-en-ventana-vacía → break de guard vivo → dos stealers en la sección crítica)"
affects: [82-01-rework, gsd-lock, doctor.decideLock]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified: []

key-decisions:
  - "STOP-and-report (no enmascarar): el loop de estrés muestra fallos de CR-01 reales → prohibido D-07 debilitar el assert; se para y se devuelve al fix (instrucción explícita del <action> de Task 1)"
  - "NO ejecutar Task 2 (cierre documental D-09/D-10): prohibición explícita — no documentar cierre antes del verde determinista; un cierre sin evidencia sería doc-drift (lo que HYG-08/DEBT-02 vinieron a erradicar)"

requirements-completed: []

# Metrics
duration: 21min
completed: 2026-07-24
status: blocked
---

# Phase 82 Plan 02: Evidencia de determinismo — BLOQUEADO

**El fix de 82-01 (steal-guard `O_EXCL` + rename in-place) NO cierra la carrera CR-01: bajo carga el harness sigue produciendo doble adquisición (`acquired,acquired`) ~4% de las pasadas. Causa raíz reproducida con instrumentación: el steal-guard se crea con `writeFileSync(guardPath, json, {flag:'wx'})`, que es exclusivo en la CREACIÓN pero deja el fichero briefly-empty entre create y write; un stealer perdedor que lee esa ventana vacía lo interpreta como guard corrupto/roto, ROMPE un guard VIVO, y re-entra en la sección crítica → dos stealers renombran a la vez. El fix reubicó la ventana briefly-empty del fichero LOCK al fichero GUARD en lugar de eliminarla.**

## Estado: BLOCKED — Task 1 no cumple su acceptance criterion

Task 1 exige **0 fallos de CR-01** en ≥50 pasadas. Medido: **fallos reales de CR-01 con doble adquisición**. El `<action>` del plan es explícito para este caso: «Si el loop muestra CUALQUIER fallo, NO enmascarar (prohibido D-07): parar, reportar el interleaving observado y devolver al fix (Plan 82-01)». Task 2 (cierre documental) queda **sin ejecutar** por prohibición explícita (no documentar cierre antes del verde).

## Evidencia de estrés (LOCK-02 — FALLA)

Harness byte-idéntico confirmado antes de cada corrida: `git diff --quiet -- test/gsd-lock-race.test.js test/helpers/lock-race-child.mjs` → **CLEAN**. Assert `exactly one` intacto (no `.skip`, no retries, no timeouts subidos). `src/gsd/lock.js` sin tocar durante todo el diagnóstico (`git diff --quiet` verde). Node v22.22.3 · macOS Darwin 25.5.0 · 12 cores · load avg ~7–8.

| Corrida | Comando | N | Carga | Fallos CR-01 | Clasificación |
|---------|---------|---|-------|--------------|---------------|
| A | `node --test test/gsd-lock-race.test.js` en bucle | 60 | 4× loops paralelos | **2/60** | ambos CR-01 (dead-PID steal) |
| B | idem, capturando+clasificando | 80 | 4× loops paralelos | **5/80** | **5/5 CR-01**, 0 benignos |
| C | idem, SIN carga artificial (ambiente ~8) | 100 | ninguna | **4/100** | 4/4 CR-01, todos **N=5** |

- **Todos los fallos son CR-01** (`raceGsdStealDeadHolder`, «SAME dead-PID stale lock → exactly one steals»), NO el mecanismo benigno `raceGsdChildren` (0 observados). Es el bug de PRODUCTO, no un issue de harness.
- Firma exacta capturada: `exactly one process must steal a shared dead-PID lock; got: acquired,acquired` — **dos procesos reciben ambos `{acquired:true}`** sobre el mismo repo. Es el TOP THREAT (T-82-02 / T-81-03-01: dos agentes GSD vivos sobre un repo).
- El fix **redujo** la tasa (repro original ~48% → ~4%) pero **no la eliminó**. El invariante sigue violado.

### Suite completa (success criterion 3)
No ejecutada como gate final: el `<verify>` de Task 1 encadena `npm test` DETRÁS de `test "$fails" -eq 0`, condición que no se cumple. Correr la suite no cambiaría el veredicto (el fallo es del primitivo, no de un consumidor). Se difiere hasta que el fix esté verde.

## Root Cause del residual (reproducido con instrumentación)

Copia instrumentada de `lock.js` (en scratchpad — **producción NUNCA tocada**, `git diff --quiet` verde), con marcadores de rama, réplica de `raceGsdStealDeadHolder(5)`. Patrón **idéntico en las 3 iteraciones con doble adquisición** capturadas:

```
TRACE <W> GUARD_LOST attempt=0        (perdedor W pierde el O_EXCL del guard)   ← en realidad L, ver nota
TRACE <L> GUARD_BREAK_STALE           (L cree que el guard está stale → lo ROMPE)
TRACE <W> GUARD_WON attempt=0         (W creó el guard, entra a la sección crítica)
TRACE <L> GUARD_WON attempt=1         (L re-crea el guard tras romperlo → TAMBIÉN entra)
TRACE <W> INPLACE_RENAME_WON          (W: renameSync(tmp→lockPath), acquired:true)
TRACE <L> INPLACE_RENAME_WON          (L: renameSync(tmp→lockPath), acquired:true)  ← DOBLE
```

Secuencia causal:

1. N≥2 stealers del mismo lock muerto entran en `stealLock`.
2. Stealer **W** gana el guard vía `acquireStealGuard` = `writeFileSync(guardPath, json, {flag:'wx'})`. El `O_EXCL` garantiza CREACIÓN exclusiva, pero `writeFileSync` **crea el fichero VACÍO y luego escribe los bytes JSON** — hay una ventana en la que `guardPath` EXISTE pero está VACÍO/parcial.
3. Stealer **L** pierde el `O_EXCL` (EEXIST) y de inmediato hace `guardIsStale(readGuard(guardPath), …)`. Si su `readGuard` (`readFileSync`+`JSON.parse`) cae en la ventana vacía de W, `JSON.parse('')` lanza → `readGuard` devuelve `null` → `guardIsStale(null)` devuelve **`true`**.
4. L trata el guard VIVO como rompible → `breakStaleGuard` hace `unlinkSync` del guard de W (marcador `GUARD_BREAK_STALE`).
5. L re-contiende (attempt=1): `acquireStealGuard` `O_EXCL` **tiene éxito** (el guard acaba de ser borrado) → L «posee» el guard también (`GUARD_WON attempt=1`).
6. **W y L están ahora AMBOS dentro de la sección crítica «serializada»**. Ambos leen `lockPath` con el lock muerto todavía presente (o L lee antes de que el rename de W confirme) → ambos toman la rama de reemplazo in-place → ambos `renameSync(tmp → lockPath)` → ambos devuelven `{acquired:true}`.

**Diagnóstico:** el `writeFileSync(guardPath, …, {flag:'wx'})` es exclusivo en creación pero **no atómico en contenido** — deja un guard briefly-empty. Un perdedor que lee ese guard vacío **no puede distinguir** «guard vivo a medio escribir» de «guard corrupto/ausente rompible» (`readGuard`→`null`→`guardIsStale`→`true`), así que **rompe un guard VIVO** — exactamente el «Pitfall 1» que el docblock afirmaba prevenir. Es la **MISMA clase de defecto briefly-empty** que el move-aside original de CR-01: el fix **reubicó** la ventana vacía del fichero LOCK al fichero GUARD, no la eliminó.

## Dirección de fix recomendada (NO implementada aquí — fuera de alcance de este plan)

Este plan es evidencia + docs («sin cambios de código»); el arreglo toca el primitivo de concurrencia (TOP THREAT, decisión de mantenedor — Rule 4). Devuelto a 82-01 / nuevo plan. Direcciones:

1. **Publicación del guard atómica en contenido.** Escribir el JSON `{pid,ts}` completo a un tmp único y `linkSync(tmp, guardPath)` (atómico, `EEXIST` si existe), de modo que el guard sólo sea visible ya-formado; borrar el tmp después. Elimina la ventana vacía por construcción — el guard nunca se lee vacío.
2. **`guardIsStale` no debe romper un guard PRESENTE-pero-no-parseable.** Sólo un guard genuinamente AUSENTE (`existsSync` false), o presente con PID provablemente muerto / `ts` envejecido, es rompible. Un guard presente vacío/parcial es un poseedor vivo a medio escribir: respetarlo (backoff + re-contienda), jamás romperlo. `readGuard`→`null` sobre un fichero PRESENTE ≠ rompible.
3. Idealmente ambas (1 cierra la ventana; 2 es defensa en profundidad para cualquier parcialidad residual de FS).

## Deviations from Plan

- **[Blocker — no Rule 1..3] Task 1 acceptance criterion no cumplido; Task 2 no ejecutado.** El plan asume que el fix de 82-01 es determinista; la evidencia reproducida demuestra que no lo es. No se enmascara (D-07) ni se documenta cierre sin verde (prohibición D-09/D-10). Arreglar `lock.js` es dominio de 82-01 y toca el TOP THREAT (Rule 4, decisión de mantenedor) — no se aplica en este plan docs-only. Se reporta como blocker con root cause reproducido y dirección de fix.

## Artefactos de Task 2 (D-09 / D-10): NO ejecutados

- `.planning/debug/gsd-lock-race-cr01.md` **permanece en su sitio** (no movido a `resolved/`) — la causa raíz NO está resuelta; moverlo con un Outcome «resuelto» sería doc-drift.
- La fila §Deferred Items «Carrera real confirmada en `stealLock`» de STATE.md **permanece abierta** («Programado → v0.19 Phase 82»). No se marca cerrada.

## User Setup Required
Ninguno. Decisión de mantenedor requerida sobre el rework del primitivo (Rule 4).

## Self-Check: PASSED

- Evidencia reproducida y clasificada (3 corridas independientes, todas fallos de CR-01; instrumentación con patrón idéntico ×3).
- Producción intacta: `git diff --quiet -- src/gsd/lock.js test/gsd-lock-race.test.js test/helpers/lock-race-child.mjs` → CLEAN.
- Ningún artefacto de cierre escrito (Task 2 correctamente omitido por prohibición).
- `status: blocked` — el plan NO está completo; requiere fix en `src/gsd/lock.js` (82-01 rework) antes de re-evaluar LOCK-02/LOCK-03.

---
*Phase: 82-fix-de-la-carrera-de-steallock*
*Blocked: 2026-07-24 — fix de 82-01 no cierra CR-01; ventana briefly-empty reubicada al steal-guard*
