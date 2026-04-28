#!/usr/bin/env node
// @ts-check
//
// Claude Code Stop hook for kodo
// Mechanical cleanup when a kodo-tracked Claude session ends: removes
// the session from local state and marks the cmux workspace as review.
// The active Claude session owns all provider-side interactions
// (comments, state transitions) so the hook never touches Plane.
// Also detects when the orchestrator session ends and auto-commits
// skill changes.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSession, removeSession } from '../session/state.js';
import { getSessionMode } from '../labels.js';
import * as cmux from '../cmux/client.js';
import { colorForStatus } from '../cmux/colors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KODO_ROOT = join(__dirname, '..', '..');
const SKILL_PATH = join(KODO_ROOT, 'skills', 'kodo-orchestrate', 'skill.md');

const STDIN_TIMEOUT = 3000;

/**
 * Build the orchestrator nudge text for a session that just ended.
 * Pure function — no I/O. Exported for testing.
 *
 * Phase 12 D-07: switch exhaustivo sobre getSessionMode(session) con tres cases:
 *   - 'quick' → texto que NO sugiere `kodo gsd verify` (CLI no soporta quick).
 *               Es one-shot sin VERIFICATION.md; orchestrator revisa manualmente.
 *   - 'full'  → texto Phase 10 D-04: apunta a `kodo gsd verify <session-id>`.
 *               phase_id puede estar ausente (bootstrap, Phase 9 D-11) → fallback "bootstrap".
 *   - default → null (no-GSD): texto original "Revisa el resultado y decide…".
 *
 * Idioma: español (D-16 Phase 10).
 *
 * @param {import('../session/state.js').Session} session
 * @returns {string}
 */
export function buildStopNudgeText(session) {
  const base = `La sesión ${session.task_ref} (${session.summary}) ha terminado y está en Review.`;
  switch (getSessionMode(session)) {
    case 'quick':
      // D-08: texto ES, NO sugiere verify. Escape literal `\\n` preservado (D-04 Phase 10).
      return `${base} Es una sesión GSD quick (one-shot, sin VERIFICATION.md). Revísala manualmente como cualquier sesión no-GSD.\\n`;
    case 'full': {
      // Texto Phase 10 D-04 preservado verbatim.
      const phaseLabel = session.phase_id ? `fase ${session.phase_id}` : 'bootstrap';
      return `${base} Es una sesión GSD (${phaseLabel}). Ejecuta \`kodo gsd verify ${session.session_id}\` y actúa según el verdict.\\n`;
    }
    default:
      // null → sesión no-GSD. Texto original preservado.
      return `${base} Revisa el resultado y decide si pasa a Done o necesita más trabajo.\\n`;
  }
}

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

    // The active Claude session owns all Plane interactions (comments +
    // state transition to review). The hook only performs mechanical
    // cleanup: cmux color + local state removal.
    try {
      await cmux.setColor({
        workspace: session.workspace_ref,
        color: colorForStatus('review'),
      });
    } catch (err) {
      console.error(`[kodo] Error setting color: ${err.message}`);
    }

    try {
      await cmux.notify({
        title: `kodo: ${session.task_ref} cerrada`,
        body: session.summary,
        workspace: session.workspace_ref,
      });
    } catch {}

    // Emit typed session.end event BEFORE removeSession so the logger
    // captures the transition while the session record still exists.
    // Silent-failure: never crash Claude Code stop hook.
    try {
      const { createLogger } = await import('../logger.js');
      const { sessionEnd } = await import('../logger-events.js');
      const log = createLogger({
        sessionId: session.session_id,
        minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
      }).child({ component: 'hook', task_id: session.task_id });
      sessionEnd(log, {
        session_id: session.session_id,
        task_id: session.task_id,
        status: session.status,
        ended_at: new Date().toISOString(),
      });
    } catch {
      // silent — never crash Claude Code
    }

    // Release GSD lock if applicable (D-09: idempotent, verifies session_id)
    if (session.gsd) {
      try {
        const { releaseGsdLock } = await import('../gsd/lock.js');
        releaseGsdLock(session.project_path, session.session_id);
      } catch (err) {
        console.error(`[kodo:stop] Error releasing GSD lock: ${err.message}`);
      }
    }

    removeSession(id);
    console.error(`[kodo:stop] Session ${session.task_ref} removed from state`);

    // Notify orchestrator if running
    try {
      const workspaces = await cmux.listWorkspaces();
      const orchMatch = workspaces.match(/(workspace:\d+)\s+kodo-orchestrator/);
      if (orchMatch) {
        await cmux.send({
          workspace: orchMatch[1],
          text: buildStopNudgeText(session),
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
