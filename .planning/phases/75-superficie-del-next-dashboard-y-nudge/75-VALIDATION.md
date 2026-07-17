---
phase: 75
slug: superficie-del-next-dashboard-y-nudge
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-17
---

# Phase 75 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in runner, `node --test`) |
| **Config file** | none — `npm test` script in package.json |
| **Quick run command** | `node --test test/<target>.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (suite ~2130 tests) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/<target>.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 75-01-01 | 01 | 1 | LIVE-05 | T-75-04 / T-75-05 | readTasks never-throws → {} sobre ausente/corrupto/sin-tasks; nunca escribe, nunca loadState | unit | `node --test test/dashboard-tasks.test.js` | ❌ W0 | ⬜ pending |
| 75-01-02 | 01 | 1 | LIVE-05 | — | deriveAnyNext true solo con ≥1 next no vacío; nextCell '' sin dato (SC5) | unit | `node --test test/dashboard-select.test.js test/dashboard-format.test.js` | ✅ (extender) | ⬜ pending |
| 75-01-03 | 01 | 1 | LIVE-05 | T-75-01 | columna next condicional; enrich por task_id; next LLM saneado con stripControlChars antes de la celda | render | `node --test test/dashboard-table.test.js` | ✅ (extender) | ⬜ pending |
| 75-02-01 | 02 | 1 | LIVE-07 | — | buildStopNudgeText(session) byte-idéntico; (session,next) añade línea ES; pura (cero I/O) | unit | `node --test test/stop.test.js` | ✅ (extender) | ⬜ pending |
| 75-02-02 | 02 | 1 | LIVE-07 | T-75-06 / T-75-07 | nudge usa el NEXT: persistido post-asimetría; telemetría solo {task_id,reason}; cierre never-throws | unit | `node --test test/state/handoff-state.test.js test/hooks/session-end-handoff.test.js` | ✅ (extender) | ⬜ pending |
| 75-03-01 | 03 | 2 | LIVE-06 | T-75-03 | stripHandoffMarker indexOf/slice (anti-ReDoS); handoff.js CERO imports | unit+isolation | `node --test test/session/handoff.test.js test/check-isolation.test.js` | ✅ (extender) | ⬜ pending |
| 75-03-02 | 03 | 2 | LIVE-06 | T-75-02 | mini-renderer line-based; líneas del plan saneadas con stripControlChars; color solo por props ink | unit | `node --test test/dashboard-markdown.test.js test/format-isolation.test.js` | ❌ W0 | ⬜ pending |
| 75-03-03 | 03 | 2 | LIVE-06 | T-75-08 | render:'markdown' solo carril light; GSD byte-idéntico (SC3, no-regresión); Esc preserva cursor | render | `node --test test/dashboard-overlay.test.js test/dashboard-plan.test.js` | ✅ (extender) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/dashboard-tasks.test.js` — NUEVO (Plan 01, Task 1): cubre `readTasks` (LIVE-05) — ENOENT→{}, JSON corrupto→{}, sin clave `tasks`→{}, con `tasks`→el objeto; DI `kodoDir`/`readFileFn`/`homedirFn` para aislar HOME. Fixtures de `state.json` mínimos (con/sin `tasks`, corrupto).
- [ ] `test/dashboard-markdown.test.js` — NUEVO (Plan 03, Task 2): cubre `renderMarkdownLines` (LIVE-06) — heading strippeado+bold+cyan, **Label:** bold, bullet plano, fence dim con toggle, saneo stripControlChars, longitud del array == nº de líneas.
- Infra existente (node:test builtin) cubre el resto: `test/dashboard-select.test.js`, `test/dashboard-format.test.js`, `test/dashboard-table.test.js`, `test/stop.test.js`, `test/state/handoff-state.test.js`, `test/hooks/session-end-handoff.test.js`, `test/session/handoff.test.js`, `test/dashboard-overlay.test.js`, `test/dashboard-plan.test.js`, `test/check-isolation.test.js`, `test/format-isolation.test.js` (todos ✅, se extienden).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Legibilidad visual del plan ligero renderizado (headings/labels/bullets/fences se ven correctamente; marcador invisible) | LIVE-06 | El render best-effort line-based (NO CommonMark) es una decisión de fidelidad que solo el UAT humano puede confirmar como «suficiente» (RESEARCH A3, backstop) | En el dashboard, sobre una fila no-GSD con plan ligero, pulsar `p`; confirmar que el markdown se ve renderizado y read-only, el marcador `<!-- kodo:handoff … -->` no aparece, y `Esc` vuelve al mismo cursor |
| El nudge con contexto llega al workspace del orquestador con el `NEXT:` concreto | LIVE-07 | El envío por `cmux send` al workspace real del orquestador es un efecto de integración; el contenido se valida en `/gsd-verify-work` | Con una tarea que dejó un `NEXT:`, cerrar su sesión; confirmar en el workspace `kodo-orchestrator` que el nudge incluye la línea «Siguiente paso sugerido por la sesión: …» |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
