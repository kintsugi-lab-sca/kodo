---
phase: 81
slug: saneo-de-deuda-v0-17
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-24
---

# Phase 81 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| SessionEnd hook → state writer | Contenido de handoff redactado por el LLM (no confiable) cruza al writer de estado | `next` (texto LLM) |
| state.json (editable por operador) → consumidores (dashboard, nudge) | El `next` persistido lo consumen el enrich del dashboard y el nudge del orquestador | `next` (texto LLM/operador) |
| state.json `next` → render terminal | Contenido no confiable proyectado a la tabla TUI del dashboard | texto proyectado a celdas |
| Agentes GSD concurrentes → `.kodo.lock` compartido | Múltiples procesos contienden por el mismo lockfile; el CAS steal debe garantizar exactamente-uno-adquiere | lockfile (PID/metadata) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-81-01-01 | Information Disclosure | `upsertTaskHandoff` telemetría | medium | mitigate | T-71-18 conservado: `handoff_saved`/`handoff_failed` cargan SOLO `{task_id}`/`{task_id, reason}` (`state.js:485,490` — grep-verificado: ninguna llamada a logger con `next`) | closed |
| T-81-01-02 | Tampering | write path de state.json | medium | mitigate | Merge de tres estados DENTRO de `withStateLock` (`state.js:324`); `prev` desde el arg `state` del mutador (guarda lost-update T-74-16) | closed |
| T-81-01-03 | Tampering | nudge LIVE-07 (effective-next) | low | mitigate | `effectiveNext` lee el valor POST-merge (`upsertResult.value.next`); tests de hooks 53/53 verifican clear→genérico / preserve→contextual | closed |
| T-81-01-SC | Tampering | instalaciones npm/pip/cargo | n/a | accept | Sin instalaciones en esta fase (invariante «cero nuevas dependencias npm») — no aplica | closed |
| T-81-02-01 | Tampering (DoS-of-display) | `nextCell` render (`format.js`) | low | mitigate | Colapso `/\s+/g`→' ' + `trim` en el punto de proyección, tests 58/58 (`test/dashboard-format.test.js`) | closed |
| T-81-02-02 | Tampering (terminal injection OSC-52/CSI) | enrich de App.js | low | accept | `stripControlChars` (Phase 78) INALTERADO (9 referencias en App.js, grep-verificado); injection es canon — breadcrumb registrado en el plan | closed |
| T-81-02-03 | Tampering | dato persistido en state.json | low | accept | Dato verbatim (D-06); fix render-only, cero mutación del write; DEBT-02 doc-only sin superficie runtime | closed |
| T-81-02-SC | Tampering | instalaciones npm/pip/cargo | n/a | accept | Sin instalaciones en esta fase — no aplica | closed |
| T-81-03-01 | Tampering | `src/gsd/lock.js` CAS steal (doble adquisición) | high | mitigate | `lock.js` READ-ONLY cumplido: `git diff ${first-81-commit}^..HEAD -- src/gsd/lock.js` vacío (verificado); el fix real queda gated por decisión de mantenedor (diagnóstico en `.planning/debug/gsd-lock-race-cr01.md`) | closed |
| T-81-03-02 | Tampering | remediación del flaky que enmascara carrera real | high | mitigate | Cero remedios a ciegas: sin `.skip`/retries/timeouts (grep: 0 matches en `test/gsd-lock-race.test.js`; diff de la fase sobre test/helpers vacío); entregable = artefacto de diagnóstico, test sigue honesto | closed |
| T-81-03-SC | Tampering | instalaciones npm/pip/cargo | n/a | accept | Sin instalaciones en esta fase — no aplica | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-81-01 | (diagnóstico DEBT-04) | La carrera real confirmada en `stealLock` (ventana no-atómica renameSync→O_EXCL, doble adquisición posible) queda SIN arreglar en esta fase por mandato D-09 (lock.js READ-ONLY sin decisión de mantenedor). El test `gsd-lock-race` permanece flaky-red a propósito — greenearlo enmascararía la carrera. Fix o aceptación definitiva → item de backlog para el mantenedor | Operador (UAT 81 pass, 2026-07-24) | 2026-07-24 |
| R-81-02 | 81-REVIEW WR-01/WR-02 | Deuda documental/cosmética aceptada explícitamente en UAT (typedef `TaskHandoff` con semántica antigua; `deriveAnyNext` no colapsa whitespace al decidir presencia de columna). Sin superficie de seguridad | Operador (UAT 81 pass, 2026-07-24) | 2026-07-24 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-24 | 11 | 11 | 0 | secure-phase L1 (short-circuit: register plan-time, grep-depth) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-24
