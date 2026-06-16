---
phase: 52
slug: createtask-contrato-anti-recursi-n
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-16
---

# Phase 52 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node built-in test runner, no external deps) |
| **Config file** | none — `package.json` `test` script |
| **Quick run command** | `node --test test/providers/contract.test.js` (o el archivo tocado) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~suite global 1307 pass + 1 skip (baseline v0.12) |

---

## Sampling Rate

- **After every task commit:** Run the targeted file via `node --test test/<file>`
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** segundos (suite rápida, sin red real — todo mockeado)

---

## Per-Task Verification Map

*Filled by the planner per task. Behaviors mapped from RESEARCH.md `## Validation Architecture` (10 testable behaviors → BIDIR-01/02/06).*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | BIDIR-01/02/06 | T-52-* / — | createTask 201 → TaskItem canónico; FROZEN-9; isAdopted ignora bajo --force | unit | `node --test test/providers/contract.test.js` | ✅ existente | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Infraestructura existente cubre todos los requirements de la fase (`node:test` + `test/providers/contract.test.js` + `test/dispatcher.test.js` + `test/labels-hygiene.test.js` ya existen).

*Existing infrastructure covers all phase requirements — no new framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| POST de creación contra Plane **CE** real (shape del 201) | BIDIR-01 | Endpoint CE no docs-pinned; verificación empírica de 5 min (D-07) | Crear una work-item de prueba vía `kodo`/curl contra la instancia CE real; confirmar `id` + `sequence_id` en el 201 |

*El resto de comportamientos tienen verificación automatizada (mocked transport).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < segundos
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
