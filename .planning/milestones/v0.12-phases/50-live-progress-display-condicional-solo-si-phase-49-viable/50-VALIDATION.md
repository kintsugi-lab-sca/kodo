---
phase: 50
slug: live-progress-display-condicional-solo-si-phase-49-viable
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-12
---

# Phase 50 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (node:test builtin) — el repo corre `npm test` con ~900 tests |
| **Config file** | none — tests en `test/*.test.js`, descubiertos por el runner |
| **Quick run command** | `node --test test/task-progress.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~quick <2s · suite completa ~decenas de s (cero fail exigido) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/<archivo-tocado>.test.js`
- **After every plan wave:** Run `npm test` (suite completa — cero regresiones, el repo exige 0 fail)
- **Before `/gsd:verify-work`:** `npm test` verde + confirmación A2 documentada
- **Max feedback latency:** ~2s (quick) — suite completa por wave

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 50-01 (A2 gate) | 01 | 0 | A2 (gate) | — | `TaskCreate` dispara + sin latencia perceptible en worktree real | manual/empírico | instrumentación throwaway en `execute-phase` real | ❌ W0 | ⬜ pending |
| 50-cap-recount | cap | 1 | PROG-02 | T-50-traversal | hook recuenta tasks-dir → escribe artefacto correcto | unit | `node --test test/task-progress.test.js` | ❌ W0 | ⬜ pending |
| 50-cap-degraded | cap | 1 | PROG-02 | — | never-throws ante ENOENT / JSON corrupto / sin sesión | unit | `node --test test/task-progress.test.js` | ❌ W0 | ⬜ pending |
| 50-cap-install | cap | 1 | PROG-02 | — | install/uninstall registra/limpia `TaskCreated`/`TaskCompleted` sin clobber | unit | `node --test test/install.test.js` (extender) | ⚠️ existe | ⬜ pending |
| 50-disp-read | disp | 2 | PROG-03 | T-50-redos | `readProgress` mapea ok / no-progress / error | unit | `node --test test/progress.test.js` | ❌ W0 | ⬜ pending |
| 50-disp-cell | disp | 2 | PROG-03 | — | `progCell` formatea `N/M` / `N/M✓` / `—` / `?` | unit | `node --test test/format.test.js` (extender) | ⚠️ existe | ⬜ pending |
| 50-disp-derive | disp | 2 | PROG-03 | — | `deriveAnyProgress` sobre set sin filtrar | unit | `node --test test/select.test.js` (extender) | ⚠️ existe | ⬜ pending |
| 50-disp-isolation | disp | 2 | PROG-03 | — | columna `prog` no rompe color-isolation | unit | `node --test test/format-isolation.test.js` (walker, auto-cubre) | ✓ auto | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/task-progress.test.js` — hook: recuento correcto, filtrado de `.lock`/`.highwatermark`, never-throws, anti-traversal del `task_id`, status estricto `completed`
- [ ] `test/progress.test.js` — `readProgress` ok / no-progress / error + anti-ReDoS guard
- [ ] Extender `test/install.test.js` — registro/limpieza de los 2 eventos nuevos sin tocar SessionStart/Stop golden-bytes
- [ ] Extender `test/format.test.js` — `progCell` (4 estados) + `rowCells` incluye `prog`
- [ ] Extender `test/select.test.js` — `deriveAnyProgress` sobre set sin filtrar
- [ ] Fixtures compartidas: tasks-dir sintético (`N.json` con mix de status) + artefacto de progreso de muestra, con HOME isolation (mismo patrón `kodoProgressDir` / `homedirFn` que `readLightPlan`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `TaskCreate` dispara durante un `execute-phase` real en worktree (`cwd` = `.bg-shell/<sid>/`) SIN añadir latencia perceptible | A2 (gate D-01) | El spike disparó en primera persona en el orquestador; el disparo en worktree real no se re-midió y no es simulable con fidelidad — requiere un `claude --worktree` real | Instrumentar un `execute-phase` real, observar `~/.claude/tasks/<session_id>/` poblándose y el hook disparando; medir latencia con cuerpo mínimo + (si soportado) `async:true`. Documentar evidencia cruda. Si cero disparo → cortar vía PROG-F1 (D-02). |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s (quick)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
