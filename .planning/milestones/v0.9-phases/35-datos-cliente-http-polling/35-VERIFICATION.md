---
phase: 35-datos-cliente-http-polling
verified: 2026-05-27T00:00:00Z
status: passed
score: 14/14 must-haves verified
overrides_applied: 0
---

# Phase 35: Datos — cliente HTTP + polling — Reporte de Verificación

**Phase Goal:** El panel obtiene y refresca las sesiones desde el server de forma resiliente: cliente HTTP puro que nunca lanza, loop de polling que no apila requests, y degradación elegante (keep-last-good + backoff) cuando el server no responde.
**Verified:** 2026-05-27
**Status:** PASSED
**Re-verification:** No — verificación inicial

---

## Goal Achievement

### Observable Truths

| #  | Verdad observable                                                                                          | Estado      | Evidencia                                                                                                          |
|----|------------------------------------------------------------------------------------------------------------|-------------|--------------------------------------------------------------------------------------------------------------------|
| 1  | `fetchStatus` devuelve `{ok:true,data}` con payload `/status` válido                                      | ✓ VERIFIED  | `client.js:47-53`; test escenario "ok" — 5/5 pass                                                                 |
| 2  | `fetchStatus` devuelve `{ok:false,error}` ante ECONNREFUSED, HTTP no-ok, JSON corrupto y shape inválida — nunca lanza | ✓ VERIFIED  | `client.js:54-57` catch + validaciones; 4 escenarios de fallo pasan; D-07 estructural                             |
| 3  | El test de cliente verifica los 5 escenarios                                                               | ✓ VERIFIED  | `test/dashboard-client.test.js` — 5 `it()` explícitos ejecutados: 5 pass, 0 fail                                 |
| 4  | D-07: ECONNREFUSED, HTTP 5xx y JSON corrupto colapsan al discriminante `{ok:false}`                       | ✓ VERIFIED  | Todos los modos de fallo entran al `catch` o al `return {ok:false,...}` antes del catch; ningún throw escapa      |
| 5  | El poll es self-scheduling (≤1 request en vuelo, single-flight)                                           | ✓ VERIFIED  | `usePoll.js:146` `schedule(tick, interval)` se re-arma SOLO tras `await fn()` (línea 124); test `maxInFlight===1` pasa |
| 6  | El backoff escala 2.5→5→10s cap ante fallos consecutivos y resetea a 2.5s al primer ok                   | ✓ VERIFIED  | `usePoll.js:137-143` `Math.min(baseMs * 2 ** failCount, maxMs)` + reset `failCount=0`; test backoff-sube `[2500,5000,10000,10000]` pasa; test backoff-resetea pasa |
| 7  | El teardown limpia el timer y aborta el controller (no setState tras unmount)                             | ✓ VERIFIED  | `usePoll.js:152-156` `cancelled=true; cancel(timer); ac?.abort()`; test teardown pasa                            |
| 8  | D-04/D-05/D-09 implementados                                                                              | ✓ VERIFIED  | Código y tests cubren backoff (D-04), AbortController por tick (D-05), teardown con cancelled+cancel+abort (D-09) |
| 9  | App refresca desde `GET /status` y muestra `● live` + N sessions al conectar                             | ✓ VERIFIED  | `App.js:119-123` cablea `usePoll(fetchStatus)`; `App.js:131-136` nodo `● live`; test "live" pasa                 |
| 10 | Si el server cae a mitad, App conserva el último count (keep-last-good) + `⚠ server caído` + edad        | ✓ VERIFIED  | `App.js:101-116` `onResult` no toca `lastGoodCount/lastGoodAt` en fallo; `App.js:138-146` estado stale; test keep-last-good pasa |
| 11 | Si el server está caído al arrancar (sin dato bueno), App muestra `waiting for server` sin contador       | ✓ VERIFIED  | `App.js:147-149` estado waiting con `dimColor`; test "waiting" pasa                                              |
| 12 | JSON corrupto = poll fallido (mismo path que ECONNREFUSED), nunca crash del render                        | ✓ VERIFIED  | `client.js:51` catch de SyntaxError → `{ok:false}`; test "JSON corrupto" pasa (frame sobrevive)                 |
| 13 | D-02/D-06/D-08 implementados                                                                              | ✓ VERIFIED  | Status line viva (D-02); dos estados de degradación (D-06); edad recalculada por poll sin timer de 1s (D-08)      |
| 14 | `runDashboard` resuelve el baseUrl sin TypeError con config v1 migrado (guard WR-01/D-10)                 | ✓ VERIFIED  | `index.js:56` `cfg.server?.port ?? defaultConfig.server.port`; test "v1-migrado→9090" pasa                       |

**Puntuación:** 14/14 verdades verificadas

---

### Required Artifacts

| Artefacto                            | Descripción esperada                                       | Estado      | Detalles                                              |
|--------------------------------------|------------------------------------------------------------|-------------|-------------------------------------------------------|
| `src/cli/dashboard/client.js`        | `fetchStatus` puro never-throws                            | ✓ VERIFIED  | Existe, 59 líneas, exporta `fetchStatus`, try/catch completo |
| `test/dashboard-client.test.js`      | 5 escenarios del discriminante `{ok}`                      | ✓ VERIFIED  | Existe, 115 líneas, 5 `it()`, leak guard, contiene "bad shape" |
| `src/cli/dashboard/usePoll.js`       | Hook self-scheduling cancelable con clock/fetch inyectables | ✓ VERIFIED  | Existe, 187 líneas, exporta `usePoll` y `runPollLoop`, contiene "maxInFlight" en test |
| `test/dashboard-poll.test.js`        | Tests single-flight, backoff, teardown                     | ✓ VERIFIED  | Existe, 237 líneas, 4 `it()`, contiene "maxInFlight" |
| `src/cli/dashboard/App.js`           | Status line viva con keep-last-good + dos estados          | ✓ VERIFIED  | Existe, 159 líneas, contiene `usePoll(` y `fetchStatus` |
| `test/dashboard-status-line.test.js` | 4 escenarios vía ink-testing-library                       | ✓ VERIFIED  | Existe, 201 líneas, 4 `it()`, contiene "server caído" |
| `src/cli/dashboard/index.js`         | Guard WR-01: `server?.port` + fallback a `DEFAULT_CONFIG`  | ✓ VERIFIED  | Existe, exporta `resolveBaseUrl`; contiene `server?.port` y `DEFAULT_CONFIG.server.port` |
| `test/dashboard-baseurl.test.js`     | 3 escenarios de resolución de baseUrl                      | ✓ VERIFIED  | Existe, 43 líneas, 3 `it()`, contiene "9090"         |

---

### Key Link Verification

| Desde                            | Hacia                                     | Vía                                          | Estado      | Detalle                                               |
|----------------------------------|-------------------------------------------|----------------------------------------------|-------------|-------------------------------------------------------|
| `client.js`                      | `GET {baseUrl}/status`                    | `fetchFn(\`${baseUrl}/status\`, { signal })` | ✓ WIRED     | `client.js:49` — patrón exacto verificado             |
| `usePoll.js`                     | recursive setTimeout (NO setInterval)     | re-arma con `schedule(tick, interval)` al final | ✓ WIRED  | `usePoll.js:146` — SOLO tras `await fn()`; sin `setInterval` activo |
| `App.js` → `fetchStatus (client.js)` | vía `usePoll`                         | `usePoll((signal) => fetchStatus(...), onResult, ...)` | ✓ WIRED | `App.js:119-123` |
| `App.js`                         | ink `<Text color>`                        | color SOLO de props `color:` en `<Text>`     | ✓ WIRED     | `App.js:134,144,148`; 0 imports de picocolors         |
| `index.js` → `DEFAULT_CONFIG.server.port` | fallback cuando `cfg.server?.port` es undefined | `cfg.server?.port ?? defaultConfig.server.port` | ✓ WIRED | `index.js:56` |

---

### Data-Flow Trace (Level 4)

| Artefacto  | Variable de datos       | Fuente                              | Produce datos reales | Estado      |
|------------|-------------------------|-------------------------------------|----------------------|-------------|
| `App.js`   | `lastGoodCount`         | `onResult` ← `usePoll` ← `fetchStatus` ← `GET /status` real | Sí — `data.count ?? data.sessions.length` desde la respuesta HTTP | ✓ FLOWING |
| `App.js`   | `connected` / `lastGoodAt` | `onResult` en cada tick           | Sí — refleja el resultado real del poll | ✓ FLOWING |

El flujo de datos es completo: `GET /status` → `fetchStatus` → `{ok,data}` → `onResult` en `App` → `setLastGoodCount` / `setConnected` / `setLastGoodAt` → render de la status line. Los tests de integración con `ink-testing-library` verifican que el render muestra datos reales del fetchFn inyectado (no hardcoded).

---

### Behavioral Spot-Checks

| Comportamiento                          | Comando                                           | Resultado         | Estado  |
|-----------------------------------------|---------------------------------------------------|-------------------|---------|
| fetchStatus: 5 escenarios never-throws  | `node --test test/dashboard-client.test.js`       | 5 pass, 0 fail    | ✓ PASS  |
| usePoll: single-flight + backoff + teardown | `node --test test/dashboard-poll.test.js`     | 4 pass, 0 fail    | ✓ PASS  |
| App: keep-last-good + dos estados + JSON corrupto | `node --test test/dashboard-status-line.test.js` | 4 pass, 0 fail | ✓ PASS |
| baseUrl: guard WR-01                    | `node --test test/dashboard-baseurl.test.js`      | 3 pass, 0 fail    | ✓ PASS  |
| Color-isolation (picocolors walker)     | `node --test test/format-isolation.test.js`       | 8 pass, 0 fail    | ✓ PASS  |
| Regresión de Phase 34 (render + q→exit) | `node --test test/dashboard-render.test.js`      | 2 pass, 0 fail    | ✓ PASS  |
| Suite global completa                   | `npm test`                                        | 915 pass, 0 fail, 1 skip (pre-existente) | ✓ PASS |

---

### Probe Execution

No hay probes declarados para esta fase. Step 7c: SKIPPED (no probe-*.sh declarations in plan/summary).

---

### Requirements Coverage

| Requirement | Plan fuente | Descripción                                                                                     | Estado       | Evidencia                                                                          |
|-------------|-------------|-------------------------------------------------------------------------------------------------|--------------|------------------------------------------------------------------------------------|
| TUI-05      | 35-01, 35-02 | Loop de polling que refresca desde `GET /status` cada ~2s, nunca apila requests solapadas     | ✓ SATISFIED | `fetchStatus` (Plan 01) + `runPollLoop` single-flight (Plan 02); tests pasan        |
| TUI-06      | 35-01, 35-02, 35-03, 35-04 | Dashboard muestra "server caído", keep-last-good, reintenta con backoff, nunca crashea | ✓ SATISFIED | Combinación de never-throws (client.js), backoff (usePoll.js), keep-last-good (App.js), guard WR-01 (index.js); todos los tests pasan |

Ambos requirements de Phase 35 están cubiertos al 100%. No hay requirements huérfanos — la tabla de trazabilidad de REQUIREMENTS.md asigna TUI-05 y TUI-06 exclusivamente a Phase 35, y los 4 planes los cubren.

---

### Anti-Patterns Found

| Archivo | Línea | Patrón | Severidad | Impacto |
|---------|-------|--------|-----------|---------|
| — | — | — | — | Sin anti-patrones detectados |

- Sin marcadores `TBD`, `FIXME` ni `XXX` en ningún archivo de la fase.
- Sin `setInterval` activo en código no-comentario de `usePoll.js`.
- Sin imports de `picocolors` en ningún archivo bajo `src/cli/dashboard/`.
- Sin `return null` ni `return {}` vacíos en rutas de render.
- Sin `starting…` ni texto "placeholder" activo en código de producción.

---

### Human Verification Required

*(Sección vacía — ningún ítem requiere verificación humana)*

Todos los comportamientos críticos de esta fase son verificables programáticamente (lógica pura, tests herméticos con DI, asserts sobre `lastFrame()` de ink-testing-library). Los comportamientos visuales del TUI en una terminal real quedan cubiertos por la suite de Phase 34 (render + q→exit) que sigue verde.

---

## Gaps Summary

*(Sección vacía — no se encontraron gaps)*

---

_Verified: 2026-05-27_
_Verifier: Claude (gsd-verifier)_
