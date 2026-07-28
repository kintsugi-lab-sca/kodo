---
phase: 85
slug: saneo-de-deuda-nyquist-retroactivo
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-27
---

# Phase 85 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by plan-phase desde `85-RESEARCH.md` §Validation Architecture. El mapa por-tarea lo puebla el planner con los task IDs reales.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (runner nativo) + `node:assert/strict` |
| **Config file** | none — convención del repo `test/**/*.test.js` |
| **Quick run command** | `node --test test/dashboard-select.test.js test/check.test.js test/check-isolation.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Estimated runtime** | ~1 s (quick) · ~120 s (full, 2586 tests) |
| **Baseline a HEAD** | 2586 tests · 2585 pass · 0 fail · 1 skipped (`84-VERIFICATION.md:94`) |

---

## Sampling Rate

- **After every task commit:** Run el quick command de los ficheros tocados por esa tarea.
- **After every plan wave:** Run `npm test`.
- **Before `/gsd-verify-work`:** Full suite must be green (2586+, cero fail).
- **Max feedback latency:** ~120 s (suite completa).
- **Bloque NYQ (D-12):** cobertura **por CITACIÓN** a la evidencia ya en disco — **cero tests nuevos, cero re-ejecución de la suite**. El sampling de NYQ-01/02 es la verificación documental del frontmatter resultante, no una corrida.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 85-01-01 | 85-01 | 1 | DEBT-05 | T-85-01-04 | El typedef describe el contrato vigente; cero cambio de comportamiento, cero fuga de dato del operador en el comentario | **CITATION** (D-03) + source-assert | `node --test test/state/handoff-state.test.js` + `grep -c 'ausente/null' src/session/state.js` = 0 | ✅ existe | ⬜ pending |
| 85-01-02 | 85-01 | 1 | DEBT-06 | T-85-01-03 | El test RED se commitea ANTES del fix; ningún assert existente se toca para greenear | **unit NUEVO (RED)** | `if node --test test/dashboard-select.test.js; then exit 1; fi` (debe FALLAR) | ✅ existe — se extiende | ⬜ pending |
| 85-01-03 | 85-01 | 1 | DEBT-06 | T-85-01-01, T-85-01-02 | Colapso de whitespace con fuente única (`nextCell`); el primer import de runtime no rompe color-isolation | **unit (GREEN)** + guard existente | `node --test test/dashboard-select.test.js test/dashboard-format.test.js test/format-isolation.test.js` | ✅ existe | ⬜ pending |
| 85-02-01 | 85-02 | 1 | DEBT-07 (WR-01+WR-02) | T-85-02-02 | La línea de fallos sale por `errorFn` y NO por `logFn`; la rama de silencio tiene su propio assert | **unit NUEVO (RED)** | `if node --test test/check.test.js; then exit 1; fi` (Test F debe FALLAR) | ✅ existe — se extiende | ⬜ pending |
| 85-02-02 | 85-02 | 1 | DEBT-07 (WR-01) | T-85-02-02, T-85-02-05 | Solo se emite el conteo entero (sin `reason`/`target`); fail-open y gate `needsOrchestrator` intactos | **unit (GREEN)** + source-assert de orden | `node --test test/check.test.js` + `awk` de orden `aplicadas < fallidas < hasAdvisories` sobre `src/check.js` | ✅ existe | ⬜ pending |
| 85-02-03 | 85-02 | 1 | DEBT-07 (WR-03 b) | T-85-02-01, T-85-02-03, T-85-02-04 | Regex CONSTANTE anti-ReDoS; `stripComments` antes del match; `walkImports` intacto; el guard tiene mordida demostrada | **unit NUEVO (guard)** | `node --test test/check-isolation.test.js` + verificación de mordida (inyectar/revertir) | ✅ existe — se extiende | ⬜ pending |
| 85-02-03 (a) | 85-02 | 1 | DEBT-07 (WR-03 a) | — | El comentario deja de afirmar la premisa falsa y declara el alcance MODULE-LOAD | **manual-only** (un comentario no es ejecutable) | `grep -c '06-RESEARCH A3' test/check-isolation.test.js` = 0 + inspección del diff en el SUMMARY | N/A | ⬜ pending |
| 85-03-01 | 85-03 | 1 | NYQ-01 | T-85-03-01, T-85-03-03 | `nyquist_compliant: true` solo con cita concreta; cero tests generados | **CITATION** (D-12) | `grep -c 'nyquist_compliant: true' .../81-VALIDATION.md` = 1 + `git status --porcelain test/ \| grep -c '^??'` = 0 | ✅ existe | ⬜ pending |
| 85-03-02 | 85-03 | 1 | NYQ-01 | T-85-03-01, T-85-03-02 | Ídem, con los `MILESTONE-AUDIT.md` archivados intactos | **CITATION** (D-12) | `grep -c 'nyquist_compliant: true' .../80-VALIDATION.md` = 1 + `git diff --exit-code .../v0.18-MILESTONE-AUDIT.md` | ✅ existe | ⬜ pending |
| 85-03-03 | 85-03 | 1 | NYQ-01 | T-85-03-01 | Ídem; SDR-05 contabilizado como manual-only, no como gap | **CITATION** (D-12) | `grep -c 'nyquist_compliant: true' .../79-VALIDATION.md` = 1 + una fila por SDR-01..06 | ✅ existe | ⬜ pending |
| 85-04-01 | 85-04 | 1 | NYQ-02 | T-85-04-01, T-85-04-02 | `nyquist_compliant: true` solo con cita; sin añadir estructura de frontmatter ajena al fichero | **CITATION** (D-12) | `grep -c 'nyquist_compliant: true' .../69-VALIDATION.md` = 1 + `grep -c '^# status lifecycle:'` = 0 | ✅ existe | ⬜ pending |
| 85-04-02 | 85-04 | 1 | NYQ-02 | T-85-04-01, T-85-04-04 | El `skipped: 1` del UAT se declara tal cual, jamás como `pass` | **CITATION** (D-12) | `grep -c 'nyquist_compliant: true' .../71-VALIDATION.md` = 1 + `grep -c 'TBD'` = 0 | ✅ existe | ⬜ pending |
| 85-04-03 | 85-04 | 1 | NYQ-02 | T-85-04-01, T-85-04-02, T-85-04-03 | La plantilla literal desaparece por completo; cero marcadores sin sustituir | **CITATION** (D-12) | `grep -c 'nyquist_compliant: true' .../72-VALIDATION.md` = 1 + `grep -c 'pytest'` = 0 + una fila por HYG-01..08 | ✅ existe | ⬜ pending |
| 85-05-01 | 85-05 | 2 | DEBT-07, NYQ-01, NYQ-02 | T-85-05-04 | Ningún ítem diferido sin trigger; OQ-1 enlazado a format-isolation transitivo | **doc / source-assert** | `test -f .../deferred-items.md` + `grep -c 'Trigger'` ≠ 0 + `grep -c 'R-82-01'` ≠ 0 | ➕ se crea | ⬜ pending |
| 85-05-02 | 85-05 | 2 | DEBT-05, DEBT-06, DEBT-07, NYQ-01, NYQ-02 | T-85-05-01, T-85-05-02, T-85-05-03 | Se cierra solo lo saldado; la fila de format-isolation transitivo sigue ABIERTA; mutación vía `gsd-tools` | **doc / source-assert** | `grep -c '\[x\] \*\*DEBT-05\*\*' .planning/REQUIREMENTS.md` = 1 + `grep -c 'format-isolation transitivo' .planning/STATE.md` ≠ 0 + `gsd-tools query state.validate` | ✅ existen | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Reparto CITATION vs NEW-test (fijado por CONTEXT.md + RESEARCH.md §Validation Architecture):**

- **Cobertura automatizada NUEVA:** solo `85-01-02/03` (DEBT-06) y `85-02-01/02/03` (DEBT-07) — 4 `it()` nuevos repartidos en 3 ficheros de test **existentes** (`dashboard-select`, `check`, `check-isolation`). Cero ficheros de test nuevos.
- **Cobertura por CITA a evidencia existente:** `85-01-01` (DEBT-05, D-03) y los seis backfills de `85-03`/`85-04` (NYQ-01/02, D-12).
- **Manual-only:** la corrección del comentario de WR-03(a) y la verificación de mordida del guard de WR-03(b).

**Reparto de cobertura fijado por CONTEXT.md + RESEARCH.md §Validation Architecture:**

| Requirement | Cobertura |
|---|---|
| DEBT-05 | **CITATION** — cero tests nuevos (D-03). Cita a `test/state/handoff-state.test.js:265` (CLEAR) / `:288` (PRESERVE) / `:307` (OVERWRITE). Backstop: suite verde sin tocar tests. |
| DEBT-06 | **unit NUEVO** en `test/dashboard-select.test.js` (RED antes del fix) + los 8 asserts LIVE-05 existentes verdes **sin tocarlos** + guard `test/format-isolation.test.js` sin modificar (D-18). |
| DEBT-07 / WR-01+WR-02 | **unit NUEVO** en `test/check.test.js` (un `it()` cubre ambos). |
| DEBT-07 / WR-03 (a) | **manual-only** — un comentario no es testeable; evidencia = diff + cita a `src/providers/registry.js:27,28,57,58`. |
| DEBT-07 / WR-03 (b) | **unit NUEVO (guard)** en `test/check-isolation.test.js`; `walkImports` **no se modifica**. |
| NYQ-01 / NYQ-02 | **CITATION** — cero tests nuevos (D-12). Verificación = frontmatter resultante de los 6 `VALIDATION.md`. |

---

## Trazabilidad del edge probe (spec-less fallback)

La fase **no tiene SPEC.md**, así que `## Edge Coverage` y `## Prohibitions` estaban ausentes y disparó el fallback determinista (`EDGE_ABSENT=1`, `PROHIB_ABSENT=1`, `workflow.specless_probe_fallback` activo). El motor `edge-probe.cjs` corrió sobre los 5 textos de requisito y devolvió **10 edges aplicables · 0 resueltos por el motor**. El orquestador los resolvió bajo las reglas `--auto` (auto-`covered` cuando existe criterio defendible; `unclassified` se queda `unresolved` y **nunca** se auto-backstopea). Igualdad sin-pérdidas: **10 = 8 autorados + 2 supuestos marcados**.

| ID | Req | Categoría | Estado | Dónde aterriza |
|----|-----|-----------|--------|----------------|
| E1 | DEBT-05 | empty | covered | `85-01-PLAN.md` `must_haves.truths` — los 3 estados por presencia, trazables a `handoff-state.test.js:307/265/288` |
| E2 | DEBT-05 | encoding | covered | `85-01-PLAN.md` — doc-only: sin regla nueva de longitud/igualdad; truncado a 200 de Phase 74 intacto |
| E3 | DEBT-07 | adjacency | covered | `85-02-PLAN.md` — ambas líneas coexisten (`logFn`/stdout + `errorFn`/stderr); orden **entre** canales no contractual |
| E4 | DEBT-07 | empty | covered | `85-02-PLAN.md` — `errors` vacío/ausente ⇒ ninguna línea `fallida`, nunca throw (rama de silencio con assert propio) |
| E5 | DEBT-07 | ordering | covered | `85-02-PLAN.md` — la línea de fallos va tras `aplicadas` y antes de `hasAdvisories`; orden intra-canal determinista |
| E6 | NYQ-02 | adjacency | covered | `85-04-PLAN.md` — veredicto por fase e independiente; ninguna hereda el de otra (D-17) |
| E7 | NYQ-02 | empty | covered | `85-04-PLAN.md` — sin evidencia citable ⇒ manual-only o `false` con razón; nunca `true` sin cita |
| E8 | NYQ-02 | ordering | covered | `85-04-PLAN.md` — orden 79→80→81→69→71→72 (D-16), resultado independiente del orden |
| A1 | DEBT-06 | unclassified | **unresolved** | `85-01-PLAN.md` §Supuestos declarados del planner — revisión manual; la cobertura real la fija D-06 |
| A2 | NYQ-01 | unclassified | **unresolved** | `85-03-PLAN.md` §Supuestos declarados del planner — requisito documental sin superficie ejecutable propia |

*(Las etiquetas `E1`–`E8` / `A1`–`A2` las asigna esta tabla; el motor emite filas sin ID. `85-RESEARCH.md` numera sus hallazgos como «Sonda 1–6», eje distinto — no hay correspondencia 1:1 entre ambas numeraciones y no debe buscarse.)*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — `node:test` nativo, los 3 ficheros de test a extender ya existen, cero deps npm nuevas (constraint LOCKED).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| El comentario de `test/check-isolation.test.js` deja de afirmar la premisa falsa | DEBT-07 / WR-03 (a) | Un comentario no es ejecutable | Inspección del diff en el SUMMARY, citando los `await import()` reales de `src/providers/registry.js:27,28,57,58` |
| El guard reforzado tiene mordida real | DEBT-07 / WR-03 (b) | Probar que un guard falla exige romperlo temporalmente | Insertar `await import('../logger.js')` en un fichero del grafo de `check.js`, comprobar ROJO, revertir |
| Las 6 fases del backfill quedan con `nyquist_compliant: true` defendible por cita | NYQ-01, NYQ-02 | La evidencia es documental (VERIFICATION/SUMMARY/UAT ya en disco), no una corrida | `grep -c "nyquist_compliant: true"` sobre los 6 ficheros + revisión de que cada dimensión cite fichero + resultado concreto |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or están declaradas CITATION/manual-only con su razón
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (ninguna — infra nativa suficiente)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
