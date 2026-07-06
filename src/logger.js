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
import { createFormatter, _resolveUseColor } from './cli/format.js';

// Re-export for conveniencia — los consumidores pueden hacer
// `import { noopLogger } from './logger.js'` o directamente desde './logger-noop.js'.
export { noopLogger } from './logger-noop.js';

/** @type {Readonly<{ debug: 10, info: 20, warn: 30, error: 40 }>} */
export const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

/** @type {readonly ['debug','info','warn','error']} */
export const LEVEL_NAMES = Object.freeze(['debug', 'info', 'warn', 'error']);

// NET-05 / D-10 (Pitfall 3): allowlist positivo para el `sessionId` que se
// convierte en nombre de fichero. Aquí la defensa es SUAVE (no-throw):
// createLogger corre con el id sintético 'reconcile' y con UUIDs reales — un
// throw estricto podría matar el loop de reconcile. 'reconcile' y los UUIDs
// pasan el allowlist; sólo un id genuinamente hostil degrada (disk sink off).
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Widths fijas del shape columnar Phase 15 D-05 (TTY-only).
 *   - timestamp: 8 (HH:MM:SS).
 *   - level: 5 (max 'ERROR').
 *   - component: 12 (D-06 — empty cell se rellena con 12 espacios para alineación vertical).
 * Pad-only sin truncate (delega en `padCell` de format.js — D-10 Phase 14).
 * @type {Readonly<{ timestamp: 8, level: 5, component: 12 }>}
 */
const COLUMNAR_WIDTHS = Object.freeze({ timestamp: 8, level: 5, component: 12 });

// ANSI escape codes — privadas; consumidas por el writeNdjson error path (línea ~312).
// Phase 22 DEBT-04 retiró COLOR_BY_LEVEL y los exports ANSI_* (Phase 15 IN-01 closed).
const ANSI_RESET = '\x1b[0m';
const ANSI_RED = '\x1b[31m';

const BASE_RECORD_KEYS = new Set([
  'timestamp',
  'level',
  'msg',
  'session_id',
  'component',
  'task_id',
  'phase_id',
]);

/**
 * Formatea campos extra de contexto inline como `+k=v k2=v2`.
 * Excluye los base fields (timestamp, level, msg, session_id, component, task_id, phase_id).
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
 *
 * Shape dual condicionado a `useColor` (Phase 15 D-02):
 *   - `useColor=false` (NO_COLOR / non-TTY) → bytes IDÉNTICOS pre-Phase-15
 *     (single space, sin separator middle-dot, sin padding) — preserva SC#1
 *     byte-a-byte. Usado por `--json` consumers downstream + tests golden.
 *   - `useColor=true` (TTY + color enabled) → shape columnar:
 *     `HH:MM:SS · <colored LEVEL> · <component padded 12> · <msg>[ +k=v...]`
 *     con widths fijas (D-05) y separator ` · ` (D-07 Phase 14 default).
 *
 * Pure — no I/O.
 * @param {object} record
 * @param {{ useColor: boolean }} opts
 * @returns {string}
 */
export function formatLine(record, { useColor }) {
  const time = String(/** @type {any} */ (record).timestamp).slice(11, 19);
  const lvl = String(/** @type {any} */ (record).level).toUpperCase();

  if (!useColor) {
    // BRANCH NON-TTY/NO_COLOR — preservación byte-a-byte (SC#1 Phase 15).
    // NO modificar este return: cualquier cambio rompe golden bytes test.
    const comp = /** @type {any} */ (record).component
      ? ` ${/** @type {any} */ (record).component}`
      : '';
    const ctx = formatCtxInline(record);
    return `${time} ${lvl}${comp} ${/** @type {any} */ (record).msg}${ctx}`;
  }

  // BRANCH TTY+COLOR — columnar (D-02 + D-05 + D-06 + D-07 Phase 15).
  // widths: timestamp=8, level=5, component=12 (D-05). Separator ' · ' (default formatRow).
  // Component vacío → 12 espacios (D-06, alineación vertical estricta).
  //
  // El caller ya resolvió `useColor=true` (vía `_resolveUseColor` en createLogger
  // o vía `_resolveUseColor(process.stdout)` en logs/reader.js). Para que el
  // formatter respete ese contrato sin re-inspeccionar `process.stderr.isTTY`
  // (que puede divergir en tests con stub), inyectamos un descriptor sintético
  // `{ isTTY: true }` y un env limpio (`NO_COLOR`/`FORCE_COLOR` deliberadamente
  // no-set) — `_resolveUseColor` cae al fallback `stream.isTTY = true` y devuelve
  // `true` deterministamente.
  const fmt = createFormatter({ isTTY: true }, {});
  const levelKey = /** @type {any} */ (record).level;
  const levelMethod =
    levelKey === 'debug' ? fmt.debug
    : levelKey === 'info'  ? fmt.info
    : levelKey === 'warn'  ? fmt.warn
    : levelKey === 'error' ? fmt.error
    : (/** @type {string} */ s) => s;
  const lvlCell = levelMethod(lvl);
  const compRaw = /** @type {any} */ (record).component
    ? String(/** @type {any} */ (record).component)
    : '';
  const cells = [time, lvlCell, compRaw, String(/** @type {any} */ (record).msg)];
  // formatRow ignora widths[i] cuando es undefined (Phase 14 src/cli/format.js:130) →
  // la 4ª celda (msg) NO se padea: solo timestamp / level / component se columnan.
  const widths = [
    COLUMNAR_WIDTHS.timestamp,
    COLUMNAR_WIDTHS.level,
    COLUMNAR_WIDTHS.component,
  ];
  const row = fmt.formatRow(cells, widths);
  const ctx = formatCtxInline(record);
  return `${row}${ctx}`;
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

  // NET-05 / D-10 (Pitfall 3): defensa-en-profundidad SIN throw. Si el id no
  // pasa el allowlist, deshabilitamos el disk sink para este logger — así un id
  // hostil nunca resuelve a un path de traversal — pero devolvemos un logger
  // funcional (stderr mirror sigue), sin matar al llamante (p.ej. reconcile).
  const diskSinkEnabled = SESSION_ID_RE.test(sessionId);
  if (!diskSinkEnabled) {
    // Aviso redactado: NO logueamos el id crudo (podría contener el payload).
    console.warn('[kodo:logger] sessionId con formato inválido — disk sink deshabilitado para este logger');
  }

  const logDir = join(KODO_DIR, 'logs');
  mkdirSync(logDir, { recursive: true });
  const filePath = join(logDir, `${sessionId}.ndjson`);
  const minLevelNum = LEVELS[minLevel];
  // Phase 15 D-02 / Pattern A: source unification de useColor via _resolveUseColor —
  // añade soporte FORCE_COLOR (precedence NO_COLOR > FORCE_COLOR > stream.isTTY).
  const useColor = _resolveUseColor(process.stderr);
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
    // NET-05: disk sink deshabilitado para ids hostiles — nunca tocamos el path.
    if (!diskSinkEnabled) return;
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
