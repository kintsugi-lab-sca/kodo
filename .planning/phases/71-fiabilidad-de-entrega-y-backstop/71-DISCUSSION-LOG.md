# Phase 71: Fiabilidad de entrega y backstop - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-07
**Phase:** 71-Fiabilidad de entrega y backstop
**Mode:** --auto (opciones recomendadas auto-seleccionadas, sin prompts interactivos)
**Areas discussed:** DELIV-01 avance de cursor, DELIV-02 centinela de primer tick, DELIV-03 idempotencia de adopt, DELIV-04 backstop en SessionEnd

---

## DELIV-01 — Avance de cursor con dispatch confirmado

| Option | Description | Selected |
|--------|-------------|----------|
| await+timeout, watermark acotado por debajo del min de fallidos | El carril polling awaitea el dispatch; el cursor avanza solo sobre issues confirmados/no-dispatch y se topa por debajo del `updated_at` mínimo de los fallidos | ✓ |
| Hold total del cursor si algún dispatch del tick falla | Conservador: cualquier fallo congela el cursor entero hasta el siguiente tick | |
| Mantener fire-and-forget (status quo) | Rechazado — es la causa raíz T4 | |

**Choice (auto):** await+timeout con watermark acotado (recomendado); hold-total documentado como alternativa aceptable.
**Notes:** Sutileza clave (D-02): el cursor es un watermark escalar, así que «no sumar el updated_at del fallido» no basta — hay que topar el watermark por debajo del mínimo de fallidos o el `since` del siguiente tick lo saltaría. Webhook NO se toca.

---

## DELIV-02 — Centinela de primer tick

| Option | Description | Selected |
|--------|-------------|----------|
| Centinela explícito `observed:true` desacoplado de `last_updated_at` | La entrada de cache marca «repo ya observado» aparte del cursor; se persiste aunque el primer tick no traiga items | ✓ |
| Seguir infiriendo de `!prev.last_updated_at` | Rechazado — conflaciona «cache ausente» con «cursor vacío» (raíz M10) | |

**Choice (auto):** centinela explícito (recomendado).
**Notes:** Debe persistirse incluso sin items (hoy `cache[key]` solo se escribe con items) para no tratar un repo vacío como «primer tick» indefinidamente. Preservar anti-storm T-25-04 y la rama 304.

---

## DELIV-03 — Idempotencia de adopt por `task_url`

| Option | Description | Selected |
|--------|-------------|----------|
| Lookup por estado local (0-token) antes de createTask | Reconciliar por `task_url` recuperado de state.json (sessions+history) / re-run de recuperación; provider-side como fallback | ✓ |
| Lookup provider-side por url siempre | Un GET extra por adopt contra el provider; más red, menos determinista | |

**Choice (auto):** estado local determinista (recomendado), provider-side solo si la identidad no es recuperable localmente.
**Notes:** Eje DISTINTO del guard `sessionId` ya existente (`adopt.js:245`). Cierra la ventana PERSIST_FAILED/re-adopción que hoy dispara un `createTask` duplicado. El researcher debe reproducir la ventana exacta.

---

## DELIV-04 — Backstop mecánico de «In Review» en SessionEnd

| Option | Description | Selected |
|--------|-------------|----------|
| Gate por `getTaskState==In Progress` + reason limpio, capability-gated, fail-open a transicionar | El hook transiciona + comenta «cierre automático» solo si la tarea sigue en trigger y la sesión cerró limpia; no-op si el LLM ya transicionó | ✓ |
| Transicionar siempre al cierre | Rechazado — pisaría estados legítimos del LLM (done/blocked) | |
| Dejarlo solo en el LLM (status quo) | Rechazado — es la causa raíz T5 | |

**Choice (auto):** backstop gated + idempotente (recomendado).
**Notes:** Reusa el patrón de transición de `verify.js:257-265` (`states.review`, Pitfall #1). «Limpia» = `end_reason` normal (fail-open a transicionar: el coste de un falso «In Review» es bajo). Coordinar con Fase 72 HYG-04 (mismo hook).

---

## Claude's Discretion
- Valor exacto del timeout de confirmación de dispatch y del backoff.
- Nombre del campo centinela (`observed` vs `first_tick_done`).
- Elección final watermark-acotado (a, recomendado) vs hold-total (b).
- Clave y mecanismo exactos del lookup por `task_url` (local vs provider-side) y forma del retorno idempotente.
- Criterio preciso de «reason limpio» según los `end_reason` reales de Claude Code.
- Ubicación/estilo de los tests (`node:test`).

## Deferred Ideas
- HYG-04 (mover color/notify/nudge de `Stop` a `SessionEnd`) → Fase 72.
- `Retry-After` en 429 del cliente Plane (PLANE-F1/M7) y demás diferidos a v2.
- Unificar webhook con la garantía de entrega del polling → explícitamente rechazado (webhook confía en re-entrega de Plane).
