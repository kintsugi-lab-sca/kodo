# Phase 40: Provider State — contrato + providers + enrichment - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-03
**Phase:** 40-provider-state-contrato-providers-enrichment
**Areas discussed:** Cache (TTL + scope), Forma de la fila (ok/unsupported/fetch-failed), Tabla de mapeo Plane

---

## Selección de gray areas

Presentadas 4. El usuario seleccionó 3 para discutir; la 4ª (Honestidad GitHub `in_review`) se delegó a Claude para decidir según los invariantes del roadmap.

| Área | Discutida |
|------|-----------|
| Honestidad GitHub in_review | No (decidida por Claude) |
| TTL + scope del cache | ✓ |
| Forma de la fila: ok/unsupported/fetch-failed | ✓ |
| Tabla de mapeo Plane | ✓ |

---

## Cache (TTL + scope)

| Option | Description | Selected |
|--------|-------------|----------|
| Map por task_id, TTL 30s, dedup in-flight | Cache independiente `Map<task_id,{state,reason,ts}>`, TTL 30s reusando `PENDING_CACHE_TTL_MS`, dedup in-flight por task_id, clave task_id sola | ✓ |
| TTL 10s, sin dedup | Más fresco pero más presión sobre la API; riesgo de ráfagas concurrentes | |
| TTL configurable por env | `KODO_PROVIDER_STATE_TTL_MS` con default 30s; knob extra | |

**User's choice:** Map por task_id, TTL 30s, dedup in-flight (Recommended)
**Notes:** Cache independiente del `pendingCache` (forma distinta — por fila vs por provider). Reusa la constante de TTL existente para consistencia.

---

## Forma de la fila (ok/unsupported/fetch-failed)

| Option | Description | Selected |
|--------|-------------|----------|
| Flat + reason explícito | `provider_state: string\|null` + `provider_state_reason: null\|'unsupported'\|'fetch-failed'`. Byte-additivo, espeja `listComments`/`supported` de v0.9 | ✓ |
| Omitir el campo (literal PSTATE-04) | No aparece el campo si falla/no soporta; Phase 43 no podría distinguir unsupported de fetch-failed | |
| Objeto anidado {state, reason, supported} | Sub-objeto con bool supported redundante; más verboso | |

**User's choice:** Flat + reason explícito (Recommended)
**Notes:** Resuelve la tensión PSTATE-04 ("omite el campo") vs Phase 43 criterio 2 ("distingue 3 estados reusando supported/reason"). Se reinterpreta "omitir" como `state=null` con reason poblado, no campo ausente. Documentado en CONTEXT.md (D-06).

---

## Tabla de mapeo Plane

| Option | Description | Selected |
|--------|-------------|----------|
| Substring del nombre primero, luego grupo | name 'review'→in_review, 'block'→blocked (substring gana sobre grupo); cancelled→done, backlog→unknown, started/unstarted→in_progress | ✓ |
| Igual, pero cancelled → unknown | Misma precedencia pero cancelled→unknown (más honesto, pero cancelada se vería como unknown) | |
| Grupo primero (estricto) | Mapeo por grupo canónico, substring sólo dentro de started; arriesga perder 'In Review' | |

**User's choice:** Substring del nombre primero, luego grupo (Recommended)
**Notes:** El substring del name gana sobre el grupo porque 'In Review'/'Blocked' viven dentro de `started` — mapear por grupo perdería la señal del driver ROMAN-150. cancelled→done (terminal). Comparación `String.includes` case-insensitive (anti-ReDoS).

---

## Claude's Discretion

- **Honestidad GitHub `in_review`** (área no seleccionada, decidida por Claude según roadmap): convention-driven por labels (substring `review`/`block`), fallback open→in_progress / closed→done, sin llamadas API extra, documentado explícitamente como convención. Ver D-11/D-12 en CONTEXT.md.
- **Concurrencia del enrichment** (serial vs `Promise.allSettled` con cap): el criterio de éxito 3 ya acota el comportamiento; decisión del planner. Fail-open por fila → `allSettled` si se paraleliza.
- **Firma exacta de `getTaskState`** y **fields del evento NDJSON**: seguir patrones existentes por-provider.

## Deferred Ideas

- Leer review-state de PRs linkeados en GitHub (vs sólo labels) — descartado por coste/acoplamiento; reconsiderar si labels resulta insuficiente.
- TTL configurable por env — descartado para v1.
- Render + filtro de `provider_state` — es Phase 43 (PSTATE-05/06), no deferred.
