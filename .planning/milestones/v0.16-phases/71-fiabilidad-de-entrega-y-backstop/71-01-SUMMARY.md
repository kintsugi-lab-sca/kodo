---
phase: 71-fiabilidad-de-entrega-y-backstop
plan: 01
subsystem: triggers
tags: [polling, dispatch, cursor, watermark, sentinel, node-test, plane, github]

# Dependency graph
requires:
  - phase: 28-polling-daemon-hardening
    provides: "processRepo con clock inyectable, retry-loop never-throws, shouldDispatch/classifyPattern, saveStateCache atómico, envelope {status,items,etag,rate_limit_remaining}"
  - phase: 25-polling-trigger
    provides: "carril polling fire-and-forget, first-tick anti-storm (T-25-04), guardrail T-25-02"
provides:
  - "Dispatch del carril polling confirmado con await+timeout mockeable (confirmDispatch)"
  - "Watermark escalar acotado por debajo de min(updated_at de dispatch fallidos) en ambos paths (client/provider)"
  - "Opción dispatchTimeoutMs en StartPollingOpts/processRepo (default 30000, DI para tests)"
  - "Centinela observed en el state cache que separa «cache ausente» de «observado con cursor vacío»"
affects: [72-higiene-dx, backstop-session-end, polling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Promise.race([dispatchFn, timeoutPromise]) con clock.setTimeout para confirmación de entrega mockeable"
    - "Watermark escalar acotado bajo min(fallidos) con comparación lexicográfica ISO 8601 (sin Date)"
    - "Centinela booleano aditivo y retrocompatible en el state cache (mutación de shape sin migración)"

key-files:
  created: []
  modified:
    - src/triggers/polling.js
    - test/triggers/polling.test.js

key-decisions:
  - "D-02 opción (a) simplificada: si el máximo exitoso cruza o iguala min(fallidos), el cursor retrocede a prev.last_updated_at (correcto, conservador; garantiza re-dispatch del fallido)"
  - "D-03: dispatchTimeoutMs default 30000 ms, inyectable por opts para tests con clock virtual"
  - "D-04: nombre del centinela = observed (booleano); check estricto prev.observed !== true"
  - "confirmDispatch definido como función local dentro de processRepo (cierra sobre dispatchFn), firma (event, clock, timeoutMs) tal como el plan"

patterns-established:
  - "Confirmación de entrega: await+timeout con clock inyectable; el vencimiento cuenta como reintento, nunca throw fatal"
  - "Watermark acotado: recolectar failedUpdatedAts durante el loop y topar el cursor bajo min(fallidos)"
  - "Centinela de primer tick desacoplado del cursor, persistido con o sin items"

requirements-completed: [DELIV-01, DELIV-02]

coverage:
  - id: D1
    description: "El dispatch del carril polling se confirma con await+timeout mockeable; un dispatch que rechaza o vence NO avanza el cursor sobre ese issue y se reintenta el siguiente tick"
    requirement: DELIV-01
    verification:
      - kind: unit
        ref: "test/triggers/polling.test.js#DELIV-01: dispatch que TIMEOUT (nunca resuelve) → clasificado fallido, el tick no se cuelga"
        status: pass
      - kind: unit
        ref: "test/triggers/polling.test.js#DELIV-01: dispatch que RECHAZA no crashea el loop y emite polling.error dispatch-unconfirmed"
        status: pass
    human_judgment: false
  - id: D2
    description: "Watermark escalar acotado por debajo de min(fallidos): [A-falla @00, B-ok @05] → cursor < A y A re-dispara en el 2º tick, en los paths client y provider (Pitfall #2)"
    requirement: DELIV-01
    verification:
      - kind: unit
        ref: "test/triggers/polling.test.js#[A falla @00, B ok @05] → cursor por debajo de A; 2º tick RE-dispara A (client path)"
        status: pass
      - kind: unit
        ref: "test/triggers/polling.test.js#[A falla @00, B ok @05] → cursor acotado; 2º tick RE-dispara A (provider path)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Centinela observed separa «cache ausente» (primer tick → skip+poblar+marcar) de «observado con cursor vacío» (dispatch normal); persiste con o sin items; la rama 304 no lo escribe; entrada legacy sin observed = primer tick"
    requirement: DELIV-02
    verification:
      - kind: unit
        ref: "test/triggers/polling.test.js#primer tick (cache ausente) → NO dispara, persiste observed:true y puebla cursor"
        status: pass
      - kind: unit
        ref: "test/triggers/polling.test.js#primer tick SIN items → igualmente persiste observed:true (evita re-storm futuro)"
        status: pass
      - kind: unit
        ref: "test/triggers/polling.test.js#rama 304 → cursor preservado, cache NO escrito (no marca observed) (D-06)"
        status: pass
      - kind: unit
        ref: "test/triggers/polling.test.js#entrada legacy { last_updated_at } sin observed → tratada como primer tick (skip+poblar+marcar)"
        status: pass
    human_judgment: false
  - id: D4
    description: "El webhook (src/triggers/webhook.js) sigue fire-and-forget — sin cambios"
    requirement: DELIV-01
    verification:
      - kind: unit
        ref: "git diff --stat src/triggers/webhook.js (vacío) + node --test test/webhook.test.js (7 pass)"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-07
status: complete
---

# Phase 71 Plan 01: Fiabilidad de entrega del carril polling Summary

**El dispatch del carril polling deja de ser fire-and-forget: se confirma con await+timeout mockeable, el watermark escalar del cursor queda acotado bajo el mínimo de los dispatch fallidos, y un centinela `observed` separa «cache ausente» de «observado con cursor vacío» — el webhook queda intacto.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-07T07:35:35Z
- **Completed:** 2026-07-07T07:43:17Z
- **Tasks:** 2 (TDD: 4 commits test→feat)
- **Files modified:** 2

## Accomplishments
- **DELIV-01:** `confirmDispatch` reemplaza el `dispatchFn(...).catch(...)` fire-and-forget por un `Promise.race([dispatchFn, timeout])` con `clock.setTimeout` (mockeable) y `clearTimeout` en `finally`; el rechazo o el vencimiento cuentan como no confirmado y nunca relanzan (D-01/D-03, Pitfall #4).
- **DELIV-01/D-02 (Pitfall #2, la trampa central):** el `updated_at` solo avanza `maxUpdatedAt` si el issue no requería dispatch o si su dispatch confirmó; los fallidos se acumulan en `failedUpdatedAts` y el cursor se acota estrictamente por debajo de `min(failedUpdatedAts)` (comparación lexicográfica ISO 8601), retrocediendo a `prev.last_updated_at` si el máximo exitoso cruza ese mínimo. Verificado en los paths client y provider.
- **DELIV-02:** `shouldDispatch` decide el skip de primer tick por `prev.observed !== true` (no por `!prev.last_updated_at`), separando «cache ausente» de «cursor vacío» (bug M10); el path 200 persiste `observed:true` siempre (con o sin items), la rama 304 no lo escribe (D-06) y una entrada legacy sin `observed` se trata como primer tick.
- El webhook (`src/triggers/webhook.js`) queda sin cambios (fire-and-forget legítimo, Plane re-entrega).

## Task Commits

Cada task se commiteó atómicamente (TDD test→feat):

1. **Task 1: Dispatch confirmado + watermark acotado (DELIV-01)**
   - `afdbad1` (test) — tests de timeout/rechazo + [A-falla, B-ok] client y provider
   - `3976758` (feat) — `confirmDispatch`, loop reestructurado, watermark acotado, opción `dispatchTimeoutMs`
2. **Task 2: Centinela observed (DELIV-02)**
   - `86a8d32` (test) — tests del centinela + `observed:true` en pre-cursores existentes
   - `5101ff1` (feat) — `shouldDispatch` por centinela, persistencia en path 200, typedefs

**Plan metadata:** _(commit de cierre docs — ver git log)_

## Files Created/Modified
- `src/triggers/polling.js` — `confirmDispatch` (await+timeout), loop del cursor con separación exitoso/fallido y watermark acotado, opción `dispatchTimeoutMs`, `shouldDispatch` por centinela `observed`, persistencia de `observed` en path 200, typedefs de cache actualizados.
- `test/triggers/polling.test.js` — reemplazo de los 2 tests de contrato fire-and-forget por su equivalente await+timeout; nuevos describes `DELIV-01 watermark acotado` y `DELIV-02 centinela observed`; `observed:true` añadido a los pre-cursores de los tests que simulan «no primer tick».

## Decisions Made
- **Watermark (D-02):** se usó la opción (a) simplificada del research (Ejemplo 2): `newCursor = maxUpdatedAt < minFailed ? maxUpdatedAt : prev.last_updated_at`. Correcta y conservadora — garantiza que el fallido re-dispare sin depender de la inclusividad exacta de `since` (Pitfall #3: el gate local estricto `>` es la verdad).
- **Timeout (D-03):** default 30000 ms, inyectable vía `opts.dispatchTimeoutMs` para que los tests usen un valor pequeño con el clock virtual.
- **Centinela (D-04):** nombre `observed`, check estricto `prev.observed !== true`.
- **Emisión de fallo:** un dispatch no confirmado emite `pollingError(logger, {owner, repo, status:0, attempt:0, error:'dispatch-unconfirmed'})` (evento `polling.error`), tal como especifica el plan.

## Deviations from Plan

Ninguna desviación de alcance. Se actualizaron dos tests preexistentes que verificaban el contrato **obsoleto** fire-and-forget, porque DELIV-01 cambia ese contrato intencionadamente:

- `dispatchTrigger is fire-and-forget (no await)` → reescrito como `DELIV-01: dispatch que TIMEOUT ... el tick no se cuelga` (el dispatch ahora SÍ se awaitea con timeout).
- `dispatch rejection does not crash loop` → actualizado para verificar el evento `polling.error` con `error:'dispatch-unconfirmed'` (antes esperaba `polling.dispatch.failed`) y que el cursor no avanza sobre el issue rechazado.

Además, la migración del gate de primer tick a `observed` (DELIV-02) obligó a añadir `observed:true` a los pre-cursores de los tests existentes que simulaban «segundo tick» (patrones a/b-c, PR filter, provider-only, POLL-FIX-01, NDJSON). Esto es el comportamiento retrocompatible documentado en el plan (una entrada sin `observed` = primer tick). No hubo cambios de código fuera de `polling.js`.

**Total deviations:** 0 de alcance (actualizaciones de test derivadas del cambio de contrato planificado).
**Impact on plan:** Ninguno — el plan se ejecutó tal como está escrito.

## Issues Encountered
Ninguno. La suite completa quedó en verde (1893 pass, 1 skip, 0 fail); el test flaky preexistente de `state-lock.js` (Fase 70) no se activó en esta ejecución.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DELIV-01 y DELIV-02 completos; el carril polling ahora garantiza entrega y distingue primer tick.
- Pendientes en la fase (otros planes): DELIV-03 (idempotencia de adopt por `task_url`, plan 71-02) y DELIV-04 (backstop In Review en SessionEnd, plan 71-03).
- Nota de secuenciación: Fase 72 (HYG-04) editará el mismo `session-end.js` que DELIV-04; el ROADMAP ya secuencia 72 tras 71.

## Self-Check: PASSED

- Files verified: `71-01-SUMMARY.md`, `src/triggers/polling.js`, `test/triggers/polling.test.js` (all present).
- Commits verified: `afdbad1`, `3976758`, `86a8d32`, `5101ff1` (all in history).

---
*Phase: 71-fiabilidad-de-entrega-y-backstop*
*Completed: 2026-07-07*
