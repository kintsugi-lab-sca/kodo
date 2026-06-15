---
phase: 44
slug: overlay-de-plan-gsd-pulido-de-dashboard
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-09
---

# Phase 44 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Reconstructed retroactively (citation-based) from the existing 44-VERIFICATION.md (passed 10/10) during Phase 51 backfill (NYQ-03). No suite re-run — coverage is cited from the empirical evidence already on disk.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node --test`) + `node:assert/strict` |
| **Config file** | none — `package.json` `scripts.test` |
| **Quick run command** | `node --test test/dashboard-plan.test.js test/dashboard-select.test.js test/dashboard-table.test.js` (ajustar a los ficheros tocados; layout de test PLANO) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~20–40 seconds (full suite ~1200+ tests) |

---

## Sampling Rate

- **After every task commit:** Run the quick command sobre los ficheros de test del área tocada.
- **After every plan wave:** Run `npm test` (full suite must stay green — baseline 1213 pass + 1 skip).
- **Before `/gsd:verify-work`:** Full suite green + `test/format-isolation.test.js` verde (color isolation invariant).
- **Max feedback latency:** ~40 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 44-01-* | 01 | 1 | PLAN-01 | — | Helper de lectura de plan never-throws (ENOENT→missing, EACCES→error); colapsa fallos a discriminante, jamás throw a React | unit | `node --test test/dashboard-plan.test.js` | ✅ | ✅ green — `44-VERIFICATION.md` (passed 10/10): `dashboard-plan.test.js` 15 pass / 0 fail; Truth #4 never-throws VERIFIED |
| 44-01-* | 01 | 1 | PLAN-02 | — | Overlay `p` distingue no-GSD / sin-PLAN.md / error; `Esc` preserva cursor por `task_id`; multi-PLAN.md concatenado | unit | `node --test test/dashboard-overlay.test.js` | ✅ | ✅ green — `44-VERIFICATION.md` (passed 10/10): `dashboard-overlay.test.js` 16 pass / 0 fail; Truths #3/#5/#6 VERIFIED |
| 44-02-* | 02 | 2 | TUI-18 | — | `anyGsd` derivado puro sobre `sorted` (no filtrado); columna `phase/mode` no renderiza si `false`, reaparece con GSD | unit | `node --test test/dashboard-select.test.js test/dashboard-table.test.js` | ✅ | ✅ green — `44-VERIFICATION.md` (passed 10/10): `dashboard-select.test.js` 32 pass / 0 fail, `dashboard-table.test.js` 41 pass / 0 fail; Truths #7/#8 VERIFIED |
| 44-02-* | 02 | 2 | TUI-19 | — | Celda `state` marca `(zombie)`+rojo vía `statusColor` para `running`+`!alive`; header counter intacto; cero picocolors | unit | `node --test test/dashboard-table.test.js test/format-isolation.test.js` | ✅ | ✅ green — `44-VERIFICATION.md` (passed 10/10): `dashboard-table.test.js` 41 pass / 0 fail, `format-isolation.test.js` 8 pass / 0 fail; Truths #9/#10 VERIFIED |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **Citation note (Phase 51 / NYQ-03):** los estados ✅ green de arriba se citan de `44-VERIFICATION.md` (status: passed, score 10/10, verified 2026-06-09), no de una re-ejecución de la suite. Full suite en ese verify: `node --test` → 1245 pass / 1 skip / 0 fail. No hay `44-HUMAN-UAT.md` para esta fase — la verificación visual (overlay/columna/zombie) quedó cubierta por los ink render tests (`dashboard-table.test.js`, `dashboard-overlay.test.js`) según declara la sección _Human Verification Required_ del VERIFICATION. Ninguna dimensión marcada N/A.

---

## Wave 0 Requirements

- [x] `test/dashboard-plan.test.js` — stubs para el helper de lectura de plan (PLAN-01): glob por prefijo de fase, multi-PLAN.md, ENOENT→missing, EACCES→error, never-throws. **Resuelto:** 15 pass / 0 fail (`44-VERIFICATION.md` Behavioral Spot-Checks).
- [x] `test/dashboard-overlay.test.js` — stubs para el overlay `p` (PLAN-02): copys por caso, `Esc` preserva cursor. **Resuelto:** 16 pass / 0 fail (`44-VERIFICATION.md`).
- [x] Framework ya instalado (`node --test`) — sin instalación nueva.

*Las capas puras (`select.js`/`format.js`) ya tienen suites (`test/dashboard-select.test.js`, `test/dashboard-table.test.js`) que se extienden para TUI-18/19.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Overlay `p` se ve correcto en TTY real (scroll, congelado bajo poll, `Esc`) | PLAN-01/02 | Render ink en terminal interactiva no capturable en unit test | Lanzar `kodo dashboard` con una sesión GSD activa, pulsar `p`, scrollear, `Esc`, confirmar cursor preservado |
| Columna `phase/mode` desaparece/reaparece en vivo | TUI-18 | Transición visual en TTY | Con 0 sesiones GSD activas confirmar columna ausente; entrar una GSD y confirmar reaparición |
| Zombie por-fila rojo + `(zombie)` en columna `state` | TUI-19 | Color en TTY | Forzar una sesión `running`+`!alive`, confirmar marca roja por-fila |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 40s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (Phase 51 / NYQ-03 backfill, 2026-06-15)

---

## Reconstruction Audit 2026-06-15 (Phase 51 / NYQ-03)

| Metric | Count |
|--------|-------|
| Requirements audited | 4 (PLAN-01, PLAN-02, TUI-18, TUI-19) |
| COVERED (automated unit) | 4 |
| PARTIAL | 0 |
| MISSING | 0 |
| Manual-only (by design) | 0 (la verificación visual quedó cubierta por ink render tests) |
| Evidence cited | `44-VERIFICATION.md` (passed, score 10/10, 2026-06-09) |

**Nota Nyquist:** la cobertura de esta fase se reconstruye citando la evidencia empírica ya existente — `44-VERIFICATION.md` (status: passed, 10/10) con sus Behavioral Spot-Checks reales (`dashboard-plan.test.js` 15 pass, `dashboard-overlay.test.js` 16 pass, `dashboard-select.test.js` 32 pass, `dashboard-table.test.js` 41 pass, `format-isolation.test.js` 8 pass, full suite 1245 pass / 1 skip / 0 fail). **No se re-ejecutó la suite.** No hay `44-HUMAN-UAT.md`; la sección _Human Verification Required_ del VERIFICATION declara que el render visual queda cubierto por los ink render tests. Ninguna dimensión N/A. Fase declarada **nyquist-compliant**.
