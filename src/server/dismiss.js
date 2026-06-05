// @ts-check
//
// src/server/dismiss.js — Phase 42 Plan 01 (DISMISS-01, DISMISS-04).
//
// Pure, dependency-injected handler for the destructive `DELETE /sessions/{id}`
// lane. Extracted out of server.js (mirroring Phase 40's provider-state.js
// precedent) because the HTTP handler has NO test harness (it needs network +
// state.json to boot) and the 409 TOCTOU guard / counter→actions[] translation /
// fix:true lock / never-throws collapse is the riskiest code of Phase 42 — so it
// lives in a unit-testable factory injected with mocks.
//
// THREE landmines locked here (RESEARCH 42-RESEARCH.md):
//   DRIFT #1 — doctor.execute returns AGGREGATE COUNTERS, not an actions[] array.
//              The D-06 body is SYNTHESIZED here via translateToActions().
//   DRIFT #2 — doctor.execute is a SILENT NO-OP without opts.fix (doctor.js:468).
//              We always call executeFn({}, {taskId, fix:true}).
//   Pitfall 6 — findSession does NOT key by task_id. The fresh 409 re-read uses
//              loadState().sessions[taskId] directly (the by-task_id key).
//
// We do NOT delete the state.json entry here — executeFn already archives the
// zombie entry to history (doctor.js:527); a second archive call would
// double-archive the same session (anti-pattern, RESEARCH §Anti-Patterns).
//
// LOG-12: the only event import is the explicit-whitelist helper from logger-events.

import { loadState as realLoadState } from '../session/state.js';
import { execute as realExecute } from '../gsd/doctor.js';
import { sessionDismissed } from '../logger-events.js';

/**
 * @typedef {import('../logger.js').Logger} Logger
 */

/**
 * @typedef {{
 *   worktrees: { removed: number, moved: number, pruned: number, skipped: number },
 *   zombies: { removed: number },
 *   locks: { stolen: number, kept: number },
 *   logs?: { unlinked: number },
 *   errors: Array<{ category: string, target: string, reason: string }>,
 * }} DoctorResult
 */

/**
 * @typedef {{ type: string, result: string }} DismissAction
 */

/**
 * Translate a DoctorResult counter object into the D-06 `actions[]` shape
 * `[{type, result}]`. Pure + byte-deterministic. (RESEARCH DRIFT #1.)
 *
 * Mapping (one action per NON-ZERO counter; one `error` action per errors[] entry):
 *   worktrees.removed > 0 → {worktree, removed}
 *   worktrees.moved   > 0 → {worktree, moved-dirty}   (fires DISMISS_PARTIAL_DIRTY)
 *   worktrees.pruned  > 0 → {worktree, pruned}
 *   worktrees.skipped     → NO action (session went live between re-checks — should
 *                           not occur after the 409; treat as a silent guard hit)
 *   zombies.removed   > 0 → {state, removed}
 *   locks.stolen      > 0 → {lock, removed}
 *   locks.kept        > 0 → {lock, kept}
 *   each errors[]         → {type:<error.category>, result:'error'}  (DISMISS_PARTIAL_WARN)
 *
 * @param {DoctorResult} result
 * @returns {DismissAction[]}
 */
export function translateToActions(result) {
  /** @type {DismissAction[]} */
  const actions = [];
  const wt = result.worktrees || { removed: 0, moved: 0, pruned: 0, skipped: 0 };
  const zombies = result.zombies || { removed: 0 };
  const locks = result.locks || { stolen: 0, kept: 0 };
  const errors = Array.isArray(result.errors) ? result.errors : [];

  if (wt.removed > 0) actions.push({ type: 'worktree', result: 'removed' });
  if (wt.moved > 0) actions.push({ type: 'worktree', result: 'moved-dirty' });
  if (wt.pruned > 0) actions.push({ type: 'worktree', result: 'pruned' });
  // wt.skipped intentionally emits NO action (guard hit, not a mutation).
  if (zombies.removed > 0) actions.push({ type: 'state', result: 'removed' });
  if (locks.stolen > 0) actions.push({ type: 'lock', result: 'removed' });
  if (locks.kept > 0) actions.push({ type: 'lock', result: 'kept' });
  for (const err of errors) {
    actions.push({ type: err.category, result: 'error' });
  }

  return actions;
}

/**
 * Create the dismiss handler. DI mirrors createProviderStateResolver: `loadState`
 * defaults to the real state reader, `executeFn` to doctor.execute, `logger` is
 * optional (the aggregate audit event is skipped when absent).
 *
 * @param {{
 *   loadState?: () => { sessions?: Record<string, { task_id?: string, alive?: boolean }> },
 *   executeFn?: (deps: object, opts: { taskId?: string, fix?: boolean }) => Promise<DoctorResult>,
 *   logger?: Logger,
 * }} [deps]
 */
export function createDismissHandler(deps = {}) {
  const loadState = deps.loadState || realLoadState;
  const executeFn = deps.executeFn || realExecute;
  const logger = deps.logger;

  /**
   * Dismiss a single dead session by task_id. Never throws — a thrown
   * loadState/executeFn collapses to a structured 500 response.
   *
   * @param {string} taskId
   * @returns {Promise<{ status: number, body: object }>}
   */
  return async function dismiss(taskId) {
    try {
      // D-07/D-08 (SC#3): re-read the FRESH alive by task_id — the authoritative
      // TOCTOU re-check. NOT findSession (Pitfall 6: it does not key by task_id).
      const state = loadState();
      const session = state && state.sessions ? state.sessions[taskId] : undefined;
      if (session && session.alive === true) {
        // The target revived between the client snapshot and the DELETE arriving.
        // Reject WITHOUT calling executeFn — never sanitize a live session.
        return { status: 409, body: { ok: false, error: 'alive' } };
      }

      // DRIFT #2: fix:true is MANDATORY or execute is a silent no-op. executeFn is
      // never-throws by design (Phase 41), but we still wrap to honor the contract.
      const result = await executeFn({}, { taskId, fix: true });
      const actions = translateToActions(result);

      if (logger) {
        sessionDismissed(logger, { task_id: taskId, actions_count: actions.length });
      }

      return { status: 200, body: { ok: true, removed: taskId, actions } };
    } catch (err) {
      // never-throws top-level: a thrown loadState/executeFn collapses to a
      // structured error response (mirror the provider-state fail-open discipline).
      const message = err && /** @type {any} */ (err).message
        ? /** @type {any} */ (err).message
        : String(err);
      return { status: 500, body: { ok: false, error: message } };
    }
  };
}
