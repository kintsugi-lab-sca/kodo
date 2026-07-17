# Phase 76: Convergencia del conteo `pending` - Research

**Researched:** 2026-07-17
**Domain:** Refactor de camino de lectura interno (Node.js ESM · `node:http` server + CLI one-shot) — factory con DI, caché TTL, política de frescura fail-open
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Fuente única del conteo (ORCH-05)**

- **D-01: Módulo puro compartido con factory DI** — extraer fetch+caché+frescura a un módulo nuevo (factory tipo `createPendingResolver({ listPendingTasksFn, ttlMs, now })`), espejo exacto de `src/server/provider-state.js` (recibe `PENDING_CACHE_TTL_MS` de server.js «sin segundo literal» — D-02 Phase 40). `server.js` lo instancia con `PENDING_CACHE_TTL_MS` (30s); `check.js` usa el mismo módulo en modo fresco (TTL 0 / sin caché). Ambos números salen de la misma función. Rechazado: quitar el caché de `/status` (la TUI pollea `/status` cada ~2.5s → martilleo al provider); caché cross-proceso en disco (descartado por REQUIREMENTS §Out of Scope).
- **D-02: El módulo es hoja de imports mínimos** — `kodo check` tiene test-graph guard (LOG-12, `test/check-isolation.test.js`). El módulo compartido no importa logger ni deps pesadas; recibe todo por DI (precedente: `src/session/handoff.js`, hoja de cero imports blindada por el mismo test).
- **D-03: TTL 30s se mantiene** — un solo literal `PENDING_CACHE_TTL_MS`. La convergencia es de código y semántica; la ventana ≤30s residual queda honesta y auditable vía `pending_fetched_at` (D-05).

**Política de frescura en fallo del provider (ORCH-06)**

- **D-04: Resultado discriminado con frescura explícita** — el módulo devuelve `{ tasks, fetched_at, stale }`: fetch OK → `stale: false` y `fetched_at` del momento; fetch falla → **last-known-good etiquetado** (`stale: true` + el `fetched_at` real del último éxito), jamás dato viejo presentado como fresco. Cold-start con provider caído → `tasks: []`, `fetched_at: null`, `stale: true`. Rechazado: colapsar a `pending_count: null` en error — rompería el shape numérico del HTML (`server.js:370`) y descarta información útil.

**Contrato `/status` y superficie de consumo**

- **D-05: Campos aditivos, tipos intactos** — `/status` gana `pending_stale: boolean` y `pending_fetched_at: string|null` (ISO), siempre presentes; `pending` (array) y `pending_count` (number) conservan tipo y significado. Aditivo puro, cero endpoints nuevos. Precedente: enriquecimiento `provider_state` de Phase 40.
- **D-06: El HTML del dashboard web marca lo stale** — la stat «Candidatas» (`server.js:370`) indica visualmente cuando `pending_stale` es true (dim o sufijo corto); el detalle exacto es Claude's Discretion. La TUI ink no cambia.
- **D-07: `kodo check` — output sano byte-idéntico** — camino sano de `checkPendingTasks` produce exactamente las mismas líneas que hoy; en error conserva la línea roja actual. `check` sigue siendo fresco.

**Verificación de la convergencia**

- **D-08: Cerrar el hueco de cobertura** — hoy cero tests cubren el carril `pendingCache`. La fase entrega: tests unitarios del módulo (TTL fresco/caducado, catch etiquetado stale, cold-start caído, clock inyectado), y tests de contrato de `/status` (campos nuevos presentes en ambas ramas).
- **D-09: Guard source-hygiene de la convergencia** — un test que verifique que server y check consumen el módulo compartido y no re-implementan la lógica inline (precedente anti-inline: Phase 13, walker de `handoff.js`). `test/check-isolation.test.js` debe seguir verde con el import nuevo.

### Claude's Discretion

- Nombre y ubicación del módulo compartido (`src/server/pending.js` junto a `provider-state.js` vs módulo neutral tipo `src/tasks/pending.js` — atención al grafo de check-isolation).
- Dedup in-flight de fetches solapados (el resolver de Phase 40 lo tiene; espejarlo aquí es recomendable pero no requisito).
- Indicador visual exacto de staleness en el HTML web y su redacción.
- Si `checkPendingTasks` instancia el resolver con TTL 0 o consume una función `fetchFresh` exportada por el mismo módulo — mientras la lógica viva en un solo sitio.

### Deferred Ideas (OUT OF SCOPE)

- None nuevos. El rediseño del `pendingCache` a invalidación por evento ya estaba descartado en REQUIREMENTS §Out of Scope ("sobreingeniería para un TTL de 30s"). No tocar `src/triggers/polling.js` (semántica de entrega, no de reporte). No endpoints nuevos. TUI ink no consume `pending`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORCH-05 | El conteo `pending` de `/status` converge con `kodo check` — hoy `/status` sirve desde `pendingCache` (TTL 30s, `server.js:591`) mientras `check.js:37` lee fresco, divergiendo hasta 30s | Módulo compartido `createPendingResolver` (D-01) instanciado con TTL 30s en server, TTL 0 / fetch-fresco en check. La convergencia es de **código y semántica** (mismo fetch, misma interpretación de `pending.length`), no de caché compartida — imposible: check es proceso CLI separado. Ventana residual ≤30s auditada vía `pending_fetched_at`. Ver «Architecture Patterns». |
| ORCH-06 | Con provider caído, `/status` no presenta conteo viejo como fresco — hoy `server.js:599` devuelve `pendingCache.data` en el catch **sin comprobar TTL** | Resultado discriminado `{tasks, fetched_at, stale}` (D-04): fetch fallido → last-known-good etiquetado `stale:true` + `fetched_at` real; cold-start caído → `[]`/`null`/`stale:true`. Campos aditivos en `/status` (D-05) hacen la staleness **visible en la respuesta**, no solo en `console.warn`. Ver «Common Pitfalls» y «Code Examples». |
</phase_requirements>

## Summary

Esta fase es un **refactor quirúrgico de un camino de lectura interno**, no una feature. El núcleo del trabajo es extraer la lógica de fetch+caché+frescura de `pending` (hoy inline en `server.js:588-601`) a un módulo puro con DI, y que tanto `server.js` (`/status`) como `check.js` (`checkPendingTasks`) lo consuman. No hay librerías nuevas, cero dependencias npm, cero endpoints. El precedente arquitectónico exacto ya existe en el repo: `src/server/provider-state.js` (Phase 40) es una factory `createXResolver({ deps, ttlMs, now })` con caché TTL, dedup in-flight y fail-open, extraída de `server.js` precisamente porque el handler HTTP no tiene harness de test. Este módulo se replica con la semántica de frescura discriminada que ORCH-06 exige.

El constraint estructural que gobierna todo el diseño: **`kodo check` es un proceso CLI separado del server — no comparten memoria**. «Converger» no puede significar caché compartida. Significa que ambos consumidores ejecutan el **mismo código de fetch** con la **misma semántica** (`pending.length` sobre la misma lista fresca), y que la ventana de divergencia (≤ TTL 30s en el lado server) queda documentada y auditable vía un timestamp expuesto (`pending_fetched_at`). El segundo constraint que fija la forma del módulo: `check.js` está blindado por `test/check-isolation.test.js` (LOG-12) — su grafo de imports no puede arrastrar `logger.js`, providers pesados ni `polling.js`. Por eso el módulo compartido debe ser una **hoja de cero imports** (como `src/session/handoff.js`), recibiendo `listPendingTasksFn`, `ttlMs` y `now` por inyección; cualquier emisión de evento/log la hace el caller, no el módulo.

La causa raíz de ORCH-06 está localizada línea a línea: `server.js:599` (`pending = pendingCache.data`) devuelve datos arbitrariamente viejos en el catch **sin comprobar TTL**, con solo un `console.warn` de rastro. Un operador que ve «0 candidatas» no puede distinguir «el provider dice 0» de «el provider está caído y esto es lo último que supimos hace 10 minutos». La solución no reduce el TTL ni añade un bus de invalidación (ambos descartados): mueve la decisión de frescura al módulo, que etiqueta explícitamente `stale`.

**Primary recommendation:** Crear una hoja de cero imports `src/tasks/pending.js` que exporte (a) `fetchFreshPending(listPendingTasksFn)` — la lógica de fetch única, que `check.js` consume directamente conservando su try/catch + línea roja byte-idéntica (D-07); y (b) `createPendingResolver({ listPendingTasksFn, ttlMs, now })` que envuelve `fetchFreshPending` con caché+staleness discriminada (`{tasks, fetched_at, stale}`) para `server.js`. Instanciar el resolver en `startServer()` (espejo del wiring de `providerStateResolver`, líneas 504-509), reemplazar el bloque `server.js:590-601`, y añadir `pending_stale`/`pending_fetched_at` al payload (líneas 648-662). Guard anti-inline con el mismo import-walker de `check-isolation.test.js`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fetch de tareas pending del provider | API / Backend (módulo puro DI) | — | Ambos consumidores (server HTTP + CLI check) delegan al mismo módulo; el fetch en sí es `provider.listPendingTasks()`, ya un método del contrato TaskProvider |
| Caché TTL + política de frescura (stale/fresh) | API / Backend (server lifetime) | — | Solo el server se beneficia de cachear (poll cada ~2.5s de la TUI); `check` es one-shot, TTL 0. La semántica de frescura vive en el módulo, no en el handler |
| Reporte de `pending_count` a `/status` | Frontend Server (`/status` handler) | Browser (HTML dashboard) | El handler serializa el resultado discriminado; el HTML (`server.js:370`) es el único consumidor visual y marca lo stale (D-06) |
| Reporte de `pending` en `kodo check` | CLI (proceso separado) | — | `checkPendingTasks` imprime líneas; consume el mismo fetch en modo fresco. NO comparte memoria con el server |
| Señalización de staleness al operador/orquestador | API (campos aditivos en `/status`) | Browser (indicador dim en HTML) | ORCH-06: la staleness debe ser dato en la respuesta, no `console.warn` |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:test` | built-in (Node ≥18) | Framework de tests (`describe`/`it`) | Ya es el único runner del repo (`package.json` → `node --test`); cero deps [VERIFIED: package.json grep] |
| `node:assert/strict` | built-in | Asserts en tests | Patrón establecido en todos los `test/*.test.js` [VERIFIED: codebase grep] |
| `node:http` | built-in | Server de `/status` | Ya en uso (`src/server.js:2`); no se toca la capa HTTP, solo el handler `/status` [VERIFIED: codebase] |

### Supporting

Ninguna. **Constraint LOCKED cross-milestone: cero dependencias npm nuevas** [CITED: REQUIREMENTS.md §Constraints, STATE.md Critical Invariants]. `dependencies` del repo: `commander, ink, picocolors, react`; `devDependencies`: `@types/react, ink-testing-library` [VERIFIED: package.json].

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Módulo hoja de cero imports emitiendo staleness por return | Módulo que emite `console.warn`/evento internamente | Rompería D-02: contaminaría el grafo de `check.js` (LOG-12). El caller emite, el módulo devuelve. |
| Resolver con caché en server | Quitar el caché de `/status` (leer siempre fresco) | Rechazado en D-01: la TUI pollea `/status` cada ~2.5s → martilleo al provider Plane en cada tick |
| Ventana TTL residual auditada por timestamp | Reducir/eliminar el TTL para «cuadrar» números | Rechazado en D-03: castiga al provider; la convergencia es de código, no de números |

**Installation:** N/A — cero paquetes nuevos.

## Package Legitimacy Audit

> N/A — esta fase instala **cero paquetes externos** (constraint LOCKED «cero dependencias npm nuevas»). Todo el trabajo usa built-ins de Node (`node:test`, `node:assert`, `node:http`) ya presentes. No hay superficie de legitimidad de paquetes que auditar.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────────┐
                     │      src/tasks/pending.js  (HOJA, 0 imports) │
                     │                                              │
                     │  fetchFreshPending(listPendingTasksFn)       │◄── lógica de fetch ÚNICA
                     │     → await listPendingTasksFn()  (puede throw)   (fuente de verdad ORCH-05)
                     │                                              │
                     │  createPendingResolver({listPendingTasksFn,  │
                     │     ttlMs, now})  → { resolve() }            │
                     │     resolve() nunca throw:                   │
                     │       fresh  → {tasks, fetched_at, stale:false}
                     │       TTL ok → cache as fresh                │
                     │       fail+cache → {last-known-good, stale:true}  (ORCH-06)
                     │       fail cold → {[], null, stale:true}     │
                     └───────────▲──────────────────────▲──────────┘
                                 │ ttlMs:0 fresh          │ ttlMs:30s + caché
                                 │ (consume fetchFresh)    │ (resolve, server lifetime)
                                 │                         │
       ┌─────────────────────────┴──────┐   ┌─────────────┴───────────────────────────┐
       │  src/check.js                  │   │  src/server.js  (startServer)            │
       │  checkPendingTasks({...})      │   │  const pendingResolver = create...(      │
       │    try { fetchFreshPending() } │   │     ttlMs: PENDING_CACHE_TTL_MS)         │
       │    catch → línea roja (D-07)   │   │  GET /status:                            │
       │  proceso CLI one-shot          │   │    const {tasks,fetched_at,stale} =      │
       │  (NO comparte memoria)         │   │        await pendingResolver.resolve()   │
       └────────────────────────────────┘   │    payload += pending_stale,             │
                                             │              pending_fetched_at (D-05)   │
                                             │    HTML :370 marca stale (D-06)          │
                                             └──────────────────────────────────────────┘
```

### Component Responsibilities

| File | Responsibility | Change |
|------|----------------|--------|
| `src/tasks/pending.js` (NUEVO) | Fetch único + resolver con caché/frescura. Hoja de cero imports. | Crear |
| `src/server.js:20-22` | `PENDING_CACHE_TTL_MS` + `let pendingCache` module-level | Eliminar `pendingCache` (pasa a vivir en el closure del resolver); conservar `PENDING_CACHE_TTL_MS` como única fuente del número |
| `src/server.js:~504-509` | Wiring del resolver en `startServer()` | Añadir `const pendingResolver = createPendingResolver({...})` junto al `providerStateResolver` |
| `src/server.js:590-601` | Bloque inline de caché/fetch/catch defectuoso | Reemplazar por `const {tasks, fetched_at, stale} = await pendingResolver.resolve()` |
| `src/server.js:648-662` | Payload `/status` | Renombrar `pending`→`tasks` local; añadir `pending_stale`, `pending_fetched_at`; `pending_count` = `tasks.length` |
| `src/server.js:370` | HTML stat «Candidatas» | Indicador visual de staleness cuando `pending_stale` (D-06) |
| `src/check.js:29-52` | `checkPendingTasks` | Sustituir `await provider.listPendingTasks()` por `await fetchFreshPending(...)`; conservar try/catch + línea roja (D-07) |

### Recommended Project Structure

```
src/
├── tasks/
│   └── pending.js          # NUEVO — hoja de cero imports (fetchFreshPending + createPendingResolver)
├── server/
│   └── provider-state.js   # patrón a espejar (NO tocar)
├── server.js               # /status handler + wiring del resolver
├── check.js                # checkPendingTasks consume fetchFreshPending
└── session/
    └── handoff.js          # precedente de hoja cero-imports (NO tocar)
test/
├── tasks/
│   └── pending.test.js     # NUEVO — unit del módulo (TTL, stale, cold-start, clock)
├── check-isolation.test.js # AMPLIAR — guard: check no arrastra deps vía pending.js
├── check.test.js           # AMPLIAR — checkPendingTasks vía fetchFreshPending
└── server/
    └── status-pending.test.js  # NUEVO — contrato /status (campos nuevos, ambas ramas)
```

### Pattern 1: Factory con DI + caché TTL + fail-open (espejo de provider-state.js)

**What:** Una `create*Resolver({ deps, ttlMs, now = Date.now })` que cierra sobre una caché privada y devuelve `{ resolve() }`. `now` inyectable para tests deterministas de TTL sin timers reales.
**When to use:** Siempre en este carril — es el precedente exacto que D-01 replica.
**Example:**
```javascript
// Source: src/server/provider-state.js:63-122 (patrón a espejar, adaptado a pending)
export function createPendingResolver({ listPendingTasksFn, ttlMs, now = Date.now }) {
  // last-known-good: guarda la lista Y el timestamp del último éxito
  let cache = null; // { tasks, fetched_at } | null (null = nunca hubo éxito)

  async function resolve() {
    // (a) cache hit dentro de TTL → servir como fresco
    if (cache && now() - new Date(cache.fetched_at).getTime() < ttlMs) {
      return { tasks: cache.tasks, fetched_at: cache.fetched_at, stale: false };
    }
    // (b) fetch fresco
    try {
      const tasks = await fetchFreshPending(listPendingTasksFn);
      const fetched_at = new Date(now()).toISOString();
      cache = { tasks, fetched_at };
      return { tasks, fetched_at, stale: false };
    } catch {
      // (c) ORCH-06: fallo → last-known-good ETIQUETADO, jamás como fresco
      if (cache) return { tasks: cache.tasks, fetched_at: cache.fetched_at, stale: true };
      // (d) cold-start caído: nunca hubo éxito
      return { tasks: [], fetched_at: null, stale: true };
    }
  }
  return { resolve };
}
```

### Pattern 2: Fetch único consumido en dos modos (convergencia ORCH-05)

**What:** La lógica de fetch vive en `fetchFreshPending`. `check.js` la consume cruda (deja propagar el throw → su catch imprime la línea roja, D-07). `server.js` la consume vía el resolver (nunca throw → resultado discriminado, D-04). Un solo sitio con la lógica; dos políticas de frescura.
**When to use:** Resuelve la tensión D-07 (check quiere throw+línea roja con `err.message`) vs D-04 (server quiere resultado discriminado sin throw). Es la opción explícita de Claude's Discretion («consume una función `fetchFresh` exportada por el mismo módulo»).
**Example:**
```javascript
// Source: diseño derivado de CONTEXT D-01/D-04/D-07 + Claude's Discretion
export async function fetchFreshPending(listPendingTasksFn) {
  return await listPendingTasksFn(); // punto de convergencia; puede throw
}
// check.js conserva su try/catch existente (check.js:34-49) → línea roja byte-idéntica
```

### Anti-Patterns to Avoid

- **Emitir `console.warn`/eventos DENTRO de `src/tasks/pending.js`:** rompe D-02 y LOG-12 — contaminaría el grafo de imports de `check.js`. El caller (server.js) emite el warn; el módulo solo devuelve `stale`.
- **Servir `pendingCache.data` en el catch sin comprobar TTL:** es exactamente el bug de `server.js:599` que ORCH-06 elimina. Todo dato de fallo va etiquetado `stale:true`.
- **Colapsar a `pending_count: null` en error:** rechazado en D-04 — rompe el shape numérico del HTML (`server.js:370`) y descarta el último conteo conocido (más valioso que nada, con su edad).
- **Compartir la caché in-memory entre server y check:** imposible (procesos separados) y no es lo que ORCH-05 pide. La convergencia es de código+semántica.
- **Duplicar el literal `30 * 1000`:** D-03 — un solo `PENDING_CACHE_TTL_MS`, pasado por parámetro (precedente «no second number», Phase 40).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Caché TTL con `now` inyectable + fail-open | Un TTL ad-hoc nuevo con `Date.now()` hardcodeado | El patrón exacto de `src/server/provider-state.js` (factory DI) | Ya resuelto, testeado, y es lo que D-01 manda replicar |
| Serializar timestamp de frescura | Formato custom | `new Date(now()).toISOString()` (ISO string, como D-05 especifica) | Contrato ya definido: `pending_fetched_at: string\|null` |
| Guard anti-inline (D-09) | Un test frágil de string-match | El import-walker de `test/check-isolation.test.js` (`walkImports`/`extractImports`) | Walker transitivo ya escrito y probado; reutilizar la misma técnica |
| Fake provider para tests | Mock nuevo desde cero | `createFakeProvider` de `test/check.test.js` + `makeProvider` de `test/server/provider-state.test.js` | Patrones de spy con call-counter ya establecidos |

**Key insight:** Todo lo que esta fase necesita (factory DI, caché TTL, `now` inyectable, fail-open, import-walker, fakes de provider) **ya existe en el repo**. El riesgo no es técnico sino de disciplina: mantener el módulo como hoja y no re-implementar inline. Los guards (D-09 + check-isolation) son la red.

## Runtime State Inventory

> No aplica en el sentido de rename/migración de datos, pero esta fase SÍ toca estado in-memory vivo. Inventario del estado runtime afectado:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Ninguno — `pending` no se persiste a disco ni a `state.json`; es un fetch efímero del provider. Verificado: `grep pendingCache` solo aparece en `src/server.js` (module-level `let`), nunca serializado. | Ninguna |
| Live service config | Ninguno | Ninguna |
| OS-registered state | Ninguno | Ninguna |
| Secrets/env vars | Ninguno nuevo. `pending` no contiene secretos; el bearer/API key nunca viaja en `/status` (invariante PERSIST-04). El refactor no toca auth. | Ninguna |
| In-memory server state | `let pendingCache = {data, ts}` (`server.js:22`) — caché module-level viva durante el lifetime del daemon. Migra al closure del resolver (instanciado en `startServer`). El daemon es PERSISTENTE (solo `kodo stop` lo tumba) → tras el deploy, el primer `/status` re-hidrata la caché desde cero (cold-start → un fetch fresco). | Mover la caché al closure; el cold-start es benigno (un fetch extra en el primer poll) |
| Build artifacts | Ninguno | Ninguna |

**Nada que migrar:** El estado es puramente in-memory y efímero. No hay records con formato viejo, ni datos en disco, ni claves que renombrar.

## Common Pitfalls

### Pitfall 1: El módulo deja de ser hoja y rompe LOG-12
**What goes wrong:** Al querer emitir un evento de fallo «porque es su fichero», se añade `import` de `logger-events.js` o `logger.js` a `src/tasks/pending.js`. `check.js` lo importa → el grafo de `check` arrastra la dependencia → `test/check-isolation.test.js` falla (o peor, no falla si es `logger-events`, que NO está en la lista de prohibidos, y la deuda entra en silencio).
**Why it happens:** `logger-events.js` importa `node:os`/`node:path` (built-ins) y NO está en la blacklist actual del guard [VERIFIED: codebase grep]. Solo `logger.js`, github providers y `polling.js` lo están. Un import de `logger-events` pasaría el guard hoy pero viola D-02.
**How to avoid:** El módulo es hoja de cero imports (como `handoff.js`). La emisión de `console.warn` (rastro de fallo del provider) la hace `server.js` inspeccionando `stale === true` del return, NO el módulo. El return discriminado ES el canal de señalización.
**Warning signs:** Cualquier `import` en `src/tasks/pending.js` distinto de `// @ts-check`. El guard D-09 debe assertear cero imports explícitamente (como el test de `handoff.js`, líneas 160-177).

### Pitfall 2: Romper el output byte-idéntico de `kodo check` (D-07)
**What goes wrong:** Al rutar `check.js` por el resolver (con su semántica de `stale`/return discriminado), la línea roja de error cambia de texto, o el camino sano añade/quita una línea, y los tests existentes de `check.test.js` (Tests 1-5, que asertean `/2 pending/`, color amarillo, etc.) rompen.
**Why it happens:** El resolver nunca throw; pero el catch actual de `check.js:45-49` imprime `Error checking tasks: ${err.message}` con la `err.message` real. Si el resolver traga el error, se pierde el mensaje.
**How to avoid:** `check.js` consume `fetchFreshPending` (que SÍ propaga el throw), NO `resolve()`. Su try/catch existente (`check.js:34-49`) queda intacto → línea roja byte-idéntica. El resolver con caché es solo para server.
**Warning signs:** `test/check.test.js` Tests 4 y 5b (error path) fallando; cambio en la aserción `assert.match(..., /Error checking tasks/)`.

### Pitfall 3: `pending_fetched_at` con timestamp del cold-start en vez del último éxito real
**What goes wrong:** En el fallo con last-known-good, se devuelve `fetched_at: new Date().toISOString()` (el momento del fallo) en vez del timestamp del último fetch exitoso — presentando dato viejo como reciente. Es la variante sutil del bug ORCH-06.
**Why it happens:** Confundir «cuándo respondí» con «cuándo se obtuvo el dato». `stale:true` sería honesto en el flag pero el `fetched_at` mentiría sobre la edad.
**How to avoid:** El `fetched_at` que se devuelve en el catch es SIEMPRE `cache.fetched_at` (el del último éxito guardado), nunca `now()`. El test D-08 «catch etiquetado stale» debe assertear que `fetched_at` coincide con el del fetch exitoso previo, no con el momento del fallo.
**Warning signs:** Un test que inyecta `now` avanzando y verifica que tras un fallo `fetched_at` NO avanzó.

### Pitfall 4: `pending_count` desincronizado de `pending` en el payload
**What goes wrong:** Tras renombrar la variable local, `pending_count` se calcula sobre una lista distinta de la que se serializa en `pending` (p.ej. `pending_count: pending.length` pero `pending: tasks.map(...)`).
**Why it happens:** El bloque actual usa `pending` como nombre; el resolver devuelve `tasks`. Mezclar ambos nombres durante el refactor.
**How to avoid:** Derivar ambos del mismo `tasks`: `pending: tasks.map(...)`, `pending_count: tasks.length`. Un solo origen.
**Warning signs:** Test de contrato que asertee `payload.pending_count === payload.pending.length` en ambas ramas (fresco y stale).

## Code Examples

### Server: reemplazo del bloque `/status` (server.js:590-601 → resolver)
```javascript
// Source: diseño derivado de CONTEXT D-04/D-05 + server.js:588-662 actual
if (req.method === 'GET' && pathname === '/status') {
  const sessions = listSessions();
  const { tasks, fetched_at, stale } = await pendingResolver.resolve();
  if (stale) console.warn('[kodo] listPendingTasks stale — serving last-known-good'); // rastro; el dato ya va etiquetado
  // ... enrich sessions (sin cambios) ...
  res.end(JSON.stringify({
    sessions: enriched,
    count: enriched.length,
    pending: tasks.map((t) => ({ ref: t.ref, title: t.title, url: t.url, state: t.state, projectName: t.projectName })),
    pending_count: tasks.length,
    pending_stale: stale,               // D-05 — siempre presente
    pending_fetched_at: fetched_at,     // D-05 — ISO string | null
    // ... history, metrics, uptime (sin cambios) ...
  }));
  return;
}
```

### Server: wiring del resolver en startServer (junto a provider-state, ~línea 509)
```javascript
// Source: espejo de server.js:504-509 (providerStateResolver)
const pendingResolver = createPendingResolver({
  listPendingTasksFn: () => provider.listPendingTasks(),
  ttlMs: PENDING_CACHE_TTL_MS,   // D-03 — el único literal, sin segundo número
  now: Date.now,
});
```

### Check: consumir el fetch único conservando el catch (check.js:34-49)
```javascript
// Source: check.js actual + D-07 (byte-idéntico)
import { fetchFreshPending } from './tasks/pending.js';
// ...
try {
  const provider = getProviderFn(config.provider);
  await provider.init();
  const pending = await fetchFreshPending(() => provider.listPendingTasks()); // convergencia ORCH-05
  const available = config.claude.max_parallel - runningCount;
  if (pending.length > 0 && available > 0) {
    lines.push(`[kodo:check] ${fmt.yellow(`${pending.length} pending kodo task(s), ${available} slot(s) available`)}`);
    reasons.push(`${pending.length} tarea(s) pendientes con slots disponibles`);
  }
} catch (err) {
  lines.push(`[kodo:check] ${fmt.red(`Error checking tasks: ${err.message}`)}`); // línea roja intacta (D-07)
}
```

### HTML: marcar staleness en la stat «Candidatas» (server.js:370, D-06)
```javascript
// Source: server.js:370 + D-06 (indicador mínimo, redacción exacta = Claude's Discretion)
'<div class="stat"><div class="stat-val' + (data.pending_stale ? ' stale' : '') + '">' +
  data.pending_count + (data.pending_stale ? ' <span class="stale-tag">?</span>' : '') +
'</div><div class="stat-label">Candidatas</div></div>' +
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Lógica de caché/fetch inline en el handler `/status` | Factory con DI extraída a módulo puro testeable | Phase 40 (`provider-state.js`) estableció el patrón | Esta fase lo aplica al carril `pending` (el otro lane inline que quedaba) |
| Fallo del provider → `console.warn` + dato viejo silencioso | Resultado discriminado `{tasks, fetched_at, stale}` visible en la respuesta | Esta fase (ORCH-06) | El operador/orquestador distingue «0 real» de «no se pudo saber» |

**Deprecated/outdated:**
- `let pendingCache = {data, ts}` module-level (`server.js:22`): reemplazado por caché en el closure del resolver. La forma `{data, ts}` se sustituye por `{tasks, fetched_at}` (timestamp ISO, no epoch ms) para exponerlo directamente en el payload.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | El shape de cada tarea pending tiene `{ref, title, url, state, projectName}` (usado en el `.map` de `server.js:651`) | Code Examples | Bajo — es el shape actual verificado en `server.js:651`; el refactor lo preserva verbatim |
| A2 | `provider.listPendingTasks()` es el único método del contrato que ambos caminos usan para pending | Architecture | Bajo — verificado: `check.js:37` y `server.js:595` ambos llaman `listPendingTasks()`; es método FROZEN del TaskProvider contract |
| A3 | Ubicación recomendada `src/tasks/pending.js` (neutral) vs `src/server/pending.js` | Project Structure | Ninguno — es Claude's Discretion explícito; ambas pasan check-isolation si son hoja. `src/tasks/` evita sugerir acoplamiento al server que check.js no tiene |

**Nota:** Ninguna assumption bloquea la planificación. Todas las decisiones de fondo están LOCKED en CONTEXT.md; las assumptions son detalles de shape ya verificados en el código.

## Open Questions

1. **¿`check.js` debe exponer `stale`/`fetched_at` en su output?**
   - What we know: D-07 dice que `check` sigue siendo fresco (su cifra es la verdad del instante) y su output sano es byte-idéntico. `check` es one-shot, no cachea → nunca sirve stale.
   - What's unclear: nada realmente — `check` nunca está en estado stale porque siempre hace fetch fresco y su catch ya cubre el fallo con la línea roja.
   - Recommendation: `check` NO añade campos de staleness. El único consumidor de `stale`/`fetched_at` es `/status` (D-05). Cerrado por D-07.

2. **Indicador visual exacto de staleness en el HTML (D-06).**
   - What we know: debe ser mínimo (dim o sufijo corto); el detalle es Claude's Discretion.
   - What's unclear: estilo concreto (opacity, sufijo «(caché)», icono).
   - Recommendation: dejar al planner/ejecutor; sugerencia en Code Examples (clase `.stale` + tag `?`). No bloquea.

## Environment Availability

> Esta fase es puramente cambios de código/tests, sin dependencias externas nuevas. Auditoría mínima del tooling existente:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (`node:test`, `node:http`) | Runner de tests + server | ✓ (asumido — repo activo con suite de 2027 tests) | ≥18 | — |
| npm (para `npm test`) | Ejecutar la suite | ✓ | — | — |

**Missing dependencies with no fallback:** Ninguna.
**Missing dependencies with fallback:** Ninguna.

*(No se probó `node --version` en vivo porque el repo tiene una suite corriendo activamente [STATE.md: 2027 tests]; el runtime está garantizado.)*

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + `node:assert/strict` |
| Config file | none — `package.json` script `node --test $(find test -name '*.test.js' -type f)` |
| Quick run command | `node --test test/tasks/pending.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORCH-05 | server y check derivan `pending_count` del mismo módulo (convergencia de código) | unit + source-guard | `node --test test/check-isolation.test.js` | ❌ Wave 0 (ampliar) |
| ORCH-05 | `fetchFreshPending` cuenta `pending.length` fresco en check (byte-idéntico) | unit | `node --test test/check.test.js` | ✅ (ampliar) |
| ORCH-05 | resolver sirve caché dentro de TTL como `stale:false` | unit | `node --test test/tasks/pending.test.js` | ❌ Wave 0 |
| ORCH-06 | fetch fallido con caché → `{last-known-good, stale:true, fetched_at del último éxito}` | unit | `node --test test/tasks/pending.test.js` | ❌ Wave 0 |
| ORCH-06 | cold-start caído → `{tasks:[], fetched_at:null, stale:true}` | unit | `node --test test/tasks/pending.test.js` | ❌ Wave 0 |
| ORCH-06 | `/status` expone `pending_stale`/`pending_fetched_at` en ambas ramas | contract | `node --test test/server/status-pending.test.js` | ❌ Wave 0 |
| D-07 | `kodo check` output sano byte-idéntico + línea roja en error | unit (regresión) | `node --test test/check.test.js` | ✅ (debe seguir verde) |
| D-09 | `check.js` no arrastra deps vía `pending.js`; módulo es hoja | source-guard | `node --test test/check-isolation.test.js` | ✅ (ampliar) |

### Sampling Rate

- **Per task commit:** `node --test test/tasks/pending.test.js test/check.test.js`
- **Per wave merge:** `node --test test/tasks/pending.test.js test/check.test.js test/check-isolation.test.js test/server/status-pending.test.js`
- **Phase gate:** `npm test` verde completo antes de `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `test/tasks/pending.test.js` — unit del módulo: TTL fresco/caducado, catch etiquetado stale, cold-start caído, clock inyectado (`now`) — cubre ORCH-05/ORCH-06
- [ ] `test/server/status-pending.test.js` — contrato `/status`: `pending_stale`/`pending_fetched_at` presentes; `pending_count === pending.length` en ambas ramas — cubre ORCH-06/D-05
- [ ] Ampliar `test/check-isolation.test.js` — guard D-09: `pending.js` es hoja de cero imports; `check.js` no arrastra deps nuevas vía el módulo
- [ ] Ampliar `test/check.test.js` — `checkPendingTasks` vía `fetchFreshPending` sigue byte-idéntico (D-07)
- [ ] Framework install: N/A — `node:test` es built-in, ya en uso

## Security Domain

> `security_enforcement` ausente en config → tratado como enabled. Esta fase es un refactor de un camino de lectura interno sin nueva superficie de ataque; la evaluación es breve pero explícita.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No se toca el carril de auth; `/status` sigue tras el bearer default-deny (server.js:570) sin cambios |
| V3 Session Management | no | Sin cambios |
| V4 Access Control | no | Sin endpoints nuevos; `/status` conserva su gate bearer |
| V5 Input Validation | no | El refactor no introduce inputs nuevos — `resolve()` no recibe input del request; consume `provider.listPendingTasks()` |
| V6 Cryptography | no | Sin cripto |
| V7/V8 Data Protection & Logging | **sí** | `pending` no contiene secretos; el `console.warn` de fallo NO debe incluir datos sensibles del provider (conserva el patrón actual: solo `err.message`). PERSIST-04: bearer/API key jamás en `/status` — el refactor no lo altera |

### Known Threat Patterns for este stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Fuga de datos del provider en `console.warn` de fallo | Information Disclosure | Loguear solo `err.message`, nunca el payload del provider (patrón actual conservado) |
| Dato stale presentado como fresco (integridad del reporte al operador) | Tampering/Repudiation (semántico) | **Es el fix mismo de ORCH-06** — `stale:true` explícito elimina la ambigüedad; el operador no toma decisiones sobre datos caducados creyéndolos frescos |
| `pending_fetched_at` como canal de timing lateral | Information Disclosure | Insignificante — `/status` ya está tras bearer; el timestamp de un fetch interno no filtra nada explotable |

**Nota de seguridad:** El principal «control» que esta fase aporta es de **integridad de la información** (ORCH-06): dejar de presentar datos caducados como frescos es una mejora de la confianza del operador/orquestador en el dato, no una vulnerabilidad clásica. No hay superficie de red ni de input nueva.

## Sources

### Primary (HIGH confidence)
- `src/server/provider-state.js` (líneas 1-122) — patrón factory+DI+TTL+fail-open+dedup a espejar [VERIFIED: codebase]
- `src/server.js` (líneas 20-22, 370, 484-509, 588-664) — causa raíz y puntos de integración [VERIFIED: codebase]
- `src/check.js` (líneas 29-52) — `checkPendingTasks`, punto de inyección DI existente [VERIFIED: codebase]
- `test/check-isolation.test.js` (líneas 1-177) — guard LOG-12 + walker de imports + precedente `handoff.js` D-13 [VERIFIED: codebase]
- `test/server/provider-state.test.js` (líneas 1-80) — patrón de test con spy/mock/`now` inyectable [VERIFIED: codebase]
- `test/check.test.js` (líneas 1-35, 36-192) — `createFakeProvider`, Tests 1-5 que D-07 debe preservar [VERIFIED: codebase]
- `.planning/REQUIREMENTS.md` §ORCH-05/06, §Out of Scope, §Constraints [CITED]
- `.planning/STATE.md` Critical Invariants (cero deps npm, cero endpoints, LOG-12, withStateLock) [CITED]
- `package.json` — deps/devDeps y script de test [VERIFIED: bash]

### Secondary (MEDIUM confidence)
- Ninguna — toda la investigación es sobre el código del propio repo, verificada por lectura directa.

### Tertiary (LOW confidence)
- Ninguna.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cero deps nuevas, todo built-in ya en uso, verificado en package.json
- Architecture: HIGH — el patrón exacto existe (`provider-state.js`) y CONTEXT lo manda replicar; puntos de integración leídos línea a línea
- Pitfalls: HIGH — los 4 pitfalls derivan de constraints verificados en código (LOG-12 blacklist, byte-identidad de check.test.js, semántica del catch)

**Research date:** 2026-07-17
**Valid until:** 2026-08-16 (30 días — código interno estable; el único riesgo es que Phases 74/75 corriendo en paralelo toquen `server.js`, pero son ortogonales: hooks/planes vs. carril pending)
