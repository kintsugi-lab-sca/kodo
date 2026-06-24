---
phase: 58
slug: ciclo-de-vida-de-cierre-deuda-heredada-de-v0-12
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-24
audited: 2026-06-24
reconstructed: true
---

# Phase 58 — Validation Strategy

> Per-phase validation contract. **Reconstruido retroactivamente** (State B) durante
> `/gsd:validate-phase 58` el 2026-06-24 — la fase se ejecutó sin VALIDATION.md.
> Mapea los tests existentes (live, todos verdes) a los requirements LIFE-03 / DEBT-01 / DEBT-02.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node 20+) |
| **Config file** | none — `package.json` test script |
| **Quick run command** | `node --test test/hooks/session-end.test.js test/hooks/install.test.js test/stop*.test.js test/hooks/stop-idempotency.test.js test/server-xss-allowlist.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~300ms (targeted) / full suite |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/hooks/ test/stop*.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 segundos

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| T-58-01-1 | 01 | 1 | LIFE-03 (SC2) | — | `performTerminalCleanup` extrae la secuencia destructiva de stop.js SIN duplicar; cada paso fail-open (cleanupWorktree + removePromptFile + removeSession) | unit | `node --test test/hooks/session-end.test.js test/stop-worktree-cleanup.test.js` | ✅ | ✅ green |
| T-58-01-2 | 01 | 1 | LIFE-03 (SC1/SC4/SC5) | — | `runSessionEndHook`: find session → cleanup destructivo; idempotencia (`source==='history'` + sin sesión → no-op); never-throws (removeSessionFn que lanza no crashea); typed event emitido | unit | `node --test test/hooks/session-end.test.js` | ✅ | ✅ green (5 casos) |
| T-58-01-3 | 01 | 1 | LIFE-03 (SC3/SC6) | — | Refactor stop.js: Stop YA NO llama removeSession/cleanupWorktree/sessionEnd (regression del split); conserva idle+lock+color+nudge; reconcile rescue intacto | unit | `node --test test/stop-state-transition.test.js test/stop.test.js` | ✅ | ✅ green (26 casos) |
| T-58-01-4 | 01 | 1 | LIFE-03 (SC7) | — | install.js registra SessionEnd (tercer evento) vía addHook idempotente; uninstall lo quita; golden-bytes de SessionStart/Stop preservados | unit | `node --test test/hooks/install.test.js` | ✅ | ✅ green (6 casos) |
| T-58-01-4b | 01 | 1 | LIFE-03 (SC4) | — | Idempotencia entre los dos hooks: primera invocación archiva, segunda no-op (guard `source==='history'`) | unit | `node --test test/hooks/stop-idempotency.test.js` | ✅ | ✅ green |
| DEBT-01 | (debt) | — | DEBT-01 | T-48-10 (XSS WR-01) | `safeHref` allowlist (http(s) vía `new URL()`); `refAnchor` pasa task_url por safeHref antes del `<a href>`; `rel="noopener noreferrer"` (anti reverse-tabnabbing); todos los renders de task_url van por refAnchor | unit (regression) | `node --test test/server-xss-allowlist.test.js` | ✅ | ✅ green (4 casos) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/hooks/session-end.test.js` — net-new; LIFE-03 cleanup destructivo + idempotencia + never-throws + typed event
- [x] `test/server-xss-allowlist.test.js` — net-new; DEBT-01 allowlist regression (la mitigación `safeHref` ya estaba desde commit `77a5c0c`/T-48-10; el test cierra el flanco de regresión)
- [x] `test/stop*.test.js` migrados: aserciones destructivas movidas de Stop → SessionEnd; regression del split

*Existing `node:test` infrastructure covers the rest — no framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HUMAN-UAT 50.1 — display de progreso vivo `N/M` en TTY real con sesión GSD viva (3 escenarios: live progress, keep-last-good fallback, label formatting) | DEBT-02 | Requiere TTY real + sesión GSD viva; el render visual del dashboard ink no es verificable sin entorno interactivo | ✅ **PASSED 2026-06-23** — validado en TTY real (dashboard kodo) sembrando STATE.md con `progress:` en sesión GSD viva (ROMAN-175). Esc.1 (prog 3/7 desde STATE.md) ✅; Esc.3 (gate GSD/no-GSD) ✅; Esc.2 (keep-last-good) vía test de componente determinista `test/dashboard/app-progress-keeplast.test.js` ✅. Hallazgo colateral F2 (getTask perdía labels) corregido `c87baad`. |

*LIFE-03 + DEBT-01 tienen cobertura automatizada completa. DEBT-02 era HUMAN-UAT inherente (render visual TTY) — ya superado.*

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
| Escalated to manual-only | 1 (DEBT-02 HUMAN-UAT — ya PASSED 2026-06-23) |
| Requirements covered | 3/3 (LIFE-03 auto, DEBT-01 auto, DEBT-02 manual-passed) |
| Tests run | 52 pass / 0 fail (session-end 5 + install 6 + stop-idempotency 1 + stop 22 + stop-state-transition 4 + stop-worktree-cleanup 10 + server-xss-allowlist 4) |
