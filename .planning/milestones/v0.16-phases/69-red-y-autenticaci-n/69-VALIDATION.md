---
phase: 69
slug: red-y-autenticaci-n
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-06
---

# Phase 69 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in runner, suite existente 1788 pass + 1 skip) |
| **Config file** | none — `npm test` corre `node --test test/` |
| **Quick run command** | `node --test test/server*.test.js` (o el fichero de test tocado) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (suite completa) |

---

## Sampling Rate

- **After every task commit:** Run `node --test <ficheros de test tocados>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (a rellenar por el planner) | — | — | NET-01..06 | A1/M1/M2/B6/B10 | ver RESEARCH.md §Validation Architecture | unit/integration | `node --test …` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test files para el middleware de auth / bind / body-limit (integration sobre `http.Server` real en puerto efímero)
- [ ] Fixtures compartidos si los tests de server no existen aún para estas rutas

*El planner debe concretar esta lista desde RESEARCH.md §Validation Architecture.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 401 desde otro nodo de la LAN | NET-01, NET-02 | Requiere un segundo host físico/VM en la LAN | `curl http://<ip-del-host>:9090/status` desde otro nodo → 401; con `Authorization: Bearer <token>` → 200 |
| Webhook de Plane real con HMAC intacto | NET-06 | Requiere instancia Plane externa entregando el webhook | Mover un work item etiquetado → el server lo despacha con bind expuesto vía `config.server.bind` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
