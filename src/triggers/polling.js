// @ts-check
/**
 * Polling trigger channel — third trigger source for kodo (Phase 25 POLL-01..04).
 *
 * Mirror estructural de `src/triggers/webhook.js`: fire-and-forget dispatch al
 * `dispatchTrigger` central (espejo de `webhook.js:46-48`), DI por opts (espejo
 * de `dispatcher.js:18-55`). Loop recursivo cancelable que descubre issues con
 * label `kodo` en repos configurados y dispara una sesión por issue cambiado.
 *
 * Divergencias justificadas vs `Plane client.js` retry:
 *   - Phase 23 GitHubClient NO hace retry interno (D-11). Esta capa de polling
 *     es la única que reintenta — backoff exponencial 2s base × 3 retries,
 *     warn-and-continue tras agotamiento (Open Q #1 RESOLVED).
 *   - Phase 24 D-25 `provider.listPendingTasks()` ya filtra PRs internamente.
 *     Cuando este módulo usa el path directo `client.listIssues` debe replicar
 *     el filtro `if (issue.pull_request) continue;` (Pitfall #2).
 *
 * Path híbrido (Open Q #2 RESOLVED — HYBRID con `client` priority):
 *   - Si `opts.client` presente → ruta optimizada `client.listIssues` con
 *     `since` + `etag` (envelope `{status, items, etag, rate_limit_remaining}`).
 *   - Si solo `opts.provider` → `provider.listPendingTasks()` + envelope sintético.
 *     Provider-agnostic; sin etag/since pero compatible con cross-provider.
 *
 * Cancellation: el loop es recursivo (`setTimeout(tick, intervalMs)`) — el primer
 * tick arranca via `Promise.resolve().then(tick)` (microtask, no real timer); los
 * siguientes ticks via `clock.setTimeout` (mockeable). `stop()` setea un flag
 * `stopped = true` y cancela el timer pendiente. Si `stop()` ocurre durante un
 * tick en vuelo, el flag termina el for-loop en su próxima iteración (Pitfall #4:
 * recursive setTimeout previene ticks solapados POR DISEÑO).
 *
 * State cache (POLL-02 — `~/.kodo/polling-state.json`):
 *   - `loadStateCache` retorna `{}` ante archivo ausente, JSON corrupto, o tipo
 *     inválido (array, null, primitive). Fail-open — JAMÁS throw.
 *   - `saveStateCache` usa `tmp + rename` atómico (POSIX). Pitfall #6: kodo es
 *     Mac/Linux only; `renameSync` en Win32 fallaría si el destino existe.
 *
 * First-tick (Pitfall #7 — RESOLVED locked):
 *   - El primer tick por repo (cache vacío para esa key) NO dispara dispatch;
 *     solo puebla el cursor con `max(updated_at)` de los items encontrados.
 *     Evita storm de 50 sesiones en repos con backlog histórico.
 *
 * Clock injection (Pitfall #5 — RESOLVED Open Q #3):
 *   - `polling.js` usa `clock.now()` exclusivamente. La ÚNICA ocurrencia de
 *     `Date.now()` en este archivo está dentro de `DEFAULT_CLOCK.now` (línea
 *     constante de fallback). Tests inyectan un clock duck-typed.
 *
 * Invariantes (T-25-01..05, LOG-12):
 *   - T-25-02 (Information disclosure): el callsite del helper `pollingDispatch`
 *     SOLO recibe `{owner, repo, ref, pattern}`. JAMÁS contenido de usuario
 *     (descripción, título, payload raw). El helper Plan 25-01 ya hace whitelist
 *     estricta — esto es defensa en profundidad. El payload completo del issue
 *     SÍ se pasa a `dispatchTrigger` en el field `raw` porque el dispatcher lo
 *     necesita downstream (paso interno de proceso, NO leak a NDJSON).
 *   - T-25-03 (DoS retry): `RETRY_BASE_MS=2000`, `RETRY_MAX_ATTEMPTS=3`. Máximo
 *     `1 + 3 = 4` calls por repo por tick.
 *   - T-25-04 (Dispatch storm): first-tick skip — cursor vacío → cero dispatch,
 *     populación de cursor con max(updated_at).
 *   - T-25-05 (PR elevation): `if (issue.pull_request) continue;` con cita inline
 *     a Phase 24 D-25 / Pitfall #2.
 *   - LOG-12: `src/check.js` NO importa este módulo transitivamente. Imports
 *     estáticos OK: este archivo está fuera del grafo de `kodo check` (verificado
 *     por `test/check-isolation.test.js` Task 3 row).
 *
 * Color isolation: cero `import 'picocolors'`. Console output usa strings planos.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { dispatchTrigger } from './dispatcher.js';
import { normalizeIssue } from '../providers/github/normalize.js';
import { EVENTS, pollingTick, pollingDispatch, pollingError, pollingTickSummary } from '../logger-events.js';
import { KODO_DIR } from '../config.js';

// Suppress unused-warning for EVENTS (re-exported reference; primary use is
// the 3 typed helpers which already import the literals internally).
void EVENTS;

/**
 * @typedef {{
 *   setTimeout: (fn: () => void, ms: number) => any,
 *   clearTimeout: (handle: any) => void,
 *   now: () => number,
 * }} Clock
 */

/**
 * Default clock — delegates to `globalThis` timers and `Date.now()`.
 *
 * Pitfall #5: This is the ONLY occurrence of `Date.now()` permitted in this
 * file. The rest of the module uses `clock.now()` exclusively (where `clock`
 * is the injected `Clock` or this default).
 *
 * @type {Clock}
 */
const DEFAULT_CLOCK = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  now: () => Date.now(),
};

/** Base backoff in ms for the retry loop (T-25-03 bounded retry constants). */
const RETRY_BASE_MS = 2000;

/** Max retry attempts per repo per tick (T-25-03). */
const RETRY_MAX_ATTEMPTS = 3;

/** HTTP statuses that trigger a retry. Network errors are handled separately. */
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Default path for the state cache. Phase 26 may add CLI override; v0.7 hard-coded. */
const DEFAULT_STATE_PATH = join(KODO_DIR, 'polling-state.json');

/**
 * Read the polling state cache from disk.
 *
 * Fail-open (POLL-02 T-25-01 mitigation): on missing file, JSON parse error,
 * or invalid shape (array, null, primitive), return `{}`. NEVER throws.
 *
 * @param {string} [path]
 * @returns {Record<string, { last_updated_at?: string, etag?: string }>}
 */
function loadStateCache(path = DEFAULT_STATE_PATH) {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    // Defensive shape check: object literal only, not arrays/null/primitives.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Persist the polling state cache to disk atomically.
 *
 * Pitfall #6: `tmp + rename` is atomic on POSIX (Mac/Linux). kodo does NOT
 * support Windows in v0.7 (renameSync would fail if the destination exists
 * on Win32). If Windows support is added later, switch to `fs.renameSync`
 * with `MOVEFILE_REPLACE_EXISTING` equivalent.
 *
 * @param {Record<string, { last_updated_at?: string, etag?: string }>} cache
 * @param {string} [path]
 */
function saveStateCache(cache, path = DEFAULT_STATE_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n');
  renameSync(tmp, path);
}

/**
 * Decide whether an issue/task should fire dispatch given the previous cursor.
 *
 * Pitfall #7 / T-25-04: first tick (`!prev.last_updated_at`) → `false`. Cursor
 * is populated from `max(updated_at)` but NO dispatch fires. Subsequent ticks
 * fire dispatch only when `task.updated_at > prev.last_updated_at`.
 *
 * D-05 Phase 28: el parámetro se renombra `issue → task` porque el call site
 * vive en `processRepo` y puede ser raw GitHub issue (path client) o TaskItem
 * normalizado (path provider-only). Ambos exponen `updated_at` ISO string
 * post-Phase-28 (D-02 GitHub, D-03 Plane), así que el cuerpo es idéntico.
 *
 * @param {{ updated_at: string }} task
 * @param {{ last_updated_at?: string }} prev
 * @returns {boolean}
 */
function shouldDispatch(task, prev) {
  if (!prev.last_updated_at) return false; // first-tick skip (T-25-04)
  return task.updated_at > prev.last_updated_at;
}

/**
 * Classify the dispatch pattern (forensic hint for NDJSON, NOT a contract).
 *
 *   - `'first-tick'` — no prior cursor (this is the first tick for this repo).
 *     Returned even though `shouldDispatch` is false, for symmetry — callers
 *     should not invoke this when `shouldDispatch` returned false.
 *   - `'a-new'` — issue was created after the previous cursor.
 *   - `'b-or-c-updated'` — issue existed before the cursor but was updated.
 *
 * @param {{ created_at?: string }} issue
 * @param {{ last_updated_at?: string }} prev
 * @returns {'first-tick' | 'a-new' | 'b-or-c-updated'}
 */
function classifyPattern(issue, prev) {
  if (!prev.last_updated_at) return 'first-tick';
  if (issue.created_at && issue.created_at > prev.last_updated_at) return 'a-new';
  return 'b-or-c-updated';
}

/**
 * Promise bridge over `clock.setTimeout` — makes retry sleep mockeable.
 *
 * @param {Clock} clock
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(clock, ms) {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

/**
 * Process a single (owner, repo) pair within one tick.
 *
 * Retry loop with exponential backoff (POLL-04 / T-25-03):
 *   - attempt 1 immediate; attempts 2..(1+RETRY_MAX_ATTEMPTS) after `2^(n-1) * BASE` ms.
 *   - After RETRY_MAX_ATTEMPTS retries exhausted (= 4 total calls): warn-and-continue.
 *     Cursor is NOT updated; next tick will retry from current cursor.
 *
 * Phase 28 D-10: signature changes from `Promise<void>` →
 * `Promise<{dispatched: number, rate_limit_remaining: number|null}>`. All 4
 * return paths (304 cache-hit / 200 success / non-transient fail-fast / retries
 * exhausted) return the same shape so the cross-repo aggregator in `tick()`
 * can sum dispatches and compute the min rate-limit (D-12 conservative).
 *
 * Branches:
 *   - 304: captures `result.rate_limit_remaining` from the envelope so the
 *     "all-304 tick" case still surfaces a non-null rate_limit (fixes a subtle
 *     bug where the summary would report `null` when every repo was a cache-hit).
 *   - 200 success: same passthrough from envelope.
 *   - error fail-fast (non-transient throw) / retries-exhausted: no envelope
 *     accessible → `rate_limit_remaining: null`. The summary preserves the
 *     repo in `repos[]` but reports `total_dispatches=0` for it.
 *   - provider-only path: synthetic envelope built locally has no
 *     `rate_limit_remaining`, so `result.rate_limit_remaining ?? null` → null.
 *
 * @param {{
 *   owner: string,
 *   repo: string,
 *   cache: Record<string, { last_updated_at?: string, etag?: string }>,
 *   client?: import('../providers/github/client.js').GitHubClient,
 *   provider?: import('../interface.js').TaskProvider,
 *   dispatchFn: (event: import('../interface.js').TriggerEvent, opts?: object) => Promise<any>,
 *   clock: Clock,
 *   logger?: import('../logger.js').Logger,
 *   isFirstTick: boolean,
 *   statePath: string,
 * }} params
 * @returns {Promise<{dispatched: number, rate_limit_remaining: number|null}>}
 */
async function processRepo({
  owner,
  repo,
  cache,
  client,
  provider,
  dispatchFn,
  clock,
  logger,
  isFirstTick,
  statePath,
}) {
  // Phase 28 D-13 test seam (Plan 28-03 Task 3): integration test del daemon
  // crash usa esta env var para forzar throw post-spawn del hijo, permitiendo
  // que el fd redirect (D-13) capture el stack trace en el logfile. Doble
  // guard NODE_ENV=test para que NUNCA se active en producción incluso si el
  // operador la define accidentalmente. El throw propaga up del processRepo →
  // tick closure → uncaught rejection del proceso del hijo → stderr crudo →
  // fd redirect (D-13) → logfile.
  if (
    process.env.NODE_ENV === 'test' &&
    process.env.KODO_TEST_FORCE_THROW === 'true'
  ) {
    throw new Error('KODO_TEST_FORCE_THROW: test-induced crash');
  }

  const key = `${owner}/${repo}`;
  const prev = cache[key] || {};
  let attempt = 0;

  while (attempt <= RETRY_MAX_ATTEMPTS) {
    try {
      /** @type {{ status: number, items: any[], etag?: string, rate_limit_remaining?: number }} */
      let result;
      if (client) {
        // Hybrid path A (RESOLVED Open Q #2): direct optimized — `since`+`etag`.
        result = await client.listIssues(owner, repo, {
          labels: ['kodo'],
          state: 'open',
          ...(prev.last_updated_at ? { since: prev.last_updated_at } : {}),
          ...(prev.etag ? { etag: prev.etag } : {}),
        });
      } else if (provider) {
        // Hybrid path B: provider-agnostic — synthetic envelope from listPendingTasks.
        // Phase 24 D-25 already filters PRs internally — no need to repeat the
        // `pull_request` check on this path.
        const tasks = await provider.listPendingTasks();
        const itemsForRepo = tasks.filter((t) => t.projectId === key);
        result = { status: 200, items: itemsForRepo, etag: undefined };
      } else {
        // Defensive — startPolling validates this at entry, but if somehow
        // called directly with neither, fail loud.
        throw new Error('processRepo: neither client nor provider available');
      }

      // 304 Not Modified → cursor preserved, NO items to iterate, NO save.
      if (result.status === 304) {
        if (logger) {
          pollingTick(logger, {
            owner,
            repo,
            status: 304,
            dispatched: 0,
            ...(isFirstTick ? { first_tick: true } : {}),
          });
        }
        // Phase 28 D-10/D-12: surface envelope rate_limit even on 304 so the
        // "all-304 tick" case still reports a non-null min cross-repo. The
        // client envelope (src/providers/github/client.js:160-164) populates
        // `rate_limit_remaining` from the response headers even on cache hits.
        const rateLimit =
          typeof result.rate_limit_remaining === 'number' ? result.rate_limit_remaining : null;
        return { dispatched: 0, rate_limit_remaining: rateLimit };
      }

      // 200 path: iterate items, filter PRs (Pitfall #2 / T-25-05), decide dispatch.
      let dispatched = 0;
      let maxUpdatedAt = prev.last_updated_at || '';
      for (const issue of result.items) {
        // Pitfall #2 (Phase 24 D-25): GitHub `/issues` endpoint intermixes PRs.
        // The provider path already filters; client path needs explicit guard.
        // T-25-05: a PR with label `kodo` would otherwise spawn a Claude session
        // on a contributor-controlled branch.
        if (issue.pull_request) continue;

        if (issue.updated_at && issue.updated_at > maxUpdatedAt) {
          maxUpdatedAt = issue.updated_at;
        }

        if (shouldDispatch(issue, prev)) {
          const task = client
            ? normalizeIssue(issue, { projectId: key })
            : issue; // provider path already normalized
          const pattern = classifyPattern(issue, prev);

          // T-25-02 guardrail: ONLY pass {owner, repo, ref, pattern}. The helper
          // itself whitelists, but defense-in-depth — NEVER leak user content
          // (descripción, título, payload raw) through this call site.
          if (logger) {
            pollingDispatch(logger, {
              owner,
              repo,
              ref: task.ref,
              pattern,
            });
          }

          // Fire-and-forget — espejo `webhook.js:46-48`. NEVER `await`. Any
          // rejection is logged but not propagated; loop continues.
          dispatchFn(
            {
              taskRef: task.ref,
              action: 'polling',
              provider: 'github',
              raw: issue,
            },
            {},
          ).catch((err) => {
            if (logger) {
              logger.error('polling.dispatch.failed', {
                owner,
                repo,
                ref: task.ref,
                error: err && err.message ? err.message : String(err),
              });
            } else {
              console.error(`[kodo:polling] dispatch failed: ${err && err.message ? err.message : err}`);
            }
          });

          dispatched++;
        }
      }

      // Persist cursor + etag per-repo (Open Q #4 RESOLVED — once per repo
      // bounds loss if crash mid-tick).
      cache[key] = {
        last_updated_at: maxUpdatedAt || prev.last_updated_at,
        ...(result.etag ? { etag: result.etag } : {}),
      };
      saveStateCache(cache, statePath);

      if (logger) {
        pollingTick(logger, {
          owner,
          repo,
          status: 200,
          dispatched,
          ...(isFirstTick ? { first_tick: true } : {}),
        });
      }
      // Phase 28 D-10/D-12: 200 path passes through envelope rate_limit_remaining.
      // Provider-only path builds a synthetic envelope without rate_limit (line
      // 257-262 above), so `?? null` yields null for that path.
      const rateLimit =
        typeof result.rate_limit_remaining === 'number' ? result.rate_limit_remaining : null;
      return { dispatched, rate_limit_remaining: rateLimit };
    } catch (err) {
      const status = err && typeof err.status === 'number' ? err.status : 0;
      const isTransient =
        TRANSIENT_STATUSES.has(status) ||
        (err && err.code === 'ETIMEDOUT') ||
        (err && err.name === 'AbortError');

      attempt++;
      if (logger) {
        pollingError(logger, {
          owner,
          repo,
          status,
          attempt,
          ...(err && err.message ? { error: String(err.message).slice(0, 200) } : {}),
        });
      }

      // Non-transient → fail-fast, NO retry. Loop's next tick will retry from
      // current cursor (warn-and-continue across ticks).
      // Phase 28 D-10: shape `{dispatched, rate_limit_remaining}` aligned with
      // success branches — no envelope accessible from throw, so rate_limit=null.
      if (!isTransient) return { dispatched: 0, rate_limit_remaining: null };

      // Retries exhausted → warn-and-continue (Open Q #1 RESOLVED — Option A).
      // NO `polling.stopped` event; the next tick retries naturally.
      if (attempt > RETRY_MAX_ATTEMPTS) return { dispatched: 0, rate_limit_remaining: null };

      // Exponential backoff: 2s, 4s, 8s. T-25-03 bounded.
      await sleep(clock, RETRY_BASE_MS * Math.pow(2, attempt - 1));
    }
  }
  // Defensive fallthrough — unreachable because the while loop has explicit returns
  // on every branch (304, 200, non-transient, retries-exhausted). Kept to satisfy
  // the TS contract `Promise<{dispatched, rate_limit_remaining}>`.
  return { dispatched: 0, rate_limit_remaining: null };
}

/**
 * @typedef {{
 *   provider?: import('../interface.js').TaskProvider,
 *   client?: import('../providers/github/client.js').GitHubClient,
 *   repos: Array<{ owner: string, repo: string }>,
 *   intervalSec?: number,
 *   clock?: Clock,
 *   logger?: import('../logger.js').Logger,
 *   statePath?: string,
 *   dispatchTriggerFn?: (event: import('../interface.js').TriggerEvent, opts?: object) => Promise<any>,
 * }} StartPollingOpts
 */

/**
 * Start the polling trigger loop. Returns a `{stop}` handle.
 *
 * The first tick fires via `Promise.resolve().then(tick)` (microtask, no real
 * timer). Subsequent ticks are scheduled via `clock.setTimeout(tick, intervalMs)`
 * — recursive setTimeout, not setInterval (prevents overlapping ticks by design,
 * Pitfall #4).
 *
 * Validation (fail-fast): at least one of `opts.provider` or `opts.client` must
 * be present. Without either, the loop has no way to discover issues; throw at
 * startup rather than per-tick.
 *
 * @param {StartPollingOpts} opts
 * @returns {{ stop: () => void }}
 */
export function startPolling(opts) {
  if (!opts.provider && !opts.client) {
    throw new Error('startPolling requires opts.provider or opts.client');
  }

  const clock = opts.clock || DEFAULT_CLOCK;
  const intervalMs = (opts.intervalSec ?? 60) * 1000;
  const dispatchFn = opts.dispatchTriggerFn || dispatchTrigger;
  const statePath = opts.statePath || DEFAULT_STATE_PATH;

  let stopped = false;
  /** @type {any} */
  let timer = null;
  /** Track which (owner, repo) pairs have completed their first tick this run. */
  const firstTickPerRepo = new Set();

  async function tick() {
    if (stopped) return;
    const cache = loadStateCache(statePath);

    // Phase 28 D-10/D-12: cross-repo aggregators for the tick summary.
    //   - totalDispatched: sum of dispatches across all repos this tick.
    //   - minRateLimit: most conservative (min) rate_limit_remaining cross-repo;
    //     null when no repo reported a rate-limit header (e.g. all provider-only,
    //     all errored, or all returned envelopes without it).
    //   - reposPolled: `owner/repo` keys polled this tick. Push BEFORE the await
    //     so the repo appears in the summary even if processRepo throws (defense
    //     in depth — processRepo's catch block handles its own errors and returns
    //     a shape, but the early push gives forensic continuity if anything escapes).
    let totalDispatched = 0;
    /** @type {number | null} */
    let minRateLimit = null;
    /** @type {string[]} */
    const reposPolled = [];

    for (const { owner, repo } of opts.repos) {
      if (stopped) break;
      const key = `${owner}/${repo}`;
      reposPolled.push(key);
      const isFirstTick = !firstTickPerRepo.has(key);
      const repoSummary = await processRepo({
        owner,
        repo,
        cache,
        client: opts.client,
        provider: opts.provider,
        dispatchFn,
        clock,
        logger: opts.logger,
        isFirstTick,
        statePath,
      });
      totalDispatched += repoSummary.dispatched;
      if (repoSummary.rate_limit_remaining != null) {
        minRateLimit =
          minRateLimit == null
            ? repoSummary.rate_limit_remaining
            : Math.min(minRateLimit, repoSummary.rate_limit_remaining);
      }
      firstTickPerRepo.add(key);
    }

    // Phase 28 D-10: emit cross-repo summary AT END of the tick (once per tick).
    // Guard `!stopped` prevents a final summary fire after stop() between the
    // last repo and the setTimeout reschedule.
    if (opts.logger && !stopped) {
      pollingTickSummary(opts.logger, {
        repos_polled: reposPolled.length,
        total_dispatches: totalDispatched,
        rate_limit_remaining: minRateLimit,
        repos: reposPolled,
      });
    }

    if (!stopped) {
      timer = clock.setTimeout(tick, intervalMs);
    }
  }

  // Kick-off — microtask, no real timer. Loop-level errors logged but not propagated.
  Promise.resolve()
    .then(tick)
    .catch((err) => {
      if (opts.logger) {
        opts.logger.error('polling.loop.error', {
          error: err && err.message ? err.message : String(err),
        });
      } else {
        console.error(`[kodo:polling] loop error: ${err && err.message ? err.message : err}`);
      }
    });

  return {
    stop() {
      stopped = true;
      if (timer) clock.clearTimeout(timer);
    },
  };
}
