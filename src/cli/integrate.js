// @ts-check
//
// src/cli/integrate.js — KODO-26: handlers de `kodo integrate` (listado + ejecución).
//
// DOS carriles, un comando:
//   `kodo integrate [--all] [--json]`                 → LISTA la cola. Nunca falla (exit 0).
//   `kodo integrate <ref> --ff|--merge|--pr|--drop`   → EJECUTA una acción sobre una entrada.
//
// Invariante de retorno (D-07 del repo, precedente `inbox.js:24`): estos handlers NUNCA
// invocan el helper de salida del runtime — RETORNAN el código. El registro de commander en
// `src/cli.js` es quien hace el exit.
//
// Invariante de color isolation (Phase 14 D-07): este fichero NUNCA importa el paquete de
// color directamente — solo `createFormatter`.
//
// LO QUE ESTE COMANDO NO HACE, POR CONTRATO:
//   - NUNCA `git push`. NUNCA `gh pr create`. `--pr` PREPARA: valida que la rama existe, marca
//     la entrada e IMPRIME el comando listo para que lo ejecute el operador. La política
//     anti-push-fantasma del repo dice que kodo no publica solo, y aquí no hay excepción.
//   - NUNCA cambia de rama. Si la base no está checkouteada, el comando ABORTA con un mensaje
//     accionable en vez de hacer `switch` por su cuenta: el checkout del operador es suyo.
//   - NUNCA borra la rama tras integrar. Eso es del carril de cleanup (KODO-21), que ya sabe
//     verificar; borrarla aquí sería una segunda fuente de verdad sobre lo mismo.
//   - NUNCA borra la entrada de la cola. La resuelve (`done`/`dropped`) y la deja como traza.
//
// Exit codes:
//   0  la acción se ejecutó (o el listado se pintó)
//   1  la acción falló: precondición no cumplida, git falló, o el lock de state.json expiró
//   2  uso incorrecto: ninguna acción o más de una, o la ref no está pendiente en la cola

import { findPendingIntegration, listIntegrationQueue, resolveIntegration } from '../integration/queue.js';
import { integrateAction } from '../logger-events.js';
import { createFormatter } from './format.js';
import { stripControlChars } from './sanitize.js';

/** Acciones válidas, en el orden en que se listan en la ayuda. */
const ACTIONS = /** @type {const} */ (['ff', 'merge', 'pr', 'drop']);

/**
 * `gitFn` de producción del carril CLI: devuelve stdout trimeado y LANZA si el exit code no es
 * 0. Los argumentos van SIEMPRE como array a `execFileSync` — nunca hay un shell de por medio,
 * así que un nombre de rama con metacaracteres no puede ejecutar nada.
 *
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function defaultGit(cwd, args) {
  const { execFileSync } = await import('node:child_process');
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();
}

/**
 * Edad legible de una entrada: `3m`, `5h`, `2d`. Pura.
 *
 * Es LA columna que motiva la cola: una rama que lleva cuatro días esperando no se distingue de
 * una de hace diez minutos si solo se ve la sugerencia.
 *
 * @param {string} iso
 * @param {Date} now
 * @returns {string} `?` si la fecha no parsea.
 */
export function formatAge(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '?';
  const mins = Math.max(0, Math.floor((now.getTime() - t) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * @typedef {{
 *   listFn?: typeof listIntegrationQueue,
 *   findFn?: typeof findPendingIntegration,
 *   resolveFn?: typeof resolveIntegration,
 *   gitFn?: (cwd: string, args: string[]) => Promise<string>|string,
 *   runTestsFn?: (cmd: string, cwd: string) => Promise<{ ok: boolean, detail: string }>|{ ok: boolean, detail: string },
 *   loggerFn?: () => any,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   nowFn?: () => Date,
 * }} IntegrateDeps
 */

/**
 * Lista la cola de integración.
 *
 * CERO llamadas a git: todo sale de `state.json`, que ya trae el conteo, la base y la sugerencia
 * calculados en el cierre de la sesión. Es el requisito del orquestador — puede presentar la
 * cola entera en cada ronda sin pagar un solo `git` por entrada.
 *
 * @param {{ all?: boolean, json?: boolean }} opts
 * @param {IntegrateDeps} [deps]
 * @returns {number} SIEMPRE 0 — un listado nunca es una condición de error.
 */
export function runIntegrateListCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const listFn = deps.listFn || listIntegrationQueue;
  const now = (deps.nowFn || (() => new Date()))();

  try {
    const entries = listFn({ all: opts.all === true });

    // Rama `--json` PRIMERO, antes de instanciar el formatter: el carril máquina no puede
    // contaminarse con ANSI por construcción, no solo por convención (DX-06). Las entradas se
    // serializan tal cual salen del store — sus 17 claves ya están en orden fijo.
    if (opts.json === true) {
      const pending = entries.filter((e) => e.status === 'pending').length;
      write(JSON.stringify({ pending, entries }) + '\n');
      return 0;
    }

    const fmt = deps.formatterFn ? deps.formatterFn() : createFormatter(process.stdout);
    if (entries.length === 0) {
      write(`${fmt.dim('cola de integración vacía')}\n`);
      return 0;
    }
    // `task_ref` y `branch` vienen del provider y de git: contenido externo que se proyecta a un
    // terminal, así que pasa por `stripControlChars` (invariante HYG-07 del repo).
    const rows = entries.map((e) => [
      stripControlChars(e.task_ref),
      stripControlChars(e.branch),
      e.commits_ahead === null ? '?' : String(e.commits_ahead),
      e.base_ok === true ? 'sí' : e.base_ok === false ? 'NO' : '?',
      e.suggested,
      formatAge(e.created_at, now),
      e.status === 'pending' ? '' : `${e.status}${e.action ? `/${e.action}` : ''}`,
    ]);
    write(
      fmt.formatTable(rows, { header: ['ref', 'rama', 'commits', 'base', 'sugerido', 'edad', 'estado'] }) + '\n',
    );
    return 0;
  } catch (e) {
    // Cinturón de seguridad: ni un fallo del render convierte un listado en un exit distinto de 0.
    err(`[kodo:integrate] no se pudo renderizar la cola: ${/** @type {Error} */ (e).message}\n`);
    return 0;
  }
}

/**
 * Ejecuta UNA acción sobre UNA entrada pendiente de la cola.
 *
 * @param {string} ref task_ref (o nombre de rama) de la entrada.
 * @param {{ ff?: boolean, merge?: boolean, pr?: boolean, drop?: boolean, json?: boolean, test?: string }} opts
 * @param {IntegrateDeps} [deps]
 * @returns {Promise<number>} exit code (0 ok · 1 fallo de ejecución · 2 uso incorrecto).
 */
export async function runIntegrateActionCli(ref, opts, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const findFn = deps.findFn || findPendingIntegration;
  const resolveFn = deps.resolveFn || resolveIntegration;
  const git = deps.gitFn || defaultGit;
  const fmt = deps.formatterFn ? deps.formatterFn() : createFormatter(process.stdout);

  const chosen = ACTIONS.filter((a) => opts[a] === true);
  if (chosen.length !== 1) {
    err('[kodo:integrate] elige EXACTAMENTE una acción: --ff | --merge | --pr | --drop\n');
    return 2;
  }
  const action = chosen[0];

  const entry = findFn(ref);
  if (!entry) {
    err(`[kodo:integrate] no hay ninguna entrada PENDIENTE para '${stripControlChars(ref)}' (mira \`kodo integrate\`)\n`);
    return 2;
  }

  // El logger se construye ANTES de tocar git para que TODA salida —incluidos los fallos de
  // precondición, que ni llegan a ejecutar nada— deje su línea en el NDJSON.
  const logger = await makeLogger(deps);

  /**
   * Cierra la acción: resuelve la entrada (solo en éxito), emite el evento, pinta y devuelve el
   * código. Un fallo NO resuelve la entrada: sigue pendiente, que es la verdad.
   *
   * @param {{ ok: boolean, outcome: string, sha?: string|null, message: string }} r
   * @returns {number}
   */
  const finish = (r) => {
    const sha = r.sha ?? null;
    let outcome = r.outcome;
    let ok = r.ok;

    if (ok) {
      const res = resolveFn(
        ref,
        { action, status: action === 'drop' ? 'dropped' : 'done', sha, outcome },
        logger,
      );
      if (!res.ok) {
        // La acción SÍ ocurrió (el merge está hecho) pero la traza en state.json no. Se degrada
        // a fallo con un outcome propio: devolver 0 dejaría la entrada pendiente para siempre y
        // el operador la re-ejecutaría sobre un merge ya aplicado.
        ok = false;
        outcome = `state-${res.reason}`;
        err(`[kodo:integrate] la acción se ejecutó pero la cola no se pudo actualizar (${res.reason})\n`);
      }
    }

    emit(logger, { action, task_ref: entry.task_ref, branch: entry.branch, sha, outcome, ok });
    // El fallo de la cola sobre una acción que SÍ salió bien ya avisó por stderr arriba; no se
    // vuelve a pintar el mensaje de éxito, que sería mentira.
    if (ok) write(`${fmt.ok(r.message)}\n`);
    else if (!r.ok) err(`${fmt.fail(r.message)}\n`);

    if (opts.json === true) {
      write(JSON.stringify({ ok, action, task_ref: entry.task_ref, branch: entry.branch, sha, outcome }) + '\n');
    }
    return ok ? 0 : 1;
  };

  // ── --drop: NO toca la rama, NO toca git. Solo transiciona la entrada. ────────────────
  if (action === 'drop') {
    return finish({
      ok: true,
      outcome: 'dropped',
      message: `${entry.task_ref}: descartada de la cola (la rama ${entry.branch} sigue intacta)`,
    });
  }

  const project = entry.project_path;

  // ── Precondición común: el repo destino tiene que estar limpio. ──────────────────────
  // Un merge sobre un worktree sucio mezcla el trabajo del operador con el de la rama y deja un
  // estado que nadie sabe deshacer. Se comprueba ANTES de cualquier mutación.
  let status;
  try {
    status = await git(project, ['status', '--porcelain']);
  } catch (e) {
    return finish({ ok: false, outcome: 'git-error', message: `no se pudo leer el estado de ${project}: ${/** @type {Error} */ (e).message}` });
  }
  if (String(status).trim().length > 0) {
    return finish({ ok: false, outcome: 'worktree-dirty', message: `${project} tiene cambios sin commitear — intégralo tú o limpia el worktree` });
  }

  // ── --pr: prepara y DEVUELVE el comando. Cero red, cero push. ────────────────────────
  if (action === 'pr') {
    let exists = '';
    try {
      exists = String(await git(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${entry.branch}`]));
    } catch {
      exists = '';
    }
    if (!exists.trim()) {
      return finish({ ok: false, outcome: 'branch-missing', message: `la rama ${entry.branch} ya no existe en ${project}` });
    }
    const base = entry.base_branch || 'main';
    write(
      `${fmt.dim('ejecuta tú (kodo no hace push ni crea PRs):')}\n` +
        `  cd ${project} && git push -u origin ${entry.branch} && gh pr create --base ${base} --head ${entry.branch} --fill\n`,
    );
    return finish({ ok: true, outcome: 'prepared', message: `${entry.task_ref}: rama lista para PR (${entry.branch} → ${base})` });
  }

  // ── --ff / --merge: la base tiene que estar checkouteada. ────────────────────────────
  if (!entry.base_branch) {
    return finish({ ok: false, outcome: 'base-unknown', message: `no se resolvió la rama base de ${project} — intégralo a mano` });
  }
  let current;
  try {
    current = String(await git(project, ['branch', '--show-current'])).trim();
  } catch (e) {
    return finish({ ok: false, outcome: 'git-error', message: `no se pudo leer la rama actual de ${project}: ${/** @type {Error} */ (e).message}` });
  }
  if (current !== entry.base_branch) {
    // kodo NO hace `switch` por su cuenta: el checkout del operador es suyo, y cambiarlo por
    // debajo es justo el tipo de sorpresa que un comando de integración no puede permitirse.
    return finish({
      ok: false,
      outcome: 'base-not-checked-out',
      message: `${project} está en '${current}', no en '${entry.base_branch}' — cambia de rama y repite`,
    });
  }

  // ── Suite opcional (`--test '<cmd>'`). Solo corre si el operador la pide. ────────────
  if (opts.test) {
    const runTests = deps.runTestsFn || defaultRunTests;
    const t = await runTests(opts.test, project);
    if (!t.ok) {
      return finish({ ok: false, outcome: 'tests-failed', message: `la suite falló, no se integra nada: ${t.detail}` });
    }
  }

  const mergeArgs =
    action === 'ff'
      ? ['merge', '--ff-only', entry.branch]
      : ['merge', '--no-ff', '-m', `Merge branch '${entry.branch}' (${entry.task_ref})`, entry.branch];
  try {
    await git(project, mergeArgs);
  } catch (e) {
    return finish({
      ok: false,
      outcome: action === 'ff' ? 'ff-failed' : 'merge-failed',
      message: `git ${action === 'ff' ? 'merge --ff-only' : 'merge --no-ff'} falló: ${/** @type {Error} */ (e).message}`,
    });
  }

  let sha = null;
  try {
    sha = String(await git(project, ['rev-parse', 'HEAD'])).trim() || null;
  } catch {
    sha = null; // el merge ya está hecho; no saber el sha no lo deshace.
  }

  return finish({
    ok: true,
    outcome: action === 'ff' ? 'fast-forwarded' : 'merged',
    sha,
    message: `${entry.task_ref}: ${entry.branch} → ${entry.base_branch} (${action === 'ff' ? 'fast-forward' : 'merge'}${sha ? ` ${sha.slice(0, 8)}` : ''})`,
  });
}

/**
 * Ejecuta la suite que el operador pasó en `--test`. El comando es SUYO (lo teclea él en su
 * terminal, igual que lo ejecutaría a mano), así que se lanza tal cual por `sh -c`: no hay nada
 * que sanear que él no haya escrito. No se ejecuta jamás nada derivado de la cola.
 *
 * @param {string} cmd
 * @param {string} cwd
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
async function defaultRunTests(cmd, cwd) {
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('/bin/sh', ['-c', cmd], { cwd, encoding: 'utf-8', stdio: 'pipe' });
    return { ok: true, detail: '' };
  } catch (e) {
    return { ok: false, detail: String(/** @type {Error} */ (e).message).split('\n')[0] };
  }
}

/**
 * Logger del carril: `~/.kodo/logs/integrate.ndjson`.
 *
 * NEVER-THROWS: si `logger.js` no carga o `createLogger` lanza (HOME de solo lectura, por
 * ejemplo) devuelve un logger MUDO y la acción sigue su curso. El registro es auditoría, no una
 * precondición — perder la línea nunca puede impedir el merge (fail-open del enunciado).
 *
 * @param {IntegrateDeps} deps
 * @returns {Promise<any>}
 */
async function makeLogger(deps) {
  if (deps.loggerFn) return deps.loggerFn();
  /** @type {any} */
  const mute = { info() {}, warn() {}, error() {}, debug() {}, child() { return mute; } };
  try {
    const { createLogger } = await import('../logger.js');
    return createLogger({
      sessionId: 'integrate',
      minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
    }).child({ component: 'integrate' });
  } catch {
    return mute;
  }
}

/**
 * Emite el evento NDJSON de la acción. Fail-open: un sink roto NUNCA rompe la acción.
 *
 * @param {any} logger
 * @param {{ action: 'ff'|'merge'|'pr'|'drop', task_ref: string, branch: string|null, sha: string|null, outcome: string, ok: boolean }} fields
 */
function emit(logger, fields) {
  try {
    integrateAction(logger, fields);
  } catch {
    /* fail-open: el registro es auditoría, no una precondición de la acción */
  }
}
