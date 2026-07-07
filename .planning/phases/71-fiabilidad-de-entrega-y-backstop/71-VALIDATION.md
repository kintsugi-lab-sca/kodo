---
phase: 71
slug: fiabilidad-de-entrega-y-backstop
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-07
---

# Phase 71 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) |
| **Config file** | none — package.json `test` script |
| **Quick run command** | `node --test test/triggers/polling.test.js test/adopt.test.js test/hooks/session-end.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30–60 seconds (full suite, 1885+ tests) |

---

## Sampling Rate

- **After every task commit:** Run the quick run command (targeted files for the requirement touched)
- **After every plan wave:** Run the full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD (planner fills) | — | — | DELIV-01 | T4 | Dispatch fallido/timeout NO avanza el cursor sobre ese issue; se reintenta | unit | `node --test test/triggers/polling.test.js` | ⬜ | ⬜ pending |
| TBD | — | — | DELIV-02 | — | Centinela distingue cache-ausente de primer-tick-observado; sin storm | unit | `node --test test/triggers/polling.test.js` | ⬜ | ⬜ pending |
| TBD | — | — | DELIV-03 | — | Re-run de adopt tras PERSIST_FAILED → un solo createTask | unit | `node --test test/adopt.test.js` | ⬜ | ⬜ pending |
| TBD | — | — | DELIV-04 | T5 | SessionEnd con tarea "In Progress" + cierre limpio → In Review + comentario | unit | `node --test test/hooks/session-end.test.js` | ⬜ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements* — `test/triggers/polling.test.js`, `test/adopt.test.js` y `test/hooks/session-end.test.js` ya existen con los helpers necesarios (`createTestClock`, DI de `addSession` throwing, `makeSession`); solo se añaden `it()` nuevos + un mock de provider con spies. El planner confirma las rutas exactas.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Backstop end-to-end contra Plane real | DELIV-04 | Requiere un provider Plane vivo + una sesión kodo real matada sin transición del LLM | Lanzar sesión kodo, matar la tab sin `/exit` limpio del LLM, verificar que al SessionEnd la tarea pasa a "In Review" con comentario "cierre automático" |

*El resto de comportamientos tienen verificación automatizada.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
