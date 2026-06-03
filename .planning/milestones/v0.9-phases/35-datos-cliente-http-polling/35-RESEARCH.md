# Phase 35: Datos — cliente HTTP + polling - Research

**Researched:** 2026-05-27
**Domain:** Cliente HTTP puro never-throws + loop de polling self-scheduling resiliente para un TUI ink (`kodo dashboard`)
**Confidence:** HIGH

> Este RESEARCH.md **consolida** la research de milestone (ARCHITECTURE.md / PITFALLS.md / STACK.md, ya verificada contra el codebase) a nivel de fase y rellena los huecos específicos de planificación de Phase 35. No re-deriva el stack: lo cita. El planner debe leer los tres docs de milestone además de este.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Superficie visible tras Phase 35 (TUI-06 observable)**
- **D-01:** `App.js` reemplaza `starting…` por una **status line mínima viva**: indicador de conexión (`● live` cuando el último poll fue ok / `⚠ server caído` cuando falla), contador `N sessions` (desde `data.count` / `data.sessions.length` del payload `/status`), y banner de degradación. Sin tabla columnar — esa es Phase 36. Mockup aprobado:
  ```
  kodo dashboard            ● live

    3 sessions

    q quit

  --- server cae ---
  kodo dashboard            ⚠ server caído

    3 sessions (last update 8s ago, retrying…)

    q quit
  ```
- **D-02:** Se descartó la opción "headless" (solo `client.js`+`usePoll.js`+tests) porque contradice los criterios observables de la fase: TUI-06 exige que "el dashboard *muestra* estado 'server caído'" y el criterio #1 habla de refresco visible. También se descartó la "lista cruda" para no invadir la capa de presentación de Phase 36 con código desechable.

**Cadencia de polling + backoff (TUI-05)**
- **D-03:** Intervalo **base = 2.5s**. Loop **self-scheduling** con `setTimeout` recursivo: el siguiente tick se programa SOLO tras resolver (o abortar) el actual → una request en vuelo a la vez, nunca `setInterval`.
- **D-04:** **Backoff** ante fallos consecutivos duplicando con **cap a 10s** (`2.5 → 5 → 10`, estable en 10s). **Reset a 2.5s** al primer poll exitoso. Nunca más rápido que la base.
- **D-05:** **Timeout de fetch = 5s** vía `AbortController` (`signal` + `setTimeout(abort, 5000)`). Generoso a propósito: como hay single-flight, un poll lento solo retrasa el siguiente (no apila). Re-crear el controller cada tick.

**UX de degradación / "server caído" (TUI-06)**
- **D-06:** **Dos estados** distintos de degradación, no uno: (a) **`waiting for server`** — arranque sin ningún dato bueno todavía (primer `/status` falla, ECONNREFUSED); (b) **`stale, retrying`** — ya hubo al menos un poll ok y el server cayó a mitad → **keep-last-good** (se conserva el último `count`/sessions, NO se blanquea) + banner de reintento.
- **D-07:** **Copy unificado** para todos los fallos: ECONNREFUSED, HTTP 5xx y JSON corrupto se tratan igual a nivel de mensaje ("server caído" / "retrying…"). No se varía el texto por clase de error. JSON corrupto/HTTP no-ok → poll fallido vía el discriminante `{ok:false}`, jamás un throw que llegue a React.
- **D-08:** La edad mostrada (`last update Ns ago`) se **recalcula en cada intento de poll**, NO con un timer de 1s. Evita forzar re-renders cosméticos por segundo (Pitfall 8). Acepta que la edad "salta" en pasos de ~2.5–10s según la cadencia/backoff.

**Late-response guard (TUI-05)**
- **D-09:** **No** se implementa el guard de tick-id monotónico. Con el loop self-scheduling estricto (≤1 request en vuelo) ninguna respuesta tardía puede pisar datos frescos, porque siempre se `await` antes de programar el siguiente tick. El teardown se cubre con un **flag `cancelled`** en el cleanup del `useEffect` + **abort-on-unmount** del controller. El tick-id sería código muerto (YAGNI) salvo que en el futuro se permitiera solapamiento.

**Hardening arrastrado de Phase 34**
- **D-10:** Cerrar el **advisory WR-01** de `34-REVIEW.md`: `loadConfig().server.port` sin guardia. Phase 35 es donde el cliente consume el `baseUrl`, así que el guard de `server.port` undefined (fallback al default 9090, ver `src/config.js:62-66`) debe quedar resuelto en esta fase.

### Claude's Discretion
- Partición fina de `client.js` (¿una función por endpoint ya, o solo `fetchStatus` en esta fase y `fetchComments`/`fetchLogs` se añaden en Phases 36/38? — el research las lista todas en `client.js`, pero Phase 35 solo necesita `fetchStatus`).
- Forma exacta del hook `usePoll` (firma, dónde vive el estado de backoff/connection — dentro del hook vs en `App`), siempre respetando D-03/D-04/D-05/D-09.
- Profundidad de la validación de shape del payload antes de usarlo — el research recomienda mínima (`Array.isArray(payload.sessions)`); el planner decide si añade más.
- Markup exacto de la status line (uso de `<Box>`/`<Text color>`) mientras respete D-01 y la invariante de color-isolation (color SOLO de ink, cero `picocolors`).

### Deferred Ideas (OUT OF SCOPE)
- Tabla columnar (`task_ref · repo · phase/mode · status · age`), selección por `task_id`, orden estable por `started_at`, color por `status`+`alive`, header con contadores "live" y filtros (`/`, `r:`, `s:`) — **Phase 36** (TUI-07..TUI-12).
- `fetchComments`/`fetchLogs` en `client.js` — se añaden cuando los consuman Phase 38 (TUI-15/16); Phase 35 solo necesita `fetchStatus`.
- Guard de tick-id monotónico — descartado por YAGNI (D-09); reconsiderar solo si alguna vez se permite solapamiento de requests.
- Copy diferenciado por clase de error (ECONNREFUSED vs 5xx vs JSON) — descartado (D-07) a favor de un único mensaje honesto.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TUI-05 | El dashboard refresca las sesiones desde `GET /status` cada ~2s con un loop self-scheduling que nunca apila requests solapadas (poll lento no encola) | Pattern 2 (self-scheduling `setTimeout`, NO `setInterval`); `AbortController` timeout D-05; Anti-Pattern 3; single-flight test (slow-fetch → 1 en vuelo). Cadencia base 2.5s (D-03). |
| TUI-06 | Si el server kodo no responde (al arrancar o a mitad de sesión), el dashboard muestra estado "server caído", conserva el último dato bueno (keep-last-good), reintenta con backoff y nunca crashea — incluyendo respuesta JSON corrupta | Pattern 1 (cliente puro `{ok,data}` never-throws); Pitfall 5 (startup vs mid-session + keep-last-good + backoff D-04); Pitfall 12 (JSON corrupto → `{ok:false}`); dos estados de degradación (D-06); copy unificado (D-07). |
</phase_requirements>

## Summary

Phase 35 convierte el placeholder estático `starting…` de Phase 34 en un panel que **obtiene y refresca datos reales** desde `GET /status` de forma resiliente. La arquitectura ya está decidida y verificada contra el codebase por la research de milestone: un **cliente HTTP puro que nunca lanza** (`{ok:true,data}` / `{ok:false,error}`, `src/cli/dashboard/client.js`), un **hook de polling self-scheduling** (`usePoll.js`, recursive `setTimeout`, jamás `setInterval`), y `App.js` cableando ambos + el estado de keep-last-good / connection / backoff para renderizar una **status line mínima viva** (D-01). El server NO se toca: es un cliente read-only.

El núcleo de la fase son **tres invariantes de resiliencia**, todos unit-testables con DI (fake fetch + fake clock, porque el test runner de Node carece de `mock.module`): (1) **single-flight** — un fetch lento solo retrasa el siguiente, nunca apila (TUI-05); (2) **keep-last-good + backoff** — tras al menos un poll ok, un fallo conserva el último `count`/sessions y reintenta con intervalo creciente `2.5→5→10s` cap, reset a 2.5s al recuperar (TUI-06); (3) **never-throws** — ECONNREFUSED, HTTP no-ok y **JSON corrupto** se colapsan al discriminante `{ok:false}` sin que ningún throw llegue a React (TUI-06). Dos estados de degradación distintos (D-06): `waiting for server` (arranque sin dato bueno) vs `stale, retrying` (server cayó a mitad).

Como hardening arrastrado, esta fase **cierra el advisory WR-01** (D-10): `src/cli/dashboard/index.js:49` aún hace `loadConfig().server.port` sin guardia — **verificado hoy: NO está arreglado**. `migrateConfig` (`src/config.js:82-102`) reconstruye el config sin la clave `server`, así que un usuario con config v1 migrado dispara `TypeError` al resolver el `baseUrl`. El fix es optional-chaining + fallback al default conocido `DEFAULT_CONFIG.server.port` (9090).

**Primary recommendation:** Construir en este orden, cada paso verde por separado: (1) `client.js` `fetchStatus(baseUrl, fetchFn?)` puro never-throws + tests (fixture ok / throw / JSON corrupto / HTTP no-ok); (2) `usePoll.js` self-scheduling cancelable con clock+fetch inyectables + tests (single-flight, teardown, backoff sube/resetea); (3) `App.js` consume `usePoll(fetchStatus, …)`, mantiene keep-last-good + connection/backoff state, renderiza la status line (D-01) + test `ink-testing-library` (succeed×2-then-throw → keep-last-good visible). Resolver D-10 (guard WR-01) como tarea propia. NO añadir deps: `fetch`/`AbortController` son built-in Node 20+.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fetch HTTP a `GET /status` | DATA LAYER (`client.js`, puro, React-free) | — | El invariante "no crash" es **estructural en el cliente** (devuelve `{ok}`), no en los componentes. Unit-testable con fake fetch, sin ink. |
| Parseo + validación de shape del payload | DATA LAYER (`client.js`) | — | `res.json()` puede lanzar (JSON corrupto) — el `try/catch` y la validación mínima (`Array.isArray(payload.sessions)`) viven aquí para que React nunca vea un throw (Pitfall 12, D-07). |
| Scheduling del poll (cadencia, single-flight, backoff timing) | HOOK (`usePoll.js`, pure-ish, clock inyectable) | — | Recursive `setTimeout` self-scheduling (Pattern 2). El timing es lógica pura testeable con fake clock; vive fuera del render para no acoplarse a ink. |
| Estado de conexión / keep-last-good / edad | PRESENTATION (`App.js`, React state) | HOOK | `App` posee `connected`, `lastError`, `lastGoodCount`/sessions, `lastUpdateAt`. La Discretion permite mover backoff-state al hook; keep-last-good es decisión de `App` (qué conservar al fallar). |
| Render de la status line (`● live` / `⚠ server caído` / banner) | PRESENTATION (`App.js`, ink `<Box>`/`<Text>`) | — | Color SOLO de ink `<Text color>` (invariante color-isolation D-12 de Phase 34); cero `picocolors`. |
| Resolución de `baseUrl` (config + `--url`) + guard WR-01 | PROCESS (`index.js`, `runDashboard`) | — | Ya resuelto en Phase 34 salvo el guard `server.port` undefined (D-10). El cliente recibe el `baseUrl` ya resuelto. |
| Contrato del payload `/status` | EXISTING SERVER (`src/server.js:361-413`) | — | **READ ONLY — cero endpoints nuevos** (constraint dura del milestone). |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ink` | `6.8.0` (instalado) | `useEffect`/`useRef` host para el hook; `<Box>`/`<Text>` para la status line | `[VERIFIED: node_modules/ink/package.json]` ya instalado en Phase 34, `engines.node >=20`. NO bump a ink@7 (exigiría Node 22). |
| `react` | `19.2.6` (instalado) | `useState`/`useEffect`/`useRef` para connection/backoff/keep-last-good state | `[VERIFIED: node_modules/react/package.json]` peer de ink@6. Ya instalado. |
| `node:fetch` (global) | built-in Node 20+ | Cliente HTTP a `GET /status` | `[VERIFIED: node -v → v25.9.0; engines.node >=20]` Cero dep nueva. `fetch` + `AbortController` + `AbortSignal` nativos. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ink-testing-library` | `4.0.0` (devDep, instalado) | Render de `App` a string buffer en `node --test`; `lastFrame()` + `frames` | `[VERIFIED: node_modules/ink-testing-library/package.json]` Para el test de la status line (succeed×2-then-throw → keep-last-good). **Constraint:** su `render()` NO expone `waitUntilExit()` (solo el `render()` real de ink lo hace) — `[VERIFIED: test/dashboard-render.test.js:22-26 + Phase 34 review]`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `globalThis.fetch` | `undici` / `node-fetch` / `axios` | **Nunca aquí** — regresión pura contra minimal-deps; `fetch` es built-in Node 20+. `[CITED: STACK.md "What NOT to Use"]` |
| Recursive `setTimeout` (self-scheduling) | `setInterval(fetch, 2500)` | **Nunca** — apila requests con server lento, sobrevive a unmount/remount del attach (Anti-Pattern 3, Pitfall 2). Mismo esfuerzo. |
| `AbortController` manual + `setTimeout(abort, 5000)` | `AbortSignal.timeout(5000)` | Equivalente y más terso (built-in Node 20+). D-05 dice "AbortController (`signal` + `setTimeout(abort, 5000)`)"; ambos válidos, el planner elige. Si usa `AbortSignal.timeout`, simplifica el cleanup pero pierde el handle para abortar-on-unmount manualmente — re-crear el controller cada tick (D-05) es más explícito. |

**Installation:**
```bash
# NINGUNA. Todo el stack ya está instalado (Phase 34) y fetch es built-in.
# NO instalar ink-text-input (eso es Phase 36, filtros). NO instalar HTTP client.
```

**Version verification (ejecutado en esta sesión):**
```
ink                 6.8.0    [VERIFIED node_modules]
react               19.2.6   [VERIFIED node_modules]
ink-testing-library 4.0.0    [VERIFIED node_modules, devDep]
node                v25.9.0  [VERIFIED node -v]  (engines.node >=20 ✓)
```

## Package Legitimacy Audit

> **N/A para Phase 35.** Esta fase **NO instala paquetes externos** — todo el stack (`ink`, `react`, `ink-testing-library`) se instaló y se auditó en Phase 34, y `fetch`/`AbortController` son built-in de Node 20+. No hay superficie de slopcheck/registry que verificar en esta fase. El único cambio de dependencias del milestone (`ink`, `react`, `ink-text-input`) está fuera de esta fase.

## Architecture Patterns

### System Architecture Diagram

```
                  ┌─────────────────────────────────────────────┐
   q quit ◄───────┤  App.js  (PRESENTATION — ink/react)          │
                  │   state: connected, lastError,               │
                  │          lastGoodCount/sessions, lastUpdateAt │
                  │   render: status line                        │
                  │     ● live  / ⚠ server caído                 │
                  │     N sessions (last update Ns ago, retrying…)│
                  └───────▲──────────────────────┬────────────────┘
                          │ {ok,data}|{ok:false} │ usePoll(fetchStatus, baseUrl, …)
                          │ (cada tick)           ▼
                  ┌───────┴──────────────────────────────────────┐
                  │  usePoll.js  (HOOK — pure-ish, clock inyectable)│
                  │   recursive setTimeout (NO setInterval)        │
                  │   ├─ tick: await fetchStatus(...) ── single-flight
                  │   ├─ ok    → reset interval a 2.5s             │
                  │   ├─ !ok   → backoff 2.5→5→10s (cap)           │
                  │   └─ schedule next SOLO tras resolver/abortar  │
                  │   cleanup: cancelled=true + clearTimeout + abort│
                  └───────────────────────┬───────────────────────┘
                                          │ fetchStatus(baseUrl, fetchFn=globalThis.fetch)
                                          ▼
                  ┌───────────────────────────────────────────────┐
                  │  client.js  (DATA LAYER — puro, React-free)     │
                  │   try: fetchFn(`${baseUrl}/status`, {signal})   │
                  │        if (!res.ok) → {ok:false, error}         │  ◄── HTTP no-ok (D-07)
                  │        data = await res.json()  ── puede lanzar │  ◄── JSON corrupto → catch
                  │        if (!Array.isArray(data.sessions))       │  ◄── shape mínima
                  │             → {ok:false, error}                 │
                  │        return {ok:true, data}                   │
                  │   catch (err) → {ok:false, error: err.message}  │  ◄── ECONNREFUSED / abort
                  └───────────────────────┬───────────────────────┘
                                          │ HTTP GET (5s timeout via AbortController, D-05)
                                          ▼
                  ┌───────────────────────────────────────────────┐
                  │  EXISTING SERVER  src/server.js:361-413         │
                  │   GET /status → {sessions:[{…,alive,            │
                  │     elapsed_min}], count, pending, …}           │
                  │   ── READ ONLY · CERO ENDPOINTS NUEVOS ──       │
                  │   (caro/lento: await listPendingTasks (TTL) +   │
                  │    cmux.listWorkspaces → por eso timeout 5s)    │
                  └───────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/cli/dashboard/
├── index.js        # MODIFICADO: fix guard WR-01 (D-10) en resolución de baseUrl
├── App.js          # MODIFICADO: usePoll + keep-last-good/connection/backoff state + status line (D-01)
├── client.js       # NUEVO: fetchStatus(baseUrl, fetchFn?) puro never-throws ({ok,data})
└── usePoll.js      # NUEVO: hook self-scheduling cancelable (D-03/04/05/09)
```
> NO se crean `select.js`, `attach.js`, ni `components/` en esta fase (eso es Phases 36-38). Discretion: el planner puede dejar `client.js` con solo `fetchStatus` (Phases 36/38 añaden `fetchComments`/`fetchLogs`).

### Pattern 1: Cliente HTTP puro que devuelve objetos resultado (never-throws)
**What:** `fetchStatus` envuelve `fetch`, parsea JSON y devuelve `{ok:true, data}` o `{ok:false, error}`. `fetchFn` inyectable (default `globalThis.fetch`). El invariante "no crash" es **estructural aquí**, no en los componentes.
**When to use:** TUI-06. ECONNREFUSED, HTTP no-ok y JSON corrupto se colapsan todos a `{ok:false}` (D-07). `[CITED: ARCHITECTURE.md Pattern 1]`
**Example:**
```js
// Source: ARCHITECTURE.md Pattern 1 (verificado contra src/server.js:361-413)
// src/cli/dashboard/client.js — puro, NO React, NO picocolors
// @ts-check
export async function fetchStatus(baseUrl, fetchFn = globalThis.fetch, signal) {
  try {
    const res = await fetchFn(`${baseUrl}/status`, { signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };     // D-07
    const data = await res.json();                                       // puede throw (JSON corrupto) → catch
    if (!Array.isArray(data.sessions)) return { ok: false, error: 'bad shape' }; // validación mínima
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };  // ECONNREFUSED / abort / parse → graceful (Pitfall 12)
  }
}
```
> **Decisión de Discretion para el planner:** ¿`fetchStatus` acepta `signal` como 3er arg (lo pasa `usePoll`) o el cliente crea su propio controller? El research de milestone muestra `(baseUrl, fetchFn)`; D-05 quiere el AbortController re-creado cada tick. Lo más limpio: `usePoll` posee el controller y pasa `signal` a `fetchStatus` (mostrado arriba), de modo que abort-on-unmount viva en el hook (D-09). Ambas firmas respetan los locks.

### Pattern 2: Poll self-scheduling cancelable (NO `setInterval`) + backoff
**What:** Hook con recursive `setTimeout` que programa el *siguiente* tick SOLO tras resolver el fetch actual (single-flight). Backoff: intervalo `2.5→5→10s` cap ante fallos consecutivos, reset a 2.5s al primer ok (D-04). Flag `cancelled` + `abort()` en cleanup (D-09).
**When to use:** TUI-05. `[CITED: ARCHITECTURE.md Pattern 2]`
**Example:**
```js
// Source: ARCHITECTURE.md Pattern 2 + D-03/04/05/09 (cadencia 2.5s, backoff, abort, cancelled)
// src/cli/dashboard/usePoll.js
// @ts-check
import { useEffect, useRef } from 'react';

const BASE_MS = 2500, MAX_MS = 10000;

// onResult(result) lo llama App para actualizar connected/keep-last-good.
// clock/setTimeout inyectables para tests herméticos (Pitfall 11).
export function usePoll(fn, onResult, deps = [], { baseMs = BASE_MS, maxMs = MAX_MS, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const savedFn = useRef(fn); savedFn.current = fn;
  const savedOn = useRef(onResult); savedOn.current = onResult;
  useEffect(() => {
    let cancelled = false, timer, interval = baseMs;
    let ac;
    const tick = async () => {
      ac = new AbortController();                          // re-crear cada tick (D-05)
      const to = setTimeout(() => ac.abort(), 5000);       // timeout 5s (D-05)
      const result = await savedFn.current(ac.signal);     // await → single-flight (D-09)
      clearTimeout(to);
      if (cancelled) return;
      savedOn.current(result);
      interval = result.ok ? baseMs : Math.min(interval * 2, maxMs); // backoff/reset (D-04)
      timer = schedule(tick, interval);                    // programa el SIGUIENTE solo ahora (D-03)
    };
    tick();
    return () => { cancelled = true; cancel(timer); ac?.abort(); }; // teardown (D-09, Pitfall 9)
  }, deps);
}
```
> Firma **ilustrativa** — la Discretion permite que el estado de backoff/connection viva en el hook o en `App`. Lo load-bearing (no negociable): recursive `setTimeout`, `await` antes de re-armar, `cancelled`+`clearTimeout`+`abort` en cleanup, backoff con cap+reset.

### Pattern 3: Keep-last-good en `App` (dos estados de degradación)
**What:** `App` distingue (a) **`waiting for server`**: nunca hubo `data` bueno y el poll falla (arranque, ECONNREFUSED) — mostrar "waiting for server", sin contador; (b) **`stale, retrying`**: ya hubo ≥1 ok y ahora falla — **conservar** `lastGoodCount`/sessions, mostrar `⚠ server caído` + `N sessions (last update Ns ago, retrying…)`. NO blanquear (D-06, Pitfall 5).
**When to use:** TUI-06. La edad se recalcula en cada intento de poll (D-08), NO con timer de 1s.
**Example:**
```js
// Source: D-01/D-06/D-08 + Pitfall 5. Estado mínimo en App (ink/react).
// onResult del usePoll:
function onResult(result) {
  const now = Date.now();
  if (result.ok) {
    setLastGoodCount(result.data.count ?? result.data.sessions.length);
    setLastGoodAt(now);
    setConnected(true); setLastError(null);
  } else {
    setConnected(false); setLastError(result.error);
    // NO se toca lastGoodCount/lastGoodAt → keep-last-good
  }
  setLastAttemptAt(now); // edad se recalcula por poll (D-08), no por timer/seg
}
// Derivar estado de render (puro):
//   never had good  → 'waiting for server'
//   had good + !connected → 'stale'  → ⚠ + "(last update Ns ago, retrying…)"
//   connected       → 'live'         → ● live + "N sessions"
```

### Anti-Patterns to Avoid
- **`setInterval(fetchStatus, 2500)`** (Anti-Pattern 3 / Pitfall 2): apila requests con server lento, sobrevive al unmount/remount, dispara `setState` tras unmount. Usar recursive `setTimeout`.
- **Blanquear el contador al primer fallo** (Pitfall 5): el operador pierde todo el contexto cuando el server hipa. Keep-last-good + dim + banner.
- **Dejar que `res.json()` lance hacia React** (Pitfall 12): JSON corrupto/parcial = uncaught rejection que tira el árbol ink. `try/catch` en `client.js`, tratar como `{ok:false}`.
- **Importar `picocolors`** bajo `src/cli/dashboard/**` (Pitfall 10, invariante D-12): rompe `test/format-isolation.test.js`. Color SOLO de `<Text color>`.
- **Timer de 1s para recalcular la edad** (Pitfall 8, D-08): re-renders cosméticos por segundo. Recalcular la edad en cada intento de poll.
- **Variar el copy por clase de error** (D-07): la clase informa la recuperación, no el mensaje. Texto unificado.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cliente HTTP | `undici`/`node-fetch`/`axios` | `globalThis.fetch` (built-in Node 20+) | Cero dep; minimal-deps culture. `[CITED: STACK.md]` |
| Timeout de request | `Promise.race` manual con timer | `AbortController` + `setTimeout(abort, 5000)` (o `AbortSignal.timeout(5000)`) | Built-in, aborta el socket de verdad (no solo la promesa). D-05. |
| Render del árbol a string para tests | Parsear stdout crudo / PTY | `ink-testing-library` `render().lastFrame()` | Ya devDep instalado; fake stdout, sin TTY (Pitfall 11). |

**Key insight:** El stack de esta fase es **deliberadamente zero-new-deps**. Toda la "complejidad" (single-flight, backoff, never-throws) es lógica de ~60 LOC, no una librería. El valor está en la disciplina (DI para tests herméticos), no en dependencias.

## Runtime State Inventory

> Phase 35 es **greenfield + modificación de código** (crea `client.js`/`usePoll.js`, modifica `App.js`/`index.js`). NO es un rename/refactor/migración. Aun así, verifico las 5 categorías por el guard WR-01:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **Ninguno** — el TUI es read-only, no escribe a ningún datastore. Verificado: la fase solo hace `GET /status`. | None |
| Live service config | **Ninguno** — no toca config de servicios externos. El server `src/server.js` NO se modifica. | None |
| OS-registered state | **Ninguno** — sin tareas/daemons nuevos; el subcomando ya está registrado en `src/cli.js` (Phase 34). | None |
| Secrets/env vars | **Ninguno** — el cliente lee JSON localhost sin auth (no hay secretos en el path del TUI). | None |
| Build artifacts | **Ninguno** — no hay build step (`React.createElement` plano). Sin egg-info/binarios/imágenes. | None |

## Common Pitfalls

### Pitfall 1: Request stacking (TUI-05) — `setInterval` apila con server lento
**What goes wrong:** `/status` es caro (`await provider.listPendingTasks()` TTL-cached + `cmux.listWorkspaces()`, `src/server.js:368,378`). Con `setInterval` los fetches se apilan, llegan fuera de orden, la status line parpadea entre stale y fresh.
**Why it happens:** `setInterval` es fire-and-forget, sin backpressure.
**How to avoid:** Recursive `setTimeout` que re-arma SOLO tras `await` (Pattern 2). `AbortController` 5s por tick (D-05). Con single-flight estricto NO hace falta el tick-id guard (D-09).
**Warning signs:** Status line "salta" entre dos estados; múltiples conexiones a `localhost:9090` en `lsof`; CPU sube con el tiempo. `[CITED: PITFALLS.md Pitfall 2]`

### Pitfall 2: Server-down conflación startup vs mid-session (TUI-06)
**What goes wrong:** Un solo `catch` que hace lo mismo tanto si nunca hubo datos como si el server cayó a mitad. Blanquear el contador al primer error pierde el contexto.
**Why it happens:** Happy-path fetch con un único catch indiferenciado.
**How to avoid:** Dos estados (D-06): `waiting for server` (sin dato bueno) vs `stale, retrying` (keep-last-good). Backoff `2.5→5→10s` cap, reset a 2.5s al recuperar (D-04). `[CITED: PITFALLS.md Pitfall 5]`
**Warning signs:** Contador se vacía al primer hipo del server; loop de reconexión martilleando el puerto caído.

### Pitfall 3: JSON corrupto/parcial tira el árbol ink (TUI-06)
**What goes wrong:** Respuesta truncada / página HTML de error / 500 con body no-JSON hace que `res.json()` lance dentro del poll → uncaught rejection → tear-down de ink.
**Why it happens:** `res.json()` sin `try/catch`.
**How to avoid:** `try/catch` alrededor de `res.json()` en `client.js`; parse fallido = poll fallido (`{ok:false}`, keep-last-good), incrementa el contador de backoff, JAMÁS llega a React como throw. Validar shape mínima (`Array.isArray(data.sessions)`). `[CITED: PITFALLS.md Pitfall 12, D-07]`
**Warning signs:** unhandled-rejection crash; status line desaparece ante un error transitorio del server.

### Pitfall 4: Cleanup incompleto en unmount (timer leak + fetch zombi)
**What goes wrong:** Al desmontar (`q`, o el remount del attach en Phase 37), si el timer no se limpia o el fetch no se aborta, queda un `setState` tras unmount o un fetch que pega al server después de salir.
**Why it happens:** El timer/AbortController viven fuera de React y no se limpian en el cleanup del `useEffect`.
**How to avoid:** `return () => { cancelled = true; clearTimeout(timer); ac?.abort(); }` en el `useEffect` del `usePoll` (D-09, Pattern 2). `[CITED: PITFALLS.md Pitfall 9]`
**Warning signs:** Warning "setState after unmount"; un fetch a `localhost:9090` tras `q`.

### Pitfall 5 (test infra): tests no herméticos con timers/red reales
**What goes wrong:** Testear `usePoll` con `setTimeout` real y `fetch` real a `localhost:9090` → flaky, requiere server up, no corre en CI.
**Why it happens:** No se inyectan clock+fetch.
**How to avoid:** DI del **clock** (schedule/cancel) y la **fetch fn** (fixtures + throw). Tests avanzan el clock manualmente. `ink-testing-library` para el render (fake stdout). NO mocking lib (Node test runner no tiene `mock.module`). `[CITED: PITFALLS.md Pitfall 11; Key Decision del proyecto]`
**Warning signs:** `await sleep(3000)` en tests; tests que fallan sin server up.

> **Constraint de test verificado:** `ink-testing-library@4.0.0` NO expone `waitUntilExit()` en su instance (solo `rerender/unmount/cleanup/stdin/stdout/stderr/frames/lastFrame`) — ese método vive en el `render()` real de `ink`. Para `usePoll`/App, asertar sobre `lastFrame()`/`frames` o extraer el scheduler a una función pura testeable sin React. `[VERIFIED: test/dashboard-render.test.js:22-26]`

## Code Examples

### Resolución de baseUrl con guard WR-01 (D-10) — fix verificado pendiente
```js
// Source: 34-REVIEW.md WR-01 fix + src/config.js:62-66,82-102 (verificado: NO arreglado aún)
// src/cli/dashboard/index.js — REEMPLAZA la línea 49 actual:
//   const baseUrl = url ?? `http://localhost:${loadConfig().server.port}`;
// migrateConfig() reconstruye el config SIN la clave `server` → server v1 migrado
// dispara TypeError. Optional chaining + fallback al default conocido (9090):
const { loadConfig, DEFAULT_CONFIG } = await import('../../config.js');
const cfg = loadConfig();
const port = cfg.server?.port ?? DEFAULT_CONFIG.server.port;
const baseUrl = url ?? `http://localhost:${port}`;
```
> **Nota:** `DEFAULT_CONFIG` ya se exporta de `src/config.js` (verificado: usado en config.js mismo). Confirmar que el `export` existe antes de importarlo; si no, exportarlo es un cambio trivial y aislado.

### Test single-flight (TUI-05, load-bearing)
```js
// Source: CONTEXT.md Specific Ideas + PITFALLS.md Pitfall 2. Patrón node:test + DI.
// Fetch lento inyectado: assert que solo hay UNA request en vuelo y el siguiente
// tick no arranca hasta resolver el actual.
let inFlight = 0, maxInFlight = 0;
const slowFetch = async () => {
  inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise((r) => setTimeout(r, 50));
  inFlight--;
  return { ok: true, data: { sessions: [], count: 0 } };
};
// ... drive el hook/scheduler con fake clock, avanzar varios intervalos ...
assert.equal(maxInFlight, 1, 'nunca debe haber >1 request en vuelo (single-flight)');
```

### Test keep-last-good (TUI-06, load-bearing)
```js
// Source: CONTEXT.md Specific Ideas + PITFALLS.md Pitfall 5. ink-testing-library.
// Fetch que tiene éxito ×2 y luego lanza → el contador se CONSERVA y el flag de
// conexión pasa a stale.
const fakeFetch = (() => {
  let n = 0;
  return async () => {
    n++;
    if (n <= 2) return new Response(JSON.stringify({ sessions: [{}, {}, {}], count: 3 }), { status: 200 });
    throw new Error('ECONNREFUSED'); // server cae a mitad
  };
})();
// tras los 2 ok + el throw:
//   assert lastFrame() contiene "3 sessions"   (keep-last-good, NO blanqueado)
//   assert lastFrame() contiene "server caído" / "retrying"  (stale)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `setInterval` polling (como el `dashboardHtml` web existente, `setInterval(refresh, 5000)`) | Self-scheduling recursive `setTimeout` | Decisión de milestone v0.9 | No apila; teardown limpio en unmount/remount del attach (Anti-Pattern 3). |
| HTTP client lib (axios/node-fetch) | `globalThis.fetch` built-in | Node 18+ (estable 20+) | Cero dep; el proyecto está en Node >=20. |
| `Promise.race` para timeout | `AbortController`/`AbortSignal.timeout` | Node 16+/17.3+ | Aborta el socket real, no solo la promesa. D-05. |

**Deprecated/outdated:**
- El `setInterval(refresh, 5000)` del `dashboardHtml` del server es aceptable en un tab de browser pero **NO** se reutiliza aquí (Anti-Pattern 3). `[CITED: ARCHITECTURE.md Pattern 2]`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `DEFAULT_CONFIG` se exporta de `src/config.js` | Code Examples (fix WR-01) | Bajo — si no se exporta, añadir el `export` es trivial y aislado. Verificar antes de importar. El default `server.port: 9090` está confirmado en `src/config.js:62-66`. |
| A2 | El campo `count` del payload `/status` es el contador correcto para "N sessions" | Pattern 3 | Bajo — verificado `count: enriched.length` (`src/server.js:399`); D-01 acepta `data.count` o `data.sessions.length` como equivalentes. |
| A3 | `AbortController` + `setTimeout(abort,5000)` y `AbortSignal.timeout(5000)` son intercambiables para D-05 | Alternatives Considered | Bajo — ambos built-in Node 20+; D-05 nombra el primero pero el efecto es el mismo. Decisión de Discretion del planner. |

**Nota:** Estos son los únicos `[ASSUMED]` de la fase. Todo lo demás está `[VERIFIED]` contra el codebase/node_modules o `[CITED]` de la research de milestone (verificada en su sesión). A1 debe confirmarse con un `grep` durante el planning.

## Open Questions (RESOLVED)

1. **¿`client.js` con solo `fetchStatus` o ya con `fetchComments`/`fetchLogs`?**
   - What we know: el research de milestone lista las tres en `client.js`; Phase 35 solo necesita `fetchStatus`.
   - What's unclear: si pre-crear las otras dos ahorra churn en Phases 36/38.
   - Recommendation: **solo `fetchStatus`** (YAGNI; CONTEXT.md Discretion y Deferred lo confirman). Las otras se añaden cuando se consuman.

2. **¿El estado de backoff/connection vive en `usePoll` o en `App`?**
   - What we know: D-09 fija el mecanismo (cancelled flag + abort); la Discretion deja la ubicación libre.
   - What's unclear: acoplamiento del hook vs simplicidad de `App`.
   - Recommendation: el **timing del backoff** (interval actual) vive en el hook (es scheduling); el **keep-last-good + connection display state** vive en `App` (es lo que se renderiza). El hook reporta cada `{ok}` vía un callback `onResult` y `App` decide qué conservar. Cualquiera de las dos cumple los locks.

3. **¿Añadir un segundo test de color-isolation apuntando a `src/cli/dashboard/**`?**
   - What we know: el walker existente (`test/format-isolation.test.js:199-220`, TUI-04/D-13) YA escanea `src/cli/dashboard/` y falla si algún archivo importa `picocolors`.
   - What's unclear: nada — ya está cubierto desde Phase 34.
   - Recommendation: **no hace falta test nuevo**; los nuevos `client.js`/`usePoll.js` heredan automáticamente la cobertura del walker existente. Solo verificar que ninguno importe `picocolors`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node `fetch`/`AbortController` (global) | `client.js`/`usePoll.js` | ✓ | Node v25.9.0 (>=20) | — |
| `ink` | App render host | ✓ | 6.8.0 | — |
| `react` | hooks (`useState`/`useEffect`/`useRef`) | ✓ | 19.2.6 | — |
| `ink-testing-library` | tests de App | ✓ | 4.0.0 (devDep) | — |
| kodo server `GET /status` | runtime (no para tests — DI fake fetch) | n/a en test | — | Tests usan fake fetch; el server NO es dep de test (Pitfall 11). En runtime, su ausencia es **exactamente lo que TUI-06 maneja** (server caído). |

**Missing dependencies with no fallback:** Ninguna — todo el stack está instalado y `fetch` es built-in.
**Missing dependencies with fallback:** Ninguna.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + `node:assert/strict` + `ink-testing-library@4.0.0` para render |
| Config file | none — `package.json` script `"test": "node --test $(find test -name '*.test.js' -type f)"` |
| Quick run command | `node --test test/dashboard-poll.test.js test/dashboard-status-line.test.js` (archivos nuevos de esta fase) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TUI-05 | `fetchStatus` ok → `{ok:true,data}`; throw → `{ok:false}`; JSON corrupto → `{ok:false}`; HTTP no-ok → `{ok:false}` | unit (puro, fake fetch) | `node --test test/dashboard-client.test.js` | ❌ Wave 0 |
| TUI-05 | single-flight: fetch lento inyectado → solo 1 request en vuelo; siguiente tick no arranca hasta resolver | unit (fake clock + fake fetch) | `node --test test/dashboard-poll.test.js` | ❌ Wave 0 |
| TUI-05 | backoff sube `2.5→5→10` cap ante fallos consecutivos y resetea a 2.5 al primer ok | unit (fake clock) | `node --test test/dashboard-poll.test.js` | ❌ Wave 0 |
| TUI-05 | teardown: cleanup limpia timer + abort del controller (no setState tras unmount) | unit (fake clock + spy abort) | `node --test test/dashboard-poll.test.js` | ❌ Wave 0 |
| TUI-06 | keep-last-good: succeed×2-then-throw → `lastFrame()` conserva "3 sessions" + flag a `stale`/"server caído" | ink-testing-library | `node --test test/dashboard-status-line.test.js` | ❌ Wave 0 |
| TUI-06 | dos estados: arranque con fetch fallido → "waiting for server" (sin contador); recuperación → `● live` | ink-testing-library | `node --test test/dashboard-status-line.test.js` | ❌ Wave 0 |
| TUI-06 | JSON corrupto tratado como poll fallido (mismo path que ECONNREFUSED, D-07) | unit (client) + ink (status line) | `node --test test/dashboard-client.test.js test/dashboard-status-line.test.js` | ❌ Wave 0 |
| D-10 | `baseUrl` resuelve con config v1 migrado (sin `server`) → fallback 9090, NO TypeError | unit (DI loadConfig fake) | `node --test test/dashboard-baseurl.test.js` (o extender test existente de index) | ❌ Wave 0 |
| D-12 (heredado) | ningún archivo nuevo bajo `src/cli/dashboard/` importa `picocolors` | walker (ya existe) | `node --test test/format-isolation.test.js` | ✅ (cubre auto) |

### Sampling Rate
- **Per task commit:** `node --test test/dashboard-client.test.js test/dashboard-poll.test.js test/dashboard-status-line.test.js` (el subconjunto de la fase, < 5s; todo DI, sin red ni TTY).
- **Per wave merge:** `npm test` (suite completa, 895+ tests).
- **Phase gate:** `npm test` verde antes de `/gsd:verify-work`.

### Observabilidad de los comportamientos de resiliencia (Nyquist)
Los cuatro comportamientos load-bearing de la fase son **directamente observables vía aserción**, sin muestreo probabilístico:
- **single-flight (TUI-05):** observable contando `inFlight` en la fake fetch — invariante `maxInFlight === 1`. Determinista con fake clock.
- **keep-last-good (TUI-06):** observable en `lastFrame()` — el contador "3 sessions" persiste tras el throw. Determinista.
- **backoff (TUI-05/06):** observable registrando los argumentos de la fake `schedule` (los `interval` en orden) — secuencia esperada `[2500, 2500, 5000, 10000, 10000, …, 2500]` (reset). Determinista.
- **JSON corrupto → poll fallido (TUI-06):** observable como `{ok:false}` del cliente + status line en stale. Determinista.

Todos son herméticos (DI clock+fetch) → cero flakiness, corren en CI sin server. La única superficie NO automatizable (real raw-mode/TTY) NO existe en esta fase — eso es Phase 37 (attach). Esta fase es 100% automatizable.

### Wave 0 Gaps
- [ ] `test/dashboard-client.test.js` — TUI-05/06: `fetchStatus` ok/throw/JSON-corrupto/HTTP-no-ok → `{ok}` discriminant
- [ ] `test/dashboard-poll.test.js` — TUI-05: single-flight, backoff sube/resetea, teardown limpia timer+abort (DI clock+fetch)
- [ ] `test/dashboard-status-line.test.js` — TUI-06: keep-last-good (succeed×2-then-throw), dos estados (waiting/stale/live) vía `ink-testing-library`
- [ ] `test/dashboard-baseurl.test.js` (o extender un test de index) — D-10: config v1 migrado → fallback 9090 sin TypeError
- [ ] Framework install: ninguno — `node:test` + `ink-testing-library` ya disponibles

## Security Domain

> **Superficie de seguridad mínima.** El TUI es un cliente **read-only** de JSON en `localhost` que el server ya expone — sin auth, sin secretos, sin mutaciones, sin endpoints nuevos. No hay `security_enforcement: true` en `.planning/config.json`. Aun así, los dos riesgos relevantes para ESTA fase:

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | El path es localhost sin auth (el server ya expone `/status` sin token). |
| V3 Session Management | no | Sin sesiones HTTP. |
| V4 Access Control | no | Read-only; cero mutaciones (constraint del milestone). |
| V5 Input Validation | **yes** | Validación mínima del shape del payload (`Array.isArray(data.sessions)`) + `try/catch` en `res.json()`. JSON corrupto = poll fallido, nunca throw a React (Pitfall 12, D-07). |
| V6 Cryptography | no | Sin cripto en el path del TUI. |

### Known Threat Patterns for {Node fetch client + ink terminal render}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| JSON corrupto/parcial / página HTML de error tira el árbol ink | Denial of Service (crash) | `try/catch` en `client.js` → `{ok:false}` + keep-last-good (Pitfall 12). **Esta fase.** |
| Texto de tarea con escapes ANSI maliciosos movería el cursor / borraría pantalla al renderizar | Tampering / Spoofing (UI) | ink `<Text>` NO interpreta escapes embebidos como control por default. **Nota:** Phase 35 solo renderiza el **contador `N sessions`** (un número), no texto libre de tareas — el riesgo de inyección ANSI aparece en Phase 36 (tabla con `task_ref`/`repo`) y Phase 38 (comments/logs). Para esta fase NO hay texto untrusted en pantalla; documentar el riesgo para Phase 36. `[CITED: PITFALLS.md Security Mistakes]` |
| Loggear el payload de `/status` a scrollback | Information Disclosure | No `console.log` del payload; ink posee la pantalla. (No aplica directamente — esta fase no loggea.) |

## Sources

### Primary (HIGH confidence)
- **Codebase (leído directamente esta sesión):**
  - `src/cli/dashboard/index.js` (75 líneas) — `runDashboard` actual; **WR-01 NO arreglado** (línea 49, `loadConfig().server.port` sin guard).
  - `src/cli/dashboard/App.js` (56 líneas) — placeholder `starting…` a reemplazar; `useInput` gateado por `isRawModeSupported`; markup `React.createElement`.
  - `src/server.js:354-439` — handler `/status` (shape `{sessions:[{…,alive,elapsed_min}], count, pending, …}`, `count: enriched.length`), `/logs`, `/comments`. Endpoint caro (await `listPendingTasks` TTL + `cmux.listWorkspaces`).
  - `src/config.js:62-66` (`server.port: 9090` default), `82-102` (`migrateConfig` omite `server`), `120-129` (`loadConfig` solo mergea default si el archivo falta/parse-falla).
  - `test/dashboard-render.test.js` + `test/format-isolation.test.js:199-220` — patrón `ink-testing-library`; walker color-isolation ya cubre `src/cli/dashboard/`; `ink-testing-library@4` sin `waitUntilExit()`.
  - `34-REVIEW.md` WR-01..WR-03 — el advisory que D-10 cierra.
  - `package.json` — `engines.node >=20`, deps `ink@6.8.0`/`react@19.2.0`, devDep `ink-testing-library@4.0.0`; script `node --test`.
  - `node_modules` versions verificadas: `ink@6.8.0`, `react@19.2.6`, `ink-testing-library@4.0.0`; `node v25.9.0`.
- **Milestone research (verificada contra codebase en su sesión, citada):**
  - `.planning/research/ARCHITECTURE.md` — Pattern 1 (cliente puro never-throws), Pattern 2 (self-scheduling poll), Anti-Pattern 3, Data Flow, Build Order, Testability Map.
  - `.planning/research/PITFALLS.md` — Pitfalls 2/5/9/11/12 (las de P-poll = esta fase), Security Mistakes, Pitfall-to-Phase mapping.
  - `.planning/research/STACK.md` — `ink@6.8.0`+`react@19`, `fetch` built-in, AbortController, sin build step.
- **CONTEXT.md** (`35-CONTEXT.md`) — decisiones D-01..D-10 (locked), Discretion, Deferred.

### Secondary (MEDIUM confidence)
- Ninguna — esta fase no requirió WebSearch nueva; el stack y los patrones están verificados en el codebase y la research de milestone (que sí usó Context7 ink + npm registry en su sesión).

### Tertiary (LOW confidence)
- Ninguna.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — todas las versiones verificadas en `node_modules` esta sesión; cero dep nueva.
- Architecture: **HIGH** — Patterns 1/2/3 citados de ARCHITECTURE.md (verificada contra codebase) + confirmados contra `src/server.js`/`src/config.js` leídos directamente.
- Pitfalls: **HIGH** — citados de PITFALLS.md (P-poll), todos unit-testables con DI; constraint `ink-testing-library` sin `waitUntilExit()` verificado en `test/dashboard-render.test.js`.
- WR-01 (D-10): **HIGH** — estado "no arreglado" verificado leyendo `index.js:49` + `config.js:82-102` esta sesión.

**Research date:** 2026-05-27
**Valid until:** 2026-06-26 (30 días — stack estable, ink@6 pinned, sin dep nueva). Re-verificar si se bumpea Node floor o ink major.
