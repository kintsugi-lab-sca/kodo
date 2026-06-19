// @ts-check
//
// src/hooks/terminal-cleanup.js — Cleanup terminal compartido (LIFE-03, Phase 58).
//
// La secuencia DESTRUCTIVA del fin de sesión, extraída de `stop.js` para que el
// hook `SessionEnd` la posea SIN duplicar código (Goal LIFE-03). `Stop` (per-turn)
// deja de llamarla y conserva solo el estado ligero (idle/lock/color/nudge).
//
// Orden VERBATIM al bloque previo de stop.js (Phase 41 D-11): worktree cleanup →
// removePromptFile → removeSession. Cada paso es FAIL-OPEN (never-throws): un hook
// JAMÁS debe crashear Claude Code. El outer caller (runSessionEndHook) además
// envuelve todo en try/catch defensivo.

import { removeSession } from '../session/state.js';
import { removePromptFile } from '../session/prompt-file.js';

/**
 * @typedef {{
 *   id: string,
 *   session: import('../session/state.js').Session,
 *   gitFn?: (cwd: string, args: string[]) => Promise<string> | string,
 *   loggerFactory?: (binding: {session_id: string, task_id: string}) => any,
 *   removeSessionFn?: typeof removeSession,
 * }} TerminalCleanupArgs
 */

/**
 * Ejecuta el cleanup terminal destructivo de una sesión cerrada.
 *
 * Reusa el helper compartido `cleanupWorktree` (Phase 41 D-11) — la "una sola
 * fuente de saneo" consumida también por doctor.js. Conserva VERBATIM: el guard
 * `if (session.worktree_path)`, el skip silencioso de sesiones legacy sin ese
 * campo, la construcción de cleanupLog (loggerFactory DI o createLogger child),
 * y el try/catch defensivo por paso.
 *
 * @param {TerminalCleanupArgs} args
 * @returns {Promise<void>}
 */
export async function performTerminalCleanup({ id, session, gitFn, loggerFactory, removeSessionFn = removeSession }) {
  // worktree (fail-open) — saneo del worktree de la sesión.
  if (session.worktree_path) {
    try {
      const { cleanupWorktree } = await import('./worktree-cleanup.js');
      const cleanupLog = loggerFactory
        ? loggerFactory({ session_id: session.session_id, task_id: session.task_id })
        : await (async () => {
            const { createLogger } = await import('../logger.js');
            return createLogger({
              sessionId: session.session_id,
              minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
            }).child({ component: 'hook', task_id: session.task_id });
          })();

      const gitImpl = gitFn || (async (cwd, gitArgs) => {
        const { execFileSync } = await import('node:child_process');
        return execFileSync('git', ['-C', cwd, ...gitArgs], { encoding: 'utf-8' }).trim();
      });

      await cleanupWorktree({
        project: session.project_path,
        worktree: session.worktree_path,
        sessionId: session.session_id,
        gitFn: gitImpl,
        logger: cleanupLog,
      });
    } catch (outerErr) {
      console.error(`[kodo:session-end] worktree cleanup outer error: ${/** @type {Error} */ (outerErr).message}`);
    }
  }

  // Prompt file (incondicional, fail-open) — mismo ciclo de vida que el worktree.
  try {
    removePromptFile(session.session_id);
  } catch (err) {
    console.error(`[kodo:session-end] removePromptFile failed: ${/** @type {Error} */ (err).message}`);
  }

  // Remoción de la fila — la sesión se archiva a history.
  try {
    removeSessionFn(id);
    console.error(`[kodo:session-end] Session ${session.task_ref} removed from state`);
  } catch (err) {
    console.error(`[kodo:session-end] removeSession failed: ${/** @type {Error} */ (err).message}`);
  }
}
