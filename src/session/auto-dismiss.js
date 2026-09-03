// @ts-check
//
// src/session/auto-dismiss.js — KODO-83 (filas dead que nadie descarta).
//
// El dashboard acumula filas `dead` hasta que un humano pulsa `d`+`d` en cada una.
// Tras el lote del 2-sep había 13 filas cuya tarea ya estaba en Done, sin proceso ni
// worktree detrás: trece pulsaciones de teclado para retirar trece filas que ya no
// afirmaban nada. KODO-78 cerró el ciclo del dismiss MANUAL; este módulo es el
// automático, que quedó fuera de aquella por destructivo — el dismiss borra worktrees
// vía `doctor --fix`.
//
// ── LA REGLA, Y POR QUÉ ES TAN ESTRECHA ───────────────────────────────────────────
// Se descarta sola una sesión SOLO si se cumplen las TRES a la vez:
//
//   1. `state === 'dead'` y `process_alive === false` — no hay nada corriendo.
//   2. El provider dice que la tarea está CERRADA (`getTaskState` → 'done'; el adapter
//      de Plane mapea *completed* y *cancelled* al mismo literal, así que Done y
//      Cancelled entran por la misma puerta, y el de GitHub mapea `closed` igual).
//   3. Ningún worktree de la sesión existe, o los que existen están LIMPIOS.
//
// La tercera es la que hace la operación no destructiva: lo único irrecuperable que un
// dismiss puede llevarse por delante es trabajo sin commitear, y con esa condición no
// hay ninguno. Un worktree sucio NO se toca — esa fila sigue esperando el dismiss
// manual, que es exactamente lo que debe pasar: la decisión de tirar trabajo es del
// humano, no del daemon.
//
// «Limpio» es `status --porcelain` vacío, lo que INCLUYE un worktree con commits locales
// sin mergear. Eso NO es un hueco: el borrado de la rama ya está protegido aguas abajo
// por KODO-21 — `cleanupWorktree` solo hace `branch -D` cuando quedan cero commits fuera
// de main, y si no, conserva la rama y emite `worktree.branch.kept`. Lo que se retira es
// el directorio; los commits siguen alcanzables por su rama.
//
// FAIL-SAFE en todas las ramas de duda, que es la inversión del fail-open habitual del
// repo: con el provider caído, con git mudo o con un dismiss que no responde 200, NO se
// descarta nada. Aquí «no sé» tiene que colapsar a «no toco», nunca a «adelante»: el
// coste de un falso negativo es una fila de más en el dashboard; el de un falso positivo
// es un worktree borrado.
//
// ── DÓNDE VIVE ───────────────────────────────────────────────────────────────────
// En el proceso del daemon, como tercer barrido del tick de `startOrphanSweepLoop` —
// el mismo loop que ya consume las transiciones a `dead` que produce `reconcileTick`.
// NO dentro de `reconcileTick`: ese tick es PURO y sin I/O de red por contrato, y esto
// es exclusivamente I/O (una llamada al provider y un `git status`). Al vivir en el
// daemon, la fila desaparece aunque el dashboard no esté abierto.
//
// La mutación destructiva no se reimplementa: se delega en `dismissFn`, que en el server
// es el handler de `src/server/dismiss.js` — el mismo que sirve al `DELETE /sessions/{id}`
// del dashboard, con su guard de sesión viva y su traducción a `actions[]`. Un solo
// camino destructivo, dos disparadores.
//
// PURO + never-throws + DI, como `orphan-sweep.js`: ni el lector ni el escritor de state
// ni git ni el provider se importan, se inyectan. LOG-12: el único import de logging es
// el helper de evento con whitelist explícito.

import { join } from 'node:path';
import { lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { sessionAutoDismissed } from '../logger-events.js';

/**
 * Gracia mínima desde `dead_since` antes de considerar una sesión para auto-dismiss.
 *
 * Más larga que la del barrido de huérfanas (2 min, que solo cubre la carrera contra un
 * `SessionEnd` lento) porque aquí lo que corre detrás es más caro: la captura de
 * integración del cierre lee la rama y el worktree DESPUÉS de que el proceso muera, y
 * borrarle el árbol a mitad de esa lectura sería un daño real. Cinco minutos dejan
 * terminar cualquier cola de cierre y, de paso, dan al operador un rato para ver la fila
 * antes de que se retire sola.
 */
export const AUTO_DISMISS_GRACE_MS = 5 * 60 * 1000;

/**
 * Ventana de reintento tras una candidata que no se descartó. Sin ella, cada fila `dead`
 * del dashboard generaría una llamada al provider POR TICK (cadencia de 60 s) mientras
 * siga ahí — y las filas que no cumplen la regla se quedan por definición. Con 10 min, N
 * filas cuestan N llamadas cada 10 min.
 */
export const AUTO_DISMISS_RETRY_MS = 10 * 60 * 1000;

/**
 * Literales de `getTaskState` que cuentan como tarea CERRADA. Uno solo, a propósito:
 * ambos adapters colapsan sus estados terminales aquí (Plane: *completed* y *cancelled*;
 * GitHub: issue `closed` sin etiqueta de review/blocked). `in_review` NO entra — una
 * tarea en revisión todavía espera a un humano que puede querer mirar el worktree.
 */
export const CLOSED_TASK_STATES = Object.freeze(['done']);

/**
 * @typedef {import('./state.js').Session} Session
 */

/**
 * @typedef {{ status: 'absent'|'clean'|'dirty'|'unknown', path: string|null }} WorktreeVerdict
 */

/**
 * ¿El literal del provider es un estado cerrado? PURA.
 *
 * @param {string|null|undefined} taskState
 * @returns {boolean}
 */
export function isClosedTaskState(taskState) {
  return typeof taskState === 'string' && CLOSED_TASK_STATES.includes(taskState);
}

/**
 * Primera condición de la regla, la única que se puede contestar sin I/O. PURA,
 * never-throws.
 *
 * `process_alive` se compara contra `false` ESTRICTO, no por falsy: una sesión legacy
 * que no trae el campo se lee `undefined`, y `undefined` significa «nadie lo ha
 * observado», no «el proceso está muerto». Sin ese matiz, cualquier entrada anterior a
 * la migración v3 sería candidata a que le borren el worktree.
 *
 * Sin `dead_since` parseable tampoco hay candidata: es el reloj de la gracia, y sin
 * reloj no se puede afirmar que haya pasado. El siguiente paso a `dead` lo sella.
 *
 * @param {Session & { auto_dismiss_attempt_at?: string }} session
 * @param {number} now - timestamp ms (inyectado).
 * @returns {boolean}
 */
export function isAutoDismissCandidate(session, now) {
  if (!session || session.state !== 'dead') return false;
  if (session.process_alive !== false) return false;
  if (!session.task_id) return false;

  const deadMs = session.dead_since ? Date.parse(session.dead_since) : NaN;
  if (!Number.isFinite(deadMs)) return false;
  if (now - deadMs < AUTO_DISMISS_GRACE_MS) return false;

  const attemptMs = session.auto_dismiss_attempt_at
    ? Date.parse(session.auto_dismiss_attempt_at)
    : NaN;
  if (Number.isFinite(attemptMs) && now - attemptMs < AUTO_DISMISS_RETRY_MS) return false;

  return true;
}

/**
 * Los paths que un dismiss de esta sesión PODRÍA tocar. PURA (solo `join`).
 *
 * Son tres convenciones y no una porque el dismiss no mira solo `worktree_path`:
 * `doctor.execute` enumera los `.bg-shell/<sid>` legacy cruzados contra state.json, y el
 * cleanup terminal opera sobre el `.claude/worktrees/<sid>` real. Comprobar únicamente
 * el campo persistido dejaría fuera justo los directorios de las sesiones viejas, que son
 * las que más tiempo llevan muertas en el dashboard — las que este barrido existe para
 * retirar. Un `lstat` de más es barato; un worktree sucio borrado, no.
 *
 * Se deduplica: en una sesión moderna `worktree_path` YA es el path real y la lista
 * queda en dos entradas.
 *
 * @param {Session} session
 * @returns {string[]}
 */
export function worktreePathsFor(session) {
  const paths = [];
  if (session?.worktree_path) paths.push(session.worktree_path);
  if (session?.project_path && session?.session_id) {
    paths.push(join(session.project_path, '.bg-shell', session.session_id));
    paths.push(join(session.project_path, '.claude', 'worktrees', session.session_id));
  }
  return [...new Set(paths)];
}

/**
 * ¿Hay ALGO en esta ruta? Default de `existsFn`.
 *
 * `lstatSync` y no `existsSync` por la misma razón que `pathPresent` en
 * `hooks/worktree-cleanup.js`: `existsSync` SIGUE symlinks, así que un symlink colgante
 * en la ruta del worktree se leería como «no existe» — y aquí «no existe» es media
 * autorización para borrar. `lstatSync` mira el enlace en sí.
 *
 * @param {string} path
 * @returns {boolean}
 */
function pathPresent(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * `git -C <cwd> <args>` síncrono. Default de `gitFn` — espejo del de `gsd/doctor.js`.
 *
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
function defaultGitFn(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();
}

/**
 * Tercera condición de la regla: veredicto sobre los worktrees de la sesión.
 * never-throws — cualquier fallo colapsa a `unknown`, que el caller trata como «no
 * descartar».
 *
 * Corta en la PRIMERA respuesta que impida descartar (`dirty` o `unknown`): no hace falta
 * seguir mirando, y así el caso caro (varios worktrees) no paga de más.
 *
 * Un probe de existencia que LANZA (EACCES, FUSE caído) NO se lee como ausencia: se
 * asume presente y se pregunta a git, que es quien manda. Si git tampoco contesta, el
 * veredicto es `unknown` — mismo fail-safe de KODO-21.
 *
 * @param {{
 *   paths: string[],
 *   gitFn?: (cwd: string, args: string[]) => Promise<string> | string,
 *   existsFn?: (path: string) => boolean,
 * }} args
 * @returns {Promise<WorktreeVerdict>}
 */
export async function inspectWorktrees({ paths, gitFn = defaultGitFn, existsFn = pathPresent }) {
  /** @type {WorktreeVerdict} */
  let verdict = { status: 'absent', path: null };

  for (const path of paths || []) {
    let present;
    try {
      present = Boolean(existsFn(path));
    } catch {
      present = true; // ante la duda, presente: que decida git.
    }
    if (!present) continue;

    let status;
    try {
      status = await gitFn(path, ['status', '--porcelain']);
    } catch {
      // git no contesta sobre este directorio (worktree podado, repo roto, permisos):
      // no se puede afirmar que esté limpio, así que no se descarta.
      return { status: 'unknown', path };
    }
    if (String(status ?? '').trim().length > 0) return { status: 'dirty', path };

    verdict = { status: 'clean', path };
  }

  return verdict;
}

/**
 * Un pase del barrido. never-throws: cada sesión va en su propio try/catch y cualquier
 * duda deja la fila donde estaba.
 *
 * ORDEN DELIBERADO — worktree ANTES que provider. Al revés que el barrido de huérfanas,
 * que pregunta al provider primero porque su gate es de estado. Aquí la condición local
 * es barata (un `lstat` y un `git status`) y la de red no, así que una fila con trabajo
 * sin commitear —el caso que NUNCA se va a descartar— no gasta una llamada al provider
 * cada diez minutos para llegar siempre a la misma conclusión.
 *
 * @param {object} deps
 * @param {() => { sessions?: Record<string, Session> }} deps.loadStateFn
 * @param {(taskId: string) => Promise<{ status: number, body?: any }>} deps.dismissFn -
 *   el handler de `server/dismiss.js`. Es el ÚNICO camino destructivo: este módulo no
 *   borra nada por su cuenta.
 * @param {{ getTaskState?: Function }} deps.provider
 * @param {() => number} deps.now - clock inyectable (ms).
 * @param {(taskId: string, updates: object) => any} [deps.updateSessionFn] - escritor de
 *   la marca de backoff. OPCIONAL: sin él el barrido funciona igual, solo pierde el
 *   backoff y repregunta cada tick.
 * @param {(cwd: string, args: string[]) => Promise<string> | string} [deps.gitFn]
 * @param {(path: string) => boolean} [deps.existsFn]
 * @param {{ info?: Function, warn?: Function, debug?: Function }} [deps.logger]
 * @returns {Promise<{ candidates: number, dismissed: number, kept: number, deferred: number }>}
 *   `dismissed` = filas retiradas; `kept` = candidatas que NO cumplen la regla (worktree
 *   sucio o tarea todavía abierta) y siguen esperando el dismiss manual; `deferred` =
 *   aplazadas por no poder decidir (provider caído, git mudo, dismiss sin 200).
 */
export async function runAutoDismissSweep({
  loadStateFn,
  dismissFn,
  provider,
  now,
  updateSessionFn,
  gitFn,
  existsFn,
  logger,
}) {
  const stats = { candidates: 0, dismissed: 0, kept: 0, deferred: 0 };

  // Capability gate, mismo criterio que el resto de barridos: sin lectura de estado
  // remoto no se puede afirmar que la tarea esté cerrada, y sin la afirmación no hay
  // regla. Un provider sin `getTaskState` → no-op silencioso.
  if (typeof dismissFn !== 'function') return stats;
  if (!provider || typeof provider.getTaskState !== 'function') return stats;

  let state;
  try {
    state = loadStateFn();
  } catch (err) {
    logger?.warn?.('session.auto_dismiss.load_failed', {
      detail: String(/** @type {any} */ (err)?.message || '').slice(0, 200),
    });
    return stats;
  }

  const at = now();

  for (const [taskId, session] of Object.entries((state && state.sessions) || {})) {
    if (!isAutoDismissCandidate(session, at)) continue;
    stats.candidates += 1;

    // ── Condición 3 (local, barata) ────────────────────────────────────────────
    const worktree = await inspectWorktrees({
      paths: worktreePathsFor(session),
      gitFn,
      existsFn,
    });

    if (worktree.status === 'dirty') {
      stats.kept += 1;
      markAttempt(updateSessionFn, taskId, at);
      logger?.debug?.('session.auto_dismiss.kept', {
        task_id: taskId,
        reason: 'worktree-dirty',
        worktree: worktree.path,
      });
      continue;
    }
    if (worktree.status === 'unknown') {
      stats.deferred += 1;
      markAttempt(updateSessionFn, taskId, at);
      logger?.warn?.('session.auto_dismiss.worktree_unknown', {
        task_id: taskId,
        worktree: worktree.path,
      });
      continue;
    }

    // ── Condición 2 (red) ──────────────────────────────────────────────────────
    // Shape combinado {id, projectId, url, ref}: cubre Plane ({id, projectId}) y GitHub
    // ({ref}) sin ramificar por provider (espejo de runOrphanSweep).
    const task = {
      id: session.task_id,
      projectId: session.project_id,
      url: session.task_url,
      ref: session.task_ref,
    };

    let taskState;
    try {
      taskState = await provider.getTaskState(task);
    } catch (err) {
      stats.deferred += 1;
      markAttempt(updateSessionFn, taskId, at);
      logger?.warn?.('session.auto_dismiss.getstate_failed', {
        task_id: taskId,
        detail: String(/** @type {any} */ (err)?.message || '').slice(0, 200),
      });
      continue;
    }

    if (!isClosedTaskState(taskState)) {
      stats.kept += 1;
      markAttempt(updateSessionFn, taskId, at);
      logger?.debug?.('session.auto_dismiss.kept', {
        task_id: taskId,
        reason: 'task-open',
        task_state: String(taskState),
      });
      continue;
    }

    // ── Las tres se cumplen: se delega la mutación ─────────────────────────────
    let res;
    try {
      res = await dismissFn(taskId);
    } catch (err) {
      // El handler es never-throws por contrato, pero si un día deja de serlo el
      // barrido no debe caerse con él.
      stats.deferred += 1;
      markAttempt(updateSessionFn, taskId, at);
      logger?.warn?.('session.auto_dismiss.failed', {
        task_id: taskId,
        detail: String(/** @type {any} */ (err)?.message || '').slice(0, 200),
      });
      continue;
    }

    if (!res || res.status !== 200) {
      // 409 = la sesión revivió entre la comprobación y el DELETE (el guard del handler
      // hizo su trabajo); 500 = doctor no pudo sanear. Ninguno es un descarte.
      stats.deferred += 1;
      markAttempt(updateSessionFn, taskId, at);
      logger?.warn?.('session.auto_dismiss.rejected', {
        task_id: taskId,
        status: res?.status,
      });
      continue;
    }

    stats.dismissed += 1;
    // El helper llama `logger.info` sin guardas: un logger parcial (los stubs de otros
    // loops solo traen `warn`) lo haría lanzar dentro del bucle.
    if (logger && typeof logger.info === 'function') {
      sessionAutoDismissed(/** @type {any} */ (logger), {
        task_id: taskId,
        session_id: session.session_id,
        task_state: taskState,
        worktree: worktree.status,
        actions_count: Array.isArray(res.body?.actions) ? res.body.actions.length : 0,
      });
    }
  }

  return stats;
}

/**
 * Escribe la marca de backoff. never-throws y sin retorno: a diferencia del sello del
 * barrido de huérfanas, esta marca no cierra ningún ciclo — si no persiste, lo único que
 * pasa es que la fila se repregunta en el tick siguiente. No hay nada que reintentar ni
 * que contar aparte.
 *
 * @param {((taskId: string, updates: object) => any) | undefined} updateSessionFn
 * @param {string} taskId
 * @param {number} at
 */
function markAttempt(updateSessionFn, taskId, at) {
  if (typeof updateSessionFn !== 'function') return;
  try {
    updateSessionFn(taskId, { auto_dismiss_attempt_at: new Date(at).toISOString() });
  } catch {
    // El escritor degrada a {ok:false} sin lanzar (D-03); un throw inesperado tampoco
    // debe tumbar el barrido.
  }
}
