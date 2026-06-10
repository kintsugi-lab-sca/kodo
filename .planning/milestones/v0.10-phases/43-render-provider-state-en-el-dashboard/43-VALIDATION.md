---
phase: 43
slug: render-provider-state-en-el-dashboard
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-10
---

# Phase 43 — Validation Strategy

> Per-phase validation contract reconstruido retroactivamente (backfill Nyquist Phase 47, NYQ-01).
> Cobertura **citada** de `43-VERIFICATION.md` (verified 10/10 must-haves) + `43-HUMAN-UAT.md` (status complete) + los 2 SUMMARY de plan.
> **Sin re-ejecutar la suite** — cada dimensión referencia el resultado empírico ya registrado.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` · `ink-testing-library` para la TUI |
| **Config file** | none — runner nativo, sin config externa |
| **Quick run command** | `node --test test/dashboard-format.test.js test/dashboard-select.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Evidencia citada** | `43-VERIFICATION.md` (2026-06-08, status verified, score 10/10) + `43-HUMAN-UAT.md` (status complete) |

---

## Sampling Rate

- **Evidencia automated primaria:** `43-VERIFICATION.md` — 10/10 observable truths + 7/7 artifacts + 4/4 key-links verificados; suite confirmatoria **1203 pass / 0 fail / 1 skip**.
- **Evidencia humana/visual:** `43-HUMAN-UAT.md` — render en terminal real (columna `task`, filtro `ps:`, footer hint).
- **Política Nyquist (backfill):** la cobertura ES la cita a la evidencia preexistente; no se re-corre la suite (D-03 / D-05).

---

## Per-Task Verification Map (dimensión → cobertura citada)

| Requirement | Plan | Dimensión / Behavior | Test Type | Automated Command | Evidencia citada (fichero + resultado) | Status |
|-------------|------|----------------------|-----------|-------------------|----------------------------------------|--------|
| PSTATE-05 | 43-01 | Columna dedicada `task` entre `status` y `age`; `provider_state` verbatim; 3 reason-states (`—`/`?`/verbatim) distinguibles SIN color | unit (pure + ink) | `node --test test/dashboard-format.test.js test/dashboard-table.test.js` | `43-VERIFICATION.md` Truths #1–#5 ✓ VERIFIED (`COLS.task=12`, `taskCell` puro); 24/24 format + tabla verdes | ✅ green |
| PSTATE-06 | 43-02 | Filtro por prefijo dedicado `ps:` (eje separado de `s:`), substring case-insensitive `String.includes` anti-ReDoS; filas `null` nunca casan (D-09); footer documenta `ps:` | unit (select) | `node --test test/dashboard-select.test.js` | `43-VERIFICATION.md` Truths #6–#10 ✓ VERIFIED (rama `ps:` select.js:121; gate anti-ReDoS `grep -cE 'new RegExp\|.match(\|.test('`==0); 27/27 verdes | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky / manual-only*

---

## Wave 0 Requirements

Infraestructura existente cubre todos los requirements. El runner `node:test` + `ink-testing-library` ya presentes desde fases TUI previas. Sin Wave 0 — tests TDD-first dentro de cada plan (ver 43-0{1,2}-SUMMARY.md). Invariante color-isolation confirmado por `test/format-isolation.test.js` (8/8 verde, cero `picocolors` reales en `src/cli/dashboard/`).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Evidencia |
|----------|-------------|------------|-----------|
| Render visual de la columna `task` + filtro `ps:` end-to-end + footer hint en terminal real con sesiones activas | PSTATE-05, PSTATE-06 | El render ink en terminal real (anchos, alineación, truncado) y el camino `stdin → parseFilter → applyFilter → SessionTable → frame` (IN-01) no se ejercitan en el test runner. | `43-HUMAN-UAT.md` (status complete, 3 tests): filtro `ps:` ✓ pass (cierra IN-01), footer hint ✓ pass. El test 1 reportó `provider_state:'unknown'` — diagnosticado como **bug upstream de Phase 40** (mapeo `mapPlaneState`, la API de Plane no poblaba `state_detail`), NO un fallo del render de Phase 43; arreglado en commit **53d2220** y verificado en vivo (ROMAN-170/160 → `in_review`) per `43-VERIFICATION.md` frontmatter `human_verification_outcome`. El render era correcto desde el inicio. |

---

## Validation Sign-Off

- [x] Cada requirement (PSTATE-05, PSTATE-06) mapeado a ≥1 cita de evidencia real en `43-VERIFICATION.md`
- [x] Cobertura humana/visual citada de `43-HUMAN-UAT.md` (status complete)
- [x] Wave 0 cubre todas las referencias MISSING (ninguna — infra existente cubre todo)
- [x] Sin watch-mode flags
- [x] Ninguna fase declarada N/A — evidencia empírica real citada
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-10 (backfill Phase 47, NYQ-01)

---

## Reconstruction Audit 2026-06-10 (Phase 47 NYQ-01)

| Metric | Count |
|--------|-------|
| Requirements audited | 2 (PSTATE-05, PSTATE-06) |
| COVERED (automated unit) | 2 |
| PARTIAL | 0 |
| MISSING | 0 |
| Manual-only (by design, complementario) | 1 (render/ filtro/ footer en terminal real, UAT complete) |
| Tests citados (no re-corridos) | 1203 pass / 0 fail / 1 skip (suite confirmatoria de `43-VERIFICATION.md`) |

**Nota Nyquist:** La lógica de la fase (`taskCell` puro derivando los 3 reason-states sin color, filtro `ps:` substring anti-ReDoS como eje separado de `s:`, D-09 filas null) está cubierta por tests deterministas, ya verde y verificada en `43-VERIFICATION.md` (verified 10/10). El único gap del UAT (test 1) era defecto upstream de Phase 40, no del render de esta fase, y quedó resuelto (commit 53d2220). **Sin re-ejecutar la suite** — cobertura citada de `43-VERIFICATION.md` + `43-HUMAN-UAT.md` + 43-0{1,2}-SUMMARY.md. Fase declarada **nyquist-compliant**.
