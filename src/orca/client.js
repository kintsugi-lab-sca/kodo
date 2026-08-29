// @ts-check
// src/orca/client.js
// Cliente del binario `orca` — espejo estructural de `src/cmux/client.js` (KODO-18).
//
// Confinamiento: igual que su hermano cmux, este módulo SOLO debe consumirse desde
// `src/host/orca.js`. El walker `test/host/cmux-isolation.test.js` vigila la variante
// cmux; `test/host/orca-isolation.test.js` hace lo propio aquí.
//
// Diferencias de contrato frente a cmux (VERIFICADAS en vivo contra orca 1.4.184):
//   - TODO comando devuelve un SOBRE JSON `{id, ok, result?, error?, _meta}` cuando se
//     le pasa `--json`. `runJson` lo desempaqueta y convierte `ok:false` en throw.
//   - El ref canónico de un workspace es `<repoId>::<absPath>` (campo `id` de
//     `worktree list`/`create`, `worktreeId` de `worktree ps`). A diferencia de los
//     `workspace:N` de cmux, NO se recicla — es identidad estable.
//   - `--worktree` acepta selectores; kodo usa siempre `id:<ref>` (el más específico).
//   - Orca NO tiene: notificaciones de SO ni grupos de workspace. Ambos degradan a
//     no-op fail-open (ver `notify` / `listWorkspaceGroups`) en vez de lanzar, para
//     que el launch path compartido con cmux no necesite ramas por host.
import { execFile } from 'node:child_process';
import { loadConfig } from '../config.js';
// KODO-56: hoja PURA (0 imports, 0 side-effects) — no toca el grafo que vigila
// test/host/orca-isolation.test.js.
import { platformDefaults } from '../platform-defaults.js';

/** Timeout por defecto. Más holgado que cmux (15s): orca habla con la app vía runtime. */
const TIMEOUT_MS = 20_000;
/** `worktree create` materializa un checkout git (+ hooks de setup) — necesita aire. */
const CREATE_TIMEOUT_MS = 120_000;

function getOrcaBinary() {
  // KODO-56: mismo cambio que en `createOrcaHost` — el fallback literal `'orca'` es el lector
  // de pantalla de GNOME en Linux. Un único resolvedor por plataforma (platform-defaults.js).
  return loadConfig().orca?.binary || platformDefaults().orcaBinary;
}

/**
 * Ejecuta el binario orca y devuelve stdout recortado. Sin shell (execFile): cada
 * argumento viaja como elemento de array, jamás interpolado — cero superficie de
 * inyección (mismo invariante V5/Tampering que `buildNewWorkspaceArgs` de cmux).
 *
 * @param {string[]} args
 * @param {{ timeoutMs?: number, logger?: import('../logger.js').Logger }} [opts]
 * @returns {Promise<string>}
 */
function run(args, opts = {}) {
  const timeout = opts.timeoutMs || TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    opts.logger?.debug?.('orca.exec', { cmd: args[0], argc: args.length });
    execFile(getOrcaBinary(), args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        opts.logger?.warn?.('orca.fail', { cmd: args[0], stderr: String(stderr || '').slice(0, 200) });
        reject(new Error(`orca ${args[0]} failed: ${stderr || err.message}`));
        return;
      }
      resolve(String(stdout).trim());
    });
  });
}

/**
 * Desempaqueta el sobre JSON de orca. PURA (sin I/O) para poder testearla directa.
 *
 * Sobre real (verificado): `{"id":"…","ok":true,"result":{…},"_meta":{…}}` y, en error,
 * `{"id":"…","ok":false,"error":{"code":"runtime_unavailable","message":"…"}}`.
 *
 * @param {string} raw - stdout crudo del binario.
 * @param {string} label - etiqueta del comando para el mensaje de error.
 * @returns {any} el `result` desempaquetado (`{}` si el comando no devuelve payload).
 * @throws {Error} si el stdout no es JSON o si el sobre trae `ok !== true`.
 */
export function unwrapEnvelope(raw, label = 'orca') {
  let env;
  try {
    env = JSON.parse(raw);
  } catch {
    throw new Error(`${label}: respuesta no-JSON de orca (${String(raw).slice(0, 120)})`);
  }
  if (!env || env.ok !== true) {
    const code = env?.error?.code || 'unknown_error';
    const message = String(env?.error?.message || '').slice(0, 200);
    throw new Error(`${label} failed: ${code}${message ? ` — ${message}` : ''}`);
  }
  return env.result ?? {};
}

/**
 * `run(args + --json)` + `unwrapEnvelope`.
 * @param {string[]} args
 * @param {{ timeoutMs?: number, logger?: any }} [opts]
 * @returns {Promise<any>}
 */
async function runJson(args, opts = {}) {
  const raw = await run([...args, '--json'], opts);
  return unwrapEnvelope(raw, `orca ${args.join(' ')}`);
}

/**
 * Normaliza un `workspace_ref` de kodo al selector `--worktree` de orca. PURA.
 * kodo persiste el ref DESNUDO (`<repoId>::<path>`); orca quiere `id:<ref>`.
 * Idempotente: un ref que ya trae un prefijo de selector conocido se respeta tal cual
 * (permite pasar `active`, `path:/x`, `name:foo` desde tests o uso manual).
 *
 * @param {string} ref
 * @returns {string}
 */
export function worktreeSelector(ref) {
  const s = String(ref ?? '').trim();
  if (s === 'active' || s === 'current') return s;
  if (/^(id|name|path|branch|issue|folder|worktree):/.test(s)) return s;
  return `id:${s}`;
}

/**
 * Extrae el path del checkout de un `workspace_ref` de Orca. PURA.
 *
 * El ref es `<repoId>::<absPath>` y el repoId es un UUID, así que el PRIMER `::` es
 * siempre el separador — un path que contuviera `::` no rompe el split.
 *
 * Existe porque `worktree_path` de `state.json` tiene DOS consumidores con necesidades
 * opuestas: el cleanup destructivo (que NO debe correr sobre un worktree de Orca — lo
 * creó Orca, es el workspace del operador) y la resolución de «dónde vive el código de
 * esta sesión» (dashboard/plan.js: `worktree_path ?? project_path`), que SÍ tiene que
 * apuntar al checkout real o el overlay de progreso GSD lee el `.planning/` del repo
 * principal en vez del de la sesión. Dejar el campo vacío satisfacía al primero y rompía
 * al segundo; se rellena, y el cleanup se cierra con su propia guarda por host.
 *
 * @param {string} ref
 * @returns {string|null} path absoluto, o null si el ref no tiene el shape esperado.
 */
export function workspacePathFromRef(ref) {
  const s = String(ref ?? '');
  const i = s.indexOf('::');
  if (i === -1) return null;
  const path = s.slice(i + 2);
  return path.startsWith('/') ? path : null;
}

/**
 * Convierte un nombre humano de workspace kodo (`"KODO-18: Añadir Orca …"`) en un
 * `--name` válido para `orca worktree create`. PURA.
 *
 * Necesario porque, a diferencia de cmux (donde el nombre es solo un título de tab),
 * en Orca el `--name` se materializa como RAMA git (`<user>/<name>`): espacios, `:`,
 * acentos y `..` la romperían. El nombre humano se restituye después vía
 * `rename()` (`worktree set --display-name`), que sí acepta texto libre.
 *
 * - NFD + strip de diacríticos (`Añadir` → `Anadir`), lowercase.
 * - Cualquier run de caracteres fuera de `[a-z0-9]` colapsa a un solo `-`.
 * - Sin `-` de borde; truncado a 48 chars (los refs de tarea caben de sobra).
 * - Entrada degenerada (vacía, solo símbolos, no-string) → `'kodo-session'`.
 *
 * @param {any} name
 * @returns {string}
 */
export function slugifyWorktreeName(name) {
  const slug = String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // marcas diacríticas combinantes (post-NFD)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'kodo-session';
}

/**
 * Construye el argv determinista de `worktree create` (PURA, sin I/O) — espejo de
 * `buildNewWorkspaceArgs` de cmux. Orden estable de flags.
 *
 * `--no-parent`: kodo lanza cada tarea como trabajo INDEPENDIENTE; sin esta flag Orca
 * infiere el worktree padre del cwd del daemon y encadena las sesiones entre sí.
 * `--setup inherit` (el default de Orca) se deja implícito: respeta la política de
 * hooks que el operador haya configurado por repo.
 *
 * @param {{ name: string, cwd: string, baseBranch?: string }} opts
 * @returns {string[]}
 */
export function buildCreateWorktreeArgs(opts) {
  const args = ['worktree', 'create', '--repo', `path:${opts.cwd}`, '--name', slugifyWorktreeName(opts.name), '--no-parent'];
  if (opts.baseBranch) args.push('--base-branch', opts.baseBranch);
  return args;
}

/**
 * Elige el terminal al que kodo debe teclear dentro de un worktree. PURA.
 *
 * Preferencia (de más a menos deseable):
 *   1. conectado, escribible y NO huérfano — el shell vivo que Orca abre al crear el
 *      worktree (es a ese al que va el comando de claude),
 *   2. cualquiera conectado (un pty reatachado tras reiniciar la app),
 *   3. el primero de la lista.
 *
 * Defensiva/never-throws ante shapes inesperados: devuelve `null` si no hay candidato
 * con `handle` string.
 *
 * @param {any} listResult - `result` de `terminal list --json`.
 * @returns {string|null} handle (`term_…`) o null.
 */
export function pickTerminalHandle(listResult) {
  const terminals = Array.isArray(listResult?.terminals) ? listResult.terminals : [];
  const usable = terminals.filter((t) => t && typeof t.handle === 'string' && t.handle);
  const pick =
    usable.find((t) => t.connected === true && t.writable === true && t.orphaned !== true) ||
    usable.find((t) => t.connected === true) ||
    usable[0];
  return pick ? pick.handle : null;
}

/**
 * Resuelve el handle del terminal activo de un workspace. Se resuelve EN CADA
 * llamada (no se cachea): los handles son runtime-scoped y Orca los invalida al
 * reiniciar (`terminal_handle_stale`) — un cache los convertiría en fallos duros.
 *
 * @param {string} ref - workspace_ref de kodo.
 * @returns {Promise<string>}
 * @throws {Error} si el worktree no tiene ningún terminal utilizable.
 */
async function resolveTerminalHandle(ref) {
  const result = await runJson(['terminal', 'list', '--worktree', worktreeSelector(ref)]);
  const handle = pickTerminalHandle(result);
  if (!handle) throw new Error(`orca terminal list: sin terminal utilizable en ${ref}`);
  return handle;
}

/**
 * Registra el repo en Orca. IDEMPOTENTE (verificado en vivo): añadir un path ya
 * registrado devuelve `ok:true` con el repo existente, no un error.
 * `worktree create --repo path:<cwd>` exige que el repo esté registrado, así que
 * kodo lo asegura antes de cada creación.
 *
 * @param {string} path - path absoluto del repo.
 * @returns {Promise<string|null>} repoId, o null si el shape no lo trae.
 */
export async function addRepo(path) {
  const result = await runJson(['repo', 'add', '--path', path]);
  const id = result?.repo?.id;
  return typeof id === 'string' ? id : null;
}

/**
 * Crea un workspace (worktree Orca) para una sesión kodo.
 *
 * Espejo semántico de `cmux.newWorkspace`, con UNA diferencia material que el caller
 * debe conocer: Orca materializa un CHECKOUT GIT PROPIO en `~/orca/workspaces/<repo>/<slug>`,
 * no una tab sobre `cwd`. Por eso `src/session/manager.js` omite `claude --worktree`
 * cuando el host es orca — el aislamiento ya lo da Orca y anidarlo desalinearía
 * `worktree_path`.
 *
 * `group` se IGNORA (Orca no tiene grupos de workspace; ver `listWorkspaceGroups`).
 * `command`, si viene, se lanza en un terminal adicional — kodo no lo usa hoy (teclea
 * el comando de claude vía `send`), pero se honra por fidelidad con la firma cmux.
 *
 * Colisión de nombre: la rama `<user>/<slug>` puede existir ya (relanzar una tarea
 * cerrada cuyo worktree Orca sigue vivo). Un único reintento con sufijo numérico libre
 * la salva; un segundo fallo propaga (mismo criterio que el fallback de `--group` de cmux).
 *
 * @param {{ name: string, cwd?: string, command?: string, group?: string }} opts
 * @returns {Promise<string>} workspace_ref (`<repoId>::<absPath>`)
 */
export async function newWorkspace(opts) {
  const cwd = opts.cwd;
  if (!cwd) throw new Error('orca newWorkspace: `cwd` es obligatorio (Orca crea el checkout desde el repo)');
  await addRepo(cwd);

  let result;
  try {
    result = await runJson(buildCreateWorktreeArgs({ name: opts.name, cwd }), { timeoutMs: CREATE_TIMEOUT_MS });
  } catch (err) {
    // Capa 2: nombre ocupado → reintento ÚNICO con el primer sufijo libre.
    const fallbackName = await nextFreeName(opts.name, cwd);
    if (!fallbackName) throw err;
    result = await runJson(buildCreateWorktreeArgs({ name: fallbackName, cwd }), { timeoutMs: CREATE_TIMEOUT_MS });
  }

  const ref = result?.worktree?.id;
  if (typeof ref !== 'string' || !ref) {
    throw new Error('orca worktree create: la respuesta no trae worktree.id');
  }

  // El nombre humano (con `:`, espacios y acentos) NO cabe en la rama git; se restituye
  // como display-name para que la tarjeta de Orca muestre lo mismo que la tab de cmux.
  await rename({ workspace: ref, title: opts.name }).catch(() => {});

  if (opts.command) {
    await runJson(['terminal', 'create', '--worktree', worktreeSelector(ref), '--command', opts.command]);
  }
  return ref;
}

/**
 * Calcula el primer `<slug>-N` libre a partir de los worktrees ya registrados en Orca.
 * Devuelve `null` si no hay hueco en los 9 primeros intentos (el caller propaga el
 * error original en vez de insistir).
 *
 * @param {string} name - nombre humano original.
 * @param {string} cwd - path del repo (para acotar el listado).
 * @returns {Promise<string|null>}
 */
async function nextFreeName(name, cwd) {
  const base = slugifyWorktreeName(name);
  let taken = new Set();
  try {
    const result = await runJson(['worktree', 'list', '--repo', `path:${cwd}`]);
    const worktrees = Array.isArray(result?.worktrees) ? result.worktrees : [];
    taken = new Set(
      worktrees
        .map((w) => (typeof w?.path === 'string' ? w.path.split('/').pop() : null))
        .filter((s) => typeof s === 'string'),
    );
  } catch {
    // Sin listado no podemos elegir con criterio → que el caller propague el error real.
    return null;
  }
  for (let n = 2; n <= 9; n++) {
    const candidate = `${base}-${n}`.slice(0, 48).replace(/-+$/g, '');
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Quita el escape `\n` LITERAL (barra invertida + n) del final de un payload de
 * keystroke. PURA.
 *
 * Existe porque los call sites COMPARTIDOS con cmux (el nudge al orquestador de
 * `hooks/stop.js` y `session/manager.js`) rematan su texto con `\\n`: es la convención
 * de `cmux send`, que lo interpreta como Enter. Orca expone Enter como flag (`--enter`),
 * así que ese sufijo llegaría al terminal como DOS caracteres imprimibles. Se normaliza
 * aquí, en el adapter, en vez de ramificar por host en los call sites.
 *
 * Solo el sufijo: un `\n` literal en medio del texto es contenido y se respeta.
 *
 * @param {any} text
 * @returns {string}
 */
export function stripTrailingNewlineEscape(text) {
  return String(text ?? '').replace(/\\n$/, '');
}

/**
 * Teclea texto en el terminal activo del workspace.
 *
 * A diferencia de cmux (que interpreta un `\n` literal al final del payload), Orca
 * expone la pulsación de Enter como flag: `--enter`.
 *
 * @param {{ workspace: string, text: string }} opts
 * @returns {Promise<any>}
 */
export async function send(opts) {
  const handle = await resolveTerminalHandle(opts.workspace);
  const text = stripTrailingNewlineEscape(opts.text);
  return runJson(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
}

/**
 * Lee el tail del terminal activo del workspace y lo devuelve como texto plano —
 * mismo shape de retorno que `cmux.readScreen` (los consumidores, p. ej. el
 * `detectIdle` de `session/health.js`, esperan un string con saltos de línea).
 *
 * @param {{ workspace: string, lines?: number }} opts
 * @returns {Promise<string>}
 */
export async function readScreen(opts) {
  const handle = await resolveTerminalHandle(opts.workspace);
  const args = ['terminal', 'read', '--terminal', handle];
  if (opts.lines) args.push('--limit', String(opts.lines));
  const result = await runJson(args);
  const tail = result?.terminal?.tail;
  return Array.isArray(tail) ? tail.join('\n') : '';
}

/**
 * Traduce un estado semántico de kodo al id de columna del tablero de Orca.
 * PURA. Los ids por defecto de Orca son `todo` / `in-progress` / `in-review` /
 * `completed`; un tablero con columnas personalizadas se ajusta desde
 * `~/.kodo/config.json` → `orca.statuses`.
 *
 * @param {'running'|'done'|'error'|'review'} status
 * @param {Record<string,string>} [statuses] - mapa de config; default el de loadConfig.
 * @returns {string}
 */
export function statusForState(status, statuses) {
  const map = statuses || loadConfig().orca?.statuses || {};
  return map[status] || 'in-progress';
}

/**
 * Equivalente de `cmux.setColor`: refleja el estado de la sesión en la TARJETA de Orca.
 * Orca no tiene colores por workspace; el canal equivalente es la columna del tablero.
 *
 * @param {{ workspace: string, status: 'running'|'done'|'error'|'review' }} opts
 * @returns {Promise<any>}
 */
export async function setStatus(opts) {
  return runJson([
    'worktree', 'set',
    '--worktree', worktreeSelector(opts.workspace),
    '--workspace-status', statusForState(opts.status),
  ]);
}

/**
 * Equivalente de `cmux.setDescription`: el comentario de la tarjeta de Orca es el
 * canal de "qué está pasando aquí" que el operador ve en la lista de workspaces.
 *
 * @param {{ workspace: string, description: string }} opts
 * @returns {Promise<any>}
 */
export async function setDescription(opts) {
  return runJson(['worktree', 'set', '--worktree', worktreeSelector(opts.workspace), '--comment', opts.description]);
}

/**
 * @param {{ workspace: string, title: string }} opts
 * @returns {Promise<any>}
 */
export async function rename(opts) {
  return runJson(['worktree', 'set', '--worktree', worktreeSelector(opts.workspace), '--display-name', opts.title]);
}

/**
 * Trae el foco de la app al workspace (equivalente de `runFocus` de cmux). Orca
 * enfoca por TERMINAL, no por worktree, así que se resuelve antes su handle.
 *
 * @param {{ workspace: string }} opts
 * @returns {Promise<any>}
 */
export async function focusWorkspace(opts) {
  const handle = await resolveTerminalHandle(opts.workspace);
  return runJson(['terminal', 'switch', '--terminal', handle]);
}

/**
 * Serializa la lista de workspaces al MISMO shape de texto plano que `cmux
 * workspace list` (`<ref>  <título>` por línea). PURA.
 *
 * No es cosmético: `session/health.js` decide si un workspace sigue existiendo con
 * `workspaceList.includes(session.workspace_ref)` sobre este string. Emitir el ref
 * literal preserva ese contrato sin tocar el consumidor.
 *
 * @param {any} psResult - `result` de `worktree ps --json`.
 * @returns {string}
 */
export function formatWorkspaceList(psResult) {
  const worktrees = Array.isArray(psResult?.worktrees) ? psResult.worktrees : [];
  return worktrees
    .filter((w) => w && typeof w.worktreeId === 'string')
    .map((w) => `${w.worktreeId}  ${typeof w.displayName === 'string' ? w.displayName : ''}`.trimEnd())
    .join('\n');
}

/**
 * @returns {Promise<string>} texto plano `<ref>  <título>` (espejo de `cmux workspace list`)
 */
export async function listWorkspaces() {
  return formatWorkspaceList(await runJson(['worktree', 'ps']));
}

/**
 * Passthrough read-only de `worktree ps --json`. Devuelve el stdout CRUDO (sin
 * parsear) — el parseo defensivo vive en `src/host/orca.js`, igual que en el
 * carril cmux.
 * @returns {Promise<string>}
 */
export async function listWorkspacesJson() {
  return run(['worktree', 'ps', '--json']);
}

/**
 * Traduce la salida de `worktree ps` al SHAPE DE ÁRBOL de `cmux tree --all --json`
 * (`{windows:[{workspaces:[{id,ref,title}]}]}`). PURA.
 *
 * Existe para que el carril de identidad del orquestador (`findWorkspaceInTree`,
 * `verifyRegisteredOrchestrator`) funcione sin ramificar por host. Ese carril nació
 * resolviendo un problema EXCLUSIVO de cmux —los `workspace:N` se reciclan, así que la
 * identidad estable es un UUID aparte, y `workspace list` es window-scoped— pero la
 * PREGUNTA que responde («¿sigue vivo el workspace que registré?») es universal.
 *
 * En Orca el ref `<repoId>::<path>` YA es identidad estable y `worktree ps` YA es
 * cross-window, así que `id` y `ref` se emiten IGUALES: el match por UUID del carril
 * degrada a un match por ref que aquí es exacto, no una heurística.
 *
 * Un único "window" sintético: Orca no tiene ese eje y el consumidor solo recorre.
 *
 * @param {any} psResult - `result` de `worktree ps --json`.
 * @returns {{windows: {workspaces: {id: string, ref: string, title: string|null}[]}[]}}
 */
export function buildTreeFromPs(psResult) {
  const worktrees = Array.isArray(psResult?.worktrees) ? psResult.worktrees : [];
  const workspaces = worktrees
    .filter((w) => w && typeof w.worktreeId === 'string')
    .map((w) => ({
      id: w.worktreeId, // en Orca el ref ES la identidad estable — no hay UUID aparte
      ref: w.worktreeId,
      title: typeof w.displayName === 'string' ? w.displayName : null,
    }));
  return { windows: [{ workspaces }] };
}

/**
 * Equivalente de `cmux.listTree()`: vista cross-window para la revalidación de
 * identidad del orquestador. Devuelve JSON serializado (mismo contrato de retorno que
 * su hermano cmux: el caller hace el `JSON.parse`).
 * @returns {Promise<string>} JSON en el shape de `cmux tree --all --json`
 */
export async function listTree() {
  return JSON.stringify(buildTreeFromPs(await runJson(['worktree', 'ps'])));
}

/**
 * Passthrough read-only de `terminal list --json`, opcionalmente acotado a un
 * workspace. Crudo, sin parsear.
 * @param {{ workspace?: string }} [opts]
 * @returns {Promise<string>}
 */
export async function listTerminalsJson(opts = {}) {
  const args = ['terminal', 'list'];
  if (opts.workspace) args.push('--worktree', worktreeSelector(opts.workspace));
  args.push('--json');
  return run(args);
}

/**
 * NO-OP deliberado. Orca no expone notificaciones de sistema en su CLI (verificado
 * contra `orca agent-context`: 228 comandos, ninguno `notify`). Se resuelve en vacío
 * para que el launch path compartido con cmux no necesite una rama por host — el
 * mismo criterio fail-open que ya aplica el caller (`.catch(() => {})`).
 * @param {{ title: string, body?: string, workspace?: string }} _opts
 * @returns {Promise<null>}
 */
export async function notify(_opts) {
  return null;
}

/**
 * NO-OP deliberado. Orca organiza los workspaces por LINAJE (parent/child, folders),
 * no por grupos nombrados como el sidebar de cmux. Devolver un listado vacío hace que
 * `resolveWorkspaceGroup` (session/manager.js) no matchee y la sesión se lance sin
 * `--group` — exactamente la rama fail-open que ese código ya contempla.
 * @returns {Promise<string>} `'{"groups":[]}'`
 */
export async function listWorkspaceGroups() {
  return '{"groups":[]}';
}
