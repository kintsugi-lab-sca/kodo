// @ts-check
//
// src/logger-events/provider.js — llamadas a APIs de provider (Plane, GitHub) y enrichment de estado.
//
// Eventos del carril provider: toda llamada saliente a una API externa y su
// fallo correlativo. Emisores: `src/providers/plane/client.js`,
// `src/providers/github/client.js`, `src/server/provider-state.js`.
//
// Cada helper es pure transform (campos → record) y delega en logger.info/warn/error.
// Whitelist EXPLÍCITO field-by-field — NUNCA spread `...fields` — para que ningún campo
// extra del caller alcance el sink NDJSON append-only.

import { EVENTS } from './events.js';

/**
 * @typedef {import('../logger.js').Logger} Logger
 */

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
