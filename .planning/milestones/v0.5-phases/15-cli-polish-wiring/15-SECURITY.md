---
phase: 15
slug: cli-polish-wiring
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-05
---

# Phase 15 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Phase 15 cabea el helper `src/cli/format.js` (Phase 14) en 5 surfaces CLI (`kodo logs`, `kodo check`, `kodo gsd inspect`, `kodo gsd verify`, format-isolation guard). Es **presentation-layer puro**: transforma data ya validada upstream para output TTY (colores semánticos, columnas alineadas, símbolos pass/fail) sin introducir nuevos parsers, deserializers, endpoints, credenciales ni surfaces de input externo.

Los plans no declaran `<threat_model>` blocks porque la fase no añade trust boundaries — toda la data que cruza a la CLI ya estaba validada por las fases que la generaron (Plane API en Phase 10, resolver en Phase 9, logger en LOG-09, etc.).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Process → Operator (stdout/stderr) | Output TTY del CLI hacia humano (presentation layer) | NDJSON logs ya filtrados (`logger-redaction`), verdicts del resolver/verifier ya validados, slice de markdown comment ya generado |
| Internal call → CLI render | `runGsdVerify` → `renderHuman` accede a `result.plane.comment_body` (campo expuesto en Plan 15-04) | String markdown determinista ya generado por `renderComment` antes de enviarse a Plane (no se re-genera, slice read-only) |

**Sin nuevas trust boundaries.** Las 2 listadas son redocumentación de boundaries pre-existentes que esta fase **consume** sin modificar.

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| — | — | — | — | No threats identified for presentation-only changes | — |

*No threats identified.* Phase 15 no introduce nuevos vectores: no hay deserialización, ni nuevos endpoints/handlers, ni nuevas credenciales o secrets, ni invocación de subprocesos, ni parsing de input no confiable. El único campo de return shape añadido (`result.plane.comment_body`) expone un string que ya se enviaba a Plane (no es exfiltration de data nueva — es accesibilidad interna para render slice).

---

## Accepted Risks Log

No accepted risks.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-05 | 0 | 0 | 0 | gsd-secure-phase orchestrator (no auditor spawn — `threats_open: 0` skipped to Step 6 per workflow) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer) — N/A, 0 threats
- [x] Accepted risks documented in Accepted Risks Log — none
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

---

## Cross-references

- **`logger-redaction.test.js`** — Phase pre-15 redaction filter ya en place; ningún cambio en formatLine altera el filtrado
- **LOG-12 guard (`format-isolation.test.js` LOG-12 extension)** — bloquea regresión de `format.js → logger.js` import (preservado verde tras Phase 15)
- **D-07 single-source-of-color (`format-isolation.test.js` Phase 15 extension)** — 5 callsites importan `format.js` y `picocolors` no leakea fuera de `format.js` + `package.json`
- **Pitfall #2 Phase 10 (`gsd-verify-cli-handler.test.js` REND1)** — bloquea regresión de re-render del Plane comment (anti-double-generation)
