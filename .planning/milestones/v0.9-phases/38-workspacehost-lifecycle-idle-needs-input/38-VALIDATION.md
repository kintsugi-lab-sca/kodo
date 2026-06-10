---
phase: 38
slug: workspacehost-lifecycle-idle-needs-input
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-10
---

# Phase 38 — Validation Strategy

> Per-phase validation contract reconstruido retroactivamente (backfill Nyquist Phase 47, NYQ-02).
> Phase 38 cerró **covered-by-UAT** (sin VERIFICATION.md formal — ver fila `verification` en STATE.md).
> Evidencia citada: `38-HUMAN-UAT.md` (status passed, 4 escenarios SC#6, firmado por alex 2026-06-01).
> **Sin re-ejecutar la suite** — cada dimensión cita el resultado UAT/test ya registrado (D-03).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` · `ink-testing-library` para la TUI |
| **Config file** | none — runner nativo, sin config externa |
| **Quick run command** | `node --test test/reconciliation.test.js test/dashboard/app-focus.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Evidencia citada** | `38-HUMAN-UAT.md` (2026-06-01, status passed, 4/4 escenarios) |

---

## Sampling Rate

- **Evidencia primaria (covered-by-UAT):** `38-HUMAN-UAT.md` — UAT bloqueante firmado, 4 escenarios SC#6.
- **Cobertura automatizada citada:** app-focus parity 5/5 (CmuxHost.selectWorkspace), host contract test (fixture JSON real), reconciliation 13/13.
- **Política Nyquist (backfill):** la cobertura ES la cita a la evidencia preexistente; no se re-corre la suite (D-03 / D-05).

---

## Per-Task Verification Map (dimensión → cobertura citada)

| Requirement / Escenario | Dimensión / Behavior | Test Type | Automated Command | Evidencia citada (`38-HUMAN-UAT.md`) | Status |
|-------------------------|----------------------|-----------|-------------------|--------------------------------------|--------|
| Escenario A — idle visible (NUEVO, fix ROMAN-151/152) | `process_alive:false` + `tab_alive:true` → debouncing 2-tick → `⏸ idle`; sesión preservada en `state.sessions` | UAT live + unit | `node --test test/reconciliation.test.js` | Escenario A **passed** — UAT LIVE end-to-end (ROMAN-22 real en workspace:24, screenshot + state.json en disco confirmados); bug ROMAN-151/152 CERRADO en vivo (gap derivación process_alive cazado y arreglado commit ffdd19d) | ✅ green |
| Escenario 2 — dead reject vía CmuxHost | `!live.alive` → `✗ dead` (debouncing 2-tick); guard `alive=false` no invoca cmux | UAT + unit | `node --test test/dashboard/app-focus.test.js` | Escenario 2 **passed** — badge `✗ dead` visual + mismo path de reconciliación que A (validado en vivo); guard cubierto por app-focus parity 5/5 | ✅ green |
| Escenario 1 — focus parity vía CmuxHost (Phase 37) | Enter sobre fila alive → `host.selectWorkspace` con args verbatim Phase 37 `['select-workspace','--workspace',ref]`, `{ok:true}` | UAT-via-tests | `node --test test/dashboard/app-focus.test.js` | Escenario 1 **passed-via-tests** — app-focus parity 5/5 (shape idéntico a runFocus); único aspecto no observado manual = cambio foco GUI macOS, garantizado por test | ✅ green |
| Escenario B — needs-input visible (NUEVO) | rama `live && !process_alive && live.needs_input` → `🔔 needs-input` (cyan); anti-flicker debouncing 2-tick | UAT-via-tests | `node --test test/reconciliation.test.js` | Escenario B **passed-via-tests** — badge cyan visual (fixture P38 + screenshot); mismo path que A; needs_input de `notification.list` (subtitle:'Waiting') cubierto por host/contract.test.js; anti-flicker por reconciliation.test.js F2 | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky / manual-only*

---

## Wave 0 Requirements

Infraestructura existente (`node:test` nativo + `ink-testing-library`) cubre todos los requirements. La reconciliación host↔state corre en el proceso server (`startReconcileLoop`), cubierta por `reconciliation.test.js` (13/13). El dashboard es cliente HTTP read-only de `GET /status`. Sin Wave 0 nuevo.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Evidencia |
|----------|-------------|------------|-----------|
| Ciclo de vida idle/needs-input/dead end-to-end con cmux real: kill del proceso Claude con tab viva → reconciliación → badge correcto, sesión preservada | SC#6 (D-14) | La reconciliación host↔state con `pgrep` + cmux real + el render visual de badges en TTY no es demostrable solo con mocks. | `38-HUMAN-UAT.md` (status passed, firmado por alex 2026-06-01): Escenario A (idle, el fix crítico ROMAN-151/152) validado **END-TO-END EN VIVO** con ROMAN-22 real; Escenario 2 (dead) por el mismo path; Escenarios 1/B passed-via-tests. El UAT live cazó y cerró 5 bugs reales que la suite verde no detectó (crash server, log duplicado, tests corrompen HOME, gap process_alive, tab_alive stale). |

---

## Validation Sign-Off

- [x] Cada escenario SC#6 mapeado a ≥1 cita de evidencia real en `38-HUMAN-UAT.md`
- [x] Sampling continuity: cobertura automatizada verde (app-focus 5/5, host contract, reconciliation 13/13)
- [x] Wave 0 covers all MISSING references (ninguna — infra existente cubre todo)
- [x] No watch-mode flags
- [x] Ninguna fase declarada N/A — covered-by-UAT con evidencia firmada (D-03)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-10 (backfill Phase 47, NYQ-02)

---

## Reconstruction Audit 2026-06-10 (Phase 47 NYQ-02)

| Metric | Count |
|--------|-------|
| Escenarios auditados | 4 (SC#6: focus, dead, idle, needs-input) |
| COVERED (passed live / passed-via-tests) | 4 |
| PARTIAL | 0 |
| MISSING | 0 |
| Evidencia primaria | `38-HUMAN-UAT.md` (covered-by-UAT — sin VERIFICATION formal) |

**Nota Nyquist:** La lógica crítica de la fase (derivación running→idle vía `pgrep` + debouncing 2-tick, single-writer de `alive`/`state` por reconcileTick, guard `alive=false` en Enter, badges v3) está cubierta por tests deterministas (app-focus parity 5/5, host contract, reconciliation 13/13) y validada **end-to-end en vivo** (Escenario A, ROMAN-22 real — el fix de ROMAN-151/152). **Sin re-ejecutar la suite** — cobertura citada de `38-HUMAN-UAT.md`. Fase declarada **nyquist-compliant** (covered-by-UAT, D-03).
