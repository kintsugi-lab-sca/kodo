# Phase 42: Dismiss — TUI read-write + server amplification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-05
**Phase:** 42-dismiss-tui-read-write-server-amplification
**Areas discussed:** UX de confirmación inline, Contrato del server amplificado, Fallo parcial / worktree dirty, Feedback de éxito + refresco

---

## UX de confirmación inline

### Modelo del estado de confirmación
| Option | Description | Selected |
|--------|-------------|----------|
| Nuevo `mode:'confirm'` modal | Añadir 'confirm' al union de mode; captura task_id, teclado modal (espejo filter/overlay) | ✓ |
| Estado efímero en footer sin nuevo modo | Reusar patrón footer-error Phase 37, `pendingDismiss`, mezcla routing con mode list | |

### Mecánica de teclas
| Option | Description | Selected |
|--------|-------------|----------|
| Doble-`d` (d arma, d confirma) | Literal de DISMISS-02; dos pulsaciones de la misma tecla destructiva | ✓ |
| `d` arma → `y` confirma | Tecla distinta para el commit; diverge del texto de DISMISS-02 | |

### Auto-cancel por tiempo
| Option | Description | Selected |
|--------|-------------|----------|
| No — solo Esc / otra tecla cancela | Sin timers; el re-check alive al confirmar ya protege | ✓ |
| Sí — auto-cancela tras ~3-5s | Evita armado indefinido pero añade setTimeout a limpiar en teardown | |

### Otras teclas en confirm
| Option | Description | Selected |
|--------|-------------|----------|
| Cancela el armado (clear-on-any-input) | Espejo del clear-on-any-input de Phase 37; solo `d` ejecuta | ✓ |
| Se traga (solo d/Esc responden) | Como el sub-modo overlay; deja la TUI 'pegada' en confirm | |

### Render bajo confirm
| Option | Description | Selected |
|--------|-------------|----------|
| Sigue viva (NO congelar) | Re-check alive contra snapshot más reciente (TOCTOU correcto) | ✓ |
| Congela snapshot (espejo overlay) | Consistencia visual pero revalida contra datos stale | |

**User's choice:** mode:'confirm' modal · doble-`d` · sin auto-cancel · cualquier tecla ≠ d/Esc cancela · render NO congelado.
**Notes:** El no-congelar es deliberado para que el re-check TOCTOU del segundo `d` use datos frescos del poll.

---

## Contrato del server amplificado

### Body de respuesta del DELETE
| Option | Description | Selected |
|--------|-------------|----------|
| Detalle de acciones saneadas | `{ok, removed, actions:[{type, result}]}` reusando el reporte de doctor.execute | ✓ |
| Simple `{ok, removed}` | Shape mínimo actual; ciega a la TUI sobre saneos parciales | |

### Dónde vive el guard alive===false
| Option | Description | Selected |
|--------|-------------|----------|
| Defensa en profundidad (TUI + server 409 + doctor) | 3 capas; el server deja de confiar ciegamente en el cliente | ✓ |
| Solo TUI + no-op de doctor | Menos código pero el server queda crédulo ante clientes/races | |

**User's choice:** body con `actions[]` · guard en profundidad (TUI guard inverso + server 409 + doctor no-op).
**Notes:** El guard server-side (re-lee alive fresco con loadState) ES el re-check TOCTOU de SC#3.

---

## Fallo parcial / worktree dirty

### Reflejo del saneo parcial en el footer
| Option | Description | Selected |
|--------|-------------|----------|
| Mensaje distinguible según actions[] | Éxito total vs 'worktree preservado (.dirty)' / 'con avisos' | ✓ |
| Genérico 'dismissed' siempre | Detalle solo en NDJSON; operador no ve el .dirty sin logs | |

### Invocación de la mutación (regla 'no await desnudo')
| Option | Description | Selected |
|--------|-------------|----------|
| await dismissSession() never-throws | Nuevo helper en client.js espejo de fetchComments; handler async lo awaitea | ✓ |
| Fire-and-forget con .catch al footer | Más simple pero pierde el actions[] estructurado | |

**User's choice:** footer distinguible según actions[] · `await dismissSession()` never-throws.
**Notes:** dismissSession nunca lanza → cumple 'no await desnudo' y preserva el invariante no-crash de v0.9.

---

## Feedback de éxito + refresco

### Cómo desaparece la fila
| Option | Description | Selected |
|--------|-------------|----------|
| Poll natural (sin refresh forzado) | Desaparece en ≤2.5s; único escritor del estado de la tabla | ✓ |
| Refresh optimista + reconciliación | Instantáneo pero 2º escritor que puede divergir | |
| Forzar un poll inmediato post-ok | Sin optimistic pero añade trigger manual al scheduler single-flight | |

### Mensaje de éxito en el footer
| Option | Description | Selected |
|--------|-------------|----------|
| Efímero, clear-on-any-input (espejo Phase 37) | Un patrón de footer transitorio para éxito/parcial/error | ✓ |
| Sin mensaje (la fila que se va es el feedback) | Minimal pero pierde la distinción limpio/.dirty | |

**User's choice:** poll natural sin refresh forzado · mensaje efímero clear-on-any-input.
**Notes:** El cursor post-dismiss ya lo resuelve resolveSelection (clamp por identidad, Phase 36) — sin código nuevo.

---

## Claude's Discretion

- Firma exacta de `dismissSession` y DI del handler de `d`.
- De dónde re-lee el server el `alive` fresco para el 409 (`loadState`/`findSession`).
- Eventos NDJSON del path dismiss (`session.dismissed` vs reuso de `doctor.fix.*`).
- Si el server reusa `execute({taskId})` tal cual o añade un wrapper que traduzca el reporte al body `actions[]`.
- Copy literal exacta del footer (constantes exportadas, molde Phase 37).

## Deferred Ideas

- Dismiss/force-kill de sesiones vivas (otra capacidad, otra fase).
- Auto-cancel del armado por timeout (reconsiderar si UAT lo pide).
- Refresh optimista (promover solo si el lag <2.5s molesta).
- Borrar el `.ndjson` de la sesión al descartarla (caduca por mtime>7d global).
- Flags por-categoría en el DELETE (YAGNI; execute barre worktree+lock+entrada en bloque).
