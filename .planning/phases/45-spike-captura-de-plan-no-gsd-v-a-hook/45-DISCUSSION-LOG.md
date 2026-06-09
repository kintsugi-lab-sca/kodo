# Phase 45: Spike — captura de plan no-GSD vía hook - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-09
**Phase:** 45-spike-captura-de-plan-no-gsd-v-a-hook
**Mode:** `--auto` (Claude seleccionó la opción recomendada en cada gray area)
**Areas discussed:** Método experimental, Eventos de hook a evaluar, Criterio del veredicto, Contrato de captura si VIABLE, Estructura del documento

---

## Método experimental del spike

| Option | Description | Selected |
|--------|-------------|----------|
| Experimento real instrumentado | Hook de prueba temporal que loguea el payload + sesión real `--dangerously-skip-permissions` reproducible | ✓ |
| Análisis documental | Concluir desde la doc de Claude Code sin ejecutar | |

**User's choice:** Experimento real instrumentado (recommended default)
**Notes:** Success Criteria #1 exige "evidencia reproducible" — el análisis documental no la produce. El hook de prueba se instala/desinstala manualmente vía el patrón de `src/hooks/install.js`, no se commitea.

---

## Eventos de hook a evaluar

| Option | Description | Selected |
|--------|-------------|----------|
| ExitPlanMode primario + barrido fallback | `PostToolUse`/`ExitPlanMode` como hipótesis; si no dispara, barrido de eventos soportados | ✓ |
| Solo ExitPlanMode | Evaluar un único evento y concluir | |

**User's choice:** ExitPlanMode primario + barrido de eventos soportados (recommended default)
**Notes:** Plausible que skip-permissions evite el gate de plan y `ExitPlanMode` no se emita; el barrido (PreToolUse/PostToolUse/UserPromptSubmit/Stop/Notification) evita un INVIABLE prematuro. Nunca desciende a transcript crudo.

---

## Criterio del veredicto binario

| Option | Description | Selected |
|--------|-------------|----------|
| Capturable = plan + correlación | El payload debe contener el texto del plan Y `session_id`/`cwd` correlacionable | ✓ |
| Capturable = el evento dispara | Basta con que el hook se active | |

**User's choice:** Plan + correlación (recommended default)
**Notes:** Un evento que dispara sin portar el plan o sin correlación no sirve para Phase 46 → cuenta como INVIABLE.

---

## Contrato de captura si VIABLE

| Option | Description | Selected |
|--------|-------------|----------|
| Contrato propio correlacionado por task_id | kodo persiste en su propio side vía `findSession` (session_id/cwd→task_id) | ✓ |
| Parsing de rutas internas de Claude Code | Leer `~/.claude/plans/` u otras rutas | |

**User's choice:** Contrato propio correlacionado por task_id (recommended default)
**Notes:** Espejo de `session-start.js`; rutas internas son frágiles/no documentadas (out of scope). Define 5 puntos: evento, campo del payload, dónde persiste, correlación, reuso del overlay de Phase 44. Si INVIABLE, difiere PLAN-04 a v2 sin bloquear el milestone.

---

## Estructura y ubicación del documento

| Option | Description | Selected |
|--------|-------------|----------|
| `45-SPIKE.md` veredicto-first | Veredicto arriba + método + evidencia + contrato/diferir | ✓ |
| Notas informales | Registro libre sin estructura fija | |

**User's choice:** `45-SPIKE.md` veredicto-first (recommended default)
**Notes:** El planner/roadmapper de Phase 46 lee el veredicto en la primera línea para decidir ejecutar vs cortar a v2.

---

## Claude's Discretion

- Tarea/tool concreta para forzar plan mode en la sesión de prueba y formato del log de instrumentación.
- Barrido de eventos como matriz (varios a la vez) vs secuencial.
- Ubicación del fichero de log temporal (p. ej. `/tmp/kodo-spike-*.log`).

## Deferred Ideas

- Implementación de captura/persistencia → Phase 46 (PLAN-04, condicional).
- Parsear transcript JSONL / `~/.claude/plans/` / `~/.claude/todos/` → fuera de scope permanente.
- Mostrar todos/Tasks en vivo → v2 (PLAN-F2).
</content>
