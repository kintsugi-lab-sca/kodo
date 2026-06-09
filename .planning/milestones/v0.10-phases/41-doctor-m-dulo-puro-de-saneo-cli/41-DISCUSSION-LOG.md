# Phase 41: Doctor — módulo puro de saneo + CLI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 41-doctor-m-dulo-puro-de-saneo-cli
**Areas discussed:** Flags y superficie CLI, Forma del módulo (→ Phase 42), UX de seguridad de --fix
**Areas offered but not selected:** Limpieza de logs (resuelta como discreción anclada al roadmap, D-12)

---

## Flags y superficie CLI

### `--json`
| Option | Description | Selected |
|--------|-------------|----------|
| Sí, --json | Consistente con inspect/verify/polling/skill; byte-determinista para scripting; consumible por dashboard/Phase 42 | ✓ |
| No, sólo human-readable | Menos superficie; el módulo puro ya devuelve objeto estructurado | |

### Scoping por categoría
| Option | Description | Selected |
|--------|-------------|----------|
| Siempre las 4 juntas | Mínima superficie; acotado fino vive en la API por taskId, no en flags CLI | ✓ |
| Flags por categoría | --worktrees/--locks/--logs/--zombies; más control, más superficie | |

### `--dry-run` explícito
| Option | Description | Selected |
|--------|-------------|----------|
| No, default ya es dry-run | "doctor mira, doctor --fix arregla"; --fix único opt-in | ✓ |
| Sí, --dry-run explícito | No-op documental redundante | |

**User's choice:** --json sí · siempre las 4 categorías · sin --dry-run explícito
**Notes:** Las 3 recomendaciones aceptadas. Minimiza superficie CLI; el acotado fino se delega a la API del módulo.

---

## Forma del módulo (→ Phase 42)

### API shape
| Option | Description | Selected |
|--------|-------------|----------|
| scan() + execute() separados | Detección pura vs saneo; espeja dry-run/fix y reconcileTick/runReconcileTick | ✓ |
| Una función con flag apply | Menos exports; mezcla modos y complica el return tipado | |

### Acotado por taskId (lo que dismiss reusa)
| Option | Description | Selected |
|--------|-------------|----------|
| worktree + lock + entrada de state | Justo lo que necesita la tecla `d`; logs fuera del dismiss | ✓ |
| Todo lo de esa sesión incl. logs | Acopla dismiss a retención; puede borrar log aún útil | |

### TOCTOU: ¿execute() consume scan()?
| Option | Description | Selected |
|--------|-------------|----------|
| Re-detecta + recheck por acción | execute() detección fresca + isPidAlive/alive antes de cada acción; no recibe plan stale | ✓ |
| execute(plan) recibe reporte de scan() | Menos trabajo duplicado pero riesgo TOCTOU; el recheck sigue siendo obligatorio | |

**User's choice:** scan()+execute() separados · execute({taskId}) = worktree+lock+state · re-detecta+recheck por acción
**Notes:** Decisión de mayor apalancamiento — define el contrato de dependencia dura de Phase 42. Las 3 recomendaciones aceptadas.

---

## UX de seguridad de --fix

### Confirmación
| Option | Description | Selected |
|--------|-------------|----------|
| Directo | dry-run-default ya es el ritual de 2 pasos; guard real = recheck liveness; prompt rompe CI | ✓ |
| Confirmación salvo --yes | Capa humana extra; complejidad TTY + flag más | |

### Preview del dry-run
| Option | Description | Selected |
|--------|-------------|----------|
| Sí, acción exacta por ítem | remove vs prune vs move-a-.dirty; steal vs keep; unlink. dry-run confiable | ✓ |
| Sólo lista qué está sucio | Más compacto, menos transparente | |

### Reportar recursos vivos protegidos
| Option | Description | Selected |
|--------|-------------|----------|
| Resumen breve de protegidos | Confianza en nunca-tocar-vivo; no altera exit code | ✓ |
| Sólo basura accionable | Más conciso, sin evidencia de lo respetado | |

**User's choice:** --fix directo · dry-run previsualiza acción exacta · resumen de protegidos
**Notes:** Las 3 recomendaciones aceptadas. El guard de seguridad es estructural (recheck liveness por acción + dry-run-default), no un prompt.

---

## Claude's Discretion
- Firma exacta de scan()/execute() y deps inyectadas (molde runReconcileTick/runStopHook)
- Estructura del reporte de scan() (serializable a --json, consumible por Phase 42)
- Si execute() global invoca sweepRetention para polling-*.log o sólo barre .ndjson huérfanos (reusar constante 7d)
- Eventos NDJSON doctor.* (molde worktreeCleanup* / *.api.call.failed)
- Concurrencia del barrido (serial aceptable)

## Deferred Ideas
- Flags por-categoría en el CLI (promover si operador lo pide)
- Confirmación interactiva / --yes en --fix (reconsiderar si UAT revela borrados accidentales)
- Borrar el .ndjson de una sesión al descartarla en Phase 42 (acopla dismiss a retención)
- TTL/retención de logs configurable por env (KODO_DOCTOR_LOG_RETENTION_DAYS)
</content>
