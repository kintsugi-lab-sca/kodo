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
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { findSession, removeSession, upsertTaskHandoff } from '../session/state.js';
// KODO-36: el marcador que convierte el fail-open del comentario de cierre en un
// reintento. Hoja fina sobre `withStateLock` — ver el docblock del módulo.
import { markPendingComment } from '../session/pending-comment.js';
import { resolveOrchestratorTargets, sendToOrchestrator } from '../orchestrator/target.js';
import { performTerminalCleanup } from './terminal-cleanup.js';
import { traceUnmatchedClose } from './close-guard.js';
// Phase 74 (D-07/D-13): el handoff acumulativo. El FORMATO entero vive en
// session/handoff.js (hoja pura, cero imports); aquí solo hay I/O + orquestación.
import { withFileLock } from '../session/state-lock.js';
import {
  isSafeTaskId,
  buildPlanHeader,
  buildHandoffBlock,
  findSessionBlock,
  extractNext,
  sanitizeInline,
} from '../session/handoff.js';
// Único símbolo de config.js: la raíz de ~/.kodo, para construir la ruta del plan
// byte-idéntica a la del productor (session-start.js:94) y la del consumidor
// (dashboard/plan.js:69). Mismo import que ya hace session-start.js.
import { KODO_DIR } from '../config.js';
// Phase 72 HYG-04: efectos de cierre COSMÉTICOS movidos desde stop.js. Disparan
// al cierre REAL de la sesión (una vez), no al final de cada turno.
import * as cmux from '../cmux/client.js';
import { getHost, resolveHostName } from '../host/interface.js';
import { colorForStatus } from '../cmux/colors.js';
import { buildStopNudgeText } from './stop.js';
// KODO-53: la bandeja del orquestador y su aviso de una línea. `inbox.js` es el mutador
// de `state.orchestrator_inbox` (puro-ish, sin host); `notify.js` es el único de los dos
// que tiene efectos sobre el terminal, y recibe el cliente del host por parámetro.
import { enqueueOrchestratorEvent, resolveNudgeMode } from '../orchestrator/inbox.js';
import { maybeNotifyOrchestrator } from '../orchestrator/notify.js';

const STDIN_TIMEOUT = 3000;

/**
 * Resuelve el config que este hook necesita: `orchestrator.nudges` (KODO-53) y `oracle.enabled`
 * (KODO-69). Es un cargador con red de seguridad, no un lector de una clave concreta — de ahí
 * que sea uno solo para los dos consumidores en vez de dos idénticos.
 *
 * Independiente del `config` que resuelve el bloque del review backstop (:249): aquel
 * vive dentro de su propio `try`, y ampliarle el alcance para reusar la variable ataría
 * el carril de avisos al del backstop — un fallo del provider dejaría el modo sin
 * resolver. Aquí solo hace falta un objeto plano.
 *
 * FAIL-SAFE a `{}` → `resolveNudgeMode` cae a `'inbox'`, el default. Never-throws: el
 * aviso es una conveniencia y jamás debe impedir que un cierre termine.
 *
 * @param {{ config?: any }} deps
 * @returns {Promise<any>}
 */
async function resolveHookConfig(deps) {
  if (deps?.config !== undefined) return deps.config;
  try {
    const { loadConfig } = await import('../config.js');
    return loadConfig();
  } catch {
    return {};
  }
}

/**
 * Lanza `kodo oracle run <ref>` DETACHED y vuelve inmediatamente (KODO-69).
 *
 * Copia deliberada del molde de `runPollingStartCli` (cli/polling.js): `process.execPath` +
 * el path ABSOLUTO del bin resuelto desde `import.meta.url`, nunca `kodo` por PATH. El hook
 * corre bajo el entorno de Claude Code, donde no hay garantía de que el PATH traiga el binario
 * de esta instalación — y ejecutar el kodo de OTRA instalación sería peor que no ejecutar
 * ninguno.
 *
 * `stdio: 'ignore'` y no un logfile: la corrida ya deja su traza donde importa (el bloque
 * `oracle` de la entrada de la cola, y el NDJSON de `integration.oracle.attached`). Un tercer
 * canal de salida sería un fichero que nadie lee.
 *
 * `unref()` es lo que permite al hook TERMINAR sin esperar a la corrida: sin él, el proceso
 * padre se quedaría colgado hasta que acabara la última suite — exactamente lo que esta fase
 * evita (Pitfall #2 de polling.js, mismo comentario).
 *
 * NEVER-THROWS. Un spawn que no sale deja la entrada con `oracle: null`, que es la lectura
 * honesta: nadie ha verificado esa rama.
 *
 * @param {string} ref `task_ref` de la entrada recién encolada.
 * @returns {Promise<boolean>} `true` si el hijo quedó lanzado. El caller no lo espera para nada
 *   más que la traza — el `await` cubre el `import()`, no la corrida.
 */
async function spawnOracleRun(ref) {
  try {
    const { spawn } = await import('node:child_process');
    // src/hooks/session-end.js → ../../bin/kodo (mismo cálculo que polling.js:resolveKodoBin,
    // ajustado a la profundidad de este fichero).
    const kodoBin = join(fileURLToPath(new URL('../../bin/kodo', import.meta.url)));
    const child = spawn(process.execPath, [kodoBin, 'oracle', 'run', ref], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    return true;
  } catch (err) {
    console.error(`[kodo:oracle] spawn fail-open: ${/** @type {Error} */ (err).message}`);
    return false;
  }
}

/**
 * Resuelve el probe «¿existe esta ruta?» que usan las DOS mitades del cierre (KODO-30):
 * la captura de integración, para resolver el worktree del que leer la rama, y el cleanup
 * terminal, para decidir si el worktree sigue en disco. Un único punto de resolución para
 * que no puedan discrepar sobre el mismo directorio.
 *
 * `deps.existsFn` gana a `deps.fs`: el primero es el seam ESTRECHO (solo este probe), y con
 * él un test puede declarar «el worktree ya no está» sin sustituir el módulo `fs` entero —
 * un `fs` parcial rompería el bloque de handoff, que necesita `mkdirSync`/`writeFileSync`.
 *
 * @param {{ existsFn?: (path: string) => boolean, fs?: typeof nodeFs }} deps
 * @returns {(path: string) => boolean}
 */
function resolveExistsFn(deps) {
  if (typeof deps.existsFn === 'function') return deps.existsFn;
  return (p) => (deps.fs || nodeFs).existsSync(p);
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
 *   listSessionsForPathFn?: (cwd: string) => {id: string, session: any}[],
 *   unmatchedLoggerFactory?: () => any,
 *   removeSessionFn?: typeof removeSession,
 *   loggerFactory?: (binding: {session_id: string, task_id: string}) => any,
 *   gitFn?: (cwd: string, args: string[]) => Promise<string> | string,
 *   provider?: any,
 *   config?: any,
 *   cmux?: typeof cmux,
 *   plansDir?: string,
 *   fs?: typeof nodeFs,
 *   existsFn?: (path: string) => boolean,
 *   stateWriterFn?: typeof upsertTaskHandoff,
 *   now?: () => Date,
 *   getOrchestratorFn?: () => { workspace_ref?: string }|null,
 *   captureIntegrationFn?: typeof import('../integration/capture.js').captureIntegration,
 *   spawnOracleFn?: (ref: string) => Promise<boolean>|boolean,
 *   markPendingCommentFn?: typeof markPendingComment,
 *   enqueueOrchestratorEventFn?: typeof import('../orchestrator/inbox.js').enqueueOrchestratorEvent,
 *   maybeNotifyOrchestratorFn?: typeof import('../orchestrator/notify.js').maybeNotifyOrchestrator,
 * }} [deps]
 *   `existsFn` (KODO-30) es el seam ESTRECHO del probe de existencia del worktree: lo
 *   consumen la captura de integración y el cleanup terminal (ver `resolveExistsFn`). Gana a
 *   `fs` a propósito — un test que quiera declarar «el worktree ya no está» no debería tener
 *   que sustituir el módulo `fs` entero y dejar sin `mkdirSync` al bloque de handoff.
 *   `plansDir`/`fs`/`stateWriterFn`/`now` (Phase 74) fluyen tal cual hasta
 *   `writeHandoff`. Sin ellos, la suite de tests escribiría en el `~/.kodo` REAL del
 *   operador en cada `npm test` (T-74-15).
 *   `getOrchestratorFn` (KODO-20) es la MISMA clase de seam, un escalón más abajo: desde
 *   KODO-16 el destinatario del nudge sale del registro `state.orchestrator`, así que sin
 *   inyectarlo el hook LEE el `~/.kodo/state.json` real y el resultado de la suite pasa a
 *   depender de si la máquina tiene un orquestador vivo. Fluye tal cual hasta
 *   `resolveOrchestratorTargets`; sin él, el default es el `getOrchestrator` real.
 *   `captureIntegrationFn` (KODO-26) cierra la MISMA fuga por tercera vez, ahora en escritura:
 *   la captura de la cola encola en el `~/.kodo/state.json` real y consulta git de verdad, así
 *   que un test que no lo inyecte ensucia el HOME del operador en cada `npm test` (T-74-15) y
 *   además mete comandos git propios en cualquier stub de `gitFn` que la suite esté contando.
 *   Sin él, el default es el `captureIntegration` real.
 *   `markPendingCommentFn` (KODO-36) cierra la MISMA fuga por cuarta vez: el marcador de
 *   comentario pendiente. Solo se ejerce cuando el `addComment` del backstop falla — o sea,
 *   justo en los tests que simulan el provider caído. Fluye tal cual hasta
 *   `runReviewBackstop`; sin él, el default es el `markPendingComment` real.
 *   `enqueueOrchestratorEventFn`/`maybeNotifyOrchestratorFn` (KODO-53) la cierran por quinta
 *   y sexta vez, sobre el bloque nuevo `state.orchestrator_inbox`: sin ellos, cada cierre de
 *   la suite ENCOLA un evento en el `~/.kodo/state.json` real del operador y, si además tiene
 *   un orquestador idle, le TECLEA un aviso en su terminal. Sin ellos, los defaults son
 *   `enqueueOrchestratorEvent` y `maybeNotifyOrchestrator`.
 *
 *   El patrón se repite porque la causa es estructural: `config.js` evalúa `homedir()` en
 *   module-load, así que CADA escritor nuevo de `state.json` que entre a este hook reabre la
 *   fuga por su cuenta y necesita su propio seam. Si añades uno, añade el seam con él.
 * @returns {Promise<void>}
 */
/**
 * Resuelve el cliente de lifecycle del host ACTIVO para los efectos de cierre (KODO-18).
 *
 * Devuelve `host._legacy` — el mismo shape de funciones que expone `cmux/client.js`, que
 * es lo que este hook lleva consumiendo desde la Phase 72. FAIL-SAFE: cualquier fallo de
 * resolución (config ilegible, host sin `_legacy`) cae al módulo cmux importado, o sea al
 * comportamiento anterior a KODO-18. Nunca lanza: los efectos de cierre son cosméticos y
 * jamás deben impedir que el hook termine.
 *
 * @returns {any} cliente con setStatus/setColor/notify/listWorkspaces/send.
 */
function resolveHostClient() {
  try {
    return getHost(resolveHostName())?._legacy || cmux;
  } catch {
    return cmux;
  }
}

export async function runSessionEndHook(input, deps = {}) {
  const findSessionFn = deps.findSessionFn || findSession;
  const removeSessionFn = deps.removeSessionFn || removeSession;
  // Phase 72 HYG-04: cliente del host inyectable para los efectos de cierre cosméticos
  // — mismo patrón DI que stop.js. El nombre del seam (`deps.cmux`) se conserva por
  // compatibilidad con los stubs de la suite.
  //
  // KODO-18: el DEFAULT deja de ser el módulo cmux y pasa a ser el `_legacy` del host
  // ACTIVO, así que con `host: 'orca'` estos efectos aterrizan en Orca. Fail-safe: si la
  // resolución del host falla por lo que sea, se cae al import estático de cmux — el
  // comportamiento previo — en vez de dejar la sesión sin cerrar sus efectos.
  const cmuxClient = deps.cmux || resolveHostClient();
  try {
    const sessionId = input.session_id;
    const cwd = input.cwd || process.cwd();

    // KODO-27 — lookup por IDENTIDAD, sin fallback por cwd. SessionEnd es el camino
    // MÁS destructivo del sistema: escribe el handoff, postea el comentario de cierre
    // y mueve la tarea a review en el provider, y termina en `performTerminalCleanup`
    // (worktree remove + branch -D + removeSession). Ese helper NO comprueba liveness
    // — con la sesión mal imputada correría contra una sesión VIVA; el 20-ago sólo se
    // frenó porque el worktree estaba `locked` y el `git worktree remove` falló.
    //
    // El fallback por cwd que había aquí sólo podía acertar por casualidad: una sesión
    // de kodo corre en su worktree, no en `project_path`, así que el cwd sólo matchea
    // sesiones AJENAS lanzadas en la raíz del repo. Ver la misma nota en stop.js:158 y
    // en `findSession` (src/session/state.js).
    //
    // Fail-closed: sin match por `session_id`, no se toca nada. El coste de fallar
    // cerrado es un cierre perdido (recuperable vía reconcile / `kodo doctor`); el de
    // fallar abierto es destruir el worktree de otra sesión mientras trabaja.
    let result = findSessionFn({ sessionId });

    // Idempotencia (D-3): sin sesión tracked → nada que limpiar (p.ej. la sesión
    // del orquestador o una sesión ad-hoc no adoptada). No-op silencioso.
    if (!result) {
      console.error(`[kodo:session-end] No matching session — nothing to clean`);
      // KODO-27: traza del no-op — sólo si había sesiones vivas en este cwd, o sea
      // si el fallback de antes habría cerrado una tarea ajena. Never-throws.
      await traceUnmatchedClose({ hook: 'session-end', sessionId, cwd }, deps);
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

    // ── Handoff acumulativo (Phase 74, D-07 / LIVE-01/03/04) ───────────────
    // Escribe el bloque de handoff en ~/.kodo/plans/<task_id>.md y persiste el
    // puntero + el NEXT en state.tasks. Va AQUÍ, tras los guards de idempotencia
    // (:72-83) y la construcción del `log` (que D-06 necesita para el warn del
    // lock-timeout), y ANTES del backstop: el handoff es una escritura a DISCO
    // (barata, sin red) y es el dato más valioso de la fase — si el backstop se
    // atasca en red, el handoff ya aterrizó. Queda muy por delante de
    // performTerminalCleanup (worktree + promptFile + removeSession), como exige
    // LIVE-01: el dato SIEMPRE aterriza antes del cleanup destructivo.
    //
    // NO altera el orden LOCKED `backstop → setColor → notify` (D-08, v0.16 Phase
    // 71): se inserta ANTES del trío, no lo reordena.
    //
    // El try/catch propio (además del outer never-throws) es ESTRUCTURAL, no
    // cosmético — misma razón que el backstop: el contrato «never throws» de
    // withFileLock aplica SOLO al agotamiento de reintentos. En el código real
    // acquireLock hace mkdirSync (state-lock.js:73, puede lanzar) y re-lanza todo
    // error que no sea EEXIST (:81), y withFileLock corre `fn()` en un try/finally
    // SIN catch (:226-230) → un fn que lanza propaga. Sin este catch, un
    // EACCES/EROFS crashearía el hook y bloquearía el cierre de Claude Code (SC#5).
    // Phase 75 LIVE-07: capturamos el `next` EFECTIVO que writeHandoff devuelve
    // (post-asimetría) para threadearlo al nudge del orquestador más abajo. El
    // try/catch estructural se conserva íntegro: un fallo del threading colapsa
    // handoffNext a null (nudge genérico) y JAMÁS aborta el cierre (never-throws, SC5).
    let handoffNext = null;
    // KODO-11: además del `next` para el nudge, retenemos la RUTA del plan para que el
    // comentario del backstop pueda apuntar al handoff (ver buildBackstopComment).
    let handoffPlanPath = null;
    try {
      const handoffResult = writeHandoff({ session, input, log }, deps);
      handoffNext = handoffResult?.next ?? null;
      handoffPlanPath = handoffResult?.planPath ?? null;
    } catch (err) {
      console.error(`[kodo:session-end] Handoff error: ${/** @type {Error} */ (err).message}`);
    }

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
      await runReviewBackstop({
        session,
        input,
        provider,
        config,
        log,
        // KODO-11: el handoff que acaba de aterrizar (dos bloques más arriba) es lo
        // único que kodo sabe del trabajo hecho cuando el LLM no comentó nada.
        handoff: { next: handoffNext, planPath: handoffPlanPath },
        // KODO-36: seam del marcador de comentario pendiente (default real dentro).
        markPendingCommentFn: deps.markPendingCommentFn,
      });
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

    // ── Rescate de la rama huérfana (KODO-68) ──────────────────────────────
    // Va ANTES de la captura, y no después, porque la captura MIDE: si la rama ya no existe,
    // `countUnmergedCommits` falla sobre una ref inexistente y la entrada entra en la cola con
    // `commits_ahead: null`, `base_ok: null` y `suggested: review` — apuntando a una rama que
    // no está. Restaurada primero, la captura opera sobre el repo real y encola un veredicto
    // de verdad.
    //
    // Quién borró la rama, si el gate KODO-21 nunca lo hace: el «Remove worktree» que Claude
    // Code ofrece al salir, que hace `branch -D` sin comprobar si quedaba trabajo dentro.
    //
    // FAIL-OPEN: `restoreOrphanedBranch` es never-throws de cuerpo entero; este try/catch
    // cubre además el `await import()`.
    try {
      const { restoreOrphanedBranch } = await import('./worktree-cleanup.js');
      const { defaultGitFn } = await import('./terminal-cleanup.js');
      await restoreOrphanedBranch({
        project: session.project_path,
        branch: session.branch || null,
        head: session.branch_head || null,
        sessionId: session.session_id,
        worktreePath: session.worktree_path || '',
        gitFn: deps.gitFn || defaultGitFn,
        logger: log,
      });
    } catch (err) {
      console.error(`[kodo:session-end] branch restore error: ${/** @type {Error} */ (err).message}`);
    }

    // ── Captura de la cola de integración (KODO-26) ────────────────────────
    // Va AQUÍ, en el último hueco ANTES del cleanup terminal, por una razón mecánica: el
    // nombre de la rama se lee del worktree de la sesión, y `performTerminalCleanup` lo
    // remueve tres líneas más abajo. Detrás del cleanup no habría dónde leerlo.
    //
    // Va DESPUÉS del handoff (:190) y del backstop a propósito: los dos son más valiosos que
    // esto. Si algo se atasca, lo que tiene que haber aterrizado ya es el handoff.
    //
    // FAIL-OPEN (invariante del enunciado): la sesión cierra igual si la captura falla. La
    // cola es conveniencia — la rama con trabajo sin mergear ya sobrevive al cleanup por
    // KODO-21, así que aquí nunca se pierde trabajo, solo la comodidad de verlo listado.
    // `captureIntegration` ya es never-throws de cuerpo entero; este try/catch cubre además el
    // `await import()` y la resolución del worktree.
    try {
      const { captureIntegration } = deps.captureIntegrationFn
        ? { captureIntegration: deps.captureIntegrationFn }
        : await import('../integration/capture.js');
      const { resolveEffectiveWorktree, defaultGitFn } = await import('./terminal-cleanup.js');
      // Sesión con worktree de kodo → se lee de ahí (incluidas las de Orca, cuyo checkout no se
      // limpia pero sí tiene la rama). Sesión adoptada sin worktree → se lee del propio repo.
      const captureDir = session.worktree_path
        ? resolveEffectiveWorktree(session, resolveExistsFn(deps))
        : null;
      const capture = await captureIntegration({
        session,
        worktree: captureDir,
        gitFn: deps.gitFn || defaultGitFn,
        logger: log,
      });
      if (capture.captured && capture.entry) {
        console.error(
          `[kodo:integrate] cola — ${capture.entry.branch}: ${capture.entry.commits_ahead ?? '?'} commits, sugerencia ${capture.entry.suggested}`,
        );
        // KODO-75: la tarea pidió revisión adversarial. Se avisa AQUÍ, pegado a la captura,
        // porque las dos contestan la misma pregunta —«¿qué necesita esta rama ahora?»— y
        // porque el aviso solo tiene sentido si la captura encontró rama: sin entrada en la
        // cola, `kodo review start` no sabría sobre qué repo trabajar.
        //
        // El hook AVISA, no LANZA. Crear un workspace y arrancar un agente desde un hook de
        // cierre sería el efecto más pesado de todo `SessionEnd`, en el punto del ciclo con
        // menos garantías (el worktree puede estar desapareciendo bajo los pies). El
        // lanzamiento es una acción del ORQUESTADOR, igual que `kodo launch` y que resolver
        // la cola de integración: el evento entra en la bandeja que ya lee en el paso 1 de
        // cada ronda, y él ejecuta `kodo review start` con la ronda entera de contexto.
        //
        // Dentro del `try` de la captura a propósito: fail-open por la misma razón y con el
        // mismo coste — perder el aviso deja la revisión pendiente y visible en la cola, que
        // es recuperable; tumbar el cierre de la sesión, no.
        if (session.review === true) {
          const enqueueFn = deps.enqueueOrchestratorEventFn || enqueueOrchestratorEvent;
          enqueueFn({
            kind: 'review-requested',
            task_ref: session.task_ref,
            session_id: session.session_id,
            text:
              `${session.task_ref} pidió revisión adversarial (kodo:review) y su sesión de trabajo ha cerrado. ` +
              `Rama ${capture.entry.branch} en ${capture.entry.project_path}. ` +
              `Lanza el segundo par de ojos con \`kodo review start ${session.task_ref}\` — ` +
              `NO integres la rama hasta que \`kodo review ${session.task_ref}\` diga «aprobado».`,
          }, log);
        }

        // KODO-69: el ORÁCULO MECÁNICO. Aquí solo se LANZA — nada de este hook corre una
        // suite.
        //
        // Es la diferencia entre esta fase y el `--test` de `kodo integrate`: aquel lo teclea
        // el operador y él espera; esto pasa solo, al cerrar, y nadie está delante. Correrlo
        // en línea metería un `npm ci && npm test` DENTRO del cierre de la sesión — minutos
        // de hook bloqueando a Claude Code, y encima con el worktree a punto de borrarse tres
        // líneas más abajo.
        //
        // El runner detached se crea su propio worktree desechable sobre el commit de la rama,
        // así que sobrevive al `performTerminalCleanup` que viene justo después. Su resultado
        // aterriza en la MISMA entrada de la cola vía `attachOracle`, minutos más tarde, sin
        // que nada más tenga que esperarlo.
        //
        // Fail-open, como todo lo de este bloque: si el spawn no sale, la entrada se queda con
        // `oracle: null` («nadie ha verificado esto»), que es la lectura honesta y la que hace
        // fallar cerrado al gate opcional.
        try {
          const { oracleEnabled } = await import('../integration/oracle.js');
          const oracleCfg = await resolveHookConfig(deps);
          if (oracleEnabled(oracleCfg)) {
            const spawnOracle = deps.spawnOracleFn || spawnOracleRun;
            // Se dispara con la RAMA, no con el `task_ref`. Una entrada se identifica por
            // (project_path, branch), así que una tarea que tocó dos repos en dos sesiones deja
            // dos entradas con el MISMO task_ref — y `kodo oracle run KODO-69` resolvería la
            // primera, que puede no ser la que acaba de cerrar. La rama es la mitad
            // discriminante del par, y el selector la prueba igual (task_ref primero, rama
            // después), así que es estrictamente más preciso.
            await spawnOracle(capture.entry.branch);
          }
        } catch (err) {
          console.error(`[kodo:oracle] no se pudo lanzar la verificación: ${/** @type {Error} */ (err).message}`);
        }
      }
    } catch (err) {
      console.error(`[kodo:session-end] Integration capture error: ${/** @type {Error} */ (err).message}`);
    }

    // Cleanup terminal destructivo (helper compartido, fail-open por paso).
    // KODO-30: el `fs` inyectado llega hasta aquí. El cleanup decide con él si el worktree
    // sigue en disco (camino `already_gone`), y tiene que ser el MISMO `fs` con el que la
    // captura de arriba resolvió el directorio — si no, las dos mitades del cierre podrían
    // discrepar sobre si el worktree existe.
    await performTerminalCleanup({
      id,
      session,
      gitFn: deps.gitFn,
      loggerFactory: deps.loggerFactory,
      removeSessionFn,
      existsFn: resolveExistsFn(deps),
    });

    // ── Efectos de cierre cosméticos (HYG-04, Phase 72) ────────────────────
    // MOVIDOS desde runStopHook: disparan UNA vez al cierre REAL (no por turno).
    // Orden LOCKED (D-08): van al FINAL, DESPUÉS de runReviewBackstop (:117) y del
    // cleanup terminal — nunca antes, para no alterar la transición de estado del
    // backstop DELIV-04. Cada efecto en su propio try/catch (never-throws
    // individual): un fallo de cmux NUNCA aborta los demás efectos ni el cleanup.

    // 1. Marca de `review` sobre el workspace de la sesión (color de tab en cmux,
    //    columna del tablero en Orca).
    //
    //    KODO-18: se prefiere el verbo HOST-AGNÓSTICO `setStatus` cuando el cliente lo
    //    expone, y se cae a `setColor(colorForStatus('review'))` cuando no — el mismo
    //    idiom typeof-detected que ya usan `listAgentSurfaces` y `_legacy.rename`. Los
    //    dos hosts reales implementan `setStatus`; la rama de fallback cubre los stubs
    //    cmux-shaped de la suite sin obligarlos a crecer.
    try {
      if (typeof cmuxClient.setStatus === 'function') {
        await cmuxClient.setStatus({ workspace: session.workspace_ref, status: 'review' });
      } else {
        await cmuxClient.setColor({
          workspace: session.workspace_ref,
          color: colorForStatus('review'),
        });
      }
    } catch (err) {
      console.error(`[kodo] Error setting color: ${/** @type {Error} */ (err).message}`);
    }

    // 2. Notificación de cierre.
    try {
      await cmuxClient.notify({
        title: `kodo: ${session.task_ref} cerrada`,
        body: session.summary,
        workspace: session.workspace_ref,
      });
    } catch {}

    // 3. Aviso al orquestador — KODO-53. Hasta aquí, este bloque TECLEABA
    //    `buildStopNudgeText` en el prompt del orquestador vía `cmuxClient.send`, y ese
    //    era el problema: el hook corre al cerrar, pero la ronda ya había leído el
    //    comentario final en el provider y la pantalla, así que el nudge contaba algo
    //    sabido — a veces con la tarea ya mergeada y en Done. Y si el orquestador estaba
    //    en un turno largo, los nudges se acumulaban y aparecían todos juntos,
    //    desordenados respecto de la realidad, en el prompt del operador.
    //
    //    Ahora el texto largo va a la BANDEJA (`state.orchestrator_inbox`), que la ronda
    //    lee en el mismo `cat state.json` del paso 1, y el teclado se reserva para un
    //    aviso de UNA línea que solo sale si el orquestador está IDLE (con debounce de
    //    30 s, para que tres cierres seguidos sean un aviso y no tres).
    //
    //    `buildStopNudgeText` NO cambia: sigue pura, con sus goldens, y su salida es
    //    ahora el `text` del evento. Es contenido para LEER en la ronda, no para teclear.
    //
    //    KODO-20 (intacto): `deps.getOrchestratorFn` se threadea explícitamente. Sin él,
    //    `resolveOrchestratorTargets` cae a su default (el `getOrchestrator` real) y el
    //    hook LEE el state.json del operador — con un orquestador vivo, el stub de
    //    `listWorkspaces` de los tests pierde frente al registro y la suite se vuelve
    //    dependiente de la máquina. Mismo motivo que `plansDir`/`stateWriterFn`.
    try {
      // Phase 75 LIVE-07 (intacto): el NEXT: efectivo capturado del handoff. Con next →
      // línea concreta; sin next → texto byte-idéntico al genérico (D-09).
      const nudgeText = buildStopNudgeText(session, handoffNext);
      const mode = resolveNudgeMode(await resolveHookConfig(deps));

      if (mode === 'keystroke') {
        // Carril LEGACY, opt-in explícito: el texto largo se teclea tal cual y NO pasa por
        // la bandeja. Comportamiento byte-idéntico al previo a KODO-53 para quien lo
        // quiera de vuelta.
        const workspaces = await cmuxClient.listWorkspaces().catch(() => '');
        await sendToOrchestrator(
          (opts) => cmuxClient.send(opts),
          resolveOrchestratorTargets(workspaces, { getOrchestratorFn: deps.getOrchestratorFn }),
          nudgeText,
        );
      } else {
        // `inbox` (default) y `off` comparten la ESCRITURA: el evento se persiste siempre.
        // La bandeja es el estado, no la notificación — «off» apaga el teclado, no la
        // memoria (si apagara ambas, un cierre durante una ausencia se perdería, que es
        // justo lo contrario de lo que KODO-53 arregla).
        const enqueueFn = deps.enqueueOrchestratorEventFn || enqueueOrchestratorEvent;
        enqueueFn(
          {
            kind: 'session-end',
            task_ref: session.task_ref,
            session_id: session.session_id,
            text: nudgeText,
          },
          log,
        );

        if (mode === 'inbox') {
          const notifyFn = deps.maybeNotifyOrchestratorFn || maybeNotifyOrchestrator;
          await notifyFn({
            hostClient: cmuxClient,
            getOrchestratorFn: deps.getOrchestratorFn,
            logger: log,
          });
        }
      }
    } catch {}
  } catch (err) {
    console.error(`[kodo] SessionEnd hook error: ${/** @type {Error} */ (err).message}`);
  }
}

/**
 * Escribe el handoff de la sesión en `~/.kodo/plans/<task_id>.md` y persiste el puntero
 * en `state.tasks` (Phase 74, LIVE-01/LIVE-03/LIVE-04).
 *
 * ── SÍNCRONA POR CONTRATO, NO POR ESTILO (RESEARCH §Pitfall 4) ───────────────────
 * `withFileLock` ejecuta `fn()` dentro de un `try/finally` que libera el lock en el
 * `finally` (`state-lock.js:226-230`) y **no distingue una Promise**. Un `fn` asíncrono
 * devolvería `{ok:true, value: Promise}` y el lock se liberaría ANTES de que la escritura
 * aterrizara — la sección crítica no protegería nada y volvería el *lost update* que D-08
 * existe para evitar (T-74-04). Precedentes del mismo razonamiento en el repo:
 * `reconcile.js:357-359` y el `sleepSync` con `Atomics.wait` de `state-lock.js:39-48`.
 *
 * ── PROPAGA; NO CAPTURA ──────────────────────────────────────────────────────────
 * Un EACCES/EROFS de lectura sale por aquí a propósito: quien lo captura es el try/catch
 * propio del seam en `runSessionEndHook` (SC#5). Duplicar el catch aquí escondería el
 * fallo al caller sin ganar nada.
 *
 * @param {{ session: any, input: {reason?: string}, log: any }} args
 * @param {{
 *   plansDir?: string,
 *   fs?: typeof nodeFs,
 *   stateWriterFn?: typeof upsertTaskHandoff,
 *   now?: () => Date,
 * }} [deps]
 *   `plansDir`/`stateWriterFn` NO son un lujo de testing: sin ellos, la suite del hook
 *   (que no aísla HOME) escribiría en el `~/.kodo` REAL del operador en cada `npm test`
 *   (T-74-15).
 * @returns {{ planPath: string, next: string|null } | void}
 *   Phase 75 LIVE-07: en éxito devuelve el `next` EFECTIVO post-upsert (el valor
 *   POST-merge del writer, `upsertResult.value.next`), NO el de esta sesión. DEBT-01:
 *   la autoría se mapea al contrato de tres estados del writer — la rama LLM pasa
 *   `next` (posible `null` → CLEAR, nudge genérico), la mecánica OMITE `next` → el
 *   writer PRESERVA el previo (nudge contextual con el NEXT: real de la tarea). En los
 *   early-returns (task_id inseguro / lock-timeout) devuelve `undefined` — el caller lo
 *   colapsa a `null` con `?.next ?? null`.
 */
export function writeHandoff({ session, input, log }, deps = {}) {
  const plansDir = deps.plansDir || join(KODO_DIR, 'plans');
  const fs = deps.fs || nodeFs;
  const stateWriterFn = deps.stateWriterFn || upsertTaskHandoff;
  const now = deps.now || (() => new Date());

  const taskId = session.task_id;

  // 1. Guard de contención (T-74-01), PRIMERA sentencia. D-09 hace de este hook un
  //    ESCRITOR: el guard ya no evita solo LEER fuera de ~/.kodo/plans/ — evita CREAR
  //    ficheros fuera del root. Logs con SOLO {task_id} (T-74-08).
  if (!isSafeTaskId(taskId)) {
    log.warn('session.handoff.unsafe_task_id', { task_id: taskId });
    return;
  }

  // 2. Ruta CONSTRUIDA, jamás derivada del input — byte-idéntica a la del productor
  //    (session-start.js:94) y a la del consumidor (dashboard/plan.js:69).
  const planPath = join(plansDir, `${taskId}.md`);
  const lockPath = `${planPath}.lock`;

  // 3. El mkdir va FUERA de la sección crítica (no necesita el lock).
  fs.mkdirSync(plansDir, { recursive: true });

  // 4. RMW bajo el lock advisory de D-08. Un tmp+rename por sí solo NO evita el *lost
  //    update* de un leer→appendear→escribir concurrente (T-74-04). El `logger` va en
  //    `opts` para que el `lock.timeout` salga por el logger inyectado y no por
  //    console.warn (`state-lock.js:218-223`).
  const r = withFileLock(
    lockPath,
    () => {
      // a. Leer el plan; si no existe, partir de la cabecera mínima (D-09). El handoff
      //    es UNIVERSAL: cubre también las ramas GSD full y bootstrap, que no producen
      //    plan ligero.
      let md;
      if (fs.existsSync(planPath)) {
        md = fs.readFileSync(planPath, 'utf-8');
      } else {
        md = buildPlanHeader({ taskRef: session.task_ref, summary: session.summary });
      }

      // b. ¿Escribió el LLM su bloque en ESTA sesión? (D-04). El detector es scoped por
      //    session_id, no por conteo: con la acumulación de LIVE-02 el plan guarda los
      //    bloques de TODAS las sesiones, y contar vería el de la sesión ANTERIOR y
      //    mataría el backstop de LIVE-03 en silencio.
      const existing = findSessionBlock(md, session.session_id);
      if (existing) {
        // El LLM ya escribió: no se appendea nada y NO se reescribe el fichero.
        // DEBT-01: `authored: 'llm'` sobrevive fuera del lock para que el call-site
        // INCLUYA la clave `next` (posiblemente `null` → clear deliberado del NEXT:
        // obsoleto cuando el LLM cerró sin línea **NEXT:**).
        return { planPath, next: extractNext(existing), authored: 'llm' };
      }

      // c. Backstop mecánico de LIVE-03. El contenido previo NUNCA se reescribe: se
      //    concatena detrás, así que queda íntegro byte a byte.
      const block = buildHandoffBlock({
        sessionId: session.session_id,
        reason: input.reason,
        status: session.status,
        at: now(),
      });
      const separator = md.length === 0 || md.endsWith('\n') ? '\n' : '\n\n';
      const out = md + separator + block;

      // d. tmp+rename con nombre ÚNICO por escritor — patrón de `saveState:280` (fix
      //    WR-02). NO se usa `writeFileAtomic` de config.js: su tmp es de nombre FIJO
      //    (`path + '.tmp'`), exactamente lo que WR-02 corrigió, porque dos escritores
      //    concurrentes lo comparten y se pisan bytes parciales. Bajo el lock sería
      //    seguro, pero el lock es ROBABLE tras el TTL de 10 s (`state-lock.js:36`), así
      //    que la garantía no es absoluta (T-74-14). Y además acoplaría a config.js.
      const tmp = planPath + '.tmp.' + process.pid + '.' + randomUUID();
      try {
        fs.writeFileSync(tmp, out);
        fs.renameSync(tmp, planPath);
      } catch (err) {
        fs.rmSync(tmp, { force: true }); // sin residuo de tmp perdido
        throw err;
      }
      // El bloque mecánico no lleva NEXT por diseño (D-03/LIVE-03). DEBT-01:
      // `authored: 'auto'` hace que el call-site OMITA la clave `next` → el writer
      // discrimina por presencia y PRESERVA el `next` previo de la tarea (no lo
      // borra: un cierre mecánico «no tuvo nada que decir», el NEXT: real sigue en
      // el plan). `next: null` se mantiene solo para el best-effort del nudge si el
      // upsert cayera por lock-timeout.
      return { planPath, next: null, authored: 'auto' };
    },
    { logger: log },
  );

  // 5. Lock ocupado → warn y fuera. El lock-timeout JAMÁS bloquea el cierre (D-06).
  if (!r.ok) {
    log.warn('session.handoff.lock_timeout', { task_id: taskId, reason: r.reason });
    return;
  }

  // 6. Puntero + NEXT en state.tasks (D-05/LIVE-04). El writer es fail-safe: ante un
  //    lock-timeout de state.json devuelve {ok:false} sin lanzar (Plan 02).
  //    DEBT-01: la autoría (que SOBREVIVE fuera del lock en `r.value.authored`) mapea
  //    al contrato de tres estados del writer. Build CONDICIONAL de la entry por
  //    presencia de la clave `next`:
  //      - rama LLM  → INCLUYE `next` (extractNext, posible `null` → clear deliberado)
  //      - mecánico  → OMITE `next` → el writer PRESERVA el previo de la tarea
  //    NUNCA se pasa `r.value.next` incondicionalmente (colapsaría ambas ramas).
  const entry = {
    plan_path: r.value.planPath,
    updated_at: now().toISOString(),
    ...(r.value.authored === 'llm' ? { next: r.value.next } : {}),
  };
  const upsertResult = stateWriterFn(taskId, entry, log);

  // Phase 75 LIVE-07: threadeamos el `next` EFECTIVO (post-upsert) al caller, que lo
  // pasa a buildStopNudgeText. CRÍTICO (RESEARCH Pitfall 5): el next del nudge es el
  // POST-asimetría (`upsertResult.value.next`), NO `r.value.next` — un cierre mecánico
  // (r.value.next = null) tras un NEXT: real de la tarea debe producir un nudge CON
  // contexto, no genérico. Si el upsert cayó por lock-timeout, best-effort al next de
  // esta sesión (`r.value.next`). Cero I/O extra: el value ya viene construido en memoria.
  const effectiveNext = upsertResult && upsertResult.ok && upsertResult.value
    ? upsertResult.value.next
    : r.value.next;
  return { planPath: r.value.planPath, next: effectiveNext };
}

/**
 * Predicado puro y never-throws (GAP 2 / DELIV-04, 71-05): decide si `reviewState`
 * es un estado que CIERRA/TERMINA la tarea. El backstop NUNCA transiciona a un
 * estado terminal (para no cerrar un issue que solo estaba en curso).
 *
 * Provider-agnostic con fallback pragmático documentado:
 *  - Es terminal si coincide (case-insensitive) con `providerCfg.states.done` — la
 *    vía provider-agnostic: el estado «done» declarado por el provider en config.
 *  - Es terminal, ADEMÁS, si el estado normalizado es el token nativo de cierre
 *    `'closed'`. Justificación: GitHub tiene un modelo binario open/closed sin
 *    columna de review no-terminal; su `states.review` por defecto ES `'closed'`
 *    (config.js:333) y su config NO declara `states.done`, así que la comparación
 *    con `states.done` no lo captura — el token `'closed'` es el mínimo pragmático
 *    necesario (el operador aceptó un check pragmático a falta de vía agnóstica barata).
 *
 * Never-throws (T-71-16): guarda `reviewState`/`states`/`done` ausentes o no-string
 * antes de normalizar; nunca lanza sobre config basura.
 *
 * @param {unknown} reviewState
 * @param {any} providerCfg
 * @returns {boolean}
 */
export function isTerminalReviewState(reviewState, providerCfg) {
  if (typeof reviewState !== 'string') return false;
  const normalized = reviewState.trim().toLowerCase();
  if (!normalized) return false;
  // Token nativo de cierre (GitHub binario open/closed).
  if (normalized === 'closed') return true;
  // Vía provider-agnostic: igualdad con el estado «done» declarado en config.
  const doneState = providerCfg && providerCfg.states && providerCfg.states.done;
  if (typeof doneState === 'string' && normalized === doneState.trim().toLowerCase()) {
    return true;
  }
  return false;
}

/**
 * Texto del comentario del backstop (KODO-11). PURO.
 *
 * El texto anterior era la cadena literal `'cierre automático'`: dejaba rastro de que
 * kodo movió la tarea, pero cero información sobre el trabajo — el humano que abría la
 * tarea seguía sin saber qué se había hecho, que es medio síntoma del bug. Ahora
 * incorpora el handoff que `writeHandoff` acaba de escribir (el `NEXT:` del LLM cuando
 * lo hubo, y siempre la ruta del fichero completo).
 *
 * Etiqueta explícitamente el comentario como NO escrito por el agente: un resumen
 * mecánico presentado como si fuera del agente sería peor que no tenerlo.
 *
 * @param {{ next?: string|null, planPath?: string|null }} [handoff]
 * @returns {string}
 */
export function buildBackstopComment(handoff) {
  const lines = [
    '🤖 Cierre automático de kodo: la sesión terminó sin postear su comentario final, así que kodo ha movido la tarea a revisión.',
  ];
  const next = handoff && typeof handoff.next === 'string' ? handoff.next.trim() : '';
  if (next) {
    lines.push('', `**NEXT:** ${sanitizeInline(next, 200)}`);
  }
  const planPath = handoff && typeof handoff.planPath === 'string' ? handoff.planPath.trim() : '';
  if (planPath) {
    lines.push('', `Handoff completo: ${sanitizeInline(planPath, 200)}`);
  }
  lines.push('', 'Revisa el handoff antes de aprobar: este resumen NO lo escribió el agente.');
  return lines.join('\n');
}

/**
 * Backstop mecánico de «In Review» (DELIV-04, D-10..D-14). Si al cierre real de
 * la sesión la tarea sigue viva en `in_progress` (verificado con `getTaskState`,
 * NO con `session.status` local) y la sesión terminó limpia, transiciona la tarea
 * al estado review y comenta el cierre automático (buildBackstopComment), emitiendo un evento NDJSON
 * tipado. La transición del LLM pasa a ser optimización, no única vía (cierra la
 * causa raíz T5). Capability-gated por `typeof`, gated por estado no-terminal
 * (GitHub SÍ implementa las 3 capacidades — su `states.review:'closed'` es
 * terminal, así que el backstop es no-op y NUNCA cierra el issue),
 * idempotente frente al LLM (no-op si la tarea ya avanzó) y fail-open por paso.
 *
 * @param {{
 *   session: any,
 *   input: {reason?: string},
 *   provider: any,
 *   config: any,
 *   log: any,
 *   handoff?: { next?: string|null, planPath?: string|null },
 *   markPendingCommentFn?: typeof markPendingComment,
 * }} args
 *   `handoff` (KODO-11, opcional): el resultado de `writeHandoff` de esta misma
 *   sesión. Solo alimenta el TEXTO del comentario; su ausencia no cambia ninguna
 *   decisión del backstop.
 *   `markPendingCommentFn` (KODO-36, opcional): seam del escritor del marcador de
 *   comentario pendiente. Sin él, el default es el `markPendingComment` real — que
 *   escribe en el `~/.kodo/state.json` del operador, así que la suite DEBE inyectarlo
 *   (misma fuga que cerraron `stateWriterFn` y `getOrchestratorFn`, T-74-15).
 * @returns {Promise<void>}
 */
export async function runReviewBackstop({ session, input, provider, config, log, handoff, markPendingCommentFn }) {
  // 1. Capability gate (D-13): guard null-first para que el `typeof` no lance;
  //    un provider sin los 3 métodos degrada a no-op silencioso. (GitHub SÍ los
  //    implementa: su no-op proviene del gate de estado no-terminal en el paso 5b.)
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

  // 5b. Gate de estado NO-TERMINAL (GAP 2 / DELIV-04, 71-05, D-11 reforzado): el
  //     backstop NUNCA transiciona a un estado que cierra/termina la tarea. Para
  //     GitHub (`states.review:'closed'`, terminal) queda no-op — NUNCA cierra el
  //     issue; para Plane (`'In review'`, no-terminal) procede. Log de skip con
  //     SOLO {session_id, task_id, state} (sin contenido de usuario, T-71-18).
  if (isTerminalReviewState(reviewState, providerCfg)) {
    log.info('session.backstop.skipped_terminal', {
      session_id: session.session_id,
      task_id: session.task_id,
      state: reviewState,
    });
    return;
  }

  // 6. Transición fail-open: un fallo de red loguea y sale sin comentar.
  try {
    await provider.updateTaskState(task, reviewState);
  } catch (err) {
    log.warn('session.backstop.transition_failed', { error: /** @type {Error} */ (err).message });
    return;
  }

  // 7. Comentario fail-open: un fallo NO impide el evento (usar addComment —
  //    contrato del provider — NO createComment, que es del cliente).
  //
  //    KODO-36: fail-open SÍ, pero ya no fail-SILENT. Hasta aquí un blip de red dejaba
  //    solo este warn en el NDJSON: la tarea SÍ había transicionado (paso 6, arriba) y el
  //    humano se encontraba una tarea en revisión sin una línea de contexto. El texto se
  //    persiste como marcador en `state.pending_comments` y el barrido de huérfanas
  //    (session/orphan-sweep.js) lo reintenta hasta publicarlo.
  //
  //    Solo el COMENTARIO se marca, no la transición: si el paso 6 falla salimos antes de
  //    llegar aquí y la tarea sigue en `in_progress`, que es un estado del que el sistema
  //    ya sabe recuperarse. Lo que no tenía segunda oportunidad era el comentario.
  const comment = buildBackstopComment(handoff);
  try {
    await provider.addComment(task, comment);
  } catch (err) {
    log.warn('session.backstop.comment_failed', { error: /** @type {Error} */ (err).message });
    // try/catch propio: el marcador es una MEJORA del fail-open, jamás una vía nueva de
    // crasheo. Si `withStateLock` no puede ni abrir el lock (EACCES/EROFS), el cierre
    // continúa exactamente como antes de KODO-36.
    try {
      const mark = markPendingCommentFn || markPendingComment;
      mark(
        {
          task_id: session.task_id,
          project_id: session.project_id ?? null,
          task_url: session.task_url ?? null,
          task_ref: session.task_ref ?? null,
          session_id: session.session_id ?? null,
          text: comment,
        },
        log,
      );
    } catch (markErr) {
      log.warn('session.backstop.pending_mark_failed', {
        error: /** @type {Error} */ (markErr).message,
      });
    }
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
