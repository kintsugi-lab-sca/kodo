// @ts-check
//
// src/session/orphan-sweep.js — KODO-11 (tareas fantasma en «In Progress»).
//
// El backstop mecánico de review (`runReviewBackstop`, session-end.js) cierra el
// ciclo en el provider cuando el LLM no lo hace, PERO vive dentro del hook
// `SessionEnd` — que solo dispara en un cierre LIMPIO. Si el proceso muere de otra
// forma (tab de cmux cerrada, kill, reinicio, crash), el hook nunca corre y la tarea
// se queda en «In Progress» sin sesión viva detrás ni un solo comentario. Medido
// sobre ~/.kodo/logs en el momento del diagnóstico: 201 `session.start` vs 170
// `session.end` — ~15% de las sesiones nunca llegan al hook de cierre, y las 3
// tareas fantasma reportadas (LIKEN-120 / SCP-9 / ROMAN-196) tienen CERO
// `session.end` en su NDJSON.
//
// `reconcileTick` YA detecta esa muerte (marca la sesión `dead` tras 2 ticks) pero
// es puro y nunca toca el provider. Este módulo es la mitad que faltaba: el barrido
// periódico que convierte «sesión dead» en una señal VISIBLE en el provider.
//
// ── QUÉ HACE Y QUÉ NO (decisión deliberada) ──────────────────────────────────────
// Comenta, NO transiciona. Una sesión muerta puede haber terminado el trabajo o
// haberse caído a la mitad: kodo no puede distinguirlo, y mover a «In review» una
// tarea a medias es peor que dejarla marcada. El criterio de KODO-11 —«o cierra, o
// queda explícitamente marcada como incompleta»— se satisface con la segunda rama.
// El caso «terminó limpio y transicionó» ya lo cubre el backstop de SessionEnd; si
// la tarea ya no está en `in_progress`, este sweep es un no-op silencioso.
//
// ── PURO + never-throws ──────────────────────────────────────────────────────────
// Ningún import de `state.js`: el lector y el escritor se INYECTAN (mismo patrón DI
// que `reconcile.js` / `server/provider-state.js`), así el sweep se testea sin FS ni
// red. `runOrphanSweep` nunca lanza — un provider caído degrada a reintento.
//
// LOG-12: el único import de logging es el helper de evento con whitelist explícito.

import { sanitizeInline } from './handoff.js';
import { sessionOrphanDetected } from '../logger-events.js';

/**
 * Gracia mínima desde `dead_since` antes de considerar huérfana una sesión. Cubre la
 * carrera contra un `SessionEnd` lento (el hook hace I/O de red: getTaskState +
 * updateTaskState + addComment) cuya sesión ya fue marcada `dead` por el reconcile
 * (2 ticks ≈ 5 s). Con 2 min, un cierre limpio siempre gana la carrera.
 */
export const ORPHAN_GRACE_MS = 2 * 60 * 1000;

/**
 * Ventana de reintento tras un fallo de red. Un provider caído NO debe consumir su
 * única oportunidad (eso reintroduciría la tarea fantasma silenciosa), pero tampoco
 * debe generar una llamada por tick.
 */
export const ORPHAN_RETRY_MS = 10 * 60 * 1000;

/** Cadencia del loop. No necesita ser fina: la señal que persigue es de minutos. */
export const ORPHAN_SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * @typedef {import('./state.js').Session} Session
 */

/**
 * ¿Esta sesión es candidata a barrido? PURA, never-throws.
 *
 * Candidata = muerta, pasada la gracia, no barrida ya, y sin un intento reciente
 * fallido. `orphan_swept_at` es TERMINAL (el ciclo se resolvió: se comentó, o la
 * tarea ya no estaba en `in_progress`); `orphan_attempt_at` solo aplaza.
 *
 * @param {Session & { orphan_swept_at?: string, orphan_attempt_at?: string }} session
 * @param {number} now - timestamp ms (inyectado).
 * @returns {boolean}
 */
export function isOrphanCandidate(session, now) {
  if (!session || session.state !== 'dead') return false;
  if (!session.task_id) return false;
  if (session.orphan_swept_at) return false;

  const deadMs = session.dead_since ? Date.parse(session.dead_since) : NaN;
  // Sin `dead_since` parseable no hay reloj de gracia fiable → no barrer (el
  // siguiente paso a dead sí lo sella; falso negativo > falso positivo).
  if (!Number.isFinite(deadMs)) return false;
  if (now - deadMs < ORPHAN_GRACE_MS) return false;

  const attemptMs = session.orphan_attempt_at ? Date.parse(session.orphan_attempt_at) : NaN;
  if (Number.isFinite(attemptMs) && now - attemptMs < ORPHAN_RETRY_MS) return false;

  return true;
}

/**
 * Texto del comentario de sesión huérfana. PURO. Markdown plano: el adapter de Plane
 * envuelve en `<p>` y convierte `\n` en `<br>` (providers/plane/provider.js addComment).
 *
 * Todo campo de origen remoto o de origen LLM (`taskRef`, `next`) pasa por
 * `sanitizeInline` — el mismo saneado de una línea que usa el handoff (T-74-03).
 *
 * @param {{ taskRef?: string, sessionId?: string, deadSince?: string, next?: string|null, planPath?: string }} args
 * @returns {string}
 */
export function buildOrphanComment({ taskRef, sessionId, deadSince, next, planPath }) {
  const lines = [
    '⚠️ **Cierre incompleto detectado por kodo**',
    '',
    `La sesión de ${sanitizeInline(taskRef || 'esta tarea')} terminó sin postear el comentario final ni mover el estado, así que la tarea sigue en «In Progress» sin ninguna sesión viva detrás.`,
    '',
    `- Sesión: ${sanitizeInline(sessionId || 'desconocida')}`,
    `- Sin señal de vida desde: ${sanitizeInline(deadSince || 'desconocido')}`,
    `- Último NEXT registrado: ${next ? sanitizeInline(next, 200) : '(ninguno)'}`,
  ];
  if (planPath) {
    lines.push(`- Handoff: ${sanitizeInline(planPath, 200)}`);
  }
  lines.push(
    '',
    'kodo NO ha cambiado el estado: no puede saber si el trabajo quedó completo. Revisa el handoff y decide — mover a «In review» si está hecho, o relanzar la tarea.',
  );
  return lines.join('\n');
}

/**
 * Un pase del barrido. never-throws: cada sesión va en su propio try/catch y un
 * provider caído solo aplaza (marca `orphan_attempt_at`).
 *
 * Orden de escritura deliberado: la marca en `state.json` se escribe DESPUÉS de la
 * llamada al provider, nunca antes. Si el proceso muere entre medias se repite el
 * comentario en el siguiente arranque — duplicar una señal es recuperable; perderla
 * es exactamente el bug que este módulo cierra.
 *
 * @param {object} deps
 * @param {() => { sessions: Record<string, Session>, tasks?: Record<string, any> }} deps.loadStateFn
 * @param {(taskId: string, updates: object) => any} deps.updateSessionFn
 * @param {{ getTaskState?: Function, addComment?: Function }} deps.provider
 * @param {() => number} deps.now - clock inyectable (ms).
 * @param {{ info?: Function, warn?: Function, debug?: Function }} [deps.logger]
 * @returns {Promise<{ candidates: number, reported: number, resolved: number, deferred: number }>}
 *   `reported` = comentarios posteados; `resolved` = candidatas que ya no estaban en
 *   `in_progress` (nada que señalar); `deferred` = aplazadas por fallo del provider.
 */
export async function runOrphanSweep({ loadStateFn, updateSessionFn, provider, now, logger }) {
  const stats = { candidates: 0, reported: 0, resolved: 0, deferred: 0 };

  // Capability gate (mismo criterio que runReviewBackstop): sin lectura de estado o
  // sin comentario no hay señal que dar. Un provider sin estos métodos → no-op.
  if (
    !provider ||
    typeof provider.getTaskState !== 'function' ||
    typeof provider.addComment !== 'function'
  ) {
    return stats;
  }

  let state;
  try {
    state = loadStateFn();
  } catch (err) {
    logger?.warn?.('session.orphan.load_failed', {
      detail: String(/** @type {any} */ (err)?.message || '').slice(0, 200),
    });
    return stats;
  }

  const at = now();
  const sessions = (state && state.sessions) || {};
  const tasks = (state && state.tasks) || {};

  for (const [taskId, session] of Object.entries(sessions)) {
    if (!isOrphanCandidate(session, at)) continue;
    stats.candidates += 1;

    // Shape combinado {id, projectId, url, ref}: cubre Plane ({id, projectId}) y
    // GitHub ({ref}) sin ramificar por provider (espejo de runReviewBackstop).
    const task = {
      id: session.task_id,
      projectId: session.project_id,
      url: session.task_url,
      ref: session.task_ref,
    };

    let providerState;
    try {
      providerState = await provider.getTaskState(task);
    } catch (err) {
      stats.deferred += 1;
      updateSessionFn(taskId, { orphan_attempt_at: new Date(at).toISOString() });
      logger?.warn?.('session.orphan.getstate_failed', {
        session_id: session.session_id,
        task_id: session.task_id,
        detail: String(/** @type {any} */ (err)?.message || '').slice(0, 200),
      });
      continue;
    }

    // La tarea ya avanzó (el LLM cerró, o el backstop de SessionEnd, o un humano):
    // nada que señalar. Se sella igual para no volver a preguntar cada minuto.
    if (providerState !== 'in_progress') {
      stats.resolved += 1;
      updateSessionFn(taskId, { orphan_swept_at: new Date(at).toISOString() });
      continue;
    }

    const taskEntry = tasks[session.task_id] || {};
    const comment = buildOrphanComment({
      taskRef: session.task_ref,
      sessionId: session.session_id,
      deadSince: session.dead_since,
      next: taskEntry.next,
      planPath: taskEntry.plan_path,
    });

    try {
      await provider.addComment(task, comment);
    } catch (err) {
      stats.deferred += 1;
      updateSessionFn(taskId, { orphan_attempt_at: new Date(at).toISOString() });
      logger?.warn?.('session.orphan.comment_failed', {
        session_id: session.session_id,
        task_id: session.task_id,
        detail: String(/** @type {any} */ (err)?.message || '').slice(0, 200),
      });
      continue;
    }

    stats.reported += 1;
    updateSessionFn(taskId, { orphan_swept_at: new Date(at).toISOString() });
    // El helper llama `logger.info` sin guardas: un logger parcial (los stubs de
    // otros loops solo traen `warn`) lo haría lanzar dentro del bucle.
    if (logger && typeof logger.info === 'function') {
      sessionOrphanDetected(/** @type {any} */ (logger), {
        session_id: session.session_id,
        task_id: session.task_id,
        state: 'in_progress',
      });
    }
  }

  return stats;
}

/**
 * Arranca el loop periódico del barrido. Vive en el proceso server, junto al loop de
 * reconciliación (que es quien produce las transiciones a `dead` que este consume).
 * Single-flight y `.unref()` como `startReconcileLoop`. Retorna un teardown.
 *
 * @param {object} deps
 * @param {() => any} deps.loadStateFn
 * @param {(taskId: string, updates: object) => any} deps.updateSessionFn
 * @param {any} deps.provider
 * @param {{ info?: Function, warn?: Function, debug?: Function }} [deps.logger]
 * @param {number} [deps.intervalMs]
 * @param {() => number} [deps.now]
 * @param {(cb: () => void, ms: number) => any} [deps.setInterval]
 * @param {(handle: any) => void} [deps.clearInterval]
 * @returns {() => void} teardown
 */
export function startOrphanSweepLoop(deps) {
  const intervalMs = deps.intervalMs ?? ORPHAN_SWEEP_INTERVAL_MS;
  const setIv = deps.setInterval ?? setInterval;
  const clearIv = deps.clearInterval ?? clearInterval;
  const now = deps.now ?? (() => Date.now());
  let running = false;

  const handle = setIv(async () => {
    if (running) return; // single-flight: un sweep lento no se solapa consigo mismo
    running = true;
    try {
      const stats = await runOrphanSweep({
        loadStateFn: deps.loadStateFn,
        updateSessionFn: deps.updateSessionFn,
        provider: deps.provider,
        now,
        logger: deps.logger,
      });
      // Solo se loguea el pase que HIZO algo: el heartbeat vacío es el caso común
      // (cero sesiones dead) y inflaría el NDJSON igual que el tick de reconcile.
      if (stats.candidates > 0) {
        deps.logger?.info?.('session.orphan.sweep', stats);
      } else {
        deps.logger?.debug?.('session.orphan.sweep', stats);
      }
    } catch (err) {
      // never-throws: un fallo del sweep no debe tumbar el server.
      deps.logger?.warn?.('session.orphan.sweep_error', {
        detail: String(/** @type {any} */ (err)?.message || '').slice(0, 200),
      });
    } finally {
      running = false;
    }
  }, intervalMs);

  if (handle && typeof handle.unref === 'function') handle.unref();

  return () => clearIv(handle);
}
