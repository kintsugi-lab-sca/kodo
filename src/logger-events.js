// @ts-check
//
// src/logger-events.js — Taxonomía cerrada de 15 eventos de ciclo de vida.
//
// Contrato fijo por ROADMAP §Phase 7 + extensiones v0.3 (LOG-09)
// + Phase 19 (worktree cleanup) + Phase 21 (skill sync) + Phase 23 (github client):
//   session.start, session.end, state.transition, orchestrator.review,
//   gsd.phase.resolved, gsd.bootstrap, plane.api.call, plane.api.call.failed,
//   github.api.call, github.api.call.failed,
//   worktree.cleanup.ok, worktree.cleanup.dirty, worktree.cleanup.error,
//   skill.sync.auto, skill.sync.auto.error
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
 *   WORKTREE_CLEANUP_OK: 'worktree.cleanup.ok',
 *   WORKTREE_CLEANUP_DIRTY: 'worktree.cleanup.dirty',
 *   WORKTREE_CLEANUP_ERROR: 'worktree.cleanup.error',
 *   SKILL_SYNC_AUTO: 'skill.sync.auto',
 *   SKILL_SYNC_AUTO_ERROR: 'skill.sync.auto.error',
 *   GITHUB_API_CALL: 'github.api.call',
 *   GITHUB_API_CALL_FAILED: 'github.api.call.failed',
 * }>} */
export const EVENTS = Object.freeze({
  SESSION_START:           'session.start',
  SESSION_END:             'session.end',
  STATE_TRANSITION:        'state.transition',
  ORCHESTRATOR_REVIEW:     'orchestrator.review',
  GSD_PHASE_RESOLVED:      'gsd.phase.resolved',
  GSD_BOOTSTRAP:           'gsd.bootstrap',
  PLANE_API_CALL:          'plane.api.call',
  PLANE_API_CALL_FAILED:   'plane.api.call.failed',
  WORKTREE_CLEANUP_OK:     'worktree.cleanup.ok',
  WORKTREE_CLEANUP_DIRTY:  'worktree.cleanup.dirty',
  WORKTREE_CLEANUP_ERROR:  'worktree.cleanup.error',
  SKILL_SYNC_AUTO:         'skill.sync.auto',
  SKILL_SYNC_AUTO_ERROR:   'skill.sync.auto.error',
  GITHUB_API_CALL:         'github.api.call',
  GITHUB_API_CALL_FAILED:  'github.api.call.failed',
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
 * Emite el evento `gsd.phase.resolved` (success branch, matched:true).
 * Phase 11 (D-05): añade el campo `mode` para distinguir 'full' vs 'quick'.
 * El dispatcher es la única fuente de este evento (D-14 Phase 9 invariante).
 *
 * @param {Logger} logger
 * @param {{ phase_id: string, match_heading: string, mode: 'full'|'quick' }} fields
 */
export function gsdPhaseResolved(logger, fields) {
  logger.info(EVENTS.GSD_PHASE_RESOLVED, {
    event: EVENTS.GSD_PHASE_RESOLVED,
    phase_id: fields.phase_id,
    match_heading: fields.match_heading,
    mode: fields.mode,
  });
}

/**
 * Emite el evento `gsd.bootstrap`. Phase 11 (D-07): añade `mode` y reconcilia
 * el campo `brief_empty` que el dispatcher ya emitía como literal en Phase 9
 * (lift literal → helper, completa la migración a la taxonomía cerrada D-14).
 *
 * @param {Logger} logger
 * @param {{ project_path: string, brief_empty: boolean, mode: 'full'|'quick' }} fields
 */
export function gsdBootstrap(logger, fields) {
  logger.info(EVENTS.GSD_BOOTSTRAP, {
    event: EVENTS.GSD_BOOTSTRAP,
    project_path: fields.project_path,
    brief_empty: fields.brief_empty,
    mode: fields.mode,
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

/**
 * Emitido cuando una llamada a la GitHub API completa exitosamente (Phase 23 D-15/D-16).
 * El nivel del record cambia a `warn` cuando `rate_limit_remaining < 100`; default `info`.
 * Pattern espejo: `orchestratorReview` (switch por field) + `planeApiCall` (shape de payload).
 *
 * El cliente (`src/providers/github/client.js`, Plan 23-02) invoca este helper vía dynamic
 * `await import('../../logger-events.js')` para preservar la invariante LOG-12 (el cliente
 * solo conoce `logger.js`; los helpers viven en una entry del grafo separada).
 *
 * @param {Logger} logger
 * @param {{
 *   method: string,
 *   path: string,
 *   status: number,
 *   duration_ms: number,
 *   rate_limit_remaining: number | undefined,
 * }} fields
 */
export function githubApiCall(logger, fields) {
  const level =
    typeof fields.rate_limit_remaining === 'number' && fields.rate_limit_remaining < 100
      ? 'warn'
      : 'info';
  logger[level](EVENTS.GITHUB_API_CALL, {
    event: EVENTS.GITHUB_API_CALL,
    method: fields.method,
    path: fields.path,
    status: fields.status,
    duration_ms: fields.duration_ms,
    rate_limit_remaining: fields.rate_limit_remaining,
  });
}

/**
 * Emitido cuando una llamada a GitHub API falla (HTTP `!res.ok`) — Phase 23 D-15.
 * Complementa `github.api.call`: el cliente emite uno u otro por request (nunca ambos).
 *
 * Divergencia respecto a `planeApiCallFailed`: en lugar de `step` (gate-step-level),
 * GitHub usa la tripleta HTTP `{method, path, status}` + `error` snippet del body
 * (truncado a 200 chars por el caller para evitar fugas de payload sensible).
 *
 * @param {Logger} logger
 * @param {{ method: string, path: string, status: number, error: string }} fields
 */
export function githubApiCallFailed(logger, fields) {
  logger.error(EVENTS.GITHUB_API_CALL_FAILED, {
    event: EVENTS.GITHUB_API_CALL_FAILED,
    method: fields.method,
    path: fields.path,
    status: fields.status,
    error: fields.error,
  });
}

/**
 * Worktree cleanup OK — emitted (info) after a clean worktree was
 * successfully removed and (optionally) its branch deleted (Phase 19 D-08).
 *
 * @param {Logger} logger
 * @param {{ session_id: string, worktree_path: string, branch_deleted: boolean }} fields
 */
export function worktreeCleanupOk(logger, fields) {
  logger.info(EVENTS.WORKTREE_CLEANUP_OK, {
    event: EVENTS.WORKTREE_CLEANUP_OK,
    session_id: fields.session_id,
    worktree_path: fields.worktree_path,
    branch_deleted: fields.branch_deleted,
  });
}

/**
 * Worktree cleanup DIRTY — emitted (warn) when the worktree had uncommitted
 * changes and was moved aside to `<path>.dirty` for human review (Phase 19 D-02).
 *
 * @param {Logger} logger
 * @param {{ session_id: string, worktree_path: string, moved_to: string }} fields
 */
export function worktreeCleanupDirty(logger, fields) {
  logger.warn(EVENTS.WORKTREE_CLEANUP_DIRTY, {
    event: EVENTS.WORKTREE_CLEANUP_DIRTY,
    session_id: fields.session_id,
    worktree_path: fields.worktree_path,
    moved_to: fields.moved_to,
  });
}

/**
 * Worktree cleanup ERROR — emitted (error) when a cleanup step failed
 * unexpectedly (FS error, git lock, race). The stop hook continues
 * fail-open after this event (Phase 19 D-03).
 *
 * @param {Logger} logger
 * @param {{
 *   session_id: string,
 *   worktree_path: string,
 *   phase: 'status' | 'remove' | 'move' | 'branch' | 'prune',
 *   reason: string,
 * }} fields
 */
export function worktreeCleanupError(logger, fields) {
  logger.error(EVENTS.WORKTREE_CLEANUP_ERROR, {
    event: EVENTS.WORKTREE_CLEANUP_ERROR,
    session_id: fields.session_id,
    worktree_path: fields.worktree_path,
    phase: fields.phase,
    reason: fields.reason,
  });
}

/**
 * Skill sync AUTO ok — emitted (info) when launchOrchestrator auto-syncs
 * the canonical skill from repo → home (Phase 21 D-03b). `files_changed` is
 * the count of files actually copied this run (may be 0 if drift was resolved
 * via symlink-replace alone — caller normalizes that case).
 *
 * NOTE: There is intentionally no noop variant of this event (Phase 21 D-03b):
 * silence when drift is not detected, mirroring Phase 19 D-10 which dropped
 * `worktree.cleanup.dirty` skipped-legacy. The CLI surface (`kodo skill sync`)
 * already prints `No drift` to stdout; observability via NDJSON only covers
 * the auto path's non-silent branches (ok with files_changed > 0, error).
 *
 * @param {Logger} logger
 * @param {{ source: string, dest: string, files_changed: number }} fields
 */
export function skillSyncAuto(logger, fields) {
  logger.info(EVENTS.SKILL_SYNC_AUTO, {
    event: EVENTS.SKILL_SYNC_AUTO,
    source: fields.source,
    dest: fields.dest,
    files_changed: fields.files_changed,
  });
}

/**
 * Skill sync AUTO error — emitted (error) when the auto-sync in launchOrchestrator
 * failed (FS error, permissions, etc). The orchestrator continues fail-open
 * (Phase 21 D-03 — mismo principio que worktree cleanup Phase 19 D-03).
 *
 * @param {Logger} logger
 * @param {{ source: string, dest: string, error: string }} fields
 */
export function skillSyncAutoError(logger, fields) {
  logger.error(EVENTS.SKILL_SYNC_AUTO_ERROR, {
    event: EVENTS.SKILL_SYNC_AUTO_ERROR,
    source: fields.source,
    dest: fields.dest,
    error: fields.error,
  });
}
