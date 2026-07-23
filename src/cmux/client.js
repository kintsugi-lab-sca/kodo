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
 * Plan 02, NO aquí (D-05). Un fallo de `run()` (cmux viejo sin el subcomando,
 * daemon headless, timeout 15s) rejecta la promesa — esa rejección es la capa 1
 * de fail-open del caller (GRP-03).
 *
 * RE-FRONTERIZACIÓN GRP-04 (v0.18, Phase 79 · D-12): la gestión de
 * workspace-group deja de estar totalmente fuera del código. Se permite un
 * allowlist NO-DESTRUCTIVO —`create`, `add`, `set-anchor`, `ungroup`— usado
 * EXCLUSIVAMENTE por el carril doctor del sidebar (`kodo sidebar doctor`); ver
 * los passthroughs más abajo. El launch path (manager.js) sigue consumiendo SOLO
 * `list` (read-only). Fuera del código quedan LOCKED: el verbo destructivo
 * `delete` (cierra todos los workspaces del grupo), `remove` y `rename` — el
 * guard source-hygiene test/sidebar-doctor-hygiene.test.js falla si alguno de
 * ellos se cablea.
 * @returns {Promise<string>} JSON crudo de `workspace-group list`
 */
export async function listWorkspaceGroups() {
  return run(['workspace-group', 'list', '--json']);
}

/**
 * Passthrough read-only de `workspace list --json`. Devuelve el stdout crudo
 * (JSON sin parsear) — el parseo defensivo vive en la función pura del scan
 * (Plan 02, D-04/D-05). Necesario para comprobar la liveness de los
 * `workspace_ref` del scan del sidebar doctor. NO sustituye a `listWorkspaces()`
 * (:95, texto plano — la usa otro carril).
 * @returns {Promise<string>} JSON crudo de `workspace list`
 */
export async function listWorkspacesJson() {
  return run(['workspace', 'list', '--json']);
}

// ── Allowlist NO-DESTRUCTIVO de workspace-group (D-12, re-fronterización GRP-04) ──
// Los 4 ÚNICOS passthroughs de mutación cmux del carril doctor. Cada uno delega en
// `run()` (execFile, timeout 15s, sin shell) con un argv PLANO de strings: el ref del
// grupo (`workspace_group:N` o UUID) y el del workspace (`workspace:N`) viajan como
// elementos de array, jamás interpolados en un string — cero superficie de inyección,
// espejo de buildNewWorkspaceArgs (:38, V5/Tampering, T-79-01). Sintaxis verificada en
// vivo (D-10, cmux 0.64.20). NINGÚN `delete`/`remove`/`rename`: el guard lo verifica.

/**
 * `workspace-group create [--name <name>] [--from <ref>,<ref>...]`. Devuelve el
 * stdout crudo — el ref del grupo nuevo se obtiene por re-list en el Plan 02
 * (OQ1), NO se parsea aquí.
 * @param {{ name?: string, from?: string[] }} opts  `from` = refs `workspace:N`
 * @returns {Promise<string>} stdout crudo de `workspace-group create`
 */
export async function createWorkspaceGroup({ name, from }) {
  const args = ['workspace-group', 'create'];
  if (name) args.push('--name', name);
  if (from && from.length) args.push('--from', from.join(','));
  return run(args);
}

/**
 * `workspace-group add --group <group> --workspace <ws>`.
 * @param {{ group: string, workspace: string }} opts
 * @returns {Promise<string>} stdout crudo
 */
export async function addToWorkspaceGroup({ group, workspace }) {
  return run(['workspace-group', 'add', '--group', group, '--workspace', workspace]);
}

/**
 * `workspace-group set-anchor --group <group> --workspace <ws>` (D-08: el ancla es
 * el miembro más longevo).
 * @param {{ group: string, workspace: string }} opts
 * @returns {Promise<string>} stdout crudo
 */
export async function setGroupAnchor({ group, workspace }) {
  return run(['workspace-group', 'set-anchor', '--group', group, '--workspace', workspace]);
}

/**
 * `workspace-group ungroup <group>` — disuelve un grupo preservando sus miembros
 * (D-05: NO destructivo, aplica a grupos con 0 miembros). `<group>` es posicional.
 * @param {{ group: string }} opts
 * @returns {Promise<string>} stdout crudo
 */
export async function ungroupWorkspaceGroup({ group }) {
  return run(['workspace-group', 'ungroup', group]);
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
