# Phase 35: Datos — cliente HTTP + polling - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-27
**Phase:** 35-datos-cliente-http-polling
**Areas discussed:** Superficie visible, Cadencia + backoff, UX de "server caído", Late-response guard

---

## Superficie visible tras Phase 35

| Option | Description | Selected |
|--------|-------------|----------|
| Status line mínima viva | Reemplaza `starting…` por conexión + `N sessions` + banner stale; sin tabla columnar (Phase 36). Verificable e independiente, satisface TUI-06. | ✓ |
| Lista cruda sin estilo | Lista básica de task_refs para probar el flujo; riesgo de código desechable y bleed de Phase 36. | |
| Headless (solo data + tests) | Solo client.js+usePoll.js+tests, App sin tocar. NO satisface TUI-06 ("muestra estado server caído") ni el criterio #1 observable. | |

**User's choice:** Status line mínima viva (recomendada)
**Notes:** Decisión central de frontera Phase 35↔36. El research ordena "tabla estática antes de polling", pero el roadmap partió las fases al revés (35=datos, 36=tabla), por lo que la status line es el render mínimo que hace observable TUI-06 sin invadir 36. Mockup con `● live` / `⚠ server caído` aprobado vía preview.

---

## Cadencia de polling + backoff

| Option | Description | Selected |
|--------|-------------|----------|
| 2.5s base · backoff 2.5→5→10s · timeout 5s | Base research-aligned, backoff con cap 10s + reset-on-success, timeout generoso (single-flight no apila). | ✓ |
| 2s base · backoff 2→4→8s · timeout 2s | Más snappy (fiel a "~2s" del ROADMAP) + timeout agresivo; riesgo de abortar polls legítimos sobre /status caro. | |
| Valores al planner | Dejar números al planner desde el research. | |

**User's choice:** 2.5s base · backoff 2.5→5→10s · timeout 5s (recomendada)
**Notes:** `/status` es caro (Plane API + cmux.listWorkspaces). Single-flight estricto con `setTimeout` recursivo, nunca `setInterval`.

---

## UX de "server caído"

| Option | Description | Selected |
|--------|-------------|----------|
| 2 estados · copy unificado · edad en cada tick | `waiting for server` (arranque) vs `stale, retrying` (mid-session keep-last-good); un copy honesto para todo fallo; edad recalculada por poll, no timer 1s (Pitfall 8). | ✓ |
| Copy por clase de error | Mensajes distintos por ECONNREFUSED / 5xx / JSON corrupto; más código, el research dice que la clase informa recuperación no copy. | |
| Edad con timer de 1s | `last update Ns ago` avanza cada segundo; fuerza re-render/seg, choca con Pitfall 8. | |

**User's choice:** 2 estados · copy unificado · edad en cada tick (recomendada)
**Notes:** keep-last-good no blanquea la tabla al primer fallo; JSON corrupto se trata como poll fallido vía `{ok:false}`, nunca throw a React.

---

## Late-response guard

| Option | Description | Selected |
|--------|-------------|----------|
| No — single-flight + cancelled flag basta | ≤1 request en vuelo → ninguna respuesta tardía pisa datos frescos; cancelled flag + abort-on-unmount cubren teardown; tick-id sería YAGNI. | ✓ |
| Sí — tick-id de defensa | id monotónico por tick descartando respuestas no-últimas; redundante hoy con single-flight. | |

**User's choice:** No — single-flight + cancelled flag basta (recomendada)
**Notes:** Reconsiderar solo si en el futuro se permite solapamiento de requests.

---

## Claude's Discretion

- Partición de `client.js` (solo `fetchStatus` en esta fase vs todas las funciones).
- Firma exacta de `usePoll` y ubicación del estado backoff/connection (hook vs App).
- Profundidad de validación de shape del payload (research recomienda mínima).
- Markup exacto de la status line respetando D-01 + color-isolation.

## Deferred Ideas

- Tabla columnar + selección por `task_id` + orden estable + color + contadores + filtros → Phase 36 (TUI-07..12).
- `fetchComments`/`fetchLogs` en `client.js` → Phase 38 (TUI-15/16).
- Guard de tick-id monotónico → YAGNI (D-09).
- Copy diferenciado por clase de error → descartado (D-07).
