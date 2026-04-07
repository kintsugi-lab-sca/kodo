#!/usr/bin/env node
// @ts-check
//
// Claude Code Stop hook for kodo
// When a kodo-tracked Claude session ends, updates Plane work item
// state and cmux workspace color.
// Also detects when the orchestrator session ends without [kodo:idle]
// and sends a reminder to update the skill.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSession, updateSession, removeSession } from '../session/state.js';
import { loadConfig } from '../config.js';
import { PlaneClient } from '../plane/client.js';
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

async function main() {
  try {
    const input = JSON.parse(await readStdin());
    const sessionId = input.session_id;
    const cwd = input.cwd || process.cwd();

    // Find the tracked session by cwd or session_id
    console.error(`[kodo:stop] Looking for session: cwd=${cwd}, sessionId=${sessionId}`);
    let result = findSession({ cwd });
    if (!result && sessionId) {
      // Try to find by session_id prefix match (kodo-kl-42)
      const { loadState } = await import('../session/state.js');
      const state = loadState();
      for (const [id, session] of Object.entries(state.sessions)) {
        if (session.session_id === sessionId) {
          result = { id, session };
          break;
        }
      }
    }

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

    const plane = new PlaneClient();

    // Read last screen content for closing comment
    let screenSummary = '';
    try {
      const screen = await cmux.readScreen({ workspace: session.workspace_ref, lines: 30 });
      screenSummary = screen.trim();
    } catch {}

    // Post closing comment to Plane
    try {
      const elapsed = Math.floor((Date.now() - new Date(session.started_at).getTime()) / 60_000);
      const comment = [
        `<h3>🤖 kodo: sesión finalizada (${elapsed}min)</h3>`,
        `<p><strong>Workspace:</strong> ${session.workspace_ref}</p>`,
        screenSummary ? `<h4>Últimas líneas de la sesión:</h4><pre>${escapeHtml(screenSummary)}</pre>` : '',
      ].filter(Boolean).join('\n');

      await plane.createComment(session.project_id, session.plane_id, comment);
      console.error(`[kodo] Closing comment posted for ${session.plane_identifier}`);
    } catch (err) {
      console.error(`[kodo] Error posting comment: ${err.message}`);
    }

    // Update Plane work item to "In Review" (not Done — requires human/orchestrator approval)
    try {
      const states = await plane.listStates(session.project_id);
      const reviewState = states.find((s) => s.name.toLowerCase() === config.plane.review_state.toLowerCase());

      if (reviewState) {
        await plane.updateWorkItem(session.project_id, session.plane_id, {
          state: reviewState.id,
        });
        console.error(`[kodo] ${session.plane_identifier} → ${config.plane.review_state}`);
      }
    } catch (err) {
      console.error(`[kodo] Error updating Plane: ${err.message}`);
    }

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
        title: `kodo: ${session.plane_identifier} completada`,
        body: session.summary,
        workspace: session.workspace_ref,
      });
    } catch {}

    // Update session status to review (keep in state for orchestrator visibility)
    updateSession(id, { status: 'review' });

    // Notify orchestrator if running
    try {
      const workspaces = await cmux.listWorkspaces();
      const orchMatch = workspaces.match(/(workspace:\d+)\s+kodo-orchestrator/);
      if (orchMatch) {
        await cmux.send({
          workspace: orchMatch[1],
          text: `La sesión ${session.plane_identifier} (${session.summary}) ha terminado y está en Review. Revisa el resultado y decide si pasa a Done o necesita más trabajo.\\n`,
        });
      }
    } catch {}

    // Session stays in state with status "review" — orchestrator or human removes it after approval
  } catch (err) {
    console.error(`[kodo] Stop hook error: ${err.message}`);
  }
}

/** @param {string} str */
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

main();
