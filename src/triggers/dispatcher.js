// @ts-check
import { getProvider } from '../providers/registry.js';
import { loadConfig } from '../config.js';
import { parseKodoLabels } from '../labels.js';
import { listSessions, removeSession } from '../session/state.js';
import { launchWorkItem } from '../session/manager.js';
import * as cmux from '../cmux/client.js';

/** In-flight dispatch locks keyed by task_id (prevents duplicate sessions from concurrent webhooks) */
const inFlight = new Set();

/**
 * @typedef {{
 *   getProviderFn?: (name?: string) => import('../interface.js').TaskProvider,
 *   launchWorkItemFn?: (ref: string, opts: object) => Promise<any>,
 *   listSessionsFn?: () => any[],
 *   listWorkspacesFn?: () => Promise<string>,
 *   removeSessionFn?: (id: string) => void,
 * }} DispatchDeps
 */

/**
 * Central dispatch function for all trigger sources.
 * Provider-agnostic: accepts a TriggerEvent and decides whether to launch,
 * ignore, or detect stale sessions.
 *
 * @param {import('../interface.js').TriggerEvent} event
 * @param {{ model?: string|null, flags?: string[], force?: boolean }} [opts]
 * @param {DispatchDeps} [deps] - Injectable dependencies for testing
 * @returns {Promise<{ action: 'launched'|'ignored'|'already_active'|'stale_relaunch'|'cleaned', session?: object }>}
 */
export async function dispatchTrigger(event, opts = {}, deps = {}) {
  const getProviderFn = deps.getProviderFn || ((name) => getProvider(name || event.provider));
  const launchWorkItemFn = deps.launchWorkItemFn || launchWorkItem;
  const listSessionsFn = deps.listSessionsFn || listSessions;
  const listWorkspacesFn = deps.listWorkspacesFn || (() => cmux.listWorkspaces());
  const removeSessionFn = deps.removeSessionFn || removeSession;

  // 1. Resolve task via provider
  const provider = getProviderFn(event.provider);
  console.log(`[kodo:dispatch] Resolving taskRef: ${event.taskRef}`);
  const task = await provider.getTask(event.taskRef);
  console.log(`[kodo:dispatch] Task: ${task.ref} — labels: [${task.labels.join(', ')}]`);

  // 2. Check kodo labels (skip if force=true)
  if (!opts.force) {
    const kodoConfig = parseKodoLabels(task.labels.map((name) => ({ name })));
    console.log(`[kodo:dispatch] isKodo: ${kodoConfig.isKodo}, model: ${kodoConfig.model}`);
    if (!kodoConfig.isKodo) {
      console.log(`[kodo:dispatch] Ignored — no kodo label`);
      return { action: 'ignored' };
    }
  }

  // Parse labels for model/flags regardless of force (needed for launch opts)
  const kodoConfig = parseKodoLabels(task.labels.map((name) => ({ name })));

  // 2b. Handle terminal states — clean up session if task moved to Done/Cancelled
  if (task.state) {
    const config = loadConfig();
    const providerStates = config.providers?.[event.provider]?.states || {};
    const terminalStates = [providerStates.done, 'Cancelled'].filter(Boolean);
    if (terminalStates.some((s) => s.toLowerCase() === task.state.toLowerCase())) {
      const existing = listSessionsFn().find((s) => s.task_id === task.id);
      if (existing) {
        removeSessionFn(task.id);
        console.log(`[kodo:dispatch] Cleaned session for ${task.ref} — moved to "${task.state}"`);
        return { action: 'cleaned' };
      }
      console.log(`[kodo:dispatch] Ignored — state "${task.state}" is terminal`);
      return { action: 'ignored' };
    }

    // Ignore inactive states (skip if force=true)
    // Default: Backlog + configured review state (human turn, no re-dispatch)
    if (!opts.force) {
      const defaultIgnore = ['Backlog'];
      if (providerStates.review) defaultIgnore.push(providerStates.review);
      const ignoreStates = providerStates.ignore || defaultIgnore;
      if (ignoreStates.some((s) => s.toLowerCase() === task.state.toLowerCase())) {
        console.log(`[kodo:dispatch] Ignored — state "${task.state}" is inactive`);
        return { action: 'ignored' };
      }
    }
  }

  // 3. In-flight guard — prevents duplicate dispatches for the same task
  //    when webhooks arrive in rapid succession (state.json is written
  //    only after launchWorkItem finishes, which can take seconds).
  if (inFlight.has(task.id)) {
    console.log(`[kodo:dispatch] Ignored — ${task.ref} already dispatching`);
    return { action: 'already_active' };
  }

  // 4. Session-already-active guard (checks persisted state)
  const active = listSessionsFn();
  const existing = active.find((s) => s.task_id === task.id);

  if (existing) {
    try {
      const workspaces = await listWorkspacesFn();
      if (workspaces.includes(existing.workspace_ref)) {
        return { action: 'already_active' };
      }
      // Workspace gone - clean up stale session
      removeSessionFn(task.id);
    } catch {
      removeSessionFn(task.id);
    }

    // Relaunch after stale cleanup
    inFlight.add(task.id);
    try {
      const launchOpts = {
        model: opts.model ?? kodoConfig.model,
        flags: [...(opts.flags || []), ...kodoConfig.flags],
      };
      const session = await launchWorkItemFn(event.taskRef, launchOpts);
      return { action: 'stale_relaunch', session };
    } finally {
      inFlight.delete(task.id);
    }
  }

  // 5. Launch
  inFlight.add(task.id);
  try {
    const launchOpts = {
      model: opts.model ?? kodoConfig.model,
      flags: [...(opts.flags || []), ...kodoConfig.flags],
    };
    const session = await launchWorkItemFn(event.taskRef, launchOpts);
    return { action: 'launched', session };
  } finally {
    inFlight.delete(task.id);
  }
}
