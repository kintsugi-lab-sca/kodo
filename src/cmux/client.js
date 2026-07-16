// @ts-check
import { execFile } from 'node:child_process';
import { loadConfig } from '../config.js';

function getCmuxBinary() {
  return loadConfig().cmux.binary;
}

/**
 * @param {string[]} args
 * @param {import('../logger.js').Logger} [logger]
 * @returns {Promise<string>}
 */
function run(args, logger) {
  return new Promise((resolve, reject) => {
    logger?.debug('cmux.exec', { cmd: args[0], argc: args.length });
    execFile(getCmuxBinary(), args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        logger?.warn('cmux.fail', { cmd: args[0], stderr: String(stderr || '').slice(0, 200) });
        reject(new Error(`cmux ${args[0]} failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Construye el argv determinista de `new-workspace` (función pura, sin I/O).
 * Orden estable de flags: `--name` → `--cwd` → `--command` → `--group`, cada
 * uno añadido solo cuando su valor es truthy (mismo idiom que `--cwd`/`--command`).
 * El array es plano de strings apto para `execFile` sin shell: el ref de grupo
 * viaja como elemento de array, jamás interpolado en un string (V5/Tampering,
 * T-77-01). Extraído a función para darle un test directo (`run()` no es inyectable).
 * @param {{ name: string, cwd?: string, command?: string, group?: string }} opts
 * @returns {string[]} argv para `execFile`
 */
export function buildNewWorkspaceArgs(opts) {
  const args = ['new-workspace', '--name', opts.name];
  if (opts.cwd) args.push('--cwd', opts.cwd);
  if (opts.command) args.push('--command', opts.command);
  if (opts.group) args.push('--group', opts.group);
  return args;
}

/**
 * @param {{ name: string, cwd?: string, command?: string, group?: string }} opts
 * @returns {Promise<string>} workspace reference (e.g. "workspace:3")
 */
export async function newWorkspace(opts) {
  const args = buildNewWorkspaceArgs(opts);
  const output = await run(args);
  // cmux returns "OK workspace:N" — extract the ref
  const match = output.match(/(workspace:\d+)/);
  return match ? match[1] : output;
}

/**
 * @param {{ workspace: string, text: string }} opts
 */
export async function send(opts) {
  return run(['send', '--workspace', opts.workspace, opts.text + '\\n']);
}

/**
 * @param {{ workspace: string, lines?: number }} opts
 * @returns {Promise<string>}
 */
export async function readScreen(opts) {
  const args = ['read-screen', '--workspace', opts.workspace];
  if (opts.lines) args.push('--lines', String(opts.lines));
  return run(args);
}

/**
 * @param {{ workspace: string, color: string }} opts
 */
export async function setColor(opts) {
  return run(['workspace-action', '--action', 'set-color', '--workspace', opts.workspace, '--color', opts.color]);
}

/**
 * @param {{ workspace: string, title: string }} opts
 */
export async function rename(opts) {
  // Forma canónica cmux 0.64.16: `cmux workspace rename <ws> --title <new>`.
  // NO `workspace-action --action set-title` — esa acción NO existe ("Unknown
  // workspace action"); la acción de renombrar se llama `rename`. Verificado en vivo.
  return run(['workspace', 'rename', opts.workspace, '--title', opts.title]);
}

/**
 * @returns {Promise<string>}
 */
export async function listWorkspaces() {
  return run(['workspace', 'list']);
}

/**
 * Passthrough read-only de `workspace-group list --json`. Devuelve el stdout
 * crudo (JSON sin parsear): el parseo defensivo vive en la función pura de la
 * Plan 02, NO aquí (D-05). De la familia workspace-group solo se expone `list`
 * (GRP-04): create/rename/delete/ungroup/add quedan fuera. Un fallo de `run()`
 * (cmux viejo sin el subcomando, daemon headless, timeout 15s) rejecta la
 * promesa — esa rejección es la capa 1 de fail-open del caller (GRP-03).
 * @returns {Promise<string>} JSON crudo de `workspace-group list`
 */
export async function listWorkspaceGroups() {
  return run(['workspace-group', 'list', '--json']);
}

/**
 * @param {{ title: string, body?: string, workspace?: string }} opts
 */
export async function notify(opts) {
  const args = ['notify', '--title', opts.title];
  if (opts.body) args.push('--body', opts.body);
  if (opts.workspace) args.push('--workspace', opts.workspace);
  return run(args);
}
