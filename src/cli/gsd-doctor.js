// @ts-check
//
// src/cli/gsd-doctor.js — Action handler de `kodo gsd doctor` (Phase 41 Plan 03).
//
// La mitad CLI del módulo puro `src/gsd/doctor.js` (Plan 02). Implementa el
// ritual de dos pasos "doctor mira, doctor --fix arregla":
//
//   - Sin flags (default): dry-run. Llama `scan()` y RENDERIZA las 4 categorías
//     agrupadas con la acción EXACTA por item (D-08) + un resumen de recursos
//     protegidos (vivos). NO muta nada.
//   - `--fix`: ÚNICO opt-in de mutación (D-03/D-07). Llama `scan()` para el exit
//     code, luego `execute(deps, {fix:true})` y renderiza lo que realmente se
//     saneó (removed/moved/pruned/stolen/unlinked + errores). Sin prompt de
//     confirmación (D-07).
//   - `--json` (D-01): emite el report serializado de scan() byte-determinista
//     (idéntico TTY/no-TTY), con el result de execute mergeado bajo `--fix`.
//     Consumible por Phase 42.
//
// Exit code (D-03/D-09): `report.hasGarbage ? 1 : 0`, calculado ANTES de
// renderizar. El resumen de recursos vivos (`report.protected`) NUNCA afecta al
// exit code (D-09 — los recursos protegidos no son basura).
//
// Color isolation: este handler NO importa la lib de color directamente. Todo el
// color sale del formatter inyectado (`createFormatter`), cero ANSI inline.
//
// Sin `ensureConfig()`: doctor sanea el filesystem local (worktrees, locks,
// logs, state.json) y NO toca ningún provider (D-02 / CONTEXT línea 104).
// Mismo precedente que `skill sync` (cli.js:357) y `polling start` (cli.js:383).

import { scan as realScan, execute as realExecute } from '../gsd/doctor.js';
import { createFormatter } from './format.js';

/**
 * @typedef {{ fix?: boolean, json?: boolean }} RunGsdDoctorOpts
 *
 * @typedef {{
 *   scanFn?: (deps?: any) => import('../gsd/doctor.js').DoctorReport,
 *   executeFn?: (deps?: any, opts?: any) => Promise<import('../gsd/doctor.js').DoctorResult>,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 * }} RunGsdDoctorDeps
 */

/**
 * Detecta (dry-run) y sanea (--fix) la basura del ciclo de vida de sesiones.
 *
 * @param {RunGsdDoctorOpts} opts
 * @param {RunGsdDoctorDeps} [deps]
 * @returns {Promise<number>} exit code: 1 cuando hay basura, 0 cuando está limpio.
 *   El resumen de recursos vivos (protected) NUNCA afecta al exit code (D-09).
 */
export async function runGsdDoctor(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();
  const scanFn = deps.scanFn || realScan;
  const executeFn = deps.executeFn || realExecute;

  // 1. SIEMPRE escanear primero — el report es la fuente del exit code y del
  //    render dry-run / --json.
  const report = scanFn(deps);

  // 2. Exit code (D-03) ANTES del render: hasGarbage ? 1 : 0. report.protected
  //    (recursos vivos) NO entra en hasGarbage, así que NO afecta al exit (D-09).
  const exitCode = report.hasGarbage ? 1 : 0;

  // 3. Sanear sólo bajo --fix (D-03/D-07: único opt-in de mutación, sin prompt).
  //    execute() SIEMPRE va DESPUÉS de scan().
  let result = null;
  if (opts.fix) {
    result = await executeFn(deps, { fix: true });
  }

  // 4. Render. --json (D-01) es byte-determinista (no usa el formatter).
  if (opts.json) {
    const payload = opts.fix ? { ...report, executed: result } : report;
    write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    renderHuman({ report, result, fix: !!opts.fix, write, err, fmt });
  }

  return exitCode;
}

/**
 * Render humano: 4 categorías agrupadas con la acción EXACTA por item (D-08) +
 * resumen de recursos protegidos (D-09). Bajo --fix, añade lo realmente saneado.
 *
 * Mapeo de acciones por item (D-08):
 *   - worktree: `remove` / `prune` / `move to <path>.dirty`
 *   - lock:     `steal` / `keep`
 *   - log:      `unlink`
 *   - zombie:   `remove-session`
 *
 * @private
 * @param {{
 *   report: import('../gsd/doctor.js').DoctorReport,
 *   result: import('../gsd/doctor.js').DoctorResult | null,
 *   fix: boolean,
 *   write: (s: string) => void,
 *   err: (s: string) => void,
 *   fmt: import('./format.js').Formatter,
 * }} params
 */
function renderHuman({ report, result, fix, write, fmt }) {
  write(`kodo gsd doctor${fix ? ' --fix' : ' (dry-run)'}\n\n`);

  renderCategory(write, fmt, 'Worktrees huérfanos', report.worktrees, (item) =>
    formatWorktreeAction(item));
  renderCategory(write, fmt, 'Sesiones zombie', report.zombies, () => 'remove-session');
  renderCategory(write, fmt, 'Locks colgados', report.locks, (item) => `lock ${item.action}`);
  renderCategory(write, fmt, 'Logs antiguos', report.logs, () => 'log unlink');

  // Resumen de recursos protegidos (vivos) — D-09: NO afecta el exit code.
  const liveSessions = report.protected.sessions.length;
  const activeLocks = report.protected.locks.length;
  write(`\nprotected: ${liveSessions} live sessions / ${activeLocks} active locks\n`);

  // Verdict de scan.
  if (report.hasGarbage) {
    write(`\n${fmt.yellow('garbage found')} — ${fix ? 'sanitized below' : 'run with --fix to sanitize'}\n`);
  } else {
    write(`\n${fmt.ok('clean')} — nothing to sanitize\n`);
  }

  // Bajo --fix: lo que realmente se ejecutó.
  if (fix && result) {
    write('\n─── executed ───\n');
    write(`worktrees: ${result.worktrees.removed} removed, ${result.worktrees.moved} moved, ${result.worktrees.pruned} pruned, ${result.worktrees.skipped} skipped (re-check live)\n`);
    write(`zombies:   ${result.zombies.removed} removed\n`);
    write(`locks:     ${result.locks.stolen} stolen, ${result.locks.kept} kept\n`);
    write(`logs:      ${result.logs.unlinked} unlinked\n`);
    if (result.errors.length > 0) {
      write(`\n${fmt.red('errors')} (${result.errors.length}):\n`);
      for (const e of result.errors) {
        write(`  ${fmt.fail(e.category)} ${e.target}: ${e.reason}\n`);
      }
    }
  }
}

/**
 * Renderiza una categoría: header + un item por línea con su acción exacta, o
 * una marca de "vacío" cuando no hay nada.
 *
 * @private
 * @param {(s: string) => void} write
 * @param {import('./format.js').Formatter} fmt
 * @param {string} title
 * @param {import('../gsd/doctor.js').DoctorReport['worktrees']} items
 * @param {(item: { id: string, path: string, action: string, reason: string }) => string} actionOf
 */
function renderCategory(write, fmt, title, items, actionOf) {
  if (items.length === 0) {
    write(`${title}: ${fmt.dim('none')}\n`);
    return;
  }
  write(`${title} (${items.length}):\n`);
  for (const item of items) {
    write(`  ${fmt.yellow(actionOf(item))} — ${item.id} (${item.path}) [${item.reason}]\n`);
  }
}

/**
 * La acción EXACTA de un worktree (D-08). El report de scan marca todos los
 * worktrees huérfanos con `action: 'remove'`; la resolución real remove/prune/
 * move-to-.dirty la decide `cleanupWorktree` en execute (dirty → `.dirty`). En
 * dry-run mostramos "remove" como el caso normal, y si el item ya viene anotado
 * con otra acción (move/prune) la respetamos.
 *
 * @private
 * @param {{ action: string, path: string }} item
 * @returns {string}
 */
function formatWorktreeAction(item) {
  if (item.action === 'move' || item.action === 'moved') return `move to ${item.path}.dirty`;
  if (item.action === 'prune') return 'worktree prune';
  return 'worktree remove';
}
