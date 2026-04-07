// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { listSessions } from '../session/state.js';
import * as cmux from '../cmux/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, 'prompt.md');
const ORCHESTRATOR_WORKSPACE_NAME = 'kodo-orchestrator';

/**
 * Launch the orchestrator Claude session in a dedicated cmux workspace
 */
export async function launchOrchestrator() {
  const config = loadConfig();

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

  // Read orchestrator prompt
  const basePrompt = readFileSync(PROMPT_PATH, 'utf-8');

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
function buildContextSummary(sessions, config) {
  const lines = [];

  const running = sessions.filter((s) => s.status === 'running');
  lines.push(`Sesiones activas: ${running.length}/${config.claude.max_parallel}`);

  if (running.length === 0) {
    lines.push('No hay sesiones corriendo.');
  } else {
    lines.push('');
    for (const s of running) {
      const elapsed = Math.floor((Date.now() - new Date(s.started_at).getTime()) / 60_000);
      lines.push(`- **${s.plane_identifier}**: ${s.summary}`);
      lines.push(`  Workspace: ${s.workspace_ref} | ${elapsed}min | ${s.project_path}`);
    }
  }

  return lines.join('\n');
}
