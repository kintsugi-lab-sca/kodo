---
phase: 35
slug: datos-cliente-http-polling
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-27
---

# Phase 35 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in) + `node:assert/strict` + `ink-testing-library@4.0.0` (render) |
| **Config file** | none — `package.json` script `"test": "node --test $(find test -name '*.test.js' -type f)"` |
| **Quick run command** | `node --test test/dashboard-client.test.js test/dashboard-poll.test.js test/dashboard-status-line.test.js test/dashboard-baseurl.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5s (subconjunto de fase, todo DI; sin red ni TTY) |

---

## Sampling Rate

- **After every task commit:** Run el quick run command (subconjunto de la fase, < 5s)
- **After every plan wave:** Run `npm test` (suite completa, 895+ tests)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 35-01-01 | 01 | 1 | TUI-05/TUI-06 | T-35-01 | JSON corrupto/HTTP no-ok → `{ok:false}`, never-throws | unit (fake fetch) | `node --test test/dashboard-client.test.js` | ❌ W0 | ⬜ pending |
| 35-01-02 | 01 | 1 | TUI-05/TUI-06 | T-35-01 | `fetchStatus` colapsa los 4 fallos a `{ok:false}` sin throw | unit (fake fetch) | `node --test test/dashboard-client.test.js` | ❌ W0 | ⬜ pending |
| 35-04-01 | 04 | 1 | TUI-06 | T-35-08 | baseUrl con config v1 migrado → 9090, sin TypeError | unit (loadConfig fake) | `node --test test/dashboard-baseurl.test.js` | ❌ W0 | ⬜ pending |
| 35-04-02 | 04 | 1 | TUI-06 | T-35-08 / T-35-09 | guard WR-01 cierra TypeError; --url override preservado | unit (loadConfig fake) | `node --test test/dashboard-baseurl.test.js test/dashboard-non-tty.test.js` | ❌ W0 | ⬜ pending |
| 35-02-01 | 02 | 2 | TUI-05 | T-35-03 / T-35-04 | single-flight (`maxInFlight===1`); teardown limpia timer+abort | unit (fake clock+fetch) | `node --test test/dashboard-poll.test.js` | ❌ W0 | ⬜ pending |
| 35-02-02 | 02 | 2 | TUI-05 | T-35-03 / T-35-04 | recursive setTimeout, backoff 2.5→5→10 cap + reset, cleanup | unit (fake clock+fetch) | `node --test test/dashboard-poll.test.js` | ❌ W0 | ⬜ pending |
| 35-03-01 | 03 | 3 | TUI-06 | T-35-05 | keep-last-good (succeed×2-then-throw); JSON corrupto sin crash | ink-testing-library | `node --test test/dashboard-status-line.test.js` | ❌ W0 | ⬜ pending |
| 35-03-02 | 03 | 3 | TUI-06 | T-35-05 / T-35-06 | dos estados (waiting/stale/live); solo contador numérico (sin ANSI untrusted) | ink-testing-library | `node --test test/dashboard-status-line.test.js test/dashboard-render.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/dashboard-client.test.js` — TUI-05/06: `fetchStatus` ok/throw/JSON-corrupto/HTTP-no-ok/bad-shape → `{ok}` discriminant (Plan 01 Task 1)
- [ ] `test/dashboard-poll.test.js` — TUI-05: single-flight, backoff sube/resetea, teardown limpia timer+abort (Plan 02 Task 1)
- [ ] `test/dashboard-status-line.test.js` — TUI-06: keep-last-good (succeed×2-then-throw), dos estados (waiting/stale/live), JSON corrupto sin crash (Plan 03 Task 1)
- [ ] `test/dashboard-baseurl.test.js` — D-10/WR-01: config v1 migrado → fallback 9090 sin TypeError (Plan 04 Task 1)
- [ ] Framework install: ninguno — `node:test` + `ink-testing-library` ya disponibles (instalados Phase 34)

*Nota: el walker `test/format-isolation.test.js` (color-isolation) ya existe y cubre `src/cli/dashboard/**` automáticamente — NO requiere test nuevo (Open Question 3 del RESEARCH).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

*All phase behaviors have automated verification.* Los 4 comportamientos load-bearing (single-flight, keep-last-good, backoff, JSON-corrupto→poll-fallido) son directamente observables vía aserción con DI clock+fetch — cero flakiness, corren en CI sin server. La única superficie NO automatizable (raw-mode/TTY real) NO existe en esta fase (eso es Phase 37 attach). Esta fase es 100% automatizable (RESEARCH §Observabilidad Nyquist, líneas 466-473).

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (4 archivos de test nuevos, uno por plan)
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-27
