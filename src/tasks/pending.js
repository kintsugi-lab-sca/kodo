// @ts-check
//
// src/tasks/pending.js — Phase 76 Plan 01 (ORCH-05 / ORCH-06).
//
// Pure, ZERO-import leaf. The single source of truth for the `pending` read lane
// shared by server.js (GET /status) and check.js. Fetch + TTL cache + discriminated
// freshness policy live here so both consumers converge on ONE fetch path (ORCH-05)
// and a provider outage is LABELED stale, never served as fresh (ORCH-06).
//
// ── CERO IMPORTS (restricción estructural, NO negociable) ─────────────────────────
// Ni `node:*`, ni relativos, ni logger/logger-events. Mismo contrato que
// `src/session/handoff.js` y `src/logger-noop.js`. Razón dura: check.js importará
// `fetchFreshPending` desde aquí; cualquier import (p. ej. logger-events) arrastraría
// su grafo al de `kodo check` y rompería LOG-12 (blindado por test/check-isolation).
// Todo lo que necesite llega por parámetro. El módulo NUNCA emite logs/eventos: el
// caller (server.js) inspecciona `stale` y emite el rastro (D-02 / Pitfall 1).
//
// El literal del TTL (30s) NO se declara aquí — entra por `ttlMs` (D-03, no second
// number). Espejo del factory+DI+TTL+fail-open de src/server/provider-state.js
// (Phase 40), adaptado a un fetch de lista completa con resultado {tasks, fetched_at,
// stale} en vez de {state, reason}.

/**
 * @typedef {{ ref: string, title: string, url: string, state: string, projectName: string }} PendingTask
 */

/**
 * @typedef {{ tasks: PendingTask[], fetched_at: string|null, stale: boolean }} PendingResult
 */

/**
 * Convergence point (ORCH-05, D-01): the ONE place both server.js and check.js fetch
 * pending from. Raw mode — does NOT capture the throw; check.js consumes it raw so its
 * red-line catch stays byte-identical (D-07).
 *
 * @param {() => Promise<PendingTask[]>} listPendingTasksFn
 * @returns {Promise<PendingTask[]>}
 */
export async function fetchFreshPending(listPendingTasksFn) {
  return await listPendingTasksFn();
}

/**
 * Create a pending resolver. DI: `now` defaults to Date.now; `ttlMs` is passed by the
 * caller (PENDING_CACHE_TTL_MS in server.js — the module does NOT hardcode 30s, D-03).
 *
 * The factory closes over a single `{ tasks, fetched_at }` cache slot (null = never
 * succeeded). `resolve()` NEVER throws — failures collapse to a LABELED result with
 * freshness discriminated in `stale` (D-04), never to a single error value.
 *
 * @param {{
 *   listPendingTasksFn: () => Promise<PendingTask[]>,
 *   ttlMs: number,
 *   now?: () => number,
 * }} deps
 * @returns {{ resolve: () => Promise<PendingResult> }}
 */
export function createPendingResolver({ listPendingTasksFn, ttlMs, now = Date.now }) {
  /** @type {{ tasks: PendingTask[], fetched_at: string } | null} */
  let cache = null;

  /**
   * @returns {Promise<PendingResult>}
   */
  async function resolve() {
    // (a) cache hit within TTL → serve as fresh.
    if (cache && now() - new Date(cache.fetched_at).getTime() < ttlMs) {
      return { tasks: cache.tasks, fetched_at: cache.fetched_at, stale: false };
    }
    // (b) fresh fetch.
    try {
      const tasks = await fetchFreshPending(listPendingTasksFn);
      const fetched_at = new Date(now()).toISOString();
      cache = { tasks, fetched_at };
      return { tasks, fetched_at, stale: false };
    } catch {
      // (c) ORCH-06: fail WITH cache → last-known-good LABELED stale. fetched_at is
      // ALWAYS the last success, NEVER now() (Pitfall 3 — no fresh-looking timestamp
      // on stale data).
      if (cache) return { tasks: cache.tasks, fetched_at: cache.fetched_at, stale: true };
      // (d) cold-start down: never succeeded → [] labeled stale, fetched_at null (D-04).
      return { tasks: [], fetched_at: null, stale: true };
    }
  }

  return { resolve };
}

/**
 * Shape the `/status` payload fields from a resolver result. Pure, stateless. Derives
 * `pending` and `pending_count` from the SAME `tasks` so they can never disagree
 * (Pitfall 4). Preserves the task shape verbatim (Assumption A1).
 *
 * @param {PendingResult} result
 * @returns {{ pending: PendingTask[], pending_count: number, pending_stale: boolean, pending_fetched_at: string|null }}
 */
export function buildPendingStatusFields({ tasks, fetched_at, stale }) {
  return {
    pending: tasks.map((t) => ({
      ref: t.ref,
      title: t.title,
      url: t.url,
      state: t.state,
      projectName: t.projectName,
    })),
    pending_count: tasks.length,
    pending_stale: stale,
    pending_fetched_at: fetched_at,
  };
}
