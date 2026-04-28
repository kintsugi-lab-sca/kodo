---
phase: 6
slug: structured-logger-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (Node.js built-in test runner) |
| **Config file** | none — ejecutado vía `node --test` |
| **Quick run command** | `node --test tests/logger*.test.js` |
| **Full suite command** | `node --test tests/` |
| **Estimated runtime** | ~5 segundos |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/logger*.test.js`
- **After every plan wave:** Run `node --test tests/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 segundos

---

## Per-Task Verification Map

*A completar por el planner al descomponer tareas. Cada tarea debe mapear a REQ-ID (LOG-01..LOG-04, LOG-08, LOG-12) y tener comando automatizado.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 0 | LOG-12 | — | Baseline startup measurable | harness | `node tests/startup-baseline.js` | ❌ W0 | ⬜ pending |
| 6-02-01 | 02 | 1 | LOG-01 | — | NDJSON factory emite formato esperado | unit | `node --test tests/logger.test.js` | ❌ W0 | ⬜ pending |
| 6-02-02 | 02 | 1 | LOG-02 | — | Espejado stderr en warn/error | unit | `node --test tests/logger.test.js` | ❌ W0 | ⬜ pending |
| 6-03-01 | 03 | 2 | LOG-08 | T-6-01 | Secretos redactados en disco y stderr | unit | `node --test tests/logger-redaction.test.js` | ❌ W0 | ⬜ pending |
| 6-04-01 | 04 | 3 | LOG-12 | — | check.js no importa logger transitivamente | graph | `node --test tests/check-isolation.test.js` | ❌ W0 | ⬜ pending |
| 6-04-02 | 04 | 3 | LOG-12 | — | Startup budget <50ms (o baseline*1.15) | perf | `node --test tests/startup-budget.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/logger.test.js` — stubs para LOG-01, LOG-02, LOG-03, LOG-04
- [ ] `tests/logger-redaction.test.js` — stubs para LOG-08
- [ ] `tests/check-isolation.test.js` — stub walker import-graph para LOG-12
- [ ] `tests/startup-budget.test.js` — stub benchmark para LOG-12
- [ ] `tests/startup-baseline.js` — helper medición baseline (no es test)
- [ ] `tests/helpers/logger-fixtures.js` — fixtures compartidas (tmpdir sessionId, lectura NDJSON)

---

## Manual-Only Verifications

*Ninguna. Todo el comportamiento de Phase 6 tiene verificación automatizada — el logger es una pieza puramente programática sin UI ni flujo humano.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
