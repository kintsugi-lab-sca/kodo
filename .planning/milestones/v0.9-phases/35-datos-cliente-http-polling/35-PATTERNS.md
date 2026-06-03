# Phase 35: Datos — cliente HTTP + polling - Pattern Map

**Mapped:** 2026-05-27
**Files analyzed:** 4 (2 nuevos, 2 modificados) + 3 archivos de test nuevos
**Analogs found:** 7 / 7 (100% cobertura — todos los patrones tienen análogo verificado en el codebase)

> Idioma: español. Las decisiones D-01..D-10 viven en `35-CONTEXT.md`; los patrones de milestone
> en `.planning/research/ARCHITECTURE.md` / `PITFALLS.md`. Este mapa apunta al **código real**
> del repo que el planner debe copiar, no a los ejemplos ilustrativos del RESEARCH.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/cli/dashboard/client.js` (NUEVO) | service (data layer, React-free) | request-response | `src/providers/github/client.js` | role-match (HTTP client + `fetch` inyectable; difiere en never-throws vs throws) |
| `src/cli/dashboard/usePoll.js` (NUEVO) | hook (pure-ish, clock inyectable) | event-driven (self-scheduling poll) | `src/triggers/polling.js` (`startPolling`) | exact (recursive `setTimeout` + clock DI + cancel) |
| `src/cli/dashboard/App.js` (MODIFICADO) | component (ink/react root) | request-response → render | `src/cli/dashboard/App.js` (estado Phase 34) | exact (mismo archivo, mismo markup base) |
| `src/cli/dashboard/index.js` (MODIFICADO) | config / process owner | request-response | `src/cli/dashboard/index.js:48-49` + `src/config.js:120-129` | exact (línea concreta a parchear) |
| `test/dashboard-client.test.js` (NUEVO) | test (unit, fake fetch) | request-response | `test/providers/github/client.test.js:32-88` | exact (helper `makeFetch`/`makeSpyFetch` + leak guard) |
| `test/dashboard-poll.test.js` (NUEVO) | test (unit, fake clock+fetch) | event-driven | `test/providers/github/client.test.js` + `DEFAULT_CLOCK` de `polling.js:96-100` | role-match (DI clock; el análogo de poll-test exacto no existe aún) |
| `test/dashboard-status-line.test.js` (NUEVO) | test (ink render) | render | `test/dashboard-render.test.js` | exact (mismo harness `ink-testing-library`) |

## Pattern Assignments

### `src/cli/dashboard/client.js` (service, request-response)

**Análogo:** `src/providers/github/client.js` (fetch inyectable + parse) y `src/providers/plane/client.js:46-90` (`AbortSignal.timeout`, lectura de `res.ok`/`res.status`/`res.json()`).

> **Divergencia clave a documentar para el planner:** los dos clientes existentes **lanzan**
> (`throw new Error`, `src/providers/plane/client.js:72`). `client.js` de Phase 35 es lo
> **contrario** por diseño (D-07, Pattern 1): nunca lanza, devuelve el discriminante
> `{ok:true,data}` / `{ok:false,error}`. Copiar de los análogos la *forma del fetch inyectable*
> y *cómo se leen `res.ok`/`res.status`/`res.json()`*, NO la propagación de excepciones.

**Header / @ts-check + JSDoc pattern** (de `src/providers/github/client.js:1-31`):
```js
// @ts-check
//
// src/cli/dashboard/client.js — Phase 35 (TUI-05/TUI-06).
// Cliente HTTP puro, React-free, never-throws. Color-isolation: NO picocolors.
```
Mantener el comentario-cabecera explicativo (estilo de todo `src/cli/dashboard/**` y de los clients).

**Fetch inyectable pattern** (de `src/providers/github/client.js:76,85` — `opts.fetch || globalThis.fetch`):
```js
// El default vive en la firma; los tests inyectan un fake (sin globalThis mutation).
export async function fetchStatus(baseUrl, fetchFn = globalThis.fetch, signal) {
```

**Lectura de Response + parse** (copiar la *forma* de `src/providers/plane/client.js:46,70,90` y
`src/providers/github/client.js` — `res.ok`, `res.status`, `await res.json()`), pero colapsando a
`{ok:false}` en vez de throw:
```js
try {
  const res = await fetchFn(`${baseUrl}/status`, { signal });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };   // D-07 (cf. plane:70-72 throw)
  const data = await res.json();                                     // puede throw → catch (Pitfall 12)
  if (!Array.isArray(data.sessions)) return { ok: false, error: 'bad shape' };  // shape mínima
  return { ok: true, data };
} catch (err) {
  return { ok: false, error: err.message };  // ECONNREFUSED / abort / JSON corrupto
}
```

**Shape del payload `/status` a consumir** (verificado en `src/server.js:397-411`):
`{ sessions: [{…, alive, elapsed_min}], count: enriched.length, pending, pending_count, history, metrics, uptime }`.
Para "N sessions" usar `data.count` (`src/server.js:399` → `count: enriched.length`) o
`data.sessions.length` (D-01 los acepta como equivalentes). **Server READ ONLY — no se toca.**

**Timeout** (Discretion del planner — dos formas válidas en el codebase):
- `AbortSignal.timeout(ms)` ya usado en `src/providers/plane/client.js:53` (`signal: AbortSignal.timeout(10_000)`) — más terso.
- `AbortController` + `setTimeout(abort, 5000)` re-creado por tick — D-05 lo nombra; el handle vive en `usePoll` para abort-on-unmount (ver abajo). **Recomendado por D-05/D-09.**

---

### `src/cli/dashboard/usePoll.js` (hook, event-driven self-scheduling)

**Análogo:** `src/triggers/polling.js` (`startPolling`, `DEFAULT_CLOCK`) — es el patrón
self-scheduling + clock-inyectable **ya en producción** del proyecto. `usePoll` es la versión
React/ink del mismo loop (recursive `setTimeout`, cancel flag, no `setInterval`).

**Clock inyectable pattern** (copiar de `src/triggers/polling.js:79-100`):
```js
// @typedef Clock { setTimeout, clearTimeout, now }
const DEFAULT_CLOCK = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  now: () => Date.now(),
};
```
> **Nota de diseño:** `polling.js` centraliza `Date.now()` en el clock (Pitfall #5 del análogo:
> "this is the ONLY occurrence of `Date.now()` permitted"). Para `usePoll`/`App` la edad (D-08) se
> recalcula por poll usando `clock.now()` inyectable — mismo principio, hace el test de la edad
> determinista. El RESEARCH ilustra `schedule = setTimeout, cancel = clearTimeout` como opts; el
> objeto `Clock` de `polling.js` es la forma canónica del proyecto — el planner elige, ambas pasan los locks.

**Recursive setTimeout + single-flight** (copiar la estructura de `startPolling.tick`,
`src/triggers/polling.js:494-555`): el `tick` async hace `await` del trabajo y SOLO al final
re-arma `timer = clock.setTimeout(tick, intervalMs)` (`polling.js:552-554`). Esto es exactamente
el single-flight de D-03 (TUI-05). NUNCA `setInterval` (Anti-Pattern 3).
```js
async function tick() {
  if (cancelled) return;                          // cf. polling.js:495 `if (stopped) return;`
  const result = await savedFn.current(signal);   // await → single-flight (D-09)
  if (cancelled) return;
  savedOn.current(result);
  interval = result.ok ? baseMs : Math.min(interval * 2, maxMs);  // backoff/reset (D-04)
  timer = clock.setTimeout(tick, interval);        // re-arma SOLO ahora (cf. polling.js:553)
}
```

**Backoff pattern** (la lógica de duplicar-con-cap es net-new aquí, pero el *concepto* de backoff
exponencial existe en `src/triggers/polling.js:440` y `src/providers/plane/client.js:63`
`Math.min(1000 * 2 ** attempt, 8000)`). Para D-04: `interval = result.ok ? baseMs : Math.min(interval*2, maxMs)`
con `baseMs=2500`, `maxMs=10000` → secuencia `[2500, 5000, 10000, 10000, …]`, reset a 2500 al ok.

**Cancel / teardown pattern** (copiar de `startPolling`, `src/triggers/polling.js:570-575`):
```js
// El stop() de startPolling: flag + clearTimeout.
return { stop() { stopped = true; if (timer) clock.clearTimeout(timer); } };
```
Adaptado al cleanup de `useEffect` (D-09, Pitfall 9), añadiendo el `abort()` del controller del tick:
```js
return () => { cancelled = true; if (timer) clock.clearTimeout(timer); ac?.abort(); };
```

**useEffect / useRef host** (de `src/cli/dashboard/App.js:25-26` y RESEARCH Pattern 2):
`import { useEffect, useRef } from 'react';` — guardar `fn`/`onResult` en `useRef` para no re-armar
el efecto en cada render (firma ilustrativa en RESEARCH líneas 219-244).

> **Discretion (Open Question 2):** el *timing* del backoff vive en el hook; el keep-last-good +
> connection display state vive en `App`. El hook reporta cada `{ok}` vía callback `onResult`.

---

### `src/cli/dashboard/App.js` (component, request-response → render) — MODIFICADO

**Análogo:** él mismo (estado Phase 34, leído completo: 56 líneas). Reemplaza el placeholder
`starting…` (`App.js:53`) por la status line viva (D-01). Preservar TODO lo demás (color-isolation,
markup `React.createElement` plano, `useInput` gateado por `isRawModeSupported`).

**Imports pattern existente** (`src/cli/dashboard/App.js:25-26` — preservar y extender):
```js
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import { createElement } from 'react';   // + useState/useEffect para connection/keep-last-good state
```
Añadir `useState` (y el `usePoll` local) — **cero `picocolors`** (invariante D-12, verificado por
`test/format-isolation.test.js`).

**Markup pattern a clonar** (`src/cli/dashboard/App.js:49-55`) — la status line reemplaza solo el
nodo central; banner y footer se conservan:
```js
return createElement(
  Box, { flexDirection: 'column', borderStyle: 'round', paddingX: 1 },
  createElement(Text, { bold: true }, 'kodo dashboard'),      // banner (conservar)
  // ← AQUÍ: status line viva en vez de `starting…` (D-01).
  //   ● live / ⚠ server caído (color SOLO de <Text color>),  N sessions (last update Ns ago, retrying…)
  createElement(Text, { dimColor: true }, 'q quit'),          // footer (conservar)
);
```

**Color pattern** (invariante D-12, `App.js:21-22`): color SOLO de props de `<Text>` de ink
(`{ color: 'green' }` para `● live`, `{ color: 'yellow' }`/`dimColor` para `⚠ server caído`).
JAMÁS `import` de `picocolors` ni del helper de color del CLI clásico.

**Keep-last-good + dos estados de degradación** (D-06, Pattern 3 del RESEARCH líneas 252-271):
el `onResult` del `usePoll` actualiza `lastGoodCount`/`lastGoodAt`/`connected`/`lastError`/`lastAttemptAt`
en estado de React; en fallo NO toca `lastGoodCount` (keep-last-good). Derivar el estado de render
(puro): `never had good → 'waiting for server'` · `had good + !connected → 'stale'` · `connected → 'live'`.

**Lifecycle a preservar** (`App.js:36-47`): `useApp().exit()` en `q` (D-08), `useInput` gateado.
La firma `App({ baseUrl })` (`App.js:36`) NO cambia — `baseUrl` ya llega resuelto desde `index.js`.

---

### `src/cli/dashboard/index.js` (config / process owner) — MODIFICADO (guard WR-01, D-10)

**Análogo:** él mismo (`src/cli/dashboard/index.js:48-49`) + el patrón de fallback-a-default de
`src/config.js:120-129` (`loadConfig` solo mergea `DEFAULT_CONFIG` cuando el archivo falta/parse-falla,
NO cuando `migrateConfig` omite la clave `server`).

**Línea actual a reemplazar** (`src/cli/dashboard/index.js:48-49`, verificado NO arreglado):
```js
const { loadConfig } = await import('../../config.js');
const baseUrl = url ?? `http://localhost:${loadConfig().server.port}`;   // ← TypeError si config v1 migrado
```

**Causa raíz** (verificada): `migrateConfig` (`src/config.js:82-102`) reconstruye el config
**sin** la clave `server` (solo copia `provider`/`providers`/`...rest` de `planeOld`). Un usuario con
config v1 migrado → `loadConfig().server` es `undefined` → `.port` lanza `TypeError`.

**Fix pattern** (optional-chaining + fallback al default conocido; `DEFAULT_CONFIG.server.port` = 9090,
`src/config.js:62-66`):
```js
const { loadConfig, DEFAULT_CONFIG } = await import('../../config.js');
const cfg = loadConfig();
const port = cfg.server?.port ?? DEFAULT_CONFIG.server.port;
const baseUrl = url ?? `http://localhost:${port}`;
```
> **Assumption A1 RESUELTA (verificado contra codebase):** `DEFAULT_CONFIG` **sí está exportado**
> — `src/config.js:228` hace `export { KODO_DIR, CONFIG_PATH, PROJECTS_PATH, DEFAULT_CONFIG };`
> (la declaración `const DEFAULT_CONFIG = {…}` está en la línea 32, pero el `export` agregado al
> final del módulo lo expone). El fix de WR-01 importa `DEFAULT_CONFIG` directamente **sin tocar
> `config.js`** — no hace falta añadir export ni hardcodear `?? 9090`.

---

### `test/dashboard-client.test.js` (test unit, fake fetch) — NUEVO

**Análogo:** `test/providers/github/client.test.js:32-88` (helpers `makeFetch`/`makeSpyFetch` +
fetch-leak guard). El patrón está maduro y es la referencia exacta del proyecto.

**Fetch-leak guard pattern** (copiar de `test/providers/github/client.test.js:32-42`): reemplazar
`globalThis.fetch` por un thrower en setup para que cualquier test que olvide inyectar el fake falle
loud en vez de tocar la red.

**Fake fetch builder pattern** (copiar de `test/providers/github/client.test.js:52-70`) — Response-like
mínimo con `status`/`ok`/`headers.get`/`json()`/`text()`. Para Phase 35, añadir escenarios:
- ok → `{ status:200, body:{ sessions:[{}], count:1 } }` → assert `{ok:true}`
- HTTP no-ok → `{ status:500 }` → assert `{ok:false}` (D-07)
- JSON corrupto → `json: async () => { throw new SyntaxError('Unexpected token'); }` → assert `{ok:false}` (Pitfall 12)
- throw (ECONNREFUSED) → `fetchFn` que `throw new Error('ECONNREFUSED')` → assert `{ok:false}`
- bad shape → `{ count:3 }` sin `sessions` array → assert `{ok:false, error:'bad shape'}`

**Runner:** `node:test` + `node:assert/strict` (`import { describe, it } from 'node:test'`;
`import assert from 'node:assert/strict'` — ver `test/dashboard-render.test.js:32-33`).

---

### `test/dashboard-poll.test.js` (test unit, fake clock + fake fetch) — NUEVO

**Análogo parcial:** combina la DI de fetch de `test/providers/github/client.test.js` con la DI de
clock de `src/triggers/polling.js:96-100` (`DEFAULT_CLOCK`). No existe un test de poll-loop con
fake-clock en el codebase aún, así que el planner ensambla los dos patrones (ver "No Analog Found").

**Single-flight test** (load-bearing TUI-05, RESEARCH líneas 354-366): fetch lento que cuenta
`inFlight`/`maxInFlight` → assert `maxInFlight === 1`. Drivear con fake `schedule`/`clock.setTimeout`.

**Backoff test** (TUI-05/06): capturar los `interval` pasados a la fake `schedule` → assert secuencia
`[2500, 5000, 10000, 10000, …]` ante fallos y reset a `2500` al primer ok (D-04).

**Teardown test** (Pitfall 9): spy sobre `clearTimeout`/`abort` → assert que el cleanup del effect los
llama y que no hay `onResult` tras `cancelled`.

> **Constraint de harness verificado:** `ink-testing-library@4.0.0` NO expone `waitUntilExit()`
> (solo `rerender/unmount/cleanup/stdin/stdout/stderr/frames/lastFrame`) — `test/dashboard-render.test.js:21-26`.
> Si el hook se testea sin React, mejor extraer el scheduler a función pura testeable con fake clock.

---

### `test/dashboard-status-line.test.js` (test ink render) — NUEVO

**Análogo:** `test/dashboard-render.test.js` (exact — mismo harness, mismo proyecto, Phase 34).

**Render pattern** (copiar de `test/dashboard-render.test.js:34-46`):
```js
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App from '../src/cli/dashboard/App.js';
const { lastFrame, frames } = render(createElement(App, { baseUrl: 'http://localhost:9090', /* fetchFn/clock fakes */ }));
assert.match(lastFrame(), /● live/);
```

**Keep-last-good test** (load-bearing TUI-06, RESEARCH líneas 369-385): fetch que succeed×2-then-throw
→ `lastFrame()` conserva `3 sessions` (NO blanqueado) + muestra `server caído`/`retrying`.

**Dos estados test** (D-06): arranque con fetch fallido → `lastFrame()` muestra `waiting for server`
(sin contador); recuperación → `● live`.

> Inyectar `fetchFn` + `clock` fakes en `App` vía props (igual que `baseUrl` ya se inyecta en
> `test/dashboard-render.test.js:40`) para que el render sea hermético, sin red ni timers reales.

---

## Shared Patterns

### `@ts-check` + comentario-cabecera explicativo
**Source:** todos los archivos de `src/cli/dashboard/**` (`App.js:1`, `index.js:1`) y los clients
(`src/providers/github/client.js:1-31`).
**Apply to:** `client.js`, `usePoll.js` (nuevos). Primera línea `// @ts-check`, seguido de un bloque
de comentario que explique responsabilidad + decisiones (D-XX) + invariantes.

### Color-isolation (invariante D-12)
**Source:** `src/cli/dashboard/App.js:21-22` (comentario) + `test/format-isolation.test.js:199-220` (walker).
**Apply to:** `client.js`, `usePoll.js`, `App.js`. CERO `import` de `picocolors` ni del helper de color
del CLI clásico bajo `src/cli/dashboard/**`. Color SOLO de props `<Text color>`. El walker existente
ya cubre los archivos nuevos automáticamente — NO hace falta test nuevo (Open Question 3).

### Dependency Injection para tests herméticos
**Source:** fetch DI en `src/providers/github/client.js:76,85`; clock DI en `src/triggers/polling.js:79-100,483`;
helpers de test en `test/providers/github/client.test.js:32-88`.
**Apply to:** `client.js` (`fetchFn` inyectable), `usePoll.js` (clock/schedule inyectable), todos los
tests nuevos. Node test runner carece de `mock.module` → DI por parámetro es la única vía hermética
del proyecto. Tests avanzan el clock manualmente; fetch fake con fixtures + throw.

### Lazy import del subcomando
**Source:** `src/cli/dashboard/index.js:48,53-55` (`await import('../../config.js')`, `await import('ink')`).
**Apply to:** `index.js` (preservar el lazy import al añadir `DEFAULT_CONFIG`). Mantiene el arranque
del CLI ligero — no cargar `ink`/`react` salvo en el path del subcomando.

### Result object vs throw (divergencia documentada)
**Source (contraste):** `src/providers/plane/client.js:72` y `src/providers/github/client.js:24-26` LANZAN.
**Apply to:** `client.js` de Phase 35 hace lo CONTRARIO (never-throws `{ok}`). Documentar explícitamente
en el plan que esta es una divergencia intencional de los clients existentes (D-07, Pattern 1) — el
invariante "no crash" es estructural en el cliente, no en React.

## No Analog Found

| File / Pattern | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `usePoll.js` (React hook con `useEffect`) | hook | event-driven | No existe ningún custom React hook en el codebase (la carpeta `src/hooks/` son git-hooks de cmux, NO React). El *loop* tiene análogo fuerte (`startPolling`), pero el *envoltorio React* (`useEffect`/`useRef`/cleanup) es net-new — usar RESEARCH Pattern 2 (líneas 211-246) como plantilla, con la mecánica de loop copiada de `polling.js`. |
| `test/dashboard-poll.test.js` (fake-clock poll-loop test) | test | event-driven | No hay un test de poll-loop self-scheduling con fake-clock aislado; el planner ensambla fetch-DI (`github/client.test.js`) + clock-DI (`polling.js DEFAULT_CLOCK`). El test de `polling.js` (`test/` no listado para poll-loop puro) usa el clock real/integración — no es plantilla directa. |
| Backoff duplicar-con-cap + reset | (lógica en usePoll) | — | El concepto existe (`plane/client.js:63` `Math.min(2**attempt*1000, 8000)`; `polling.js:440`) pero la variante "duplica, cap 10s, reset a base al ok" es net-new — D-04 es la spec. |

## Metadata

**Analog search scope:** `src/cli/dashboard/`, `src/providers/{github,plane}/`, `src/triggers/`,
`src/cli/`, `src/config.js`, `src/server.js`, `test/` (raíz + `test/providers/github/`).
**Files scanned:** 9 leídos (index.js, App.js, config.js, server.js §354-439, github/client.js,
plane/client.js, triggers/polling.js, dashboard-render.test.js, github/client.test.js) + greps de inventario.
**Pattern extraction date:** 2026-05-27
**Server constraint:** `src/server.js` READ ONLY — cero endpoints nuevos (constraint dura del milestone).
```