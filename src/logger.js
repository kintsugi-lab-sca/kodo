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

import { appendFileSync, mkdirSync } from 'node:fs';
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
export const ANSI_RESET = '\x1b[0m';
const ANSI_GRAY = '\x1b[90m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED = '\x1b[31m';

export const COLOR_BY_LEVEL = Object.freeze({
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
 * Formatea campos extra de contexto inline como `+k=v k2=v2`.
 * Excluye los base fields (timestamp, level, msg, session_id, component, plane_task_id, phase_id).
 * Pure — no I/O, no side effects.
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

/**
 * Pretty-format a log record. Shared by stderr mirror AND `kodo logs` CLI.
 * Output shape: `HH:MM:SS LEVEL [component ]msg[ +k=v ...]`.
 * Pure — no I/O.
 * @param {object} record
 * @param {{ useColor: boolean }} opts
 * @returns {string}
 */
export function formatLine(record, { useColor }) {
  const time = String(/** @type {any} */ (record).timestamp).slice(11, 19);
  const lvl = String(/** @type {any} */ (record).level).toUpperCase();
  const c = useColor ? COLOR_BY_LEVEL[/** @type {any} */ (record).level] || '' : '';
  const r = useColor ? ANSI_RESET : '';
  const comp = /** @type {any} */ (record).component
    ? ` ${/** @type {any} */ (record).component}`
    : '';
  const ctx = formatCtxInline(record);
  return `${time} ${c}${lvl}${r}${comp} ${/** @type {any} */ (record).msg}${ctx}`;
}

// --- Redaction (LOG-08) ---------------------------------------------------

/**
 * Keys cuyo VALOR se redacta siempre (comparación case-insensitive).
 * Lista cerrada y hardcodeada — cualquier typo aquí se detecta por el test
 * grep-based sobre el archivo NDJSON persistido.
 */
const SENSITIVE_KEYS = new Set([
  'plane_api_key',
  'authorization',
  'x-api-key',
  'x-plane-signature',
  'password',
  'token',
  'secret',
  'cookie',
  'set-cookie',
]);

/**
 * JWT: `eyJ` (base64 de `{"`) + base64url con ≥2 puntos y ≥10 chars por segmento.
 * Conservador: no matchea UUIDs, git SHAs, ni texto normal.
 */
const JWT_RE = /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

/** Bearer token o plane_api_key prefix. Requiere ≥20 chars tras el prefijo. */
const BEARERY_RE = /^(Bearer\s+|plane_)[A-Za-z0-9_\-]{20,}$/i;

const REDACTED = '[REDACTED]';
const REDACTED_DEPTH = '[REDACTED:depth-exceeded]';
const MAX_DEPTH = 4;
const MAX_ARRAY_LEN = 100;

/**
 * Deep-walk redactor: reemplaza valores de keys sensibles y strings que
 * matcheen patterns JWT/Bearer por `[REDACTED]`. Aplica límites de profundidad
 * y longitud de array para proteger contra ctx gigantes.
 *
 * Pure function: no muta `value`. Idempotente.
 *
 * @param {unknown} value
 * @param {number} [depth]
 * @param {string} [keyHint]
 * @returns {unknown}
 */
function redact(value, depth = 0, keyHint = '') {
  if (depth > MAX_DEPTH) return REDACTED_DEPTH;
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (keyHint && SENSITIVE_KEYS.has(keyHint.toLowerCase())) return REDACTED;
    if (JWT_RE.test(value) || BEARERY_RE.test(value)) return REDACTED;
    return value;
  }

  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LEN) {
      const kept = value.slice(0, MAX_ARRAY_LEN).map((v) => redact(v, depth + 1, keyHint));
      kept.push(`[REDACTED:truncated-${value.length - MAX_ARRAY_LEN}]`);
      return kept;
    }
    return value.map((v) => redact(v, depth + 1, keyHint));
  }

  // Objeto: iterar con Object.entries (omite __proto__ por diseño) y reconstruir
  // en un objeto plano nuevo (defensa natural contra prototype pollution).
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else {
      out[k] = redact(v, depth + 1, k);
    }
  }
  return out;
}

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
    const rawRecord = {
      timestamp: new Date().toISOString(),
      level,
      ...boundFields,
      msg: String(msg),
      ...(ctx ?? {}),
    };
    // Redact ANTES de cualquier sink (disco + stderr) para que ambos canales
    // queden limpios con una sola pasada. Idempotente.
    const record = /** @type {Record<string, unknown>} */ (redact(rawRecord));
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
        process.stderr.write(`${ANSI_RED}[kodo:logger] write failed: ${msg}${ANSI_RESET}\n`);
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
    process.stderr.write(formatLine(record, { useColor }) + '\n');
  }
}
