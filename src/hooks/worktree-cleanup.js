// @ts-check
//
// src/hooks/worktree-cleanup.js — Phase 41 Plan 01 (DOCTOR-02 / D-11).
//
// Helper compartido de saneo de worktree, factorizado VERBATIM desde el bloque
// de cleanup de `src/hooks/stop.js` (Phase 19 WT-04, líneas 272-397) — la "una
// sola fuente de saneo" mandada por D-11. Consumido por `stop.js` (al cerrar una
// sesión) y por `doctor.js` (Plan 02). Garantiza que doctor NUNCA reimplemente
// `git worktree remove/move/prune` ni introduzca borrado recursivo forzado.
//
// PURA + DI + never-throws: no abre sockets, no resuelve config, no lanza. Todo
// I/O de git pasa por el `gitFn` inyectado; el `logger` se inyecta vía args. El
// caller decide cuándo invocar y persistir nada (este helper no toca state.json).
//
// gitFn signature: gitFn(projectPath, argsArray) => Promise<string>|string. El
// gitFn de producción antepone `-C <project>`; git acepta múltiples `-C`
// componibles, así que las lecturas scopeadas al worktree pasan `['-C', wt, ...]`.
//
// Orden de operaciones (Pitfall #2 / D-08): branch read (ANTES de remove) →
// status → remove|move-to-.dirty → branch -D (solo clean) → prune oportunista.
//
// Invariantes de seguridad (T-41-02):
//   - NUNCA borrado recursivo forzado, NUNCA `unlinkSync` del worktree.
//   - `git worktree remove` SIN `--force` (git actúa de segunda barrera).
//   - DIRTY path NUNCA borra: mueve a `${worktree}.dirty` (pre-check lstatSync).
//
// LOG-12 invariant: este módulo NO importa `logger.js`. El `logger` inyectado es
// el único canal de observabilidad; `logger-events.js` (pure transform) sí es
// importable estáticamente — vive en el carril hook, no en el no-logger.

import { lstatSync, renameSync } from 'node:fs';
import {
  worktreeCleanupOk,
  worktreeCleanupDirty,
  worktreeCleanupError,
} from '../logger-events.js';

/**
 * Sanea un worktree de sesión: lee el branch, decide clean/dirty por
 * `status --porcelain`, y o bien lo remueve (+ borra branch) o lo mueve a
 * `<wt>.dirty` para inspección humana, terminando con un `prune` oportunista.
 * Fail-open en todos los pasos — JAMÁS lanza (el caller decide el outer-catch,
 * pero este helper por sí mismo nunca propaga).
 *
 * @param {{
 *   project: string,
 *   worktree: string,
 *   sessionId: string,
 *   gitFn: (cwd: string, args: string[]) => Promise<string> | string,
 *   logger: import('../logger-events.js').Logger,
 * }} args
 * @returns {Promise<{ removed: boolean, moved_to: string | null, branch_deleted: boolean }>}
 *   Resultado estructurado por-item para que doctor (Plan 02) reporte la acción
 *   exacta (D-08): `removed` (clean path OK), `moved_to` (dirty path target) y
 *   `branch_deleted` (clean path borró el branch).
 */
export async function cleanupWorktree({ project, worktree, sessionId, gitFn, logger }) {
  const wt = worktree;
  const cleanupLog = logger;

  let removed = false;
  let moved_to = null;
  let branch_deleted = false;

  // 1. Read branch name BEFORE remove (Pitfall #2 / D-08). Fail-open silent.
  // Usamos `-C <wt>` en args (no como cwd) — el gitFn default antepone `-C
  // <project>` pero git acepta múltiples `-C` componibles. Permite que tests
  // stub-een por `args.includes('--show-current')` sin tocar cwd.
  let branchName = null;
  try {
    const out = await gitFn(project, ['-C', wt, 'branch', '--show-current']);
    branchName = (out || '').trim() || null;
  } catch (err) {
    console.error(`[kodo:worktree-cleanup] branch --show-current failed: ${err.message}`);
  }

  // 2. Dirty check (D-01). Status read failure → emit cleanup.error{phase:status}
  // y abortar (no podemos decidir clean/dirty sin status); aún corre prune al final.
  let isDirty;
  try {
    const status = await gitFn(project, ['-C', wt, 'status', '--porcelain']);
    isDirty = (status || '').length > 0;
  } catch (err) {
    worktreeCleanupError(cleanupLog, {
      session_id: sessionId,
      worktree_path: wt,
      phase: 'status',
      reason: /** @type {Error} */ (err).message,
    });
    isDirty = null;
  }

  if (isDirty === false) {
    // 3a. CLEAN path: remove + branch -D.
    let removeOk = false;
    try {
      await gitFn(project, ['worktree', 'remove', wt]);
      removeOk = true;
    } catch (err) {
      worktreeCleanupError(cleanupLog, {
        session_id: sessionId,
        worktree_path: wt,
        phase: 'remove',
        reason: /** @type {Error} */ (err).message,
      });
    }
    if (removeOk) {
      removed = true;
      if (branchName) {
        try {
          await gitFn(project, ['branch', '-D', branchName]);
          branch_deleted = true;
        } catch (err) {
          // Pitfall #3: branch checked-out by another worktree, race, etc.
          // → warn fail-open. NO emit cleanup.error{phase:branch} — el test
          // contractual exige cleanup.ok con branch_deleted=false.
          console.error(`[kodo:worktree-cleanup] branch -D ${branchName} failed: ${/** @type {Error} */ (err).message}`);
        }
      }
      worktreeCleanupOk(cleanupLog, {
        session_id: sessionId,
        worktree_path: wt,
        branch_deleted,
      });
    }
  } else if (isDirty === true) {
    // 3b. DIRTY path: move-aside to <wt>.dirty (D-02); branch PRESERVADA.
    // Pitfall #1 mitigation (Phase 19 CR-03): lstatSync en try/catch detecta
    // archivos regulares, dirs, symlinks vivos Y symlinks colgantes (la versión
    // previa seguía symlinks y devolvía false → evadía la pre-check). Solo
    // ENOENT mantiene el target canónico; cualquier otro error o stat exitoso
    // fuerza la variante suffixed para evitar que `git worktree move` falle
    // confusamente.
    let target = `${wt}.dirty`;
    try {
      lstatSync(target);
      // Target existe como cualquier cosa (file, dir, symlink vivo o colgante)
      // → forzar variante con timestamp.
      target = `${wt}.dirty-${Date.now()}`;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
        // EACCES, ELOOP u otro: defensivo, no asumimos libre.
        target = `${wt}.dirty-${Date.now()}`;
      }
      // ENOENT: target libre, mantener `<wt>.dirty` canónico.
    }
    let moveOk = false;
    let moveErrMsg = null;
    try {
      await gitFn(project, ['worktree', 'move', wt, target]);
      moveOk = true;
    } catch (err) {
      moveErrMsg = /** @type {Error} */ (err).message;
      // Fallback (D-02): native rename + git worktree repair (raro en git 2.51+,
      // pero defensivo si en versiones antiguas `worktree move` rechaza dirty).
      try {
        renameSync(wt, target);
        await gitFn(project, ['worktree', 'repair', target]);
        moveOk = true;
      } catch (err2) {
        worktreeCleanupError(cleanupLog, {
          session_id: sessionId,
          worktree_path: wt,
          phase: 'move',
          reason: `${moveErrMsg} | fallback: ${/** @type {Error} */ (err2).message}`,
        });
      }
    }
    if (moveOk) {
      moved_to = target;
      worktreeCleanupDirty(cleanupLog, {
        session_id: sessionId,
        worktree_path: wt,
        moved_to: target,
      });
    }
  }
  // isDirty === null: status read failed → cleanup.error{phase:status} ya
  // emitido arriba. Saltamos remove/move pero corremos prune oportunista.

  // 4. Opportunistic prune (D-04). Fail-open con cleanup.error{phase:prune}.
  try {
    await gitFn(project, ['worktree', 'prune']);
  } catch (err) {
    worktreeCleanupError(cleanupLog, {
      session_id: sessionId,
      worktree_path: wt,
      phase: 'prune',
      reason: /** @type {Error} */ (err).message,
    });
  }

  return { removed, moved_to, branch_deleted };
}
