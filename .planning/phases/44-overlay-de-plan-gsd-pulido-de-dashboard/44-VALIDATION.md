---
phase: 44
slug: overlay-de-plan-gsd-pulido-de-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-09
---

# Phase 44 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

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
| 44-01-* | 01 | 1 | PLAN-01 | — | Helper de lectura de plan never-throws (ENOENT→missing, EACCES→error); colapsa fallos a discriminante, jamás throw a React | unit | `node --test test/dashboard-plan.test.js` | ❌ W0 | ⬜ pending |
| 44-01-* | 01 | 1 | PLAN-02 | — | Overlay `p` distingue no-GSD / sin-PLAN.md / error; `Esc` preserva cursor por `task_id`; multi-PLAN.md concatenado | unit | `node --test test/dashboard-overlay.test.js` | ❌ W0 | ⬜ pending |
| 44-02-* | 02 | 2 | TUI-18 | — | `anyGsd` derivado puro sobre `sorted` (no filtrado); columna `phase/mode` no renderiza si `false`, reaparece con GSD | unit | `node --test test/dashboard-select.test.js test/dashboard-table.test.js` | ❌ W0 | ⬜ pending |
| 44-02-* | 02 | 2 | TUI-19 | — | Celda `state` marca `(zombie)`+rojo vía `statusColor` para `running`+`!alive`; header counter intacto; cero picocolors | unit | `node --test test/dashboard-table.test.js test/format-isolation.test.js` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/dashboard-plan.test.js` — stubs para el helper de lectura de plan (PLAN-01): glob por prefijo de fase, multi-PLAN.md, ENOENT→missing, EACCES→error, never-throws.
- [ ] `test/dashboard-overlay.test.js` — stubs para el overlay `p` (PLAN-02): copys por caso, `Esc` preserva cursor.
- [ ] Framework ya instalado (`node --test`) — sin instalación nueva.

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 40s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
