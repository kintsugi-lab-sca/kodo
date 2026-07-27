---
phase: 80
slug: carril-orquestador-reconciliaci-n-documental
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-23
---

# Phase 80 — Validation Strategy

> Per-phase validation contract reconstruido retroactivamente (backfill Nyquist Phase 85, NYQ-01).
> Cobertura **citada** de `80-VERIFICATION.md` (passed 11/12 must-haves) + los 2 SUMMARY de plan.
> **Sin re-ejecutar la suite** — cada dimensión referencia el resultado empírico ya registrado.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in runner) |
| **Config file** | none — `npm test` ejecuta el runner nativo sobre `test/` |
| **Quick run command** | `node --test test/check.test.js test/check-isolation.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Estimated runtime** | ~60 segundos (suite ~2355 tests) |
| **Evidencia citada** | `80-VERIFICATION.md` (2026-07-23, status passed, score 11/12 must-haves, `behavior_unverified: 1` — enrutado a §Manual-Only Verifications) |

---

## Sampling Rate

- **Evidencia primaria:** `80-VERIFICATION.md` — verificación inicial passed, 11/12 observable truths + 6/6 artifacts + 4/4 key-links verificados; el truth #12 restante es de comportamiento en vivo, no un hueco de cobertura del carril.
- **Política Nyquist (backfill):** la cobertura ES la cita a la evidencia preexistente; no se re-corre la suite (**D-12**).
- **UAT humano bloqueante:** `80-UAT.md` — **1/1 pass**, `status: complete` (convergencia observada por el operador; ver la nota de §Manual-Only sobre la fila de `STATE.md`).

---

## Per-Task Verification Map (dimensión → cobertura citada)

| Requirement | Plan | Dimensión / Secure Behavior | Test Type | Automated Command | Evidencia citada (fichero + resultado) | Status |
|-------------|------|-----------------------------|-----------|-------------------|----------------------------------------|--------|
| ORCH-07 | 80-01 | Orden del carril: `executeFn(deps, {fix:true})` corre ANTES de `launchOrchestrator()` cuando `needsOrchestrator === true` (D-05) | unit (DI) | `node --test test/check.test.js` | `80-VERIFICATION.md` Truth #2 ✓ VERIFIED — Test A (`test/check.test.js:338-355`), orden `execute` < `launch` en array compartido; Spot-Check del carril → **33 pass / 0 fail** | ✅ green |
| ORCH-07 | 80-01 | Gate estricto y consumido-no-alimentado: con `needsOrchestrator === false` cero llamadas al doctor, y el resultado del doctor JAMÁS entra en `reasons` ni altera el gate (D-03/D-04); sin triggers nuevos | unit (DI) | `node --test test/check.test.js` | `80-VERIFICATION.md` Truths #3/#4/#9 ✓ VERIFIED — Test B (`test/check.test.js:357-369`, `calls === []`) y Test C (`test/check.test.js:371-395`, sidebar sucio + check limpio ⇒ 0 llamadas) | ✅ green |
| ORCH-07 | 80-01 | Fail-open per-lane: un throw de `scanFn`/`executeFn` no propaga ni bloquea el check ni `launchOrchestrator` | unit (DI) | `node --test test/check.test.js` | `80-VERIFICATION.md` Truth #5 ✓ VERIFIED — Tests D + D2 (`test/check.test.js:397-426`), `launchFn` corre igual tras el throw | ✅ green |
| ORCH-07 | 80-01 | `runCheck()` queda byte-idéntico (sin líneas `Sidebar` en su `summary`) y `missing_group` nunca emite acción ejecutable ⇒ 0 acciones no genera bucle sobre advisories | unit | `node --test test/check.test.js test/cmux/sidebar-doctor.test.js` | `80-VERIFICATION.md` Truths #6/#7 ✓ VERIFIED — Test E (`test/check.test.js:428-439`) + `test/cmux/sidebar-doctor.test.js:218` (G-79-1: `missing_group` estructuralmente excluido de `hasActions`) | ✅ green |
| ORCH-07 | 80-01 | LOG-12: `src/check.js` alcanza `src/cmux/sidebar-doctor.js` en su grafo de imports **y** sigue sin alcanzar `logger.js` / `github/provider.js` / `github/normalize.js` / `triggers/polling.js` | guard (import-graph) | `node --test test/check-isolation.test.js` | `80-VERIFICATION.md` Truth #8 ✓ VERIFIED — `test/check-isolation.test.js:156` (aserción positiva de convergencia) + los 4 guards negativos preexistentes, los 5 verdes; **33 pass / 0 fail** combinado con `check.test.js` | ✅ green |
| ORCH-07 | 80-01 | Convergencia observable: con `needsOrchestrator === true`, un sidebar con workspaces sueltos o grupos vacíos converge al estado agrupado en ≤1 pase contra un cmux **vivo**, y un 2º pase ejecuta 0 acciones (SC1 ROADMAP / T5) | manual (e2e) | *(sin comando — ningún test del repo ejercita el ciclo contra un cmux real)* | `80-VERIFICATION.md` Truth #1 ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (cableado correcto en `src/check.js:148-166`, convergencia real no ejercitada) + `80-UAT.md` test 1 **result: pass** (1/1, 0 issues). Ver §Manual-Only Verifications | ⚠️ manual-only |
| ORCH-08 | 80-02 | `skill.md` (canónica) y `prompt.md` (fallback) mencionan `kodo sidebar doctor` y las 4 features v0.17 (`NEXT:`, dashboard/nudge, `pending_stale`, `--group`), sin prometer features borradas, con el bloque `BEGIN/END reporting` y los 3 placeholders intactos (D-11/D-12) | doc-grep (spot-check contractual) | `grep` de los 4 tokens × 2 ficheros + `grep` de los 5 marcadores de `prompt.md` | `80-VERIFICATION.md` Truths #10/#11/#12 ✓ VERIFIED — Spot-Checks → tokens **8/8 OK** y marcadores **5/5 OK**, diff fuera del bloque de reporting (`git show 8100e8d`); `grep -n "nudge de refresh"` → **0 resultados** en ambos ficheros | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky / manual-only*

---

## Wave 0 Requirements

Infraestructura existente (`node:test` nativo) cubre todos los requirements: los patrones de test de `check.js` y de `sidebar-doctor` ya existían y los ficheros se extendieron in-place, sin scaffold ni framework install. El campo `wave_0_complete` se conserva en `false` porque el backfill no tiene evidencia citable de una confirmación formal de Wave 0 y no se re-deriva (D-14) — no es un hueco de cobertura: ninguna dimensión del mapa depende de infraestructura ausente.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Evidencia |
|----------|-------------|------------|-----------|
| Convergencia real del sidebar en ≤1 pase motivado contra una sidebar cmux **viva** (workspace suelto → agrupado / grupo vacío → disuelto; 2º pase = 0 acciones) | ORCH-07 (SC1 ROADMAP / T5) | Límite estructural de la suite, no regresión de la fase: el motor `scan`/`execute` (Phase 79) se prueba con `deps` mockeados y el piggyback con `scanFn`/`executeFn` inyectados — ningún test del repo ejecuta el ciclo completo contra un `cmux` real, que no es mockeable de forma barata. El **cableado** (orden, gate, fail-open, no-trigger, LOG-12) sí está cubierto por los casos A/B/C/D/D2/E, todos verdes. | `80-VERIFICATION.md` §Human Verification Required item 1 + Truth #1 (cableado ✓ en `src/check.js:148-166`); `80-UAT.md` test 1 **result: pass** (1/1, 0 issues). **`STATE.md` §Deferred Items sigue registrando esta fila bajo «Evidencia en vivo»** (junto al round-trip de 79/SDR-05), pendiente de que aparezca deriva real sin fabricar estado en el sidebar del operador — **la Phase 85 no la cierra**: solo la contabiliza correctamente como manual-only en vez de como gap de cobertura. |
| Auditoría anti-deriva skill ↔ prompt en ambos sentidos (checklist HYG-08) | ORCH-08 | Documentación en prosa: el grep contractual demuestra presencia de tokens y ausencia de features borradas, pero el cruce bidireccional features v0.17+79 ↔ contenido de `skill.md`/`prompt.md` es juicio editorial, no comprobación programática (D-11). | `80-VERIFICATION.md` Truths #10/#11/#12 ✓ VERIFIED (tokens **8/8**, marcadores **5/5**, `nudge de refresh` → **0**) + `80-02-SUMMARY.md` §key-decisions (reparto asimétrico D-09: skill canónica con detalle, prompt conciso que la referencia). |

---

## Validation Sign-Off

- [x] Cada requirement (ORCH-07, ORCH-08) mapeado a ≥1 cita de evidencia real en `80-VERIFICATION.md`
- [x] Continuidad de sampling: cobertura automatizada verde para las dimensiones de riesgo del carril (orden, gate, fail-open, no-regresión de `runCheck`, LOG-12)
- [x] Wave 0 cubre todas las referencias MISSING (ninguna — infra nativa suficiente)
- [x] Sin watch-mode flags
- [x] Ninguna fase declarada N/A — evidencia empírica real citada
- [x] `nyquist_compliant` fijado a **true** en el frontmatter

**Approval:** validated 2026-07-27 (backfill Phase 85, NYQ-01)

---

## Reconstruction Audit 2026-07-27 (Phase 85 NYQ-01)

| Metric | Count |
|--------|-------|
| Requirements audited | 2 (ORCH-07, ORCH-08) |
| COVERED (automated unit) | 2 (ORCH-07: 5 dimensiones de cableado verdes; ORCH-08: grep contractual 8/8 tokens + 5/5 marcadores) |
| PARTIAL | 0 |
| MISSING | 0 |
| Manual-only (by design) | 2 (convergencia ≤1 pase contra cmux vivo — SC1/ORCH-07, sin cerrar en `STATE.md`; auditoría anti-deriva HYG-08 — ORCH-08) |
| Tests citados (no re-corridos) | **33 pass / 0 fail** (`test/check.test.js` + `test/check-isolation.test.js`) + el guard G-79-1 de `test/cmux/sidebar-doctor.test.js:218`, sobre suite completa **2355 pass / 0 fail**, 1 skip pre-existente |

**Nota Nyquist:** La lógica de riesgo de la fase (orden `execute` antes de `launch`, gate estricto por `needsOrchestrator`, aislamiento del resultado del doctor respecto de `reasons`, fail-open per-lane, `runCheck()` byte-idéntico y el invariante LOG-12 del grafo de imports) está cubierta por tests unitarios deterministas con DI y por un guard de import-graph, ya verde y verificada en `80-VERIFICATION.md` (passed 11/12). El único `behavior_unverified` —la convergencia observable contra un cmux vivo— es manual **por naturaleza**, no un hueco de sampling: el precedente `41-VALIDATION.md` ya declara nyquist-compliant una fase con una fila Manual-Only cuando la dimensión no es demostrable con mocks. Esa fila sigue abierta en `STATE.md` §Deferred Items y esta fase **no la cierra**. **Sin re-ejecutar la suite** — cobertura citada de `80-VERIFICATION.md` + 80-0{1,2}-SUMMARY.md + `80-UAT.md`. Fase declarada **nyquist-compliant**.
