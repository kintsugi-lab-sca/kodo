---
phase: 59
slug: liveness-de-sesiones-adoptadas
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-24
audited: 2026-06-24
reconstructed: true
---

# Phase 59 — Validation Strategy

> Per-phase validation contract. **Reconstruido retroactivamente** (State B) durante
> `/gsd:validate-phase 59` el 2026-06-24. Phase 59 es un gap-fix promovido del backlog
> (sin REQ-ID formal en REQUIREMENTS.md); entrega SC1-SC3 de liveness vía el approach
> RENAME (el workspace cmux se renombra a `<task_ref>: <título>` para que el contrato
> EXISTENTE `titleIdentifiesSession` lo reconozca vivo, sin tocar reconcile.js).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node 20+) |
| **Config file** | none — `package.json` test script |
| **Quick run command** | `node --test test/adopt-cli.test.js test/host/contract.test.js test/host/cmux-isolation.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~2s (targeted) / full suite |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/adopt-cli.test.js test/host/`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 segundos

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 59-01-01 | 01 | 1 | SC2 (host expone liveness aditivamente) | — | `_legacy.rename` en CmuxHost (passthrough a `cmux/client.js` rename); NullHost no-op (fail-open non-cmux); argv canónico `workspace rename <ws> --title <t>` (NO la acción inexistente `set-title`) | unit | `node --test test/host/contract.test.js` | ✅ | ✅ green (3 casos Phase 59) |
| 59-01-02 | 01 | 1 | SC1 (sesión adoptada viva NO marcada dead) | — | `runAdoptCli` PASO 5: tras adopt ok, renombra workspace a título con `task_ref` word-bounded (`ROMAN-192:`); el contrato `titleIdentifiesSession` (Phase 43, ref-bounded) se refuerza | unit | `node --test test/adopt-cli.test.js` (L1) | ✅ | ✅ green |
| 59-01-03 | 01 | 1 | SC1 (fail-open invariante) | T-cmux-side-effect | `renameWorkspaceFn` que lanza → exit 0, render de éxito presente, NO throw; el rename NUNCA cambia `exitCodeFor(result)` | unit | `node --test test/adopt-cli.test.js` (L2) | ✅ | ✅ green |
| 59-01-04 | 01 | 1 | regla transversal LOCKED | — | cmux solo via `src/host/`; `adopt.js`/`reconcile.js` host-agnósticos; el rename vive en `runAdoptCli` (consumidor), no en el núcleo | unit | `node --test test/host/cmux-isolation.test.js` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **SC3** ("una sesión adoptada viva NO reaparece como adoptable en el picker") es una
> **consecuencia lógica** de SC1: al no marcarse `dead`, la sesión no cae al ciclo
> `dead → history → computeAdoptable`. Cubierto indirectamente por el set-difference de
> `computeAdoptable` (Phase 56, `test/dashboard/select-adopt.test.js`) + SC1 arriba.

---

## Wave 0 Requirements

- [x] No new test files required — `test/adopt-cli.test.js` (cases L1/L2 Phase 59) + `test/host/contract.test.js` (describe Phase 59, 3 tests) + `test/host/cmux-isolation.test.js` cubren rename + contrato + fail-open + isolation.

*Existing infrastructure covers all phase behaviors.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Liveness end-to-end: tras adoptar en cmux real, el workspace renombrado mantiene la sesión `alive` a través de ticks de reconcile (no recae a `dead`/picker) | SC1/SC3 | Requiere cmux real + reconcile loop vivo; los unit tests cubren la llamada de rename + argv + fail-open, pero el comportamiento real de `titleIdentifiesSession` sobre el workspace renombrado a lo largo de ticks es entorno-dependiente | Adoptar una sesión ad-hoc en cmux real; confirmar que el workspace queda titulado `<ref>: <título>` y que en el siguiente tick de `/status` la sesión sigue viva (no `dead`, no re-ofrecida en el picker). Origen del fix: UAT Phase 56. |

> **Limitación conocida (acción del operador, NO bloqueante):** el fix cubre adopciones
> NUEVAS. Sesiones adoptadas YA muertas (antes de este cambio) necesitan re-adoptar o
> renombrar el workspace manualmente. Documentado en `<deferred>` de 59-CONTEXT.md.

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
| Resolved | 0 (reconstrucción State B — cobertura pre-existente) |
| Escalated to manual-only | 1 (liveness end-to-end en cmux real — entorno-dependiente) |
| Requirements covered | SC1/SC2 auto; SC3 consecuencia lógica de SC1 |
| Tests run | 65 pass / 0 fail (adopt-cli + host/contract + cmux-isolation) |
