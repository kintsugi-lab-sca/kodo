// @ts-check
//
// src/hooks/close-guard.js — traza del cierre descartado (KODO-27).
//
// Los hooks de cierre (Stop, SessionEnd) resuelven la sesión SÓLO por `session_id`:
// mutan `state.json` y hablan con el provider, así que ante un id desconocido hacen
// no-op en vez de adivinar por `cwd` (ver `findSession` en src/session/state.js para
// el incidente que lo motivó). Este módulo es la mitad observable de esa decisión:
// deja constancia de los no-op que EVITARON un cierre fantasma.
//
// Vive aparte de los dos hooks porque ambos necesitan exactamente lo mismo y porque
// carga `logger.js` de forma perezosa — igual que el resto de los efectos de
// stop.js/session-end.js, para no meter el logger en el grafo de import-time.
//

import { listSessionsForPath } from '../session/state.js';

/**
 * Emite `session.close.unmatched` si el cierre descartado tenía víctimas potenciales.
 *
 * «Víctima potencial» = una sesión VIVA cuyo `project_path` coincide con el `cwd` del
 * hook, o sea justo lo que el fallback por cwd habría devuelto antes de KODO-27. Sin
 * candidatas no se emite nada: los hooks de kodo están instalados global y el `Stop` de
 * cualquier sesión ad-hoc de la máquina dispararía una línea por turno sin aportar nada.
 *
 * NEVER-THROWS por contrato: se invoca desde el camino de cierre de los hooks, donde un
 * throw bloquearía el cierre de Claude Code (SC#5). Cualquier fallo degrada a un
 * console.error y sigue.
 *
 * @param {{ hook: 'stop' | 'session-end', sessionId: string | null | undefined, cwd: string }} ctx
 * @param {{
 *   listSessionsForPathFn?: typeof listSessionsForPath,
 *   unmatchedLoggerFactory?: () => any,
 * }} [deps]
 * @returns {Promise<void>}
 */
export async function traceUnmatchedClose(ctx, deps = {}) {
  try {
    const listFn = deps.listSessionsForPathFn || listSessionsForPath;
    const candidates = listFn(ctx.cwd);
    if (candidates.length === 0) return;

    const log = deps.unmatchedLoggerFactory
      ? deps.unmatchedLoggerFactory()
      : await (async () => {
          const { createLogger } = await import('../logger.js');
          // sessionId sintético: la línea habla del hook que se contuvo, no de la
          // tarea candidata. Mismo patrón que 'polling' e 'integrate'.
          return createLogger({
            sessionId: 'hooks',
            minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
          }).child({ component: 'hook' });
        })();

    const { sessionCloseUnmatched } = await import('../logger-events.js');
    sessionCloseUnmatched(log, {
      hook: ctx.hook,
      session_id: ctx.sessionId || null,
      cwd: ctx.cwd,
      candidates: candidates.length,
      candidate_task_refs: candidates.map((c) => c.session.task_ref).filter(Boolean),
    });
  } catch (err) {
    console.error(
      `[kodo:${ctx.hook}] close-guard trace failed: ${/** @type {Error} */ (err).message}`,
    );
  }
}
