#!/usr/bin/env node
// @ts-check
//
// Claude Code Stop hook for kodo
// When a kodo-tracked Claude session ends, updates task provider
// state and cmux workspace color.
// Also detects when the orchestrator session ends without [kodo:idle]
// and sends a reminder to update the skill.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSession, updateSession, removeSession } from '../session/state.js';
import { loadConfig } from '../config.js';
import { initRegistry, getProvider } from '../providers/registry.js';
import * as cmux from '../cmux/client.js';
import { colorForStatus } from '../cmux/colors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KODO_ROOT = join(__dirname, '..', '..');
const SKILL_PATH = join(KODO_ROOT, 'skills', 'kodo-orchestrate', 'skill.md');

const STDIN_TIMEOUT = 3000;

async function readStdin() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('{}'), STDIN_TIMEOUT);
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString());
    });
  });
}

/**
 * Post closing actions to the task provider: comment + state transition.
 * Extracted for testability. Each provider call is wrapped in its own
 * try-catch so a failure in one operation never blocks the other.
 *
 * @param {import('../session/state.js').Session | any} session
 * @param {any} config
 * @param {Pick<import('../interface.js').TaskProvider, 'addComment' | 'updateTaskState'>} provider
 * @param {string} screenSummary
 */
export async function postClosingActions(session, config, provider, screenSummary) {
  /** @type {import('../interface.js').TaskItem} */
  const task = {
    id: session.task_id,
    ref: session.task_ref,
    title: session.summary,
    description: '',
    labels: [],
    projectId: session.project_id,
    projectName: '',
    groups: [],
    url: '',
    priority: null,
  };

  // 1. Post closing comment (Markdown format)
  try {
    const elapsed = Math.floor((Date.now() - new Date(session.started_at).getTime()) / 60_000);
    const comment = [
      `### 🤖 kodo: sesión finalizada (${elapsed}min)`,
      `**Workspace:** ${session.workspace_ref}`,
      screenSummary ? `#### Últimas líneas de la sesión:\n\`\`\`\n${screenSummary}\n\`\`\`` : '',
    ].filter(Boolean).join('\n\n');

    await provider.addComment(task, comment);
    console.error(`[kodo] Closing comment posted for ${session.task_ref}`);
  } catch (err) {
    console.error(`[kodo] Error posting comment: ${err.message}`);
  }

  // 2. Transition task to review state — independent try-catch
  try {
    const providerName = session.provider || config.provider;
    const providerConfig = config.providers[providerName];
    if (!providerConfig || !providerConfig.states || !providerConfig.states.review) {
      throw new Error(`No review state configured for provider "${providerName}"`);
    }
    const reviewState = providerConfig.states.review;
    await provider.updateTaskState(task, reviewState);
    console.error(`[kodo] ${session.task_ref} → ${reviewState}`);
  } catch (err) {
    console.error(`[kodo] Error updating state: ${err.message}`);
  }
}

async function main() {
  try {
    const input = JSON.parse(await readStdin());
    const sessionId = input.session_id;
    const cwd = input.cwd || process.cwd();

    // Find the tracked session — prefer session_id (unique), fall back to cwd
    console.error(`[kodo:stop] Looking for session: sessionId=${sessionId}, cwd=${cwd}`);
    let result = findSession({ sessionId, cwd });

    if (!result) {
      console.error(`[kodo:stop] No matching session found`);
      // Check if this is the orchestrator session (cwd = kodo repo)
      const isOrchestratorSession = cwd && (
        cwd === KODO_ROOT ||
        cwd.startsWith(KODO_ROOT + '/')
      );
      if (isOrchestratorSession) {
        await handleOrchestratorStop();
      }
      process.exit(0);
    }

    const { id, session } = result;
    const config = loadConfig();

    // Resolve provider via registry — fall back to config default
    await initRegistry();
    const provider = getProvider(session.provider || config.provider);

    // Read last screen content for closing comment
    let screenSummary = '';
    try {
      const screen = await cmux.readScreen({ workspace: session.workspace_ref, lines: 30 });
      screenSummary = screen.trim();
    } catch {}

    // Post comment + transition state (defensive, independent try-catch)
    await postClosingActions(session, config, provider, screenSummary);

    // Update cmux workspace color to "review" (blue)
    try {
      await cmux.setColor({
        workspace: session.workspace_ref,
        color: colorForStatus('review'),
      });
    } catch (err) {
      console.error(`[kodo] Error setting color: ${err.message}`);
    }

    // Notify
    try {
      await cmux.notify({
        title: `kodo: ${session.task_ref} completada`,
        body: session.summary,
        workspace: session.workspace_ref,
      });
    } catch {}

    // Remove session from state — task was moved to review in Plane already
    removeSession(id);
    console.error(`[kodo:stop] Session ${session.task_ref} removed from state`);

    // Notify orchestrator if running
    try {
      const workspaces = await cmux.listWorkspaces();
      const orchMatch = workspaces.match(/(workspace:\d+)\s+kodo-orchestrator/);
      if (orchMatch) {
        await cmux.send({
          workspace: orchMatch[1],
          text: `La sesión ${session.task_ref} (${session.summary}) ha terminado y está en Review. Revisa el resultado y decide si pasa a Done o necesita más trabajo.\\n`,
        });
      }
    } catch {}

    // Session stays in state with status "review" — orchestrator or human removes it after approval
  } catch (err) {
    console.error(`[kodo] Stop hook error: ${err.message}`);
  }
}

/**
 * Called when the orchestrator session ends.
 * Auto-commits any pending changes in skills/ to preserve learnings.
 */
async function handleOrchestratorStop() {
  const { execSync } = await import('node:child_process');

  try {
    // Check if there are uncommitted changes in skills/
    const status = execSync('git status --porcelain skills/', {
      cwd: KODO_ROOT,
      encoding: 'utf-8',
    }).trim();

    if (!status) {
      console.error('[kodo] Orchestrator session ended — no skill changes to commit');
      return;
    }

    // Auto-commit skill changes
    const date = new Date().toISOString().slice(0, 10);
    execSync(`git add skills/ && git commit -m "skill: orchestrator learnings ${date}"`, {
      cwd: KODO_ROOT,
      encoding: 'utf-8',
    });

    console.error('[kodo] Orchestrator skill changes auto-committed');

    await cmux.notify({
      title: 'kodo: skill actualizado',
      body: `Aprendizajes del orquestador guardados (${date})`,
    });
  } catch (err) {
    console.error(`[kodo] Error auto-committing skill: ${err.message}`);
  }
}

// Only run main() when invoked as CLI (not when imported for testing)
const isMainEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainEntry) {
  main();
}
