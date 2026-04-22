// @ts-check
//
// src/logger-events.js — Taxonomía cerrada de 7 eventos de ciclo de vida.
//
// Contrato fijo por ROADMAP §Phase 7 + extensión v0.3:
//   session.start, session.end, state.transition, orchestrator.review,
//   gsd.phase.resolved, gsd.bootstrap, plane.api.call, plane.api.call.failed
//
// Los helpers delegan en logger.info/warn/error — el sink NDJSON y el redactor
// siguen siendo los de src/logger.js (Fase 6). Este archivo es pure transform:
// campos → record. No abre archivos, no hace I/O.
//
// LOG-12 invariant: ningún consumer en el grafo de src/check.js importa este
// módulo. Los imports son solo `node:os` + `node:path` (stdlib).
//

import { homedir } from 'node:os';
import { join } from 'node:path';

/** @type {Readonly<{
 *   SESSION_START: 'session.start',
 *   SESSION_END: 'session.end',
 *   STATE_TRANSITION: 'state.transition',
 *   ORCHESTRATOR_REVIEW: 'orchestrator.review',
 *   GSD_PHASE_RESOLVED: 'gsd.phase.resolved',
 *   GSD_BOOTSTRAP: 'gsd.bootstrap',
 *   PLANE_API_CALL: 'plane.api.call',
 *   PLANE_API_CALL_FAILED: 'plane.api.call.failed',
 * }>} */
export const EVENTS = Object.freeze({
  SESSION_START:          'session.start',
  SESSION_END:            'session.end',
  STATE_TRANSITION:       'state.transition',
  ORCHESTRATOR_REVIEW:    'orchestrator.review',
  GSD_PHASE_RESOLVED:     'gsd.phase.resolved',
  GSD_BOOTSTRAP:          'gsd.bootstrap',
  PLANE_API_CALL:         'plane.api.call',
  PLANE_API_CALL_FAILED:  'plane.api.call.failed',
});

/**
 * Path determinista del transcript de Claude Code. Pure — no I/O.
 *
 * Convención empíricamente verificada:
 *   encodeURIComponent('/Users/alex/dev/klab/kodo').replace(/%2F/g, '-')
 *   === '-Users-alex-dev-klab-kodo'
 *
 * Limitación (Pitfall 3 de 07-RESEARCH): paths con caracteres no-ASCII
 * o espacios producen encodings que Claude Code puede no respetar. El
 * campo se persiste tal cual; si el transcript no existe en disco, es
 * responsabilidad del dev tool consumer, no del logger.
 *
 * @param {string} projectPath absolute
 * @param {string} sessionId UUID v4
 * @returns {string}
 */
export function resolveTranscriptPath(projectPath, sessionId) {
  const encoded = encodeURIComponent(projectPath).replace(/%2F/g, '-');
  return join(homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
}

/**
 * @typedef {import('./logger.js').Logger} Logger
 */

/**
 * Emite la línea con el contrato mínimo D-10 (6 campos obligatorios).
 * Si falta `transcript_path`, se auto-resuelve con resolveTranscriptPath.
 *
 * @param {Logger} logger
 * @param {{
 *   session_id: string,
 *   task_id: string | null,
 *   provider: string,
 *   project_path: string,
 *   transcript_path?: string,
 *   started_at: string,
 * }} fields
 */
export function sessionStart(logger, fields) {
  const transcript_path = fields.transcript_path
    ?? resolveTranscriptPath(fields.project_path, fields.session_id);
  logger.info(EVENTS.SESSION_START, {
    event: EVENTS.SESSION_START,
    session_id: fields.session_id,
    task_id: fields.task_id,
    provider: fields.provider,
    project_path: fields.project_path,
    transcript_path,
    started_at: fields.started_at,
  });
}

/**
 * @param {Logger} logger
 * @param {{
 *   session_id: string,
 *   task_id: string | null,
 *   status: 'done' | 'error' | 'review' | 'interrupted' | 'running',
 *   ended_at: string,
 * }} fields
 */
export function sessionEnd(logger, fields) {
  logger.info(EVENTS.SESSION_END, {
    event: EVENTS.SESSION_END,
    session_id: fields.session_id,
    task_id: fields.task_id,
    status: fields.status,
    ended_at: fields.ended_at,
  });
}

/**
 * @param {Logger} logger
 * @param {{ from: string, to: string, reason: string }} fields
 */
export function stateTransition(logger, fields) {
  logger.info(EVENTS.STATE_TRANSITION, {
    event: EVENTS.STATE_TRANSITION,
    from: fields.from,
    to: fields.to,
    reason: fields.reason,
  });
}

/**
 * @param {Logger} logger
 * @param {{ phase_id: string, verdict: 'approved' | 'blocked', reason: string }} fields
 */
export function orchestratorReview(logger, fields) {
  // verdict !== 'approved' → warn para espejar a stderr también
  const level = fields.verdict === 'approved' ? 'info' : 'warn';
  logger[level](EVENTS.ORCHESTRATOR_REVIEW, {
    event: EVENTS.ORCHESTRATOR_REVIEW,
    phase_id: fields.phase_id,
    verdict: fields.verdict,
    reason: fields.reason,
  });
}

/**
 * @param {Logger} logger
 * @param {{ phase_id: string, match_heading: string }} fields
 */
export function gsdPhaseResolved(logger, fields) {
  logger.info(EVENTS.GSD_PHASE_RESOLVED, {
    event: EVENTS.GSD_PHASE_RESOLVED,
    phase_id: fields.phase_id,
    match_heading: fields.match_heading,
  });
}

/**
 * @param {Logger} logger
 * @param {{ project_path: string }} fields
 */
export function gsdBootstrap(logger, fields) {
  logger.info(EVENTS.GSD_BOOTSTRAP, {
    event: EVENTS.GSD_BOOTSTRAP,
    project_path: fields.project_path,
  });
}

/**
 * @param {Logger} logger
 * @param {{ method: string, path: string, status: number, duration_ms: number }} fields
 */
export function planeApiCall(logger, fields) {
  logger.info(EVENTS.PLANE_API_CALL, {
    event: EVENTS.PLANE_API_CALL,
    method: fields.method,
    path: fields.path,
    status: fields.status,
    duration_ms: fields.duration_ms,
  });
}

/**
 * Emitido cuando una llamada a Plane falla en un paso específico del gate
 * (getTask, addComment, updateTaskState). Complementa `plane.api.call` —
 * el provider emite el evento success internamente, y este módulo emite el
 * failure desde los consumers (verify.js u otros).
 *
 * @param {Logger} logger
 * @param {{ step: string, error: string }} fields
 */
export function planeApiCallFailed(logger, fields) {
  logger.error(EVENTS.PLANE_API_CALL_FAILED, {
    event: EVENTS.PLANE_API_CALL_FAILED,
    step: fields.step,
    error: fields.error,
  });
}
