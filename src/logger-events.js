// @ts-check
//
// src/logger-events.js — Taxonomía cerrada de 23 eventos de ciclo de vida.
//
// Contrato fijo por ROADMAP §Phase 7 + extensiones v0.3 (LOG-09)
// + Phase 19 (worktree cleanup) + Phase 21 (skill sync) + Phase 23 (github client)
// + Phase 25 (polling trigger channel) + Phase 28 (polling.tick.summary cross-repo aggregate, D-10):
//   session.start, session.end, state.transition, orchestrator.review,
//   gsd.phase.resolved, gsd.bootstrap, plane.api.call, plane.api.call.failed,
//   github.api.call, github.api.call.failed,
//   worktree.cleanup.ok, worktree.cleanup.dirty, worktree.cleanup.error,
//   skill.sync.auto, skill.sync.auto.error,
//   polling.tick, polling.dispatch, polling.error, polling.tick.summary
// + Phase 71 (backstop mecánico de In Review en SessionEnd, DELIV-04):
//   session.backstop.review
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
 * Session dismissed — emitted (info) by the server's DELETE /sessions/{id} handler
 * after a dead session was sanitized via doctor.execute (Phase 42 DISMISS-01). This
 * is the AGGREGATE audit event; doctor still emits the per-item doctor.fix.* detail.
 * Makes the destructive mutation auditable (T-42-03 Repudiation mitigation).
 *
 * LOG-12: explicit whitelist — no `...fields` spread.
 *
 * @param {Logger} logger
 * @param {{ task_id: string, actions_count: number }} fields
 */
export function sessionDismissed(logger, fields) {
  logger.info(EVENTS.SESSION_DISMISSED, {
    event: EVENTS.SESSION_DISMISSED,
    task_id: fields.task_id,
    actions_count: fields.actions_count,
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

// ─── Phase 25: polling trigger channel ─────────────────────────────────────
//
// Tres helpers que espejan el patrón Phase 23 (`githubApiCall` /
// `githubApiCallFailed`): payload con campos whitelisted, JSDoc typedef
// explícito, level fijo por evento (info / info / warn).
//
// Invariante de seguridad T-25-02: `pollingDispatch` SOLO acepta y emite
// `{event, owner, repo, ref, pattern}`. Cualquier campo extra del caller
// queda descartado silenciosamente — no se accede a contenido de usuario
// (body, título, raw object) ni en la firma JSDoc ni en el cuerpo del
// helper. El sink NDJSON (`~/.kodo/logs/*.ndjson`) es append-only y queda
// expuesto al consumer (`kodo logs`); por tanto cualquier filtración aquí
// persiste en disco.
//
// Invariante LOG-12: cero imports nuevos. Los únicos imports del módulo
// siguen siendo `node:os` + `node:path` declarados en líneas 21-22.

/**
 * Emitido en cada tick del polling loop por (owner, repo). El consumer
 * (`src/triggers/polling.js`, Plan 25-02) llama a este helper exactamente
 * una vez por repo por tick, después de procesar el response del client
 * (200 = lista de items o 304 = cursor preservado). `dispatched` es el
 * count de issues que dispararon `dispatchTrigger` en este tick (0 cuando
 * `first_tick:true` o cuando no hubo deltas).
 *
 * `first_tick:true` se emite solo en el primer tick por repo del proceso
 * (post-warmup, antes de aplicar el cursor) — patrón "skip-first-tick"
 * de POLL-03 para evitar storm de dispatches en arranque.
 *
 * @param {Logger} logger
 * @param {{
 *   owner: string,
 *   repo: string,
 *   status: number,
 *   dispatched: number,
 *   first_tick?: boolean,
 * }} fields
 */
export function pollingTick(logger, fields) {
  logger.info(EVENTS.POLLING_TICK, {
    event: EVENTS.POLLING_TICK,
    owner: fields.owner,
    repo: fields.repo,
    status: fields.status,
    dispatched: fields.dispatched,
    ...(fields.first_tick ? { first_tick: true } : {}),
  });
}

/**
 * Emitido cada vez que el polling loop dispara `dispatchTrigger(event)`
 * para una issue (pattern a/b/c de POLL-03: new label, updated since cursor,
 * state change). El payload es estrictamente de identificación — `owner`,
 * `repo`, `ref` (formato `owner/repo#number`), `pattern` (literal a-new /
 * b-updated / c-state).
 *
 * Invariante de seguridad T-25-02: NO se incluye ningún campo de contenido
 * de usuario (body, título, raw object). El helper toma SOLO los 4 campos
 * de identificación; cualquier campo extra del caller queda descartado.
 *
 * @param {Logger} logger
 * @param {{ owner: string, repo: string, ref: string, pattern: string }} fields
 */
export function pollingDispatch(logger, fields) {
  logger.info(EVENTS.POLLING_DISPATCH, {
    event: EVENTS.POLLING_DISPATCH,
    owner: fields.owner,
    repo: fields.repo,
    ref: fields.ref,
    pattern: fields.pattern,
  });
}

/**
 * Emitido (warn) en cualquier branch de error del polling loop: 429, 5xx,
 * timeout, abort, o exhaustion tras N retries (POLL-04). `attempt` es el
 * intento 1-indexed dentro de la secuencia de retry exponencial; cuando
 * el loop hace warn-and-continue post-3-retries, se emite un último evento
 * con `attempt:3`. `error` opcional contiene un snippet truncado del mensaje
 * (el caller en polling.js debe truncar a ≤ 200 chars para evitar fugas).
 *
 * Nivel `warn` (no `error`) porque el loop es fail-open: un tick fallido
 * NO termina el proceso; el siguiente tick se agenda igual. El operador
 * detecta el patrón vía `kodo logs | grep polling.error`.
 *
 * @param {Logger} logger
 * @param {{
 *   owner: string,
 *   repo: string,
 *   status: number,
 *   attempt: number,
 *   error?: string,
 * }} fields
 */
export function pollingError(logger, fields) {
  logger.warn(EVENTS.POLLING_ERROR, {
    event: EVENTS.POLLING_ERROR,
    owner: fields.owner,
    repo: fields.repo,
    status: fields.status,
    attempt: fields.attempt,
    ...(fields.error ? { error: fields.error } : {}),
  });
}

/**
 * Emitido AL FINAL de cada tick agregado del polling loop, una vez por tick
 * (D-10 Phase 28). Mientras `pollingTick` emite per-repo (granular drill-down),
 * este emite cross-repo (agregado) para soportar el `--verbose` foreground
 * summary line y el resumen estructurado en el logfile del daemon.
 *
 * Shape D-10 canónico:
 *   {
 *     event: 'polling.tick.summary',
 *     repos_polled: number,          // count, NO la lista en sí
 *     total_dispatches: number,      // suma cross-repo de dispatches en este tick
 *     rate_limit_remaining: number | null,  // D-12: mínimo cross-repo (más conservador);
 *                                            // null cuando ningún repo retornó header
 *     repos: string[],               // lista de keys `owner/repo` polled en este tick
 *   }
 *
 * D-11 (preserve drill-down): `pollingTick` per-repo se sigue emitiendo
 * sin cambios — el dispatcher/--verbose es aditivo, no reemplaza al granular.
 *
 * D-12 (rate_limit_remaining null fallback): si ningún repo del tick retornó
 * `rate_limit_remaining` (p.ej. todos los repos pasaron por path provider-only
 * que no propaga rate-limit, o todos errored antes del envelope), el caller
 * pasa `null` explícito. El helper lo preserva tal cual — NO sustituye por 0.
 *
 * Invariante T-25-02 (Information disclosure): el helper SOLO emite contadores
 * + lista de repos string keys (`owner/repo`). JAMÁS body, título, ref completo
 * (esa info ya viaja en `pollingDispatch` per-event), ni payload raw del issue.
 * Whitelist explícito field-by-field — NO spread `...fields` para evitar leaks
 * accidentales si el caller pasa propiedades extra.
 *
 * @param {Logger} logger
 * @param {{
 *   repos_polled: number,
 *   total_dispatches: number,
 *   rate_limit_remaining: number | null,
 *   repos: string[],
 * }} fields
 */
export function pollingTickSummary(logger, fields) {
  logger.info(EVENTS.POLLING_TICK_SUMMARY, {
    event: EVENTS.POLLING_TICK_SUMMARY,
    repos_polled: fields.repos_polled,
    total_dispatches: fields.total_dispatches,
    rate_limit_remaining: fields.rate_limit_remaining,
    repos: fields.repos,
  });
}

// ─── Phase 38: state schema v2 → v3 migration ──────────────────────────────
//
// Emitido (info) una vez cuando migrateStateIfNeeded bumpea el schema de v2 a
// v3 (D-13). Whitelist explícita field-by-field (NO spread — patrón pollingTick).
// `rescued` y `sealed` son 0 en Plan 02 (el rescate cross-host desde history
// vive en la reconciliación de Plan 04); quedan como 0 hasta entonces, lo cual
// es semánticamente correcto. Invariante LOG-12: cero imports nuevos.

/**
 * @param {Logger} logger
 * @param {{
 *   from_count: number,
 *   to_sessions: number,
 *   to_history: number,
 *   rescued: number,
 *   sealed: number,
 * }} fields
 */
export function stateMigrationV3(logger, fields) {
  logger.info(EVENTS.STATE_MIGRATION_V3, {
    event: EVENTS.STATE_MIGRATION_V3,
    from_count: fields.from_count,
    to_sessions: fields.to_sessions,
    to_history: fields.to_history,
    rescued: fields.rescued,
    sealed: fields.sealed,
  });
}

// ─── Phase 38 Plan 04: WorkspaceHost reconciliation (D-13) ─────────────────
//
// 3 eventos de la reconciliación host↔state. Whitelist explícita field-by-field
// (NO spread — patrón pollingTick). Invariante LOG-12: cero imports nuevos.

/**
 * Emitido (info) cuando host.listWorkspaces resuelve OK en un tick de reconciliación.
 * @param {Logger} logger
 * @param {{ count: number, duration_ms: number }} fields
 */
export function hostListOk(logger, fields) {
  logger.info(EVENTS.HOST_LIST_OK, {
    event: EVENTS.HOST_LIST_OK,
    count: fields.count,
    duration_ms: fields.duration_ms,
  });
}

/**
 * Emitido (warn) cuando host.listWorkspaces falla — el reconciliador skipea el
 * tick (never-throws, D-07 F5). `detail` es un snippet del mensaje (el caller lo trunca).
 * @param {Logger} logger
 * @param {{ code: string, detail: string, duration_ms: number }} fields
 */
export function hostListFail(logger, fields) {
  logger.warn(EVENTS.HOST_LIST_FAIL, {
    event: EVENTS.HOST_LIST_FAIL,
    code: fields.code,
    detail: fields.detail,
    duration_ms: fields.duration_ms,
  });
}

/**
 * Emitido (info) al final de cada tick de reconciliación (D-13). Contadores del
 * resultado: cuántas sessions se rescataron de history, se sellaron a closed,
 * transicionaron de estado, y el total escaneado.
 * @param {Logger} logger
 * @param {{ rescued: number, sealed: number, transitioned: number, total: number }} fields
 */
export function hostReconcileTick(logger, fields) {
  logger.info(EVENTS.HOST_RECONCILE_TICK, {
    event: EVENTS.HOST_RECONCILE_TICK,
    rescued: fields.rescued,
    sealed: fields.sealed,
    transitioned: fields.transitioned,
    total: fields.total,
  });
}

// ─── Phase 40: provider_state enrichment (D-15) ────────────────────────────
//
// Emitido (error) cuando un `getTaskState` falla durante el enrichment de
// `GET /status` (Plan 40-02). El fail-open de la fila JAMÁS es silencioso en el
// log: la fila resuelve a `{provider_state:null, provider_state_reason:'fetch-failed'}`
// y este evento queda en el NDJSON para que el operador detecte el patrón.
//
// Información disclosure (T-40-04): whitelist EXPLÍCITO {task_id, provider, error}
// — NUNCA spread `...fields`. El caller pasa `err.message` (un string), NUNCA el
// objeto error/response completo, para que tokens/secrets de headers/body jamás
// alcancen el sink append-only. Invariante LOG-12: cero imports nuevos.

/**
 * @param {Logger} logger
 * @param {{ task_id: string, provider: string, error: string }} fields
 */
export function providerStateFetchFailed(logger, fields) {
  logger.error(EVENTS.PROVIDER_STATE_FETCH_FAILED, {
    event: EVENTS.PROVIDER_STATE_FETCH_FAILED,
    task_id: fields.task_id,
    provider: fields.provider,
    error: fields.error,
  });
}

// ─── Phase 41: doctor saneo observability (DOCTOR-04) ──────────────────────
//
// 5 eventos del módulo de saneo `kodo gsd doctor` (Plan 02). Cada acción
// destructiva queda auditable en el NDJSON append-only (T-41-03). Mismo molde
// que worktreeCleanup* / pollingTick: whitelist EXPLÍCITO field-by-field —
// NUNCA spread `...fields` — para que ningún campo extra del caller se filtre
// al sink. Token-free: todo es FS/git, no hay model call, así que NINGÚN helper
// añade un campo `tokens` (espejo de worktreeCleanup*). Invariante LOG-12: cero
// imports nuevos (los únicos siguen siendo `node:os` + `node:path`).

/**
 * Emitido al iniciar/terminar un escaneo de `kodo gsd doctor` (dry-run o --fix).
 * Resumen de cuántos items de cada categoría se detectaron. info-level.
 *
 * @param {Logger} logger
 * @param {{
 *   mode: 'dry-run' | 'fix',
 *   worktrees: number,
 *   locks: number,
 *   logs: number,
 *   zombies: number,
 * }} fields
 */
export function doctorScan(logger, fields) {
  logger.info(EVENTS.DOCTOR_SCAN, {
    event: EVENTS.DOCTOR_SCAN,
    mode: fields.mode,
    worktrees: fields.worktrees,
    locks: fields.locks,
    logs: fields.logs,
    zombies: fields.zombies,
  });
}

/**
 * Emitido (info) cuando doctor sanea un worktree huérfano (remove / prune / moved
 * a `.dirty`). `moved_to` es null salvo en el dirty path. info-level.
 *
 * @param {Logger} logger
 * @param {{
 *   session_id: string,
 *   worktree_path: string,
 *   action: 'remove' | 'prune' | 'moved',
 *   moved_to: string | null,
 * }} fields
 */
export function doctorFixWorktree(logger, fields) {
  logger.info(EVENTS.DOCTOR_FIX_WORKTREE, {
    event: EVENTS.DOCTOR_FIX_WORKTREE,
    session_id: fields.session_id,
    worktree_path: fields.worktree_path,
    action: fields.action,
    moved_to: fields.moved_to,
  });
}

/**
 * Emitido cuando doctor evalúa un lock per-repo colgado. `decision: 'stolen'`
 * (PID muerto / TTL vencido → lock liberado) emite warn; `'kept'` (PID vivo →
 * respetado) emite info.
 *
 * @param {Logger} logger
 * @param {{
 *   project_path: string,
 *   decision: 'stolen' | 'kept',
 *   pid: number,
 *   reason: string,
 * }} fields
 */
export function doctorFixLock(logger, fields) {
  const level = fields.decision === 'stolen' ? 'warn' : 'info';
  logger[level](EVENTS.DOCTOR_FIX_LOCK, {
    event: EVENTS.DOCTOR_FIX_LOCK,
    project_path: fields.project_path,
    decision: fields.decision,
    pid: fields.pid,
    reason: fields.reason,
  });
}

/**
 * Emitido (info) cuando doctor borra/rota un log NDJSON antiguo. info-level.
 *
 * @param {Logger} logger
 * @param {{ log_path: string, session_id: string }} fields
 */
export function doctorFixLog(logger, fields) {
  logger.info(EVENTS.DOCTOR_FIX_LOG, {
    event: EVENTS.DOCTOR_FIX_LOG,
    log_path: fields.log_path,
    session_id: fields.session_id,
  });
}

/**
 * Emitido (error) cuando un paso de saneo de doctor falla. El fail-open de doctor
 * jamás es silencioso. `category` identifica el carril que falló; `target` el item.
 *
 * @param {Logger} logger
 * @param {{
 *   category: 'worktree' | 'lock' | 'log' | 'zombie',
 *   reason: string,
 *   target: string,
 * }} fields
 */
export function doctorFixError(logger, fields) {
  logger.error(EVENTS.DOCTOR_FIX_ERROR, {
    event: EVENTS.DOCTOR_FIX_ERROR,
    category: fields.category,
    reason: fields.reason,
    target: fields.target,
  });
}

// ─── Phase 79: sidebar doctor (workspace-group drift) ──────────────────────
//
// Taxonomía espejo de doctor* (arriba) para el carril `kodo sidebar doctor`
// (Discreción D-11). scan es read-only (info, contadores por categoría); fix
// emite los contadores del allowlist ejecutado; fix.error registra el fallo
// per-item (fail-open jamás silencioso).

/**
 * Emitido (info) por `scan()` del sidebar doctor — read-only, contadores por
 * categoría clasificada. `mode` distingue el pase dry-run del re-scan interno
 * de `execute` (D-06 TOCTOU).
 *
 * @param {Logger} logger
 * @param {{
 *   mode: 'dry-run' | 'fix',
 *   missing: number,
 *   loose: number,
 *   empty: number,
 * }} fields
 */
export function sidebarDoctorScan(logger, fields) {
  logger.info(EVENTS.SIDEBAR_DOCTOR_SCAN, {
    event: EVENTS.SIDEBAR_DOCTOR_SCAN,
    mode: fields.mode,
    missing: fields.missing,
    loose: fields.loose,
    empty: fields.empty,
  });
}

// ─── Phase 71: backstop mecánico de In Review en SessionEnd (DELIV-04) ─────
//
// Emitido (info) por `runReviewBackstop` (src/hooks/session-end.js) cuando el
// hook SessionEnd transiciona una tarea que seguía «In Progress» al estado
// review de forma automática («cierre automático»), cubriendo el caso en que
// el LLM no completó la transición antes del cierre real de la sesión (causa
// raíz T5). La transición del LLM pasa a ser optimización, no única vía.
//
// Invariante de seguridad T-25-02 (Information disclosure): el helper SOLO
// emite los 4 campos de identificación/transición `{session_id, task_id, from,
// to}`. Whitelist EXPLÍCITO field-by-field — NUNCA spread `...fields` — para
// que ningún campo de contenido de usuario (título/descripción/raw) que el
// caller pudiera pasar por error alcance el sink NDJSON append-only. Invariante
// LOG-12: cero imports nuevos.

/**
 * Emite `session.backstop.review` (info) tras un cierre automático del backstop.
 * `from`/`to` son NOMBRES de estado: `from` es siempre `'in_progress'` (el estado
 * vivo que gatilló el backstop) y `to` es el reviewState resuelto (p. ej.
 * `'In review'`). El helper es pure transform (delega en `logger.info`, LOG-12):
 * no hace I/O y descarta cualquier campo extra del caller (guardrail T-25-02).
 *
 * @param {Logger} logger
 * @param {{ session_id: string, task_id: string | null, from: string, to: string }} fields
 */
export function sessionBackstopReview(logger, fields) {
  logger.info(EVENTS.SESSION_BACKSTOP_REVIEW, {
    event: EVENTS.SESSION_BACKSTOP_REVIEW,
    session_id: fields.session_id,
    task_id: fields.task_id,
    from: fields.from,
    to: fields.to,
  });
}
