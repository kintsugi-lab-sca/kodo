---
phase: 76
slug: convergencia-del-conteo-pending
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-17
---

# Phase 76 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| provider externo (Plane/GitHub) → módulo de lectura | La lista `pending` cruza vía `listPendingTasksFn` (inyectado por DI); el módulo no llama a red directamente | Metadatos de tareas (ref, title, url, state, projectName) |
| cliente → GET /status | Cruza tras el bearer default-deny (`server.js:570`) — sin cambios; el refactor no toca auth | Payload `/status` con `pending`, `pending_stale`, `pending_fetched_at` |
| provider externo → server/check | El fallo del fetch se colapsa a `stale:true`; el payload/`err.message` del provider no propaga al cliente | Señal de frescura, sin contenido del error |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-76-01 | Information Disclosure | `src/tasks/pending.js` + warn de fallo en `server.js` | low | mitigate | La hoja NUNCA loguea (verificado: 0 imports, 0 `console.*`; guard en `test/check-isolation.test.js`). El warn del server (`server.js:614`) es genérico («listPendingTasks stale — serving last-known-good»), sin payload ni `err.message`. PERSIST-04 intacto | closed |
| T-76-02 | Tampering/Repudiation | `/status` sirviendo dato caducado como fresco | medium | mitigate | ES el fix de ORCH-06: `pending_stale: true` + `pending_fetched_at` del último éxito hacen la staleness dato en la respuesta; contrato blindado por `test/server/status-pending.test.js` (ambas ramas) | closed |
| T-76-03 | Information Disclosure | `pending_fetched_at` como canal de timing lateral | low | accept | Insignificante — `/status` ya está tras bearer; el timestamp de un fetch interno no filtra nada explotable | closed |
| T-76-04 | Tampering | Semántica de frescura del resolver | medium | mitigate | El `fetched_at` en fallo es SIEMPRE el del último éxito (nunca `now()` — Pitfall 3); `stale` discrimina explícitamente; cold-start caído → `{[], null, true}`. Blindado por los tests «catch etiquetado» de `test/tasks/pending.test.js` | closed |
| T-76-SC | Tampering | Instalación npm/pip/cargo (supply chain) | low | accept | N/A — cero paquetes nuevos (constraint LOCKED «cero dependencias npm nuevas»); `package.json` sin cambios en la fase (último toque: v0.16.1); backstop must_have verificado por el verifier | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-76-01 | T-76-03 | Canal de timing insignificante: `/status` está tras bearer default-deny y el timestamp de un fetch interno no expone información explotable | Plan 76-02 (register autorado en planificación) | 2026-07-17 |
| AR-76-02 | T-76-SC | Sin superficie de supply chain: la fase instala cero paquetes (todo `node:` built-in, constraint LOCKED cross-milestone) | Plan 76-01/76-02 (register autorado en planificación) | 2026-07-17 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-17 | 5 | 5 | 0 | secure-phase L1 grep-depth (short-circuit: register autorado en plan, threats_open 0, ASVS L1) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-17
