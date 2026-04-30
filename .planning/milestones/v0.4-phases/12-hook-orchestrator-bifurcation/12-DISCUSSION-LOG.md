# Phase 12: Hook & Orchestrator Bifurcation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-28
**Phase:** 12-hook-orchestrator-bifurcation
**Areas discussed:** SessionStart quick branch, Stop hook nudge quick, Orchestrator tag switch, Sección Sesiones GSD

---

## SessionStart quick branch

### Q1 — Header del bloque

| Option | Description | Selected |
|--------|-------------|----------|
| Mismo header | `# kodo TASK-X — GSD Mode` para los 3 casos. Menos branching de strings, modo distinguido por contenido. | ✓ |
| Header específico | `# kodo TASK-X — GSD Quick Mode` sólo para quick. Pista visual al humano lector de transcript. | |

**User's choice:** Mismo header (Recommended)
**Notes:** Coherencia con full, simetría con D-11 Phase 9.

### Q2 — Brief en quick branch

| Option | Description | Selected |
|--------|-------------|----------|
| Sí, brief si existe | `if (session.brief) lines.push(brief, '');` luego comando. Simétrico con bootstrap full. | ✓ |
| Nunca brief en quick | Quick es one-shot, agente lee desde Plane. | |
| Solo si no hay phase_id | Equivalente de hecho a la primera (quick+match no persiste brief). | |

**User's choice:** Sí, brief si existe (Recommended)
**Notes:** Patrón D-11 Phase 9 replicado. En quick+match no aplica porque dispatcher no persiste brief.

### Q3 — Escape del title

| Option | Description | Selected |
|--------|-------------|----------|
| Reemplazar `"` por `'` | `title.replace(/"/g, "'")` antes de envolver. Simple, predecible. | ✓ |
| Escape con backslash | Preserva contenido pero parser inconsistente. | |
| Sin escape | Frágil con titles que contengan `"`. | |

**User's choice:** Reemplazar comillas dobles por simples (Recommended)
**Notes:** Slash command parser de Claude Code interpreta backslashes inconsistentemente.

### Q4 — Header de la sección interna

| Option | Description | Selected |
|--------|-------------|----------|
| Mismo `## GSD Workflow` | Coherencia con full. Menos divergencia. | ✓ |
| `## GSD Quick Workflow` | Distingue visualmente. Más literales que mantener. | |

**User's choice:** Mismo `## GSD Workflow` (Recommended)

---

## Stop hook nudge quick

### Q1 — Tono y contenido del nudge

| Option | Description | Selected |
|--------|-------------|----------|
| Explicitar quick + revisión manual | `"… Es una sesión GSD quick (one-shot, sin VERIFICATION.md). Revísala manualmente como cualquier sesión no-GSD."` | ✓ |
| Texto idéntico al no-GSD | Reusa branch no-GSD; orchestrator no sabe que era quick. | |
| Mensaje específico más breve | `"… ha terminado en modo quick. Revísala manualmente."` sin VERIFICATION.md mention. | |

**User's choice:** Explicitar quick + revisión manual (Recommended)
**Notes:** Da contexto al orchestrator de por qué NO ejecuta verify. Enlaza con párrafo de prompt.md.

### Q2 — Acción concreta sugerida

| Option | Description | Selected |
|--------|-------------|----------|
| Sólo revisión manual | Limita a "revísala manualmente". Quick es deliberadamente liviano. | ✓ |
| Sugerir convertir a fase si crece | Añade guía pero scope creep. | |

**User's choice:** Sólo revisión manual (Recommended)
**Notes:** KISS.

### Q3 — Estructura del branch

| Option | Description | Selected |
|--------|-------------|----------|
| switch sobre getSessionMode | Exhaustivo, simétrico con D-09 Phase 11. | ✓ |
| if/else if anidado | Equivalente semánticamente, menos claro. | |

**User's choice:** switch sobre getSessionMode (Recommended)

---

## Orchestrator tag switch

### Q1 — Prioridad del switch

| Option | Description | Selected |
|--------|-------------|----------|
| Modo primero, fase después | `if (mode === 'quick') 'quick'; else if (s.phase_id) 'phase N'; else 'bootstrap'`. | ✓ |
| Fase primero, modo después | Reusa switch existente pero phase_id residual oscurecería quick. | |
| switch (mode) | Más limpio pero anida lógica en case 'full'. | |

**User's choice:** Modo primero, fase después (Recommended)
**Notes:** Defensa en profundidad ante phase_id residual.

### Q2 — Inline vs helper

| Option | Description | Selected |
|--------|-------------|----------|
| Inline en buildContextSummary | Un solo callsite. YAGNI. | ✓ |
| Helper `buildGsdTag(session)` | Exportable, testeable aislado. | |

**User's choice:** Inline en buildContextSummary (Recommended)

### Q3 — Tag para sesiones no-GSD

| Option | Description | Selected |
|--------|-------------|----------|
| Mantener cadena vacía | Status quo Phase 10 D-19. | ✓ |
| Tag explícito `[no-GSD]` | Más claro pero scope creep. | |

**User's choice:** Mantener cadena vacía (Recommended)

---

## Sección `## Sesiones GSD` en prompt.md

### Q1 — Alcance del cambio

| Option | Description | Selected |
|--------|-------------|----------|
| Patch incremental | Mantener 4 pasos full. Añadir párrafo dedicado a quick. Diff mínimo. | ✓ |
| Reescritura completa | Reorganizar en sub-secciones por modo. Más limpio pero diff grande. | |

**User's choice:** Patch incremental (Recommended)

### Q2 — Ubicación del párrafo

| Option | Description | Selected |
|--------|-------------|----------|
| Al final, después del 'No dupliques…' | Modo principal primero, excepción después. Cierra con invariante. | ✓ |
| Al inicio, antes de los 4 pasos full | Avisar de dos modos antes del principal. Rompe cadencia. | |
| Como sub-sección `### Quick` al final | Subdividir con h3. Rompe flujo lineal h2. | |

**User's choice:** Al final, después del 'No dupliques…' (Recommended)

### Q3 — Contenido del párrafo (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Identificación: `[GSD quick]` en pizarra | Conecta pizarra con comportamiento esperado. | ✓ |
| Exclusión: NO ejecutes `kodo gsd verify` | Refuerza invariante one-shot. | ✓ |
| Acción: revísalas como cualquier sesión no-GSD | Cierra el flujo. Coherente con nudge D-08. | ✓ |
| Justificación: porque son one-shot sin VERIFICATION.md | Añade el por-qué. Útil si agente intenta razonar. | ✓ |

**User's choice:** Las 4 piezas (identificación + exclusión + acción + justificación)
**Notes:** Párrafo final D-16 incorpora las 4 piezas en una sola oración.

---

## Claude's Discretion

- Naming exacto de variables locales en cada función (decidir en planning siguiendo convenciones del archivo).
- Granularidad de plans: 4 plans (uno por punto) vs 2 plans (hooks + orchestrator/prompt).
- Orden interno de líneas dentro del bloque quick de buildGsdContext (siguiendo D-11 Phase 9).
- Si el escape de title se inline o se extrae a constante local.

## Deferred Ideas

- Variantes adicionales de quick (e.g., `kodo:gsd-quick-research`) — YAGNI, patrón D-07 ya lo permite.
- Helper `buildGsdTag(session)` exportado — extraer cuando haya 2+ callsites.
- Lectura programática de `QUICK-NOTES.md` — out-of-scope.
