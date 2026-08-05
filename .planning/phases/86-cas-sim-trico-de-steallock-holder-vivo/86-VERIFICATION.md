---
phase: 86-cas-sim-trico-de-steallock-holder-vivo
verified: 2026-08-05T09:39:01Z
status: passed
score: 4/4 must-haves verificados (LOCK-04, LOCK-05, LOCK-06, LOCK-07)
behavior_unverified: 0
overrides_applied: 0
---

# Phase 86: CAS simétrico de `stealLock` — holder VIVO — Verification Report

**Phase Goal:** Con un holder stale pero **VIVO** que libera el lock en plena sección crítica del steal, el lock que queda en disco es el del creador Case-1 legítimo — el stealer que llega tarde aborta con un `reason` discriminado en vez de clobbearlo. Nunca dos owners.
**Verificado:** 2026-08-05T09:39:01Z
**Estado:** passed
**Re-verificación:** No — verificación inicial (no existía `86-VERIFICATION.md` previo)

## Metodología

Esta verificación **no confía en los SUMMARY**. Para cada uno de los cuatro requisitos se rehicieron las comprobaciones de forma independiente contra el HEAD actual:

- Se leyó `src/gsd/lock.js` íntegro (no solo los fragmentos citados en los SUMMARY).
- Se ejecutaron los ficheros de test de la fase y los de los consumidores, en lugar de aceptar los conteos citados.
- Se ejecutó `npm test` completo y se comparó contra el baseline declarado.
- **Para LOCK-06 (mordida, `verification: backstop`)**: se revirtió el CAS a mano de forma independiente (sin copiar el diff del SUMMARY, aplicando el mismo cambio mínimo — `const changed = false;`), se confirmó el rojo, y se restauró. No se dio por buena la evidencia citada en el SUMMARY sin reproducirla.
- **Para LOCK-07 (honestidad, `verification: backstop`)**: se leyó el texto completo del JSDoc de `stealLock` y el bullet de `.planning/STATE.md`, juzgando los cuatro elementos de D-17 directamente sobre el texto, no sobre la afirmación del SUMMARY de que están presentes.
- Se leyó `86-REVIEW.md` y `86-REVIEW-FIX.md` y se verificó en el código actual que el hallazgo BLOCKER (CR-01) y los 4 warnings en alcance (WR-01, WR-02, WR-05, WR-06) están efectivamente corregidos, no solo declarados corregidos.

## Goal Achievement

### Observable Truths

| # | Truth | Estado | Evidencia |
|---|-------|--------|-----------|
| 1 | LOCK-04: la rama PRESENT del CAS re-valida identidad (bytes + `ino`) justo antes del `renameSync` y aborta con `reason: 'lock-replaced-mid-steal'` cuando cambió | ✓ VERIFICADO | `src/gsd/lock.js:604-706` — baseline `readLockIdentity` (:604), sonda fresca tras el `tmp` (:638), `Buffer.equals` + `ino` (:661-666), corte con `reason` en :702-706. `node --test test/gsd-lock-guard.test.js` → 13/13 pass, incluidos los casos `(g)`/`(h)` que aseveran el `reason` y la ausencia de residuo en disco. |
| 2 | LOCK-04: el lock del creador Case-1 sobrevive en disco; el `renameSync` destructivo NO se ejecuta | ✓ VERIFICADO | Caso `(h)` de `test/gsd-lock-guard.test.js`, verde. Verificado también indirectamente en la mordida (ver truth 5): al desactivar el CAS, esta garantía se rompe (`acquired=2`), confirmando que hoy el CAS es lo que la sostiene. |
| 3 | LOCK-04: un lock corrupto sigue siendo robable con el CAS puesto (`content: null` no bloquea) | ✓ VERIFICADO | Casos `(i)`, `(i2)`, `(i3)`, `(i4)` de `test/gsd-lock-guard.test.js`, verdes. `(i3)`/`(i4)` cubren además la subclase "presente pero ilegible" (fix de CR-01/WR-06, verificado en el código: `sameUnreadableFile` en `src/gsd/lock.js:652-659`). |
| 4 | LOCK-05: el harness siembra un holder **VIVO** (no dead-PID) y demuestra cardinalidad exacta con N=3 y N=5 | ✓ VERIFICADO | `test/helpers/lock-race-child.mjs:358` — `pid: process.pid` en el kind `gsd-holder`. `test/gsd-lock-race.test.js` casos "N=3" (:437) y "N=5" (:466), verdes, con `verdicts.filter(v => v === 'acquired').length === 1` en ambos. Reejecutado 3 veces consecutivas por este verificador — sin flakes. |
| 5 | LOCK-05: el escenario prueba (por marcador) que ejerció la rama del CAS | ✓ VERIFICADO | `assertCasExercised` (`test/gsd-lock-race.test.js:240-256`) invocado en ambos casos; exige ≥1 entrada `lock-replaced-mid-steal` en `steal-reasons.log`. |
| 6 | LOCK-06: revertir a mano el CAS pone el harness ROJO, con evidencia citada y verde tras restaurar | ✓ VERIFICADO (backstop, reproducido de forma independiente) | Este verificador aplicó `const changed = false;` en `src/gsd/lock.js` (mismo cambio mínimo descrito en `86-02-SUMMARY.md`) y obtuvo `# tests 6 · # pass 4 · # fail 2` en `test/gsd-lock-race.test.js`, con el mismo patrón de fallo citado en el SUMMARY (`verdicts=[written,acquired,...]`, `2 !== 1`). Restaurado con `git checkout -- src/gsd/lock.js`; `git status --porcelain` vacío; `node --test test/gsd-lock-race.test.js test/gsd-lock-guard.test.js` → 19/19 pass tras restaurar. |
| 7 | LOCK-07: la ventana residual está declarada en el JSDoc de `stealLock` y en `.planning/STATE.md` con los 4 elementos de D-17 (qué es · clase de riesgo · magnitud del cambio · nunca cierre por construcción) | ✓ VERIFICADO (backstop, juicio propio sobre el texto) | Leído el bloque completo `src/gsd/lock.js:534-567` y `.planning/STATE.md:168`. Los cuatro elementos están presentes literalmente, incluida la frase explícita "**NO** es cierre por construcción, y no debe leerse como si lo fuera" y la cita nombrada "TOCTOU residual" + "Phase 83". La cabecera del bloque (:481-497) — corregida por WR-02 — ya no afirma "by construction" para el primer orden; queda acotada a "toda sección crítica más corta que `STEAL_GUARD_STALE_MS`". No se encontró ninguna frase que presente el cierre como total. |
| 8 | Criterio 5: los consumidores del lock (`dispatcher.js`, `doctor.js`) no cambian y la suite completa queda verde por encima del baseline | ✓ VERIFICADO | `git diff --exit-code 120e5e9d HEAD -- src/triggers/dispatcher.js src/gsd/doctor.js` → rc 0. `npm test` → **2599 tests · 2598 pass · 0 fail · 1 skipped** (baseline 2590/2589/0/1) — coincide exactamente con el "Measured suite state at HEAD" declarado. |

**Score:** 8/8 truths verificadas (agrupadas en los 4 requisitos LOCK-04..07), 0 present-behavior-unverified.

### Hallazgos de `86-REVIEW.md` — verificados como corregidos en el código actual, no solo en el SUMMARY

| ID | Severidad | Verificación independiente |
|----|-----------|----------------------------|
| CR-01 (BLOCKER) | El CAS volvía inrobable un lock presente-pero-ilegible; `acquireGsdLock` acababa lanzando `EEXIST` | ✓ Corregido. `readLockIdentity` devuelve `missing` (`src/gsd/lock.js:311-340`); el CAS trata "ilegible antes y ahora, mismo `ino`" como `changed=false` (`:652-666`). Casos `(i3)`/`(i4)` verdes. |
| WR-01 | Comentario afirmaba una mitigación de `task_ref` que el código no aplicaba | ✓ Corregido. `safeRef` sanea `\p{Cc}` y trunca a 64 (`:695-697`); el comentario reconoce explícitamente que `:173` (pre-existente) no está saneado. |
| WR-02 | "closing … by construction" no lo sostenía el código | ✓ Corregido. Cabecera reescrita a "acotando … para toda sección crítica más corta que `STEAL_GUARD_STALE_MS`" (`:481-492`); comentario de la constante también reescrito (`:70-76`). |
| WR-05 | El harness medía `parkedMs`/`stages` y no aseveraba nada | ✓ Corregido. `assertScenarioStaged` (`:287-323`) invocado en ambos casos N=3/N=5, aseverando `released`, `creatorLanded`, `reasons` y `parkedMs < 3000`. |
| WR-06 | Ningún test cubría la subclase "presente pero ilegible" | ✓ Corregido. Casos `(i3)`/`(i4)` en `test/gsd-lock-guard.test.js:448-497`. |

**Hallazgos deliberadamente fuera de alcance (no son gaps de esta fase):**
- **WR-03** (`isPidAlive(undefined|NaN|0|-1) === true`) — defecto **pre-existente**, fuera de LOCK-04..07 por instrucción explícita del orquestador (blast radius sobre `doctor.decideLock`). Confirmado en código: `isPidAlive` (`src/gsd/lock.js:92-99`) no fue tocado por esta fase.
- **WR-04** (rama PRESENT/ABSENT decidida por un `existsSync` independiente del baseline) — riesgo de "intento desperdiciado", no de doble-owner; no amenaza los 4 requisitos.
- **WR-07** (el log `Lock stolen` se emite antes de intentar el robo) — cosmético, no afecta el invariante de owners.
- **IN-01/IN-02/IN-03** — calidad de test/estructura, no funcionalidad.

Ninguno de estos 5 hallazgos deshace las 8 truths verificadas arriba.

### Required Artifacts

| Artefacto | Esperado | Estado | Detalle |
|-----------|----------|--------|---------|
| `readLockIdentity(path)` | Lector de una pasada, `{raw, content, ino, missing}` | ✓ VERIFICADO | `src/gsd/lock.js:311-340`. |
| CAS en la rama PRESENT | Sonda fresca + `Buffer.equals` + `ino` antes del `renameSync` | ✓ VERIFICADO | `src/gsd/lock.js:634-707`. |
| `AcquireResult.reason?` | Campo aditivo y opcional | ✓ VERIFICADO | `src/gsd/lock.js:52-58`. |
| `deps._afterCriticalReadFn` | Seam de test, solo `attempt===0`, no usado en `src/` fuera de `lock.js` | ✓ VERIFICADO | `grep -rln '_afterCriticalReadFn' src/` → solo `src/gsd/lock.js`. |
| `test/gsd-lock-guard.test.js` — casos `(g)`-`(j)`, `(i2)`-`(i4)` | Casos in-process del CAS | ✓ VERIFICADO | 13 tests, 0 fail. |
| `test/helpers/lock-race-child.mjs` — kinds `gsd-holder`/`gsd-seam` | Holder VIVO + stealer aparcado | ✓ VERIFICADO | `:358` `pid: process.pid`; `:382-430` kind `gsd-seam`. |
| `test/gsd-lock-race.test.js` — casos N=3/N=5 | Orquestación de 3 tiempos con procesos reales | ✓ VERIFICADO | 6 tests, 0 fail, 3 corridas consecutivas verdes por este verificador. |
| Sección "Ventana residual" en el JSDoc | 4 elementos D-17 | ✓ VERIFICADO | `src/gsd/lock.js:534-567`. |
| Bullet de ventana residual en `STATE.md` | 4 elementos D-17, condensado | ✓ VERIFICADO | `.planning/STATE.md:168`. |

### Key Link Verification

| From | To | Via | Estado |
|------|-----|-----|--------|
| `readLockIdentity` (baseline) | `readLockIdentity` (sonda fresca) | `writeFileSync(tmp)` entre medias, orden inamovible | ✓ WIRED (`src/gsd/lock.js:604`→`:634`→`:638`) |
| `fresh.content` | `isStaleLock` | Corte con `reason` vs `continue` | ✓ WIRED (`:679`) |
| `continue` dentro del `try` | `finally` (`:735-741`) | Suelta el guard entre intentos | ✓ WIRED — verificado con la mordida: al forzar `changed=false` nunca se entra al `continue`/abort y el resultado es doble-owner, lo que confirma que en el código normal esta rama sí se ejercita. |
| `assertCasExercised` | `steal-reasons.log` | `result.reason` del hijo `gsd-seam` | ✓ WIRED (`test/gsd-lock-race.test.js:240-256`, invocado en ambos `it`) |
| `acquireGsdLock(deps)` | `stealLock(..., deps)` | 3 call sites (`:137`/`:142`/`:154` en numeración del plan) | ✓ WIRED — `test/gsd-concurrency.test.js`, `test/dispatcher.test.js`, `test/stop.test.js`, `test/gsd-inspect-cli.test.js` verdes sin modificación (`git diff --exit-code` sobre esos 4 ficheros → rc 0 dentro del rango de la fase). |

### Behavioral Spot-Checks

| Comportamiento | Comando | Resultado | Estado |
|-----------------|---------|-----------|--------|
| Tests de lock (guard+lock+race) | `node --test test/gsd-lock-guard.test.js test/gsd-lock.test.js test/gsd-lock-race.test.js` | 34 tests, 34 pass, 0 fail | ✓ PASS |
| Tests de consumidores intactos | `node --test test/gsd-concurrency.test.js test/dispatcher.test.js test/stop.test.js test/gsd-inspect-cli.test.js` | 106 tests, 106 pass, 0 fail | ✓ PASS |
| Suite completa | `npm test` | 2599 tests, 2598 pass, 0 fail, 1 skipped | ✓ PASS (coincide con el estado medido declarado) |
| N=3/N=5 sin flakiness | `node --test test/gsd-lock-race.test.js` ×3 | 6/6 pass las 3 veces | ✓ PASS |
| **Mordida LOCK-06 (reproducida de forma independiente)** | Revertir `changed` a mano → `node --test test/gsd-lock-race.test.js` → restaurar | Rojo: `# fail 2` (`2 !== 1`, mismo patrón que el SUMMARY); verde tras `git checkout` | ✓ PASS — evidencia reproducida, no solo citada |
| Ausencia de deuda no referenciada | `grep -n -E "TBD|FIXME|XXX"` sobre los 4 ficheros de código de la fase | Sin coincidencias | ✓ PASS |
| Consumidores hot-path intactos | `git diff --exit-code 120e5e9d HEAD -- src/triggers/dispatcher.js src/gsd/doctor.js` | rc 0 | ✓ PASS |
| `state.validate` | `gsd-tools query state.validate` | `{valid: true, warnings: [], drift: {}}` | ✓ PASS |

### Requirements Coverage

| Requisito | Plan fuente | Descripción | Estado | Evidencia |
|-----------|------------|-------------|--------|-----------|
| LOCK-04 | 86-01 | CAS simétrico, aborta con `reason`, nunca dos owners para el escenario in-process | ✓ SATISFECHO | Truths 1-3 arriba |
| LOCK-05 | 86-02 | Harness con holder VIVO, cardinalidad exacta N≥2, cobertura demostrable | ✓ SATISFECHO | Truths 4-5 arriba |
| LOCK-06 | 86-02 | Mordida verificada del guard | ✓ SATISFECHO | Truth 6 arriba, reproducida independientemente |
| LOCK-07 | 86-02 | Ventana residual declarada, honesta, nunca cierre por construcción | ✓ SATISFECHO | Truth 7 arriba, juicio propio sobre el texto |

**Sin requisitos huérfanos:** `REQUIREMENTS.md` mapea exactamente LOCK-04..07 a Phase 86 (líneas 69-72), y los dos PLAN los reclaman en su frontmatter (`86-01: [LOCK-04]`, `86-02: [LOCK-05, LOCK-06, LOCK-07]`) sin solapamiento ni faltantes.

### Anti-Patterns Found

Ninguno bloqueante. Los 5 hallazgos de `86-REVIEW.md` en alcance (CR-01, WR-01, WR-02, WR-05, WR-06) están corregidos y verificados en el código actual (tabla arriba). Los 5 hallazgos fuera de alcance (WR-03, WR-04, WR-07, IN-01, IN-02, IN-03) son de severidad WARNING/INFO, están explícitamente declarados como diferidos con su razón en `86-REVIEW-FIX.md`, y ninguno contradice las 8 truths verificadas de esta fase. No se encontraron marcadores de deuda no referenciados (`TBD`/`FIXME`/`XXX`) en los ficheros tocados por la fase.

### Human Verification Required

Ninguna. Los dos truths con `verification: backstop` (LOCK-06 y LOCK-07) fueron verificados directamente por este verificador — no delegados: la mordida se reprodujo de forma independiente (no se copió el diff/salida del SUMMARY, se re-ejecutó el experimento) y el texto de honestidad de LOCK-07 se leyó y juzgó línea por línea contra los cuatro elementos de D-17.

### Gaps Summary

Ninguno. Las cuatro truths de la fase (LOCK-04, LOCK-05, LOCK-06, LOCK-07) y el criterio 5 del ROADMAP están verificados con evidencia reproducida por este verificador, no solo citada por los SUMMARY. El único BLOCKER que existió (CR-01, hallado por `86-REVIEW.md`) está corregido y su fix confirmado en el código actual, con test de regresión verde. La deuda pre-existente conocida (WR-03, `isPidAlive` con PID no-entero) queda fuera del alcance de LOCK-04..07 por decisión explícita registrada, y no afecta ninguna de las truths verificadas.

---

_Verificado: 2026-08-05T09:39:01Z_
_Verifier: Claude (gsd-verifier)_
