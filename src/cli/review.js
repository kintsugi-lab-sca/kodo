// @ts-check
//
// src/cli/review.js — KODO-75: handlers de `kodo review` (estado + arranque + cierre).
//
// TRES carriles, un comando:
//   `kodo review [--all] [--json]`      → LISTA los ciclos de revisión vivos. Nunca falla.
//   `kodo review start <ref>`           → provisiona el worktree y lanza la sesión de revisión.
//   `kodo review commit [-m <msg>]`     → lo ejecuta EL REVIEWER para cerrar: commit con
//                                          pathspec restringido a `review/`.
//
// Invariante de retorno (precedente `inbox.js` / `integrate.js`): estos handlers NUNCA
// invocan el helper de salida del runtime — RETORNAN el código. El `exit` lo hace el
// registro de commander en `src/cli.js`.
//
// Invariante de color isolation (Phase 14 D-07): este fichero NUNCA importa el paquete de
// color directamente — solo `createFormatter`.
//
// LO QUE ESTE COMANDO NO HACE, POR CONTRATO:
//   - `commit` NUNCA commitea fuera de `review/`. No es una promesa del handler: el pathspec
//     va en `add` y en `commit` dentro de `review/guard.js`, y aquí solo se REPORTA lo que
//     quedó fuera. Un reviewer que editó código lo ve por pantalla en vez de perderlo en
//     silencio.
//   - `commit` NUNCA corre fuera de una sesión de revisión: sin `KODO_REVIEWER=1` el guard
//     devuelve `not-reviewer-session` y esto sale con 2. Es el mismo gate que protege el
//     auto-commit del orquestador.
//   - NUNCA `git push`. Política anti-push-fantasma del repo; aquí tampoco hay excepción.
//   - `start` NUNCA crea una rama. Hace checkout de la que ya existe (ver `review/launch.js`).
//
// Exit codes (contrato del repo, `cli/exit-codes.js`):
//   0  la acción se ejecutó (o el listado se pintó)
//   1  falló: git, host, o el lock de state.json
//   2  uso incorrecto: ref no resoluble, o `commit` fuera de una sesión de revisión

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { findPendingIntegration } from '../integration/queue.js';
import { deriveReviewState, nextRecommendationName, resolveReviewedHead, reviewConfidence, RECOMMENDATIONS_REL } from '../review/artifacts.js';
import { commitReviewArtifacts, inspectWorkingTree } from '../review/guard.js';
import { getReviewCycle, listReviewCycles, openReviewCycle, resolveMaxRounds } from '../review/cycle.js';
import { buildReviewerCommand, buildReviewerPrompt, provisionReviewWorktree, resolveBaseBranch } from '../review/launch.js';
import { EXIT_ERROR, EXIT_SUCCESS, EXIT_USAGE } from './exit-codes.js';
import { createFormatter } from './format.js';
import { stripControlChars } from './sanitize.js';

/**
 * @typedef {{
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   loadConfigFn?: typeof loadConfig,
 *   listCyclesFn?: typeof listReviewCycles,
 *   getCycleFn?: typeof getReviewCycle,
 *   openCycleFn?: typeof openReviewCycle,
 *   findIntegrationFn?: typeof findPendingIntegration,
 *   deriveReviewStateFn?: typeof deriveReviewState,
 *   provisionFn?: typeof provisionReviewWorktree,
 *   commitFn?: typeof commitReviewArtifacts,
 *   inspectFn?: typeof inspectWorkingTree,
 *   sendFn?: (params: { workspace: string, text: string }) => Promise<void>,
 *   newWorkspaceFn?: (opts: object) => Promise<string>,
 *   randomUUIDFn?: () => string,
 *   readdirFn?: (p: string) => string[],
 *   env?: Record<string, string|undefined>,
 * }} ReviewDeps
 */

/**
 * Lista los ciclos de revisión.
 *
 * Por defecto muestra los que PIDEN algo de alguien (`pending` y `escalated`) y oculta los
 * aprobados. Los escalados salen SIN pedir `--all` a propósito: una escalada que hay que
 * pedir con un flag es una escalada que nadie ve, y el contrato del bucle es que nunca
 * termina en silencio.
 *
 * Nunca falla: una lista vacía es el estado normal de un repo sin revisiones en curso.
 *
 * @param {{ all?: boolean, json?: boolean }} opts
 * @param {ReviewDeps} [deps]
 * @returns {number}
 */
export function runReviewListCli(opts = {}, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const listFn = deps.listCyclesFn || listReviewCycles;
  const cycles = listFn({ all: opts.all === true });

  // Carril `--json` PRIMERO, antes de instanciar el formatter: el carril máquina no puede
  // llevar color ni depender del TTY (mismo criterio que `integrate`).
  if (opts.json === true) {
    write(JSON.stringify({ count: cycles.length, cycles }) + '\n');
    return EXIT_SUCCESS;
  }

  const fmt = (deps.formatterFn || createFormatter)();
  if (cycles.length === 0) {
    write(`${fmt.dim('Sin ciclos de revisión abiertos.')}\n`);
    return EXIT_SUCCESS;
  }

  for (const c of cycles) {
    const badge =
      c.status === 'escalated' ? fmt.red('ESCALADO')
      : c.status === 'approved' ? fmt.green('aprobado')
      : fmt.yellow('en curso');
    const ref = stripControlChars(String(c.task_ref ?? ''));
    write(`${badge}  ${fmt.cyan(ref)}  ronda ${c.round}/${c.max_rounds}  ${fmt.dim(String(c.branch ?? ''))}\n`);
    if (c.status === 'escalated' && c.escalation_reason) {
      write(`         ${fmt.dim(`motivo: ${c.escalation_reason}`)}\n`);
    }
  }
  return EXIT_SUCCESS;
}

/**
 * Muestra el estado de revisión DERIVADO de los artefactos de una rama.
 *
 * Es el comando que hace visible el corazón de KODO-75: lo que imprime sale de leer ficheros
 * y `git log`, nunca de preguntarle a un modelo. Si esto dice `reviewed`, el núcleo puede
 * subir la confianza de la entrada de cola sin consultar a nadie.
 *
 * @param {string} ref task_ref o nombre de rama.
 * @param {{ json?: boolean }} opts
 * @param {ReviewDeps} [deps]
 * @returns {number}
 */
export function runReviewStatusCli(ref, opts = {}, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));

  const located = locateBranch(ref, deps);
  if (!located.ok) {
    err(`No se pudo resolver "${stripControlChars(String(ref))}": ${located.detail}\n`);
    return EXIT_USAGE;
  }

  const deriveFn = deps.deriveReviewStateFn || deriveReviewState;
  const reviewState = deriveFn({ dir: located.dir });
  const confidence = reviewConfidence(reviewState);
  const cycle = (deps.getCycleFn || getReviewCycle)(located.task_id ?? '');

  if (opts.json === true) {
    write(JSON.stringify({
      task_ref: located.task_ref,
      branch: located.branch,
      project_path: located.project_path,
      review: reviewState,
      confidence,
      cycle,
    }) + '\n');
    return EXIT_SUCCESS;
  }

  const fmt = (deps.formatterFn || createFormatter)();
  write(`${fmt.cyan(stripControlChars(located.task_ref))}  ${fmt.dim(located.branch)}\n`);
  write(`  estado    ${describeReviewState(reviewState, fmt)}\n`);
  write(`  confianza ${confidence}\n`);
  if (cycle) write(`  ronda     ${cycle.round}/${cycle.max_rounds} (${cycle.status})\n`);
  return EXIT_SUCCESS;
}

/**
 * Frase legible por estado de revisión. PURA respecto del disco.
 * @param {import('../review/artifacts.js').ReviewState} rs
 * @param {import('./format.js').Formatter} fmt
 * @returns {string}
 */
export function describeReviewState(rs, fmt) {
  switch (rs?.state) {
    case 'approved':
      return `${fmt.green('aprobado')} — approval.md ancla en ${String(rs.commit).slice(0, 8)}`;
    case 'stale-approval':
      return `${fmt.yellow('aprobación caducada')} — aprobó ${String(rs.commit).slice(0, 8)}, el código va por ${String(rs.reviewed_head).slice(0, 8)}`;
    case 'changes-requested':
      return `${fmt.yellow('cambios pedidos')} — ronda ${rs.round}`;
    case 'malformed':
      return `${fmt.red('artefacto ilegible')} — ${rs.detail}`;
    default:
      return fmt.dim('sin revisar');
  }
}

/**
 * Arranca la sesión de revisión sobre la rama de una tarea ya cerrada.
 *
 * Los cuatro pasos, en orden, y por qué:
 *   1. Resolver (repo, rama) desde la cola de integración — la entrada que el cierre de la
 *      sesión de trabajo dejó ahí es exactamente «esta rama terminó y necesita algo».
 *   2. Provisionar el worktree sobre la rama EXISTENTE (nunca crear una nueva).
 *   3. Abrir/refrescar el ciclo en `state.review_cycles` ANTES de lanzar: si el spawn falla,
 *      el ciclo queda visible en vez de perderse.
 *   4. Crear el workspace del host y teclear la línea con `KODO_REVIEWER=1`.
 *
 * @param {string} ref
 * @param {{ json?: boolean, maxRounds?: number }} opts
 * @param {ReviewDeps} [deps]
 * @returns {Promise<number>}
 */
export async function runReviewStartCli(ref, opts = {}, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));

  const located = locateBranch(ref, deps);
  if (!located.ok) {
    err(`No se pudo resolver "${stripControlChars(String(ref))}": ${located.detail}\n`);
    return EXIT_USAGE;
  }

  const config = (deps.loadConfigFn || loadConfig)();
  const randomUUIDFn = deps.randomUUIDFn || (() => globalThis.crypto.randomUUID());
  const sessionId = randomUUIDFn();

  // 2. Worktree sobre la rama existente.
  const provision = (deps.provisionFn || provisionReviewWorktree)({
    projectPath: located.project_path,
    branch: located.branch,
    sessionId,
  });
  if (!provision.ok) {
    if (provision.reason === 'branch-busy') {
      err(
        `La rama ${located.branch} sigue ocupada por otro worktree — la sesión de trabajo no ha cerrado.\n` +
        `La revisión arranca DESPUÉS del trabajo, no a la vez. Reintenta cuando cierre.\n`,
      );
      return EXIT_ERROR;
    }
    err(`No se pudo provisionar el worktree de revisión: ${provision.detail ?? provision.reason}\n`);
    return EXIT_ERROR;
  }
  const dir = provision.path;

  // 3. Ciclo ANTES del spawn.
  const maxRounds = Number.isInteger(opts.maxRounds) && /** @type {number} */ (opts.maxRounds) > 0
    ? /** @type {number} */ (opts.maxRounds)
    : resolveMaxRounds(config);
  const cycleResult = (deps.openCycleFn || openReviewCycle)({
    task_id: located.task_id || located.branch,
    task_ref: located.task_ref,
    project_path: located.project_path,
    branch: located.branch,
    max_rounds: maxRounds,
  });
  if (!cycleResult.ok) {
    err(`No se pudo abrir el ciclo de revisión (${cycleResult.reason}) — se aborta antes de lanzar.\n`);
    return EXIT_ERROR;
  }
  const cycle = cycleResult.value;

  // 4. Prompt + comando + workspace.
  const reviewedHead = resolveReviewedHead(dir) ?? '';
  const readdirFn = deps.readdirFn;
  const existing = listRecommendationNames(dir, readdirFn);
  const prompt = buildReviewerPrompt({
    task_ref: located.task_ref,
    branch: located.branch,
    project_path: located.project_path,
    reviewed_head: reviewedHead,
    base_branch: resolveBaseBranch(dir),
    round: cycle.round + 1,
    max_rounds: maxRounds,
    next_recommendation: nextRecommendationName(existing),
  });
  const command = buildReviewerCommand(config, sessionId, prompt);

  try {
    const { getHost, resolveHostName } = await import('../host/interface.js');
    const host = getHost(resolveHostName());
    const newWorkspaceFn = deps.newWorkspaceFn || host._legacy.newWorkspace;
    const sendFn = deps.sendFn || host._legacy.send;
    const workspace = await newWorkspaceFn({
      name: `${located.task_ref} [review]`,
      cwd: dir,
    });
    await sendFn({ workspace, text: command });

    if (opts.json === true) {
      write(JSON.stringify({
        ok: true, task_ref: located.task_ref, branch: located.branch,
        session_id: sessionId, workspace, worktree: dir, round: cycle.round + 1, max_rounds: maxRounds,
      }) + '\n');
      return EXIT_SUCCESS;
    }
    const fmt = (deps.formatterFn || createFormatter)();
    write(`${fmt.green('Sesión de revisión lanzada')} — ${stripControlChars(located.task_ref)} ronda ${cycle.round + 1}/${maxRounds}\n`);
    write(`  rama      ${located.branch}\n`);
    write(`  worktree  ${dir}\n`);
    write(`  workspace ${workspace}\n`);
    return EXIT_SUCCESS;
  } catch (e) {
    err(`No se pudo lanzar la sesión de revisión: ${/** @type {Error} */ (e).message}\n`);
    return EXIT_ERROR;
  }
}

/**
 * Cierre del reviewer: commitea los artefactos y NADA más.
 *
 * Lo ejecuta el propio reviewer dentro de su sesión, que es la única que trae
 * `KODO_REVIEWER=1`. El valor que aporta sobre un `git commit` a pelo es doble: el pathspec
 * (que es la garantía) y el REPORTE de lo que quedó fuera — sin él, un reviewer que editó
 * código vería su cambio desaparecer sin explicación y creería haberlo arreglado.
 *
 * @param {{ message?: string, json?: boolean, dir?: string }} opts
 * @param {ReviewDeps} [deps]
 * @returns {number}
 */
export function runReviewCommitCli(opts = {}, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const dir = opts.dir || process.cwd();
  const message = opts.message || 'review: artefactos de revisión';

  const result = (deps.commitFn || commitReviewArtifacts)({ dir, message }, { env: deps.env });

  if (!result.ok) {
    if (result.reason === 'not-reviewer-session') {
      err(
        'Esto solo corre dentro de una sesión de revisión (falta el marcador KODO_REVIEWER).\n' +
        'Si querías commitear trabajo normal, usa git directamente.\n',
      );
      return EXIT_USAGE;
    }
    err(`El commit de revisión falló: ${result.detail ?? result.reason}\n`);
    return EXIT_ERROR;
  }

  if (opts.json === true) {
    write(JSON.stringify(result) + '\n');
    return EXIT_SUCCESS;
  }

  const fmt = (deps.formatterFn || createFormatter)();
  if (result.committed) {
    write(`${fmt.green('Artefactos de revisión commiteados')}${result.sha ? ` (${result.sha.slice(0, 8)})` : ''}\n`);
  } else {
    write(`${fmt.dim('No hay artefactos nuevos que commitear bajo review/.')}\n`);
  }
  // El reporte de lo excluido va SIEMPRE, haya habido commit o no: es la mitad del valor.
  if (result.skipped.length > 0) {
    write(`\n${fmt.yellow('Fuera del área de revisión — NO commiteado:')}\n`);
    for (const p of result.skipped) write(`  ${p}\n`);
    write(`${fmt.dim('El reviewer no arregla: lo que ibas a cambiar ahí, escríbelo como item en ')}${fmt.dim(RECOMMENDATIONS_REL)}${fmt.dim('.')}\n`);
  }
  return EXIT_SUCCESS;
}

/**
 * Resuelve (repo, rama, task) a partir de una ref. NEVER-THROWS.
 *
 * Fuente principal: la cola de integración. Es la que sabe, para una rama que acaba de cerrar
 * su sesión, en qué repo vive — y es un dato que sobrevive al cierre, a diferencia de
 * `state.sessions`, que ya no tiene la fila cuando el reviewer va a arrancar (es justo la
 * consecuencia de que la topología sea secuencial).
 *
 * @param {string} ref
 * @param {ReviewDeps} deps
 * @returns {{ ok: true, task_ref: string, task_id: string|null, project_path: string, branch: string, dir: string }
 *          | { ok: false, detail: string }}
 */
function locateBranch(ref, deps) {
  if (typeof ref !== 'string' || ref === '') return { ok: false, detail: 'falta la referencia' };
  const findFn = deps.findIntegrationFn || findPendingIntegration;
  let entry = null;
  try {
    entry = findFn(ref);
  } catch {
    entry = null;
  }
  if (!entry) {
    return {
      ok: false,
      detail: 'no está en la cola de integración (¿ha cerrado ya la sesión de trabajo?)',
    };
  }
  // `dir` = el propio repo, no el worktree de revisión. Los artefactos se leen de donde los
  // dejó el COMMIT del reviewer, y ese commit vive en la rama: cualquier checkout de esa rama
  // los tiene. Apuntar al worktree de revisión ataría la lectura a un directorio efímero que
  // `removeReviewWorktree` puede haber retirado ya.
  return {
    ok: true,
    task_ref: entry.task_ref,
    task_id: entry.task_id ?? null,
    project_path: entry.project_path,
    branch: entry.branch,
    dir: entry.project_path,
  };
}

/**
 * Nombres de los ficheros de recomendaciones ya presentes. NEVER-THROWS: un directorio que
 * todavía no existe es el estado normal de la ronda 1, no un error.
 *
 * @param {string} dir
 * @param {((p: string) => string[])} [readdirFn]
 * @returns {string[]}
 */
function listRecommendationNames(dir, readdirFn) {
  try {
    const fn = readdirFn || ((p) => readdirSync(p));
    return fn(join(dir, RECOMMENDATIONS_REL));
  } catch {
    return [];
  }
}
