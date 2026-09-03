// @ts-check
//
// src/logger-events/session.js — ciclo de vida de la sesión, orquestador, GSD y skill sync.
//
// Eventos del carril de sesión: arranque/cierre (`session.*`), transiciones de
// estado, revisión del orquestador, resolución GSD, sync automático de la skill
// y la migración de schema v2→v3. Emisores: `src/hooks/*`, `src/session/*`,
// `src/orchestrator/launch.js`, `src/server/dismiss.js`, `src/gsd/verify.js`.
//
// Cada helper es pure transform (campos → record) y delega en logger.info/warn/error.
// Whitelist EXPLÍCITO field-by-field — NUNCA spread `...fields` — para que ningún campo
// extra del caller alcance el sink NDJSON append-only.

import { EVENTS, resolveTranscriptPath } from './events.js';

/**
 * @typedef {import('../logger.js').Logger} Logger
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
 * Session AUTO-dismissed — lo emite (info) el barrido de auto-dismiss del daemon
 * (KODO-83) cuando una fila `dead` se descarta SOLA por cumplir las tres condiciones:
 * proceso muerto, tarea cerrada en el provider y worktree ausente o limpio.
 *
 * Evento PROPIO y no `session.dismissed` a propósito: la mutación destructiva es la
 * misma, pero el actor no. Un `session.dismissed` a secas lo pulsó un humano en el
 * dashboard; esto lo decidió kodo, y quien audite el NDJSON necesita poder separarlos
 * con un grep. `task_state` y `worktree` dejan por escrito POR QUÉ se cumplió la regla,
 * que es lo único que no se puede reconstruir después (el worktree ya no está).
 *
 * Un auto-dismiss emite los DOS, en este orden: `session.dismissed` lo escribe el handler
 * compartido (es el audit de la mutación, y vale igual venga de donde venga) y este lo
 * escribe el barrido justo después (es el audit de la DECISIÓN). Separar «qué se borró»
 * de «por qué se decidió borrarlo» es deliberado: el primero tiene que seguir siendo un
 * único evento para los dos disparadores.
 *
 * LOG-12: whitelist explícito — sin spread `...fields`.
 *
 * @param {Logger} logger
 * @param {{ task_id: string, session_id?: string, task_state: string, worktree: string, actions_count: number }} fields
 */
export function sessionAutoDismissed(logger, fields) {
  logger.info(EVENTS.SESSION_AUTO_DISMISSED, {
    event: EVENTS.SESSION_AUTO_DISMISSED,
    task_id: fields.task_id,
    session_id: fields.session_id,
    task_state: fields.task_state,
    worktree: fields.worktree,
    actions_count: fields.actions_count,
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

/**
 * Emite `session.orphan.detected` (info) cuando el barrido de KODO-11
 * (`session/orphan-sweep.js`) encuentra una sesión muerta cuya tarea sigue viva en el
 * provider y postea la señal de cierre incompleto. `state` es el estado LEÍDO del
 * provider que gatilló la señal (siempre `'in_progress'` hoy; el campo queda explícito
 * para no tener que releer el código para interpretar la línea).
 *
 * Mismo guardrail T-25-02 que su hermano `sessionBackstopReview`: whitelist EXPLÍCITO
 * field-by-field, NUNCA spread. El texto del comentario (que sí lleva el `NEXT:` del
 * LLM) viaja al provider, JAMÁS al sink NDJSON.
 *
 * @param {Logger} logger
 * @param {{ session_id: string, task_id: string | null, state: string }} fields
 */
export function sessionOrphanDetected(logger, fields) {
  logger.info(EVENTS.SESSION_ORPHAN_DETECTED, {
    event: EVENTS.SESSION_ORPHAN_DETECTED,
    session_id: fields.session_id,
    task_id: fields.task_id,
    state: fields.state,
  });
}

/**
 * Emite `session.close.unmatched` (warn) — un hook de cierre (Stop / SessionEnd) recibió
 * un `session_id` que NO corresponde a ninguna sesión registrada, y se descartó el cierre
 * (KODO-27).
 *
 * Se emite SÓLO cuando el descarte importaba: había `candidates` sesiones vivas con ese
 * mismo `project_path`, o sea que el fallback por cwd de antes de KODO-27 habría imputado
 * el cierre a una de ellas. Sin candidatos no hay línea — un `Stop` de cualquier sesión
 * ad-hoc de la máquina no es noticia, y los hooks están instalados global.
 *
 * Va a `~/.kodo/logs/hooks.ndjson` (sessionId sintético `hooks`, mismo patrón que
 * `polling` e `integrate`), NO al fichero de la sesión candidata: la línea habla del hook
 * que se contuvo, no de la tarea, y ensuciar el log de la víctima con eventos de terceros
 * es exactamente la confusión de identidad que este fix elimina.
 *
 * Nivel warn a propósito: un filtro por `warn` sobre `hooks.ndjson` saca todos los cierres
 * fantasma evitados, que es la pregunta que se hace el operador cuando una tarea "se cerró
 * sola".
 *
 * LOG-12 / T-25-02: whitelist explícito field-by-field, nunca spread.
 *
 * @param {Logger} logger
 * @param {{
 *   hook: 'stop' | 'session-end',
 *   session_id: string | null,
 *   cwd: string,
 *   candidates: number,
 *   candidate_task_refs: string[],
 * }} fields
 */
export function sessionCloseUnmatched(logger, fields) {
  logger.warn(EVENTS.SESSION_CLOSE_UNMATCHED, {
    event: EVENTS.SESSION_CLOSE_UNMATCHED,
    hook: fields.hook,
    session_id: fields.session_id,
    cwd: fields.cwd,
    candidates: fields.candidates,
    candidate_task_refs: fields.candidate_task_refs,
  });
}
