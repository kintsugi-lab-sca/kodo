// @ts-check
//
// src/logger-events/events.js — taxonomía cerrada de eventos (constante `EVENTS`)
// y el resolutor determinista del path de transcript.
//
// Es la raíz del subárbol `logger-events/`: los módulos de dominio hermanos
// importan `EVENTS` de aquí y nada más. Los ÚNICOS imports runtime de todo el
// subárbol son los dos de este fichero (`node:os` + `node:path`, stdlib) — el
// resto son imports de TIPO en JSDoc, que desaparecen en runtime.
//
// Invariante LOG-12: pure transform, zero side effect. No abre archivos, no
// loguea. El módulo PROHIBIDO en el grafo del vigilante es `src/logger.js` (el
// sink NDJSON real), NUNCA este subárbol de taxonomía.

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
 *   WORKTREE_BRANCH_KEPT: 'worktree.branch.kept',
 *   SKILL_SYNC_AUTO: 'skill.sync.auto',
 *   SKILL_SYNC_AUTO_ERROR: 'skill.sync.auto.error',
 *   GITHUB_API_CALL: 'github.api.call',
 *   GITHUB_API_CALL_FAILED: 'github.api.call.failed',
 *   POLLING_TICK: 'polling.tick',
 *   POLLING_DISPATCH: 'polling.dispatch',
 *   POLLING_ERROR: 'polling.error',
 *   POLLING_TICK_SUMMARY: 'polling.tick.summary',
 *   STATE_MIGRATION_V3: 'state.migration.v2_to_v3',
 *   HOST_LIST_OK: 'host.list_workspaces.ok',
 *   HOST_LIST_FAIL: 'host.list_workspaces.fail',
 *   HOST_RECONCILE_TICK: 'host.reconcile.tick',
 *   PROVIDER_STATE_FETCH_FAILED: 'provider.state.fetch.failed',
 *   DOCTOR_SCAN: 'doctor.scan',
 *   DOCTOR_FIX_WORKTREE: 'doctor.fix.worktree',
 *   DOCTOR_FIX_LOCK: 'doctor.fix.lock',
 *   DOCTOR_FIX_LOG: 'doctor.fix.log',
 *   DOCTOR_FIX_ERROR: 'doctor.fix.error',
 *   SIDEBAR_DOCTOR_SCAN: 'sidebar.doctor.scan',
 *   SIDEBAR_DOCTOR_FIX: 'sidebar.doctor.fix',
 *   SIDEBAR_DOCTOR_FIX_ERROR: 'sidebar.doctor.fix.error',
 *   SESSION_DISMISSED: 'session.dismissed',
 *   SESSION_BACKSTOP_REVIEW: 'session.backstop.review',
 *   SESSION_ORPHAN_DETECTED: 'session.orphan.detected',
 *   INTEGRATE_ACTION: 'integrate.action',
 *   SESSION_CLOSE_UNMATCHED: 'session.close.unmatched',
 *   WEBHOOK_RECEIVED: 'webhook.received',
 *   WEBHOOK_REJECTED: 'webhook.rejected',
 *   WEBHOOK_REPLAY: 'webhook.replay',
 *   DISPATCH_DECISION: 'dispatch.decision',
 *   DISPATCH_ERROR: 'dispatch.error',
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
  WORKTREE_BRANCH_KEPT:    'worktree.branch.kept',
  SKILL_SYNC_AUTO:         'skill.sync.auto',
  SKILL_SYNC_AUTO_ERROR:   'skill.sync.auto.error',
  GITHUB_API_CALL:         'github.api.call',
  GITHUB_API_CALL_FAILED:  'github.api.call.failed',
  POLLING_TICK:            'polling.tick',
  POLLING_DISPATCH:        'polling.dispatch',
  POLLING_ERROR:           'polling.error',
  POLLING_TICK_SUMMARY:    'polling.tick.summary',
  STATE_MIGRATION_V3:      'state.migration.v2_to_v3',
  HOST_LIST_OK:            'host.list_workspaces.ok',
  HOST_LIST_FAIL:          'host.list_workspaces.fail',
  HOST_RECONCILE_TICK:     'host.reconcile.tick',
  PROVIDER_STATE_FETCH_FAILED: 'provider.state.fetch.failed',
  DOCTOR_SCAN:             'doctor.scan',
  DOCTOR_FIX_WORKTREE:     'doctor.fix.worktree',
  DOCTOR_FIX_LOCK:         'doctor.fix.lock',
  DOCTOR_FIX_LOG:          'doctor.fix.log',
  DOCTOR_FIX_ERROR:        'doctor.fix.error',
  SIDEBAR_DOCTOR_SCAN:     'sidebar.doctor.scan',
  SIDEBAR_DOCTOR_FIX:      'sidebar.doctor.fix',
  SIDEBAR_DOCTOR_FIX_ERROR: 'sidebar.doctor.fix.error',
  SESSION_DISMISSED:       'session.dismissed',
  SESSION_BACKSTOP_REVIEW: 'session.backstop.review',
  SESSION_ORPHAN_DETECTED: 'session.orphan.detected',
  INTEGRATE_ACTION:        'integrate.action',
  SESSION_CLOSE_UNMATCHED: 'session.close.unmatched',
  WEBHOOK_RECEIVED:        'webhook.received',
  WEBHOOK_REJECTED:        'webhook.rejected',
  WEBHOOK_DISPATCH_RETRY:  'webhook.dispatch.retry',
  WEBHOOK_REPLAY:          'webhook.replay',
  DISPATCH_DECISION:       'dispatch.decision',
  DISPATCH_ERROR:          'dispatch.error',
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
