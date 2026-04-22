# Phase 10: Orchestrator Verification Gate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 10-orchestrator-verification-gate
**Areas discussed:** Arquitectura del gate, Contrato VERIFICATION.md, Semántica del bloqueo, Comentario Plane, Canal de metadata GSD al orquestador

---

## Arquitectura del gate

### Q1: ¿Dónde se ejecuta la lógica del gate (read VERIFICATION.md + decide verdict + comentar Plane + transition)?

| Option | Description | Selected |
|--------|-------------|----------|
| Orquestador Claude via CLI determinista | El orquestador invoca un nuevo CLI `kodo gsd verify <session-id>` que hace parsing determinista. Paralelo a `kodo gsd inspect` (Phase 9 D-04). | ✓ |
| Hook stop automático | El gate corre paralelo a `releaseGsdLock`. Determinista pero mueve Plane al hook. | |
| Slash command dentro de la sesión GSD | `/gsd-ship` llama a kodo. Mantiene orquestador pasivo. | |

**User's choice:** Orquestador Claude via CLI determinista

### Q2: ¿Introducimos un nuevo CLI dedicado para el gate?

| Option | Description | Selected |
|--------|-------------|----------|
| `kodo gsd verify <session-id\|phase>` | Nuevo subcomando paralelo a `inspect`. Exit codes + `--json`. | ✓ |
| Lógica interna en src/orchestrator/ sin CLI | Módulo privado. | |
| Modo de `kodo gsd inspect` | Unificar superficie CLI forense. | |

**User's choice:** Sí, `kodo gsd verify <session-id|phase>`

### Q3: ¿Quién emite el comentario Plane y ejecuta la transición de estado?

| Option | Description | Selected |
|--------|-------------|----------|
| kodo core via TaskProvider | `TaskProvider.addComment` + `updateTaskState`. Determinista, auditable. | ✓ |
| Orquestador Claude via MCP | Claude escribe vía su MCP. Pierde determinismo. | |
| Híbrido | kodo comenta; orquestador transiciona. | |

**User's choice:** kodo core via TaskProvider

### Q4: ¿Cuándo se dispara el gate automáticamente?

| Option | Description | Selected |
|--------|-------------|----------|
| Al final de sesión GSD (stop hook notifica orquestador; orquestador corre CLI) | Flujo actual: stop.js:116-125 ya envía nudge al orquestador. | ✓ |
| Síncrono en stop hook | Acopla Plane al hook. | |
| Manual / on-demand | Orquestador decide. | |

**User's choice:** Al final de sesión GSD (orquestador corre CLI en siguiente ronda)

---

## Contrato VERIFICATION.md

### Q5: ¿Qué define 'VERIFICATION.md completa' para el gate?

| Option | Description | Selected |
|--------|-------------|----------|
| Solo frontmatter YAML | `status: passed` AND `must_haves_verified === must_haves_total` AND `gaps_count === 0`. | ✓ |
| Solo escaneo de checkboxes markdown | `[x]` vs `[ ]`. Formato actual no los usa en tabla. | |
| Frontmatter + validación de tabla | Defensivo pero redundante. | |

**User's choice:** Solo frontmatter YAML

### Q6: ¿Cómo decidimos la lista de campos requeridos del frontmatter?

| Option | Description | Selected |
|--------|-------------|----------|
| Contrato mínimo fijo | `status`, `must_haves_total`, `must_haves_verified`, `gaps_count`. | ✓ |
| Solo `status` | Máxima flexibilidad, menor defensa. | |
| Contrato extendido | Incluir `requirements[]` + `human_verification_needed`. | |

**User's choice:** Contrato mínimo fijo

### Q7: ¿Qué hacer si `VERIFICATION.md` no existe?

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-closed (artefacto ausente = gate falla) | Verdict `missing`, exit 2, comentario Plane bloquea. Alineado con Phase 9 D-13. | ✓ |
| Auto-generar stub y fallar | Side effects en el gate. | |
| Tolerante — gate abstain | Rompe sem. GSD-05. | |

**User's choice:** Fail-closed

### Q8: ¿Qué status values distintos de `passed` son válidos + cómo se traducen a verdict?

| Option | Description | Selected |
|--------|-------------|----------|
| Conjunto cerrado conocido | `passed`→pass, `gaps_found`/`failed`→fail, otros→malformed. | ✓ |
| Binario: passed vs !passed | Menos informativo. | |
| Fail-open para status desconocido | Prohibido (fail-closed invariante). | |

**User's choice:** Conjunto cerrado conocido

---

## Semántica del bloqueo

### Q9: ¿Qué pasa con la tarea Plane cuando el gate falla?

| Option | Description | Selected |
|--------|-------------|----------|
| Queda en el estado actual + comentario (no-op en state) | kodo NO llama `updateTaskState`. Simple + reversible. | ✓ |
| Transicionar a estado dedicado 'Blocked' | Requiere config nueva; rompe genericidad. | |
| Revertir a Backlog + comentario | Hostil para providers nuevos. | |

**User's choice:** Queda en el estado actual + comentario

### Q10: ¿Qué pasa con la tarea Plane cuando el gate pasa?

| Option | Description | Selected |
|--------|-------------|----------|
| Transiciona a `config.states.review` + comentario de éxito | Mantiene flujo humano-approves-to-Done. | ✓ |
| Transiciona directo a `config.states.done` | Prohibido por REQUIREMENTS.md out-of-scope. | |
| Comentario sin transition (humano decide) | Rompe GSD-06 parcialmente. | |

**User's choice:** Transiciona a Review + comentario de éxito

### Q11: ¿El verdict del gate tiene categorías granulares o binario?

| Option | Description | Selected |
|--------|-------------|----------|
| Discriminated union (estilo Phase 9 D-02) | `{action:'pass'\|'fail'\|'missing'\|'malformed',...}`. Exhaustive switch. | ✓ |
| Binario pass/fail | Menos informativo. | |

**User's choice:** Discriminated union

### Q12: ¿Se retry el gate automáticamente cuando el humano corrige?

| Option | Description | Selected |
|--------|-------------|----------|
| Re-disparo manual vía webhook Plane | Alineado con GSD-F1 diferido. | ✓ |
| Auto-retry con watcher en `.planning/` | ADP-F5 scope creep. | |
| Comando CLI explícito `--re-run` | Fricción vs Plane trigger. | |

**User's choice:** Re-disparo manual vía webhook Plane

---

## Comentario Plane

### Q13: ¿El comentario Plane se postea en ambos outcomes o solo en fails?

| Option | Description | Selected |
|--------|-------------|----------|
| Siempre (pass + fail) | Cierra GSD-06 literal. | ✓ |
| Solo fails | Rompe GSD-06. | |
| Pass=notif cmux+transition silent; Fail=comment | Inconsistente con literal. | |

**User's choice:** Siempre (pass + fail)

### Q14: ¿Formato del comentario?

| Option | Description | Selected |
|--------|-------------|----------|
| Plantilla markdown determinista | kodo genera, no LLM. Greppable, auditable. | ✓ |
| JSON en el body | Ilegible en UI Plane. | |
| Prosa libre del orquestador Claude | No determinista. | |

**User's choice:** Plantilla markdown determinista

### Q15: ¿Idioma del comentario?

| Option | Description | Selected |
|--------|-------------|----------|
| Inglés | Consistente con buildGsdContext (Phase 8 D-04). | |
| Español | Consistente con prompt.md y notificaciones cmux. | ✓ |
| EN para fails, ES para pass | Híbrido dirigido. | |

**User's choice:** Español

### Q16: ¿Fallback si falla la API de Plane?

| Option | Description | Selected |
|--------|-------------|----------|
| Log error + stderr; verdict queda en NDJSON | Verdict nunca se pierde. Orquestador decide. | ✓ |
| Exit code 3 del CLI | Puede duplicar comentarios. | |
| Queue en disk + background retry | Scope creep. | |

**User's choice:** Log error + stderr; verdict queda en log NDJSON

---

## Canal de metadata GSD al orquestador

### Q17: ¿Cómo obtiene el orquestador el `phase_id` + `project_path`?

| Option | Description | Selected |
|--------|-------------|----------|
| Desde `~/.kodo/state.json` (SessionRecord ya persiste) | Phase 8+9 ya persisten los campos. Zero nuevos canales. | ✓ |
| Inyección por-sesión en contextSummary | Requiere extender launch.js. | |
| Nuevo endpoint CLI `kodo gsd sessions` | Duplica state.json. | |

**User's choice:** Desde `~/.kodo/state.json`

### Q18: ¿Cómo recibe el orquestador instrucciones sobre el flujo GSD?

| Option | Description | Selected |
|--------|-------------|----------|
| Extender `src/orchestrator/prompt.md` con sección GSD condicional | Una sola fuente. | ✓ |
| Prompt separado `prompt-gsd.md` | Bifurca launchOrchestrator. | |
| Skill GSD dedicada para el orquestador | Duplica instrucciones. | |

**User's choice:** Extender `src/orchestrator/prompt.md` con sección GSD condicional

### Q19: ¿El CLI `kodo gsd verify` acepta session-id, phase directa, o ambos?

| Option | Description | Selected |
|--------|-------------|----------|
| `<session-id>` — resuelve desde state.json | Paralelo a `inspect`. Session-id identidad end-to-end (Phase 8 CR-01). | ✓ |
| `--phase N --project PATH` sin session | Modo filesystem puro; no emite comentario Plane. | |
| Ambos — alternativos | Más superficie, más tests. | |

**User's choice:** `kodo gsd verify <session-id>` — resuelve todo desde state.json

### Q20: ¿Los artefactos (PROJECT.md + ROADMAP.md + PLAN.md) los lee el orquestador Claude o el CLI los embebe?

| Option | Description | Selected |
|--------|-------------|----------|
| Orquestador Claude los lee con Read | CLI retorna solo verdict. Respeta Phase 9 D-18. | ✓ |
| CLI embebe paths en el output | Helper mínimo. | |
| CLI inline el contenido | Inflama output, acopla al layout `.planning/`. | |

**User's choice:** Orquestador Claude los lee con su herramienta Read

---

## Claude's Discretion

Listado en CONTEXT.md `<decisions>`:
- Nombres exactos de `reason` en `{action:'fail'}` (`gaps-found`, `must-haves-incomplete`, `status-failed`).
- Implementación del parser YAML hand-rolled (regex vs mini-parser línea-a-línea).
- Exit codes del nuevo CLI (semántica 0=cualquier verdict entregado vs 0=solo pass).
- Detalle estético de la plantilla ES (emoji, prefijos, link a VERIFICATION.md).
- Idempotencia del comentario (deferred — puede no requerirse).
- Mecanismo de detección de "sesión en Review" por el orquestador (nudge extendido vs polling state.json).
- Organización concreta de tests (unit vs integración vs e2e).

## Deferred Ideas

Listado completo en CONTEXT.md `<deferred>`:
- Idempotencia estricta del comentario Plane.
- `kodo gsd verify --phase N --project PATH` sin session-id.
- `kodo gsd verify --dry-run`.
- Transición automática a Done tras pass (prohibido explícito).
- Slash command re-trigger (GSD-F1 v2).
- Multi-phase per task (GSD-F3 out-of-scope).
- File watcher sobre VERIFICATION.md.
- Comentarios Plane ricos (badges/mermaid/tablas).
- Dashboard/UI web.
- Multi-roadmap / monorepo (GSD-F2 v2).
- Parser YAML completo.
