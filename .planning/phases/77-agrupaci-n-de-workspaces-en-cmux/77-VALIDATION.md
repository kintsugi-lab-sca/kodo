---
phase: 77
slug: agrupaci-n-de-workspaces-en-cmux
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-16
---

# Phase 77 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in) + `node:assert/strict` |
| **Config file** | none — scripts en `package.json` (`npm test`) |
| **Quick run command** | `node --test <fichero tocado>` |
| **Full suite command** | `npm test` (baseline ~2132 tests, 1 skipped) |
| **Estimated runtime** | quick <10s · full ~90s |

---

## Sampling Rate

- **After every task commit:** Run `node --test <fichero tocado>` (<10s)
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** `npm test` verde
- **Max feedback latency:** <10s por task; suite completa por wave

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 77-01-01 | 01 | 1 | GRP-01, GRP-03, GRP-04 | T-77-01 | argv array vía execFile (sin shell); solo `list` read-only, cero verbos de gestión | unit (pura) | `node --test test/cmux/client-args.test.js` | ✅ existe | ✅ green |
| 77-01-02 | 01 | 1 | GRP-03, GRP-04 | T-77-04 | passthrough `_legacy` sin tocar HOST_METHODS (4); walker verde | structural | `node --test test/host/cmux-isolation.test.js` | ✅ existe | ✅ green |
| 77-02-01 | 02 | 2 | GRP-01, GRP-02, GRP-03 | T-77-02, T-77-03 | JSON parse defensivo never-throws; log sin contenido de usuario (D-11) | unit (pura + DI) | `node --test test/session/group-resolve.test.js` | ✅ existe (29 tests) | ✅ green |
| 77-02-02 | 02 | 2 | GRP-01, GRP-04 | T-77-02 | cero refs `workspace_group:N` persistidos; cero verbos de gestión en manager.js | source-hygiene | `node --test test/manager.test.js test/host/cmux-isolation.test.js` | ✅ existe (extendido) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/cmux/client-args.test.js` — NUEVO (Plan 01 Task 1): teeth de `buildNewWorkspaceArgs` (`--group` push, orden de flags) para GRP-01.
- [x] `test/session/group-resolve.test.js` — NUEVO (Plan 02 Task 1): unit puro de las 3 funciones + fixture live de los 3 grupos reales; incluye el caso D-10 (retry con `newWorkspaceFn` inyectado) para GRP-01/02/03.
- [x] Asserts nuevos en `test/manager.test.js` — EXISTENTE (Plan 02 Task 2): source-hygiene del cableado + negativos GRP-04.

Infra existente cubre el resto: `node:test` ya instalado; `test/host/cmux-isolation.test.js` (walker) ya existe.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| El workspace aterriza VISUALMENTE dentro del grupo en la sidebar | GRP-01 | Requiere la app cmux GUI del operador viva; PROHIBIDO mutar grupos reales en test | Lanzar una tarea de un proyecto con grupo existente (`Kodo`/`SCRIBBA`) y confirmar en `cmux workspace-group list --json` que el nuevo `workspace:N` aparece en `member_workspace_refs` del grupo. Nota de operación, no test automatizado. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 77s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-16 (plan-phase — mapa por-task completo; `wave_0_complete` lo cierra el executor tras Wave 0)
