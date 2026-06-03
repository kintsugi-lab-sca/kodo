---
phase: 35-datos-cliente-http-polling
plan: 02
subsystem: cli/dashboard (scheduling layer)
tags: [tui, polling, self-scheduling, single-flight, backoff, tdd]
requires:
  - "contrato {ok:true,data} | {ok:false,error} de fetchStatus (Plan 01 client.js) — vía DI del `fn`"
provides:
  - "usePoll(fn, onResult, deps, opts) — hook React que arranca el loop en useEffect y limpia en cleanup"
  - "runPollLoop(fn, onResult, opts) — scheduler puro (clock/schedule/cancel inyectables) testeable sin React"
affects:
  - "Plan 03 (App) consume usePoll: envuelve fetchStatus en `fn`, recibe cada {ok} vía onResult"
tech-stack:
  added: []
  patterns:
    - "Recursive setTimeout self-scheduling (versión React del startPolling.tick de src/triggers/polling.js)"
    - "Single-flight D-03: await fn ANTES de re-armar (≤1 request en vuelo)"
    - "Backoff por fallos consecutivos D-04: min(baseMs*2^failCount, maxMs), reset a baseMs al ok"
    - "AbortController re-creado por tick (D-05) + teardown cancelled+cancel+abort (D-09, Pitfall 9)"
    - "Scheduler extraído a función pura (runPollLoop) para test hermético sin host React (Discretion Open Question 2)"
key-files:
  created:
    - "src/cli/dashboard/usePoll.js — runPollLoop (scheduler puro) + hook usePoll"
    - "test/dashboard-poll.test.js — 4 escenarios single-flight/backoff-sube/backoff-resetea/teardown con DI clock+fn"
  modified: []
decisions:
  - "Scheduler extraído a `runPollLoop` (función pura) que el hook envuelve en useEffect: única vía hermética sin mock.module ni waitUntilExit (ink-testing-library@4)"
  - "scheduleTimeout/cancelTimeout separados de schedule/cancel: el timeout de abort de 5s (D-05) no contamina los intervals de backoff capturados por el fake clock"
  - "Backoff anclado a baseMs*2^failCount (contador de fallos consecutivos) en vez del literal interval*2: produce la secuencia exacta [2500,5000,10000,10000] que D-04 exige (interval*2 daría [5000,...] en el primer reintento)"
metrics:
  duration: "~12 min"
  completed: "2026-05-27"
  tasks: 2
  files: 2
  commits: 2
---

# Phase 35 Plan 02: Hook usePoll (self-scheduling polling) Summary

`usePoll` — loop de polling self-scheduling con recursive `setTimeout` (nunca `setInterval`) que garantiza single-flight (≤1 request en vuelo, D-03), backoff `2.5→5→10s` cap con reset al recuperar (D-04), timeout de 5s vía `AbortController` re-creado cada tick (D-05) y teardown limpio (cancelled flag + clearTimeout + abort, D-09). Scheduler extraído a la función pura `runPollLoop` (clock/fetch inyectables) para tests herméticos sin host React.

## What Was Built

- **`src/cli/dashboard/usePoll.js`** (NUEVO): `// @ts-check` + cabecera documentando responsabilidad + D-03/D-04/D-05/D-09 + invariante color-isolation. Importa `{ useEffect, useRef } from 'react'`. Constantes `BASE_MS=2500`, `MAX_MS=10000`, `TICK_TIMEOUT_MS=5000`.
  - **`runPollLoop(fn, onResult, opts)`** — función pura que arranca el loop y devuelve un teardown. Cada `tick` async: (1) `if (cancelled) return;`; (2) crea `ac = new AbortController()` (re-creado cada tick, D-05) + `scheduleTimeout(() => ac.abort(), 5000)`; (3) `result = await fn(ac.signal)` (await ANTES de re-armar = single-flight, D-03) en `try/finally` que cancela el timeout; (4) `if (cancelled) return;`; (5) `onResult(result)`; (6) backoff por `failCount` de fallos consecutivos → `interval`; (7) `timer = schedule(tick, interval)` (re-arma SOLO al final, recursivo). Kick-off vía `Promise.resolve().then(tick)`. Teardown: `cancelled = true; cancel(timer); ac?.abort();`.
  - **`usePoll(fn, onResult, deps, opts)`** — hook que guarda `fn`/`onResult` en `useRef` (no re-arma el efecto por render) y dentro de `useEffect` arranca `runPollLoop` con refs estables; el cleanup del efecto es el teardown que devuelve `runPollLoop`.
- **`test/dashboard-poll.test.js`** (NUEVO): 4 `it(...)` con DI hermética — fake clock (`schedule` captura intervals + `flushTick` dispara ticks manualmente, `scheduleTimeout` no-op para no contaminar intervals ni colgar timers) + fake `fn` con contador inFlight/maxInFlight. Helper `drain()` (vía `setImmediate`) drena cadenas de microtasks de profundidad variable. Cubre: single-flight (`maxInFlight === 1`), backoff sube `[2500,5000,10000,10000]`, backoff resetea a `2500` tras ok, teardown (spy de `cancel` + `signal.aborted` + ningún `onResult` tras cancelled).

## TDD Cycle

| Gate | Commit | Resultado |
|------|--------|-----------|
| RED  | `914a0fb` test(35-02) | 4 tests fallan por módulo ausente (usePoll.js) — Nyquist gate |
| GREEN | `ae21b93` feat(35-02) | 4 tests pasan; format-isolation 8/8 verde; suite global 914 pass + 1 skip |

REFACTOR: no necesario — código mínimo y limpio desde GREEN.

## Verification

- `node --test test/dashboard-poll.test.js` → tests 4, pass 4, fail 0 (single-flight `maxInFlight===1`, backoff sube/resetea, teardown) — TUI-05
- `node --test test/format-isolation.test.js` → tests 8, pass 8, fail 0 (color-isolation cubre usePoll.js automáticamente vía walker; 0 picocolors)
- `node --test` (suite global) → tests 915, pass 914, fail 0, skip 1 (startup-budget Decisión B pre-existente)

## Acceptance Criteria

### Task 1 (test, RED)
- [x] `test/dashboard-poll.test.js` existe e importa el scheduler (`runPollLoop`) desde `../src/cli/dashboard/usePoll.js`
- [x] `it(...)` para single-flight, backoff-sube, backoff-resetea, teardown (4 ≥ 4)
- [x] single-flight asserta `maxInFlight === 1`
- [x] backoff asserta secuencia `2500`/`5000`/`10000` + reset a `2500`
- [x] 0 `setInterval`; sin `await sleep` con timers reales (clock fake determinista)
- [x] RED antes de Task 2 (módulo ausente)

### Task 2 (impl, GREEN)
- [x] `usePoll.js` exporta `usePoll` (`grep "export function usePoll"` = 1)
- [x] recursive `schedule(tick, interval)`, NO `setInterval` (`grep -v '^//' | grep setInterval` = 0)
- [x] `await fn` ANTES de re-armar (single-flight); re-arma con `schedule(tick, interval)` al final
- [x] backoff con cap (`Math.min`) y reset a `baseMs` cuando `result.ok`
- [x] cleanup setea `cancelled = true`, llama `cancel(timer)` y `ac?.abort()`
- [x] `AbortController` nuevo por tick con `scheduleTimeout(abort, 5000)` (D-05)
- [x] 0 `picocolors` (`grep -v '^//' | grep picocolors` = 0)
- [x] `node --test test/dashboard-poll.test.js` pasa (GREEN)
- [x] `node --test test/format-isolation.test.js` verde

## Must-Haves Coverage

- [x] Poll self-scheduling: siguiente tick programado SOLO tras resolver el actual (≤1 request en vuelo) — verificado por test single-flight
- [x] Backoff 2.5→5→10s cap ante fallos consecutivos, reset a 2.5s al primer ok — verificado por backoff-sube + backoff-resetea
- [x] Teardown limpia timer + aborta controller (no setState tras unmount) — verificado por test teardown
- [x] D-04 (backoff + reset), D-05 (timeout 5s vía AbortController re-creado cada tick), D-09 (sin tick-id guard; cancelled + clearTimeout + abort) implementados
- [x] artifact `usePoll.js` contiene `export function usePoll`; `test/dashboard-poll.test.js` contiene `maxInFlight`
- [x] key_link `setTimeout(tick` (recursive, NO setInterval): re-arma SOLO tras await del tick

## Threat Model Coverage

- **T-35-03 (DoS self-inflicted, mitigate):** single-flight estricto (`await fn` antes de re-armar) + `AbortController` 5s por tick → un `/status` lento NO apila requests ni martillea el puerto; backoff cap 10s ante server caído. Cubierto por test single-flight (`maxInFlight === 1`) + backoff.
- **T-35-04 (fetch zombi / setState-tras-unmount, mitigate):** cleanup = `cancelled` flag + `cancel(timer)` + `ac.abort()` → al desmontar no queda timer activo ni fetch pegándole al server. Cubierto por test teardown (spy de `cancel` + `signal.aborted` + ningún `onResult` tras cancelled).
- **T-35-SC (tampering/npm installs, accept):** la fase NO instala paquetes; sin cambios.

No se introdujo superficie de seguridad nueva fuera del threat model.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Backoff anclado a `baseMs * 2^failCount` en vez del literal `interval * 2`**
- **Found during:** Task 2 (GREEN, al ejecutar los tests)
- **Issue:** La fórmula ilustrativa del plan `interval = result.ok ? baseMs : Math.min(interval*2, maxMs)` con `interval` inicial `= baseMs` produce `[5000, 10000, …]` en el primer reintento (2500*2), NO la secuencia `[2500, 5000, 10000, 10000]` que la spec D-04 exige literalmente. Además, el reset al primer ok no encajaba con "el siguiente interval vuelve a 2500" si el backoff se calculaba sobre el `interval` anterior.
- **Fix:** Contador de fallos CONSECUTIVOS (`failCount`): ante fallo `interval = Math.min(baseMs * 2 ** failCount, maxMs); failCount++`; al ok `failCount = 0; interval = baseMs`. Matemáticamente equivalente al doblado-con-cap pero anclado a base, de modo que el PRIMER reintento use `baseMs` (2^0) y la secuencia sea exactamente la especificada. Comentario de cabecera D-04 actualizado para documentar la fórmula real y por qué diverge de la ilustrativa.
- **Files modified:** `src/cli/dashboard/usePoll.js`
- **Commit:** `ae21b93`

### Discretion ejercida (no es deviation — el plan la autorizaba)

- **Scheduler extraído a `runPollLoop` (función pura):** Task 1/Task 2 autorizan explícitamente extraer el scheduler a una función pura testeable si la firma del hook no permite drivear el loop sin host React (ink-testing-library@4 sin `waitUntilExit`, node test runner sin `mock.module`). El hook `usePoll` envuelve `runPollLoop` en `useEffect`; el test ejercita `runPollLoop` directamente con clock+fn fakes.
- **`scheduleTimeout`/`cancelTimeout` como opciones separadas de `schedule`/`cancel`:** necesario para que el fake clock capture SOLO los intervals de re-arme (backoff) sin confundirlos con el timeout fijo de 5s (D-05), que en producción usa los timers reales por defecto.
- **`drain()` vía `setImmediate` en el test:** drena cadenas de microtasks anidadas (kick-off + `await fn`) de forma robusta frente a `await Promise.resolve()` de profundidad fija.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/cli/dashboard/usePoll.js
- FOUND: test/dashboard-poll.test.js
- FOUND commit: 914a0fb (test/RED)
- FOUND commit: ae21b93 (feat/GREEN)
