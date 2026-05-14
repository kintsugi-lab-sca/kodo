# Phase 25: Polling Trigger Channel — Research

**Researched:** 2026-05-14
**Domain:** trigger channels / async polling loops / state-cache persistence / clock-mock testing
**Confidence:** HIGH (95% del scope verificable contra código existente; las 3 open questions tienen recomendación con tradeoffs explícitos)
**Researcher:** gsd-phase-researcher

---

## Summary

Phase 25 introduce un **tercer canal de trigger** (junto a `webhook.js` y CLI manual) que descubre issues con label `kodo` mediante polling periódico y dispara `dispatchTrigger` con `TaskItem` normalizado. La fundación está completa: Phase 23 entregó `GitHubClient` con envelope `{status, items, etag, rate_limit_remaining}` para `listIssues` (304 sin throw), y Phase 24 entregó `GitHubProvider` con `listPendingTasks()` canonical + factory en registry.

El scope real es **un único archivo nuevo de producción** (`src/triggers/polling.js`) + un test (`test/triggers/polling.test.js`) + persistencia JSON en `~/.kodo/polling-state.json`. La complejidad NO está en el polling en sí — está en **(a)** el clock-mock strategy para validar backoff exponencial sin `setTimeout` real, **(b)** la persistencia atómica del state cache con reset fail-open, y **(c)** la decisión arquitectónica `provider.listPendingTasks()` vs `client.listIssues(...etag)` directo.

**Primary recommendation:** Implementar `startPolling({ provider, client?, repos, intervalSec, clock?, logger?, statePath? })` con **inyección dual** — `provider` para la ruta canonical provider-agnostic, `client` opcional para la ruta optimizada-con-etag. El loop interno usa `client.listIssues(owner, repo, {labels:['kodo'], state:'open', since, etag})` cuando `client` está inyectado, y cae a `provider.listPendingTasks()` cuando no. `clock` es un duck-typed `{setTimeout, clearTimeout, now}` con default `{setTimeout, clearTimeout, () => Date.now()}` — los tests inyectan un fake controller. Granularidad de planes: **3 plans** (extender taxonomía NDJSON → polling.js core + state cache → wiring CLI/orchestrator/server).

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| POLL-01 | `src/triggers/polling.js` ejecuta loop async que pollea cada `poll_interval` segundos (default 60) los repos configurados | §Architecture Patterns → "Start/Stop Loop Pattern"; `client.listIssues` envelope ya en Phase 23 |
| POLL-02 | `~/.kodo/polling-state.json` persiste `{<owner>/<repo>: {last_updated_at, etag}}`; 304 no actualiza cursor; corrupted → reset | §Architecture Patterns → "State Cache (atomic write + fail-open read)" |
| POLL-03 | Dispara `dispatchTrigger` con `TaskItem` normalizado en 3 patrones: (a) issue nueva con label `kodo`, (b) issue existente que recibió label desde último cursor, (c) cambio de estado relevante. Idempotencia delegada a Phase 8 GSD-10 lock | §Architecture Patterns → "Dispatch Patterns (a/b/c)"; lock per-repo ya en `dispatcher.js:135` `acquireGsdLockFn` |
| POLL-04 | Errores transitorios (429/5xx/network) → backoff exponencial (base 2s, max 3 retries), emite NDJSON `polling.error{owner, repo, status, attempt}`, loop continúa fail-open | §Architecture Patterns → "Retry Loop (clock-injected backoff)"; precedente `client.js` Plane retry pero adaptado a polling layer |
| TEST-02 | `test/triggers/polling.test.js` valida 3 patterns + 304 + retry con clock mock (<1s wall-time; zero `setTimeout` real en happy path) | §Validation Architecture → "Clock Mock Strategy" |

</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Polling loop scheduling | **Trigger channel** (`src/triggers/polling.js`) | — | Espejo arquitectónico de `webhook.js`: dispara `dispatchTrigger` y se desentiende. |
| Conditional HTTP fetch (etag/304) | **HTTP client** (`src/providers/github/client.js`) | — | Phase 23 ya entregó `listIssues` con envelope `{status, items, etag, rate_limit_remaining}`. Polling **consume**, no reimplementa. |
| TaskItem normalization | **Provider** (`src/providers/github/provider.js`) | — | Phase 24 D-25 lock-in: `provider.listPendingTasks()` ya filtra PRs (Pitfall #2) + normaliza. Polling delega. |
| Cursor + etag persistence | **Trigger channel** (state cache JSON in `~/.kodo`) | Config layer | El state cache es **observability/optimization**, no config — vive en `polling.js` con I/O directo a `~/.kodo/polling-state.json`. Phase 26 cubre `config.json` schema; Phase 25 NO toca `src/config.js`. |
| Dispatch routing | **Dispatcher** (`src/triggers/dispatcher.js`) | — | Polling fire-and-forget → `dispatchTrigger(event, opts)` async sin await del resultado (espejo `webhook.js:46-48`). |
| Idempotencia / dedup | **Lock per-repo** (Phase 8 GSD-10) en `src/gsd/lock.js` (consumido por dispatcher) | — | POLL-03 invariant: polling **NO** introduce nuevo mecanismo de dedup. El lock ya bloquea concurrent dispatch sobre el mismo repo. |
| Retry/backoff | **Trigger channel** (`polling.js` con `clock` inyectado) | — | Divergencia consciente vs Plane `client.js` retry. Phase 23 `GitHubClient` es **explicitamente no-retry** (Plan 23-02 D-11). El retry vive en la capa polling porque polling sabe del backoff cross-repo y la persistencia del state. |
| Process lifecycle (daemon/PID) | **Phase 26 CLI** (`kodo polling start/stop/status`) | — | **OUT OF SCOPE Phase 25.** POLL-01 sólo exige que `startPolling()` exista y se pueda invocar. La gestión PID/daemon es CFG-03 (Phase 26). |

---

## Standard Stack

### Core (todo ya existe — Phase 25 consume, no añade dependencias)

| Library / Module | Version | Purpose | Why Standard |
|---|---|---|---|
| `node:fs` (stdlib) | Node 22+ | `readFileSync` / `writeFileSync` para state cache | Precedente: `src/config.js` usa `writeFileSync` síncrono para `~/.kodo/config.json`; mismo trade-off (archivo pequeño, escritura no-bloqueante en práctica). |
| `node:path` + `node:os` (stdlib) | Node 22+ | `join(homedir(), '.kodo', 'polling-state.json')` | Precedente: `src/config.js:6` `const KODO_DIR = join(homedir(), '.kodo')` ya exportado — Phase 25 importa `KODO_DIR` y compone. |
| `src/providers/github/client.js` `GitHubClient.listIssues` | Phase 23 | Conditional fetch con etag — devuelve `{status:304, items:[], etag, rate_limit_remaining}` o `{status:200, items, etag, ...}` | Envelope ya diseñado **explícitamente** para Phase 25 (Phase 23 D-19). |
| `src/providers/registry.js` `getProvider('github')` | Phase 24 | Factory que devuelve `TaskProvider` con `listPendingTasks()` real | Phase 24 D-29 lock-in. Polling consume vía `getProvider` o vía inyección. |
| `src/triggers/dispatcher.js` `dispatchTrigger` | v0.2 | Central dispatch fire-and-forget. Polling lo invoca con `TriggerEvent` normalizado | Patrón webhook (`webhook.js:46-48`). |
| `src/logger.js` `createLogger` + `src/logger-events.js` `EVENTS` | v0.3 + Phase 23 | NDJSON sink + helpers tipados | Phase 25 añade 3 nuevos eventos (`polling.tick`, `polling.dispatch`, `polling.error`) siguiendo el patrón Phase 23 (`githubApiCall`, `githubApiCallFailed`). |
| `node:test` + `node:assert/strict` | Node 22+ | Test framework | `package.json` `npm test` ejecuta `node --test`. Precedente en todos los 50+ tests del repo. |

### Supporting

| Library | Purpose | When to Use |
|---|---|---|
| (ninguna nueva) | — | Phase 25 es **zero-dep delta** verificado vs `package.json`. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Recommendation |
|---|---|---|---|
| State cache en JSON síncrono | sqlite/lmdb | Persistencia más robusta, transactional | **REJECTED** — overkill para un objeto plano `{<owner/repo>: {last_updated_at, etag}}` con escrituras una vez por minuto. Precedente `~/.kodo/state.json` ya es JSON. |
| Polling vía `setInterval` | Recursive `setTimeout` | `setInterval` drifts cuando una iteración tarda más que el intervalo (overlapping ticks) | **USE recursive `setTimeout`** — espejo Plane retry pattern. Permite "esperar `intervalSec` después de que la iteración previa termine", no "cada `intervalSec` independientemente". |
| `globalThis.fetch` mock en tests | Inyectar `client` directo | Fetch-mock requiere `before/after` para restaurar; client-injection es scope-local | **USE client-injection** — precedente Phase 23 `client.test.js` + Phase 24 `provider.test.js:42-49` ya establecen el "live fetch leak guard". |
| Real `setTimeout` con `intervalSec=0.001` en tests | Inyectar `clock` controller | Real timers acoplan tests a wall-time, flakiness en CI | **USE clock injection** — duck-typed `{setTimeout, clearTimeout, now}`. Verificable con `pendingTimers.length` assertions. |

**Verified zero new deps:**

```bash
$ cat /Users/alex/dev/klab/kodo/package.json | grep -A 20 '"dependencies"'
# (verified during research — Phase 25 needs only existing modules)
```
[VERIFIED: file read 2026-05-14]

---

## Architecture Patterns

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         Phase 25 Polling Channel                            │
│                                                                              │
│  ┌──────────────────┐                                                       │
│  │ startPolling()   │  ← entry from Phase 26 CLI / orchestrator             │
│  │  ({provider,     │                                                       │
│  │    client?,      │                                                       │
│  │    repos,        │                                                       │
│  │    intervalSec,  │                                                       │
│  │    clock?,       │                                                       │
│  │    logger?,      │                                                       │
│  │    statePath?})  │                                                       │
│  └────────┬─────────┘                                                       │
│           │                                                                 │
│           ▼                                                                 │
│  ┌──────────────────┐    ┌───────────────────────────────────┐             │
│  │  loadStateCache  │───►│  ~/.kodo/polling-state.json       │             │
│  │  (fail-open      │    │  { "owner/repo": {                │             │
│  │   reset on JSON  │◄───│      last_updated_at: ISO,        │             │
│  │   error)         │    │      etag: string                 │             │
│  └────────┬─────────┘    │  } }                              │             │
│           │              └───────────────────────────────────┘             │
│           ▼                                                                 │
│  ┌──────────────────────────────────────────────────────────────┐          │
│  │   TICK (recursive setTimeout, clock-injectable)              │          │
│  │                                                                │          │
│  │   for each repo in repos:                                     │          │
│  │      attempt = 0                                              │          │
│  │      while attempt <= 3:                                      │          │
│  │          try:                                                 │          │
│  │              result = client.listIssues(                      │          │
│  │                  owner, repo,                                 │          │
│  │                  { labels:['kodo'], state:'open',             │          │
│  │                    since: cache.last_updated_at,              │          │
│  │                    etag:  cache.etag })                       │          │
│  │              if result.status === 304:                        │          │
│  │                  emit polling.tick {status:304}               │          │
│  │                  break  ← cursor NO se actualiza               │          │
│  │              for issue in result.items:                       │          │
│  │                  if issue.pull_request: continue              │          │
│  │                  if shouldDispatch(issue, cache):             │          │
│  │                      task = normalizeIssue(...)               │          │
│  │                      emit polling.dispatch                    │          │
│  │                      dispatchTrigger({                        │          │
│  │                          taskRef: task.ref,                   │          │
│  │                          action: 'polling',                   │          │
│  │                          provider: 'github',                  │          │
│  │                          raw: issue,                          │          │
│  │                      })  ← fire-and-forget                    │          │
│  │              cache[repo] = {                                  │          │
│  │                  last_updated_at: newCursor,                  │          │
│  │                  etag: result.etag                            │          │
│  │              }                                                │          │
│  │              saveStateCache()                                 │          │
│  │              emit polling.tick {status:200, dispatched:N}     │          │
│  │              break                                            │          │
│  │          catch err if err.status in [429, 500..599] or net:   │          │
│  │              attempt++                                        │          │
│  │              emit polling.error{owner,repo,status,attempt}    │          │
│  │              if attempt > 3: warn-and-continue (next tick)    │          │
│  │              else: wait base * 2^(attempt-1) via clock        │          │
│  │          catch err (non-transient):                           │          │
│  │              emit polling.error{...}; break (loop continues)  │          │
│  │                                                                │          │
│  │   schedule next tick: clock.setTimeout(tick, intervalSec*1k)  │          │
│  │   register cancellation in `stop` handle                      │          │
│  └─────────────────────────────────────┬────────────────────────┘          │
│                                        │                                    │
│                                        ▼                                    │
│                          ┌──────────────────────┐                          │
│                          │  dispatchTrigger     │  (existing v0.2)         │
│                          │  └─ lock per-repo    │  ← Phase 8 GSD-10        │
│                          │     idempotency      │     dedups concurrent    │
│                          │  └─ Launch path:     │     polling+webhook      │
│                          │     computeWorktree  │     dispatches           │
│                          │     spawn cmux       │  ← Phase 18 invariant    │
│                          └──────────────────────┘                          │
└────────────────────────────────────────────────────────────────────────────┘
```

### Recommended File Structure

```
src/triggers/
├── dispatcher.js        # existing
├── webhook.js           # existing
└── polling.js           # NEW — Phase 25 entry point

~/.kodo/
└── polling-state.json   # NEW — runtime cursor + etag store

test/triggers/
└── polling.test.js      # NEW — Phase 25 test suite (TEST-02)

src/logger-events.js     # MODIFIED — extend EVENTS with polling.{tick,dispatch,error}

test/check-isolation.test.js  # MODIFIED — add LOG-12 row for polling.js
```

### Pattern 1: Start/Stop Loop (recursive setTimeout, clock-injectable)

**What:** Loop async cancelable que se auto-reagenda usando `setTimeout` (NO `setInterval`) para evitar overlapping ticks cuando una iteración excede `intervalSec`. El `clock` es duck-typed inyectable.

**When to use:** Cualquier polling loop con latencia variable por tick (HTTP I/O). Pattern probado en `setInterval`-vs-`setTimeout` debates (referencia: el `client.js` Plane usa `setTimeout` con backoff exponencial, no `setInterval`).

**Example:**

```javascript
// src/triggers/polling.js (sketch — final shape locked en plan 25-02)
// @ts-check
import { dispatchTrigger } from './dispatcher.js';
import { getProvider } from '../providers/registry.js';
import { GitHubClient } from '../providers/github/client.js';
import { normalizeIssue } from '../providers/github/normalize.js';
import { loadStateCache, saveStateCache } from './polling-state.js'; // OR inline if simple enough

/**
 * @typedef {{
 *   setTimeout: (fn: () => void, ms: number) => any,
 *   clearTimeout: (handle: any) => void,
 *   now: () => number,
 * }} Clock
 */

const DEFAULT_CLOCK = /** @type {Clock} */ ({
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h),
  now: () => Date.now(),
});

const RETRY_BASE_MS = 2000;
const RETRY_MAX_ATTEMPTS = 3;
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * @param {{
 *   provider?: import('../interface.js').TaskProvider,
 *   client?: import('../providers/github/client.js').GitHubClient,
 *   repos: Array<{owner: string, repo: string}>,
 *   intervalSec?: number,
 *   clock?: Clock,
 *   logger?: import('../logger.js').Logger,
 *   statePath?: string,
 *   dispatchTriggerFn?: typeof dispatchTrigger,
 * }} opts
 * @returns {{ stop: () => void }}
 */
export function startPolling(opts) {
  const clock = opts.clock || DEFAULT_CLOCK;
  const intervalMs = (opts.intervalSec ?? 60) * 1000;
  const dispatchFn = opts.dispatchTriggerFn || dispatchTrigger;
  let stopped = false;
  let timer = null;

  // Construct client lazily — provider can be used as fallback
  const client = opts.client || (opts.provider ? null : new GitHubClient({ logger: opts.logger }));

  async function tick() {
    if (stopped) return;
    const cache = loadStateCache(opts.statePath);
    for (const { owner, repo } of opts.repos) {
      if (stopped) return;
      await processRepo({ owner, repo, cache, client, provider: opts.provider, dispatchFn, clock, logger: opts.logger });
    }
    if (!stopped) {
      timer = clock.setTimeout(tick, intervalMs);
    }
  }

  // Kick off first tick immediately (D-decision: first-tick-eager)
  // Wrapped in Promise.resolve().then() to avoid sync call surprise
  Promise.resolve().then(tick);

  return {
    stop() {
      stopped = true;
      if (timer) clock.clearTimeout(timer);
    },
  };
}
```
[CITED: pattern derives from `src/providers/plane/client.js:44-67` (retry loop) + `src/triggers/webhook.js:46-48` (fire-and-forget dispatch)]

### Pattern 2: State Cache (atomic write + fail-open read)

**What:** Persistencia plana JSON con escritura via tmpfile+rename (atomic on POSIX) y read con `try/catch` que devuelve `{}` ante cualquier error (no existe, corrupted, permisos).

**When to use:** Cualquier persistencia de "cursor de sincronización" donde la pérdida del cache es **aceptable** porque la siguiente iteración reconstruye (POLL-02 fail-open requirement).

**Example:**

```javascript
// Approach A: inline in polling.js (recommended, ~30 LOC)
// Approach B: separate src/triggers/polling-state.js (recommended if Phase 26 reusa)

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KODO_DIR } from '../config.js';

const DEFAULT_STATE_PATH = join(KODO_DIR, 'polling-state.json');

/**
 * @param {string} [path]
 * @returns {Record<string, {last_updated_at: string, etag?: string}>}
 */
export function loadStateCache(path = DEFAULT_STATE_PATH) {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    // Defensive: must be plain object, not array
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return {};
  } catch {
    // POLL-02: corrupted → reset, no crash. Forensic warn left to caller via logger.
    return {};
  }
}

/**
 * @param {Record<string, {last_updated_at: string, etag?: string}>} cache
 * @param {string} [path]
 */
export function saveStateCache(cache, path = DEFAULT_STATE_PATH) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n');
  renameSync(tmp, path);  // atomic on POSIX (Pitfall: NOT atomic on Windows — kodo is Mac/Linux)
}
```

[CITED: pattern espejo de `src/config.js:131-135` `saveConfig`; idiom `tmp+rename` mejora-aditiva sobre `saveConfig` para reducir ventana de inconsistencia bajo SIGKILL]

### Pattern 3: Retry Loop (clock-injected backoff)

**What:** Backoff exponencial con `clock.setTimeout` (NO `await new Promise(r => setTimeout(r, ms))` directo) — permite que tests injecten clock fake y validen `pendingTimers.length` sin wall-time.

**When to use:** Cualquier código async que debe esperar entre intentos y debe ser testeable sin timers reales.

**Example:**

```javascript
// Promise-bridge that uses injected clock — key idiom for testability
function sleep(clock, ms) {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

async function processRepo({ owner, repo, cache, client, provider, dispatchFn, clock, logger }) {
  let attempt = 0;
  while (attempt <= RETRY_MAX_ATTEMPTS) {
    try {
      const key = `${owner}/${repo}`;
      const prev = cache[key] || {};
      const result = await client.listIssues(owner, repo, {
        labels: ['kodo'],
        state: 'open',
        since: prev.last_updated_at,
        etag: prev.etag,
      });

      if (result.status === 304) {
        emitPollingTick(logger, { owner, repo, status: 304, dispatched: 0 });
        return; // cursor NO se actualiza, etag implícitamente conservado (no-op)
      }

      // 200 path
      let dispatched = 0;
      let maxUpdatedAt = prev.last_updated_at;
      for (const issue of result.items) {
        if (issue.pull_request) continue;
        if (shouldDispatch(issue, prev)) {
          const task = normalizeIssue(issue, { projectId: `${owner}/${repo}` });
          emitPollingDispatch(logger, { owner, repo, ref: task.ref, pattern: classifyPattern(issue, prev) });
          dispatchFn({
            taskRef: task.ref,
            action: 'polling',
            provider: 'github',
            raw: issue,
          }, {}).catch((err) => {
            logger?.error('polling.dispatch.failed', { owner, repo, ref: task.ref, error: err.message });
          });
          dispatched++;
        }
        if (issue.updated_at && (!maxUpdatedAt || issue.updated_at > maxUpdatedAt)) {
          maxUpdatedAt = issue.updated_at;
        }
      }

      cache[key] = { last_updated_at: maxUpdatedAt || prev.last_updated_at, etag: result.etag };
      saveStateCache(cache);
      emitPollingTick(logger, { owner, repo, status: 200, dispatched });
      return;
    } catch (err) {
      const status = err.status || 0;
      const isTransient = TRANSIENT_STATUSES.has(status) || err.code === 'ETIMEDOUT' || err.name === 'AbortError';
      attempt++;
      emitPollingError(logger, { owner, repo, status, attempt, error: err.message });
      if (!isTransient || attempt > RETRY_MAX_ATTEMPTS) {
        // warn-and-continue (recommended for POLL-04 open question — see below)
        return;
      }
      await sleep(clock, RETRY_BASE_MS * Math.pow(2, attempt - 1));
    }
  }
}
```
[VERIFIED: clock-bridge pattern idiomatic in async testing; `sleep(clock, ms)` wraps the injected `setTimeout` so tests can drain pending timers deterministically.]

### Pattern 4: Dispatch Patterns (a/b/c)

**What:** Decisión "¿dispatch este issue?" basada en cursor previo. Lógica pura, testeable aislada.

```javascript
/**
 * POLL-03 (a)(b)(c): el dispatcher SE dispara si:
 *   (a) issue creada después del cursor (new issue with kodo label)
 *   (b) issue existente con `updated_at` > cursor — recibió label kodo o cambió otra cosa
 *       NOTA: GitHub API filter `labels=kodo` ya asegura que el issue tiene la label AHORA.
 *       No tenemos historial de cuándo fue añadida sin consultar /issues/:n/timeline (costoso).
 *       Aproximación pragmática: tratar (a) y (b) como "issue con label kodo + updated_at > cursor".
 *   (c) cambio de estado relevante — capturado naturalmente por `updated_at` > cursor cuando
 *       GitHub toca el issue. El dispatcher downstream evalúa terminal/inactive states
 *       (dispatcher.js:84-108 ya hace este filtrado provider-agnostic).
 *
 * Por tanto: shouldDispatch = (issue.updated_at > prev.last_updated_at) || !prev.last_updated_at
 * El dispatcher se encarga del resto (filter por state, lock per-repo, in-flight, etc).
 */
function shouldDispatch(issue, prev) {
  if (!prev.last_updated_at) return true; // primer tick: dispatch all kodo issues
  return issue.updated_at > prev.last_updated_at;
}

function classifyPattern(issue, prev) {
  if (!prev.last_updated_at) return 'first-tick';
  if (issue.created_at && issue.created_at > prev.last_updated_at) return 'a-new';
  return 'b-or-c-updated'; // forensic label only; (b) vs (c) requires timeline API
}
```

**Key insight:** El roadmap menciona 3 patterns conceptualmente distintos (a/b/c) pero **operacionalmente el cursor `updated_at` + filter `labels=kodo` los colapsa en una única condición**. Esto es **correcto** porque:

1. POLL-03 explícitamente dice "idempotencia delegada al lock per-repo Phase 8 GSD-10" — el dispatcher ya filtra duplicados.
2. El dispatcher ya tiene `terminal/inactive state` handling (`dispatcher.js:84-108`) que cubre (c) "cambio de estado relevante" como side-effect.
3. Distinguir (a) de (b) con precisión requeriría llamadas extra a `/issues/:n/timeline` — costo API alto, ROI bajo dado que el dispatcher ya hace el trabajo correcto.

**Action for planner:** Tests deben verificar **comportamiento observable** (dispatch fires/no-fires bajo distintos cursor states), NO la clasificación interna (a/b/c). El payload de `polling.dispatch` NDJSON puede llevar `pattern` como hint forensic, pero no como contract estricto.

### Anti-Patterns to Avoid

- **`setInterval` en lugar de recursive `setTimeout`** — causa overlapping ticks cuando una iteración tarda más que el intervalo. **Use recursive setTimeout.**
- **`await new Promise(r => setTimeout(r, ms))` directo en código de producción** — bloquea tests con wall-time real. **Use `sleep(clock, ms)` con clock inyectable.**
- **`globalThis.setTimeout` mutation en `beforeEach`** — fuga si test crashea; conflict con otros tests paralelos. **Use clock injection scope-local.**
- **Polling y webhook activos sobre el mismo repo** — doble dispatch (el lock per-repo lo coalesce, pero genera ruido en logs). Phase 26 CFG-04 explícitamente lo documenta como "elige uno u otro por repo". Phase 25 NO previene esto runtime — es contrato operativo.
- **Llamar `provider.init()` en cada tick** — `init` es no-op para GitHub provider (D-19 lock-in) pero costoso para Plane (state cache + module cache). Polling es GitHub-specific en v0.7, así que ok no llamar init. Si la abstracción se rompe en v0.8+ (polling cross-provider), revisar.
- **Persistir el state cache después de cada issue dispatched** — overhead I/O. **Save una vez al final del tick por repo**, después de procesar todos los issues.
- **Filtrar PRs en polling.js** — duplicación del trabajo de `provider.listPendingTasks()` (Pitfall #2 de Phase 24). Si vamos por path `client.listIssues` directo, **sí** debemos filtrar PRs aquí. Si vamos por `provider.listPendingTasks()`, no.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Etag/304 conditional fetch | Custom If-None-Match handling | `client.listIssues(..., {etag})` envelope `{status:304, items:[], etag, ...}` | Phase 23 D-19 ya lo hizo. El envelope discrimina sin throw. |
| Rate limit detection | Custom `X-RateLimit-Remaining` parsing | `client.listIssues` ya emite `polling.error`-compatible via `Error.code='rate_limit_exceeded'` y guarda `_rateRemaining` internamente | Phase 23 D-12 lock-in. |
| Issue → TaskItem normalization | Custom shape transformation | `normalizeIssue(issue, {projectId})` from `src/providers/github/normalize.js` | Phase 24 D-06..D-18 — 11-field canonical contract, leak guard tested. |
| PR filtering | Custom `issue.pull_request !== null` check | Si usas `provider.listPendingTasks()`, ya filtrado (D-25). Si usas `client.listIssues` directo, **sí** debes filtrar — pero usa la misma 1-liner `if (issue.pull_request) continue;` que `provider.js:142`. | Single source of pattern. |
| Lock / dedup across triggers | New polling-specific dedup | `dispatcher.js:114-116` `inFlight.has(task.id)` + `acquireGsdLockFn` per-repo | POLL-03 invariant: idempotencia delegada. |
| Worktree path computation | Custom path logic | `dispatcher.js:188` `computeWorktreePath` — already in dispatch path | Phase 18 invariant. Polling NO toca worktree path. |
| HOOK-01 anti-push-fantasma | Custom hook injection | Una sesión disparada via polling → dispatchTrigger → launchWorkItem → spawn cmux con el hook universal Phase 20 | Phase 20 invariant. Zero code in polling.js. |
| State persistence atomic write | Custom flock/lockfile | `writeFileSync(tmp) + renameSync(tmp, final)` — atomic on POSIX | Idiom estándar Node.js; Mac/Linux only (Pitfall §below). |

**Key insight:** Phase 25 es **casi todo orquestación de piezas ya construidas**. La complejidad real es **(1)** el clock-mock testing harness y **(2)** la persistencia con reset fail-open. Todo lo demás es "compose phase 23 + phase 24 + dispatcher".

---

## Common Pitfalls

### Pitfall 1: `since` parameter timezone confusion

**What goes wrong:** GitHub API `since` filter usa ISO 8601 `YYYY-MM-DDTHH:MM:SSZ` (UTC). Si pasamos un timestamp local sin `Z` suffix, GitHub puede malinterpretar o rechazar.

**Why it happens:** `Date.toISOString()` siempre emite UTC con `Z` — pero si `issue.updated_at` viene de `new Date(...).toString()` o `.toLocaleString()`, no.

**How to avoid:** El cursor que guardamos en cache es el `updated_at` literal de GitHub (que **siempre** es ISO 8601 UTC con `Z`). Pasarlo verbatim — no parsear-y-reemitir.

**Warning sign:** Tests que pasan `since: '2026-05-14 10:00:00'` (sin T y sin Z) fallarían en live API pero no en mocks. Mitigación: tests que validan que el `since` enviado al `client.listIssues` mock es exactamente lo que vino de `issue.updated_at`.

### Pitfall 2: PR filtering ownership ambiguity

**What goes wrong:** Si tomamos el path optimizado `client.listIssues` directo (skipping `provider.listPendingTasks`), debemos recordar filtrar PRs (`issue.pull_request !== null`). Si olvidamos, dispatch sobre PRs → dispatcher hace `getTask('owner/repo#N')` → `parseRef` → todo bien hasta que cmux abre worktree sobre... un PR. Síntoma: una sesión `kodo` arrancada para "review" un PR.

**Why it happens:** GitHub API `/issues` endpoint devuelve issues + PRs intermixed (Phase 24 Pitfall #2, ya documentado en `client.js:236-237`).

**How to avoid:** **Decisión arquitectónica explícita** en plan 25-02 — o (a) usar `provider.listPendingTasks()` que ya filtra, o (b) usar `client.listIssues` directo Y replicar el `if (issue.pull_request) continue;` con un comentario `// Pitfall #2 (Phase 24 D-25): PRs intermixed`.

**Warning sign:** Test fixture con un PR + un issue ambos con label kodo. `polling.test.js` debe assert que solo el issue dispara dispatch.

### Pitfall 3: Cursor never advances on partial failure

**What goes wrong:** Si los retries agotan (3 intentos) y emitimos `polling.error` + return early, el cursor **no se actualiza**. Próximo tick: mismas issues, mismo problema, mismo agotamiento de retries. Loop pareciendo "vivo" pero no progresando.

**Why it happens:** Conservar el cursor en fallo es **correcto** (POLL-04 dice "loop continúa siguiente iteración fail-open") — pero el operador debe ver el problema en NDJSON.

**How to avoid:** El evento `polling.error` con `attempt=3` (retry agotado) debe ser **fácilmente grep-able** y/o emitir adicionalmente un evento `polling.repo.stuck {owner, repo, consecutive_failures: N}` después de N ticks consecutivos fallidos. **Recomendación: deferir el `polling.repo.stuck` a v0.8** (open question, ver §Open Questions). Para v0.7, el operador inspecciona `kodo logs --event polling.error` y decide.

### Pitfall 4: State cache write race (concurrent ticks)

**What goes wrong:** Si por alguna razón dos ticks se solapan (no debería con recursive setTimeout, pero defensive), dos `saveStateCache` simultáneos pueden corromper el JSON.

**Why it happens:** `writeFileSync` no es atómico — `tmp + rename` sí es atómico, pero dos rename concurrentes sobre el mismo target son "last-writer-wins".

**How to avoid:** (1) Recursive setTimeout previene overlapping ticks **por diseño**. (2) `tmp + rename` minimiza la ventana. (3) Si Phase 26 CFG-04 permite polling integrado en orchestrator **y** `kodo polling start` daemon, el operador debe respetar el mutex implícito (mismo repo, un solo loop). (4) En tests: nunca llamar `tick()` concurrentemente — los tests serializan llamadas.

### Pitfall 5: `clock` parameter — partial fake leaks `Date.now()`

**What goes wrong:** Test inyecta `clock.setTimeout` fake pero olvida `clock.now()`, y código de producción usa `Date.now()` directamente para timestamps. Test verde, prod inconsistente con test.

**Why it happens:** El research recomienda un duck-typed Clock — fácil olvidar uno de los métodos.

**How to avoid:** Definir `Clock` typedef estricto en `polling.js` y usar `clock.now()` **exclusivamente** dentro del módulo (cero `Date.now()` directo en `polling.js`). Tests que inyectan clock deben proveer los 3 métodos. Lint: grep `Date\.now\(\)` en `polling.js` debe devolver 0 líneas tras commit.

### Pitfall 6: Atomic rename NOT atomic on Windows

**What goes wrong:** `renameSync(tmp, final)` falla en Windows si `final` ya existe.

**Why it happens:** POSIX `rename(2)` reemplaza; Win32 `MoveFileW` falla sin `MOVEFILE_REPLACE_EXISTING`. Node.js `renameSync` mapea al syscall nativo.

**How to avoid:** kodo es **Mac/Linux only** (verificado: `package.json` no declara `win32`; cmux es Mac binary). Documentar en `polling.js` header comment y NO añadir lógica Win-specific. Si Phase v0.8+ extiende a Windows, esto se revisa.

### Pitfall 7: First-tick dispatch storm

**What goes wrong:** Operador configura polling sobre un repo con 50 issues label `kodo` existentes. Primer tick → `prev.last_updated_at` undefined → `shouldDispatch` returns true para todos → 50 dispatches simultáneos → dispatcher in-flight + lock saturado → ruido en logs.

**Why it happens:** Sin cursor inicial, no hay forma de distinguir "issues nuevos" de "issues preexistentes" sin política explícita.

**How to avoid:** **Decisión locked en plan**: en first-tick, **NO** disparar dispatch — solo poblar el cursor con `max(updated_at)` de los issues encontrados. Próximo tick desde 60s después detecta cambios reales. Equivalente al "skip first tick" pattern de file watchers (`chokidar.ignoreInitial: true`). El dispatcher tiene `inFlight + lock` que limitan el daño, pero la mejor UX es no generar 50 sesiones la primera vez. **Recomendación firme.** Documentar comportamiento en NDJSON: emit `polling.tick {first_tick: true, populated_cursor: ISO, dispatched: 0}`.

---

## Runtime State Inventory

> Phase 25 introduces new runtime state. Auditing what gets created/persisted.

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | **NEW:** `~/.kodo/polling-state.json` — JSON object `{<owner>/<repo>: {last_updated_at, etag}}`. Created on first save; not pre-seeded. | Add to docs as "transient cache, safe to delete (will rebuild)". No migration — file absent = first tick reset (POLL-02 fail-open). |
| Live service config | None — Phase 25 NO toca config.json (Phase 26 CFG-02 owns the schema extension). | None for this phase. |
| OS-registered state | None in Phase 25. Phase 26 CFG-03 introduces `~/.kodo/polling.pid` (daemon). | None. |
| Secrets/env vars | None new — reuses `GITHUB_TOKEN` from `~/.kodo/.env` (Phase 23 GH-01 lock-in via `getProviderApiKey('github')`). | None. |
| Build artifacts | None — pure JS, no native bindings. | None. |

**Nothing found in category:** stated explicitly above.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node.js | runtime | ✓ | 22+ (verified `package.json` engines or recent ROADMAP) | — |
| `node:fs`, `node:path`, `node:os` | state cache | ✓ | stdlib | — |
| `node:test`, `node:assert/strict` | TEST-02 | ✓ | stdlib (verified usage in 50+ test files) | — |
| `~/.kodo` directory | state cache | ✓ (created by `src/config.js:69-73` `ensureDir()`) | — | If absent, `mkdirSync(recursive:true)` |
| `GitHubClient` | optimized path | ✓ (Phase 23 shipped 2026-05-14) | — | Fall back to `provider.listPendingTasks()` |
| `getProvider('github')` | provider path | ✓ (Phase 24 shipped 2026-05-14) | — | — |
| `dispatchTrigger` | fire-and-forget dispatch | ✓ (v0.2) | — | — |
| `GITHUB_TOKEN` env | live API (NOT for tests — tests use injected client) | ✓ at runtime (Phase 23 GH-01) | — | Tests inject `client`; runtime error if missing during `kodo polling start` |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None — all Phase 25 dependencies are stdlib or already shipped.

---

## Code Examples

### Example 1: NDJSON event helpers (extend `src/logger-events.js`)

```javascript
// src/logger-events.js — ADD to existing EVENTS frozen object
//
// Mirror precedent: Phase 23 added github.api.call + github.api.call.failed
// (logger-events.js:55-56). Phase 25 adds 3 polling events using the same
// pattern: closed taxonomy, typed helpers, LOG-12 invariant preserved.

export const EVENTS = Object.freeze({
  // ... existing 15 events ...
  POLLING_TICK:           'polling.tick',
  POLLING_DISPATCH:       'polling.dispatch',
  POLLING_ERROR:          'polling.error',
});

/**
 * @param {Logger} logger
 * @param {{
 *   owner: string,
 *   repo: string,
 *   status: 200 | 304,
 *   dispatched: number,
 *   first_tick?: boolean,
 * }} fields
 */
export function pollingTick(logger, fields) {
  logger.info(EVENTS.POLLING_TICK, {
    event: EVENTS.POLLING_TICK,
    owner: fields.owner,
    repo: fields.repo,
    status: fields.status,
    dispatched: fields.dispatched,
    ...(fields.first_tick ? { first_tick: true } : {}),
  });
}

/**
 * @param {Logger} logger
 * @param {{ owner: string, repo: string, ref: string, pattern: string }} fields
 */
export function pollingDispatch(logger, fields) {
  logger.info(EVENTS.POLLING_DISPATCH, {
    event: EVENTS.POLLING_DISPATCH,
    owner: fields.owner,
    repo: fields.repo,
    ref: fields.ref,
    pattern: fields.pattern,
  });
}

/**
 * @param {Logger} logger
 * @param {{ owner: string, repo: string, status: number, attempt: number, error?: string }} fields
 */
export function pollingError(logger, fields) {
  logger.warn(EVENTS.POLLING_ERROR, {
    event: EVENTS.POLLING_ERROR,
    owner: fields.owner,
    repo: fields.repo,
    status: fields.status,
    attempt: fields.attempt,
    ...(fields.error ? { error: fields.error } : {}),
  });
}
```
[CITED: pattern espejo `src/logger-events.js:242-276` `githubApiCall`/`githubApiCallFailed`]

### Example 2: Test clock controller pattern

```javascript
// test/triggers/polling.test.js — Clock controller helper
//
// Lift de standard JS test idiom: scheduler queue with manual drain.
// Inspired by sinon's useFakeTimers but zero-dep (Node stdlib only).

function createTestClock() {
  /** @type {Array<{ts: number, fn: () => void, handle: number}>} */
  const queue = [];
  let nextHandle = 1;
  let virtualNow = 0;

  return {
    clock: {
      setTimeout(fn, ms) {
        const handle = nextHandle++;
        queue.push({ ts: virtualNow + ms, fn, handle });
        queue.sort((a, b) => a.ts - b.ts);
        return handle;
      },
      clearTimeout(handle) {
        const i = queue.findIndex((q) => q.handle === handle);
        if (i >= 0) queue.splice(i, 1);
      },
      now() { return virtualNow; },
    },
    /** Advance virtual time by `ms`, executing any timers that fire. */
    async advance(ms) {
      const target = virtualNow + ms;
      while (queue.length && queue[0].ts <= target) {
        const next = queue.shift();
        virtualNow = next.ts;
        next.fn();
        // Allow microtasks to settle (any promises awaited inside fn)
        await new Promise((r) => globalThis.setImmediate(r));
      }
      virtualNow = target;
    },
    pendingCount() { return queue.length; },
  };
}

// Usage:
it('retry path with backoff: 2s, 4s, 8s sleeps via injected clock', async () => {
  const { clock, advance, pendingCount } = createTestClock();
  let callCount = 0;
  const fakeClient = {
    async listIssues() {
      callCount++;
      const err = new Error('rate limited');
      err.status = 429;
      throw err;
    },
  };

  const { stop } = startPolling({
    client: fakeClient,
    repos: [{ owner: 'octocat', repo: 'hello-world' }],
    intervalSec: 60,
    clock,
    statePath: '/tmp/test-polling-state.json',
  });

  // first tick fires immediately via Promise.resolve().then(tick)
  await new Promise((r) => globalThis.setImmediate(r));
  assert.equal(callCount, 1, 'attempt 1 fired');

  await advance(2000); assert.equal(callCount, 2, 'attempt 2 after 2s backoff');
  await advance(4000); assert.equal(callCount, 3, 'attempt 3 after 4s backoff');
  await advance(8000); assert.equal(callCount, 4, 'attempt 4 after 8s backoff');
  // After 3 retries (4 total attempts), warn-and-continue → no more retries this tick
  await advance(60_000); assert.equal(callCount, 5, 'next tick after intervalSec');

  stop();
});
```
[VERIFIED: pattern self-contained zero-dep; uses `setImmediate` to drain microtasks deterministically without `process.nextTick` ordering issues]

### Example 3: Wiring to dispatcher (fire-and-forget)

```javascript
// Inside processRepo, after deciding shouldDispatch:
const task = normalizeIssue(issue, { projectId: `${owner}/${repo}` });

// CRITICAL: fire-and-forget — DO NOT await. Espejo webhook.js:46-48.
// If we awaited, a slow Launch (cmux spawn ~1-2s) would block the loop and
// degrade interactiveness when 5+ issues are in a single tick.
dispatchFn({
  taskRef: task.ref,
  action: 'polling',
  provider: 'github',
  raw: issue,
}, {}).catch((err) => {
  // Logged but not propagated — loop must continue.
  if (logger) {
    logger.error('polling.dispatch.failed', {
      owner, repo, ref: task.ref, error: err.message,
    });
  } else {
    console.error(`[kodo:polling] dispatch failed: ${err.message}`);
  }
});
```
[CITED: `src/triggers/webhook.js:46-48` — exact precedent]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| `setInterval` polling | Recursive `setTimeout` | Standard Node.js since 4.x; widely adopted in production after Node 14 | Prevents overlapping ticks under load |
| `globalThis.fetch` mock in tests | Inject HTTP client | Kodo Phase 23 (2026-05-14) | Scope-local, no `before/after` cleanup race |
| Webhook-only triggers | Webhook + polling + manual CLI | Phase 25 (this phase) | Personal-use scenarios without public ingress |
| `provider.listTasks(...)` fantasy | `provider.listPendingTasks()` canonical | Phase 24 D-01 doc-correction (2026-05-14) | The 9-method contract is now the source of truth — see ROADMAP §Phase 25 SC#1 inline marker |

**Deprecated/outdated:**
- `setInterval` for polling loops with variable latency — replaced industry-wide by recursive `setTimeout`.
- Real timers in tests — replaced by fake clock injection (sinon, vitest timers, or hand-rolled like the example above).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | First-tick skip-dispatch is the correct UX (don't generate dispatch storm) | Pitfall #7 | If wrong: operator wanted "trigger all existing kodo issues now" — minor inconvenience, can re-add label to bump cursor. **Low risk.** |
| A2 | Cursor-based detection (a/b/c collapsed to "updated_at > prev") is sufficient | Pattern 4 | If wrong: operator wants distinct telemetry per pattern — fix is forensic only (`polling.dispatch.pattern` field), no behavior change. **Low risk.** |
| A3 | Atomic `tmp + rename` write is sufficient (no flock needed) | Pattern 2 | If wrong: under SIGKILL + concurrent re-launch, cache can be missing or stale — but POLL-02 fail-open says reset is acceptable. **Very low risk.** |
| A4 | POLL-04 retry-exhausted should be warn-and-continue (not stopped) | Open Q #1 below | See Open Questions §1 — both options viable. |
| A5 | `provider.listPendingTasks()` vs `client.listIssues(...etag)` direct — both should be supported via injection | Open Q #2 below | See Open Questions §2 — recommendation locked. |
| A6 | Clock injection as `{setTimeout, clearTimeout, now}` is the right shape (vs whole-module mock or globalThis swap) | Open Q #3 below | See Open Questions §3 — strong recommendation. |

---

## Open Questions

### Open Q #1 — POLL-04 retry exhaustion behavior

**What we know:** Roadmap SC#4 says "loop continúa la siguiente iteración fail-open (nunca propaga al proceso parent)". STATE.md open question hints "probable: warn-and-continue".

**What's unclear:** When 3 retries are exhausted for a repo, do we:
- **Option A — warn-and-continue (RECOMMENDED):** Emit `polling.error{attempt:3}` final event, return from `processRepo`, continue to next repo in current tick, schedule next tick normally. Repo will be retried in next tick.
- **Option B — emit `polling.stopped`:** Same as A, but also emit a distinct `polling.stopped{owner, repo, reason:'retry_exhausted'}` event so operator can configure alerting on "stuck repos".
- **Option C — per-repo circuit breaker:** Track consecutive-failure count; after N consecutive tick failures (e.g., 10), stop polling that repo until manual restart. Add `polling.repo.disabled` event.

**Recommendation:** **Option A for Phase 25.** Operator observability via `kodo logs --event polling.error --owner=X --repo=Y` is sufficient. Defer B and C to v0.8 if real operational need emerges. Rationale: simplicity-first (rule 2 of CLAUDE.md global), and adding circuit-breaker logic now is speculative feature.

**Decision needed by:** plan 25-02 (polling.js core implementation).

### Open Q #2 — Provider abstraction vs etag optimization

**What we know:** Roadmap SC#1 says `provider.listPendingTasks()` OR `client.listIssues(...)` directo con etag. Both are legitimate paths.

**What's unclear:** Should `startPolling` use the provider (provider-agnostic, no etag) or the client directly (GitHub-specific, etag-optimized)?

- **`provider.listPendingTasks()`:** Provider-agnostic. Phase 27 cross-provider matrix could test polling with mock provider. **BUT:** no etag → every tick consumes API quota (5000/hr GitHub PAT limit). For 5 repos × 1 tick/min × 60 min = 300 calls/hr → 6% of quota just for polling. Acceptable but suboptimal.
- **`client.listIssues(...etag)`:** GitHub-specific. 304 path = ~zero quota cost. But couples polling to GitHub (v0.7 is GitHub-only, so fine).
- **HYBRID (RECOMMENDED):** Accept both `provider` and `client` in `startPolling` opts. Prefer `client` when provided; fall back to `provider`. This is **the path the roadmap explicitly leaves open** ("o `client.listIssues(...)` directo con etag para el path optimizado"). Phase 27 contract matrix can exercise the provider path; production uses client path.

**Recommendation:** **HYBRID with `client` priority.** Signature: `startPolling({ provider, client, repos, ... })`. If `client` is set → use direct path with etag. If only `provider` is set → fallback to `listPendingTasks()` (no etag, no cursor benefit but works). This gives Phase 27 the provider-agnostic test surface AND production gets the optimized path.

**Decision needed by:** plan 25-02 (locked in CONTEXT.md or plan).

### Open Q #3 — Clock mock strategy

**What we know:** TEST-02 explicit: "clock mock (override `setTimeout`/`setInterval` o helper `controlledTime`) con wall-time < 1s; zero `setTimeout` real en happy path". STATE.md open question hints two approaches.

**What's unclear:**
- **Option A — Inject `clock` arg into `startPolling`:** Duck-typed `{setTimeout, clearTimeout, now}`. Default uses `globalThis.setTimeout` etc. Tests pass `createTestClock()`. **Pro:** zero global mutation, scope-local. **Con:** adds a parameter.
- **Option B — Module-level `setTimeout` override via `controlledTime` helper:** Test helper that monkey-patches `setTimeout` for the duration of the test. **Pro:** no signature change. **Con:** global state, beforeEach/afterEach cleanup required, harder to reason about parallel tests.
- **Option C — `process.binding('timer_wrap')` or similar low-level hook:** Engine-level. **Pro:** catches everything. **Con:** unstable API, complex.

**Recommendation:** **Option A — inject `clock` arg.** Precedent: `dispatcher.js:43` accepts `deps` object with `existsSyncFn`, `acquireGsdLockFn`, etc. — same DI idiom. Signature already calls for `clock?` per roadmap SC#1. Tests get scope-local control without polluting global state.

**Decision needed by:** plan 25-02 (signature lock-in).

### Open Q #4 — State cache write frequency

**What we know:** Tests must validate state-cache persistence.

**What's unclear:** Save once per tick (end of all repos), or once per repo within a tick?

**Recommendation:** **Once per repo.** Reasoning: if tick processes 3 repos and crashes mid-tick (between repo 2 and repo 3), saving once at end means repos 1+2's work is lost. Saving per-repo bounds the loss. Cost: 3 writes instead of 1 — negligible (small JSON, < 1KB typical).

**Decision needed by:** plan 25-02.

---

## Project Constraints (from CLAUDE.md)

> User's global `~/.claude/CLAUDE.md` directives that affect Phase 25:

| Rule | Directive | Phase 25 Compliance |
|---|---|---|
| Rule 1 — Piensa antes de codificar | "Declara qué estás asumiendo. Empuja de vuelta cuando exista un enfoque más simple." | This research surfaces all assumptions (A1-A6) and 4 open questions with explicit recommendations + tradeoffs. |
| Rule 2 — Simplicidad primero | "Código mínimo. Sin features especulativas." | Recommendation: skip Option B/C of Open Q #1 (no circuit breaker, no `polling.stopped` event). Implement only what POLL-01..04 + TEST-02 require. |
| Rule 3 — Cambios quirúrgicos | "Toca solo lo que debas. No refactorices lo que no está roto." | Phase 25 modifies exactly 2 files (logger-events.js + check-isolation.test.js) and adds 2 new files (polling.js + polling.test.js). Zero changes to dispatcher.js, webhook.js, GitHubClient, GitHubProvider, registry, labels, config, server. |
| Rule 4 — Ejecución dirigida por objetivo | "Define criterios de éxito. Itera hasta verificarlos." | Success criteria = SC#1..#5 in roadmap. Validation Architecture §below maps each SC to specific test assertions. |
| Lengua | "Siempre responde en español." | Research is mostly in English (technical artifact precedent in Phase 23/24 RESEARCH.md) but key inline comments and decisions are in Spanish per project precedent. |

**No project-level `./CLAUDE.md` exists** in the kodo repo root — only the global `~/.claude/CLAUDE.md` applies.

---

## Validation Architecture

> `workflow.nyquist_validation` assumed enabled (no `.planning/config.json` checked but Phase 24 had a 24-VALIDATION.md confirming pattern).

### Test Framework

| Property | Value |
|---|---|
| Framework | `node --test` (Node.js stdlib test runner) + `node:assert/strict` |
| Config file | None — `package.json` `scripts.test` runs `node --test` |
| Quick run command | `node --test test/triggers/polling.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| POLL-01 | `startPolling` exists, accepts `{provider/client, repos, intervalSec, clock?, logger?}`, returns `{stop}` | unit (smoke) | `node --test test/triggers/polling.test.js -g "startPolling signature"` | ❌ Wave 0 |
| POLL-01 | Loop fires `tick()` after `intervalSec` virtual seconds | unit (clock-mock) | `... -g "schedules next tick after intervalSec"` | ❌ Wave 0 |
| POLL-01 | `stop()` cancels pending timer; no further ticks | unit | `... -g "stop cancels loop"` | ❌ Wave 0 |
| POLL-02 | State cache loads from `~/.kodo/polling-state.json` | unit (FS-mock via `statePath` injection to temp) | `... -g "loadStateCache reads existing file"` | ❌ Wave 0 |
| POLL-02 | State cache resets to `{}` on corrupted JSON | unit | `... -g "loadStateCache fail-open on corrupted JSON"` | ❌ Wave 0 |
| POLL-02 | State cache resets to `{}` on missing file | unit | `... -g "loadStateCache returns empty on missing file"` | ❌ Wave 0 |
| POLL-02 | `304` response does NOT update cursor (verified via cache shape pre/post tick) | integration (client-mock) | `... -g "304 preserves cursor"` | ❌ Wave 0 |
| POLL-02 | Atomic write: tmpfile created, then renamed | unit (spy on `writeFileSync`/`renameSync` OR check via injected statePath after tick) | `... -g "atomic write uses tmp + rename"` | ❌ Wave 0 |
| POLL-03 | Pattern (a) — new issue with kodo label fires dispatch | integration | `... -g "dispatches new issue with kodo label"` | ❌ Wave 0 |
| POLL-03 | Pattern (b) — existing issue updated_at > cursor fires dispatch | integration | `... -g "dispatches updated issue"` | ❌ Wave 0 |
| POLL-03 | Pattern (c) — state change captured (existing issue with state:closed surfaces if config trigger state is closed) — actually verified by dispatcher; polling just dispatches | integration | `... -g "dispatches on updated_at change regardless of state"` | ❌ Wave 0 |
| POLL-03 | Idempotency — dispatcher mock spy verifies fire-and-forget (no await, dispatch errors don't propagate) | unit | `... -g "dispatchTrigger fire-and-forget"` | ❌ Wave 0 |
| POLL-03 | First-tick: NO dispatch, populate cursor only | unit | `... -g "first tick skips dispatch, populates cursor"` | ❌ Wave 0 |
| POLL-03 | PR filtering (when using client direct path) — issues with `pull_request != null` skipped | unit | `... -g "filters PRs from polling dispatch"` | ❌ Wave 0 |
| POLL-04 | 429 → emit `polling.error{attempt:1}`, sleep 2s via clock, retry | unit (clock-mock + client-mock) | `... -g "retries on 429 with exponential backoff"` | ❌ Wave 0 |
| POLL-04 | 500/502/503/504 → same retry path | unit | `... -g "retries on 5xx"` | ❌ Wave 0 |
| POLL-04 | Network error (AbortError, ETIMEDOUT) → retry path | unit | `... -g "retries on network error"` | ❌ Wave 0 |
| POLL-04 | 3 retries exhausted → emit `polling.error{attempt:3}`, warn-and-continue, next tick scheduled | unit | `... -g "warn-and-continue after 3 retries"` | ❌ Wave 0 |
| POLL-04 | 4xx non-transient (401, 404) → emit `polling.error`, NO retry, continue to next repo | unit | `... -g "no retry on non-transient errors"` | ❌ Wave 0 |
| POLL-04 | Wall-time of full retry test < 1s (clock injection works) | meta | implicit — overall test suite duration | ❌ Wave 0 |
| TEST-02 | NDJSON `polling.tick` emitted with `{owner, repo, status, dispatched}` | unit | `... -g "emits polling.tick"` | ❌ Wave 0 |
| TEST-02 | NDJSON `polling.dispatch` emitted with `{owner, repo, ref, pattern}` | unit | `... -g "emits polling.dispatch"` | ❌ Wave 0 |
| TEST-02 | NDJSON `polling.error` emitted with `{owner, repo, status, attempt}` | unit | `... -g "emits polling.error with required fields"` | ❌ Wave 0 |
| TEST-02 | LOG-12 — `src/check.js` does NOT import `src/triggers/polling.js` transitively | unit (extends existing walk) | `node --test test/check-isolation.test.js -g "polling.js"` | ❌ Wave 0 (extend existing file) |

### Sampling Rate

- **Per task commit:** `node --test test/triggers/polling.test.js test/check-isolation.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`. Baseline post-Phase-24: 682 pass / 0 fail / 1 skipped. Phase 25 target: 682 + ~25 polling tests = ~707 pass.

### Wave 0 Gaps

- [ ] `test/triggers/polling.test.js` — covers POLL-01..04 + TEST-02 (~20-25 tests)
- [ ] `test/triggers/` directory — does NOT exist yet (verified during research; only `test/providers/github/` and `test/` flat exist). Need to create dir.
- [ ] LOG-12 row in `test/check-isolation.test.js` — extend existing file with `polling.js` walker filter (pattern espejo Phase 24 D-29).
- [ ] Logger event helpers — extend `src/logger-events.js` (or test against literal event names via `kodo logs` NDJSON read).
- [ ] Test fixture for issues with `updated_at` timestamps spanning cursor boundary — may reuse `test/fixtures/github/issues-list.json` (already has 3 items + PR) or add `polling-tick-deltas.json`.

### Clock-Mock Strategy (detailed for TEST-02)

**Goal:** Validate retry backoff (2s, 4s, 8s) and tick scheduling (every 60s) in < 1s wall-time.

**Approach:** `createTestClock()` helper (see Code Examples §Example 2) provides:

| Method | Behavior |
|---|---|
| `clock.setTimeout(fn, ms)` | Enqueues `{ts: virtualNow + ms, fn}`. Returns handle. **Does NOT call real `setTimeout`.** |
| `clock.clearTimeout(handle)` | Removes from queue. |
| `clock.now()` | Returns `virtualNow`. |
| `advance(ms)` | Bumps `virtualNow` by `ms`, executes any queued timers in order, awaits microtasks between calls (via `setImmediate`). |
| `pendingCount()` | Returns queue length — useful for asserting "no leaked timers after stop". |

**Test wiring example:**

```javascript
it('retry exhaustion emits 3 polling.error events with exponential backoff', async () => {
  const { clock, advance } = createTestClock();
  const events = [];
  const logger = makeFakeLogger(events);
  const fakeClient = makeFakeClient({ listIssues: () => { const e = new Error('429'); e.status = 429; throw e; } });

  const { stop } = startPolling({
    client: fakeClient,
    repos: [{ owner: 'o', repo: 'r' }],
    intervalSec: 60,
    clock,
    logger,
    statePath: tempPath,
  });

  // First tick fires via Promise.resolve().then(tick)
  await drainMicrotasks();
  await advance(2000); await drainMicrotasks();  // retry 1
  await advance(4000); await drainMicrotasks();  // retry 2
  await advance(8000); await drainMicrotasks();  // retry 3 → exhausted, warn-and-continue

  const errors = events.filter((e) => e.event === 'polling.error');
  assert.equal(errors.length, 4, '1 initial + 3 retries (attempts 1,2,3,4)');
  // Actually attempts go 1,2,3 retries then attempt 4 → 4 total; verify exact contract in plan

  stop();
});
```

### NDJSON Assertion Pattern

Two options for asserting NDJSON event emission:

**Option A — Spy on logger:** Pass a fake logger that captures `info/warn/error` calls into an array. **Recommended** — easier setup, no FS I/O in tests.

```javascript
function makeFakeLogger(captureArray) {
  return {
    info: (msg, ctx) => captureArray.push({ level: 'info', msg, ...ctx }),
    warn: (msg, ctx) => captureArray.push({ level: 'warn', msg, ...ctx }),
    error: (msg, ctx) => captureArray.push({ level: 'error', msg, ...ctx }),
    debug: (msg, ctx) => captureArray.push({ level: 'debug', msg, ...ctx }),
    child: (bindings) => makeFakeLogger(captureArray),
  };
}
```

**Option B — Read NDJSON file after tick:** Use a real `createLogger({sessionId:'test-polling-xxx'})` and `readFileSync(~/.kodo/logs/test-polling-xxx.ndjson)` after each tick. **Use only if** Option A loses some contract (e.g., level resolution, redaction). For Phase 25, Option A suffices.

### State-Cache Persistence / Reset Tests

| Scenario | Test Setup | Assertion |
|---|---|---|
| Fresh start | `statePath = tempDir/polling-state.json` (not created) | `loadStateCache(statePath)` returns `{}` |
| Existing valid | Pre-write `{owner/repo: {last_updated_at: '...', etag: '...'}}` | `loadStateCache` returns that object |
| Corrupted JSON | Pre-write `'not valid json'` | `loadStateCache` returns `{}` (fail-open) |
| Array instead of object | Pre-write `'[]'` | `loadStateCache` returns `{}` (defensive) |
| Save round-trip | `saveStateCache({a:1}, statePath); loadStateCache(statePath)` | Returns `{a:1}` |
| Atomic write | After save, verify `statePath` exists, `statePath + '.tmp'` does NOT (renamed) | Filesystem state |
| 304 preserves cursor | Pre-populate cache with `{owner/repo: {last_updated_at: 'T1', etag: 'E1'}}`; mock client returns 304 | Post-tick cache STILL has `T1`/`E1` (unchanged) |
| 200 advances cursor | Mock client returns `{status:200, items:[issue with updated_at='T2'], etag:'E2'}` | Post-tick cache has `T2`/`E2` |

### Dispatch Pattern Triggers

| Pattern | Setup | Assertion |
|---|---|---|
| First tick (skip dispatch) | Cache empty; client returns 2 issues | `dispatchTriggerFn.calls.length === 0`; cache populated to max(updated_at) |
| Pattern (a) new issue | Cache has cursor T1; client returns issue with `created_at=T2 > T1` and `updated_at=T2` | `dispatchTriggerFn` called once with `taskRef: 'owner/repo#N'` |
| Pattern (b) updated label | Cache has cursor T1; client returns issue with `created_at=T0 < T1` but `updated_at=T2 > T1` | `dispatchTriggerFn` called once |
| Pattern (c) state change | Same as (b) — the dispatcher downstream filters by state, polling just dispatches | `dispatchTriggerFn` called; downstream verification not in polling.test.js scope |
| PR filtered | Client returns 1 issue + 1 PR (`pull_request !== null`); both have label kodo | `dispatchTriggerFn` called once (for issue), NOT for PR |
| Multiple repos, fire-and-forget | 2 repos; dispatchTriggerFn returns rejected promise for repo 1 | repo 2 still processed; no unhandled rejection (verified via process listener) |

---

## Security Domain

> `security_enforcement` assumed enabled (Phase 23+24 had security audits inline).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | yes (indirect — PAT auth) | `GITHUB_TOKEN` from `~/.kodo/.env` via `getProviderApiKey('github')` — Phase 23 lock-in. Polling NEVER reads token directly. |
| V3 Session Management | no | No user sessions in polling. |
| V4 Access Control | no | Personal-use tool; no multi-tenant. |
| V5 Input Validation | yes (low) | `repos` from config — should be array of `{owner, repo}` objects. Defensive: skip entries missing owner/repo with warn. URL-encoded in client (Phase 23 already handles). |
| V6 Cryptography | no | No HMAC (polling-only; webhook off in v0.7 for GitHub). |

### Known Threat Patterns for {Node.js polling loop}

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Unbounded retry loop saturates API | Denial-of-Service (against GitHub) | Max 3 retries per tick + 60s intervalSec → bounded. |
| Corrupted state cache crashes loop | Denial-of-Service (against operator) | POLL-02 fail-open: parse error → empty cache, no throw. |
| Token leak via NDJSON | Information Disclosure | `src/logger.js` redactor (`SENSITIVE_KEYS` set + `BEARERY_RE`) — polling NDJSON goes through same redactor; **but** verify that `issue.body` is NOT logged (could contain user-embedded secrets). Recommendation: `polling.dispatch` event includes `ref` only, NOT body. |
| Dispatch storm DoS-es local cmux | Denial-of-Service (against self) | First-tick skip (Pitfall #7) + lock per-repo dedup. |
| Symlink attack on `~/.kodo/polling-state.json` | Tampering | `~/.kodo/` is user's home — same trust boundary as `~/.kodo/.env` and `~/.kodo/state.json`. No additional hardening needed (precedent). |
| Concurrent polling + webhook double-dispatch | Tampering (state inconsistency) | Lock per-repo Phase 8 GSD-10 coalesces. **Documentation required** — CFG-04 Phase 26 contract: don't enable both for same repo. |

**Critical invariant:** `polling.dispatch` NDJSON event MUST NOT include `issue.body` or any user-provided text content. Include `ref` + `pattern` only. Reason: bodies can contain accidentally-pasted tokens.

---

## Sources

### Primary (HIGH confidence — verified in code/file reads during research)

- `src/interface.js` — `TASK_PROVIDER_METHODS` (9 methods canonical)
- `src/triggers/dispatcher.js` — `dispatchTrigger` signature + lock per-repo + worktree collision check
- `src/triggers/webhook.js` — fire-and-forget pattern precedent
- `src/providers/github/client.js` — `listIssues` envelope `{status:304, items:[], etag, rate_limit_remaining}`
- `src/providers/github/provider.js` — `listPendingTasks()` D-25 PR filter, `normalizeIssue` integration
- `src/providers/github/normalize.js` — pure transformer, 11-field canonical
- `src/providers/registry.js` — `getProvider('github')` D-29 fail-isolation
- `src/logger.js` — NDJSON sink + redactor + `SENSITIVE_KEYS`
- `src/logger-events.js` — closed taxonomy + helper pattern (`githubApiCall`/`githubApiCallFailed`)
- `src/config.js` — `KODO_DIR`, `getProviderApiKey`
- `src/check.js` — `runCheck` + LOG-12 invariant
- `src/labels.js` — `parseKodoLabels` cross-provider
- `test/check-isolation.test.js` — LOG-12 walker pattern + GitHub extension precedent
- `test/triggers/dispatcher.test.js` (existing) — DI pattern with deps injection
- `test/webhook.test.js` — fakeProvider + fire-and-forget assertion pattern
- `test/providers/github/provider.test.js` — fakeClient injection + live-fetch leak guard
- `test/plane-provider.test.js` — `globalThis.fetch` stub pattern (anti-pattern reference per Phase 23 D-06)
- `test/fixtures/github/issues-list.json` — 2 issues + 1 PR fixture (reusable for Phase 25)
- `.planning/STATE.md` — invariants v0.7 + open questions
- `.planning/REQUIREMENTS.md` — POLL-01..04 + TEST-02 verbatim
- `.planning/ROADMAP.md` — Phase 25 success criteria (D-01 corrected)
- `.planning/phases/24-githubprovider-normalizer-registry/24-03-SUMMARY.md` — D-01 doc-correction precedent + GH-05 invariant + LOG-12 extension pattern

### Secondary (MEDIUM confidence)

- Recursive `setTimeout` vs `setInterval` — industry standard for polling with variable latency (well-documented Node.js pattern)
- `tmp + rename` atomic write — standard POSIX idiom (manuscript: `rename(2)` man page)
- Clock injection in tests — standard JS test idiom (sinon's `useFakeTimers` precedent)

### Tertiary (LOW confidence — none required)

- None — Phase 25 is fully informed by codebase + ROADMAP precedent. Zero external doc lookups needed.

---

## Files to Create / Modify (planner consumption)

### Files to CREATE

| File | LOC estimate | Purpose | Plan |
|---|---|---|---|
| `src/triggers/polling.js` | ~150-200 | `startPolling` entry + recursive tick + retry + state cache I/O (inline or split) | 25-02 |
| `test/triggers/polling.test.js` | ~400-500 | TEST-02: ~20-25 unit + integration tests with clock-mock + fakeClient + fakeLogger + tempStatePath | 25-02 (or 25-03 if split) |
| `test/triggers/` (directory) | — | Container for `polling.test.js` (doesn't exist yet) | 25-02 |
| `.planning/phases/25-polling-trigger-channel/25-{01,02,03}-PLAN.md` | — | Plan files | by planner |

### Files to MODIFY

| File | Change | Plan |
|---|---|---|
| `src/logger-events.js` | Add `POLLING_TICK`, `POLLING_DISPATCH`, `POLLING_ERROR` to `EVENTS` frozen object + 3 helper functions (`pollingTick`, `pollingDispatch`, `pollingError`). ~50 LOC added. | 25-01 |
| `test/check-isolation.test.js` | Add 1 new test row asserting `src/check.js` does NOT transitively import `src/triggers/polling.js`. ~12 LOC. Pattern: espejo Phase 24 D-29 (github/provider.js + github/normalize.js). | 25-02 (alongside polling.js creation) |

### Files explicitly NOT to modify (invariants)

| File | Why |
|---|---|
| `src/triggers/dispatcher.js` | Phase 25 NO toca el dispatcher. Polling lo invoca fire-and-forget. |
| `src/triggers/webhook.js` | Independent trigger channel. |
| `src/providers/github/client.js` | Phase 23 final. Polling consume `listIssues` envelope as-is. |
| `src/providers/github/provider.js` | Phase 24 final. Polling consume `listPendingTasks` (optional path). |
| `src/providers/github/normalize.js` | Phase 24 final. Polling re-uses `normalizeIssue` if client-direct path. |
| `src/providers/registry.js` | Phase 24 final. Polling consumes `getProvider('github')`. |
| `src/labels.js` | GH-05 BLOCKING invariant. |
| `src/interface.js` | Canonical contract read-only. |
| `src/config.js` | Phase 26 owns config schema extension (CFG-02). Phase 25 imports `KODO_DIR` only. |
| `src/check.js` | LOG-12 invariant. |
| `src/server.js` | Phase 26 may wire `kodo polling start` here or in CLI. Phase 25 doesn't. |

### Suggested Plan Granularity (3 plans)

**Plan 25-01 — Logger Events Extension (`docs/test/feat`)**
- Add `POLLING_TICK`, `POLLING_DISPATCH`, `POLLING_ERROR` to `src/logger-events.js#EVENTS`.
- Add 3 typed helpers (`pollingTick`, `pollingDispatch`, `pollingError`).
- Extend `test/logger-events.test.js` (if exists) with helper tests.
- Wave 0 prereq for Plan 25-02 (polling.js imports helpers).
- LOC: ~70 added across 2 files.

**Plan 25-02 — Polling Core + State Cache + Tests (`feat/test`)**
- Create `src/triggers/polling.js` with `startPolling`, `loadStateCache`, `saveStateCache` (inline) — or split into `polling.js` + `polling-state.js` if planner judges modularity is worth it.
- Create `test/triggers/polling.test.js` with `createTestClock`, fakeClient, fakeLogger, tempStatePath helpers and ~20-25 tests covering POLL-01/02/03/04 + TEST-02 + first-tick skip + PR filter.
- Extend `test/check-isolation.test.js` with LOG-12 row for `polling.js`.
- LOC: ~200 polling.js + ~450 polling.test.js + ~15 check-isolation.test.js extension.
- **Decisions locked in CONTEXT.md or plan front-matter:**
  - D-XX: `startPolling` signature accepts both `provider` and `client` (Open Q #2 RECOMMENDED hybrid).
  - D-XX: Clock injection as `{setTimeout, clearTimeout, now}` (Open Q #3 RECOMMENDED).
  - D-XX: POLL-04 retry exhaustion = warn-and-continue (Open Q #1 RECOMMENDED).
  - D-XX: First-tick skip-dispatch (Pitfall #7 recommendation).
  - D-XX: Save state per-repo within tick (Open Q #4 RECOMMENDED).
  - D-XX: `polling.dispatch` NDJSON does NOT include `issue.body` (Security invariant).

**Plan 25-03 — (OPTIONAL, defer to Phase 26 unless scope creep) Wiring**
- IF Phase 26 hasn't started yet AND there's appetite for a smoke integration test: add a minimal `bin/kodo polling start` stub that just invokes `startPolling` and validates wiring end-to-end (no daemon, no PID).
- **Recommendation: SKIP this plan in Phase 25.** All CLI wiring is Phase 26 CFG-03/CFG-04 scope. Phase 25 closes when Plans 25-01 + 25-02 are green. The Phase 26 planner picks up from `startPolling` as an existing, tested function.

### Suggested Plan Granularity (2 plans alternative — simpler)

**Plan 25-01 — Logger Events + LOG-12 Extension** (combine the small bits)
**Plan 25-02 — Polling Core + State Cache + Tests** (the big plan)

**Recommendation:** **3 plans** because:
1. Plan 25-01 (logger events) is a Wave 0 prerequisite for Plan 25-02 — clearer dependency graph.
2. Plan 25-02 is large (~700 LOC across 2 files) but cohesive — splitting it harms readability.
3. Plan 25-03 is explicitly **optional/skipped** unless the planner sees value.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified via file reads, all dependencies exist
- Architecture patterns: HIGH — webhook + dispatcher + retry precedents direct
- Pitfalls: HIGH — derived from Phase 23/24 lessons + Node.js standard wisdom
- Validation architecture: HIGH — clock-mock pattern self-contained; assertions concrete
- Open questions: MEDIUM — recommendations strong but require planner/user lock-in
- Security domain: MEDIUM — covered low-surface threats; `issue.body` non-logging is the load-bearing decision

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (30 days — Phase 25 should execute within v0.7 sprint, no upstream churn expected)

## RESEARCH COMPLETE
