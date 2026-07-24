---
phase: 79
slug: sidebar-doctor
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-23
---

# Phase 79 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in runner, `node --test`) |
| **Config file** | none — convención repo: ficheros `test/*.test.js` |
| **Quick run command** | `node --test test/sidebar-doctor*.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 s (quick) / ~60 s (full, ~2309 tests) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/sidebar-doctor*.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (se rellena al crear los PLAN.md) | — | — | SDR-01..06 | — | — | unit | `node --test test/sidebar-doctor*.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/sidebar-doctor.test.js` — stubs para scan/execute (SDR-01, SDR-03, SDR-05)
- [ ] `test/sidebar-doctor-cli.test.js` — stubs para dry-run/`--fix`/`--json`/exit codes (SDR-01, SDR-06)
- [ ] `test/sidebar-doctor-hygiene.test.js` — guard source-hygiene anti-`workspace-group delete` (SDR-02) + golden launch path intacto (SDR-04)

*Infraestructura existente (node:test) cubre el resto; no hay framework que instalar.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Convergencia real en GUI cmux tras `--fix` (sesión suelta → agrupada) | SDR-05 | Muta el sidebar del operador; los verbos mutantes de cmux no se ejecutan en tests | Con ≥1 sesión kodo suelta: `kodo sidebar doctor` (ver acción `add` listada) → `kodo sidebar doctor --fix` → `cmux workspace-group list --json` muestra el workspace en `member_workspace_refs` del grupo esperado |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
