---
phase: 79
slug: sidebar-doctor
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-23
---

# Phase 79 — Validation Strategy

> Per-phase validation contract reconstruido retroactivamente (backfill Nyquist Phase 85, NYQ-01).
> Cobertura **citada** de `79-VERIFICATION.md` (passed 5/6 must-haves, re-verificación tras el cierre de G-79-1) + los 4 SUMMARY de plan.
> **Sin re-ejecutar la suite** — cada dimensión referencia el resultado empírico ya registrado.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in runner, `node --test`) |
| **Config file** | none — convención repo: ficheros `test/*.test.js` |
| **Quick run command** | `node --test test/sidebar-doctor-hygiene.test.js test/cmux/sidebar-doctor.test.js test/cli/sidebar-doctor-cli.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Estimated runtime** | ~5 s (quick) / ~60 s (full, ~2348 tests) |
| **Evidencia citada** | `79-VERIFICATION.md` (2026-07-23, status passed, score 5/6 must-haves, `behavior_unverified: 1`, `gaps_remaining: []`) + `79-UAT.md` (4/4 pass, G-79-1 `status: resolved`) |

---

## Sampling Rate

- **Evidencia primaria:** `79-VERIFICATION.md` — re-verificación tras el cierre del blocker G-79-1: 5/6 observable truths + 9/9 artifacts + 5/5 key-links verificados, `gaps_remaining: []`, `regressions: []`.
- **Política Nyquist (backfill):** la cobertura ES la cita a la evidencia preexistente; no se re-corre la suite (**D-12**).
- **UAT humano bloqueante:** `79-UAT.md` — **4/4 pass**, `status: complete`; el blocker G-79-1 del test 1 quedó `resolved` por el plan 79-04 y su verdad se re-verificó en vivo como test 4 (pass).

---

## Per-Task Verification Map (dimensión → cobertura citada)

| Requirement | Plan | Dimensión / Secure Behavior | Test Type | Automated Command | Evidencia citada (fichero + resultado) | Status |
|-------------|------|-----------------------------|-----------|-------------------|----------------------------------------|--------|
| SDR-01 | 79-02 / 79-03 / 79-04 | Dry-run por defecto: lista las 3 categorías clasificadas (`missing_group` = advisory, `loose_workspace` → `add`, `empty_group` → `ungroup`) **sin ejecutar nada**; veredicto de 3 estados (drift / advisory / clean) | unit (CLI) | `node --test test/cli/sidebar-doctor-cli.test.js` | `79-VERIFICATION.md` Truth #1 ✓ VERIFIED — Behavioral Spot-Checks → **15 pass / 0 fail** (el dry-run nunca llama a `executeFn`); `renderHuman`/`renderAdvisory` en `src/cli/sidebar-doctor.js:197`, veredicto en `:138-144`; corrida real read-only 2026-07-23 → `protected: 1 · ✓ clean`, exit 0 | ✅ green |
| SDR-02 | 79-01 / 79-02 / 79-04 | `--fix` ejecuta EXCLUSIVAMENTE el allowlist no-destructivo: `delete`/`remove`/`rename` de workspace-group NO están cableados, custodiado por guard source-hygiene con detector-no-trivial | unit (guard source-hygiene) | `node --test test/sidebar-doctor-hygiene.test.js` | `79-VERIFICATION.md` Truth #2 ✓ VERIFIED — Behavioral Spot-Checks → **17 pass / 0 fail**; `src/cmux/client.js` con los 4 passthroughs del allowlist + `listWorkspacesJson`, sin verbo destructivo | ✅ green |
| SDR-02 / SDR-05 | 79-04 | **G-79-1 (gap closure):** `execute()` NUNCA emite `create` ni `set-anchor` — cero absorción de identidad del anchor sobre una sesión kodo viva; `hasActions` excluye `missing_group`, que pasa a report-only | regression (spy de argv) | `node --test test/cmux/sidebar-doctor.test.js` | `79-VERIFICATION.md` Truth #6 ✓ VERIFIED — bucle `missing_group` **eliminado** de `execute()` (`src/cmux/sidebar-doctor.js:369-373` solo conserva el comentario explicativo); test de regresión dedicado con spy confirma `calls` vacío de `create`/`set-anchor`; **22 pass / 0 fail**; `79-UAT.md` gap `G-79-1` **`status: resolved`** | ✅ green |
| SDR-03 | 79-02 | Detección 100 % determinista y 0 tokens: `scan`/`execute`/`taskLikeFrom` puros y never-throws con DI; reutiliza `deriveExpectedGroupName`/`resolveWorkspaceGroup` VERBATIM; sin imports de provider/LLM/`logger.js` | unit (source assertion + fixtures) | `node --test test/cmux/sidebar-doctor.test.js` | `79-VERIFICATION.md` Truth #5 ✓ VERIFIED — la source assertion de ausencia de provider/LLM pasa; **22 pass / 0 fail**; `hasActions = loose+empty` (`:303`) y `hasAdvisories` (`:304`) confirmados por lectura directa | ✅ green |
| SDR-04 | 79-01 | Golden del launch path byte-idéntico: `--group` solo si el grupo ya existe, fail-open en 2 capas, GRP-01..03 intactos, el launch **nunca** gestiona grupos | regression (golden) | `node --test test/manager.test.js test/session/group-resolve.test.js` | `79-VERIFICATION.md` Truth #4 ✓ VERIFIED — `src/session/manager.js` sin ningún commit de la fase (`git log` confirma último touch en `e1bdb01`, Phase 78); Behavioral Spot-Checks → golden **pass / 0 fail** sin modificar los tests; 3 asserts SDR-04 de forma literal en `test/sidebar-doctor-hygiene.test.js` (**17 pass / 0 fail**) | ✅ green |
| SDR-05 | 79-02 / 79-04 | `loose_workspace` → `add` converge al grupo esperado que YA EXISTE (idempotencia + TOCTOU); round-trip completo vía el binario `kodo sidebar doctor --fix` contra un cmux vivo | unit (spy de argv) + manual (e2e) | `node --test test/cmux/sidebar-doctor.test.js` *(el round-trip real no tiene comando automatizable — muta el sidebar del operador)* | `79-VERIFICATION.md` Truth #3 ⚠️ PRESENT_BEHAVIOR_UNVERIFIED — el argv exacto que emite `execute()` está probado con spy y la convergencia `loose→add` / `empty→ungroup` + TOCTOU + idempotencia cubiertas: **22 pass / 0 fail**; el verbo crudo `cmux workspace-group add` validado en vivo en `79-UAT.md` A2 (**pass**). Ver §Manual-Only Verifications | ⚠️ manual-only |
| SDR-06 | 79-03 | CLI espejo de `gsd doctor`: `--json` byte-determinista (TTY / no-TTY idéntico, sin `\x1b[`, con `hasAdvisories` en el shape) y exit codes deterministas (`exitCode = report.hasActions ? 1 : 0`, calculado antes del render ⇒ advisory-only sale 0) | unit (CLI) | `node --test test/cli/sidebar-doctor-cli.test.js` | `79-VERIFICATION.md` Truth #5 ✓ VERIFIED — Behavioral Spot-Checks → **15 pass / 0 fail** (incluye advisory-only exit 0 y `hasAdvisories` en `--json`); `--json` real read-only 2026-07-23 con shape completo y exit 0 | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky / manual-only*

---

## Wave 0 Requirements

Los tres ficheros de scaffold que la Wave 0 declaraba (`test/sidebar-doctor-hygiene.test.js`, `test/cmux/sidebar-doctor.test.js` y `test/cli/sidebar-doctor-cli.test.js`) existen y están verdes según la evidencia citada — `79-VERIFICATION.md` §Required Artifacts los da por ✓ VERIFIED con 17 / 22 / 15 tests respectivamente, y ninguna dimensión del mapa depende de infraestructura ausente. Aun así, `wave_0_complete` se conserva en **`false`**: no existe en disco un registro de cierre formal de Wave 0 que el backfill pueda citar, y este plan no re-deriva evidencia que no está escrita (D-14 / D-17). El resto de la infraestructura es `node:test` nativo — sin framework que instalar.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Evidencia |
|----------|-------------|------------|-----------|
| Round-trip completo de `kodo sidebar doctor --fix` sobre una sesión kodo suelta **real** cuyo grupo esperado ya existe: el workspace aparece en `member_workspace_refs`, la 2ª pasada del dry-run sale exit 0, ningún workspace no-kodo se mueve (D-04) y ninguna sesión viva pierde fila/título | SDR-05 | Muta el sidebar cmux del operador: los verbos mutantes del allowlist no se ejecutan contra un binario cmux vivo en unit tests (solo DI / spy). El 2026-07-23, en el momento de la verificación, el sidebar del operador estaba limpio (`protected: 1`, 0 loose/missing/empty) y no había deriva real que ejercitar sin fabricar estado artificialmente desde una cadena autónoma. | **Evidencia parcial automatizada:** `79-VERIFICATION.md` Truth #3 — argv exacto probado con spy y convergencia cubierta a nivel unit (`test/cmux/sidebar-doctor.test.js`, **22 pass / 0 fail**). **Evidencia en vivo:** `79-UAT.md` test 2/A2 **result: pass** (verbo crudo `cmux workspace-group add` validado a mano) y test 4 **result: pass** — el operador ejercitó el round-trip completo vía el binario kodo con deriva real el 2026-07-23 (convergencia por `add`, 2ª pasada exit 0, sin absorción de identidad ni workspaces no-kodo tocados). **`STATE.md` §Deferred Items mantiene abierta la fila «Evidencia en vivo»** que agrupa este round-trip (79/SDR-05) con la convergencia ≤1 pase de 80/ORCH-07, pendiente de que aparezca deriva real sin fabricar estado — **la Phase 85 no la cierra**: este backfill solo la contabiliza como manual-only en el contrato de validación, no como hueco de cobertura. |

---

## Validation Sign-Off

- [x] Cada requirement (SDR-01..06) mapeado a ≥1 cita de evidencia real en `79-VERIFICATION.md`
- [x] Continuidad de sampling: cobertura automatizada verde para todas las dimensiones de riesgo (clasificación del dry-run, allowlist no-destructivo, ausencia de `create`/`set-anchor`, determinismo sin tokens, golden del launch path, `--json`/exit codes)
- [x] Wave 0 cubre todas las referencias MISSING (ninguna — los 3 ficheros de scaffold existen y están verdes; el flag se conserva en `false` por falta de registro citable, no por infraestructura ausente)
- [x] Sin watch-mode flags
- [x] Ninguna fase declarada N/A — evidencia empírica real citada
- [x] `nyquist_compliant` fijado a **true** en el frontmatter

**Approval:** validated 2026-07-27 (backfill Phase 85, NYQ-01)

---

## Reconstruction Audit 2026-07-27 (Phase 85 NYQ-01)

| Metric | Count |
|--------|-------|
| Requirements audited | 6 (SDR-01..06) |
| COVERED (automated unit) | 5 (SDR-01, SDR-02, SDR-03, SDR-04, SDR-06) |
| PARTIAL | 0 |
| MISSING | 0 |
| Manual-only (by design) | 1 (SDR-05: round-trip real vía el binario kodo contra un cmux vivo; el argv y la convergencia sí cubiertos a nivel unit, el verbo crudo validado en UAT) |
| Tests citados (no re-corridos) | **54 pass / 0 fail** (17 sidebar-doctor-hygiene + 22 cmux/sidebar-doctor + 15 cli/sidebar-doctor-cli) más los golden preexistentes `manager.test.js` / `session/group-resolve.test.js` / `host/cmux-isolation.test.js` verdes, sobre suite completa **2348 pass / 0 fail**, 1 skip pre-existente |

**Nota Nyquist:** La lógica de riesgo de la fase (clasificación determinista sin tokens, allowlist no-destructivo custodiado por guard source-hygiene, ausencia total de `create`/`set-anchor` tras el cierre de G-79-1, golden del launch path intacto por no-diff de `src/session/manager.js`, `--json` byte-determinista y exit codes calculados antes del render) está cubierta por 54 tests unitarios deterministas con DI y spy de argv, ya verdes y verificados en `79-VERIFICATION.md` (passed 5/6, `gaps_remaining: []`, `regressions: []`). El único `behavior_unverified` —el round-trip de `--fix` contra un cmux vivo— es manual **por naturaleza** (muta el sidebar real del operador), no un hueco de sampling: el precedente `41-VALIDATION.md` ya declara nyquist-compliant una fase con una fila Manual-Only, y aquí la fila llega además con evidencia humana de respaldo (`79-UAT.md` 4/4 pass). Esa fila sigue abierta en `STATE.md` §Deferred Items y esta fase **no la cierra**. **Sin re-ejecutar la suite** — cobertura citada de `79-VERIFICATION.md` + 79-0{1,2,3,4}-SUMMARY.md + `79-UAT.md`. Fase declarada **nyquist-compliant**.
