---
phase: 78
slug: address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-22
---

# Phase 78 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| contenido LLM / state.json (hand-editable) → terminal del orquestador | `next`/`summary`/`task_ref` cruzan de datos no confiables al sink `cmuxClient.send` / `host._legacy.send`, que el terminal del orquestador interpreta (OSC/CSI) y donde `\n` actúa como Enter (keystroke) | texto LLM / hand-editable, baja sensibilidad, alta capacidad de inyección |
| salida de `cmux workspace-group list --json` → log de kodo / routing de grupo | El JSON de cmux (`g.name`, `g.ref`) es entrada externa; un shape anómalo puede forjar líneas de log o enrutar a un grupo arbitrario | metadatos de workspace |
| `task.ref` / `task.title` (provider) → identifier de grupo / nombre de workspace / notify | Un ref degenerado colapsa a identifier vacío; un title con control chars contamina sinks de render | metadatos de tarea del provider |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-78-01 | Tampering | `buildStopNudgeText` (src/hooks/stop.js) → `cmuxClient.send` (session-end.js) | medium | mitigate | `stripForKeystroke` en los 3 campos LLM (`stop.js:59,83`) — supera la mitigación planificada (`stripControlChars`): además de CSI/OSC/C0/C1/DEL/CR neutraliza `\n`/`\t` reales y escapados (vector Enter del carril keystroke, WR-02 de la review). Commits `fd9bcb2` + `2ce37f2` | closed |
| T-78-02 | Tampering (log injection) | `resolveWorkspaceGroup` (src/session/manager.js:203) | low | mitigate | Guard `/^workspace_group:\d+$/` sobre `g.ref` — shape anómalo (incl. `\n`) rechazado antes de devolverse/loguearse. Commit `048ed60` | closed |
| T-78-03 | Tampering (routing) | `deriveExpectedGroupName` (src/session/manager.js:143) | low | mitigate | `typeof` guard + trim del ref + identifier derivado vacío → null; fail-open a lanzar sin `--group`. Commit `048ed60` | closed |
| T-78-04 | Information disclosure | log de degradación en `launchWorkItem` (src/session/manager.js:423) | low | accept→mitigate | `String(err?.message).slice(0, 80)` — el mensaje viene de cmux/JSON.parse, nunca del título de tarea (D-11 preservado). Commit `428d78a` | closed |
| T-78-05 | Tampering (post-review WR-01) | nudge de lanzamiento en `launchWorkItem` → `host._legacy.send` (src/session/manager.js:530) | medium | mitigate | Descubierto por la code review de la propia fase: `task.ref`/`task.title`/`projectPath` iban crudos al terminal del orquestador. Saneados con `stripForKeystroke` (carril keystroke). Commits `17a706c` + `2ce37f2`; regresión con dientes en `test/manager.test.js` | closed |
| T-78-06 | Tampering (post-review WR-02) | reutilización del saneador de render en carril keystroke (los 3 sinks `send`) | medium | mitigate | `stripControlChars` preserva `\n`/`\t` (contrato de render) pero `cmux send` interpreta `\n` como Enter. Nueva función pura `stripForKeystroke` (src/cli/format.js:114) conmutada SOLO en los sinks de keystroke; carriles de render intactos. 5 tests de regresión con dientes verificadas por reversión. Commit `2ce37f2` | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

Complemento de la pasada `--fix --all`: `task.title` saneado con `stripControlChars` también en los carriles no-keystroke (nombre de workspace `manager.js:431`, body de notify `manager.js:519`; commit `e1bdb01`) y `listWorkspaces` endurecido a never-throws ante elementos null (commit `b0fecf7`).

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-77-D10 | 77/IN-07 | Riesgo residual TOCTOU del retry de `newWorkspaceWithGroupFallback` — decisión D-10 LOCKED de Phase 77; explícitamente fuera de scope de esta fase (RESEARCH §Out of Scope). No es un threat nuevo de Phase 78 | operador (Phase 77) | 2026-07-16 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-22 | 6 | 6 | 0 | orchestrator (L1 grep-depth, short-circuit: register plan-time + threats_open 0 + ASVS 1) |

Evidencia L1 verificada por grep contra el código en HEAD (`b3d37df`): `stripForKeystroke` importada y aplicada en `stop.js:16,59,83` y `manager.js:530`; shape guard en `manager.js:203`; guards de derivación en `manager.js:143-163` (typeof/trim/empty→null); motivo truncado en `manager.js:423`; `stripForKeystroke`/`stripControlChars` definidas en `src/cli/format.js:80,114`. Los threats T-78-05/06 fueron descubiertos y cerrados por el ciclo de code review de la fase (2 pasadas + fix), con suite completa en verde (2308 pass / 0 fail / 1 skip).

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-22
