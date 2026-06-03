---
phase: 35-datos-cliente-http-polling
plan: 03
subsystem: cli/dashboard (presentation layer)
tags: [tui, ink, react, keep-last-good, status-line, tdd]
requires:
  - "fetchStatus(baseUrl, fetchFn, signal) → {ok:true,data}|{ok:false,error} (Plan 01 client.js)"
  - "usePoll(fn, onResult, deps, opts) — hook self-scheduling + opts de clock inyectables (Plan 02 usePoll.js)"
provides:
  - "App({baseUrl, fetchFn, now, schedule, cancel, scheduleTimeout, cancelTimeout, baseMs, maxMs}) — status line viva D-01 con keep-last-good + dos estados de degradación"
affects:
  - "Phase 36 (tabla columnar) sustituye el nodo central por la tabla viva; reusa el patrón usePoll+keep-last-good ya cableado aquí"
tech-stack:
  added: []
  patterns:
    - "Keep-last-good en App (D-06, Pattern 3): onResult en fallo NO toca lastGoodCount/lastGoodAt"
    - "Derivación pura de 3 estados de render (waiting/stale/live) desde connected + lastGoodAt"
    - "Edad recalculada por poll (D-08): lastAttemptAt-lastGoodAt, sin timer de 1s (anti Pitfall 8)"
    - "Inyección de fetchFn + clock fakes vía props para render hermético (igual que baseUrl en Phase 34)"
    - "Color SOLO de <Text color> de ink (green/yellow/dimColor); cero picocolors (invariante D-12)"
key-files:
  created:
    - "test/dashboard-status-line.test.js — 4 escenarios (keep-last-good, waiting, live, JSON corrupto) vía ink-testing-library + fakes inyectados"
  modified:
    - "src/cli/dashboard/App.js — status line viva: usePoll(fetchStatus) + keep-last-good + 3 estados; reemplaza el placeholder de Phase 34"
    - "test/dashboard-render.test.js — assert del nodo central de arranque actualizado a 'waiting for server' (mínimo; banner + q→exit intactos)"
decisions:
  - "Estado keep-last-good vive en App (Discretion Open Question 2), no en usePoll: lastGoodCount/lastGoodAt/connected/lastError/lastAttemptAt en useState"
  - "Reloj `now` inyectable (default Date.now) además de fetchFn + opts de clock: la edad de D-08 se asserta determinísticamente en el test sin timers reales"
  - "El test de render de Phase 34 inyecta un fetchFn NEVER_FETCH (poll que nunca resuelve): el frame inicial es 'waiting for server' y ningún re-render por onResult contamina el conteo de frames del q→exit"
metrics:
  duration: "~10 min"
  completed: "2026-05-27"
  tasks: 2
  files: 3
  commits: 2
---

# Phase 35 Plan 03: Status line viva (keep-last-good + dos estados) Summary

`App` reemplaza el placeholder estático del cuerpo (Phase 34) por una **status line viva** (D-01): cablea `usePoll((signal) => fetchStatus(baseUrl, fetchFn, signal), onResult, [baseUrl], clockOpts)` y mantiene en React el estado de keep-last-good + connection + edad, derivando **tres estados de render** — `● live` (verde) + `N sessions` al conectar, `⚠ server caído` (amarillo) + `N sessions (last update Ns ago, retrying…)` cuando el server cae a mitad (keep-last-good, D-06), y `waiting for server` al arrancar sin dato bueno. JSON corrupto / ECONNREFUSED / HTTP no-ok llegan como poll fallido (D-07), nunca como crash del árbol ink. Cierra TUI-06 de forma observable.

## What Was Built

- **`src/cli/dashboard/App.js`** (MODIFICADO): cabecera reescrita para Phase 35 (status line viva + D-01/D-06/D-07/D-08). Imports extendidos: `{ createElement, useCallback, useState } from 'react'` + `{ fetchStatus } from './client.js'` + `{ usePoll } from './usePoll.js'` (preservando `Box, Text, useApp, useInput, useStdin` de ink).
  - **Firma de inyección:** `App({ baseUrl, fetchFn, now = Date.now, schedule, cancel, scheduleTimeout, cancelTimeout, baseMs, maxMs })`. `baseUrl` NO cambia; el resto son props opcionales que caen a defaults runtime (`globalThis.fetch` / `Date.now` / timers reales) y se inyectan como fakes en tests.
  - **Estado keep-last-good (React):** `lastGoodCount`, `lastGoodAt`, `connected`, `lastError`, `lastAttemptAt` (useState).
  - **`onResult` (useCallback):** en `result.ok` → `setLastGoodCount(data.count ?? data.sessions.length)`, `setLastGoodAt(now())`, `setConnected(true)`, `setLastError(null)`; en `!result.ok` → `setConnected(false)`, `setLastError(error)` y **NO** toca `lastGoodCount`/`lastGoodAt` (keep-last-good, D-06/Pitfall 5); siempre `setLastAttemptAt(now())` (edad por poll, D-08).
  - **Derivación pura de render:** `connected` → live; `!connected && lastGoodAt != null` → stale con `ageSec = Math.round(((lastAttemptAt ?? lastGoodAt) - lastGoodAt)/1000)`; `lastGoodAt == null` → waiting.
  - **Markup:** solo el nodo central se reemplaza (el banner `kodo dashboard` y el footer `q quit` se conservan); color SOLO de props `<Text color>` (green/yellow/dimColor); lifecycle `q`→`exit()` + `useInput` gateado por `isRawModeSupported` intactos.
- **`test/dashboard-status-line.test.js`** (NUEVO): 4 `it(...)` con render hermético vía `ink-testing-library`. Fake clock (`makeFakeClock`) provee `schedule`/`cancel`/`scheduleTimeout`(no-op)/`cancelTimeout`/`now`/`advance` + `flushTick` para avanzar el loop manualmente; `drain()` vía `setImmediate` drena las microtasks + re-renders de ink. Escenarios: keep-last-good (succeed×2-then-throw conserva `3 sessions` + `server caído`), waiting (fetch falla desde el primer tick → `waiting for server` sin contador), live (`● live` + `5 sessions`), JSON corrupto (`json()` que lanza → estado stale, frame sobrevive sin crash).
- **`test/dashboard-render.test.js`** (MODIFICADO mínimamente): el assert del nodo central de Phase 34 (`starting…`) se actualiza al nuevo nodo de arranque (`waiting for server`); ambos renders inyectan `fetchFn: NEVER_FETCH` (poll que nunca resuelve) para que el frame inicial sea determinista y ningún re-render por `onResult` contamine el conteo de frames del q→exit. Cobertura de banner + q→exit intacta.

## TDD Cycle

| Gate | Commit | Resultado |
|------|--------|-----------|
| RED  | `99c39fa` test(35-03) | 4 tests fallan: App aún renderiza el placeholder e ignora fetchFn/clock |
| GREEN | `a3f2f69` feat(35-03) | 4 status-line + 2 render + 8 format-isolation = 14 pass; suite global 916/915 |

REFACTOR: no necesario — el código quedó mínimo y limpio desde GREEN.

## Verification

- `node --test test/dashboard-status-line.test.js` → 4 pass (keep-last-good, waiting, live, JSON corrupto) — TUI-06 observable
- `node --test test/dashboard-render.test.js` → 2 pass (chrome banner/q-quit + q→exit de Phase 34 preservados)
- `node --test test/format-isolation.test.js` → 8 pass (App.js sin picocolors; walker automático)
- `npm test` (suite global) → tests 916, pass 915, fail 0, skip 1 (startup-budget Decisión B, pre-existente)

## Acceptance Criteria

### Task 1 (test, RED)
- [x] `test/dashboard-status-line.test.js` existe e importa `App` + `render` de `ink-testing-library`
- [x] 4 `it(...)`: keep-last-good, waiting, live, JSON-corrupto (`grep -c "it(" == 4`)
- [x] keep-last-good asserta que `lastFrame()` conserva `3 sessions` Y muestra `server caído`/`retrying`
- [x] `grep -c "waitUntilExit" == 0`
- [x] Inyecta `fetchFn`/clock fakes vía props (`grep -c "globalThis.fetch" == 0`)
- [x] ROJO antes de Task 2

### Task 2 (impl, GREEN)
- [x] App consume `usePoll(` (2) y `fetchStatus` (5)
- [x] `onResult` en fallo NO setea `lastGoodCount`/`lastGoodAt` (verificado por test keep-last-good)
- [x] `grep -c "starting…" == 0` y conserva `kodo dashboard` + `q quit`
- [x] Status line muestra `● live` / `⚠ server caído` / `waiting for server` según estado derivado
- [x] Color SOLO de `<Text>`: `grep -v '^//' | grep -c picocolors == 0`
- [x] Lifecycle `q`→`exit()` + `useInput` gateado preservado (`grep -q "exit()"`)
- [x] `node --test test/dashboard-status-line.test.js` GREEN
- [x] `node --test test/dashboard-render.test.js` verde (assert de placeholder actualizado al nuevo nodo, banner/q-exit intactos)
- [x] `node --test test/format-isolation.test.js` verde

## Must-Haves Coverage

- [x] App refresca desde `GET /status` (vía usePoll(fetchStatus)) y muestra `● live` + `N sessions` al conectar
- [x] Server cae a mitad → conserva el último count (keep-last-good) + `⚠ server caído` + `(last update Ns ago, retrying…)`
- [x] Server caído al arrancar (sin dato bueno) → `waiting for server` sin contador
- [x] JSON corrupto = poll fallido (mismo path que ECONNREFUSED), nunca crash del render
- [x] D-02 (status line viva, no headless), D-06 (dos estados de degradación), D-08 (edad por poll, sin timer de 1s) implementados
- [x] key_link `usePoll(` presente; color de connection state SOLO de ink (`color:` en `<Text>`)

## Threat Model Coverage

- **T-35-05 (DoS / crash del render ante poll fallido, mitigate):** `fetchStatus` (Plan 01) es never-throws + keep-last-good en App → JSON corrupto / ECONNREFUSED / HTTP no-ok caen TODOS al path `{ok:false}` (estado stale), el árbol ink JAMÁS recibe un throw. Cubierto por el test "JSON corrupto = poll fallido" (el frame sobrevive y conserva el contador).
- **T-35-06 (inyección ANSI en render de texto untrusted, accept esta fase):** Phase 35 solo renderiza el contador numérico `N sessions` + copy estático, no texto libre de tareas — sin superficie de inyección ANSI aquí (documentado para Phase 36/38).
- **T-35-07 (information disclosure vía lastError, accept):** el copy mostrado es unificado (`server caído`/`retrying…`), NO el `err.message` crudo; el `lastError` se guarda en estado pero no se renderiza. El `baseUrl` no aparece en el banner de degradación.
- **T-35-SC (npm installs, accept):** la fase NO instala paquetes; sin cambios de deps.

No se introdujo superficie de seguridad nueva fuera del threat model.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] El test de render de Phase 34 inyecta `fetchFn: NEVER_FETCH` para mantenerse hermético**
- **Found during:** Task 2 (GREEN, al re-ejecutar `test/dashboard-render.test.js`)
- **Issue:** Tras cablear `usePoll(fetchStatus)`, `App` rendido con solo `baseUrl` dispararía `globalThis.fetch` real contra `localhost:9090` en el test de render. El re-render por `onResult` (al fallar el fetch real con ECONNREFUSED) podía añadir frames extra y contaminar el assert de control "una tecla ignorada NO debe producir frames extra" del q→exit, además de tocar la red.
- **Fix:** Inyectar un `fetchFn = () => new Promise(() => {})` (NEVER_FETCH, nunca resuelve) en los tres renders del test de render. El frame inicial queda determinista (`waiting for server`) y ningún re-render por polling altera el conteo de frames. Cambio mínimo y justificado autorizado explícitamente por el criterio de aceptación de Task 2 (actualizar el assert al nuevo nodo central sin eliminar la cobertura de banner/q-exit).
- **Files modified:** `test/dashboard-render.test.js`
- **Commit:** `a3f2f69`

### Discretion ejercida (no es deviation — el plan la autorizaba)

- **Estado keep-last-good vive en App (Discretion Open Question 2):** el plan deja explícito que el keep-last-good + connection display state vive en `App`, no en el hook. Se modeló con 5 `useState` + un `onResult` memoizado con `useCallback`.
- **Reloj `now` inyectable además de fetchFn/clock:** para assertar la edad de D-08 (`last update Ns ago`) determinísticamente sin timers reales, `App` acepta `now` (default `Date.now`) y el fake clock provee `advance(ms)`. No cambia el contrato runtime (default es `Date.now`).
- **El nodo central live/stale usa `Math.round(((lastAttemptAt ?? lastGoodAt) - lastGoodAt)/1000)`:** el `?? lastGoodAt` cubre el caso degenerado (edad 0) si `connected` cae sin haber registrado aún un `lastAttemptAt` posterior — defensivo, nunca produce `NaN` ni edad negativa.

## Known Stubs

None. El `useState(null)` inicial (`lastGoodCount`/`lastGoodAt`/`lastAttemptAt` = null al arranque) NO es un stub: es el estado de arranque que deriva legítimamente al estado `waiting for server` de D-06 (comportamiento esperado por diseño hasta el primer poll).

## Self-Check: PASSED

- FOUND: src/cli/dashboard/App.js
- FOUND: test/dashboard-status-line.test.js
- FOUND: test/dashboard-render.test.js (modificado)
- FOUND commit: 99c39fa (test/RED)
- FOUND commit: a3f2f69 (feat/GREEN)
