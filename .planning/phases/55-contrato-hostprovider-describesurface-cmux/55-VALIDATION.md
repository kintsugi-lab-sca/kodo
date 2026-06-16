---
phase: 55
slug: contrato-hostprovider-describesurface-cmux
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-16
---

# Phase 55 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node 20+) |
| **Config file** | none — `package.json` test script + `node --test` |
| **Quick run command** | `node --test test/host/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~2s (host dir) / ~30s (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/host/`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 55-01-01 | 01 | 1 | DETECT-01 | — | N/A | unit (fixture) | `node --test test/host/` | ❌ W0 (`test/fixtures/cmux/surface-resume-show.json`) | ⬜ pending |
| 55-01-02 | 01 | 1 | DETECT-01 | T-55-01 / cmux output trust | parseo never-throws de stdout no confiable de cmux | unit | `node --test test/host/` | ✅ | ⬜ pending |
| 55-01-03 | 01 | 1 | DETECT-01 | — | fail-open en exec/parse/socket error → `[]` | unit | `node --test test/host/` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/fixtures/cmux/surface-resume-show.json` — salida cruda real de cmux 0.64.16 (`surface resume show --json`), ≥1 surface adoptable (`source==agent-hook`, `cleared==false`, `kind==claude`) + casos de fallo (`cleared:true`, sin `resume_binding`, `source!=agent-hook`).
- [ ] `test/fixtures/cmux/tree.json` (o equivalente) — salida cruda de `cmux tree --all --json` para el paso de enumeración (lista de surfaces vivas), si la implementación final lo usa.
- [ ] Extensión de `fakeExecFromFixtures` en `test/host/contract.test.js` — rama nueva que enruta `surface resume show` / `tree` por argv.

*Existing infrastructure (node:test, contract matrix, `run` DI, cmux-isolation walker) cubre el resto.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Salida real de cmux 0.64.16 coincide con la fixture congelada | DETECT-01 (a) | Requiere el binario cmux real + ≥1 sesión claude viva | Ejecutar `cmux surface resume show --json` (y `cmux tree --all --json`) en una sesión claude viva; confirmar que el shape coincide con la fixture. Captura única al construir la fixture — no recurrente. |

*El resto de comportamientos (enumeración, normalización de campos, fail-open, typeof-detection) tienen verificación automatizada vía el `run` DI con fixtures.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
</content>
