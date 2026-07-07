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
 *   provider?: any,
 *   config?: any,
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

    // Logger compartido entre el backstop, el typed event y el cleanup.
    const log = deps.loggerFactory
      ? deps.loggerFactory({ session_id: session.session_id, task_id: session.task_id })
      : await (async () => {
          const { createLogger } = await import('../logger.js');
          return createLogger({
            sessionId: session.session_id,
            minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
          }).child({ component: 'hook', task_id: session.task_id });
        })();

    // ── Review backstop (DELIV-04, D-10..D-14) ─────────────────────────────
    // Bloque AUTÓNOMO: tras los guards de idempotencia (:61-72) y ANTES del
    // session.end event / lock release / performTerminalCleanup. No se entrelaza
    // con esos pasos para dejar sitio al movimiento de HYG-04 en Fase 72 (Pitfall
    // #7). Envuelto en su propio try/catch además del outer never-throws: un fallo
    // del backstop NUNCA impide el cleanup terminal (fail-open, D-13).
    try {
      let config = deps.config;
      let provider = deps.provider;
      if (config === undefined || provider === undefined) {
        // Defaults perezosos a los resolvers reales (mismo patrón DI que
        // verify.js). Vía `await import(...)` para no acoplar estáticamente el
        // cleanup mecánico al registry/config; un fallo degrada a no-op.
        try {
          const { loadConfig } = await import('../config.js');
          const realConfig = loadConfig();
          if (config === undefined) config = realConfig;
          if (provider === undefined) {
            const { initRegistry, getProvider } = await import('../providers/registry.js');
            await initRegistry();
            const providerName = session.provider || realConfig.provider;
            provider = getProvider(providerName);
          }
        } catch {
          if (config === undefined) config = {};
          if (provider === undefined) provider = null;
        }
      }
      await runReviewBackstop({ session, input, provider, config, log });
    } catch (err) {
      console.error(`[kodo:session-end] Review backstop error: ${/** @type {Error} */ (err).message}`);
    }

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

/**
 * Backstop mecánico de «In Review» (DELIV-04, D-10..D-14). Si al cierre real de
 * la sesión la tarea sigue viva en `in_progress` (verificado con `getTaskState`,
 * NO con `session.status` local) y la sesión terminó limpia, transiciona la tarea
 * al estado review y comenta «cierre automático», emitiendo un evento NDJSON
 * tipado. La transición del LLM pasa a ser optimización, no única vía (cierra la
 * causa raíz T5). Capability-gated por `typeof` (GitHub degrada a no-op),
 * idempotente frente al LLM (no-op si la tarea ya avanzó) y fail-open por paso.
 *
 * @param {{
 *   session: any,
 *   input: {reason?: string},
 *   provider: any,
 *   config: any,
 *   log: any,
 * }} args
 * @returns {Promise<void>}
 */
export async function runReviewBackstop({ session, input, provider, config, log }) {
  // 1. Capability gate (D-13): guard null-first para que el `typeof` no lance;
  //    un provider sin los 3 métodos (GitHub) degrada a no-op silencioso.
  if (
    !provider ||
    typeof provider.getTaskState !== 'function' ||
    typeof provider.updateTaskState !== 'function' ||
    typeof provider.addComment !== 'function'
  ) {
    return;
  }

  // 2. Reconstruir un TaskItem MÍNIMO desde la SessionRecord (Pitfall #6, 0-red):
  //    basta {id, projectId, url, ref} para getTaskState/updateTaskState/addComment
  //    de Plane. Sin task_id/project_id no hay nada que transicionar.
  if (!session.task_id || !session.project_id) return;
  const task = {
    id: session.task_id,
    projectId: session.project_id,
    url: session.task_url,
    ref: session.task_ref,
  };

  // 3. «Sesión limpia» (D-12, fail-open): SessionEnd solo dispara en cierres
  //    NO-crash. `input.reason` ∈ {clear, logout, prompt_input_exit,
  //    bypass_permissions_disabled, other} — ninguno representa un crash (un
  //    crash no dispara un SessionEnd limpio). Se transiciona salvo que un futuro
  //    reason señale un fallo explícito. El `reason` se trata como enum CERRADO:
  //    nunca se interpola en comandos ni rutas (V5 ASVS, T-71-12).
  void input;

  // 4. Gate de estado (D-11): idempotente frente al LLM. Solo transicionar si la
  //    tarea sigue VIVA en 'in_progress'; ya en review/done → no-op. Fail-open:
  //    si getTaskState falla, no arriesgamos una transición a ciegas.
  let state;
  try {
    state = await provider.getTaskState(task);
  } catch (err) {
    log.warn('session.backstop.getstate_failed', { error: /** @type {Error} */ (err).message });
    return;
  }
  if (state !== 'in_progress') return;

  // 5. Resolver reviewState con el patrón de verify.js:258-262 (Pitfall #1): bajo
  //    config.providers[provider].states.review, NO top-level; default 'In review'.
  const providerName = session.provider || (config && config.provider);
  const providerCfg = (config && config.providers && config.providers[providerName]) || {};
  const reviewState = (providerCfg.states && providerCfg.states.review) || 'In review';

  // 6. Transición fail-open: un fallo de red loguea y sale sin comentar.
  try {
    await provider.updateTaskState(task, reviewState);
  } catch (err) {
    log.warn('session.backstop.transition_failed', { error: /** @type {Error} */ (err).message });
    return;
  }

  // 7. Comentario fail-open: un fallo NO impide el evento (usar addComment —
  //    contrato del provider — NO createComment, que es del cliente).
  try {
    await provider.addComment(task, 'cierre automático');
  } catch (err) {
    log.warn('session.backstop.comment_failed', { error: /** @type {Error} */ (err).message });
  }

  // 8. Evento NDJSON tipado (helper Task 1): SOLO {session_id, task_id, from, to}.
  try {
    const { sessionBackstopReview } = await import('../logger-events.js');
    sessionBackstopReview(log, {
      session_id: session.session_id,
      task_id: session.task_id,
      from: 'in_progress',
      to: reviewState,
    });
  } catch {
    // silent — never crash Claude Code (logger fail-open)
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
