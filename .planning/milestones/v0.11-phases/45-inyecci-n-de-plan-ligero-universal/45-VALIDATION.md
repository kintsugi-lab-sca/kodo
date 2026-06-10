---
phase: 45
slug: inyecci-n-de-plan-ligero-universal
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-10
---

# Phase 45 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (builtins) |
| **Config file** | none — `package.json` test script |
| **Quick run command** | `node --test test/session-start.test.js test/gsd-context.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~2 seconds (quick) |

**Baseline verificado:** `node --test test/session-start.test.js test/gsd-context.test.js` → 48 tests, 48 pass, 0 fail (2026-06-10).

---

## Sampling Rate

- **After every task commit:** Run `node --test test/session-start.test.js test/gsd-context.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~2 seconds

---

## Per-Task Verification Map

> Filled by the planner/nyquist-auditor once task IDs exist. Requirement→behavior map below is locked from RESEARCH.md.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 45-XX-XX | XX | 1 | PLAN-03 | — | `buildSessionContext` inyecta instrucción ES con ruta resuelta `~/.kodo/plans/<task_id>.md` | unit | `node --test test/session-start.test.js` | ✅ extend | ⬜ pending |
| 45-XX-XX | XX | 1 | PLAN-03 | — | Rama quick de `buildGsdContext` inyecta instrucción EN con ruta resuelta | unit | `node --test test/session-start.test.js` | ✅ extend | ⬜ pending |
| 45-XX-XX | XX | 1 | PLAN-03 (HOOK-02) | — | Ramas phase/bootstrap byte-idénticas (incl. bloque común "## No automatic push") | unit | `node --test test/gsd-context.test.js` | ✅ extend | ⬜ pending |
| 45-XX-XX | XX | 1 | PLAN-03 | — | Ruta inyectada absoluta/resuelta, no el literal `<task_id>` | unit | `node --test test/session-start.test.js` | ✅ extend | ⬜ pending |
| 45-XX-XX | XX | 1 | PLAN-03 (HOOK-03) | — | Idempotencia: re-emitir produce bytes idénticos | unit | `node --test test/session-start.test.js` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* La infra de test existe (`test/session-start.test.js`, `test/gsd-context.test.js`) con fixtures `makeSession`/`makeConfig` reusables y patrones de assert de golden-bytes ya establecidos. Solo hay que **añadir casos** — no crear Wave 0.

---

## Manual-Only Verifications

*All phase behaviors have automated verification.* El artefacto `~/.kodo/plans/<task_id>.md` lo escribe la sesión de Claude (D-03), fuera del alcance del unit test del builder; el contrato del builder (texto inyectado + ruta resuelta) sí es 100% testeable porque las funciones son puras.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
