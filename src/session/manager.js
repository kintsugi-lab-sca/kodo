// @ts-check
import { randomUUID } from 'node:crypto';
import { loadConfig, loadProjects } from '../config.js';
import { PlaneClient } from '../plane/client.js';
import * as cmux from '../cmux/client.js';
import { colorForStatus } from '../cmux/colors.js';
import { addSession, listSessions } from './state.js';

/**
 * Launch a Claude Code session for a Plane work item
 * @param {string} identifier e.g. "KL-42"
 * @param {{ model?: string|null, flags?: string[] }} [opts]
 */
export async function launchWorkItem(identifier, opts = {}) {
  const config = loadConfig();
  const plane = new PlaneClient();

  // Resolve identifier to project + work item
  const { project, workItem } = await plane.resolveIdentifier(identifier);

  // Check max parallel sessions
  const active = listSessions().filter((s) => s.status === 'running');
  if (active.length >= config.claude.max_parallel) {
    throw new Error(
      `Max parallel sessions (${config.claude.max_parallel}) reached. ` +
      `Active: ${active.map((s) => s.plane_identifier).join(', ')}`
    );
  }

  // Resolve local project path
  const projects = loadProjects();
  const projectPath = projects[project.id];
  if (!projectPath) {
    throw new Error(
      `No local path mapped for project "${project.name}" (${project.id}). ` +
      `Run: kodo config --map-project`
    );
  }

  // Resolve module name
  let moduleName = null;
  try {
    moduleName = await plane.getWorkItemModule(project.id, workItem.id);
  } catch {}

  // Create cmux workspace
  const prefix = moduleName ? `${identifier} [${moduleName}]` : identifier;
  const workspaceName = `${prefix}: ${truncate(workItem.name, 40)}`;
  const workspaceRef = await cmux.newWorkspace({
    name: workspaceName,
    cwd: projectPath,
  });

  // Set color to "running"
  await cmux.setColor({ workspace: workspaceRef, color: colorForStatus('running') });

  // Build Claude command
  const sessionId = randomUUID();
  const claudeCmd = buildClaudeCommand(config, sessionId, workItem, opts.model, opts.flags, moduleName);

  // Send Claude command to workspace
  await cmux.send({ workspace: workspaceRef, text: claudeCmd });

  // Track session in state
  const session = {
    workspace_ref: workspaceRef,
    session_id: sessionId,
    plane_id: workItem.id,
    plane_identifier: identifier,
    project_id: project.id,
    summary: workItem.name,
    status: /** @type {const} */ ('running'),
    started_at: new Date().toISOString(),
    project_path: projectPath,
  };
  addSession(workItem.id, session);

  // Notify
  await cmux.notify({
    title: `kodo: ${identifier}`,
    body: `Lanzada sesión para: ${workItem.name}`,
    workspace: workspaceRef,
  });

  // Notify orchestrator if running
  try {
    const workspaces = await cmux.listWorkspaces();
    const orchMatch = workspaces.match(/(workspace:\d+)\s+kodo-orchestrator/);
    if (orchMatch) {
      await cmux.send({
        workspace: orchMatch[1],
        text: `Nueva sesión lanzada: ${identifier} (${workItem.name}) en ${workspaceRef}. Path: ${projectPath}\\n`,
      });
    }
  } catch {}

  return session;
}

/**
 * @param {ReturnType<import('../config.js').loadConfig>} config
 * @param {string} sessionId
 * @param {object} workItem
 * @param {string|null} [modelOverride]
 * @param {string[]} [kodoFlags]
 * @param {string|null} [moduleName]
 */
function buildClaudeCommand(config, sessionId, workItem, modelOverride, kodoFlags = [], moduleName = null) {
  const model = modelOverride || config.claude.default_model;
  const moduleCtx = moduleName ? ` Módulo: ${moduleName}.` : '';
  const prompt = `Trabaja en: ${workItem.name}.${moduleCtx} ${workItem.description_html ? 'Descripción: ' + stripHtml(workItem.description_html) : ''}`.trim();

  // Only add --dangerously-skip-permissions if kodo:yolo label is present
  const cliFlags = kodoFlags.includes('yolo') ? '--dangerously-skip-permissions' : '';

  return `claude --model ${model} --session-id ${sessionId} ${cliFlags} '${escapeShell(prompt)}'`.replace(/\s+/g, ' ').trim();
}

/** @param {string} html */
function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
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
