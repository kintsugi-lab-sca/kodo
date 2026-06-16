// @ts-check
//
// src/adopt.js — Phase 53 Plan 02. The deterministic, 0-token adoption core:
// the exact inverse of `manager.launchWorkItem` minus the cmux branch. Three
// pure-or-orchestrating functions, provider-agnostic and host-agnostic:
//
//   - adoptSession            (async orchestrator; ALL I/O; 5-state never-throws
//                              discriminant — never throws)
//   - buildSessionFromAdoption (pure SessionRecord builder; mirrors
//                              buildSessionFromTask but OMITS reconcile-owned
//                              and GSD fields)
//   - sanitizeAdoptionData    (pure backstop; strips abs paths, redacts home,
//                              defaults the title; structurally cannot forward a
//                              transcript)
//
// CRITICAL host-isolation invariant: this module imports ONLY src/session/state.js
// + node: builtins. It NEVER imports cmux, host, or logger.js (LOG-12 /
// cmux-isolation walkers would fail). It receives workspaceRef/cwd/sessionId/
// projectId/projectPath as resolved DATA — it calls no LLM, no listProjects, no
// cmux. The three future consumers (CLI Phase 54, dashboard key Phase 56,
// orchestrator Phase 57) reuse this base without owning it.

import { findSession, addSession } from './session/state.js';
import { basename } from 'node:path';
import { homedir } from 'node:os';

/**
 * Redact a string for export to an external task manager (BIDIR-08 / D-06):
 *   1. Replace any occurrence of the home directory with '~'.
 *   2. Strip/redact remaining POSIX absolute-path segments to '<path>'.
 *
 * Conservative by construction: it only touches `/`-rooted path-like runs, so
 * ordinary prose survives. Pure — operates on the passed string only.
 *
 * @param {string} str
 * @param {string} home
 * @returns {string}
 */
function redactPaths(str, home) {
  let out = str;
  // (1) Home redaction — longest-prefix first so '~' lands before the generic
  // abs-path strip can touch the home-rooted segment.
  if (home) {
    out = out.split(home).join('~');
  }
  // (2) Strip remaining POSIX absolute paths: a leading '/' followed by at least
  // one path segment (no whitespace). Redacted to a literal placeholder so no
  // local filesystem layout crosses to the external system. Conservative — the
  // negative lookbehind excludes:
  //   - '\w' / ':' / '/'  → URL paths (http(s)://…) and mid-word slashes,
  //   - '~'               → the home dir we just redacted in step (1): '~/secret'
  //                         must survive as a home-relative tail, not be stripped,
  //   - '.'               → './x' and '../x' relative paths.
  out = out.replace(/(?<![\w:/~.])\/[^\s/]+(?:\/[^\s]*)?/g, '<path>');
  return out;
}

/**
 * Pure backstop sanitizer applied BEFORE the createTask POST. Defends the
 * local→external trust boundary even if a downstream consumer (e.g. the Phase 57
 * orchestrator) forgets to sanitize.
 *
 * Structural transcript guarantee (T-53-04): there is NO transcript parameter —
 * the function cannot forward a transcript body because it never accepts one.
 *
 * @param {{ cwd: string, title?: string, description?: string }} input
 * @param {() => string} [homedirFn] injected for testability (mirror dashboard/plan.js)
 * @returns {{ title: string, description?: string }}
 */
export function sanitizeAdoptionData({ cwd, title, description }, homedirFn = homedir) {
  const home = homedirFn();
  // D-04 single source of truth: title defaults to basename(cwd) when omitted.
  const rawTitle = title ?? basename(cwd);
  return {
    title: redactPaths(rawTitle, home),
    description: description === undefined ? undefined : redactPaths(description, home),
  };
}

/**
 * Pure SessionRecord builder mirroring `buildSessionFromTask` (manager.js:37-49)
 * field-for-field, but OMITTING:
 *   - reconcile-owned (invariant — reconcileTick is the sole writer):
 *     dead_since, last_seen_alive, alive, tab_alive, process_alive, needs_input, state
 *   - GSD-only (adoption takes no flags/phaseId/brief):
 *     gsd, gsd_mode, phase_id, brief, worktree_path
 *
 * Produces exactly the 12 fields the seeded state.json row carries. `cwd` is
 * accepted for parity with the orchestrator signature but the persisted path is
 * `projectPath` (the guard keys on project_path).
 *
 * @param {{
 *   task: import('./interface.js').TaskItem,
 *   providerName: string,
 *   workspaceRef: string,
 *   cwd: string,
 *   sessionId: string,
 *   projectPath: string,
 * }} params
 * @returns {import('./session/state.js').Session}
 */
export function buildSessionFromAdoption({ task, providerName, workspaceRef, cwd, sessionId, projectPath }) {
  return {
    workspace_ref: workspaceRef,
    session_id: sessionId,
    task_id: task.id,
    task_ref: task.ref,
    provider: providerName,
    project_id: task.projectId,
    summary: task.title,
    status: /** @type {const} */ ('running'),
    started_at: new Date().toISOString(),
    project_path: projectPath,
    task_url: task.url,
    project_name: task.projectName,
  };
}

/**
 * Async orchestrator. The exact inverse of `manager.launchWorkItem` minus the
 * cmux branch. Returns the 5-state never-throws discriminant:
 *
 *   { ok:true, task, session }
 *   { ok:false, code:'UNSUPPORTED',      detail:{ providerName } }
 *   { ok:false, code:'ALREADY_ADOPTED',  detail:{ task_id } }
 *   { ok:false, code:'CREATE_FAILED',    detail:{ message } }
 *   { ok:false, code:'PERSIST_FAILED',   detail:{ task_id, task_url, hint, message } }
 *
 * Order: typeof-gate → sanitize → guard (findSession, fresh read) →
 * createTask (try/catch → CREATE_FAILED) → buildSessionFromAdoption →
 * addSession (try/catch → PERSIST_FAILED) → ok. The ONLY try/catch-to-code
 * conversions are around createTask and addSession; nothing else throws.
 *
 * @param {{
 *   provider: { createTask?: Function },
 *   providerName: string,
 *   workspaceRef: string,
 *   cwd: string,
 *   sessionId: string,
 *   projectId: string,
 *   projectPath: string,
 *   title?: string,
 *   description?: string,
 * }} args
 * @param {{ addSession?: Function, findSession?: Function }} [deps]
 *        DI — defaults to the real state.js imports; tests inject a throwing
 *        addSession (PERSIST_FAILED) without making the real state.json unwritable.
 * @returns {Promise<object>}
 */
export async function adoptSession(
  { provider, providerName, workspaceRef, cwd, sessionId, projectId, projectPath, title, description },
  deps = {},
) {
  const addSessionFn = deps.addSession || addSession;
  const findSessionFn = deps.findSession || findSession;

  // (a) Capability gate (BIDIR-03). typeof-detected — createTask lives OUTSIDE
  // the FROZEN-9 contract. POST is never reached when absent.
  if (typeof provider.createTask !== 'function') {
    return { ok: false, code: 'UNSUPPORTED', detail: { providerName } };
  }

  // (b) Sanitize BEFORE the POST (BIDIR-08 / D-06 backstop).
  const clean = sanitizeAdoptionData({ cwd, title, description });

  // (c) Idempotency guard (BIDIR-04 / D-04). findSession() calls loadState()
  // internally — this IS the fresh read immediately before the POST (no separate
  // loadState). Keyed by workspaceRef→workspace_ref and cwd→project_path
  // (Pitfall 1/6: findSession does NOT key by task_id, which doesn't exist yet).
  const existing = findSessionFn({ workspaceRef, cwd });
  if (existing) {
    return { ok: false, code: 'ALREADY_ADOPTED', detail: { task_id: existing.session.task_id } };
  }

  // (d) createTask — the first and only network POST. The 201 round-trips to a
  // canonical TaskItem (Phase 52 D-06); do NOT re-normalize. Throws LOUD on
  // non-ok (Phase 52 D-08) — caught here and converted to CREATE_FAILED.
  let task;
  try {
    task = await provider.createTask({ projectId, title: clean.title, description: clean.description });
  } catch (err) {
    return { ok: false, code: 'CREATE_FAILED', detail: { message: err?.message ?? String(err) } };
  }

  // (e) Build the seeded row (pure; omits reconcile-owned + GSD fields).
  const session = buildSessionFromAdoption({ task, providerName, workspaceRef, cwd, sessionId, projectPath });

  // (f) Local write LAST (atomic via the Plan 53-01 tmp+rename saveState). A
  // throw here means a created provider task with no local row — the orphan
  // window (T-53-05). Convert to a LOUD PERSIST_FAILED carrying the orphan
  // coordinates (task_id + task_url) so the consumer can recover by idempotent
  // re-run; NEVER swallow, NEVER throw (BIDIR-05 / D-03 / Pitfall 3).
  try {
    addSessionFn(task.id, session);
  } catch (err) {
    return {
      ok: false,
      code: 'PERSIST_FAILED',
      detail: {
        task_id: task.id,
        task_url: task.url,
        hint: 'recoverable via idempotent re-run',
        message: err?.message ?? String(err),
      },
    };
  }

  // (g) Success.
  return { ok: true, task, session };
}
