---
phase: 81
slug: saneo-de-deuda-v0-17
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-24
---

# Phase 81 — Validation Strategy

> Per-phase validation contract reconstruido retroactivamente (backfill Nyquist Phase 85, NYQ-01).
> Cobertura **citada** de `81-VERIFICATION.md` (passed 26/26 must-haves) + los 3 SUMMARY de plan.
> **Sin re-ejecutar la suite** — cada dimensión referencia el resultado empírico ya registrado.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, `node --test`) |
| **Config file** | none — package.json `test` script |
| **Quick run command** | `node --test test/state/handoff-state.test.js test/dashboard-format.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Estimated runtime** | ~120 segundos (suite completa ~2364 tests) |
| **Evidencia citada** | `81-VERIFICATION.md` (2026-07-24, status passed, score 26/26 must-haves, `behavior_unverified: 0`) |

---

## Sampling Rate

- **Evidencia primaria:** `81-VERIFICATION.md` — verificación inicial passed, 26/26 observable truths + 10/10 artifacts + 5/5 key-links verificados, con `behavior_unverified: 0`.
- **Política Nyquist (backfill):** la cobertura ES la cita a la evidencia preexistente; no se re-corre la suite (**D-12**).
- **UAT humano bloqueante:** `81-UAT.md` — **1/1 pass**, `status: complete` (disposición explícita de WR-01/WR-02, ver §Manual-Only Verifications).

---

## Per-Task Verification Map (dimensión → cobertura citada)

| Requirement | Plan | Dimensión / Secure Behavior | Test Type | Automated Command | Evidencia citada (fichero + resultado) | Status |
|-------------|------|-----------------------------|-----------|-------------------|----------------------------------------|--------|
| DEBT-01 | 81-01 | Writer de 3 estados en `upsertTaskHandoff`: discriminación por PRESENCIA (`'next' in entry`), no por truthiness; `next` nunca logueado; merge bajo `withStateLock` | unit | `node --test test/state/handoff-state.test.js` | `81-VERIFICATION.md` Behavioral Spot-Checks → **24 pass / 0 fail**; Truths #1/#3/#4/#5 ✓ VERIFIED (`state.js:449-459`; `grep "entry.next ??"` en la línea de decisión → 0 matches) | ✅ green |
| DEBT-01 | 81-01 | Mapeo de autoría en el caller: rama LLM incluye `next` (puede borrar), backstop mecánico lo OMITE (preserva); `effectiveNext` post-merge alimenta el nudge LIVE-07 | unit | `node --test test/hooks/session-end-handoff.test.js test/hooks/session-end.test.js` | `81-VERIFICATION.md` Behavioral Spot-Checks → **53 pass / 0 fail**; Truths #2/#6/#7 ✓ VERIFIED (`session-end.js:410` spread condicional, `:420-422` `effectiveNext = upsertResult.value.next`) | ✅ green |
| DEBT-03 | 81-02 | `nextCell` colapsa `/\s+/g`→`' '` + trim en el render; celda `''` sin placeholder para ausente/null/no-string; el dato persistido queda VERBATIM (colapso render-only) | unit | `node --test test/dashboard-format.test.js` | `81-VERIFICATION.md` Behavioral Spot-Checks → **58 pass / 0 fail**; Truths #1/#2/#3/#4/#5/#8/#10/#11 ✓ VERIFIED (`format.js:262-263`; `App.js:756` sigue con solo `stripControlChars`) | ✅ green |
| DEBT-02 | 81-02 | Doc-drift Phase 75 (comentario `App.js:735` + typedef `overlaySnapshot` con `render?`): doc-only, cero-cambio de runtime — la prueba es la suite verde SIN modificar tests | regression | `node --test $(find test -name '*.test.js' -type f)` | `81-VERIFICATION.md` Behavioral Spot-Checks → suite completa **2364 pass / 0 fail** (1 skip pre-existente) sin tocar ningún test; Truths #6/#7/#13 (backstop) ✓ VERIFIED (`SessionTable.js:817` espeja `plan.js:48`) | ✅ green |
| DEBT-04 | 81-03 | Repro del flaky `gsd-lock-race` bajo carga con `src/gsd/lock.js` READ-ONLY: observación pura, cero remedios a ciegas, invariante "exactamente-uno-adquiere" order-independent | manual/loop | `for i in $(seq 1 50); do node --test test/gsd-lock-race.test.js \|\| break; done` | `81-VERIFICATION.md` Behavioral Spot-Checks → `node --test test/gsd-lock-race.test.js` **4 pass / 0 fail** en la corrida citada (flaky por diseño); Truths #1/#4 ✓ VERIFIED; `81-03-SUMMARY.md` §Key Evidence documenta 13/50 y 19/40 (~48%) fallos en loop aislado, todos N=5 | ⚠️ manual-only |
| DEBT-04 | 81-03 | Artefacto de diagnóstico `/gsd-debug` canónico + invariante de locks de v0.16 intacto (`lock.js` y harness sin diff) | guard + artifact | `test -f .planning/debug/gsd-lock-race-cr01.md && git diff --quiet -- src/gsd/lock.js` | `81-VERIFICATION.md` Behavioral Spot-Checks → `git diff --quiet -- src/gsd/lock.js; echo $?` → **`0`** y `git diff --quiet -- test/gsd-lock-race.test.js test/helpers/lock-race-child.mjs` → **`0`** (0 fail, cero `.skip`); Truths #2/#5/#6 ✓ VERIFIED | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky / manual-only*

---

## Wave 0 Requirements

Infraestructura existente (`node:test` nativo) cubre todos los requirements — sin framework install y sin fixture compartido: los tests se extienden in-place sobre ficheros que ya existían. Las dos confirmaciones de Wave 0 quedaron resueltas antes de ejecutar y así se conservan:

- [x] Path del test de `nextCell`/`format.js` del dashboard → `test/dashboard-format.test.js` (describe `nextCell` en `:509`) — CONFIRMADO
- [x] Test del hook `session-end` para el mapeo de autoría de DEBT-01 → `test/hooks/session-end.test.js` y `test/hooks/session-end-handoff.test.js` existen — CONFIRMADO

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Evidencia |
|----------|-------------|------------|-----------|
| Diagnóstico de causa raíz del flaky CR-01 (`stealLock` move-aside → O_EXCL-create no atómico) | DEBT-04 | El entregable es un artefacto de diagnóstico (`/gsd-debug`), no un test verde: el repro depende de carga y es no determinista por construcción, y greenear el test (skip/retry/timeout) está prohibido — enmascara una carrera real. | `81-VERIFICATION.md` Truths #1/#3/#5/#6 ✓ VERIFIED sobre `.planning/debug/gsd-lock-race-cr01.md` (traza de dos `FRESH_CREATE_WON` simultáneos, discriminador de hold 100/500/3000 ms → 65 % / ~48 % / 40 %). `src/gsd/lock.js` intacto (`git diff --quiet` → `0`). |
| Disposición de WR-01 (typedef `TaskHandoff`, `state.js:53`) y WR-02 (divergencia `deriveAnyNext` ↔ `nextCell`) — los 2 warnings del propio code review de la fase | DEBT-01 / DEBT-03 | Es un juicio de alcance y prioridad del mantenedor (¿esta fase de saneo cierra la deuda que su propia revisión encontró, o se difiere?), no una comprobación programática. La evidencia de ambos está confirmada y reproducida, no inferida. | `81-VERIFICATION.md` §Anti-Patterns (reproducido por ejecución directa: `deriveAnyNext([{next:'\n'}])` → `true` vs `nextCell({next:'\n'})` → `''`) + `81-UAT.md` test 1 **result: pass** (1/1, 0 issues): el operador difiere explícitamente con constancia escrita. **Ambos quedaron cerrados después por la Phase 85** (WR-01 en 85-01, WR-02 en 85-02) — esta fila queda como registro histórico de la decisión, no como deuda viva. |

---

## Validation Sign-Off

- [x] Cada requirement (DEBT-01..04) mapeado a ≥1 cita de evidencia real en `81-VERIFICATION.md`
- [x] Continuidad de sampling: cobertura automatizada verde para las dimensiones de riesgo (merge de 3 estados, mapeo de autoría, colapso de render, cero-cambio doc-only, invariante de locks)
- [x] Wave 0 cubre todas las referencias MISSING (ninguna — infra nativa suficiente, ambas confirmaciones resueltas)
- [x] Sin watch-mode flags
- [x] Ninguna fase declarada N/A — evidencia empírica real citada
- [x] `nyquist_compliant` fijado a **true** en el frontmatter

**Approval:** validated 2026-07-27 (backfill Phase 85, NYQ-01)

---

## Reconstruction Audit 2026-07-27 (Phase 85 NYQ-01)

| Metric | Count |
|--------|-------|
| Requirements audited | 4 (DEBT-01..04) |
| COVERED (automated unit) | 3 (DEBT-01, DEBT-02, DEBT-03) |
| PARTIAL | 0 |
| MISSING | 0 |
| Manual-only (by design) | 1 requirement (DEBT-04: el entregable es el diagnóstico, con su invariante `lock.js` READ-ONLY sí automatizado y verde) + 1 gate humano complementario (disposición WR-01/WR-02, `81-UAT.md` **1/1 pass**) |
| Tests citados (no re-corridos) | **135 pass / 0 fail** (24 handoff-state + 53 session-end + 58 dashboard-format), sobre suite completa **2364 pass / 0 fail**, 1 skip pre-existente |

**Nota Nyquist:** La lógica de riesgo de la fase (discriminación por presencia en el merge de `next`, autoría LLM vs backstop mecánico, valor post-merge hacia el nudge LIVE-07, colapso de whitespace render-only con dato persistido verbatim, y el invariante de locks de v0.16 protegido por `git diff --quiet`) está cubierta por tests unitarios deterministas, ya verde y verificada en `81-VERIFICATION.md` (passed 26/26, `behavior_unverified: 0`). El único item no automatizable —el diagnóstico del flaky CR-01— es manual **por diseño**, no un hueco de cobertura: su entregable es un artefacto de causa raíz reproducido, y greenear el test sería enmascarar una carrera real. **Sin re-ejecutar la suite** — cobertura citada de `81-VERIFICATION.md` + 81-0{1,2,3}-SUMMARY.md + `81-UAT.md`. Fase declarada **nyquist-compliant**.
