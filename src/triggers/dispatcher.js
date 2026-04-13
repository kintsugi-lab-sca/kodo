// @ts-check
import { getProvider } from '../providers/registry.js';
import { parseKodoLabels } from '../labels.js';
import { listSessions, removeSession } from '../session/state.js';
import { launchWorkItem } from '../session/manager.js';
import * as cmux from '../cmux/client.js';

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
 * @returns {Promise<{ action: 'launched'|'ignored'|'already_active'|'stale_relaunch', session?: object }>}
 */
export async function dispatchTrigger(event, opts = {}, deps = {}) {
  const getProviderFn = deps.getProviderFn || ((name) => getProvider(name || event.provider));
  const launchWorkItemFn = deps.launchWorkItemFn || launchWorkItem;
  const listSessionsFn = deps.listSessionsFn || listSessions;
  const listWorkspacesFn = deps.listWorkspacesFn || (() => cmux.listWorkspaces());
  const removeSessionFn = deps.removeSessionFn || removeSession;

  // 1. Resolve task via provider
  const provider = getProviderFn(event.provider);
  const task = await provider.getTask(event.taskRef);

  // 2. Check kodo labels (skip if force=true)
  if (!opts.force) {
    const kodoConfig = parseKodoLabels(task.labels.map((name) => ({ name })));
    if (!kodoConfig.isKodo) {
      return { action: 'ignored' };
    }
  }

  // Parse labels for model/flags regardless of force (needed for launch opts)
  const kodoConfig = parseKodoLabels(task.labels.map((name) => ({ name })));

  // 3. Session-already-active guard
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
    const launchOpts = {
      model: opts.model ?? kodoConfig.model,
      flags: [...(opts.flags || []), ...kodoConfig.flags],
    };
    const session = await launchWorkItemFn(event.taskRef, launchOpts);
    return { action: 'stale_relaunch', session };
  }

  // 4. Launch
  const launchOpts = {
    model: opts.model ?? kodoConfig.model,
    flags: [...(opts.flags || []), ...kodoConfig.flags],
  };
  const session = await launchWorkItemFn(event.taskRef, launchOpts);
  return { action: 'launched', session };
}
