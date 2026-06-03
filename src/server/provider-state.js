// @ts-check
//
// src/server/provider-state.js — Phase 40 Plan 02 (PSTATE-04).
//
// Pure, dependency-injected resolver for the read-only `provider_state` lane of
// `GET /status`. Extracted out of server.js because the HTTP handler has NO test
// harness (it needs network + provider to boot) and the cache/dedup/fail-open
// logic here is the riskiest code of Phase 40 — so it lives in a unit-testable
// factory injected with mocks.
//
// READ-ONLY invariant: this module imports NOTHING that writes state.json
// (no session/state.js, no saveState). It is structurally unable to persist —
// `reconcileTick` stays the sole writer of `alive` (v0.9 D-04). `provider_state`
// never touches state.json and is never coupled to `alive`/`elapsed_min`.
//
// Anti-ReDoS: the resolver only STORES the literal the adapters already normalized
// (the mappers in plane/github providers use String.includes). No RegExp here.
//
// LOG-12: the only import is the explicit-whitelist event helper from logger-events.

import { providerStateFetchFailed } from '../logger-events.js';

/**
 * @typedef {import('../logger.js').Logger} Logger
 */

/**
 * @typedef {{ state: string|null, reason: null|'unsupported'|'fetch-failed' }} ProviderStateResult
 */

/**
 * Build the per-provider id shape getTaskState expects from a session record.
 * Plane needs {id, projectId}; GitHub needs {ref} (D-Discretion / 40-01 signatures).
 *
 * @param {{ provider: string, task_id: string, project_id?: string, task_ref?: string }} session
 * @returns {object}
 */
function idShapeFor(session) {
  if (session.provider === 'github') {
    return { ref: session.task_ref };
  }
  // Default to the Plane shape (the reference adapter).
  return { id: session.task_id, projectId: session.project_id };
}

/**
 * Create a provider_state resolver. DI: `now` defaults to Date.now; `ttlMs` is
 * passed PENDING_CACHE_TTL_MS by server.js (the module does NOT hardcode 30s — D-02
 * reuse without a second literal).
 *
 * The factory closes over:
 *  - a task_id-keyed result cache `Map<task_id, {state, reason, ts}>` (D-01/D-04 —
 *    a NEW map, NOT the `{data, ts}` pendingCache shape)
 *  - an in-flight `Map<task_id, Promise>` so overlapping polls share one fetch (D-03)
 *
 * @param {{
 *   provider: { getTaskState?: (arg: object) => Promise<string|null> },
 *   logger: Logger,
 *   ttlMs: number,
 *   now?: () => number,
 * }} deps
 */
export function createProviderStateResolver({ provider, logger, ttlMs, now = Date.now }) {
  /** @type {Map<string, { state: string|null, reason: null|'unsupported'|'fetch-failed', ts: number }>} */
  const cache = new Map();
  /** @type {Map<string, Promise<ProviderStateResult>>} */
  const inflight = new Map();

  /**
   * Resolve the provider_state for a single session row. Never throws — failures
   * collapse to {state:null, reason:'fetch-failed'} and emit an observable event.
   *
   * @param {{ provider: string, task_id: string, project_id?: string, task_ref?: string }} session
   * @returns {Promise<ProviderStateResult>}
   */
  async function resolve(session) {
    // (a) capability gate — permanent, no fetch (D-05/D-06).
    if (typeof provider.getTaskState !== 'function') {
      return { state: null, reason: 'unsupported' };
    }

    const key = session.task_id;

    // (b) cache hit within TTL.
    const cached = cache.get(key);
    if (cached && now() - cached.ts < ttlMs) {
      return { state: cached.state, reason: cached.reason };
    }

    // (c) in-flight dedup — overlapping polls await the same fetch (D-03).
    const pending = inflight.get(key);
    if (pending) return pending;

    // (d) start the fetch.
    const work = (async () => {
      try {
        const state = await provider.getTaskState(idShapeFor(session));
        /** @type {ProviderStateResult} */
        const result = { state, reason: null };
        cache.set(key, { state, reason: null, ts: now() });
        return result;
      } catch (err) {
        /** @type {ProviderStateResult} */
        const result = { state: null, reason: 'fetch-failed' };
        cache.set(key, { state: null, reason: 'fetch-failed', ts: now() });
        providerStateFetchFailed(logger, {
          task_id: session.task_id,
          provider: session.provider,
          error: err && err.message ? err.message : String(err),
        });
        return result;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, work);
    return work;
  }

  return { resolve };
}
