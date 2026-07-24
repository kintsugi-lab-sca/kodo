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
import { performTerminalCleanup } from './terminal-cleanup.js';
// Phase 74 (D-07/D-13): el handoff acumulativo. El FORMATO entero vive en
// session/handoff.js (hoja pura, cero imports); aquí solo hay I/O + orquestación.
import { withFileLock } from '../session/state-lock.js';
import {
  isSafeTaskId,
  buildPlanHeader,
  buildHandoffBlock,
  findSessionBlock,
  extractNext,
} from '../session/handoff.js';
// Único símbolo de config.js: la raíz de ~/.kodo, para construir la ruta del plan
// byte-idéntica a la del productor (session-start.js:94) y la del consumidor
// (dashboard/plan.js:69). Mismo import que ya hace session-start.js.
import { KODO_DIR } from '../config.js';
// Phase 72 HYG-04: efectos de cierre COSMÉTICOS movidos desde stop.js. Disparan
// al cierre REAL de la sesión (una vez), no al final de cada turno.
import * as cmux from '../cmux/client.js';
import { colorForStatus } from '../cmux/colors.js';
import { buildStopNudgeText } from './stop.js';

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
 *   cmux?: typeof cmux,
 *   plansDir?: string,
 *   fs?: typeof nodeFs,
 *   stateWriterFn?: typeof upsertTaskHandoff,
 *   now?: () => Date,
 * }} [deps]
 *   `plansDir`/`fs`/`stateWriterFn`/`now` (Phase 74) fluyen tal cual hasta
 *   `writeHandoff`. Sin ellos, la suite de tests escribiría en el `~/.kodo` REAL del
 *   operador en cada `npm test` (T-74-15).
 * @returns {Promise<void>}
 */
export async function runSessionEndHook(input, deps = {}) {
  const findSessionFn = deps.findSessionFn || findSession;
  const removeSessionFn = deps.removeSessionFn || removeSession;
  // Phase 72 HYG-04: cmux inyectable (default lazy al import estático) para los
  // efectos de cierre cosméticos — mismo patrón DI que stop.js.
  const cmuxClient = deps.cmux || cmux;
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
    try {
      handoffNext = writeHandoff({ session, input, log }, deps)?.next ?? null;
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

    // ── Efectos de cierre cosméticos (HYG-04, Phase 72) ────────────────────
    // MOVIDOS desde runStopHook: disparan UNA vez al cierre REAL (no por turno).
    // Orden LOCKED (D-08): van al FINAL, DESPUÉS de runReviewBackstop (:117) y del
    // cleanup terminal — nunca antes, para no alterar la transición de estado del
    // backstop DELIV-04. Cada efecto en su propio try/catch (never-throws
    // individual): un fallo de cmux NUNCA aborta los demás efectos ni el cleanup.

    // 1. Color review sobre el workspace de la sesión.
    try {
      await cmuxClient.setColor({
        workspace: session.workspace_ref,
        color: colorForStatus('review'),
      });
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

    // 3. Nudge al orquestador si está corriendo (mismo match que el código
    //    original de stop.js). buildStopNudgeText importado desde stop.js.
    try {
      const workspaces = await cmuxClient.listWorkspaces();
      const orchMatch = workspaces.match(/(workspace:\d+)\s+kodo-orchestrator/);
      if (orchMatch) {
        await cmuxClient.send({
          workspace: orchMatch[1],
          // Phase 75 LIVE-07: threadeamos el NEXT: efectivo capturado del handoff.
          // Con next → línea concreta; sin next → texto byte-idéntico al genérico (D-09).
          text: buildStopNudgeText(session, handoffNext),
        });
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
 * Backstop mecánico de «In Review» (DELIV-04, D-10..D-14). Si al cierre real de
 * la sesión la tarea sigue viva en `in_progress` (verificado con `getTaskState`,
 * NO con `session.status` local) y la sesión terminó limpia, transiciona la tarea
 * al estado review y comenta «cierre automático», emitiendo un evento NDJSON
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
 * }} args
 * @returns {Promise<void>}
 */
export async function runReviewBackstop({ session, input, provider, config, log }) {
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
