#!/usr/bin/env node
// @ts-check
//
// Claude Code SessionEnd hook for kodo (LIFE-03, Phase 58).
//
// Dispara UNA vez al cierre real de la sesión (`/exit` u otro `end_reason`) — a
// diferencia de `Stop`, que dispara al final de CADA turno. Aquí vive el cleanup
// terminal DESTRUCTIVO (removeSession + worktree + promptFile), de modo que la fila
// DESAPARECE del dashboard al cerrar en vez de quedar colgada como `dead`. `Stop`
// queda para el estado ligero (idle/lock/color/nudge).
//
// Reparto LOCKED (58-CONTEXT.md D-1): Stop→idle, SessionEnd→cleanup terminal.
// Idempotencia (D-3): guard `source === 'history'` espejo de stop.js — ambos hooks
// coexisten sin pelear; SessionEnd-solo o Stop→SessionEnd convergen. never-throws (D-4).

import { fileURLToPath } from 'node:url';
import { findSession, removeSession } from '../session/state.js';
import { performTerminalCleanup } from './terminal-cleanup.js';

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
 * Test-friendly entry point for the SessionEnd hook. Pure-ish over (input, deps).
 *
 * Espejo estructural de `runStopHook` (stop.js): find session → guards de
 * idempotencia → typed event → lock backstop → cleanup terminal. Todo el cuerpo
 * va en un outer try/catch — el hook NUNCA crashea Claude Code.
 *
 * @param {{session_id: string, cwd?: string, reason?: string, transcript_path?: string}} input
 * @param {{
 *   findSessionFn?: typeof findSession,
 *   removeSessionFn?: typeof removeSession,
 *   loggerFactory?: (binding: {session_id: string, task_id: string}) => any,
 *   gitFn?: (cwd: string, args: string[]) => Promise<string> | string,
 * }} [deps]
 * @returns {Promise<void>}
 */
export async function runSessionEndHook(input, deps = {}) {
  const findSessionFn = deps.findSessionFn || findSession;
  const removeSessionFn = deps.removeSessionFn || removeSession;
  try {
    const sessionId = input.session_id;
    const cwd = input.cwd || process.cwd();

    let result = findSessionFn({ sessionId, cwd });

    // Idempotencia (D-3): sin sesión tracked → nada que limpiar (p.ej. la sesión
    // del orquestador o una sesión ad-hoc no adoptada). No-op silencioso.
    if (!result) {
      console.error(`[kodo:session-end] No matching session — nothing to clean`);
      return;
    }

    // Idempotencia (D-3): si la sesión ya está archivada (el cleanup terminal ya
    // corrió — Stop legacy, un SessionEnd previo, o doctor), no re-procesar. Espejo
    // del guard de stop.js:154.
    if (result.source === 'history') {
      console.error(`[kodo:session-end] Session ${result.session.task_ref} already archived — skip`);
      return;
    }

    const { id, session } = result;

    // Logger compartido entre el typed event y el cleanup.
    const log = deps.loggerFactory
      ? deps.loggerFactory({ session_id: session.session_id, task_id: session.task_id })
      : await (async () => {
          const { createLogger } = await import('../logger.js');
          return createLogger({
            sessionId: session.session_id,
            minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
          }).child({ component: 'hook', task_id: session.task_id });
        })();

    // Typed session.end event (terminal) — MOVIDO desde stop.js. Refleja el cierre
    // REAL (una vez), no el fin-de-turno. Emitido ANTES de removeSession para que el
    // logger capture la transición mientras la fila aún existe. Silent-failure.
    try {
      const { sessionEnd } = await import('../logger-events.js');
      sessionEnd(log, {
        session_id: session.session_id,
        task_id: session.task_id,
        status: 'done',
        ended_at: new Date().toISOString(),
      });
    } catch {
      // silent — never crash Claude Code (logger fail-open)
    }

    // Lock release BACKSTOP idempotente (D-1): Stop ya lo libera per-turn, pero si
    // SessionEnd dispara sin un Stop previo, lo cubrimos. releaseGsdLock verifica
    // session_id y es idempotente (D-09).
    if (session.gsd) {
      try {
        const { releaseGsdLock } = await import('../gsd/lock.js');
        releaseGsdLock(session.project_path, session.session_id);
      } catch (err) {
        console.error(`[kodo:session-end] Error releasing GSD lock: ${/** @type {Error} */ (err).message}`);
      }
    }

    // Cleanup terminal destructivo (helper compartido, fail-open por paso).
    await performTerminalCleanup({
      id,
      session,
      gitFn: deps.gitFn,
      loggerFactory: deps.loggerFactory,
      removeSessionFn,
    });
  } catch (err) {
    console.error(`[kodo] SessionEnd hook error: ${/** @type {Error} */ (err).message}`);
  }
}

async function main() {
  const input = JSON.parse(await readStdin());
  await runSessionEndHook(input);
  // El hook nunca crashea Claude Code: runSessionEndHook envuelve su cuerpo en
  // try/catch top-level; main() siempre termina con exit 0.
  process.exit(0);
}

// Only run main() when invoked as CLI (not when imported for testing).
const isMainEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainEntry) {
  main();
}
