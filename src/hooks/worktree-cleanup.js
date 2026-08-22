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
// Orden de operaciones (Pitfall #2 / D-08): exists probe (KODO-30) → branch read
// (ANTES de remove) → status → remove|move-to-.dirty → merge check → branch -D
// (solo clean Y mergeada) → prune oportunista.
//
// El probe de existencia bifurca a un camino propio (`cleanupAlreadyGoneWorktree`,
// KODO-30) cuando el directorio ya no está: sin árbol no hay `status` ni `remove`,
// pero la decisión sobre la RAMA sigue siendo la misma y se toma sobre la rama
// persistida en `state.json`. Ese caso NO es un error — es lo que deja el «Remove
// worktree» que Claude Code ofrece al salir, y que corre ANTES que este hook.
//
// Invariantes de seguridad (T-41-02 + KODO-21):
//   - NUNCA borrado recursivo forzado, NUNCA `unlinkSync` del worktree.
//   - `git worktree remove` SIN `--force` (git actúa de segunda barrera).
//   - DIRTY path NUNCA borra: mueve a `${worktree}.dirty` (pre-check lstatSync).
//   - `branch -D` SOLO si la rama no tiene commits propios inalcanzables desde
//     otra ref (KODO-21). Sin verificación → se conserva. El trabajo commiteado
//     de una sesión JAMÁS se pierde por cerrar la sesión.
//
// LOG-12 invariant: este módulo NO importa `logger.js`. El `logger` inyectado es
// el único canal de observabilidad; `logger-events.js` (pure transform) sí es
// importable estáticamente — vive en el carril hook, no en el no-logger.

import { lstatSync, renameSync } from 'node:fs';
import {
  worktreeCleanupOk,
  worktreeCleanupDirty,
  worktreeCleanupError,
  worktreeBranchKept,
} from '../logger-events.js';

/**
 * Cuenta los commits de `branch` que NO son alcanzables desde ninguna OTRA
 * referencia local o remota (KODO-21).
 *
 * `git rev-list --count <branch> --not --exclude=<branch> --branches --remotes`
 *
 * Elegido sobre `merge-base --is-ancestor <branch> main` a propósito: no hay que
 * adivinar cómo se llama la rama principal (main/master/develop/deikka-*), el
 * criterio cubre repos con varios remotos, y devuelve el CONTEO exacto que la
 * traza para el operador necesita. `--exclude` aquí exige el nombre CORTO de la
 * rama, no `refs/heads/<branch>` — con la forma larga el filtro no aplica y todo
 * sale 0 (verificado empíricamente contra git 2.51).
 *
 * @param {{
 *   project: string,
 *   branch: string,
 *   gitFn: (cwd: string, args: string[]) => Promise<string> | string,
 * }} args
 * @returns {Promise<{ count: number | null, reason: string | null }>}
 *   `count: 0` ⇒ todo el trabajo está en otra ref, la rama es desechable.
 *   `count > 0` ⇒ hay trabajo que solo vive aquí.
 *   `count: null` ⇒ no verificable (git falló o devolvió basura) → el caller
 *   DEBE conservar la rama: ante la duda nunca se borra.
 *
 * EXPORTADA desde KODO-26: la cola de integración hace EXACTAMENTE la misma pregunta
 * («¿queda trabajo que solo vive en esta rama?») en el mismo instante del ciclo de vida, así
 * que la reusa en vez de reimplementarla. El cálculo tiene un único dueño y ninguna deriva
 * posible entre «la rama se conserva» y «la rama entra en la cola» — son el mismo veredicto.
 */
export async function countUnmergedCommits({ project, branch, gitFn }) {
  try {
    const out = await gitFn(project, [
      'rev-list', '--count', branch,
      '--not', `--exclude=${branch}`, '--branches', '--remotes',
    ]);
    const n = Number.parseInt(String(out ?? '').trim(), 10);
    if (!Number.isFinite(n) || n < 0) {
      return { count: null, reason: `rev-list devolvió una salida no numérica: ${JSON.stringify(String(out ?? '').slice(0, 80))}` };
    }
    return { count: n, reason: null };
  } catch (err) {
    return { count: null, reason: /** @type {Error} */ (err).message };
  }
}

/**
 * ¿Hay ALGO en esta ruta? (KODO-30). Default de `existsFn` para `cleanupWorktree`.
 *
 * `lstatSync` y no `existsSync` por el mismo motivo que el pre-check del target `.dirty`
 * (Phase 19 CR-03): `existsSync` SIGUE symlinks, así que un symlink colgante en la ruta
 * del worktree se leería como «no existe» y mandaría al camino `already_gone` — que decide
 * sobre una rama. `lstatSync` mira el enlace en sí: cualquier entrada de directorio, viva o
 * colgante, cuenta como presente y sigue por el camino normal, donde git es quien manda.
 *
 * @param {string} path
 * @returns {boolean}
 */
function pathPresent(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * ¿Existe la rama localmente? Never-throws → `false` (KODO-30).
 *
 * `--verify --quiet refs/heads/<branch>`: la forma larga y explícita, para no confundir una
 * rama con un tag o un remoto del mismo nombre. Bajo el seam `gitFn` un exit distinto de 0
 * llega como excepción, así que «no existe» y «git falló» colapsan en `false` — y ambos
 * llevan al mismo sitio: no se toca la rama.
 *
 * @param {{ project: string, branch: string, gitFn: (cwd: string, args: string[]) => Promise<string> | string }} args
 * @returns {Promise<boolean>}
 */
async function branchExists({ project, branch, gitFn }) {
  try {
    const out = await gitFn(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return String(out ?? '').trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Decide sobre la RAMA de una sesión cuyo worktree ya no está en disco (KODO-30).
 *
 * Camino explícito, no un fallback silencioso. QUIÉN borra el worktree (observado en el
 * cierre de KODO-29): al salir de una sesión `--worktree`, Claude Code ofrece «Keep
 * worktree / Remove worktree»; con Remove borra el directorio Y la rama `worktree-<sid>`
 * ANTES de que corra `SessionEnd`. Si la sesión renombró su rama —`feat/…`, que es lo que
 * hace cualquier sesión de kodo— esa NO se borra: sobrevive, y es justo la que quedaba
 * huérfana en el repo.
 *
 * Antes de KODO-30 ese estado llegaba al `status --porcelain` del camino normal, fallaba
 * con «cannot change to '<wt>': No such file or directory» y dejaba `isDirty = null` → ni
 * `worktree remove` ni `branch -D`: un `worktree.cleanup.error` en CADA cierre así, y la
 * rama `feat/…` ya mergeada sin podar.
 *
 * Sin directorio no hay `status` que leer ni `worktree remove` que hacer — pero SÍ queda
 * la decisión que de verdad importa (¿se borra la rama?), y esa no necesita el
 * directorio: `countUnmergedCommits` solo pide `project` + `branch`. De ahí que la rama
 * llegue PERSISTIDA desde `state.json` (`session.branch`, sellada por el hook Stop
 * mientras el worktree aún vivía) en vez de leerse de un `git -C <wt>` que ya no responde.
 *
 * De ahí el `rev-parse --verify` previo al gate: si la rama persistida es la que Claude
 * Code YA borró (`worktree-<sid>`, sesión que nunca renombró — el caso más común, porque
 * kodo lanza con `claude --worktree <sessionId>`), no hay nada que decidir. Sin esa
 * comprobación, `countUnmergedCommits` fallaría sobre una ref inexistente, devolvería
 * `count: null` y el fail-safe emitiría un `branch.kept` en CADA cierre — cambiar un error
 * espurio por un warn espurio no es arreglar nada.
 *
 * Orden LOAD-BEARING: `prune` va ANTES del `branch -D`. Si git todavía tiene registrado
 * el worktree ausente, considera la rama «checked out» por él y rechaza el borrado; el
 * prune desregistra la metadata huérfana y desbloquea la decisión.
 *
 * Gate KODO-21 INTACTO: la rama solo se borra con `count === 0`. Sin rama persistida no
 * se borra nada — no se adivina.
 *
 * @param {{
 *   project: string,
 *   worktree: string,
 *   sessionId: string,
 *   branch: string | null,
 *   gitFn: (cwd: string, args: string[]) => Promise<string> | string,
 *   logger: import('../logger-events.js').Logger,
 * }} args
 * @returns {Promise<{ removed: boolean, moved_to: null, branch_deleted: boolean, already_gone: true }>}
 */
async function cleanupAlreadyGoneWorktree({ project, worktree, sessionId, branch, gitFn, logger }) {
  let branch_deleted = false;

  // 1. Prune PRIMERO (ver docblock): desregistra el worktree ausente para que la rama
  // deje de constar como checked-out. Fail-open con la misma traza que el camino normal.
  try {
    await gitFn(project, ['worktree', 'prune']);
  } catch (err) {
    worktreeCleanupError(logger, {
      session_id: sessionId,
      worktree_path: worktree,
      phase: 'prune',
      reason: /** @type {Error} */ (err).message,
    });
  }

  // 2. Decisión sobre la rama — MISMO gate que el camino clean (KODO-21).
  if (branch && !(await branchExists({ project, branch, gitFn }))) {
    // La rama persistida ya no está: Claude Code borra `worktree-<sid>` junto con el
    // directorio. No hay nada que podar ni que conservar.
    console.error(`[kodo:worktree-cleanup] already_gone — ${sessionId}: la rama ${branch} ya no existe; nada que podar`);
  } else if (branch) {
    const { count, reason } = await countUnmergedCommits({ project, branch, gitFn });
    if (count === 0) {
      try {
        await gitFn(project, ['branch', '-D', branch]);
        branch_deleted = true;
      } catch (err) {
        console.error(`[kodo:worktree-cleanup] branch -D ${branch} failed: ${/** @type {Error} */ (err).message}`);
      }
    } else {
      console.error(
        count === null
          ? `[kodo] branch_kept_unmerged — ${branch}: no se pudo verificar el merge (${reason}); rama conservada`
          : `[kodo] branch_kept_unmerged — ${branch}: ${count} commits fuera de main`,
      );
      worktreeBranchKept(logger, {
        session_id: sessionId,
        worktree_path: worktree,
        branch,
        unmerged_commits: count,
        reason,
      });
    }
  } else {
    // Sin rama persistida (sesión legacy, o Stop nunca corrió) el directorio ausente ya
    // no permite averiguarla. Se cierra igual, con traza greppable: la rama sobrevive,
    // que es el lado seguro del fail-safe.
    console.error(
      `[kodo:worktree-cleanup] already_gone sin rama persistida — ${sessionId}: ${worktree} no existe y la sesión no trae branch; no se toca ninguna rama`,
    );
  }

  worktreeCleanupOk(logger, {
    session_id: sessionId,
    worktree_path: worktree,
    branch_deleted,
    already_gone: true,
  });

  return { removed: false, moved_to: null, branch_deleted, already_gone: true };
}

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
 *   branch?: string | null,
 *   existsFn?: (path: string) => boolean,
 * }} args
 *   `branch` (KODO-30): la rama PERSISTIDA en `state.json` por el hook Stop. Solo se usa
 *   cuando el worktree no puede contestar — o porque el directorio ya no existe, o porque
 *   `branch --show-current` lanzó. Con el worktree vivo manda siempre lo que dice git.
 *   `existsFn`: seam de DI para el probe de existencia (default `pathPresent`, lstat-based).
 *   El hook `SessionEnd` inyecta el MISMO probe que usó `resolveEffectiveWorktree`, para que
 *   «cuál es el worktree» y «sigue ahí» no puedan responderse con criterios distintos.
 * @returns {Promise<{ removed: boolean, moved_to: string | null, branch_deleted: boolean, already_gone: boolean }>}
 *   Resultado estructurado por-item para que doctor (Plan 02) reporte la acción
 *   exacta (D-08): `removed` (clean path OK), `moved_to` (dirty path target),
 *   `branch_deleted` (se borró el branch) y `already_gone` (KODO-30: no había nada
 *   que remover, solo se decidió sobre la rama).
 */
export async function cleanupWorktree({ project, worktree, sessionId, gitFn, logger, branch = null, existsFn = pathPresent }) {
  const wt = worktree;
  const cleanupLog = logger;

  let removed = false;
  let moved_to = null;
  let branch_deleted = false;

  // 0. ¿Sigue el worktree en disco? (KODO-30). Un probe que LANZA (EACCES, ENOTDIR, FUSE
  // caído) NO se interpreta como ausencia: se asume presente y se sigue por el camino
  // normal, que ya es fail-open. Ante la duda nunca se toma el atajo que decide sobre una
  // rama sin poder mirar el árbol — simetría con el fail-safe de KODO-21.
  let worktreeExists = true;
  try {
    worktreeExists = Boolean(existsFn(wt));
  } catch (probeErr) {
    console.error(`[kodo:worktree-cleanup] exists probe failed on ${wt}: ${/** @type {Error} */ (probeErr).message}`);
  }
  if (!worktreeExists) {
    return await cleanupAlreadyGoneWorktree({ project, worktree: wt, sessionId, branch, gitFn, logger: cleanupLog });
  }

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
    // KODO-30: la lectura LANZÓ (no devolvió vacío) — el worktree existe pero git no
    // contesta sobre él. La rama persistida es entonces el mejor dato disponible. Un
    // `--show-current` vacío es OTRA cosa (detached HEAD deliberado) y NO cae aquí: ahí
    // se respeta el silencio de git y no se toca rama alguna.
    branchName = branch || null;
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
        // KODO-21: `branch -D` NUNCA es incondicional. Si la rama todavía tiene
        // commits inalcanzables desde cualquier otra ref, borrarla deja el
        // trabajo como objetos huérfanos a merced del siguiente gc — pérdida
        // silenciosa y sin traza. Se conserva y se emite traza greppable; la
        // poda queda para quien SÍ verifica el merge (skill worktree-cleanup).
        const { count, reason } = await countUnmergedCommits({ project, branch: branchName, gitFn });
        if (count === 0) {
          try {
            await gitFn(project, ['branch', '-D', branchName]);
            branch_deleted = true;
          } catch (err) {
            // Pitfall #3: branch checked-out by another worktree, race, etc.
            // → warn fail-open. NO emit cleanup.error{phase:branch} — el test
            // contractual exige cleanup.ok con branch_deleted=false.
            console.error(`[kodo:worktree-cleanup] branch -D ${branchName} failed: ${/** @type {Error} */ (err).message}`);
          }
        } else {
          // count > 0 (trabajo sin mergear) o count === null (no verificable).
          // Ambos caminos CONSERVAN la rama — fail-safe.
          console.error(
            count === null
              ? `[kodo] branch_kept_unmerged — ${branchName}: no se pudo verificar el merge (${reason}); rama conservada`
              : `[kodo] branch_kept_unmerged — ${branchName}: ${count} commits fuera de main`,
          );
          worktreeBranchKept(cleanupLog, {
            session_id: sessionId,
            worktree_path: wt,
            branch: branchName,
            unmerged_commits: count,
            reason,
          });
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

  return { removed, moved_to, branch_deleted, already_gone: false };
}
