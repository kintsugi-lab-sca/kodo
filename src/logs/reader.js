// @ts-check
//
// src/logs/reader.js — Action handler de `kodo logs <session-id>`.
//
// Responsabilidades:
//   1. Resolver el file path desde sessionId (o sessionOf → Plan 04).
//   2. Dump default: readFileSync + split '\n' + filtros cliente + formatLine.
//   3. --follow: delega en ./follow.js#followFile.
//   4. --json: imprime NDJSON crudo sin formatear.
//
// Filtros (D-06, cliente-side):
//   - level:     LEVELS[rec.level] >= LEVELS[flag]
//   - component: rec.component === flag
//   - eventType: eventType.includes(rec.event)
//
// Aislamiento del vigilante (LOG-12): importa logger.js pero reader.js NO entra en
// el grafo de check.js — sólo se alcanza desde cli.js. Verificado por
// test/check-isolation.test.js.
//

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KODO_DIR } from '../config.js';
import { LEVELS, formatLine } from '../logger.js';
import { _resolveUseColor } from '../cli/format.js';

// NET-05 / D-10 (audit finding B6): allowlist positivo para el `sessionId` que
// se convierte en nombre de fichero. Rechazo DURO en este edge (input CLI no
// confiable `kodo logs <session-id>`) ANTES de construir cualquier path.
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * @typedef {{
 *   sessionId?: string,
 *   follow?: boolean,
 *   level?: 'debug'|'info'|'warn'|'error',
 *   component?: string,
 *   eventType?: string[],
 *   json?: boolean,
 *   sessionOf?: string,
 * }} RunLogsOpts
 */

/**
 * Ejecuta `kodo logs` para una sesión dada.
 *
 * @param {RunLogsOpts} opts
 * @returns {Promise<void>}
 */
export async function runLogs(opts) {
  let sessionId = opts.sessionId;

  // Resolución de --session-of delega en módulo dinámico (se crea en Plan 04).
  if (opts.sessionOf) {
    const { resolveSessionIdFromTaskId } = await import('./session-lookup.js');
    const resolved = await resolveSessionIdFromTaskId(opts.sessionOf);
    sessionId = resolved ?? undefined;
    if (!sessionId) {
      process.stderr.write(`No session found for task ${opts.sessionOf}\n`);
      process.exit(1);
    }
  }

  if (!sessionId) {
    process.stderr.write(
      'Usage: kodo logs <session-id> | kodo logs --session-of <task-id>\n',
    );
    process.exit(2);
  }

  // NET-05 / D-10: rechazo duro del sessionId hostil ANTES de tocar el
  // filesystem. Cualquier separador de path o traversal (`../`, `a/b`) queda
  // fuera del allowlist y aborta con exit 2 (mismo código que el usage guard).
  if (!SESSION_ID_RE.test(sessionId)) {
    process.stderr.write('Invalid session id\n');
    process.exit(2);
  }

  const filePath = join(KODO_DIR, 'logs', `${sessionId}.ndjson`);
  const minLevelNum =
    opts.level && opts.level in LEVELS ? LEVELS[opts.level] : LEVELS.debug;
  // Phase 15 D-01 / Pattern A: source unification de useColor via _resolveUseColor —
  // añade soporte FORCE_COLOR (precedence NO_COLOR > FORCE_COLOR > stream.isTTY).
  // El --json early-return (líneas siguientes) preserva el bypass total: el
  // formatter NUNCA se invoca con --json, lo que satisface SC#2 byte-a-byte.
  const useColor = _resolveUseColor(process.stdout);

  /**
   * Imprime una línea NDJSON cruda aplicando filtros + formato.
   * @param {string} raw
   */
  const printLine = (raw) => {
    if (opts.json) {
      // --json: passthrough crudo sin parsear ni filtrar (pipe-friendly para jq).
      process.stdout.write(raw + '\n');
      return;
    }
    /** @type {any} */
    let rec;
    try {
      rec = JSON.parse(raw);
    } catch {
      process.stdout.write(`[malformed] ${raw}\n`);
      return;
    }
    const recLevel =
      rec.level in LEVELS ? LEVELS[/** @type {keyof typeof LEVELS} */ (rec.level)] : LEVELS.debug;
    if (recLevel < minLevelNum) return;
    if (opts.component && rec.component !== opts.component) return;
    if (
      opts.eventType &&
      opts.eventType.length > 0 &&
      !opts.eventType.includes(rec.event)
    ) {
      return;
    }
    process.stdout.write(formatLine(rec, { useColor }) + '\n');
  };

  if (opts.follow) {
    const { followFile } = await import('./follow.js');
    followFile(filePath, printLine);
    return;
  }

  if (!existsSync(filePath)) {
    process.stderr.write(`No log file at ${filePath}\n`);
    process.exit(1);
  }

  const raw = readFileSync(filePath, 'utf-8');
  for (const line of raw.split('\n')) {
    if (line) printLine(line);
  }
}
