---
phase: 79
slug: sidebar-doctor
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-23
---

# Phase 79 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| kodo → cmux CLI (execFile) | Los passthroughs del allowlist mutan el estado vivo del sidebar cmux vía `run()` (execFile, argv plano, timeout 15s, sin shell) | refs `workspace:N` / `workspace_group:N`, nombres de grupo |
| cmux JSON → scan() | Output de shape no confiable (`workspace-group list --json`, `workspace list --json`) parseado en función pura defensiva | JSON no confiable |
| state.json / projects.json → scan() | Leídos por el doctor (escritos por kodo bajo lock; solo lectura aquí) | metadatos de sesiones kodo |
| operador → CLI | `kodo sidebar doctor --fix` es el único opt-in de mutación; dry-run por defecto | flag de mutación |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-79-01 | Tampering | allowlist argv (client.js) | high | mitigate | `run()` usa execFile con argv array, nunca shell; refs/nombres como elementos de array sin interpolación (client.js:17) — confirmado por 79-REVIEW.md (superficie de inyección limpia) | closed |
| T-79-02 | DoS / Destruction | verbo destructivo de workspace-group | high | mitigate | El verbo destructivo NO está cableado (grep 0 hits en src/); guard source-hygiene automático (test/sidebar-doctor-hygiene.test.js) falla si aparece; spy de argv en tests confirma que execute() solo emite el allowlist | closed |
| T-79-03 | Tampering | add/set-anchor sobre workspace del operador | high | mitigate | D-04: solo workspace_ref presentes en state.json y vivos entran a acciones; verificado en UAT (test 3 pass y test 4 pass en vivo, 2026-07-23) | closed |
| T-79-04 | Tampering / DoS | JSON malformado/malicioso de cmux | medium | mitigate | JSON.parse en try/catch dentro de scan() never-throws (D-06); shape inesperado → categoría vacía + warn; `resolveWorkspaceGroup` valida `^workspace_group:\d+$` — cubierto por tests unit | closed |
| T-79-05 | Tampering | escritura corruptiva de state.json | medium | mitigate | El doctor NO escribe state.json: no importa saveState/withStateLock (grep: solo mención en comentario); invariante por construcción, respaldado por source assertion en tests | closed |
| T-79-06 | DoS | cmux headless/colgado | low | mitigate | timeout 15s en run() (client.js:17) → reject → fail-open per item en execute() | closed |
| T-79-07 | Information Disclosure | render/--json | low | mitigate | El report solo lleva refs/nombres de grupo (sin contenido de usuario); `--json` byte-determinista sin ANSI; sin secretos en el payload | closed |
| T-79-04-01 | Tampering | execute() → run() (add/ungroup) | low | mitigate | Superficie REDUCIDA por el gap closure G-79-1: execute() dejó de emitir create/set-anchor; solo restan add/ungroup por argv plano (invariante V5 de client.js) | closed |
| T-79-04-02 | DoS (regresión funcional) | absorción de identidad del anchor | high | mitigate | Bucle missing_group eliminado de execute() (regresión imposible por construcción); test de regresión G-79-1 con spy de argv; re-verificado en vivo (UAT test 4 pass, 2026-07-23) | closed |
| T-79-SC | Tampering | supply chain (npm) | low | accept | Cero deps npm nuevas (invariante cross-milestone); no hay instalación que auditar | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-79-01 | T-79-SC | La fase no añade dependencias npm (invariante cross-milestone verificado en package.json); no existe superficie de supply chain nueva que auditar | plan-time disposition (79-01..04 PLAN.md) | 2026-07-23 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-23 | 10 | 10 | 0 | secure-phase L1 short-circuit (register plan-time, mitigaciones verificadas mecánicamente: grep + suite 2348 pass + 79-REVIEW.md + UAT 4/4) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-23
