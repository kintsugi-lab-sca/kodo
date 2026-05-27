---
phase: 35-datos-cliente-http-polling
plan: 01
subsystem: cli/dashboard (data layer)
tags: [tui, http-client, never-throws, tdd]
requires:
  - "GET /status del server kodo (src/server.js:397-411, READ ONLY)"
provides:
  - "fetchStatus(baseUrl, fetchFn?, signal?) → {ok:true,data} | {ok:false,error} (never-throws)"
  - "contrato de datos para usePoll (Plan 02) y App (Plan 03)"
affects:
  - "Plan 02 (usePoll) y Plan 03 (App) consumen este discriminante {ok}"
tech-stack:
  added: []
  patterns:
    - "Pattern 1 / D-07: never-throws {ok} discriminado (divergencia intencional vs plane/github clients que lanzan)"
    - "fetch inyectable opts.fetch || globalThis.fetch (forma copiada de github client.js:85, sin la propagación de excepciones)"
key-files:
  created:
    - "src/cli/dashboard/client.js — fetchStatus puro never-throws"
    - "test/dashboard-client.test.js — 5 escenarios del discriminante {ok}"
  modified: []
decisions:
  - "D-07/Pattern 1 implementado estructuralmente: el invariante no-crash de TUI-06 vive en el data layer, no en React"
  - "Validación mínima de shape: Array.isArray(data.sessions) → error:'bad shape' (Discretion del plan)"
  - "YAGNI: solo fetchStatus; fetchComments/fetchLogs diferidos a Phases 36/38"
metrics:
  duration: "~2 min"
  completed: "2026-05-27"
  tasks: 2
  files: 2
  commits: 2
---

# Phase 35 Plan 01: Cliente HTTP fetchStatus Summary

`fetchStatus` — cliente HTTP puro React-free que consume `GET /status` y nunca lanza: colapsa ECONNREFUSED, HTTP no-ok, JSON corrupto y shape inválida al discriminante `{ok:true,data}` / `{ok:false,error}` (D-07, Pattern 1).

## What Was Built

- **`src/cli/dashboard/client.js`** (NUEVO): exporta `fetchStatus(baseUrl, fetchFn = globalThis.fetch, signal)`. Cuerpo dentro de `try/catch`:
  1. `const res = await fetchFn(\`${baseUrl}/status\`, { signal })`
  2. `if (!res.ok) return { ok:false, error: \`HTTP ${res.status}\` }` (D-07)
  3. `const data = await res.json()` (JSON corrupto → cae al catch, Pitfall 12)
  4. `if (!Array.isArray(data.sessions)) return { ok:false, error:'bad shape' }`
  5. `return { ok:true, data }`
  - `catch (err)` → `{ ok:false, error: err.message }` (cubre ECONNREFUSED/abort/parse). Sin `picocolors`, sin `fetchComments`/`fetchLogs`.
- **`test/dashboard-client.test.js`** (NUEVO): 5 `it(...)` (ok / HTTP no-ok / JSON corrupto / throw ECONNREFUSED / bad shape) con leak guard (reemplaza `globalThis.fetch` por un thrower en `before()`, restaura en `after()`) y helper `makeFetch` adaptado (Response-like con `ok`/`status`/`json()`).

## TDD Cycle

| Gate | Commit | Resultado |
|------|--------|-----------|
| RED  | `22450eb` test(35-01) | 5 tests fallan por módulo ausente (Nyquist gate) |
| GREEN | `f87b046` feat(35-01) | 5 tests pasan; format-isolation 8/8 verde |

REFACTOR: no necesario (código mínimo y limpio desde GREEN).

## Verification

- `node --test test/dashboard-client.test.js` → tests 5, pass 5, fail 0 (TUI-05 contrato + TUI-06 never-throws)
- `node --test test/format-isolation.test.js` → tests 8, pass 8, fail 0 (color-isolation cubre client.js automáticamente vía walker; 0 picocolors)

## Acceptance Criteria

- [x] `test/dashboard-client.test.js` con 5 bloques `it(...)`, importa `fetchStatus`, leak guard before/after
- [x] `src/cli/dashboard/client.js` exporta `fetchStatus`; `try/catch` con catch `{ok:false,error}`
- [x] Validación shape `Array.isArray(data.sessions)` → `'bad shape'`
- [x] 0 imports de `picocolors` (líneas no-comentario)
- [x] Sin `fetchComments`/`fetchLogs` definidos (solo mención en comentario YAGNI)
- [x] key_link presente: `fetchFn(\`${baseUrl}/status\`, { signal })`

## Must-Haves Coverage

- [x] `fetchStatus` devuelve `{ok:true,data}` con payload válido
- [x] `fetchStatus` devuelve `{ok:false,error}` ante ECONNREFUSED, HTTP no-ok, JSON corrupto y shape inválida — nunca lanza
- [x] Test verifica los 5 escenarios
- [x] D-07 implementado: las 3 clases de error (ECONNREFUSED / HTTP 5xx / JSON corrupto) colapsan a `{ok:false}` con copy unificado

## Threat Model Coverage

- **T-35-01 (DoS/crash, mitigate):** `try/catch` alrededor de `res.json()` + `Array.isArray(data.sessions)`; JSON corrupto/parcial/bad-shape → `{ok:false}`, jamás throw a React. Cubierto por escenarios "JSON corrupto" y "bad shape".
- **T-35-02 (info disclosure, accept):** `error` = `err.message`/`HTTP <status>` sobre endpoint localhost sin secretos. Sin cambios.
- **T-35-SC (tampering, accept):** ningún paquete instalado (fetch built-in Node 20+).

No se introdujo superficie de seguridad nueva fuera del threat model.

## Deviations from Plan

None — el plan se ejecutó exactamente como estaba escrito.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/cli/dashboard/client.js
- FOUND: test/dashboard-client.test.js
- FOUND commit: 22450eb (test/RED)
- FOUND commit: f87b046 (feat/GREEN)
