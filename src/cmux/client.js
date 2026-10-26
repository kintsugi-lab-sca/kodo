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
 * @param {{ workspace: string, description: string }} opts
 */
export async function setDescription(opts) {
  return run(['workspace-action', '--action', 'set-description', '--workspace', opts.workspace, '--description', opts.description]);
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
 * Passthrough read-only de `cmux tree --all --json`. Devuelve el stdout crudo
 * (JSON sin parsear) — el parseo defensivo vive en el caller.
 *
 * A DIFERENCIA de `listWorkspaces()`/`listWorkspacesJson()` (:95/:129), esta vista
 * es CROSS-WINDOW: `workspace list` solo enumera el window del caller (limitación
 * P-4, el JSON lo delata con su `window_ref`), mientras que `tree --all` devuelve
 * `windows[].workspaces[]` de TODOS los windows y, además, el `id` (UUID) de cada
 * workspace — la única identidad estable que expone cmux, porque los refs
 * `workspace:N` se RECICLAN al cerrar y crear tabs.
 *
 * Esas dos propiedades son exactamente las que necesita la revalidación del
 * orquestador (`verifyRegisteredOrchestrator`, orchestrator/launch.js): comprobar
 * si el workspace registrado sigue vivo sin depender de en qué window corra el
 * check ni de que su título siga siendo `kodo-orchestrator`.
 *
 * @returns {Promise<string>} JSON crudo de `cmux tree --all --json`
 */
export async function listTree() {
  return run(['tree', '--all', '--json']);
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
 * allowlist NO-DESTRUCTIVO —`create`, `add`, `ungroup`— usado EXCLUSIVAMENTE por
 * el carril doctor del sidebar (`kodo sidebar doctor`); ver los passthroughs más
 * abajo. El launch path (manager.js) sigue consumiendo SOLO `list` (read-only).
 * Fuera del código quedan LOCKED: el verbo destructivo `delete` (cierra todos los
 * workspaces del grupo), `remove` y `rename`. `set-anchor` vuelve en KODO-106, pero
 * SOLO para reanclar un grupo en un workspace ESTABLE recién creado por el doctor
 * (nunca en una sesión: anclar en una sesión le roba su fila sidebar, G-79-1). El
 * guard source-hygiene test/sidebar-doctor-hygiene.test.js falla si se cablea un
 * LOCKED o si `set-anchor` sale de este passthrough / del doctor.
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
// vivo (D-10, cmux 0.64.20; KODO-106, cmux 0.65.2). NINGÚN `delete`/`remove`/`rename`:
// el guard lo verifica. `set-anchor` solo desde el doctor y sobre un ancla estable.

/**
 * `workspace-group create [--name <name>] [--cwd <path>]` — SIN `--from` a propósito.
 * cmux levanta un workspace ancla NUEVO (provenance `generated`) titulado `<name>` y
 * con cwd `<path>`: el ancla estable del repo. `--from` NO se expone (KODO-106): en
 * cmux 0.65.2 `create --from <ws>` REUTILIZA el primer `<ws>` como ancla (en 0.64.20
 * creaba uno nuevo), y el `<ws>` es siempre una sesión. Los miembros entran después
 * con `add`. Devuelve el stdout crudo — el ref del grupo nuevo se obtiene por re-list
 * (OQ1), NO se parsea aquí.
 * @param {{ name?: string, cwd?: string }} opts
 * @returns {Promise<string>} stdout crudo de `workspace-group create`
 */
export async function createWorkspaceGroup({ name, cwd }) {
  const args = ['workspace-group', 'create'];
  if (name) args.push('--name', name);
  if (cwd) args.push('--cwd', cwd);
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
 * `workspace-group set-anchor --group <group> --workspace <ws>`. cmux exige que `<ws>`
 * ya sea miembro del grupo (si no: `not_found: Group not found or workspace not a
 * member`, verificado en 0.65.2). ÚNICO consumidor: el doctor, para mover el ancla de
 * una sesión a un workspace estable que acaba de crear dentro del grupo (KODO-106).
 * @param {{ group: string, workspace: string }} opts
 * @returns {Promise<string>} stdout crudo
 */
export async function setWorkspaceGroupAnchor({ group, workspace }) {
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
