// @ts-check
//
// src/orchestrator/recycle.js — KODO-67: el AVISO por tamaño de transcript.
//
// La otra mitad del reciclado (`orchestrator/handoff.js` es la durable). Aquella guarda el
// QUÉ se lleva el orquestador entrante; ésta decide CUÁNDO conviene reciclar.
//
// ── POR QUÉ EL TAMAÑO DEL FICHERO Y NO EL % DE CONTEXTO ───────────────────────────────
// No hay API que devuelva el contexto consumido de una sesión de Claude Code: el `72 %`
// que ve el operador en su terminal no está expuesto a los hooks. Lo que SÍ es observable
// desde fuera del proceso es el transcript en disco —
// `~/.claude/projects/<cwd-encoded>/<session>.jsonl` — que crece monótonamente con cada
// turno y del que el contexto vivo es una fracción bastante estable.
//
// El proxy es GRUESO a propósito y no pretende ser otra cosa: un transcript de 8 MB no
// significa «vas por el 45 %», significa «llevas suficientes rondas como para que valga la
// pena mirar». Quien decide es el orquestador, que sabe si está a mitad de una integración;
// kodo solo levanta la mano. Por eso el umbral es CONFIGURABLE (`orchestrator.recycle_mb`)
// y por eso el evento se llama `recycle-suggested` y no `recycle-required`.
//
// NO HACE FALTA RECONSTRUIR LA RUTA. El input del hook `Stop` ya trae `transcript_path`
// resuelto por Claude Code. Derivar `<cwd-encoded>` a mano (sustituir `/` por `-`, decidir
// qué pasa con los `.`) sería reimplementar una convención que no es nuestra y que puede
// cambiar sin avisar. Si el campo no viene, no hay medición — y no hay aviso.
//
// ── EL DEBOUNCE ES EL FEATURE ─────────────────────────────────────────────────────────
// `Stop` dispara al final de CADA turno y el transcript solo crece: sin debounce, cruzar
// el umbral una vez produciría un evento por turno para siempre. Dos reglas, ambas puras:
//   1. Si ya hay un `recycle-suggested` SIN VER, no se encola otro. El orquestador tiene
//      el aviso pendiente; repetirlo no añade información.
//   2. Si el último `recycle-suggested` (visto o no) es más reciente que la ventana, no se
//      encola. Así, tras ackear, no vuelve a saltar en el turno siguiente — pero sí más
//      tarde, si el orquestador siguió creciendo y no recicló.
//
// NEVER-THROWS de cuerpo entero: el caller es un hook de cierre de turno.

import { statSync } from 'node:fs';
import { noopLogger } from '../logger-noop.js';
import { enqueueOrchestratorEvent, listOrchestratorInbox } from './inbox.js';

/**
 * Umbral por defecto, en MB de transcript.
 *
 * 8 MB es el punto en el que se midió el 72 % de contexto en la sesión que motivó KODO-67
 * (cuatro días de rondas, 683 k tokens de mensajes). Puesto como default deja margen: el
 * aviso llega con la sesión todavía cómoda, que es cuando reciclar es barato — no cuando
 * ya no queda contexto ni para escribir el handoff.
 */
export const DEFAULT_RECYCLE_MB = 8;

/**
 * Ventana de debounce entre dos avisos de reciclado, en ms.
 *
 * 30 min y no los 30 s de `NOTICE_DEBOUNCE_MS`: aquel agrupa cierres de sesión que ocurren
 * en ráfaga; éste vigila una magnitud que tarda horas en moverse de forma significativa.
 * Un aviso cada media hora es la cadencia de «te lo recuerdo», no la de «te lo notifico».
 */
export const RECYCLE_DEBOUNCE_MS = 30 * 60_000;

/** `kind` del evento en la bandeja. Ver `ORCHESTRATOR_EVENT_KINDS` (inbox.js). */
export const RECYCLE_KIND = 'recycle-suggested';

/**
 * Resuelve `config.orchestrator.recycle_mb`. PURA y FAIL-SAFE — un config ausente,
 * ilegible o con un valor no positivo cae al default.
 *
 * Recibe el config por PARÁMETRO en vez de importar `config.js`, por la misma razón que
 * `resolveNudgeMode` (inbox.js): ese módulo evalúa `homedir()` en module-load y arrastrarlo
 * hasta un hook contamina el aislamiento de HOME de los tests.
 *
 * @param {{ orchestrator?: { recycle_mb?: any } }|null|undefined} config
 * @returns {number} MB, > 0.
 */
export function resolveRecycleMb(config) {
  const raw = Number(config?.orchestrator?.recycle_mb);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RECYCLE_MB;
}

/**
 * ¿Toca sugerir reciclado? PURA. Aplica las dos reglas del debounce descritas arriba.
 *
 * @param {Array<{ kind?: string, ts?: string, seen?: boolean }>} entries - bandeja COMPLETA
 *   (incluidas las vistas: la regla 2 necesita ver el último aviso aunque esté ackeado).
 * @param {number} nowMs
 * @param {number} [debounceMs]
 * @returns {boolean}
 */
export function shouldSuggestRecycle(entries, nowMs, debounceMs = RECYCLE_DEBOUNCE_MS) {
  const prior = (Array.isArray(entries) ? entries : []).filter((e) => e && e.kind === RECYCLE_KIND);
  if (prior.length === 0) return true;
  // Regla 1 — ya hay uno pendiente de ver.
  if (prior.some((e) => e.seen !== true)) return false;
  // Regla 2 — el más reciente todavía está dentro de la ventana. Un `ts` ilegible NO
  // bloquea (fail-open): perder un aviso por una entrada corrupta sería peor que repetirlo.
  const last = prior.reduce((max, e) => {
    const t = Date.parse(String(e.ts));
    return Number.isFinite(t) && t > max ? t : max;
  }, -Infinity);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= debounceMs;
}

/**
 * Texto del evento. PURO. Va a la bandeja (se LEE en la ronda), no al carril de keystroke,
 * así que puede permitirse dos frases — pero ni una más: lo que hay que hacer lo dice la
 * skill (§Reciclado), y duplicarlo aquí garantizaría que las dos copias divergen.
 *
 * @param {number} bytes - tamaño observado del transcript.
 * @param {number} mb - umbral configurado, en MB.
 * @returns {string}
 */
export function buildRecycleText(bytes, mb) {
  const shown = (bytes / (1024 * 1024)).toFixed(1);
  return (
    `Tu transcript va por ${shown} MB (umbral ${mb} MB). ` +
    'Cuando no estés a mitad de una integración: escribe el handoff en ~/.kodo/handoff.md ' +
    'siguiendo §Reciclado de la skill y cierra con /exit. El daemon te relanza con el handoff dentro.'
  );
}

/**
 * Mide el transcript y, si procede, encola UN `recycle-suggested` en la bandeja.
 *
 * NEVER-THROWS. Todos los caminos devuelven el discriminado `{ suggested, reason }` — el
 * caller es el hook `Stop` del orquestador y no puede fallar porque no se pueda medir un
 * fichero.
 *
 * El orden de las comprobaciones va de barata a cara: primero el `statSync` (una syscall,
 * y descarta el caso común de transcript pequeño), y solo después la lectura de la bandeja.
 *
 * @param {{
 *   transcriptPath?: string|null,
 *   config?: { orchestrator?: { recycle_mb?: any } }|null,
 *   statFn?: (p: string) => { size: number },
 *   listFn?: typeof listOrchestratorInbox,
 *   enqueueFn?: typeof enqueueOrchestratorEvent,
 *   now?: () => Date,
 *   debounceMs?: number,
 *   logger?: import('../logger-noop.js').NoopLogger,
 * }} opts
 * @returns {{ suggested: boolean, reason: 'enqueued'|'under-threshold'|'debounced'|'no-transcript'|'unreadable'|'enqueue-failed'|'error', bytes?: number, id?: string }}
 */
export function maybeSuggestRecycle(opts = {}) {
  const logger = opts.logger || noopLogger;
  try {
    const path = opts.transcriptPath;
    if (typeof path !== 'string' || path === '') {
      return { suggested: false, reason: 'no-transcript' };
    }

    const mb = resolveRecycleMb(opts.config);
    const threshold = mb * 1024 * 1024;

    let bytes;
    try {
      bytes = (opts.statFn || statSync)(path).size;
    } catch {
      return { suggested: false, reason: 'unreadable' };
    }
    if (!(bytes >= threshold)) {
      return { suggested: false, reason: 'under-threshold', bytes };
    }

    const listFn = opts.listFn || listOrchestratorInbox;
    const nowMs = (opts.now ? opts.now() : new Date()).getTime();
    // `{ all: true }` — la regla 2 del debounce necesita los avisos YA VISTOS.
    if (!shouldSuggestRecycle(listFn({ all: true }), nowMs, opts.debounceMs)) {
      return { suggested: false, reason: 'debounced', bytes };
    }

    const enqueueFn = opts.enqueueFn || enqueueOrchestratorEvent;
    const r = enqueueFn(
      {
        kind: RECYCLE_KIND,
        task_ref: 'orquestador',
        session_id: null,
        text: buildRecycleText(bytes, mb),
      },
      logger,
      { now: opts.now },
    );
    if (!r.ok) return { suggested: false, reason: 'enqueue-failed', bytes };

    logger.info?.('orchestrator.recycle.suggested', { bytes, threshold_mb: mb, id: r.value.id });
    return { suggested: true, reason: 'enqueued', bytes, id: r.value.id };
  } catch (err) {
    logger.warn?.('orchestrator.recycle.error', { reason: /** @type {Error} */ (err).message });
    return { suggested: false, reason: 'error' };
  }
}
