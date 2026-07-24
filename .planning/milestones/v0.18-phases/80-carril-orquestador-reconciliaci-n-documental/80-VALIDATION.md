---
phase: 80
slug: carril-orquestador-reconciliaci-n-documental
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-23
---

# Phase 80 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in runner) |
| **Config file** | none — `npm test` ejecuta `node --test test/` |
| **Quick run command** | `node --test test/check-piggyback.test.js` (o el test del task actual) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (suite ~2347 tests) |

---

## Sampling Rate

- **After every task commit:** Run `node --test <test del task>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 80-01-01 | 01 | 1 | ORCH-07 | — | — | unit | `npm test` | ⬜ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*(Mapa por-task a rellenar por el planner/executor — seeded en draft por plan-phase.)*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements (node:test ya instalado; patrones de test de check.js y sidebar-doctor existentes).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Auditoría anti-deriva skill/prompt (checklist HYG-08) | ORCH-08 | Docs en prosa — sin verificación automática (D-11) | Cruzar features v0.17+79 ↔ contenido de skill.md/prompt.md en ambos sentidos |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
