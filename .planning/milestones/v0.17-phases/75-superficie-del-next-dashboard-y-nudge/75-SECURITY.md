---
phase: 75
slug: superficie-del-next-dashboard-y-nudge
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-17
---

# Phase 75 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| `state.json` (fichero local) → capa de datos TUI | El valor `next` es contenido escrito por un LLM; cruza al render del terminal | Texto LLM (hasta 200 chars) |
| filesystem → reader leaf (`tasks.js`) | Fichero ausente/corrupto/parcial cruza a la cadena de render | JSON arbitrario |
| `state.tasks` (memoria bajo lock) → nudge cmux | El `NEXT:` viaja al texto del nudge y a la telemetría | Texto LLM |
| hook `SessionEnd` → cierre de Claude Code | Un fallo del handoff/nudge no puede crashear el cierre | Control de flujo |
| `~/.kodo/plans/<task_id>.md` (LLM) → mini-renderer → terminal | Las líneas del plan cruzan al render del terminal | Markdown LLM |
| snapshot overlay (`kind:'plan'`) → `renderOverlay` | El discriminante `render` decide mini-renderer (light) vs `<Text>` plano (GSD) | Flag de carril |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-75-01 | Tampering | celda `next` (App.js → SessionTable) | high | mitigate | `stripControlChars` en el punto de proyección (`App.js:743`) — neutraliza OSC-52/CSI/C1 | closed |
| T-75-02 | Tampering | `renderMarkdownLines` (markdown.js) | high | mitigate | `stripControlChars` por línea (`markdown.js:57`) antes de proyectar | closed |
| T-75-03 | DoS | `stripHandoffMarker` (handoff.js) | medium | mitigate | `indexOf`/`slice`, cero regex en el módulo (grep `new RegExp\|.match(` = 0); `check-isolation` verde | closed |
| T-75-04 | DoS | `readTasks` (tasks.js) | medium | mitigate | Reader leaf never-throws: catch → `{}` (`tasks.js:45`); ningún throw llega a React | closed |
| T-75-05 | Tampering | ruta de state.json | low | mitigate | Root fijo `join(homedir(),'.kodo',…)`, solo builtins; el `next` jamás se usa como ruta | closed |
| T-75-06 | Information disclosure | telemetría de `upsertTaskHandoff` | medium | mitigate | Telemetría solo `{task_id, reason}` (`state.js:458,463`); el `next` nunca se loguea (precedente T-71-18) | closed |
| T-75-07 | DoS | paso handoff/nudge en session-end.js | medium | mitigate | try/catch estructural: `handoffNext` colapsa a `null` (`session-end.js:145-148`), jamás aborta el cierre | closed |
| T-75-08 | Tampering | gate `render` en `renderOverlay` | medium | mitigate | Mini-renderer solo con `snap.render === 'markdown'` (`SessionTable.js:206`); rama GSD byte-idéntica (test de no-regresión D-02) | closed |
| T-75-09 | DoS | overlay light-plan / cadena de render | medium | mitigate | never-throws end-to-end: `readLightPlan` colapsa a `no-light-plan`/`error`; el renderer no lanza sobre líneas arbitrarias (suite 2253/0) | closed |
| T-75-SC | Tampering | instalaciones npm/pip/cargo | low | accept | Cero paquetes instalados (diff vacío en `package.json`/`package-lock.json` en todo el rango de la fase) — sin superficie supply-chain | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-75-01 | T-75-SC | La fase instala cero paquetes (invariante «cero deps npm nuevas»); sin superficie supply-chain que auditar | plan-time register (75-0x-PLAN.md) | 2026-07-17 |
| R-75-02 | — (advisory WR-01, 75-REVIEW.md) | El `NEXT:` llega a `cmux.send` del nudge sin `stripControlChars` — asimetría con el carril de render. Patrón preexistente: `summary`/`task_ref` ya viajan crudos al mismo sink desde antes de esta fase (limitación documentada); el sink es un workspace de terminal local del propio operador. No era un must-have del plan 75-02 ni una amenaza del registro. Candidato a follow-up de higiene (sanear los 3 campos en el mismo diff) en v0.18 | code review 75-REVIEW.md (advisory, 0 critical) | 2026-07-17 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-17 | 10 | 10 | 0 | gsd-secure-phase (L1 short-circuit — register plan-time completo, evidencia grep + code review 0 critical + suite 2253/0 + UAT 3/3) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-17
