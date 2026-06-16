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
  // (1) Home redaction at a PATH-SEGMENT boundary (CR-01). Naive
  // `split(home).join('~')` corrupts a superset username: home '/Users/alex'
  // applied to '/Users/alexandra/x' would emit '~andra/x' (partial leak +
  // nonsense path). Anchoring the replacement on end-of-string / '/' / whitespace
  // ensures home only matches when it ends at a real segment boundary. Regex
  // metachars in `home` are escaped. Falsy/empty `home` is skipped safely.
  if (home) {
    const esc = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc + '(?=$|/|\\s)', 'g'), '~');
  }
  // (2) Strip remaining absolute-path runs to '<path>' (CR-01). Single pass over
  // two alternatives, URL FIRST so it consumes 'scheme://host…' before the path
  // alternative can bite into it:
  //   - <url>  : a genuine 'scheme://host…' URL → re-emitted UNTOUCHED (spared).
  //   - <path> : a '/'-rooted run (one OR two leading slashes) → redacted.
  // The leading-boundary group anchors on start | whitespace | one of ([{=, OR a
  // single ':' — so the previously-leaking shapes are now caught:
  //   - '//etc/secret'        (double-slash, no scheme)        → '<path>'
  //   - 'key:/Users/bob/x'    (single slash after a bare ':')  → 'key:<path>'
  //   - '/Users/alexandra/x'  (superset username, see step 1)  → '<path>'
  // while './x', '../x', '~/x' and mid-word 'a/b' never start at a boundary
  // immediately followed by '/' and therefore survive.
  out = out.replace(
    /(?<lead>^|[\s([{=,:])(?:(?<url>[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]*)|(?<path>\/{1,2}[^\s/]+(?:\/[^\s]*)?))/g,
    (m, lead, url) => (url !== undefined ? m : lead + '<path>'),
  );
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
 *   { ok:false, code:'INVALID_INPUT',    detail:{ missing } }
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

  // (a) Capability gate (BIDIR-03 / WR-03). typeof-detected — createTask lives
  // OUTSIDE the FROZEN-9 contract. Guard a null/undefined provider FIRST so the
  // typeof read cannot throw (never-throws contract). POST is never reached when
  // createTask is absent.
  if (!provider || typeof provider.createTask !== 'function') {
    return { ok: false, code: 'UNSUPPORTED', detail: { providerName } };
  }

  // (a2) Required-input guard (WR-03). The pre-POST steps run OUTSIDE try/catch
  // and would throw on hostile inputs (e.g. basename(undefined)). Validate the
  // required string args at the entry and return a discriminant rather than
  // throwing, preserving the never-throws contract.
  const missing = [];
  for (const [name, value] of [
    ['cwd', cwd],
    ['workspaceRef', workspaceRef],
    ['sessionId', sessionId],
    ['projectPath', projectPath],
    ['projectId', projectId],
  ]) {
    if (typeof value !== 'string' || value.length === 0) missing.push(name);
  }
  if (missing.length > 0) {
    return { ok: false, code: 'INVALID_INPUT', detail: { missing } };
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
