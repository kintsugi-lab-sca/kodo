// @ts-check
//
// src/integration/capture.js — KODO-26: la captura al cerrar la sesión.
//
// Corre desde el hook SessionEnd, ANTES del cleanup terminal destructivo: el nombre de la rama
// se lee del worktree, y `performTerminalCleanup` lo remueve un instante después. Si esto
// corriera detrás, la pregunta que la cola persiste ya no tendría dónde leerse.
//
// FAIL-OPEN DE CUERPO ENTERO (invariante del enunciado): si la captura falla —git no responde,
// el lock de state.json expira, el repo está en un estado raro— la sesión cierra IGUAL. La cola
// es conveniencia: la rama ya sobrevive al cleanup por KODO-21, así que el trabajo nunca se
// pierde por un fallo de aquí. Ninguna ruta de este módulo lanza.
//
// REUSO, NO REIMPLEMENTACIÓN: el gate «¿queda trabajo sin integrar?» es `countUnmergedCommits`
// de `hooks/worktree-cleanup.js` (KODO-21) — la MISMA función que decide si la rama se conserva.
// Un segundo cálculo aquí podría discrepar del primero, y entonces habría ramas conservadas que
// no aparecen en la cola (o al revés), que es exactamente el fallo que esta fase evita.
//
// Todo el I/O de git entra por el `gitFn` inyectado (mismo seam que `cleanupWorktree`), así que
// los tests no necesitan un repo real.

import { countUnmergedCommits } from '../hooks/worktree-cleanup.js';
import { clearAuditGate, readAuditGate } from './audit.js';
import { suggestTier } from './suggest.js';
import { enqueueIntegration } from './queue.js';

/**
 * Candidatas a rama base, en orden de preferencia, cuando `origin/HEAD` no está resuelto
 * localmente (`git remote set-head` nunca corrido, clon sin remoto, repo local puro).
 * CONSTANTE de módulo — kodo no adivina más allá de estas dos.
 */
const BASE_FALLBACKS = ['main', 'master'];

/**
 * Resuelve la rama base del repo. Tres intentos en cascada, todos fail-open:
 *   1. `symbolic-ref --short refs/remotes/origin/HEAD` → `origin/main` → `main`.
 *   2. `main`, luego `master`, verificando que la ref exista (`rev-parse --verify`).
 *   3. `null` — no se pudo resolver. El caller degrada `base_ok` a `null` y la sugerencia a
 *      'review'/'merge', jamás a 'ff'.
 *
 * Por qué NO se hereda de KODO-21: ese carril evitó a propósito adivinar el nombre de la rama
 * principal, y su criterio (¿alcanzable desde CUALQUIER otra ref?) no necesita base. La cola sí
 * la necesita —`base_ok` y el diff se miden CONTRA algo—, así que aquí la resolución existe,
 * acotada y con `null` como respuesta legítima.
 *
 * @param {{ project: string, gitFn: (cwd: string, args: string[]) => Promise<string>|string }} args
 * @returns {Promise<string|null>}
 */
async function resolveBaseBranch({ project, gitFn }) {
  try {
    const out = await gitFn(project, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    const ref = String(out ?? '').trim();
    // `origin/main` → `main`. Solo se recorta el prefijo del remoto por defecto; un
    // `upstream/main` se deja tal cual y se verifica igual más abajo.
    const short = ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref;
    if (short) {
      const local = await refExists({ project, ref: short, gitFn });
      if (local) return short;
    }
  } catch {
    // origin/HEAD sin resolver: caso NORMAL en clones sin `set-head`. Se cae al fallback.
  }
  for (const candidate of BASE_FALLBACKS) {
    if (await refExists({ project, ref: candidate, gitFn })) return candidate;
  }
  return null;
}

/**
 * ¿Existe la ref localmente? Never-throws → false.
 * @param {{ project: string, ref: string, gitFn: (cwd: string, args: string[]) => Promise<string>|string }} args
 * @returns {Promise<boolean>}
 */
async function refExists({ project, ref, gitFn }) {
  try {
    const out = await gitFn(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`]);
    return String(out ?? '').trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * ¿La rama contiene la base ENTERA? Es decir: ¿está la rama construida sobre el `main` de
 * ahora mismo, o el `main` avanzó por debajo mientras la sesión trabajaba?
 *
 * Se mide con `rev-list --count <branch>..<base>` — el número de commits que tiene la base y a
 * la rama le faltan; `0` ⇒ la base es ancestro de la rama ⇒ `base_ok`.
 *
 * Por qué esta forma y no `merge-base --is-ancestor`, que es el idiom canónico: bajo el seam
 * `gitFn` de este repo, un comando devuelve su stdout y LANZA si el exit code no es 0. Pero
 * `--is-ancestor` no escribe nada en stdout: comunica su respuesta ÚNICAMENTE por el exit code
 * (1 = «no es ancestro»). Es decir, la respuesta negativa llegaría aquí como una excepción,
 * indistinguible de un error real (ref inexistente, repo corrupto, git ausente) — y confundir
 * «la base avanzó» con «no pude comprobarlo» es justo lo que no debe pasar en el campo que
 * decide si un `ff` es aplicable. La forma con `rev-list` devuelve el MISMO hecho como DATO, en
 * stdout, y deja las excepciones para lo que de verdad es un error.
 *
 * @param {{ project: string, branch: string, base: string, gitFn: (cwd: string, args: string[]) => Promise<string>|string }} args
 * @returns {Promise<boolean|null>} `null` = no verificable (git falló o devolvió basura).
 */
async function isBaseContained({ project, branch, base, gitFn }) {
  try {
    const out = await gitFn(project, ['rev-list', '--count', `${branch}..${base}`]);
    const n = Number.parseInt(String(out ?? '').trim(), 10);
    if (!Number.isFinite(n) || n < 0) return null;
    return n === 0;
  } catch {
    return null;
  }
}

/**
 * Resumen del diff de la rama contra su base: qué ficheros toca y cuántas líneas mueve. Es el
 * único input de la heurística de tier.
 *
 * `diff --numstat <base>...<branch>` (TRES puntos) mide desde el merge-base, no desde la punta
 * de la base: así los commits que la base ganó por debajo no se cuentan como cambios de la
 * rama. Es la misma vista que verá un PR.
 *
 * Los binarios salen como `-\t-\t<path>`: el fichero SÍ cuenta, sus líneas no (se suma 0).
 *
 * @param {{ project: string, branch: string, base: string, gitFn: (cwd: string, args: string[]) => Promise<string>|string }} args
 * @returns {Promise<{ files: string[]|null, lines: number|null }>} `null` = diff no inspeccionable.
 */
async function readDiffSummary({ project, branch, base, gitFn }) {
  try {
    const out = await gitFn(project, ['diff', '--numstat', `${base}...${branch}`]);
    const files = [];
    let lines = 0;
    for (const raw of String(out ?? '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const [add, del, ...rest] = parts;
      files.push(rest.join('\t'));
      const a = Number.parseInt(add, 10);
      const d = Number.parseInt(del, 10);
      if (Number.isFinite(a)) lines += a;
      if (Number.isFinite(d)) lines += d;
    }
    return { files, lines };
  } catch {
    return { files: null, lines: null };
  }
}

/**
 * Captura la necesidad de integración de la rama de una sesión que cierra.
 *
 * Secuencia (todo fail-open, ningún paso lanza):
 *   1. Rama actual del directorio de trabajo de la sesión; si ese directorio ya no existe,
 *      la rama PERSISTIDA en `session.branch` (KODO-30). Vacía (detached HEAD) → skip.
 *   2. La rama NO puede ser la base: cerrar trabajando sobre `main` no encola nada.
 *   3. Gate KODO-21 (`countUnmergedCommits`): `0` ⇒ todo está mergeado ⇒ NO se encola. Es la
 *      mitad «una sesión que cierra mergeada no aparece» del DoD.
 *   4. Base, `base_ok` y resumen del diff.
 *   5. Sugerencia (`suggestTier`), veredicto del audit gate (KODO-74) y encolado bajo el lock
 *      de state.json.
 *   6. Retirada del reto de auditoría: su traza durable pasa a ser la entrada de la cola.
 *
 * @param {{
 *   session: { task_ref?: string, task_id?: string, project_path?: string, session_id?: string, branch?: string },
 *   worktree?: string|null,
 *   gitFn: (cwd: string, args: string[]) => Promise<string>|string,
 *   logger?: import('../logger-noop.js').NoopLogger,
 *   enqueueFn?: typeof enqueueIntegration,
 *   readAuditGateFn?: typeof readAuditGate,
 *   clearAuditGateFn?: typeof clearAuditGate,
 *   now?: () => Date,
 * }} args
 *   `worktree`: directorio donde vive el checkout de la sesión. Si no existe o no se pasa, se
 *   lee la rama del propio `project_path` (sesiones adoptadas, que trabajan en el repo
 *   principal sin worktree de kodo).
 * @returns {Promise<{ captured: boolean, reason: string, entry: import('./queue.js').IntegrationEntry|null }>}
 *   `reason` es un literal corto y greppable: 'queued' · 'no-project' · 'detached' ·
 *   'is-base' · 'merged' · 'enqueue-failed' · 'error'.
 */
export async function captureIntegration({
  session, worktree, gitFn, logger, enqueueFn, readAuditGateFn, clearAuditGateFn, now,
}) {
  const enqueue = enqueueFn || enqueueIntegration;
  const readGate = readAuditGateFn || readAuditGate;
  const clearGate = clearAuditGateFn || clearAuditGate;
  try {
    const project = session?.project_path;
    if (!project) return { captured: false, reason: 'no-project', entry: null };

    // `-C <dir>` en args, no como cwd: el gitFn de producción ya antepone `-C <project>` y git
    // compone múltiples `-C`. Mismo idiom que `cleanupWorktree` (worktree-cleanup.js:107).
    const readDir = worktree ? ['-C', worktree] : [];
    let branch = '';
    try {
      const out = await gitFn(project, [...readDir, 'branch', '--show-current']);
      branch = String(out ?? '').trim();
    } catch {
      branch = '';
    }
    // KODO-30: la lectura de arriba falla ENTERA cuando el directorio del worktree ya no
    // existe — al salir, Claude Code ofrece «Remove worktree» y lo borra ANTES de que
    // arranque el hook en el que esta captura vive. El resultado era `detached` y una rama
    // con trabajo que jamás entraba en la cola, sin más traza que un skip indistinguible de
    // un detached HEAD real.
    //
    // `session.branch` es la misma rama, sellada por el hook Stop mientras el worktree aún
    // respondía. Solo entra cuando git no dio nada: con el worktree vivo manda git, que es
    // el dato de AHORA (el agente pudo cambiar de rama en el último turno).
    if (!branch && session?.branch) {
      branch = String(session.branch).trim();
      if (branch) {
        console.error(`[kodo:integrate] rama persistida — ${branch}: el worktree ya no responde, se usa session.branch`);
      }
    }
    if (!branch) return { captured: false, reason: 'detached', entry: null };

    const base = await resolveBaseBranch({ project, gitFn });
    if (base && branch === base) return { captured: false, reason: 'is-base', entry: null };

    // Gate KODO-21 — el MISMO veredicto que decide si la rama se conserva tras el cleanup.
    // `count: null` (no verificable) NO es un skip: se encola con `commits_ahead: null` y la
    // heurística lo llevará a 'review'. Ante la duda, que lo mire un humano — la simetría del
    // fail-safe de KODO-21, que ante la duda conserva la rama.
    const { count } = await countUnmergedCommits({ project, branch, gitFn });
    if (count === 0) return { captured: false, reason: 'merged', entry: null };

    const baseOk = base ? await isBaseContained({ project, branch, base, gitFn }) : null;
    const { files, lines } = base
      ? await readDiffSummary({ project, branch, base, gitFn })
      : { files: null, lines: null };

    const suggested = suggestTier({ files, lines, baseOk });

    // KODO-74 — el veredicto del audit gate. Se LEE, jamás se calcula aquí: el reto lo abrió y
    // lo cerró `kodo audit` mientras la sesión seguía viva, que es el único momento en que hay
    // alguien a quien pedirle una segunda pasada. Para cuando este hook corre, la sesión ya
    // cerró y la pregunta ya no se puede hacer — por eso el gate NO puede vivir aquí.
    //
    // `null` (ninguna invocación) se encola tal cual: SIN AUDITAR. Es el comportamiento previo
    // exacto, y es la mitad «sin el comando, nada cambia» del enunciado.
    //
    // TRY PROPIO, y no el fail-open de cuerpo entero de abajo: el audit gate es un AÑADIDO
    // sobre una captura que ya funcionaba, así que no puede tener el poder de impedirla. Con el
    // catch de fuera, un store roto haría que la rama entera dejara de encolarse —trabajo que
    // desaparece de la cola por un fallo en una señal de conveniencia—, y eso es peor que
    // perder la señal. Aquí la peor consecuencia es un `null`: SIN AUDITAR, que es la verdad.
    let audit = null;
    try {
      audit = readGate({ project_path: project, branch });
    } catch {
      audit = null;
    }

    const r = enqueue(
      {
        task_ref: session.task_ref || branch,
        task_id: session.task_id ?? null,
        project_path: project,
        branch,
        base_branch: base,
        commits_ahead: count,
        base_ok: baseOk,
        files_changed: files ? files.length : null,
        lines_changed: files ? lines : null,
        suggested,
        audit,
      },
      logger,
      { now },
    );
    if (!r.ok) return { captured: false, reason: 'enqueue-failed', entry: null };

    // El reto se retira SOLO cuando su veredicto ya está sellado en la cola: si el encolado
    // falla, el reto sigue vivo y la siguiente captura de esa rama vuelve a encontrarlo. Nunca
    // al revés — un clear antes del enqueue perdería la auditoría por un lock que expiró.
    //
    // Try propio por la misma razón que arriba, y aquí todavía más claro: la entrada YA está en
    // la cola. Dejar que un fallo del clear salte al catch de fuera devolvería
    // `captured: false` sobre una captura que sí ocurrió, y el hook lo reportaría al revés.
    if (audit) {
      try {
        clearGate({ project_path: project, branch }, logger);
      } catch { /* el reto huérfano lo recoge el cap de GATE_CAP */ }
    }

    return { captured: true, reason: 'queued', entry: r.value.entry };
  } catch (err) {
    // Fail-open de cuerpo entero: la sesión cierra igual. Traza en stderr (el canal que el
    // resto del hook usa para sus fallos no fatales), nunca un throw.
    console.error(`[kodo:integrate] captura fail-open: ${/** @type {Error} */ (err).message}`);
    return { captured: false, reason: 'error', entry: null };
  }
}
