// @ts-check
//
// src/logger-events/host.js — reconciliación host ↔ state (WorkspaceHost).
//
// Eventos del carril host: listado de workspaces del host y el tick de
// reconciliación contra `state.json` (Phase 38 Plan 04, D-13).
//
// Cada helper es pure transform (campos → record) y delega en logger.info/warn/error.
// Whitelist EXPLÍCITO field-by-field — NUNCA spread `...fields` — para que ningún campo
// extra del caller alcance el sink NDJSON append-only.

import { EVENTS } from './events.js';

/**
 * @typedef {import('../logger.js').Logger} Logger
 */

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
