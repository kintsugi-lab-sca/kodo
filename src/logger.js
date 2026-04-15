// @ts-check
//
// src/logger.js — NDJSON structured logger con pretty-print stderr mirror.
//
// Responsabilidades:
//   1. Factory createLogger({ sessionId, minLevel }) con child bindings (estilo pino).
//   2. Sink NDJSON a ~/.kodo/logs/<session>.ndjson via appendFileSync.
//   3. Sink pretty-print a stderr para warn/error (e info/debug en TTY con minLevel).
//   4. Manejo swallow+stderr de I/O failures (nunca throw).
//
// Redacción de secretos (LOG-08) se añade en Plan 03.
// Aislamiento del vigilante (LOG-12): src/check.js NO importa este archivo — ver
// test/check-isolation.test.js.
//

import { appendFileSync, mkdirSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { KODO_DIR } from './config.js';

// Re-export for conveniencia — los consumidores pueden hacer
// `import { noopLogger } from './logger.js'` o directamente desde './logger-noop.js'.
export { noopLogger } from './logger-noop.js';

/** @type {Readonly<{ debug: 10, info: 20, warn: 30, error: 40 }>} */
export const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

/** @type {readonly ['debug','info','warn','error']} */
export const LEVEL_NAMES = Object.freeze(['debug', 'info', 'warn', 'error']);

// ANSI escape codes (mismas convenciones que src/check.js).
const ANSI_RESET = '\x1b[0m';
const ANSI_GRAY = '\x1b[90m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED = '\x1b[31m';

const COLOR_BY_LEVEL = Object.freeze({
  debug: ANSI_GRAY,
  info: ANSI_CYAN,
  warn: ANSI_YELLOW,
  error: ANSI_RED,
});

const BASE_RECORD_KEYS = new Set([
  'timestamp',
  'level',
  'msg',
  'session_id',
  'component',
  'plane_task_id',
  'phase_id',
]);

/**
 * @typedef {'debug'|'info'|'warn'|'error'} LogLevel
 * @typedef {{ sessionId: string, minLevel?: LogLevel }} LoggerOpts
 * @typedef {{
 *   debug(msg: string, ctx?: object): void,
 *   info(msg: string, ctx?: object): void,
 *   warn(msg: string, ctx?: object): void,
 *   error(msg: string, ctx?: object): void,
 *   child(bindings: object): Logger,
 * }} Logger
 */

/**
 * Crea un logger raíz con session_id bindeado.
 *
 * @param {LoggerOpts} opts
 * @returns {Logger}
 */
export function createLogger({ sessionId, minLevel = 'info' }) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('[kodo:logger] sessionId is required');
  }
  if (!(minLevel in LEVELS)) {
    throw new Error(`[kodo:logger] invalid minLevel: ${minLevel}`);
  }

  const logDir = join(KODO_DIR, 'logs');
  mkdirSync(logDir, { recursive: true });
  const filePath = join(logDir, `${sessionId}.ndjson`);
  const minLevelNum = LEVELS[minLevel];
  const useColor = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
  let writeFailedWarned = false;

  return makeNode({ session_id: sessionId });

  /**
   * @param {object} boundFields
   * @returns {Logger}
   */
  function makeNode(boundFields) {
    /** @type {any} */
    const node = {
      child(extra) { return makeNode({ ...boundFields, ...extra }); },
    };
    for (const name of LEVEL_NAMES) {
      node[name] = (msg, ctx) => emit(name, msg, ctx, boundFields);
    }
    return node;
  }

  /**
   * @param {LogLevel} level
   * @param {string} msg
   * @param {object | undefined} ctx
   * @param {object} boundFields
   */
  function emit(level, msg, ctx, boundFields) {
    if (LEVELS[level] < minLevelNum) return;
    const record = {
      timestamp: new Date().toISOString(),
      level,
      ...boundFields,
      msg: String(msg),
      ...(ctx ?? {}),
    };
    writeNdjson(record);
    maybeMirrorToStderr(level, record);
  }

  /** @param {object} record */
  function writeNdjson(record) {
    try {
      appendFileSync(filePath, JSON.stringify(record) + '\n');
    } catch (err) {
      if (!writeFailedWarned) {
        const msg = err instanceof Error ? err.message : String(err);
        writeSync(2, `${ANSI_RED}[kodo:logger] write failed: ${msg}${ANSI_RESET}\n`);
        writeFailedWarned = true;
      }
    }
  }

  /**
   * @param {LogLevel} level
   * @param {object} record
   */
  function maybeMirrorToStderr(level, record) {
    const isTTY = Boolean(process.stderr.isTTY);
    const mirror =
      level === 'error' ||
      level === 'warn' ||
      (level === 'info' && isTTY && minLevelNum <= LEVELS.info) ||
      (level === 'debug' && isTTY && minLevelNum <= LEVELS.debug);
    if (!mirror) return;

    const time = /** @type {string} */ (/** @type {any} */ (record).timestamp).slice(11, 19);
    const c = useColor ? COLOR_BY_LEVEL[level] : '';
    const r = useColor ? ANSI_RESET : '';
    const comp = /** @type {any} */ (record).component ? ` ${/** @type {any} */ (record).component}` : '';
    const ctxStr = formatCtxInline(record);
    writeSync(2, `${time} ${c}${level.toUpperCase()}${r}${comp} ${/** @type {any} */ (record).msg}${ctxStr}\n`);
  }

  /**
   * Formatea campos extra de contexto inline como `+k=v k2=v2`.
   * Excluye los base fields (timestamp, level, msg, session_id, component, plane_task_id, phase_id).
   * @param {object} record
   * @returns {string}
   */
  function formatCtxInline(record) {
    const parts = [];
    for (const [k, v] of Object.entries(record)) {
      if (BASE_RECORD_KEYS.has(k)) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        parts.push(`${k}=${v}`);
      } else {
        parts.push(`${k}=${JSON.stringify(v)}`);
      }
    }
    return parts.length ? ` +${parts.join(' ')}` : '';
  }
}
