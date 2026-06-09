---
phase: 42
slug: dismiss-tui-read-write-server-amplification
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-05
validated: 2026-06-06
---

# Phase 42 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Reconstructed retroactively from phase artifacts (PLAN/SUMMARY/VERIFICATION) — the original was an unfilled stub.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (Node built-in runner) · `ink-testing-library` para la TUI |
| **Config file** | none — runner nativo, sin config externa |
| **Quick run command** | `node --test test/server/dismiss.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Estimated runtime** | ~2.6s (subconjunto de la fase 42, 91 tests) · ~30s (suite completa, 1183 tests) |

---

## Sampling Rate

- **After every task commit:** Run `node --test <test file de la tarea>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green (1183 pass / 0 fail / 1 skip pre-existente)
- **Max feedback latency:** ~30 segundos

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 42-01-01 | 01 | 1 | DISMISS-01, DISMISS-04 | T-42-01 / T-42-02 / T-42-03 / T-42-05 | 409 alive guard re-lee `loadState().sessions[taskId]` (TOCTOU); `fix:true` lock; never-throws→500; translate `moved-dirty` | unit | `node --test test/server/dismiss.test.js` | ✅ | ✅ green |
| 42-01-02 | 01 | 1 | DISMISS-01, DISMISS-04 | T-42-04 | thin DELETE adapter server-lifetime; `decodeURIComponent` path-traversal retenido; no `removeSession` | integration | `npm test` | ✅ | ✅ green |
| 42-02-01 | 02 | 1 | DISMISS-03 | T-42-08 / T-42-09 | `dismissSession` never-throws (calque de `fetchComments`); `encodeURIComponent` path; `mapDismissResult` puro sin import circular | unit | `node --test test/dashboard-client.test.js test/dashboard/select-dismiss.test.js` | ✅ | ✅ green |
| 42-02-02 | 02 | 1 | DISMISS-02, DISMISS-04 | T-42-06 / T-42-07 / T-42-10 | doble-`d` confirm machine; cancela en cualquier tecla≠d/Esc; guard inverso `alive===true`; footer `moved-dirty` | unit (ink) | `node --test test/dashboard/app-dismiss.test.js` | ✅ | ✅ green |
| 42-03-01 | 03 | 2 | DISMISS-01..04 | T-42-11 | seam e2e emisor↔consumidor (clean/dirty/warn/409) + vocabulary drift canary bidireccional | integration (seam) | `node --test test/server-dismiss-e2e.test.js` | ✅ | ✅ green |
| 42-03-02 | 03 | 2 | DISMISS-02, DISMISS-03, DISMISS-04 | T-42-12 | UAT humano: preservación `.dirty` real + rechazo de fila viva (rojo) — no demostrable solo con mocks | manual | — (human-verify, firmado 2026-06-05) | N/A | ✅ manual |
| 42-03-03 | 03 | 2 | — (gobernanza) | T-42-13 | STATE.md registra ruptura consciente "TUI read-only" → read-write, zero new endpoints | doc/grep | `grep -c "read-write\|read-WRITE" .planning/STATE.md` (=5, ≥1) | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. El runner `node:test` ya está presente; `ink-testing-library` (única dep de test) estaba instalada desde fases TUI previas. No se requirió Wave 0 — los tests se escribieron TDD-first dentro de cada plan (RED→GREEN documentado en los SUMMARY).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Mutación destructiva double-`d` contra una sesión dead real (worktree+lock+state borrados; `.dirty` preservado; guard de fila viva rechaza en rojo) | DISMISS-02, DISMISS-03, DISMISS-04 (T-42-12) | El borrado real de worktree/lock/state.json y la preservación `.dirty` dependen del filesystem+git reales; no es demostrable solo con mocks. El seam test (42-03-01) cubre el contrato de datos, pero no el efecto físico. | 1) Arrancar dashboard con sesión dead. 2) `d` → prompt `DISMISS_CONFIRM` cyan, tabla sigue polling. 3) Esc → cancela sin DELETE. 4) tecla≠d/Esc → cancela sin DELETE. 5) doble-`d` → fila desaparece ≤2.5s, footer `DISMISS_OK`/`PARTIAL_DIRTY`. 6) `d` sobre fila viva → `DISMISS_GUARD_ALIVE` rojo, cero DELETE. **Firmado "approved" 2026-06-05.** |

*Nota: esta verificación manual es complementaria. Cada uno de DISMISS-01..04 tiene además cobertura automatizada — ningún requisito depende exclusivamente del UAT.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (6 automatizadas + 1 manual complementaria)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (solo 1 tarea manual aislada)
- [x] Wave 0 covers all MISSING references (no había MISSING — infra existente cubre todo)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-06

---

## Validation Audit 2026-06-06

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

**Estado de entrada:** A (VALIDATION.md existía pero era un stub sin rellenar — `nyquist_compliant: false`, todos los `{placeholders}` intactos).
**Acción:** Reconstrucción completa desde PLAN/SUMMARY/VERIFICATION. Cross-reference confirmó que los 4 requisitos (DISMISS-01..04) ya tenían cobertura automatizada verde antes de esta auditoría — no se generaron tests nuevos.
**Evidencia de ejecución:** `node --test` sobre los 6 archivos de la fase → **91 pass / 0 fail / 0 skip** (2.57s). Cero gaps ⇒ no se invocó `gsd-nyquist-auditor`.
