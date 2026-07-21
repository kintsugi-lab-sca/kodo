---
phase: 78
slug: address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-22
---

# Phase 78 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (runner nativo, Node ≥ 20; entorno actual v22.22.3) + `node:assert/strict` |
| **Config file** | none — patrón `node --test $(find test -name '*.test.js' -type f)` en `package.json` (`npm test`) |
| **Quick run command** | `node --test <fichero tocado>` |
| **Full suite command** | `npm test` (baseline ~2253 pass / 0 fail / 1 skip) |
| **Estimated runtime** | quick <10s · full ~90s |

---

## Sampling Rate

- **After every task commit:** Run `node --test <fichero(s) de test tocado(s) por la tarea>` (<10s)
- **After every plan wave:** Run `node --test test/stop.test.js test/hooks/session-end-handoff.test.js test/session/group-resolve.test.js test/manager.test.js test/cmux/client-args.test.js`
- **Before `/gsd-verify-work`:** `npm test` verde
- **Max feedback latency:** <10s por task; suite completa por wave

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 78-01-01 | 01 | 1 | 75/WR-01 | T-78-01 | Regresión RED con dientes: casos de saneo (CSI/OSC/C0/DEL/CR en `next`/`summary`/`task_ref`) fallan sin el fix; goldens byte-idénticos D-09 intactos | unit (pura) | `node --test test/stop.test.js` | ✅ existe | ⬜ pending |
| 78-01-02 | 01 | 1 | 75/WR-01 | T-78-01 | `buildStopNudgeText` sanea los 3 campos LLM vía `stripControlChars` (import de `src/cli/format.js`); pureza preservada (cero I/O) | unit (pura) | `node --test test/stop.test.js` | ✅ existe | ⬜ pending |
| 78-02-01 | 02 | 1 | 77/WR-01, 77/IN-01, 77/IN-02, 77/WR-02 | T-78-02, T-78-03 | `deriveExpectedGroupName` trim + identifier vacío → null; `resolveWorkspaceGroup` valida shape `/^workspace_group:\d+$/` y normaliza NFC | unit (pura) | `node --test test/session/group-resolve.test.js` | ✅ existe (19 tests previos) | ⬜ pending |
| 78-02-02 | 02 | 1 | 77/IN-03, 77/IN-04, 77/IN-05, 77/IN-06 | T-78-04 | Guard `if (expectedName)` evita llamada cmux inútil; log de degradación con motivo `String(err?.message).slice(0,80)` sin contenido de usuario (D-11); assert slice `end > start` no-vacuo | unit + source-hygiene | `node --test test/manager.test.js` | ✅ existe (source-hygiene :786-855) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Ninguno. **Todos los ficheros de test ya existen** — la fase solo añade CASOS a suites existentes (`test/stop.test.js`, `test/session/group-resolve.test.js`, `test/manager.test.js`). No hace falta framework nuevo ni fixtures nuevos (el fixture live Kodo/SCRIBBA/SCP-CMRi ya está en `group-resolve.test.js`).

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

Ninguna. *All phase behaviors have automated verification.*

⚠️ **Nota de baseline (deferred):** `test/gsd-lock-race.test.js` «CR-01» es **flaky preexistente** (~1/3 runs, timing) — si `npm test` falla en ESE test, NO es regresión de Phase 78 (deferred item de Phase 74, fuera de scope). Re-correr para confirmar.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (no hay MISSING)
- [x] No watch-mode flags
- [x] Feedback latency < 10s (quick run por task)
- [ ] `nyquist_compliant: true` set in frontmatter (seeded en plan-phase; sign-off formal en validate-phase §6)

**Approval:** pending
