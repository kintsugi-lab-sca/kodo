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

import { existsSync } from 'node:fs';
import { removeSession, computeRealWorktreePath } from '../session/state.js';
import { removePromptFile } from '../session/prompt-file.js';

/**
 * @typedef {{
 *   id: string,
 *   session: import('../session/state.js').Session,
 *   gitFn?: (cwd: string, args: string[]) => Promise<string> | string,
 *   loggerFactory?: (binding: {session_id: string, task_id: string}) => any,
 *   removeSessionFn?: typeof removeSession,
 *   existsFn?: (path: string) => boolean,
 * }} TerminalCleanupArgs
 */

/**
 * Resuelve el worktree que hay que sanear de verdad (KODO-21 / inbox 1yx98p).
 *
 * `session.worktree_path` se persiste con `computeWorktreePath` → la convención
 * LEGACY `<project>/.bg-shell/<sid>`, que en la práctica NO existe: Claude Code
 * materializa el worktree en `<project>/.claude/worktrees/<sid>`. El síntoma es
 * un `worktree.cleanup.error{phase:status}` en cada cierre de sesión ("cannot
 * change to '.../.bg-shell/<sid>': No such file or directory") mientras el
 * worktree real sobrevive sin sanear.
 *
 * El fallback es deliberadamente estrecho — solo cuando el persistido NO existe
 * y el real SÍ. `computeWorktreePath` NO se toca (D-15: 5 consumidores acoplados
 * al path legacy). Si ninguno de los dos existe se devuelve el persistido y el
 * cleanup se comporta exactamente como antes.
 *
 * @param {import('../session/state.js').Session} session
 * @param {(path: string) => boolean} existsFn
 * @returns {string} Path del worktree a sanear.
 */
function resolveEffectiveWorktree(session, existsFn) {
  const persisted = /** @type {string} */ (session.worktree_path);
  if (existsFn(persisted)) return persisted;
  if (!session.project_path || !session.session_id) return persisted;

  const real = computeRealWorktreePath(session.project_path, session.session_id);
  if (real !== persisted && existsFn(real)) {
    console.error(
      `[kodo] worktree_path_fallback — ${session.session_id}: ${persisted} no existe; saneando el worktree real ${real}`,
    );
    return real;
  }
  return persisted;
}

/**
 * Ejecuta el cleanup terminal destructivo de una sesión cerrada.
 *
 * Reusa el helper compartido `cleanupWorktree` (Phase 41 D-11) — la "una sola
 * fuente de saneo" consumida también por doctor.js. Conserva VERBATIM: el guard
 * `if (session.worktree_path)`, el skip silencioso de sesiones legacy sin ese
 * campo, la construcción de cleanupLog (loggerFactory DI o createLogger child),
 * y el try/catch defensivo por paso. Lo único que cambia (KODO-21) es CUÁL
 * worktree recibe el helper: ver `resolveEffectiveWorktree`.
 *
 * @param {TerminalCleanupArgs} args
 * @returns {Promise<void>}
 */
export async function performTerminalCleanup({ id, session, gitFn, loggerFactory, removeSessionFn = removeSession, existsFn = existsSync }) {
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
        worktree: resolveEffectiveWorktree(session, existsFn),
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
