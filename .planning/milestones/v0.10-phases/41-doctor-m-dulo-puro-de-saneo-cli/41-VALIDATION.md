---
phase: 41
slug: doctor-m-dulo-puro-de-saneo-cli
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-10
---

# Phase 41 — Validation Strategy

> Per-phase validation contract reconstruido retroactivamente (backfill Nyquist Phase 47, NYQ-01).
> Cobertura **citada** de `41-VERIFICATION.md` (passed 9/9 must-haves) + los 3 SUMMARY de plan.
> **Sin re-ejecutar la suite** — cada dimensión referencia el resultado empírico ya registrado.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (native) + `node:assert/strict` |
| **Config file** | none — runner nativo, sin config externa |
| **Quick run command** | `node --test test/gsd-doctor.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Evidencia citada** | `41-VERIFICATION.md` (2026-06-04, status passed, score 9/9) |

---

## Sampling Rate

- **Evidencia primaria:** `41-VERIFICATION.md` — verificación inicial passed, 9/9 observable truths + 7/7 artifacts + 6/6 key-links verificados.
- **Política Nyquist (backfill):** la cobertura ES la cita a la evidencia preexistente; no se re-corre la suite (D-03 / D-05).
- **UAT humano bloqueante:** completado durante la ejecución (Plan 03, Task 2) — 18/18 aserciones en sandbox aislado `/tmp/kodo-doctor-uat.sh`.

---

## Per-Task Verification Map (dimensión → cobertura citada)

| Requirement | Plan | Dimensión / Secure Behavior | Test Type | Automated Command | Evidencia citada (fichero + resultado) | Status |
|-------------|------|-----------------------------|-----------|-------------------|----------------------------------------|--------|
| DOCTOR-01 | 41-03 | `kodo gsd doctor` (sin flags) detecta y reporta las 4 categorías en dry-run sin mutar nada | unit (CLI) | `node --test test/gsd-doctor-cli.test.js` | `41-VERIFICATION.md` Behavioral Spot-Checks → **13 pass / 0 fail**; Observable Truth #1 (scan-only cuando `opts.fix` falsy) ✓ VERIFIED | ✅ green |
| DOCTOR-02 | 41-02 | `--fix` re-chequea liveness ANTES de cada acción destructiva; reusa `git worktree remove/prune`; nunca `rm -rf`; nunca toca recurso vivo | unit (DI hermética) | `node --test test/gsd-doctor.test.js` | `41-VERIFICATION.md` Truths #2/#5/#8 ✓ VERIFIED (`isSessionLive` líneas 493/547/573; `rm -rf`=0; `--force` ausente); Spot-Check **20 pass / 0 fail** | ✅ green |
| DOCTOR-03 | 41-03 | Output agrupado por categoría; exit code determinista 0=limpio / 1=basura; `protected` no afecta el exit | unit (CLI) | `node --test test/gsd-doctor-cli.test.js` | `41-VERIFICATION.md` Truths #3/#4 ✓ VERIFIED (`exitCode = report.hasGarbage ? 1 : 0`; `--json` byte-determinista) | ✅ green |
| DOCTOR-04 | 41-01 / 41-02 | Módulo puro `src/gsd/doctor.js` (DI + never-throws) reusable por CLI y dismiss — una sola fuente de saneo | unit (helper + módulo) | `node --test test/worktree-cleanup.test.js test/gsd-doctor.test.js` | `41-VERIFICATION.md` Truths #5/#6/#7 ✓ VERIFIED (`scan`+`execute` exportados; LOG-12 preservado; cero `worktree list`); `worktree-cleanup` **10 pass / 0 fail** | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky / manual-only*

---

## Wave 0 Requirements

Infraestructura existente (`node:test` nativo) cubre todos los requirements. Sin framework install, sin fixture compartido: los tests viven junto a cada módulo con DI (mocks/spies inyectados), escritos TDD-first dentro de cada plan (ver 41-0{1,2,3}-SUMMARY.md).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Evidencia |
|----------|-------------|------------|-----------|
| `--fix` destructivo real (worktrees huérfanos, locks colgados, logs viejos) sin tocar jamás recursos vivos ni `.claude/worktrees` foráneos | DOCTOR-02 | El borrado real de worktree/lock/log + el re-check de liveness sobre el filesystem real no es demostrable solo con mocks. | UAT humano bloqueante (Plan 03 Task 2): **18/18 aserciones** en sandbox `/tmp/kodo-doctor-uat.sh`, incluidos #3 (foreign `.claude/worktrees` jamás reportado) y #4/#5 (worktree/lock/log de sesión VIVA intactos tras `--fix`). El gap `gitFn`/`logger` ausentes en `resolveDeps` lo capturó este UAT (commit `1a8e80d`) — ver `41-VERIFICATION.md` §Gaps Summary. |

---

## Validation Sign-Off

- [x] Cada requirement (DOCTOR-01..04) mapeado a ≥1 cita de evidencia real en `41-VERIFICATION.md`
- [x] Continuidad de sampling: cobertura automatizada verde para las 4 dimensiones de riesgo
- [x] Wave 0 cubre todas las referencias MISSING (ninguna — infra nativa suficiente)
- [x] Sin watch-mode flags
- [x] Ninguna fase declarada N/A — evidencia empírica real citada
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-10 (backfill Phase 47, NYQ-01)

---

## Reconstruction Audit 2026-06-10 (Phase 47 NYQ-01)

| Metric | Count |
|--------|-------|
| Requirements audited | 4 (DOCTOR-01..04) |
| COVERED (automated unit) | 4 |
| PARTIAL | 0 |
| MISSING | 0 |
| Manual-only (by design, complementario) | 1 (`--fix` destructivo, UAT firmado) |
| Tests citados (no re-corridos) | 43 pass / 0 fail (10 worktree-cleanup + 20 doctor + 13 doctor-cli) |

**Nota Nyquist:** La lógica de riesgo de la fase (re-check de liveness, fail-open never-throws, scope por `taskId`, invariante "jamás tocar recurso vivo", LOG-12, cero `rm -rf`/`worktree list`) está cubierta por tests unitarios deterministas con DI, ya verde y verificada en `41-VERIFICATION.md` (passed 9/9). **Sin re-ejecutar la suite** — cobertura citada de `41-VERIFICATION.md` + 41-0{1,2,3}-SUMMARY.md. Fase declarada **nyquist-compliant**.
