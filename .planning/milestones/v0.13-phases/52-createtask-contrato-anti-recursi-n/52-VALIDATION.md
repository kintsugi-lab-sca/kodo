---
phase: 52
slug: createtask-contrato-anti-recursi-n
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-16
audited: 2026-06-24
---

# Phase 52 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node built-in test runner, no external deps) |
| **Config file** | none — `package.json` `test` script |
| **Quick run command** | `node --test test/labels.test.js test/labels-hygiene.test.js test/dispatcher.test.js test/providers/contract.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~130ms (targeted) · ~full suite 1500+ tests |

---

## Sampling Rate

- **After every task commit:** Run the targeted file via `node --test test/<file>`
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** segundos (suite rápida, sin red real — todo mockeado)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 52-01-01 | 01 | 1 | BIDIR-06 | T-52-01 | `isAdopted` truth-table + `KODO_LABEL_ADOPTED = 'kodo:adopted'` constant | unit | `node --test test/labels.test.js test/labels-hygiene.test.js` | ✅ | ✅ green |
| 52-01-02 | 01 | 1 | BIDIR-06 | T-52-01 | `isAdopted` cut en dispatcher antes de `--force` gate; `filterIdx < forceIdx` ordering | unit | `node --test test/dispatcher.test.js` | ✅ | ✅ green |
| 52-02-01 | 02 | 1 | BIDIR-01 | T-52-02 | `PlaneClient.createWorkItem` + `createLabel` exportados (transport layer) | smoke | `node -e "import('./src/providers/plane/client.js').then(m=>{if(!m.PlaneClient.prototype.createWorkItem)throw new Error('missing');console.log('OK')})"` | ✅ | ✅ green |
| 52-02-02 | 02 | 2 | BIDIR-01 | T-52-02 | `provider.createTask` typeof-detected fuera de FROZEN-9; label lookup-or-create; 201 → TaskItem canónico | unit | `node --test test/providers/contract.test.js` | ✅ | ✅ green |
| 52-02-03 | 02 | human | BIDIR-01 | T-52-02 D-07 | POST real contra Plane CE valida shape del 201 (`sequence_id`, `state`, etc.) | manual | *(D-07 checkpoint)* | N/A | ✅ resolved 2026-06-16 |
| 52-03-01 | 03 | 1 | BIDIR-02 | T-52-03 | `GitHubClient.createIssue` exportado (transport layer) | smoke | `node -e "import('./src/providers/github/client.js').then(m=>{if(!m.GitHubClient.prototype.createIssue)throw new Error('missing');console.log('OK')})"` | ✅ | ✅ green |
| 52-03-02 | 03 | 2 | BIDIR-02 | T-52-03 | `provider.createTask` typeof-detected GitHub; label string plano; LOUD en 403/404 | unit | `node --test test/providers/contract.test.js` | ✅ | ✅ green |
| 52-03-03 | 03 | 3 | BIDIR-01 + BIDIR-02 | T-52-03 | B9 capability-gated: 201 → TaskItem canónico para AMBOS providers; FROZEN-9 negative-assert (`createTask NOT in TASK_PROVIDER_METHODS`) | contract | `node --test test/providers/contract.test.js` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Infraestructura existente cubre todos los requirements de la fase (`node:test` + `test/providers/contract.test.js` + `test/dispatcher.test.js` + `test/labels.test.js` + `test/labels-hygiene.test.js` ya existen).

*Existing infrastructure covers all phase requirements — no new framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| POST real contra Plane CE para validar shape del 201 (D-07) | BIDIR-01 | Endpoint CE no docs-pinned; verificación empírica del `id` + `sequence_id` reales | ✅ Resuelto 2026-06-16: operador ejecutó smoke test vía colección Bruno `bruno/plane-ce-smoke/` request 05 contra `tasks.kintsugi-lab.com` / workspace `k-lab`. 201 confirmed OK — forma esperada; `normalizeWorkItem` la consume correctamente. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (N/A — existing infra)
- [x] No watch-mode flags
- [x] Feedback latency < segundos
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-24

---

## Validation Audit 2026-06-24

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 (pre-existing coverage) |
| Escalated to manual-only | 0 (D-07 already resolved) |
| Requirements covered | 3/3 (BIDIR-01, BIDIR-02, BIDIR-06) |
| Tests run | 118 pass / 0 fail |
