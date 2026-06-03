# Architecture Research

**Domain:** Integration architecture for kodo v0.10 "Higiene y estado real de sesiones" (subsequent milestone — integrating 3 features into an existing Node CLI/bridge codebase)
**Researched:** 2026-06-03
**Confidence:** HIGH (grounded in direct reads of `src/interface.js`, `src/providers/registry.js`, `src/server.js`, `src/session/reconcile.js`, `src/hooks/stop.js`, `src/gsd/lock.js`, `src/cli/dashboard/App.js`; the `listComments`/`supported` optional-method precedent is real and shipped in v0.9)

> Esta NO es research de ecosistema. Es un mapa de integración: qué archivo toca cada feature, qué es nuevo vs modificado, cómo cambia el data flow, y un build order que respeta dependencias e invariantes. Lo que sigue está anclado a código verificado, no a la prosa de PROJECT.md.

---

## Standard Architecture

### System Overview — dónde aterriza cada feature de v0.10

```
┌──────────────────────────────────────────────────────────────────────┐
│                       CONTRATO TaskProvider                            │
│  interface.js: TASK_PROVIDER_METHODS (9, FROZEN) + métodos OPCIONALES  │
│   ┌──────────────┐  ┌──────────────┐   provider.getTaskState?  ◄── (C) │
│   │ plane/       │  │ github/      │   provider.listComments?  (v0.9)  │
│   │ provider.js  │  │ provider.js  │   ── opcionales, NO en el array   │
│   └──────────────┘  └──────────────┘                                   │
├──────────────────────────────────────────────────────────────────────┤
│                       SANEO (módulo puro nuevo) ◄── (A)                │
│   src/gsd/doctor.js (PURO, never-throws, DI): scan + plan + execute    │
│    ├─ worktrees huérfanos   ├─ sesiones zombie (alive===false)         │
│    ├─ locks colgados (PID/TTL) └─ logs NDJSON viejos                    │
│   reusa: lock.js (isPidAlive/readLock), state.js (computeWorktreePath)  │
├───────────────────────────┬──────────────────────────────────────────┤
│   CLI consumer             │   SERVER consumer                         │
│   bin/kodo gsd doctor      │   src/server.js                           │
│   (dry-run + --fix)        │    ├─ GET /status: enrich provider_state  │
│        ▲ (A)               │    │   fail-open + cache (provStateCache)  │
│        │                   │    └─ DELETE /sessions/{id}: + saneo ◄─(B) │
└────────┼───────────────────┴──────────────┬───────────────────────────┘
         │                                   │ pass-through (alive, elapsed_min,
         │                                   │  provider_state)
┌────────┴───────────────────────────────────┴──────────────────────────┐
│                  DASHBOARD ink (read → read-write) ◄── (B)(C)           │
│   App.js useInput: tecla `d` (guard inverso alive===false) → DELETE     │
│   select.js/format.js: render provider_state + filtro (ps: / s:)       │
│   client.js: dismissSession() never-throws (espeja runFocus)           │
└────────────────────────────────────────────────────────────────────────┘
```

Las tres features tocan capas distintas pero comparten dos puntos de fricción: el **contrato del provider** (getTaskState) y el **módulo de saneo** (doctor, reusado por dismiss). Todo lo demás es aditivo.

### Component Responsibilities

| Component | Responsibility en v0.10 | Nuevo / Modificado |
|-----------|--------------------------|--------------------|
| `src/gsd/doctor.js` | Lógica pura de saneo: detectar + planear + ejecutar limpieza de worktrees huérfanos, zombies, locks colgados, logs viejos. PURO + DI + never-throws (espeja `reconcile.js`). | **NUEVO** |
| `bin/kodo` + CLI handler `gsd doctor` | Wire del módulo puro al CLI: dry-run por defecto, `--fix`, `--json`, exit codes deterministas. | **NUEVO** (handler), MODIFICADO (`src/cli.js` registro) |
| `src/interface.js` | `getTaskState` como typedef OPCIONAL en el `TaskProvider`; `TASK_PROVIDER_METHODS` queda en 9 (FROZEN). | MODIFICADO (solo JSDoc + comentario; el array NO cambia) |
| `src/providers/plane/provider.js` | Implementa `getTaskState(task)` → `{ state, supported:true }`. | MODIFICADO |
| `src/providers/github/provider.js` | Implementa `getTaskState(task)` (mapeo labels o PR-state — decisión abierta). | MODIFICADO |
| `src/server.js` `GET /status` | Enrichment fail-open por fila con `provider_state` + cache TTL dedicado (`provStateCache`, espeja `pendingCache`). | MODIFICADO |
| `src/server.js` `DELETE /sessions/{id}` | Hoy solo `removeSession`. Pasa a invocar `doctor`'s saneo para esa fila (worktree + lock + state). | MODIFICADO |
| `src/cli/dashboard/App.js` | Tecla `d` en `mode:'list'` con guard inverso (`alive===false`) → `onDismiss` never-throws → footer. | MODIFICADO |
| `src/cli/dashboard/client.js` | `dismissSession(baseUrl, taskId, fetchFn?)` never-throws (espeja `fetchStatus`). | MODIFICADO |
| `src/cli/dashboard/select.js` + `format.js` | Mapeo de columna/badge + semántica de filtro para `provider_state`. | MODIFICADO |
| `src/providers/registry.js` | **Sin cambios** — el loop de validación itera el array de 9; getTaskState opcional NO se valida ahí. | **NO TOCAR** |
| `src/hooks/stop.js` | **Sin cambios** — sigue siendo el dueño del cleanup del happy-path. Doctor limpia lo que stop nunca alcanzó. | **NO TOCAR** (ver "ownership" abajo) |

---

## Recommended Project Structure

```
src/
├── interface.js              # MOD: typedef getTaskState? opcional. TASK_PROVIDER_METHODS sigue 9.
├── gsd/
│   ├── doctor.js             # NEW: scanSaneo() + planSaneo() + executeSaneo() puros + DI
│   ├── lock.js               # reusado por doctor (isPidAlive, readLock, releaseGsdLock)
│   └── ...
├── session/
│   ├── state.js              # reusado por doctor (computeWorktreePath, listSessions, removeSession)
│   └── reconcile.js          # PATRÓN a espejar para doctor (puro + DI + never-throws + clock inyectable)
├── providers/
│   ├── registry.js           # NO TOCAR (validación de 9 métodos intacta)
│   ├── plane/provider.js     # MOD: + getTaskState(task)
│   └── github/provider.js    # MOD: + getTaskState(task)
├── server.js                 # MOD: /status enrichment provider_state + cache; DELETE /sessions reusa doctor
├── cli.js                    # MOD: registro de `gsd doctor`
└── cli/
    ├── gsd-doctor.js         # NEW: CLI handler (dry-run/--fix/--json/exit codes), wire de doctor.js
    └── dashboard/
        ├── App.js            # MOD: tecla `d` + onDismiss
        ├── client.js         # MOD: dismissSession() never-throws
        ├── select.js         # MOD: filtro provider_state (ps:/s:)
        └── format.js         # MOD: render provider_state (columna|badge)

bin/kodo                      # MOD: subcomando gsd doctor (vía cli.js)
test/
├── providers/contract.test.js  # MOD: assert OPCIONAL de getTaskState (capability-gated, ver abajo)
├── gsd/doctor.test.js          # NEW
└── cli/dashboard/...           # MOD: tecla d, render/filtro provider_state
```

### Structure Rationale

- **`src/gsd/doctor.js` separado del CLI handler:** el módulo es PURO (igual que `reconcile.js`: scan → plan → execute, clock/fs/host inyectables, never-throws). El CLI handler (`src/cli/gsd-doctor.js`) y el server (`DELETE /sessions`) son DOS consumidores del mismo módulo. Esto satisface el requirement "una sola fuente de saneo" sin que el dashboard tenga que reimplementar nada — el dashboard llama a `DELETE /sessions/{id}` (endpoint que ya existe) y el server delega en `doctor`.
- **`getTaskState` NO entra en `TASK_PROVIDER_METHODS`:** ver Pattern 1 — añadirlo al array frozen haría que `getProvider()` lance para cualquier provider que no lo implemente (Plane/GitHub inicialmente, y futuros ClickUp/local). El precedente `listComments` (v0.9) ya estableció el patrón de método opcional + flag `supported`.

---

## Architectural Patterns

### Pattern 1: Método opcional del provider con capability flag `supported` (NO ampliar el array frozen)

**What:** `getTaskState` se añade como método OPCIONAL del contrato `TaskProvider`, exactamente como `listComments` se añadió en v0.9. NO se añade a `TASK_PROVIDER_METHODS` (que permanece en 9, FROZEN). El server detecta soporte con `typeof provider.getTaskState === 'function'` y emite un campo aditivo `supported`.

**When to use:** Cuando un método nuevo del contrato no puede ser obligatorio para TODOS los adapters (Plane y GitHub lo soportan; ClickUp/local futuros podrían no tener un concepto de "state" mapeable). Ampliar el array frozen romperia la simetría cross-provider: el loop de `registry.js:102-104` lanza `Provider "X" missing method` para cualquier adapter incompleto.

**Trade-offs:**
- (+) Cero ruptura del contrato canónico; el array sigue siendo 9; el invariante "9-method contract" del STATE.md sobrevive literalmente.
- (+) Reusa el precedente `supported` ya entendido y testeado en v0.9 (overlay de comentarios).
- (−) El "10º método" es un método de segunda clase (opcional). Si en el futuro se considera core, se promueve al array — pero eso es una decisión separada.

**Verificado en código:**
```js
// src/providers/registry.js:101-106 — el loop SOLO valida los 9 del array frozen.
for (const method of TASK_PROVIDER_METHODS) {           // 9 elementos
  if (typeof provider[method] !== 'function') {
    throw new Error(`Provider "${name}" missing method: ${method}`);  // ← lanzaría para getTaskState
  }
}

// src/server.js:438-443 — patrón `supported` ya shipped para listComments (el modelo a copiar):
const supported = typeof provider.listComments === 'function';
const comments = supported ? await provider.listComments(...) : [];
res.end(JSON.stringify({ comments, supported }));
```

**Decisión recomendada:** OPCIONAL + `supported`. El contract matrix (`test/providers/contract.test.js`) debe asertar getTaskState de forma **capability-gated**: si el provider lo implementa, valida la shape del retorno `{ state, supported }`; si no, salta con un assert que documenta la ausencia. NO añadir un `it()` que falle por ausencia (rompería el invariante estructural Pitfall #3 del propio test: PROVIDERS × N_asserts determinista).

---

### Pattern 2: Enrichment fail-open por fila con cache dedicado en `GET /status`

**What:** Tras el pass-through de `alive` (autoritativo de `reconcileTick`) y el cómputo de `elapsed_min`, el `/status` handler enriquece cada sesión con `provider_state` consultando `provider.getTaskState`. El fail es POR FILA: si la llamada falla o el provider no soporta, esa fila omite `provider_state` (o lo deja `null`) y el endpoint responde 200 igual. Un cache dedicado (`provStateCache`, mismo shape que `pendingCache`) evita N llamadas al provider por poll.

**When to use:** Siempre que se enriquezca el `/status` con datos externos al state.json. El invariante "TUI nunca crashea" y el pass-through de `alive` no deben acoplarse al estado del provider.

**Trade-offs:**
- (+) El lifecycle de kodo (alive/elapsed_min de state.json) NUNCA depende de que el provider responda. Si Plane está caído, las sesiones se siguen mostrando con su estado real local; solo falta el badge `provider_state`.
- (+) Cache amortigua el coste N×getTaskState: con poll cada 2.5s del dashboard y N sesiones activas, sin cache serían N llamadas/2.5s al provider (rate-limit GitHub: `X-RateLimit-Remaining < 100` ya warnea).
- (−) `provider_state` puede ser stale hasta el TTL del cache. Aceptable: es informativo (driver ROMAN-150), no load-bearing para ninguna decisión de lifecycle.

**Dónde vive el cache — recomendación:** NO reusar `pendingCache` (su shape es `{data:[], ts}` para la lista de pending tasks; mezclar semánticas confunde). Crear `provStateCache` paralelo, keyed por `task_id` con `ts` por entrada, TTL ~10s (4× el poll del dashboard — suficiente para no martillear el provider, fresco para reflejar un cambio en ≤10s). Patrón verificado:
```js
// src/server.js:19 + 367-376 — pendingCache es el precedente de cache TTL en /status:
let pendingCache = { data: [], ts: 0 };
// ...
if (Date.now() - pendingCache.ts < PENDING_CACHE_TTL_MS) { pending = pendingCache.data; }
else { try { pending = await provider.listPendingTasks(); pendingCache = {...}; } catch { pending = pendingCache.data; } }
```

**Forma del enrichment (espeja el comentario `alive` existente en server.js:379-385):**
```js
// alive y elapsed_min NO cambian; provider_state se AÑADE fail-open + cache:
const enriched = await Promise.all(sessions.map(async (s) => {
  const base = { ...s, elapsed_min: Math.floor((Date.now() - new Date(s.started_at).getTime()) / 60000) };
  if (typeof provider.getTaskState !== 'function') return base;          // capability gate
  const cached = provStateCache.get(s.task_id);
  if (cached && Date.now() - cached.ts < PROV_STATE_TTL_MS) return { ...base, provider_state: cached.state };
  try {
    const r = await provider.getTaskState({ id: s.task_id, projectId: s.project_id });
    provStateCache.set(s.task_id, { state: r.state, ts: Date.now() });
    return { ...base, provider_state: r.state };
  } catch { return cached ? { ...base, provider_state: cached.state } : base; }  // fail-open por fila
}));
```
> Nota de orden: el enrichment es ahora `async` por fila (`Promise.all`). Esto NO toca el pass-through de `alive` ni viola el invariante "reconcileTick único escritor" — getTaskState es READ-ONLY contra el provider, jamás escribe state.json.

---

### Pattern 3: Saneo como módulo puro reusado por CLI y server (una sola fuente)

**What:** `doctor.js` expone funciones puras `scan(deps)` → lista de hallazgos, y `execute(findings, deps)` → resultados, con TODA la I/O inyectada (fs, lock readers, host, clock). El CLI (`gsd doctor`) las llama con dry-run (scan sin execute) o `--fix` (scan + execute). El server (`DELETE /sessions/{id}`) las llama para la fila concreta del dismiss. Mismo módulo, dos consumidores — espeja exactamente la separación `reconcile.js` (puro) ↔ `runReconcileTick` (I/O wrapper) ↔ `startReconcileLoop`.

**When to use:** Es el requerimiento explícito del milestone ("dismiss REUSA la lógica de doctor"). El patrón evita la trampa de duplicar saneo en el handler del teclado del dashboard.

**Trade-offs:**
- (+) Una sola implementación testeable sin tocar el filesystem real (DI), sin mocking de módulos (Node test runner no tiene `mock.module` — Key Decision histórica del proyecto).
- (+) El dashboard NO reimplementa saneo: hace `DELETE /sessions/{id}` (endpoint existente) y el server delega en doctor. El dashboard sigue sin escribir state.json directamente.
- (−) Hay que definir el alcance del dismiss vs el sweep completo: dismiss sanea UNA fila; `gsd doctor` barre TODO el repo/historial. El módulo debe soportar ambos (scan parametrizable por `taskId` opcional).

**Ownership del saneo de worktrees/locks (resuelve la pregunta C explícitamente):**

| Caso | Dueño | Por qué |
|------|-------|---------|
| Sesión termina normal (Stop hook dispara) | **`stop.js`** (sin cambios) | Ya hace `git worktree remove --force` + `releaseGsdLock` + `removeSession` fail-open (verificado en stop.js:237-303). Es el happy-path. |
| Worktree huérfano (sesión murió sin Stop hook, crash, `/exit` sin cleanup) | **`doctor.js`** | stop.js nunca corrió. doctor escanea `.bg-shell/<sessionId>` contra `listSessions()` y barre los que no tienen sesión viva. |
| Lock colgado (PID muerto / TTL excedido) | **`doctor.js`** (lee), **`lock.js`** (mecánica) | doctor usa `isPidAlive`/`readLock` de lock.js (ya públicos, verificado lock.js:67-94) para detectar; el robo/borrado lo hace `releaseGsdLock` o un unlink directo del lock stale. |
| Sesión zombie (`alive===false` persistente) | **`doctor.js`** + **dismiss** | doctor la lista; dismiss (tecla `d`) la elimina vía `DELETE /sessions` → doctor saneo de esa fila. |
| Logs NDJSON viejos | **`doctor.js`** | Nadie más los toca (retención de 7 días del daemon es solo para `polling-*.log`). |

> **Regla de no-solapamiento:** doctor NUNCA debe sanear un worktree/lock de una sesión VIVA (`alive===true` o PID vivo). El guard es el mismo `isPidAlive` + el `alive` autoritativo del state.json. stop.js sigue siendo el dueño del cleanup mientras la sesión está en su ciclo normal; doctor recoge solo lo que quedó huérfano.

---

## Data Flow

### Flujo (B) — Dismiss desde el dashboard (TUI read-write)

```
[operador pulsa `d` sobre fila alive===false]
    ↓ App.js useInput (mode:'list')
[guard inverso: alive===false requerido]  ── alive===true → setDismissError, no-op
    ↓
[onDismiss(taskId) — never-throws, espeja runFocus]
    ↓ client.js dismissSession()
[DELETE /sessions/{taskId}]  ── HTTP
    ↓ server.js
[doctor.execute({taskId}, deps)]  ── worktree huérfano + lock + removeSession
    ↓
[200 {ok:true}]  → próximo poll refleja la fila desaparecida (selección por identidad la suelta)
```
> El guard es el **inverso** del de Enter: Enter exige `alive===true` (focus a sesión viva), `d` exige `alive===false` (dismiss de sesión muerta). Mismo patrón de error-al-footer sin desmontar el panel (verificado App.js:412-433).

### Flujo (C) — provider_state end-to-end

```
[provider.getTaskState(task)]  (Plane: REST workitem.state | GitHub: labels|PR-state)
    ↓ (cache provStateCache TTL ~10s, fail-open por fila)
[server GET /status: enriched[].provider_state]  (capability-gated por typeof)
    ↓ pass-through JSON aditivo
[client.js fetchStatus → never-throws]
    ↓
[select.js: filtro ps:/s:  ·  format.js: columna|badge color semántico de <Text>]
    ↓
[SessionTable render]
```

### State Management — invariantes que NO cambian

```
reconcileTick  ──(ÚNICO escritor de alive)──>  state.json  ──(pass-through ...s)──>  GET /status
     ▲                                                                                    │
     │ (doctor y dismiss NUNCA escriben alive; solo removeSession/worktree/lock)          │
     └──────────────────────────────────────────────────────────────────────────────────┘
provider_state es un carril SEPARADO read-only — jamás toca state.json ni alive.
```

---

## Scaling Considerations

| Escala | Ajustes |
|--------|---------|
| N sesiones activas pequeño (uso personal, <10) | Enrichment `Promise.all` + cache 10s es más que suficiente; sin cache también funcionaría pero martillearía el provider. |
| Provider lento / rate-limited (GitHub) | El cache TTL es el regulador. Si `X-RateLimit-Remaining` baja, subir TTL. fail-open ya cubre el 429/timeout. |
| Muchos worktrees huérfanos acumulados | `gsd doctor` es batch on-demand, no en hot-path. Scan O(worktrees) sobre `.bg-shell/` — trivial al volumen personal. |

### Scaling Priorities

1. **Primer cuello:** N×getTaskState por poll si NO se cachea → resuelto por `provStateCache` (Pattern 2).
2. **Segundo cuello:** dismiss síncrono bloqueando el response del server si el worktree remove es lento → mitigar con el mismo fail-open de stop.js (timeout en gitFn, fail-open silencioso).

---

## Anti-Patterns

### Anti-Pattern 1: Añadir `getTaskState` a `TASK_PROVIDER_METHODS`

**What people do:** "Es el 10º método del contrato, lo añado al array frozen para que la validación lo exija."
**Why it's wrong:** `getProvider()` (registry.js:102-104) lanzaría `Provider "X" missing method: getTaskState` para CUALQUIER provider que no lo implemente — rompiendo el arranque del server y el contract matrix. Viola el invariante "9-method contract" del STATE.md.
**Do this instead:** Método opcional + `typeof === 'function'` + campo `supported` (Pattern 1, precedente `listComments`).

### Anti-Pattern 2: Reimplementar saneo en el handler de la tecla `d`

**What people do:** El handler de `d` en App.js hace `git worktree remove` / unlink del lock directamente.
**Why it's wrong:** Dos fuentes de saneo (CLI doctor + dashboard) divergen; el dashboard escribiría disco/locks rompiendo la separación cliente/server (el dashboard NO es escritor de state.json).
**Do this instead:** `d` → `DELETE /sessions/{id}` → el server delega en `doctor.execute` (Pattern 3). Una sola fuente.

### Anti-Pattern 3: Acoplar `alive` / lifecycle al `provider_state`

**What people do:** Recomputar `alive` o un estado de display a partir del `provider_state` ("si Plane dice In Review, márcala review").
**Why it's wrong:** `reconcileTick` es el ÚNICO escritor de `alive`. provider_state es de un sistema externo asíncrono; mezclarlo crearía un segundo escritor de estado y resucitaría el bug D-09 (web UI legacy recomputa idle con heurística propia).
**Do this instead:** provider_state es un carril paralelo READ-ONLY, render como columna/badge independiente. El estado de sesión (running/idle/dead) y provider_state se muestran juntos pero NO se derivan uno del otro.

### Anti-Pattern 4: Doctor saneando worktrees/locks de sesiones vivas

**What people do:** doctor barre todo `.bg-shell/` sin chequear liveness.
**Why it's wrong:** Borraría el worktree de una sesión Claude en curso.
**Do this instead:** doctor cruza contra `listSessions()` + `isPidAlive` + `alive` autoritativo; solo toca huérfanos. stop.js sigue siendo dueño del happy-path.

---

## Integration Points

### Internal Boundaries

| Boundary | Comunicación | Notas |
|----------|--------------|-------|
| `gsd doctor` CLI ↔ `doctor.js` | Import directo + DI (fs, clock, lock readers) | Dry-run = scan; `--fix` = scan+execute. Exit codes deterministas (espeja `gsd inspect` 0/1/2). |
| dashboard `d` ↔ server | HTTP `DELETE /sessions/{id}` (existente) | El dashboard NO escribe disco. client.js never-throws. |
| server `DELETE /sessions` ↔ `doctor.js` | Import directo, scan+execute para `{taskId}` | Hoy solo `removeSession(taskId)` (server.js:451-456) — se AMPLÍA para reusar doctor. |
| server `GET /status` ↔ `provider.getTaskState` | Llamada async capability-gated + cache | fail-open por fila; jamás bloquea el endpoint. |
| `doctor.js` ↔ `lock.js` | `isPidAlive`, `readLock`, `releaseGsdLock` (públicos) | Verificado lock.js:67, 86, 154 — ya exportados. |
| `doctor.js` ↔ `session/state.js` | `listSessions`, `removeSession`, `computeWorktreePath` | computeWorktreePath deriva `.bg-shell/<sessionId>` (invariante WT). |
| contract matrix ↔ getTaskState | Assert capability-gated | NO romper PROVIDERS × N_asserts determinista (Pitfall #3 del test). |

### Lo que NO se toca (verificado)

- `src/providers/registry.js` — validación de 9 métodos intacta.
- `src/session/reconcile.js` — único escritor de `alive`; sirve solo de PATRÓN para doctor.
- `src/hooks/stop.js` — dueño del cleanup happy-path; doctor recoge huérfanos.
- Color isolation — doctor CLI usa `createFormatter`; dashboard usa `<Text color>`. Cero picocolors nuevos.

---

## Suggested Build Order (responde la pregunta D)

Las dependencias son estrictas y forman dos cadenas que convergen en el dashboard:

```
Fase 1: DOCTOR (módulo puro + CLI)
   doctor.js (scan/execute puro + DI) → gsd-doctor.js CLI → tests
   · Sin deps de las otras dos. Entrega valor solo (saneo manual).
   · Establece el módulo que dismiss reusará.
        │
        ▼
Fase 2: DISMISS (server + dashboard read-write)
   DELETE /sessions reusa doctor.execute → client.js dismissSession → App.js tecla `d`
   · DEPENDE de Fase 1 (necesita doctor.js para no duplicar saneo).
   · Convierte la TUI en read-write (ruptura consciente del invariante v0.9).

──────────── cadena independiente, puede ir en paralelo a 1-2 ────────────

Fase 3a: getTaskState (contrato + providers)
   interface.js typedef opcional → plane.getTaskState → github.getTaskState → contract matrix
        │
        ▼
Fase 3b: enrichment /status (server + cache)
   provStateCache + Promise.all fail-open en GET /status
   · DEPENDE de 3a (necesita el método para llamarlo).
        │
        ▼
Fase 3c: render/filtro (dashboard)
   format.js columna|badge → select.js filtro ps:/s:
   · DEPENDE de 3b (necesita provider_state en el JSON de /status).
```

**Orden recomendado y rationale:**

1. **DOCTOR primero** (módulo + CLI). Es la dependencia de dismiss, entrega valor de forma aislada (saneo invocable a mano), y no rompe ningún invariante (read-only sobre state, escribe solo huérfanos confirmados).
2. **getTaskState → enrichment → render** (la cadena provider_state) puede ir **en paralelo** a 1, porque no comparte archivos críticos con doctor/dismiss. Internamente es estrictamente secuencial: contrato antes que enrichment antes que render (no se puede renderizar lo que el JSON no trae, ni enriquecer con un método que no existe).
3. **DISMISS al final** (o tras doctor). Es la única ruptura de invariante (TUI read-write) y depende de doctor. Ponerla última concentra el riesgo de la mutación cuando el saneo ya está probado y la TUI ya sabe renderizar el nuevo estado.

> Si se quiere un único orden lineal sin paralelismo: **DOCTOR → getTaskState → enrichment → render → DISMISS**. Respeta todas las deps y deja la ruptura de invariante (read-write) para el final, sobre fundaciones verificadas.

---

## Sources

- `/Users/alex/dev/klab/kodo/src/interface.js` (TASK_PROVIDER_METHODS frozen, 9 métodos) — HIGH
- `/Users/alex/dev/klab/kodo/src/providers/registry.js:91-110` (loop de validación que lanza por método ausente) — HIGH
- `/Users/alex/dev/klab/kodo/src/server.js:19,364-457` (pendingCache, /status enrichment + pass-through alive, DELETE /sessions, supported precedent) — HIGH
- `/Users/alex/dev/klab/kodo/src/session/reconcile.js` (patrón puro+DI+never-throws+clock inyectable a espejar para doctor; reconcileTick único escritor de alive) — HIGH
- `/Users/alex/dev/klab/kodo/src/gsd/lock.js:67-171` (isPidAlive, readLock, releaseGsdLock públicos para doctor) — HIGH
- `/Users/alex/dev/klab/kodo/src/hooks/stop.js:237-303` (worktree cleanup happy-path fail-open — dueño actual) — HIGH
- `/Users/alex/dev/klab/kodo/src/cli/dashboard/App.js:402-438` (Enter handler con guard alive===true + error-al-footer — patrón inverso para `d`) — HIGH
- `.planning/PROJECT.md`, `.planning/STATE.md` (invariantes cross-milestone) — HIGH

---
*Architecture research for: kodo v0.10 integration (doctor + dismiss + provider_state)*
*Researched: 2026-06-03*
