// @ts-check
//
// src/orchestrator/notify.js — KODO-53: el AVISO de una línea.
//
// La otra mitad de la bandeja (`orchestrator/inbox.js`). Aquella guarda el QUÉ; esta
// decide el CUÁNDO. La regla es una sola frase: **solo se teclea si el orquestador está
// idle**. Si está pensando, no se envía nada — la bandeja ya tiene el evento y la
// siguiente ronda lo listará. Eso elimina por construcción el modo de fallo que motivó
// KODO-53: los nudges que se acumulan durante un turno largo y aparecen todos juntos,
// desordenados respecto de la realidad, en el prompt del operador.
//
// SEPARACIÓN DE CARRILES (y por qué son dos ficheros). `inbox.js` es un mutador de
// `state.json` puro-ish: no habla con el host, no lee pantallas y sus helpers son puros.
// Este módulo es el que TIENE efectos — lee la pantalla del orquestador y teclea. Fundirlos
// obligaría a cualquier test del store a stubear un host.
//
// NUNCA `cmux` DIRECTO. El cliente entra por parámetro (`hostClient`) y en producción es
// el `host._legacy` del host ACTIVO, que ya resuelve `session-end.js`. Con `host: 'orca'`
// esto aterriza en Orca sin tocar una línea de aquí. Un hook que importara `cmux/client.js`
// rompería el confinamiento de la Phase 38 SC#5.
//
// NEVER-THROWS de cuerpo entero. El aviso es una conveniencia: ni un cmuxd caído, ni una
// pantalla ilegible, ni un lock ocupado pueden impedir que un cierre de sesión termine.
// Todos los caminos devuelven el discriminado `{ sent, reason }`.

import { noopLogger } from '../logger-noop.js';
import { resolveOrchestratorTargets, sendToOrchestrator } from './target.js';
import {
  NOTICE_DEBOUNCE_MS,
  isOrchestratorIdle,
  listOrchestratorInbox,
  markOrchestratorEventsNotified,
  shouldNotify,
  summarizeInbox,
} from './inbox.js';

/**
 * Cuántas líneas de la pantalla del orquestador se leen para decidir si está idle.
 *
 * 5 y no 15 (lo que usa la skill para diagnosticar una sesión): aquí no se interpreta lo
 * que el orquestador está haciendo, solo se mira si su ÚLTIMA línea no vacía es el prompt.
 * Menos líneas = menos superficie de texto no confiable cruzando el proceso.
 */
const IDLE_PROBE_LINES = 5;

/**
 * @typedef {'sent'|'nothing-unseen'|'debounced'|'no-orchestrator'|'unreadable'|'busy'|'send-failed'|'error'} NotifyReason
 */

/**
 * Avisa al orquestador con UNA línea, si y solo si (1) hay eventos sin ver, (2) ninguno
 * entró en un aviso dentro de la ventana de debounce, (3) hay un destinatario resuelto y
 * (4) su pantalla dice que está idle.
 *
 * El orden de las comprobaciones es deliberado y va de barata a cara: las dos primeras
 * son lecturas de `state.json` que el caller ya hizo caliente; `readScreen` —la única
 * llamada al host— queda la ÚLTIMA, así que el camino común (nada sin ver, o debounce
 * activo) no paga ni un proceso hijo.
 *
 * @param {{
 *   hostClient: { listWorkspaces?: () => Promise<string>, readScreen?: (o: {workspace: string, lines?: number}) => Promise<string>, send: (o: {workspace: string, text: string}) => Promise<any> },
 *   getOrchestratorFn?: () => { workspace_ref?: string }|null,
 *   listFn?: typeof listOrchestratorInbox,
 *   markNotifiedFn?: typeof markOrchestratorEventsNotified,
 *   now?: () => Date,
 *   debounceMs?: number,
 *   logger?: import('../logger-noop.js').NoopLogger,
 * }} opts
 *   `getOrchestratorFn` es el MISMO seam de aislamiento que threadean `session-end.js` y
 *   `session/manager.js` (KODO-20): sin él, resolver el destinatario LEE el
 *   `~/.kodo/state.json` real y el resultado de la suite pasa a depender de si la máquina
 *   tiene un orquestador vivo. `listFn`/`markNotifiedFn` cierran la misma fuga en el otro
 *   sentido — el de ESCRITURA — sobre el bloque de la bandeja.
 * @returns {Promise<{ sent: boolean, reason: NotifyReason, workspace?: string, ids?: string[] }>}
 */
export async function maybeNotifyOrchestrator(opts) {
  const logger = opts?.logger || noopLogger;
  try {
    const listFn = opts.listFn || listOrchestratorInbox;
    const markNotifiedFn = opts.markNotifiedFn || markOrchestratorEventsNotified;
    const nowMs = (opts.now ? opts.now() : new Date()).getTime();
    const debounceMs = typeof opts.debounceMs === 'number' ? opts.debounceMs : NOTICE_DEBOUNCE_MS;

    // 1. ¿Hay algo sin ver? `listFn({})` ya filtra las vistas.
    const unseen = listFn({});
    if (unseen.length === 0) return { sent: false, reason: 'nothing-unseen' };

    // 2. Debounce. Tres cierres seguidos deben producir UN aviso, no tres.
    if (!shouldNotify(unseen, nowMs, debounceMs)) {
      return { sent: false, reason: 'debounced' };
    }

    // 3. Destinatario. Ref registrado primero, título de `workspace list` después
    //    (KODO-16). Sin candidatos no hay a quién avisar — y no es un error: significa
    //    que no hay orquestador, que es justo el caso que `kodo check` cubre aparte.
    const workspaces = await Promise.resolve(
      typeof opts.hostClient?.listWorkspaces === 'function'
        ? opts.hostClient.listWorkspaces().catch(() => '')
        : '',
    );
    const targets = resolveOrchestratorTargets(workspaces, { getOrchestratorFn: opts.getOrchestratorFn });
    if (targets.length === 0) return { sent: false, reason: 'no-orchestrator' };

    // 4. La puerta: ¿está idle? FAIL-CLOSED en los dos sentidos — un host sin `readScreen`
    //    o una lectura que falla NO se interpretan como «idle». Ante la duda no se teclea:
    //    el evento ya está en la bandeja y la ronda lo verá igual.
    if (typeof opts.hostClient?.readScreen !== 'function') {
      return { sent: false, reason: 'unreadable' };
    }
    let screen;
    try {
      screen = await opts.hostClient.readScreen({ workspace: targets[0], lines: IDLE_PROBE_LINES });
    } catch {
      return { sent: false, reason: 'unreadable' };
    }
    if (!isOrchestratorIdle(screen)) {
      logger.info('orchestrator.notice.skipped_busy', { workspace: targets[0], unseen: unseen.length });
      return { sent: false, reason: 'busy' };
    }

    // 5. Una línea. El texto largo de cada evento se queda en la bandeja.
    const text = summarizeInbox(unseen);
    if (text === '') return { sent: false, reason: 'nothing-unseen' };

    const workspace = await sendToOrchestrator((o) => opts.hostClient.send(o), targets, text);
    if (!workspace) {
      logger.warn('orchestrator.notice.send_failed', { targets: targets.length });
      return { sent: false, reason: 'send-failed' };
    }

    // 6. Sellar el debounce. Va DESPUÉS del envío a propósito: si el send falla, el
    //    siguiente cierre debe poder reintentar en vez de quedarse mudo 30 s por un
    //    aviso que nunca llegó.
    const ids = unseen.map((e) => e.id);
    markNotifiedFn(ids, logger, { now: opts.now });

    logger.info('orchestrator.notice.sent', { workspace, count: ids.length });
    return { sent: true, reason: 'sent', workspace, ids };
  } catch (err) {
    // Cinturón de seguridad: el aviso jamás puede tumbar a su caller (un hook de cierre).
    logger.warn('orchestrator.notice.error', { reason: /** @type {Error} */ (err).message });
    return { sent: false, reason: 'error' };
  }
}
