// @ts-check
import { randomUUID } from 'node:crypto';
import { loadConfig, loadProjects } from '../config.js';
import { initRegistry, getProvider } from '../providers/registry.js';
import { parseKodoLabels } from '../labels.js';
import * as cmux from '../cmux/client.js';
import { colorForStatus } from '../cmux/colors.js';
import { addSession, listSessions } from './state.js';

/**
 * Build the session record saved to state from a resolved TaskItem.
 * Pure function — no I/O.
 *
 * @param {{
 *   task: import('../interface.js').TaskItem,
 *   providerName: string,
 *   projectPath: string,
 *   workspaceRef: string,
 *   sessionId: string,
 * }} params
 * @returns {import('./state.js').Session}
 */
export function buildSessionFromTask({ task, providerName, projectPath, workspaceRef, sessionId }) {
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
  };
}

/**
 * Resolve the local project path for a task.
 * Supports both flat strings and module-aware objects in projects map.
 * Pure function — accepts the projects map as argument.
 *
 * @param {import('../interface.js').TaskItem} task
 * @param {Record<string, string | {default?: string, modules?: Record<string, string>}>} projects
 * @returns {string}
 */
export function resolveProjectPath(task, projects) {
  const entry = projects[task.projectId];
  if (!entry) {
    throw new Error(
      `No local path mapped for project "${task.projectName || task.projectId}" (${task.projectId}). ` +
      `Run: kodo config --map-project`,
    );
  }

  // Flat string — legacy format, no module support
  if (typeof entry === 'string') return entry;

  // Object format — check module mapping first
  const moduleName = deriveModuleName(task);
  if (moduleName && entry.modules?.[moduleName]) {
    return entry.modules[moduleName];
  }

  // Fall back to default path
  if (entry.default) return entry.default;

  throw new Error(
    `No path for module "${moduleName || '(none)'}" in project "${task.projectName || task.projectId}". ` +
    `Run: kodo config to map modules.`,
  );
}

/**
 * Derive the module name from a TaskItem's groups array.
 * Pure function.
 *
 * @param {import('../interface.js').TaskItem} task
 * @returns {string|null}
 */
export function deriveModuleName(task) {
  return task.groups && task.groups.length > 0 ? task.groups[0] : null;
}

/**
 * Resolve a human ref into the launch context: task, project path, module,
 * labels, and derived model/flags. Does not touch cmux or state — returns
 * everything the caller needs to launch a session.
 *
 * @param {{
 *   provider: Pick<import('../interface.js').TaskProvider, 'init' | 'getTask'>,
 *   identifier: string,
 *   projects: Record<string, string>,
 * }} params
 */
export async function resolveTaskAndLaunchContext({ provider, identifier, projects }) {
  await provider.init();
  const task = await provider.getTask(identifier);

  const projectPath = resolveProjectPath(task, projects);
  const moduleName = deriveModuleName(task);

  // parseKodoLabels expects objects with .name — wrap string labels
  const { model, flags } = parseKodoLabels(task.labels.map((name) => ({ name })));

  return {
    task,
    projectPath,
    moduleName,
    description: task.description,
    model,
    flags,
  };
}

/**
 * Launch a Claude Code session for a provider-backed task.
 * @param {string} identifier e.g. "KL-42"
 * @param {{ model?: string|null, flags?: string[] }} [opts]
 */
export async function launchWorkItem(identifier, opts = {}) {
  const config = loadConfig();

  await initRegistry();
  const provider = getProvider(config.provider);

  // Check max parallel sessions
  const active = listSessions().filter((s) => s.status === 'running');
  if (active.length >= config.claude.max_parallel) {
    throw new Error(
      `Max parallel sessions (${config.claude.max_parallel}) reached. ` +
      `Active: ${active.map((s) => s.task_ref).join(', ')}`,
    );
  }

  // Resolve task + launch context via provider
  const projects = loadProjects();
  const {
    task,
    projectPath,
    moduleName,
    description,
    model: labelModel,
    flags: labelFlags,
  } = await resolveTaskAndLaunchContext({ provider, identifier, projects });

  // Create cmux workspace
  // Move task to "In Progress" in the provider
  try {
    const providerStates = config.providers?.[config.provider]?.states;
    if (providerStates?.trigger && task.state !== providerStates.trigger) {
      await provider.updateTaskState(task, providerStates.trigger);
      console.log(`[kodo] ${task.ref} → ${providerStates.trigger}`);
    }
  } catch (err) {
    console.error(`[kodo] Error moving to In Progress: ${err.message}`);
  }

  const prefix = moduleName ? `${task.ref} [${moduleName}]` : task.ref;
  const workspaceName = `${prefix}: ${truncate(task.title, 40)}`;
  const workspaceRef = await cmux.newWorkspace({
    name: workspaceName,
    cwd: projectPath,
  });

  // Set color to "running"
  await cmux.setColor({ workspace: workspaceRef, color: colorForStatus('running') });

  // Build Claude command — prefer opts overrides, fall back to label parsing
  const sessionId = randomUUID();
  const modelOverride = opts.model ?? labelModel;
  const combinedFlags = Array.from(new Set([...(opts.flags || []), ...labelFlags]));
  const claudeCmd = buildClaudeCommand(config, sessionId, task, description, modelOverride, combinedFlags, moduleName);

  // Send Claude command to workspace
  await cmux.send({ workspace: workspaceRef, text: claudeCmd });

  // Track session in state with generic task fields
  const session = buildSessionFromTask({
    task,
    providerName: config.provider,
    projectPath,
    workspaceRef,
    sessionId,
  });
  addSession(task.id, session);

  // Notify
  await cmux.notify({
    title: `kodo: ${task.ref}`,
    body: `Lanzada sesión para: ${task.title}`,
    workspace: workspaceRef,
  });

  // Notify orchestrator if running
  try {
    const workspaces = await cmux.listWorkspaces();
    const orchMatch = workspaces.match(/(workspace:\d+)\s+kodo-orchestrator/);
    if (orchMatch) {
      await cmux.send({
        workspace: orchMatch[1],
        text: `Nueva sesión lanzada: ${task.ref} (${task.title}) en ${workspaceRef}. Path: ${projectPath}\\n`,
      });
    }
  } catch {}

  return session;
}

/**
 * @param {ReturnType<import('../config.js').loadConfig>} config
 * @param {string} sessionId
 * @param {import('../interface.js').TaskItem} task
 * @param {string} description
 * @param {string|null|undefined} modelOverride
 * @param {string[]} [kodoFlags]
 * @param {string|null} [moduleName]
 */
function buildClaudeCommand(config, sessionId, task, description, modelOverride, kodoFlags = [], moduleName = null) {
  const model = modelOverride || config.claude.default_model;
  const moduleCtx = moduleName ? ` Módulo: ${moduleName}.` : '';
  const prompt = `Trabaja en: ${task.title}.${moduleCtx} ${description ? 'Descripción: ' + description : ''}`.trim();

  // Only add --dangerously-skip-permissions if kodo:yolo label is present
  const cliFlags = kodoFlags.includes('yolo') ? '--dangerously-skip-permissions' : '';

  return `claude --model ${model} --session-id ${sessionId} ${cliFlags} '${escapeShell(prompt)}'`.replace(/\s+/g, ' ').trim();
}

/** @param {string} str */
function escapeShell(str) {
  return str.replace(/'/g, "'\\''");
}

/**
 * @param {string} str
 * @param {number} max
 */
function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}
