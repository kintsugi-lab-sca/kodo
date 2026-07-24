---
phase: 82
slug: fix-de-la-carrera-de-steallock
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-24
---

# Phase 82 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in runner, `node --test`) |
| **Config file** | none — `npm test` runs `node --test test/` |
| **Quick run command** | `node --test test/gsd-lock-race.test.js test/gsd-lock.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds (quick) / ~90 seconds (full, 2364 tests) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/gsd-lock-race.test.js test/gsd-lock.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (seeded draft — el planner rellena este mapa con los task IDs reales) | | | LOCK-01..03 | | exactamente un stealer adquiere | integration | `node --test test/gsd-lock-race.test.js` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/gsd-lock-guard.test.js` — unit tests dirigidos de los estados del steal-guard (huérfano PID-muerto se rompe; guard vivo bloquea/re-contiende; lockPath ausente dentro del guard usa O_EXCL) vía API pública `acquireGsdLock` + seeding de ficheros

*El harness existente `test/gsd-lock-race.test.js` (CR-01) queda byte-idéntico — es el invariante ejecutable, no infraestructura nueva.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Verde determinista bajo carga real | LOCK-02 | El determinismo se evidencia con repetición bajo carga, no con una sola pasada CI | Loop ≥50× de `node --test test/gsd-lock-race.test.js` con la suite corriendo en paralelo; 0 fallos esperados (el repro original fallaba ~48%) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
