// @ts-check
//
// src/integration/queue.js — KODO-26: the integration queue store.
//
// The problem it solves: every session ends up asking for something different (ff, merge, PR,
// review the diff) and today that travels ONLY in the ephemeral nudge from the Stop hook. If the operator does not
// act right then, "what does this branch need" is lost and they end up reviewing session by
// session from memory. The queue persists that question alongside the rest of the state, so the
// orchestrator can read it in one block on every round.
//
// ADDITIVE KEY `state.integration_queue` (array), same idiom as `tasks` (Phase 74 D-05) and
// `orchestrator` (KODO-16): no `schema_version` bump, and every reader uses the
// defensive guard `Array.isArray(state.integration_queue) ? … : []` — a state.json predating this
// phase reads as an empty queue.
//
// INVARIANTS:
//   - EVERY write goes through `withStateLock` (cross-milestone invariant, STATE.md:171).
//     This module NEVER calls `saveState` on its own and never writes state.json by hand.
//   - An entry is NEVER deleted when resolved: `--ff`, `--merge`, `--pr` and `--drop`
//     TRANSITION it (`status` + `action` + `outcome` + `sha`). Same pattern as the inbox
//     (CAPT-03): the permanent trace IS the feature.
//   - An entry belongs to ONE repo: the branch lives in `project_path`. Nothing cross-repo — an
//     entry's identity is the pair (project_path, branch), not the task_ref alone.
//   - This module does NOT call git and does NOT import `logger.js` (it receives the logger as a
//     parameter, defaulting to the noop, like the rest of `state.js`'s mutators).

import { noopLogger } from '../logger-noop.js';
import { loadState, withStateLock } from '../session/state.js';

/**
 * One integration-queue entry.
 *
 * The 17 keys are ALWAYS present and in THIS order, with `null` where not applicable. It is not
 * cosmetic: `kodo integrate --json` serialises the entry as-is, and the byte-determinism of
 * `--json` is a repo invariant (DX-06). A key appearing "only when there is a value"
 * would break the contract's byte-for-byte comparison.
 *
 * @typedef {{
 *   task_ref: string,              // Human task reference ("KODO-26"). The CLI's primary selector.
 *   task_id: string|null,          // Task UUID in the provider, when the session carried it.
 *   project_path: string,          // Repo where the branch lives. The entry belongs to ONE repo — nothing cross-repo.
 *   branch: string,                // Branch holding the unintegrated work.
 *   base_branch: string|null,      // Resolved base branch (origin/HEAD → main → master), or null if it could not be resolved.
 *   commits_ahead: number|null,    // Commits living only in `branch` (KODO-21's count). null = not verifiable.
 *   base_ok: boolean|null,         // Does `branch` contain the whole base? null = not verifiable. Only `true` enables ff.
 *   files_changed: number|null,    // Files touched with respect to the base. null = diff not inspectable.
 *   lines_changed: number|null,    // insertions + deletions. null = diff not inspectable.
 *   suggested: 'ff'|'merge'|'pr'|'review',  // `suggestTier`'s suggestion. NOT a decision.
 *   status: 'pending'|'done'|'dropped',     // 'pending' until `kodo integrate` resolves it.
 *   created_at: string,            // ISO 8601 of the session close that enqueued it.
 *   updated_at: string,            // ISO 8601 of the last rewrite (re-capture of the same branch).
 *   action: 'ff'|'merge'|'pr'|'drop'|null,  // What the operator executed. null while pending.
 *   sha: string|null,              // SHA resulting from the merge. null on --pr, on --drop and on failures.
 *   outcome: string|null,          // Short, greppable result ('merged', 'prepared', 'dropped', 'precondition-failed'…).
 *   resolved_at: string|null,      // ISO 8601 of the resolution. null while pending.
 * }} IntegrationEntry
 */

/**
 * Cap of RESOLVED entries kept in state.json (FIFO, the oldest are evicted).
 * `pending` ones do NOT count and are NEVER evicted: the pending queue is the work, and
 * losing work to size pressure would be exactly the failure this phase avoids.
 *
 * Why the cap exists, if "an entry is never deleted": the PERMANENT trace of every action
 * is the `integrate.action` NDJSON event in `~/.kodo/logs/` (a deterministic, append-only record
 * of what was executed). The state.json block is the recent window the dashboard and the
 * orchestrator read on every tick — an unbounded array would grow without limit and make
 * every TUI read more expensive. Same reasoning and same number as the `history` cap
 * (`state.js:365`).
 */
export const RESOLVED_CAP = 50;

/**
 * An entry's identity: the pair (project_path, branch). NOT the task_ref — one task
 * can touch two repos in two sessions, and two different tasks do not share a branch.
 *
 * The separator is `\u0000` (NUL): the ONLY byte that cannot appear in a POSIX path or
 * in a git branch name, so the concatenation is injective. A space would not do —
 * macOS paths often carry one (`~/Library/Application Support/…`).
 *
 * @param {{ project_path?: string, branch?: string }} e
 * @returns {string}
 */
function entryKey(e) {
  return `${e.project_path ?? ''}\u0000${e.branch ?? ''}`;
}

/**
 * Defensive read of the queue block from an already-loaded state.
 * @param {any} state
 * @returns {IntegrationEntry[]}
 */
function queueOf(state) {
  return Array.isArray(state?.integration_queue) ? state.integration_queue : [];
}

/**
 * Builds a COMPLETE entry (17 keys, fixed order) from the capture input.
 * Pure — it touches neither disk nor clock beyond the injected `now`.
 *
 * @param {{
 *   task_ref: string, task_id?: string|null, project_path: string, branch: string,
 *   base_branch?: string|null, commits_ahead?: number|null, base_ok?: boolean|null,
 *   files_changed?: number|null, lines_changed?: number|null,
 *   suggested: 'ff'|'merge'|'pr'|'review',
 * }} input
 * @param {string} ts ISO 8601
 * @returns {IntegrationEntry}
 */
function buildEntry(input, ts) {
  return {
    task_ref: input.task_ref,
    task_id: input.task_id ?? null,
    project_path: input.project_path,
    branch: input.branch,
    base_branch: input.base_branch ?? null,
    commits_ahead: input.commits_ahead ?? null,
    base_ok: input.base_ok ?? null,
    files_changed: input.files_changed ?? null,
    lines_changed: input.lines_changed ?? null,
    suggested: input.suggested,
    status: 'pending',
    created_at: ts,
    updated_at: ts,
    action: null,
    sha: null,
    outcome: null,
    resolved_at: null,
  };
}

/**
 * Enqueues (or REFRESHES) a branch's integration need.
 *
 * Dedupe by identity (project_path, branch) against `pending` entries: the second session
 * closing over the SAME branch does not create a new row — it updates the existing one with a
 * fresh count, base and suggestion, preserving `created_at` (the age of the
 * wait, which is exactly what the operator wants to see) and refreshing `updated_at`.
 *
 * An ALREADY RESOLVED entry does not block re-enqueuing: if the branch accumulates commits again after
 * a merge, that is a NEW need and deserves its own row (the resolved one stays as a
 * trace).
 *
 * @param {{
 *   task_ref: string, task_id?: string|null, project_path: string, branch: string,
 *   base_branch?: string|null, commits_ahead?: number|null, base_ok?: boolean|null,
 *   files_changed?: number|null, lines_changed?: number|null,
 *   suggested: 'ff'|'merge'|'pr'|'review',
 * }} input
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @param {{ now?: () => Date }} [deps]
 * @returns {{ ok: true, value: { entry: IntegrationEntry, deduped: boolean } } | { ok: false, reason: 'lock-timeout' }}
 */
export function enqueueIntegration(input, logger = noopLogger, deps = {}) {
  const ts = (deps.now ? deps.now() : new Date()).toISOString();
  /** @type {IntegrationEntry|undefined} */
  let persisted;
  let deduped = false;

  const r = withStateLock((state) => {
    // Defensive guard for the additive key — mirror of `if (!state.tasks) state.tasks = {}`
    // (state.js:459). A state.json predating KODO-26 does not carry it.
    if (!Array.isArray(/** @type {any} */ (state).integration_queue)) {
      /** @type {any} */ (state).integration_queue = [];
    }
    const queue = /** @type {IntegrationEntry[]} */ (/** @type {any} */ (state).integration_queue);
    const key = entryKey(input);
    const prev = queue.find((e) => e.status === 'pending' && entryKey(e) === key);

    if (prev) {
      deduped = true;
      // IN-PLACE refresh. `created_at` is preserved on purpose: the entry's age measures
      // how long this branch has been waiting for integration, not when the last session closed.
      prev.task_ref = input.task_ref;
      prev.task_id = input.task_id ?? prev.task_id ?? null;
      prev.base_branch = input.base_branch ?? null;
      prev.commits_ahead = input.commits_ahead ?? null;
      prev.base_ok = input.base_ok ?? null;
      prev.files_changed = input.files_changed ?? null;
      prev.lines_changed = input.lines_changed ?? null;
      prev.suggested = input.suggested;
      prev.updated_at = ts;
      persisted = prev;
    } else {
      persisted = buildEntry(input, ts);
      queue.push(persisted);
    }

    pruneResolved(queue);
  });

  if (!r.ok) {
    logger.warn('integration.queue.enqueue_failed', { task_ref: input.task_ref, reason: r.reason });
    return r;
  }
  logger.info('integration.queue.enqueued', {
    task_ref: input.task_ref,
    branch: input.branch,
    suggested: input.suggested,
    deduped,
  });
  return { ok: true, value: { entry: /** @type {IntegrationEntry} */ (persisted), deduped } };
}

/**
 * Evicts the oldest resolved entries above `RESOLVED_CAP`. MUTATES the array in
 * place (it runs inside the lock's mutator). `pending` ones are always preserved, whatever
 * their age.
 *
 * @param {IntegrationEntry[]} queue
 */
function pruneResolved(queue) {
  const resolved = queue.filter((e) => e.status !== 'pending');
  if (resolved.length <= RESOLVED_CAP) return;
  // The array is in insertion order, so the first resolved ones are the oldest.
  const drop = new Set(resolved.slice(0, resolved.length - RESOLVED_CAP));
  for (let i = queue.length - 1; i >= 0; i--) {
    if (drop.has(queue[i])) queue.splice(i, 1);
  }
}

/**
 * Marks an entry as resolved. It does NOT delete it (trace).
 *
 * The selector is the same one the CLI exposes: exact `task_ref` or, failing that, exact branch
 * name — so a branch whose task you cannot remember can still be resolved. It only matches
 * `pending` entries; an already-resolved entry returns `not-found` (idempotence towards the operator: the
 * second run does not rewrite a closed trace).
 *
 * @param {string} ref task_ref or branch name.
 * @param {{
 *   action: 'ff'|'merge'|'pr'|'drop',
 *   status?: 'done'|'dropped',
 *   sha?: string|null,
 *   outcome: string,
 * }} patch
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @param {{ now?: () => Date }} [deps]
 * @returns {{ ok: true, value: IntegrationEntry } | { ok: false, reason: 'lock-timeout'|'not-found' }}
 */
export function resolveIntegration(ref, patch, logger = noopLogger, deps = {}) {
  const ts = (deps.now ? deps.now() : new Date()).toISOString();
  /** @type {IntegrationEntry|undefined} */
  let persisted;
  let found = false;

  const r = withStateLock((state) => {
    const queue = queueOf(state);
    const hit = queue.find((e) => e.status === 'pending' && (e.task_ref === ref || e.branch === ref));
    if (!hit) return;
    found = true;
    hit.status = patch.status ?? (patch.action === 'drop' ? 'dropped' : 'done');
    hit.action = patch.action;
    hit.sha = patch.sha ?? null;
    hit.outcome = patch.outcome;
    hit.resolved_at = ts;
    hit.updated_at = ts;
    persisted = hit;
    // Pruning goes in BOTH writers, and above all in this one: resolving is the only thing that CREATES
    // resolved entries. Pruning only on enqueue left the array one entry above the cap
    // until the next session close — a bound that holds "almost always" is not a bound.
    pruneResolved(queue);
  });

  if (!r.ok) {
    logger.warn('integration.queue.resolve_failed', { ref, reason: r.reason });
    return r;
  }
  if (!found) return { ok: false, reason: 'not-found' };
  logger.info('integration.queue.resolved', {
    ref,
    action: patch.action,
    outcome: patch.outcome,
  });
  return { ok: true, value: /** @type {IntegrationEntry} */ (persisted) };
}

/**
 * Lists the queue. Pure read — it never writes.
 *
 * @param {{ all?: boolean }} [opts] `all: true` includes resolved ones (trace). Default: `pending` only.
 * @param {{ loadStateFn?: typeof loadState }} [deps]
 * @returns {IntegrationEntry[]} In insertion order (oldest first).
 */
export function listIntegrationQueue(opts = {}, deps = {}) {
  const load = deps.loadStateFn || loadState;
  let queue;
  try {
    queue = queueOf(load());
  } catch {
    return []; // never-throws: an unreadable queue is indistinguishable from an empty one.
  }
  return opts.all === true ? queue.slice() : queue.filter((e) => e.status === 'pending');
}

/**
 * Finds ONE pending entry by task_ref or by branch name (same selector as
 * `resolveIntegration`). Pure read — the CLI uses it to know which repo and which branch it is going to
 * operate on BEFORE touching git.
 *
 * @param {string} ref
 * @param {{ loadStateFn?: typeof loadState }} [deps]
 * @returns {IntegrationEntry|null}
 */
export function findPendingIntegration(ref, deps = {}) {
  const pending = listIntegrationQueue({}, deps);
  return pending.find((e) => e.task_ref === ref) || pending.find((e) => e.branch === ref) || null;
}
