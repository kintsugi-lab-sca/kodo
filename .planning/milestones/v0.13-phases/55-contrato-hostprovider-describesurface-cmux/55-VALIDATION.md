---
phase: 55
slug: contrato-hostprovider-describesurface-cmux
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-16
audited: 2026-06-24
---

# Phase 55 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node 20+) |
| **Config file** | none — `package.json` test script + `node --test` |
| **Quick run command** | `node --test test/host/contract.test.js test/host/cmux-isolation.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~2s (host dir) / full suite |

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
| 55-01-01 | 01 | 1 | DETECT-01 (fixture) | — | Fixtures `surface-resume-show.json` + `surface-tree.json` congelados de cmux 0.64.16; ruteo por `--surface <ref>` en `fakeExecFromFixtures` | unit (fixture) | `node --test test/host/contract.test.js` | ✅ | ✅ green |
| 55-01-02 | 01 | 1 | DETECT-01 (enum + normalize) | T-55-01 | 2-step enum (`tree` → fan-out `surface resume show`); `normalizeSurface` mapea 4 campos exactos (`workspaceRef`/`cwd`/`sessionId`/`kind`); asserts campo-a-campo contra UUID real | unit | `node --test test/host/contract.test.js` | ✅ | ✅ green |
| 55-01-03 | 01 | 1 | DETECT-01 (fail-open) | T-55-01 / cmux output trust | never-throws fila-a-fila: `cleared:true` (incl. truthy no-boolean WR-02), sin `resume_binding`, `source!=agent-hook`, tree exec fail → `[]`, surface show individual fail → skip; validación de 4 string fields (WR-01) | unit | `node --test test/host/contract.test.js` | ✅ | ✅ green |
| 55-01-04 | 01 | 1 | DETECT-01 (typeof + isolation) | — | `listAgentSurfaces` FUERA de HOST_METHODS (frozen at 4); NullHost no lo implementa (typeof-degradación); adopt.js/reconcile.js host-agnósticos (walker cmux-isolation) | unit | `node --test test/host/cmux-isolation.test.js` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/fixtures/cmux/surface-resume-show.json` — salida cruda de cmux 0.64.16, 1 adoptable (`source=agent-hook`, `cleared=false`, `kind=claude`) + 3 casos fallo (`cleared:true`, `resume_binding:null`, `source=environment`)
- [x] `test/fixtures/cmux/surface-tree.json` — salida cruda de `cmux tree --all --json` con 4 surface_refs
- [x] Extensión de `fakeExecFromFixtures` en `test/host/contract.test.js` — ruteo `surface resume show` / `tree` por argv

*Existing infrastructure (node:test, contract matrix, `run` DI, cmux-isolation walker) cubre el resto.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Salida real de cmux 0.64.16 coincide con la fixture congelada | DETECT-01 (a) | Requiere el binario cmux real + ≥1 sesión claude viva | ✅ Captura única hecha al construir la fixture (anotada `0.64.16 (96) [5321becb6]`). NO recurrente — el `run` DI valida el shape congelado en cada corrida. El UAT live de Phase 56 (adopción end-to-end vía dashboard) ejercitó el path completo `listAgentSurfaces() → cmux real`. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-24

---

## Validation Audit 2026-06-24

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 (pre-existing coverage) |
| Escalated to manual-only | 0 (fixture capture single-shot, ya hecha; UAT live cubierto por Phase 56) |
| Requirements covered | 1/1 (DETECT-01, íntegro: enum + normalize + fail-open + typeof + isolation) |
| Tests run | 38 pass / 0 fail (contract.test.js × 34 + cmux-isolation × 4) |
