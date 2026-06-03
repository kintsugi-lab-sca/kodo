# Phase 30: SessionRecord Lifecycle - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-20
**Phase:** 30-sessionrecord-lifecycle
**Areas discussed:** findSession return shape, markSessionStatus success return, session_id source en falsy task_id, cmux RPC cross-check scope

---

## G1 — findSession return shape

| Option | Description | Selected |
|--------|-------------|----------|
| B: Tagged `{id, session, source: 'sessions'\|'history'}` | Discriminated union explícita. Alineado con patrón dispatcher `{action, code}`. Callers existentes que solo usan `r.session` siguen funcionando sin cambio; futuros callers pueden reaccionar a `source: 'history'` sin parsear timestamps. | ✓ |
| A: Transparente `{id, session}` con id sintético | Más simple. Callers que necesiten distinguir hacen `'archived_at' in session`. id sintético para history = `session.task_id`. | |
| A+: `{id, session}` SIN id sintético (returns null id para history) | Variante de A. id solo para sessions activas. Rompe contrato implícito de `r.id`. | |

**User's choice:** B (Tagged with source field) — recomendado.
**Notes:** El patrón discriminated union ya está validado en el codebase (dispatcher.js `{action, code}` post Phase 29-01) — consistencia arquitectónica.

---

## G2 — markSessionStatus success return shape

| Option | Description | Selected |
|--------|-------------|----------|
| Simétrico completo: `{ok:true, from, to}` / `{ok:false, reason}` | Discriminated union completa. Callers existentes (verify.js#267, stop.js#188) no capturan return — siguen funcionando. Tests pueden assertear shape determinístico. `from, to` ayuda observabilidad. | ✓ |
| Asimétrico: `undefined` / `{ok:false, reason}` | Mínimo cambio sobre API actual. Más fiel a "preservan semántica externa" (SC#2) pero rompe destructuring de `{ok}`. | |
| Simétrico mínimo: `{ok:true}` / `{ok:false, reason}` | Sin metadata extra. Punto medio test-friendly. Expandible sin breaking change. | |

**User's choice:** Simétrico completo con `from, to` en success path.
**Notes:** Captura transition data (prevStatus → nextStatus) para futura observabilidad sin requerir cambio de signature. Tests pueden assertear `result.from === 'in_progress' && result.to === 'review'`.

---

## G3 — session_id source en warn cuando task_id es falsy

| Option | Description | Selected |
|--------|-------------|----------|
| A: 5º param `sessionId` opcional | Nueva firma `markSessionStatus(taskId, status, reason, log, sessionId?)`. Callers existentes tienen `session.session_id` en scope — pasan explícito. Si no se provee → `session_id: 'unknown'`. Mínimo cambio. | ✓ |
| B: Cambiar a `markSessionStatus(session, status, reason, log)` | Recibe SessionRecord. Más expresivo pero rompe callers + tests + complica caso bootstrap (session no existe todavía). | |
| C: Reemplazar `session_id` por `task_id` literal del falsy value | Cero cambio signature. Pérdida de info (task_id falsy = `null`/`''`). Desvía del SC#2 literal. | |

**User's choice:** A (5º param opcional).
**Notes:** Compatible con callers actuales (verify.js#267 y stop.js#188 tienen `session.session_id` en scope — lo pasan explícito). Cambio mínimo de firma + máxima observabilidad. Default `'unknown'` para callers que no provean.

---

## G4 — cmux RPC cross-check scope

| Option | Description | Selected |
|--------|-------------|----------|
| Diferido a Phase 30.1 si resurge el desync | Mantiene Phase 30 chico (2 refactors core). Memoria `kodo_state_json_desync.md` mantiene la observación viva. Si LIFE-01 no cierra el desync empíricamente, planificamos Phase 30.1 como gap-closure. | ✓ |
| In-scope: Plan 30-03 con cmux RPC cross-check | Cierra desync completamente en una phase. ~150 LOC + mock cmux rpc. Riesgo: acoplamiento al contrato interno de cmux. | |
| Documentar deuda en STATE.md sin Plan | Nota en Open Blockers. Cero código, visibilidad media. | |

**User's choice:** Diferido a Phase 30.1 condicional.
**Notes:** Phase 30 cierra LIFE-01 + LIFE-02 clásicos. Si después del despliegue de Phase 30 surge un nuevo incidente tipo ROMAN-132 (state.sessions vacío con sesión viva en cmux), se planifica Phase 30.1 con el cross-check. La deuda persiste en memoria del usuario, no en repo.

---

## Claude's Discretion

- **Internal helper extraction**: Si `findSession` se vuelve ilegible al añadir el segundo scan loop, Claude puede extraer un helper privado `findInBucket(bucket, query)`. No requiere consulta.
- **JSDoc updates**: Actualizar JSDoc de `findSession` (nuevo `source` field) y `markSessionStatus` (nuevo signature + return shape). Discreción.
- **Logger child shape en falsy path**: emitir warn desde logger raw o desde child sin task_id. Decisión menor — Claude elige según legibilidad.

## Deferred Ideas

- cmux RPC cross-check → Phase 30.1 condicional (ver G4).
- `updateSession` observability para archived sessions → future phase si surge necesidad.
- `markSessionStatus` async logging (sink externo Sentry) → out of scope.
- `findSession` con TTL/cache → no necesario hoy (history cap 50).
- Renombrar tests existentes flat → `test/session/` subdirectorio (mass-rename = scope creep).
