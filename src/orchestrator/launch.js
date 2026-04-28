// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { listSessions } from '../session/state.js';
import * as cmux from '../cmux/client.js';
import { getSessionMode } from '../labels.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, 'prompt.md');
const ORCHESTRATOR_WORKSPACE_NAME = 'kodo-orchestrator';

/**
 * Resolve {{placeholder}} tokens in the orchestrator prompt template.
 *
 * @param {string} template  Raw prompt.md content
 * @param {{ provider: string }} config  Active provider config
 * @returns {string} Prompt with all placeholders replaced
 */
export function resolvePromptTemplate(template, config) {
  const providerName = config.provider.charAt(0).toUpperCase() + config.provider.slice(1);
  const mcpTool = `${providerName} MCP server`;

  return template
    .replaceAll('{{provider_name}}', providerName)
    .replaceAll('{{provider}}', config.provider)
    .replaceAll('{{mcp_tool}}', mcpTool);
}

/**
 * Launch the orchestrator Claude session in a dedicated cmux workspace.
 *
 * @param {{ logger?: import('../logger.js').Logger }} [opts]
 */
export async function launchOrchestrator(opts = {}) {
  const config = loadConfig();
  const log = opts.logger?.child({ component: 'orchestrator' });
  log?.info('orchestrator.launch.start', { provider: config.provider });

  // Check if orchestrator is already running
  let workspaceList;
  try {
    workspaceList = await cmux.listWorkspaces();
  } catch {
    workspaceList = '';
  }

  if (workspaceList.includes(ORCHESTRATOR_WORKSPACE_NAME)) {
    console.log('[kodo] Orchestrator workspace already exists');
    // Send a nudge to refresh
    const match = workspaceList.match(/(workspace:\d+)\s+kodo-orchestrator/);
    if (match) {
      await cmux.send({ workspace: match[1], text: 'Revisa el estado actual de las sesiones y tareas pendientes.\\n' });
      console.log('[kodo] Sent refresh nudge to existing orchestrator');
      return { workspace: match[1], existing: true };
    }
  }

  // Build context summary
  const sessions = listSessions();
  const contextSummary = buildContextSummary(sessions, config);

  // Read orchestrator prompt and resolve provider placeholders
  const rawPrompt = readFileSync(PROMPT_PATH, 'utf-8');
  const basePrompt = resolvePromptTemplate(rawPrompt, { provider: config.provider || 'plane' });

  // Create workspace
  const workspaceRef = await cmux.newWorkspace({
    name: ORCHESTRATOR_WORKSPACE_NAME,
    cwd: process.cwd(),
  });

  // Set orchestrator color (Indigo)
  await cmux.setColor({ workspace: workspaceRef, color: 'Indigo' });

  // Build Claude command with orchestrator prompt + context
  const sessionId = randomUUID();
  const prompt = `${basePrompt}\n\n## Situación actual\n\n${contextSummary}`;
  const escapedPrompt = prompt.replace(/'/g, "'\\''");

  const claudeCmd = [
    'claude',
    '--model', config.claude.default_model,
    '--session-id', sessionId,
    ...config.claude.flags,
    `'${escapedPrompt}'`,
  ].join(' ');

  await cmux.send({ workspace: workspaceRef, text: claudeCmd + '\\n' });

  // Notify
  await cmux.notify({
    title: 'kodo: Orchestrator',
    body: `Lanzado con ${sessions.length} sesiones activas`,
    workspace: workspaceRef,
  });

  console.log(`[kodo] Orchestrator launched → ${workspaceRef}`);
  return { workspace: workspaceRef, existing: false };
}

/**
 * Build a text summary of current state for the orchestrator
 * @param {import('../session/state.js').Session[]} sessions
 * @param {ReturnType<import('../config.js').loadConfig>} config
 */
export function buildContextSummary(sessions, config) {
  const lines = [];

  const running = sessions.filter((s) => s.status === 'running');
  lines.push(`Sesiones activas: ${running.length}/${config.claude.max_parallel}`);

  if (running.length === 0) {
    lines.push('No hay sesiones corriendo.');
  } else {
    lines.push('');
    for (const s of running) {
      const elapsed = Math.floor((Date.now() - new Date(s.started_at).getTime()) / 60_000);
      // Phase 10 D-19: taggear sesiones GSD para que el orquestador las identifique.
      // Pitfall #4: phase_id puede estar ausente en modo bootstrap (Phase 9 D-11).
      const gsdTag = s.gsd ? ` \`[GSD ${s.phase_id ? `phase ${s.phase_id}` : 'bootstrap'}]\`` : '';
      lines.push(`- **${s.task_ref}**${gsdTag}: ${s.summary}`);
      lines.push(`  Workspace: ${s.workspace_ref} | ${elapsed}min | ${s.project_path}`);
    }
  }

  return lines.join('\n');
}
