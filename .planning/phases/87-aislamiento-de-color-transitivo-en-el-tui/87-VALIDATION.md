---
phase: 87
slug: aislamiento-de-color-transitivo-en-el-tui
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-05
---

# Phase 87 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sembrado por `plan-phase` desde `87-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (built-in, Node ≥ 20) |
| **Config file** | ninguno — el runner se invoca por CLI |
| **Quick run command** | `node --test test/format-isolation.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~0.08 s (fichero objetivo) · ~24 s (suite completa) |
| **Baseline del fichero objetivo** | 8 tests / 5 suites / 0 fail (verificado 2026-08-05) |
| **Baseline de la suite** | 2589 tests / 588 suites / 1 skipped |

---

## Sampling Rate

- **After every task commit:** `node --test test/format-isolation.test.js` (≈76 ms) + el fichero de test tocado por la tarea
- **After every plan wave:** `node --test test/format-isolation.test.js test/manager.test.js test/dashboard-format.test.js test/dashboard-markdown.test.js test/format.test.js test/stop.test.js test/inbox-cli.test.js test/inbox-format-golden.test.js test/dashboard-table.test.js test/dashboard-inbox-count.test.js test/check-isolation.test.js` (los 11 ficheros con exposición medida)
- **Before `/gsd-verify-work`:** `npm test` completo verde
- **Max feedback latency:** 24 s (suite completa); 0.08 s por commit

**Nota de muestreo:** el fichero objetivo corre en 76 ms. No hay ninguna razón para no ejecutarlo en **todos** los commits de esta fase.

---

## Per-Task Verification Map

> Sembrado en `draft`: los `Task ID` se rellenan cuando `gsd-planner` escribe los PLAN.md.
> Cada fila ya tiene su comando automatizado resuelto y verificado en `87-RESEARCH.md`.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 1 | ISO-01 | — | Un fichero del TUI con cadena transitiva a `picocolors` pone el guard rojo | unit | `node --test test/format-isolation.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | ISO-01 | — | El mensaje de fallo imprime la **cadena**, no el conjunto | unit | `node --test test/format-isolation.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | ISO-01 | — | Un `import()` dinámico de `picocolors` en el grafo del TUI pone el guard rojo | unit (source-grep) | `node --test test/format-isolation.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | ISO-01 | — | **Mordida:** reintroducir `markdown.js:27` → rojo; revertir → verde | manual-only | evidencia citada en VERIFICATION (diff + salida roja + conteo) | manual | ⬜ pending |
| TBD | TBD | 2 | ISO-02 | — | Los 3 ficheros del TUI dejan de alcanzar `picocolors` | unit | `node --test test/format-isolation.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | ISO-02 | — | Cero imports de los saneadores desde `cli/format.js` | source-grep | `grep -rn "strip\(ControlChars\|ForKeystroke\)" src test \| grep "from.*cli/format"` → 0 hits | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | ISO-02 | — | El movimiento es byte-idéntico (bloque `format.js:60-123`) | source-diff | `diff` del bloque movido contra HEAD → vacío | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | ISO-02 | — | Cero regresión de comportamiento (criterio 5) | integration | `npm test` verde; conteos idénticos en los 5 ficheros de D-17 | ✅ existen | ⬜ pending |
| TBD | TBD | 1 | ISO-03 | — | `dashboard/format.js` tiene cero imports relativos y builtins ⊆ allowlist | unit | `node --test test/format-isolation.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | ISO-03 | — | Su clausura transitiva es exactamente 1 | unit | `node --test test/format-isolation.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | ISO-03 (D-14) | — | `select.js` sigue consumiendo `./format.js` (convergencia) | unit | `node --test test/format-isolation.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | ISO-04 | — | Los comentarios de `:14` y `:33` ya no afirman «el repo no lo usa» | source-grep | `grep -c "el repo no lo usa\|no los usa" test/format-isolation.test.js` → 0 | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | ISO-04 | — | `stripComments` corregido recupera los imports de los 3 ficheros cegados | unit (meta-test) | `node --test test/format-isolation.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | ISO-04 | — | La declaración honesta nombra el punto ciego residual con medición fechada | manual-only | inspección en VERIFICATION, cita de la sección | manual | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/format-isolation.test.js` — suite `ISO-01` transitiva (con reconstrucción de cadena) — cubre ISO-01/ISO-02
- [ ] `test/format-isolation.test.js` — test de `import()` dinámico + `stripComments` corregido — cubre ISO-01/ISO-04
- [ ] `test/format-isolation.test.js` — suite `ISO-03` (hoja + allowlist + clausura 1) y aserto de convergencia D-14 — cubre ISO-03
- [ ] `test/format-isolation.test.js` — cabecera reescrita (declaración honesta) — cubre ISO-04

**Sin instalación de framework:** `node:test` es built-in y la suite ya tiene 181 ficheros / 2589 tests.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Mordida del guard: reintroducir el leak de `markdown.js:27` pone el guard rojo; revertir lo pone verde | ISO-01 | D-15 prohíbe infraestructura de mutation testing en un milestone de saneo puro. Precedente: Phases 82, 83, 85 (WR-03), 86 (D-15) | 1. Añadir `import { stripControlChars } from '../format.js';` en `src/cli/dashboard/markdown.js`. 2. `node --test test/format-isolation.test.js` → rojo. 3. Copiar diff exacto + mensaje de fallo (con la cadena) + conteo al VERIFICATION. 4. Revertir. 5. Re-ejecutar → verde |
| La declaración honesta de `test/format-isolation.test.js` nombra el punto ciego residual (specifier computado) con su medición fechada, sin venderlo como cierre | ISO-04 | Revisión de prosa: ningún assert puede comprobar que un texto es honesto | Leer la cabecera reescrita; comprobar que (a) enumera qué cubre, (b) nombra `import(variable)` como no cubierto, (c) fecha la medición (0 casos a 2026-08-05), (d) no contiene «el repo no lo usa». Citar la sección en VERIFICATION |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 24s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
