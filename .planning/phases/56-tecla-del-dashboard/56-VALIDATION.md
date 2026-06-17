---
phase: 56
slug: tecla-del-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-17
---

# Phase 56 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node 20+) |
| **Config file** | none — `node --test` discovers `test/**/*.test.js` |
| **Quick run command** | `node --test test/cli/dashboard/` |
| **Full suite command** | `node --test` |
| **Estimated runtime** | ~24 seconds (full suite, ~1385 cases) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/cli/dashboard/`
- **After every plan wave:** Run `node --test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | DETECT-02 | T-56-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Planner fills this map (Dimension 8) — one row per task, keyed to DETECT-02.*

---

## Wave 0 Requirements

- [ ] Test fakes for `execFile` (inject, never touch real child_process) — mold of `test/cli/dashboard/open.test.js` / `focus.test.js`
- [ ] Host stub returning `AgentSurface[]` — reuse `test/host/contract.test.js` fixtures (`surface-resume-show.json`) or a minimal in-line stub
- [ ] `drain()` helper (~80ms) for ink async-handler tests (Pitfall 1) — NOT `setImmediate`

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tecla `a` → discover → picker → double-confirm → `kodo adopt` shelled, fila aparece en el próximo `/status` | DETECT-02 | Requiere una sesión claude ad-hoc viva en cmux + un TTY real; el shell de `kodo adopt` muta `state.json` y el provider | Lanzar `kodo dashboard` con una sesión ad-hoc no trackeada; pulsar `a`; verificar el picker, el double-confirm, el footer verde, y que la sesión aparece trackeada |

*Planner refina; el double-confirm destructivo (espejo Phase 42) probablemente requiere HUMAN-UAT como dismiss.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
