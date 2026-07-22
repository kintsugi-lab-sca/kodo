---
phase: 77
slug: agrupaci-n-de-workspaces-en-cmux
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-17
---

# Phase 77 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| provider remoto → kodo | `task.ref`/`task.title` vienen del provider (Plane/GitHub) y alimentan la derivación del nombre de grupo y el log | identifiers de tarea (baja sensibilidad; el título NUNCA cruza al log — D-11) |
| kodo (`client.js`) → cmux binary | kodo ejecuta el binario cmux vía `execFile` con argv array; el ref de grupo cruza como argumento | refs `workspace_group:N` (derivados de la propia lista de cmux, nunca input libre) |
| cmux binary → kodo | el stdout JSON de `workspace-group list` vuelve a kodo y se parsea en `resolveWorkspaceGroup` | JSON no confiable (shape sin garantías — parseo defensivo never-throws) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-77-01 | Tampering | ref de grupo → `new-workspace --group` (`buildNewWorkspaceArgs`/`run`) | high | mitigate | argv array vía `execFile` (nunca `exec`/shell); el ref viaja como elemento de array y proviene siempre de `resolveWorkspaceGroup` (un `workspace_group:N` de la lista de cmux, nunca input libre). Verificado en código por review (invariante 1) y verifier | closed |
| T-77-02 | Tampering / DoS | `resolveWorkspaceGroup(JSON.parse(raw), …)` — JSON malformado/hostil de cmux | medium | mitigate | `JSON.parse` dentro del try/catch englobante (capa 1 fail-open); `resolveWorkspaceGroup` defensiva (`Array.isArray` + type-check por campo → `null`, never-throws, calca `normalizeSurface`). Probado con repro (malformed → null) por review y verifier | closed |
| T-77-03 | Information Disclosure | `console.log('[kodo] group_skipped — <motivo>')` | low | mitigate | D-11: el log lleva SOLO motivo/ref — nunca `task.title` ni nombres de grupo del operador con contenido libre. Behavior assert en `test/session/group-resolve.test.js`; verificado en código por review (invariante 6) | closed |
| T-77-04 | Denial of Service | `host._legacy.listWorkspaceGroups()` en el launch (cmux headless/cuelgue) | low | mitigate + accept | `run()` timeout 15s (`client.js`) → reject → capa 1 fail-open; máx 1 llamada extra por lanzamiento (~50ms), cero en el reconcile loop (D-12, diff de `reconcile.js` vacío). Coste marginal aceptado como conocido y acotado (Plan 02) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-77-01 | T-77-04 | Coste marginal de 1 llamada cmux extra por lanzamiento (~50ms, timeout 15s acotado): conocido, medido y fuera del reconcile loop. El componente accept del disposition dual del Plan 02 | Plan 77-02 (operador vía chain --auto) | 2026-07-16 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-17 | 4 | 4 | 0 | /gsd-secure-phase (short-circuit L1: register plan-time, mitigaciones verificadas por gsd-code-reviewer 2026-07-16 + gsd-verifier repro propio) |

**Evidencia de cierre (grep-depth L1, con verificación empírica previa):**
- T-77-01: `src/cmux/client.js` usa `execFile` con argv array plano; `buildNewWorkspaceArgs` es pura y el ref es elemento de array (review invariante 1 ✓, sonda del verifier ✓).
- T-77-02: repro del reviewer y del verifier — JSON malformado/shape inesperado → `null`, cero throws (review invariante 7 ✓).
- T-77-03: assert de behavior en la suite + review invariante 6 ✓ (log sin contenido de usuario).
- T-77-04: timeout 15s presente en `run()`; `git diff 68709be..HEAD -- src/session/reconcile.js` vacío (D-12 ✓).

**Deuda no-security anotada (fuera de este gate):** WR-01/WR-02 del `77-REVIEW.md` son correctness/cobertura (identifier degenerado, test Unicode ausente) — sin vector de seguridad: el resultado erróneo posible es cosmético (agrupar/no agrupar), nunca ejecución ni disclosure.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-17
