// @ts-check
//
// src/cli/sidebar-doctor.js — Action handler de `kodo sidebar doctor` (Phase 79 Plan 03).
//
// La mitad CLI del motor puro `src/cmux/sidebar-doctor.js` (Plan 02). Calco
// literal de `runGsdDoctor` (gsd-doctor.js): implementa el ritual de dos pasos
// "doctor mira, doctor --fix arregla":
//
//   - Sin flags (default): dry-run. Llama `scan()` y RENDERIZA las 3 categorías
//     del sidebar (missing_group / loose_workspace / empty_group) agrupadas con
//     la acción EXACTA por item (orden D-09) + un resumen de sesiones ya
//     agrupadas (protected). NO muta nada.
//   - `--fix`: ÚNICO opt-in de mutación. Llama `scan()` para el exit code, luego
//     `execute(deps, {fix:true})` (re-detecta TOCTOU en el motor) y renderiza lo
//     que realmente convergió (created/added/ungrouped + errores). Sin prompt.
//   - `--json` (SDR-06): emite el report serializado de scan() byte-determinista
//     (idéntico TTY/no-TTY, cero ANSI), con el result de execute mergeado bajo
//     `executed` cuando `--fix`.
//
// Exit code (espejo D-09): `report.hasActions ? 1 : 0`, calculado ANTES de
// renderizar — tanto en dry-run como en --fix. `report.protected` (sesiones ya
// bien agrupadas) NUNCA afecta al exit code.
//
// scan/execute son ASYNC (passthroughs cmux vía execFile, Plan 02): el handler
// hace `await scanFn(deps)` y `await executeFn(deps, {fix:true})`. Los stubs sync
// de test se resuelven igual vía `await`.
//
// Color isolation: este handler NO importa la lib de color directamente. Todo el
// color sale del formatter inyectado (`createFormatter`), cero ANSI inline.
//
// Aislamiento (RESEARCH §Nota de aislamiento): importa scan/execute SOLO del
// motor puro `../cmux/sidebar-doctor.js`, NUNCA del passthrough crudo de cmux.
//
// Sin `ensureConfig()`: el doctor lee state.json/projects.json/cmux y NO toca
// ningún provider (preserva el 0-provider de SDR-03). Mismo precedente que
// `gsd doctor` (cli.js:466-468).

import { scan as realScan, execute as realExecute } from '../cmux/sidebar-doctor.js';
import { createFormatter } from './format.js';

/**
 * @typedef {{ fix?: boolean, json?: boolean }} RunSidebarDoctorOpts
 *
 * @typedef {{
 *   scanFn?: (deps?: any) => Promise<import('../cmux/sidebar-doctor.js').SidebarReport> | import('../cmux/sidebar-doctor.js').SidebarReport,
 *   executeFn?: (deps?: any, opts?: any) => Promise<import('../cmux/sidebar-doctor.js').SidebarResult>,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 * }} RunSidebarDoctorDeps
 */

/**
 * Detecta (dry-run) y converge (--fix) la deriva de los grupos del sidebar cmux.
 *
 * @param {RunSidebarDoctorOpts} opts
 * @param {RunSidebarDoctorDeps} [deps]
 * @returns {Promise<number>} exit code: 1 cuando hay acciones, 0 cuando el
 *   sidebar está convergido. `protected` NUNCA afecta al exit code.
 */
export async function runSidebarDoctor(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();
  const scanFn = deps.scanFn || realScan;
  const executeFn = deps.executeFn || realExecute;

  // 1. SIEMPRE escanear primero — el report es la fuente del exit code y del
  //    render dry-run / --json. scan es async (Plan 02): await.
  const report = await scanFn(deps);

  // 2. Exit code ANTES del render: hasActions ? 1 : 0. report.protected
  //    (sesiones ya agrupadas) NO entra en hasActions → NO afecta al exit.
  const exitCode = report.hasActions ? 1 : 0;

  // 3. Converger sólo bajo --fix (único opt-in de mutación, sin prompt).
  //    execute() SIEMPRE va DESPUÉS de scan().
  let result = null;
  if (opts.fix) {
    result = await executeFn(deps, { fix: true });
  }

  // 4. Render. --json (SDR-06) es byte-determinista (no usa el formatter).
  if (opts.json) {
    const payload = opts.fix ? { ...report, executed: result } : report;
    write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    renderHuman({ report, result, fix: !!opts.fix, write, err, fmt });
  }

  return exitCode;
}

/**
 * Render humano: las categorías del sidebar + resumen de sesiones protegidas.
 * Bajo --fix, añade lo realmente convergido.
 *
 * Mapeo por item:
 *   - missing_group:   ADVISORY — acción del OPERADOR (crear el grupo). El doctor
 *                      NO lo ejecuta (G-79-1): no ancla grupos en sesiones vivas.
 *   - loose_workspace: `add`     — acción del doctor (orden D-09).
 *   - empty_group:     `ungroup` — acción del doctor (orden D-09).
 *
 * @private
 * @param {{
 *   report: import('../cmux/sidebar-doctor.js').SidebarReport,
 *   result: import('../cmux/sidebar-doctor.js').SidebarResult | null,
 *   fix: boolean,
 *   write: (s: string) => void,
 *   err: (s: string) => void,
 *   fmt: import('./format.js').Formatter,
 * }} params
 */
function renderHuman({ report, result, fix, write, err, fmt }) {
  write(`kodo sidebar doctor${fix ? ' --fix' : ' (dry-run)'}\n\n`);

  // missing_group es ADVISORY (G-79-1): el doctor NO lo ejecuta. Se pinta como
  // acción del OPERADOR, nunca con la etiqueta ejecutable create/add/set-anchor.
  renderAdvisory(write, fmt, report.missing_group);
  // Acciones reales del doctor (orden D-09): loose → empty.
  renderCategory(
    write, fmt, 'Workspaces sueltos', report.loose_workspace,
    () => 'add',
    (item) => `${item.workspace_ref} → ${item.name} (${item.group})`,
  );
  renderCategory(
    write, fmt, 'Grupos vacíos', report.empty_group,
    () => 'ungroup',
    (item) => `${item.ref}${item.name ? ` (${item.name})` : ''}`,
  );

  // Resumen de sesiones ya bien agrupadas (protected) — NO afecta el exit code.
  write(`\nprotected: ${report.protected.sessions.length} sesiones ya agrupadas\n`);

  // Verdict de scan. hasActions (auto-arreglable) tiene prioridad; si no hay
  // acciones pero sí advisories, es un estado que requiere acción del operador
  // (exit 0, nada auto-arreglado); si no, convergido.
  if (report.hasActions) {
    write(`\n${fmt.yellow('drift found')} — ${fix ? 'converged below' : 'run with --fix to converge'}\n`);
  } else if (report.hasAdvisories) {
    write(`\n${fmt.yellow('advisory')} — requiere acción del operador (nada auto-arreglado)\n`);
  } else {
    write(`\n${fmt.ok('clean')} — sidebar converged\n`);
  }

  // Bajo --fix: lo que realmente se ejecutó.
  if (fix && result) {
    write('\n─── executed ───\n');
    write(`created:   ${result.created}\n`);
    write(`added:     ${result.added}\n`);
    write(`ungrouped: ${result.ungrouped}\n`);
    if (result.errors.length > 0) {
      err(`\n${fmt.red('errors')} (${result.errors.length}):\n`);
      for (const e of result.errors) {
        err(`  ${fmt.fail(e.category)} ${e.target}: ${e.reason}\n`);
      }
    }
  }
}

/**
 * Renderiza una categoría: header + un item por línea con su acción exacta
 * (coloreada vía el formatter inyectado) y su descriptor, o una marca de "vacío"
 * cuando no hay nada. Calco de renderCategory de gsd-doctor.js.
 *
 * @private
 * @param {(s: string) => void} write
 * @param {import('./format.js').Formatter} fmt
 * @param {string} title
 * @param {any[]} items
 * @param {(item: any) => string} actionOf
 * @param {(item: any) => string} descOf
 */
function renderCategory(write, fmt, title, items, actionOf, descOf) {
  if (items.length === 0) {
    write(`${title}: ${fmt.dim('none')}\n`);
    return;
  }
  write(`${title} (${items.length}):\n`);
  for (const item of items) {
    write(`  ${fmt.yellow(actionOf(item))} — ${descOf(item)}\n`);
  }
}

/**
 * Renderiza los grupos faltantes como ADVISORY (G-79-1): NO son acciones del
 * doctor sino del operador. Nunca usa la etiqueta ejecutable create/add/set-anchor
 * — anclar un grupo en una sesión viva le robaría su fila sidebar (cmux 0.64.20:
 * el header ES la representación del anchor). El operador crea el grupo una vez
 * (eligiendo su anchor conscientemente) y el doctor lo mantiene poblado vía add.
 *
 * @private
 * @param {(s: string) => void} write
 * @param {import('./format.js').Formatter} fmt
 * @param {import('../cmux/sidebar-doctor.js').SidebarReport['missing_group']} items
 */
function renderAdvisory(write, fmt, items) {
  const title = 'Grupos faltantes (advisory — el operador debe crearlos)';
  if (items.length === 0) {
    write(`${title}: ${fmt.dim('none')}\n`);
    return;
  }
  write(`${title} (${items.length}):\n`);
  for (const item of items) {
    write(`  ${fmt.dim('advisory')} — crear grupo '${item.name}' para ${item.members.length} sesión(es) — kodo no ancla en una sesión viva\n`);
  }
}
