// @ts-check
//
// src/cli/oracle.js — KODO-69: handlers de `kodo oracle` (listado + detalle + corrida).
//
// TRES carriles, un comando — misma forma que `kodo review`, y por la misma razón: el operador
// LISTA, el operador MIRA una entrada, y alguien (el hook de cierre, o el operador) EJECUTA.
// Ninguna de las tres es la variante de otra.
//
//   `kodo oracle [--all] [--json]`   → el veredicto de cada entrada pendiente. Nunca falla.
//   `kodo oracle <ref> [--json]`     → los cinco checks de UNA entrada, con su detalle.
//   `kodo oracle run <ref>`          → EJECUTA la verificación y la persiste.
//
// Invariante de retorno (precedente `inbox.js` / `integrate.js` / `review.js`): estos handlers
// NUNCA invocan el helper de salida del runtime — RETORNAN el código.
//
// Invariante de color isolation (Phase 14 D-07): este fichero NUNCA importa el paquete de color
// directamente — solo `createFormatter`.
//
// LO QUE ESTE COMANDO NO HACE, POR CONTRATO:
//   - El LISTADO no hace UNA sola llamada a git ni ejecuta un solo comando: todo sale de
//     `state.json`, igual que `kodo integrate`. Es lo que permite al orquestador presentarlo en
//     cada ronda gratis, y lo que garantiza que la ronda del orquestador NUNCA corre suites.
//   - `run` NUNCA toca el checkout del operador. Crea un worktree desechable sobre el commit de
//     la rama y lo destruye. Ni `switch`, ni `stash`, ni escritura en el árbol de trabajo.
//   - `run` NUNCA integra, ni resuelve la entrada, ni cambia su `suggested`. Solo adjunta el
//     veredicto. La decisión sigue siendo del operador.
//
// Exit codes (contrato del repo, `cli/exit-codes.js`):
//   0  el listado se pintó · el detalle se pintó · la corrida terminó (sea cual sea el veredicto)
//   1  la corrida no se pudo persistir, o el oráculo está apagado por config
//   2  uso incorrecto: la ref no está pendiente en la cola

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, KODO_DIR } from '../config.js';
import { findPendingIntegration, listIntegrationQueue, attachOracle } from '../integration/queue.js';
import {
  CHECK_KEYS,
  oracleEnabled,
  resolveRepoCommands,
  runningOracle,
  runOracle,
} from '../integration/oracle.js';
import { isSafeTaskId } from '../session/handoff.js';
import { EXIT_ERROR, EXIT_SUCCESS, EXIT_USAGE } from './exit-codes.js';
import { createFormatter } from './format.js';
import { stripControlChars } from './sanitize.js';

/**
 * @typedef {{
 *   listFn?: typeof listIntegrationQueue,
 *   findFn?: typeof findPendingIntegration,
 *   attachFn?: typeof attachOracle,
 *   runOracleFn?: typeof runOracle,
 *   loadConfigFn?: typeof loadConfig,
 *   readPlanFn?: (taskId: string) => string|null,
 *   gitFn?: (cwd: string, args: string[]) => Promise<string>|string,
 *   loggerFn?: () => any,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   nowFn?: () => Date,
 * }} OracleDeps
 */

/**
 * `gitFn` de producción, calcado de `cli/integrate.js`: stdout trimeado, LANZA si el exit code
 * no es 0, y los argumentos SIEMPRE como array a `execFileSync` — nunca hay un shell de por
 * medio, así que un nombre de rama con metacaracteres no puede ejecutar nada.
 *
 * (El único `sh -c` de este carril es el de los comandos del OPERADOR, dentro de
 * `integration/oracle.js`, y ahí es deliberado: son lo que él teclearía a mano.)
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
 * Lee el plan ligero de una tarea (`~/.kodo/plans/<task_id>.md`) — la fuente del alcance
 * declarado. MISMA ruta que construye el productor (`session-start.js`) y que lee el dashboard
 * (`dashboard/plan.js`).
 *
 * `null` si no hay `task_id`, si el fichero no existe o si no se puede leer: los tres son el
 * mismo hecho para el oráculo —no hay alcance declarado— y el check cae a `skip`.
 *
 * @param {string|null|undefined} taskId
 * @returns {string|null}
 */
function defaultReadPlan(taskId) {
  // `isSafeTaskId` es el guard CANÓNICO del repo para construir exactamente esta ruta — el
  // mismo que usa `session-end.js` al escribir el handoff en ese fichero. Escribir aquí un
  // regex propio crearía una SEGUNDA definición de «task_id seguro», y dos definiciones que
  // discrepan sobre un path traversal es peor que una sola imperfecta.
  if (!isSafeTaskId(taskId)) return null;
  try {
    return readFileSync(join(KODO_DIR, 'plans', `${taskId}.md`), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Símbolo compacto de un estado de check. Es lo que hace legible una fila de cinco checks sin
 * gastar media pantalla: `✓·✓·—·—·✗` se lee de un vistazo, `pass pass skip skip fail` no.
 *
 * @param {string|undefined} status
 * @returns {string}
 */
export function checkGlyph(status) {
  switch (status) {
    case 'pass': return '✓';
    case 'fail': return '✗';
    case 'unknown': return '?';
    default: return '—'; // skip
  }
}

/**
 * Resumen de una línea de los cinco checks, en el orden de `CHECK_KEYS`. PURA.
 *
 * @param {import('../integration/oracle.js').OracleResult|null|undefined} oracle
 * @returns {string} `—` cuando el oráculo no ha corrido: es distinto de cinco `skip`.
 */
export function summarizeChecks(oracle) {
  if (!oracle || typeof oracle !== 'object') return '—';
  return CHECK_KEYS.map((k) => checkGlyph(oracle.checks?.[k]?.status)).join('');
}

/**
 * Etiqueta del veredicto para la tabla. Nunca colorea aquí (eso lo hace el caller con el
 * formatter): PURA y testeable sin terminal.
 *
 * @param {import('../integration/oracle.js').OracleResult|null|undefined} oracle
 * @returns {'sin correr'|'en curso'|'pass'|'fail'|'unknown'}
 */
export function verdictLabel(oracle) {
  if (!oracle || typeof oracle !== 'object') return 'sin correr';
  if (oracle.state === 'running') return 'en curso';
  return oracle.verdict === 'pass' ? 'pass' : oracle.verdict === 'fail' ? 'fail' : 'unknown';
}

/**
 * Lista el veredicto del oráculo de cada entrada de la cola.
 *
 * CERO llamadas a git y CERO ejecución. Es el mismo contrato que el listado de
 * `kodo integrate`, y aquí es todavía más importante: si listar el oráculo corriera algo, la
 * ronda del orquestador acabaría lanzando suites, que es exactamente lo que el enunciado
 * prohíbe.
 *
 * @param {{ all?: boolean, json?: boolean }} opts
 * @param {OracleDeps} [deps]
 * @returns {number} SIEMPRE 0 — un listado nunca es una condición de error.
 */
export function runOracleListCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const listFn = deps.listFn || listIntegrationQueue;

  try {
    const entries = listFn({ all: opts.all === true });

    // Rama `--json` PRIMERO, antes de instanciar el formatter: el carril máquina no puede
    // contaminarse con ANSI por construcción, no solo por convención (DX-06).
    if (opts.json === true) {
      write(JSON.stringify({
        entries: entries.map((e) => ({
          task_ref: e.task_ref,
          branch: e.branch,
          project_path: e.project_path,
          oracle: e.oracle ?? null,
        })),
      }) + '\n');
      return EXIT_SUCCESS;
    }

    const fmt = deps.formatterFn ? deps.formatterFn() : createFormatter(process.stdout);
    if (entries.length === 0) {
      write(`${fmt.dim('cola de integración vacía — nada que verificar')}\n`);
      return EXIT_SUCCESS;
    }
    const rows = entries.map((e) => [
      stripControlChars(e.task_ref),
      stripControlChars(e.branch),
      verdictLabel(e.oracle),
      summarizeChecks(e.oracle),
      e.oracle?.commit ? String(e.oracle.commit).slice(0, 8) : '—',
    ]);
    write(fmt.formatTable(rows, {
      header: ['ref', 'rama', 'veredicto', `checks (${CHECK_KEYS.join('/')})`, 'commit'],
    }) + '\n');
    write(`${fmt.dim('✓ pass · ✗ fail · ? unknown · — no pedido en este repo')}\n`);
    return EXIT_SUCCESS;
  } catch (e) {
    // Cinturón de seguridad: ni un fallo del render convierte un listado en un exit distinto de 0.
    err(`[kodo:oracle] no se pudo renderizar la cola: ${/** @type {Error} */ (e).message}\n`);
    return EXIT_SUCCESS;
  }
}

/**
 * Detalle de UNA entrada: los cinco checks con su estado, su detalle y lo que tardaron.
 *
 * Es la pantalla que contesta la pregunta que el veredicto agregado NO contesta: `pass`
 * significa «pasó todo lo que se le pidió», y aquí se ve QUÉ se le pidió. Sin esta vista, un
 * `pass` sobre cuatro `skip` se leería como un visto bueno general.
 *
 * @param {string} ref
 * @param {{ json?: boolean }} opts
 * @param {OracleDeps} [deps]
 * @returns {number}
 */
export function runOracleStatusCli(ref, opts = {}, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const findFn = deps.findFn || findPendingIntegration;

  let entry = null;
  try {
    entry = findFn(ref);
  } catch {
    entry = null;
  }
  if (!entry) {
    err(`[kodo:oracle] no hay ninguna entrada PENDIENTE para '${stripControlChars(String(ref))}' (mira \`kodo integrate\`)\n`);
    return EXIT_USAGE;
  }

  if (opts.json === true) {
    write(JSON.stringify({
      task_ref: entry.task_ref,
      branch: entry.branch,
      project_path: entry.project_path,
      oracle: entry.oracle ?? null,
    }) + '\n');
    return EXIT_SUCCESS;
  }

  const fmt = deps.formatterFn ? deps.formatterFn() : createFormatter(process.stdout);
  write(`${fmt.cyan(stripControlChars(entry.task_ref))}  ${fmt.dim(stripControlChars(entry.branch))}\n`);
  const oracle = entry.oracle;
  if (!oracle) {
    write(`  ${fmt.dim('el oráculo no ha corrido sobre esta rama')} — \`kodo oracle run ${stripControlChars(entry.task_ref)}\`\n`);
    return EXIT_SUCCESS;
  }
  const label = verdictLabel(oracle);
  const painted = label === 'pass' ? fmt.green(label) : label === 'fail' ? fmt.red(label) : fmt.yellow(label);
  write(`  veredicto ${painted}${oracle.commit ? ` ${fmt.dim(`@ ${String(oracle.commit).slice(0, 8)}`)}` : ''}\n`);
  for (const k of CHECK_KEYS) {
    const c = oracle.checks?.[k];
    const ms = typeof c?.ms === 'number' ? ` ${fmt.dim(`${c.ms}ms`)}` : '';
    write(`  ${checkGlyph(c?.status)} ${k.padEnd(7)}${c?.detail ? ` ${stripControlChars(c.detail)}` : ''}${ms}\n`);
  }
  return EXIT_SUCCESS;
}

/**
 * EJECUTA el oráculo sobre la rama de una entrada y persiste el resultado.
 *
 * Escribe DOS veces en la cola a propósito:
 *   1. `runningOracle` ANTES de empezar. La corrida puede durar minutos, y sin este marcador la
 *      ventana entera se leería como «no ha corrido». Si el proceso muere ahí, la entrada queda
 *      en `running` ⇒ `verdict: 'unknown'` ⇒ el gate falla CERRADO, que es el estado seguro.
 *   2. El resultado al terminar.
 *
 * El exit code NO refleja el veredicto: una corrida que termina con `fail` ha hecho su trabajo
 * y sale con 0. Quien quiere que un `fail` pare algo usa `kodo integrate --require-oracle`,
 * que es el gate explícito. Mezclar las dos cosas convertiría este comando en un gate implícito
 * imposible de usar en un script.
 *
 * @param {string} ref
 * @param {{ json?: boolean }} opts
 * @param {OracleDeps} [deps]
 * @returns {Promise<number>}
 */
export async function runOracleRunCli(ref, opts = {}, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const findFn = deps.findFn || findPendingIntegration;
  const attachFn = deps.attachFn || attachOracle;
  const runFn = deps.runOracleFn || runOracle;
  const clock = deps.nowFn || (() => new Date());

  let entry = null;
  try {
    entry = findFn(ref);
  } catch {
    entry = null;
  }
  if (!entry) {
    err(`[kodo:oracle] no hay ninguna entrada PENDIENTE para '${stripControlChars(String(ref))}' (mira \`kodo integrate\`)\n`);
    return EXIT_USAGE;
  }

  const config = (deps.loadConfigFn || loadConfig)();
  if (!oracleEnabled(config)) {
    err('[kodo:oracle] el oráculo está apagado (`oracle.enabled: false`) — no se verifica nada\n');
    return EXIT_ERROR;
  }

  const logger = deps.loggerFn ? deps.loggerFn() : muteLogger();
  const commands = resolveRepoCommands(config, entry.project_path);

  // El selector que se persiste es el `ref` ORIGINAL, no `entry.task_ref`. La diferencia importa:
  // una entrada se identifica por (project_path, branch), así que UNA tarea que tocó dos repos en
  // dos sesiones deja DOS entradas con el MISMO `task_ref`. `findPendingIntegration` prueba
  // task_ref primero y rama después; reescribir el selector a `entry.task_ref` haría que
  // `kodo oracle run <rama-del-segundo-repo>` verificase esa rama y colgase el veredicto de la
  // PRIMERA entrada — un `pass` sobre código que nadie verificó. Pasando el mismo `ref` a las dos
  // llamadas, la búsqueda y la escritura aterrizan por construcción en la misma entrada. Es el
  // mismo criterio con el que `cli/integrate.js` pasa su `ref` a `resolveIntegration`.
  //
  // Marcador de corrida en curso. Un fallo aquí NO aborta: perder el marcador solo significa
  // que la ventana se ve como «sin correr», y eso es preferible a no verificar nada.
  attachFn(ref, runningOracle(clock().toISOString()), logger);

  const readPlan = deps.readPlanFn || defaultReadPlan;
  const result = await runFn({
    project: entry.project_path,
    branch: entry.branch,
    base: entry.base_branch,
    commands,
    planMd: readPlan(entry.task_id),
    gitFn: deps.gitFn || defaultGit,
    now: clock,
  });

  const persisted = attachFn(ref, result, logger);
  if (!persisted.ok) {
    // La verificación SÍ ocurrió pero su registro no. Se dice, y se sale con 1: devolver 0
    // dejaría al operador creyendo que el veredicto está en la cola cuando no lo está.
    err(`[kodo:oracle] la verificación terminó pero no se pudo persistir (${persisted.reason})\n`);
    if (opts.json === true) write(JSON.stringify({ ok: false, task_ref: entry.task_ref, oracle: result }) + '\n');
    return EXIT_ERROR;
  }

  if (opts.json === true) {
    write(JSON.stringify({ ok: true, task_ref: entry.task_ref, branch: entry.branch, oracle: result }) + '\n');
    return EXIT_SUCCESS;
  }

  const fmt = deps.formatterFn ? deps.formatterFn() : createFormatter(process.stdout);
  const label = verdictLabel(result);
  const painted = label === 'pass' ? fmt.green(label) : label === 'fail' ? fmt.red(label) : fmt.yellow(label);
  write(`${stripControlChars(entry.task_ref)}: oráculo ${painted} ${summarizeChecks(result)}\n`);
  for (const k of CHECK_KEYS) {
    const c = result.checks?.[k];
    if (c?.status === 'fail' || c?.status === 'unknown') {
      write(`  ${checkGlyph(c.status)} ${k}: ${stripControlChars(c.detail || '')}\n`);
    }
  }
  return EXIT_SUCCESS;
}

/**
 * Logger MUDO. El registro del oráculo es auditoría, no una precondición: perder la línea no
 * puede impedir que la verificación corra. Mismo criterio (y mismo shape) que `makeLogger` en
 * `cli/integrate.js`.
 *
 * @returns {any}
 */
function muteLogger() {
  /** @type {any} */
  const mute = { info() {}, warn() {}, error() {}, debug() {}, child() { return mute; } };
  return mute;
}
