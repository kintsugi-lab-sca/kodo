// @ts-check
//
// src/logs/session-lookup.js — Resolver de session-id desde task-id (LOG-11).
//
// Dos pasos (D-20):
//   1. loadState() — match rápido en ~/.kodo/state.json por task_id o task_ref.
//      DUAL-SCAN (Phase 30 Plan 04 gap closure SC#1 Truth 2): escanea ambos
//      buckets `state.sessions` (sesiones vivas) Y `state.history` (sesiones
//      terminadas, FIFO 50-slot mantenido por removeSession). Priority
//      sessions > history — mismo idiom que LIFE-01 findSession D-02.
//      Driver: HUMAN-UAT Test #2 — `kodo logs --session-of LIKEN-113` fallaba
//      tras stop hook porque step-1 sólo veía `sessions` y step-2 (NDJSON
//      head-line) sólo matchea por task_id UUID, no por task_ref humano.
//   2. Fallback: scan de ~/.kodo/logs/*.ndjson.
//      Para cada archivo: head-line-read (readFirstLine) → parse → match
//      registro con event === 'session.start' y task_id === taskId. Sin
//      cambios — preserva cobertura de sesiones huérfanas (logs presentes
//      pero state.json limpiado).
//
// Multi-match (D-21): ordenar por timestamp ISO-8601 DESC (comparación
// lexicográfica === cronológica), devolver el más reciente, warn a stderr
// listando los session_id descartados.
//
// Archivos corruptos o con JSON malformed en la head-line: skip silencioso.
// Sin match en ambos pasos: devuelve null (el caller decide el error UX).
//

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KODO_DIR } from '../config.js';
import { loadState } from '../session/state.js';
import { readFirstLine } from './head-line.js';

/**
 * @param {string} taskId
 * @returns {Promise<string | null>} sessionId o null si no hay match
 */
export async function resolveSessionIdFromTaskId(taskId) {
  // Step 1 — state.json index dual-scan (rápido, O(sessions + history)).
  // SC#1 Truth 2 closure: tanto sesiones vivas como archivadas resuelven
  // por task_id UUID o task_ref humano (idéntico CLI behavior).
  const state = loadState();
  const sessions = state.sessions || {};
  // Defensive Array.isArray guard idéntico a LIFE-01 findSession#213 y
  // listHistory#150 — state.json legacy sin field `history` se lee como [].
  const history = Array.isArray(state.history) ? state.history : [];

  // Priority sessions (LIFE-01 D-02 idiom): match en sessions gana sobre
  // history en la ventana degenerada del removeSession (unshift history →
  // delete sessions[taskId]).
  for (const s of Object.values(sessions)) {
    /** @type {any} */
    const sess = s;
    if (sess.task_id === taskId || sess.task_ref === taskId) {
      return sess.session_id;
    }
  }
  for (const h of history) {
    /** @type {any} */
    const entry = h;
    if (entry.task_id === taskId || entry.task_ref === taskId) {
      return entry.session_id;
    }
  }

  // Step 2 — scan de logs/ con head-line-read.
  const logsDir = join(KODO_DIR, 'logs');
  if (!existsSync(logsDir)) return null;

  /** @type {Array<{ sessionId: string, timestamp: string }>} */
  const matches = [];

  for (const fn of readdirSync(logsDir)) {
    if (!fn.endsWith('.ndjson')) continue;
    let first;
    try {
      first = readFirstLine(join(logsDir, fn));
    } catch {
      // Permiso denegado o fs transient — skip sin crash.
      continue;
    }
    if (!first) continue;

    /** @type {any} */
    let rec;
    try {
      rec = JSON.parse(first);
    } catch {
      // Primera línea no es JSON válido — skip sin crash.
      continue;
    }

    if (rec && rec.event === 'session.start' && rec.task_id === taskId) {
      matches.push({
        sessionId: fn.replace(/\.ndjson$/, ''),
        timestamp: String(rec.timestamp || ''),
      });
    }
  }

  if (matches.length === 0) return null;

  // Sort DESC por timestamp ISO-8601 (lexicográfico === cronológico).
  matches.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (matches.length > 1) {
    process.stderr.write(`Multiple sessions for task ${taskId}:\n`);
    for (const m of matches.slice(1)) {
      process.stderr.write(`  ${m.sessionId}  ${m.timestamp}\n`);
    }
    process.stderr.write(`Using most recent: ${matches[0].sessionId}\n\n`);
  }

  return matches[0].sessionId;
}
