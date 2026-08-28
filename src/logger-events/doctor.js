// @ts-check
//
// src/logger-events/doctor.js — saneo `kodo gsd doctor` y `kodo sidebar doctor`.
//
// Eventos de los dos carriles de saneo: `doctor.*` (worktrees, locks, logs —
// `src/gsd/doctor.js`) y `sidebar.doctor.*` (drift de workspace-groups —
// `src/cmux/sidebar-doctor.js`). Cada acción destructiva queda auditable.
//
// Cada helper es pure transform (campos → record) y delega en logger.info/warn/error.
// Whitelist EXPLÍCITO field-by-field — NUNCA spread `...fields` — para que ningún campo
// extra del caller alcance el sink NDJSON append-only.

import { EVENTS } from './events.js';

/**
 * @typedef {import('../logger.js').Logger} Logger
 */

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

/**
 * Emitido (info) al final de `execute({fix:true})` con los contadores del
 * allowlist ejecutado (grupos creados, workspaces añadidos, grupos disueltos).
 *
 * @param {Logger} logger
 * @param {{ created: number, added: number, ungrouped: number }} fields
 */
export function sidebarDoctorFix(logger, fields) {
  logger.info(EVENTS.SIDEBAR_DOCTOR_FIX, {
    event: EVENTS.SIDEBAR_DOCTOR_FIX,
    created: fields.created,
    added: fields.added,
    ungrouped: fields.ungrouped,
  });
}

/**
 * Emitido (error) cuando una acción del allowlist del sidebar doctor falla. El
 * fail-open per item jamás es silencioso. `category` identifica el paso que falló
 * (create/add/set-anchor/ungroup/missing_group/execute); `target` el item.
 *
 * @param {Logger} logger
 * @param {{ category: string, reason: string, target: string }} fields
 */
export function sidebarDoctorFixError(logger, fields) {
  logger.error(EVENTS.SIDEBAR_DOCTOR_FIX_ERROR, {
    event: EVENTS.SIDEBAR_DOCTOR_FIX_ERROR,
    category: fields.category,
    reason: fields.reason,
    target: fields.target,
  });
}
