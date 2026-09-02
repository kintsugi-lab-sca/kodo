// @ts-check
//
// src/logger-events/worktree.js — limpieza de worktrees (Phase 19).
//
// Eventos del carril de cleanup de worktrees: resultado ok / dirty / error, la rama
// conservada y la rama restaurada. Emisor: `src/hooks/worktree-cleanup.js`.
//
// Cada helper es pure transform (campos → record) y delega en logger.info/warn/error.
// Whitelist EXPLÍCITO field-by-field — NUNCA spread `...fields` — para que ningún campo
// extra del caller alcance el sink NDJSON append-only.

import { EVENTS } from './events.js';

/**
 * @typedef {import('../logger.js').Logger} Logger
 */

/**
 * Worktree cleanup OK — emitted (info) after a clean worktree was
 * successfully removed and (optionally) its branch deleted (Phase 19 D-08).
 *
 * `already_gone: true` (KODO-30) marca el camino en el que NO hubo nada que
 * remover: el directorio del worktree ya no existía cuando corrió el cleanup
 * (el «Remove worktree» que Claude Code ofrece al salir lo borra antes). Eso NO es
 * un error — antes se emitía `worktree.cleanup.error{phase:status}` porque el
 * `status --porcelain` fallaba sobre un directorio ausente, y el operador veía
 * un fallo en cada cierre normal. El camino sigue decidiendo sobre la rama
 * (prune + gate KODO-21), así que `branch_deleted` es significativo igual.
 *
 * LOG-12: whitelist explícito — no `...fields` spread. `already_gone` se
 * normaliza a booleano para que el campo esté SIEMPRE presente en el NDJSON y
 * `already_gone=false` sea greppable, no una ausencia que haya que inferir.
 *
 * @param {Logger} logger
 * @param {{ session_id: string, worktree_path: string, branch_deleted: boolean, already_gone?: boolean }} fields
 */
export function worktreeCleanupOk(logger, fields) {
  logger.info(EVENTS.WORKTREE_CLEANUP_OK, {
    event: EVENTS.WORKTREE_CLEANUP_OK,
    session_id: fields.session_id,
    worktree_path: fields.worktree_path,
    branch_deleted: fields.branch_deleted,
    already_gone: fields.already_gone === true,
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
 * Worktree BRANCH KEPT — emitted (warn) when the clean path removed the worktree
 * but PRESERVED its branch because the branch still holds commits unreachable
 * from any other ref (KODO-21). También cubre el caso fail-safe en el que la
 * verificación de merge no se pudo hacer: ante la duda, la rama se conserva.
 *
 * `unmerged_commits` es el conteo exacto de commits fuera del resto de refs, o
 * `null` cuando la verificación falló (en ese caso `reason` lleva el error de git).
 *
 * LOG-12: whitelist explícito — no `...fields` spread.
 *
 * @param {Logger} logger
 * @param {{
 *   session_id: string,
 *   worktree_path: string,
 *   branch: string,
 *   unmerged_commits: number | null,
 *   reason: string | null,
 * }} fields
 */
export function worktreeBranchKept(logger, fields) {
  logger.warn(EVENTS.WORKTREE_BRANCH_KEPT, {
    event: EVENTS.WORKTREE_BRANCH_KEPT,
    session_id: fields.session_id,
    worktree_path: fields.worktree_path,
    branch: fields.branch,
    unmerged_commits: fields.unmerged_commits,
    reason: fields.reason,
  });
}

/**
 * Worktree BRANCH RESTORED — emitted (warn) when the branch of a closing session had
 * ALREADY been deleted by someone else and kodo recreated it from the SHA that the Stop
 * hook sealed while the worktree was still alive (KODO-68).
 *
 * QUIÉN la borra, si el gate KODO-21 nunca lo hace: al salir de una sesión `--worktree`,
 * el prompt «Remove worktree» de Claude Code ejecuta `worktree remove --force` +
 * `branch -D worktree-<sid>` ANTES de que arranque `SessionEnd`, sin comprobar si esa
 * rama tenía commits sin integrar. Los commits quedaban solo alcanzables por
 * `git fsck --unreachable` y a merced del siguiente `gc`.
 *
 * Es `warn` y no `info` A PROPÓSITO: el trabajo se salva, pero que haya hecho falta
 * salvarlo es exactamente lo que el operador tiene que poder grepear. `unmerged_commits`
 * es el conteo de commits que solo vivían en ese SHA, o `null` cuando la verificación no
 * se pudo hacer y se restauró por fail-safe.
 *
 * LOG-12: whitelist explícito — no `...fields` spread.
 *
 * @param {Logger} logger
 * @param {{
 *   session_id: string,
 *   worktree_path: string,
 *   branch: string,
 *   head: string,
 *   unmerged_commits: number | null,
 * }} fields
 */
export function worktreeBranchRestored(logger, fields) {
  logger.warn(EVENTS.WORKTREE_BRANCH_RESTORED, {
    event: EVENTS.WORKTREE_BRANCH_RESTORED,
    session_id: fields.session_id,
    worktree_path: fields.worktree_path,
    branch: fields.branch,
    head: fields.head,
    unmerged_commits: fields.unmerged_commits,
  });
}
