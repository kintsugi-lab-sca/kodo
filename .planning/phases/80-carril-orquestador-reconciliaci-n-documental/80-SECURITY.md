---
phase: 80
slug: carril-orquestador-reconciliaci-n-documental
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-23
---

# Phase 80 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| carril check (in-process) → cmux workspace-groups | `execute()` muta grupos del sidebar (add/ungroup) vía execFile del passthrough cmux — efecto deseado (ORCH-07), sin input externo nuevo | refs `workspace:N` / nombres de grupo derivados |
| carril check → state.json | Solo-lectura (el motor y el carril nunca escriben state.json; GRP-04) | session records (read-only) |
| carril check → stdout | Líneas `[kodo:check] Sidebar ...`; nunca NDJSON (LOG-12) | contadores + `err.message` |
| edición documental → skill propagada a `~/.claude/skills/` | `syncSkill` copia skill.md a home en el próximo `launchOrchestrator`; el contenido editado son instrucciones que el orquestador LLM ejecuta | prosa de instrucciones |
| prompt.md → `resolvePromptTemplate`/`applyReportingGate` | Placeholders y bloque reporting consumidos byte-a-byte al spawn | template markers |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-80-01 | Tampering | `execute()` cmux mutation en el carril | medium | mitigate | Allowlist NO-destructivo (create/add/set-anchor/ungroup); `workspace-group delete` NI SE CABLEA — guard `test/sidebar-doctor-hygiene.test.js` escanea `src/`; el carril no añade verbos (verificado: sin `'delete'` cableado en `src/cmux/*.js`/`src/check.js`) | closed |
| T-80-02 | Information disclosure | Líneas `[kodo:check] Sidebar ...` en stdout | low | mitigate | Emiten CONTADORES (`applied`, `missing_group.length`) + `err.message`, nunca objetos raw ni paths de tareas (verificado en `src/check.js:159-165`) | closed |
| T-80-03 | Denial of Service | Bucle de re-fix sobre advisories | low | mitigate | `hasActions` cuenta SOLO loose+empty (`src/cmux/sidebar-doctor.js:297-303`, `missing_group` excluido); 2º pase convergido ejecuta 0 acciones (UAT Test 1 pass en vivo) | closed |
| T-80-04 | Information disclosure | Reintroducción de `logger.js` real al grafo del vigilante (fuga NDJSON) | medium | mitigate | El carril llama `scanFn(deps)`/`executeFn(deps,{fix:true})` con `deps` sin logger → `noopLogger`; guard `test/check-isolation.test.js` (4 módulos prohibidos + convergencia positiva a `sidebar-doctor.js`) | closed |
| T-80-05 | Tampering | Prosa nueva en skill.md/prompt.md que induzca un verbo destructivo o el sidebar como trigger | low | mitigate | Docs afirman «`workspace-group delete` no se cablea» y «El sidebar NO es trigger» (skill.md:357,366; prompt.md:22); checklist anti-deriva D-11 pasada | closed |
| T-80-06 | Tampering | Romper el bloque reporting gated o los placeholders de prompt.md al editar | low | mitigate | Marcadores `<!-- BEGIN/END reporting -->` (2) y placeholders `{{provider}}`/`{{provider_name}}`/`{{mcp_tool}}` (11 ocurrencias) presentes; diff de 8100e8d fuera del bloque (D-12) | closed |
| T-80-SC | Tampering | Supply-chain (npm/pip/cargo installs) | low | accept | Fase sin instalación de paquetes (constraint LOCKED v0.18: cero deps nuevas); superficie supply-chain sin cambios | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-80-01 | T-80-SC | La fase no instala ningún paquete (solo edita `src/check.js`, tests y 2 `.md`); la superficie supply-chain queda sin cambios | plan-time constraint (LOCKED v0.18) | 2026-07-23 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-23 | 7 | 7 | 0 | secure-phase L1 short-circuit (register plan-time, grep-verified) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-23
