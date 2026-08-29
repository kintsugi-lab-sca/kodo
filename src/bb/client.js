// @ts-check
// src/bb/client.js
// Cliente del binario `bb` (get-bb/bb) — tercer hermano de `src/cmux/client.js` y
// `src/orca/client.js` (KODO-31).
//
// Confinamiento: igual que sus hermanos, este módulo SOLO debe consumirse desde
// `src/host/bb.js`. El walker `test/host/bb-isolation.test.js` lo vigila.
//
// Diferencias de contrato frente a cmux y orca — TODAS verificadas EN VIVO contra una
// instancia real de bb-app (servidor en 127.0.0.1:38886), no inferidas de la doc:
//
//   - SIN SOBRE. A diferencia de orca (`{id, ok, result, error}`), `bb … --json` imprime
//     el payload DESNUDO: `thread list --json` es un array plano, `thread show --json` un
//     objeto `{thread, environment, pendingTodos}`. Un fallo NO viaja como `ok:false`:
//     el CLI sale con código ≠ 0 y escribe el motivo en stderr. Por eso aquí no hay
//     `unwrapEnvelope` — el equivalente es el exit code, que `run` ya convierte en throw.
//
//   - BB NO ES UN TERMINAL. No lanza un shell donde teclear `claude …`: arranca Claude
//     Code por el Agent SDK. El prompt viaja ENTERO en `thread spawn --prompt`, y el
//     `--session-id` lo genera BB, no kodo. Consecuencias: (1) no hay carril de
//     keystrokes — `send` es `thread tell`, para mensajes POSTERIORES al primero; (2) la
//     correlación sesión↔tarea la cierra el fallback por `BB_THREAD_ID` de
//     `hooks/session-start.js`, no el `--session-id` que kodo generó.
//
//   - IDENTIDAD ESTABLE. El ref es el id del thread (`thr_…`) y BB no lo recicla, igual
//     que el `<repoId>::<path>` de orca y al contrario que los `workspace:N` de cmux.
//
//   - SIN COLOR NI COLUMNA. BB no tiene canal de presentación por estado (ni color de
//     tab como cmux ni columna de tablero como orca), así que `setStatus`/`setColor`
//     degradan a no-op fail-open — misma postura que `notify` en orca.
//
// El binario habla con el servidor de BB por HTTP; la URL sale de `BB_SERVER_URL`, que
// este cliente inyecta en el entorno del hijo desde `~/.kodo/config.json` → `bb.server_url`.
import { execFile } from 'node:child_process';
import { loadConfig } from '../config.js';

/** Timeout por defecto. Como orca (20s): el binario habla con el servidor de BB por HTTP. */
const TIMEOUT_MS = 20_000;
/** `thread spawn --new-environment worktree` materializa un checkout git — necesita aire. */
const SPAWN_TIMEOUT_MS = 120_000;

function getBbBinary() {
  return loadConfig().bb?.binary || 'bb';
}

function getServerUrl() {
  return loadConfig().bb?.server_url || 'http://127.0.0.1:38886';
}

/**
 * Entorno del proceso hijo. `BB_SERVER_URL` se fija SIEMPRE desde la config de kodo para
 * que el daemon no dependa de qué exportó la shell del operador.
 *
 * Se LIMPIAN además `BB_THREAD_ID` / `BB_ENVIRONMENT_ID`: cuando el propio kodo corre
 * DENTRO de un thread de BB (el caso normal cuando el orquestador vive ahí), esas
 * variables están puestas y los subcomandos que aceptan `--self` o infieren el thread
 * actual apuntarían al thread del orquestador en vez de al que se le pasa por argumento.
 * kodo siempre pasa el id explícito, así que heredarlas solo puede hacer daño.
 *
 * @returns {NodeJS.ProcessEnv}
 */
function childEnv() {
  const env = { ...process.env, BB_SERVER_URL: getServerUrl() };
  delete env.BB_THREAD_ID;
  delete env.BB_ENVIRONMENT_ID;
  return env;
}

/**
 * Ejecuta el binario bb y devuelve stdout recortado. Sin shell (execFile): cada argumento
 * viaja como elemento de array, jamás interpolado — mismo invariante anti-inyección que
 * `buildNewWorkspaceArgs` (cmux) y `buildCreateWorktreeArgs` (orca).
 *
 * @param {string[]} args
 * @param {{ timeoutMs?: number, logger?: any }} [opts]
 * @returns {Promise<string>}
 */
function run(args, opts = {}) {
  const timeout = opts.timeoutMs || TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    opts.logger?.debug?.('bb.exec', { cmd: args[0], argc: args.length });
    execFile(
      getBbBinary(),
      args,
      { timeout, maxBuffer: 8 * 1024 * 1024, env: childEnv() },
      (err, stdout, stderr) => {
        if (err) {
          opts.logger?.warn?.('bb.fail', { cmd: args[0], stderr: String(stderr || '').slice(0, 200) });
          reject(new Error(`bb ${args[0]} failed: ${stderr || err.message}`));
          return;
        }
        resolve(String(stdout).trim());
      },
    );
  });
}

/**
 * Parsea el stdout JSON de bb. PURA (sin I/O) para poder testearla directa.
 *
 * No hay sobre que desempaquetar (ver la cabecera): el payload es el JSON entero. Esta
 * función existe solo para dar un mensaje de error DIAGNOSTICABLE cuando el stdout no es
 * JSON — el caso real es un binario que imprime un aviso de actualización antes del
 * payload, o un `bb` que no es el que creemos.
 *
 * @param {string} raw - stdout crudo del binario.
 * @param {string} label - etiqueta del comando para el mensaje de error.
 * @returns {any}
 * @throws {Error} si el stdout no es JSON.
 */
export function parseJson(raw, label = 'bb') {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label}: respuesta no-JSON de bb (${String(raw).slice(0, 120)})`);
  }
}

/**
 * `run(args + --json)` + `parseJson`.
 * @param {string[]} args
 * @param {{ timeoutMs?: number, logger?: any }} [opts]
 * @returns {Promise<any>}
 */
async function runJson(args, opts = {}) {
  const raw = await run([...args, '--json'], opts);
  return parseJson(raw, `bb ${args.join(' ')}`);
}

/**
 * Traduce las flags de kodo al `--permission-mode` de BB. PURA.
 *
 * MISMO criterio que `buildClaudeCommand` usa para decidir `--dangerously-skip-permissions`:
 * cualquier modo GSD corre slash commands autónomos, así que pedir confirmación por tool
 * call rompe la automatización — y `kodo:yolo` es la petición explícita de lo mismo. El
 * resto de sesiones va a `accept-edits`, que en BB deja pasar las ediciones de fichero
 * pero sigue preguntando por lo demás.
 *
 * Los tres modos que BB acepta (verificado en `bb provider list --json` →
 * `capabilities.permissionModes` de `claude-code`) son `accept-edits` · `auto` · `full`.
 *
 * @param {boolean} skipPermissions - true si la sesión es yolo o GSD.
 * @returns {'full'|'accept-edits'}
 */
export function permissionModeFor(skipPermissions) {
  return skipPermissions ? 'full' : 'accept-edits';
}

/**
 * Construye el argv determinista de `thread spawn` (PURA, sin I/O) — hermano de
 * `buildNewWorkspaceArgs` (cmux) y `buildCreateWorktreeArgs` (orca). Orden estable.
 *
 * `--new-environment worktree` es la razón por la que `bb` entra en
 * `HOSTS_WITH_OWN_WORKTREE`: BB materializa su propio checkout git y kodo NO debe emitir
 * además `claude --worktree` (anidaría un segundo worktree y desalinearía `worktree_path`).
 *
 * `--provider claude-code` es fijo: kodo sabe leer los hooks de Claude Code y NADA más
 * (el ciclo entero —contexto de sesión, Stop, SessionEnd— cuelga de ellos). Los otros
 * providers de BB (codex, cursor, pi) quedan fuera de alcance a propósito.
 *
 * `--prompt` y `--project` son OBLIGATORIOS en el CLI de BB (verificado: son
 * `requiredOption`), así que se emiten siempre; el resto solo si viene valor.
 *
 * @param {{ projectId: string, prompt: string, title?: string, model?: string,
 *           permissionMode?: string, baseBranch?: string }} opts
 * @returns {string[]}
 */
export function buildSpawnArgs(opts) {
  const args = [
    'thread', 'spawn',
    '--project', opts.projectId,
    '--new-environment', 'worktree',
    '--provider', 'claude-code',
    '--prompt', opts.prompt,
  ];
  if (opts.title) args.push('--title', opts.title);
  if (opts.model) args.push('--model', opts.model);
  if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode);
  if (opts.baseBranch) args.push('--base-branch', opts.baseBranch);
  return args;
}

/**
 * Busca en un listado de proyectos de BB el que tiene una source apuntando a `path`. PURA.
 *
 * El match es por igualdad EXACTA del path, no por prefijo: dos repos anidados
 * (`~/dev/foo` y `~/dev/foo/packages/bar`) son proyectos distintos en BB y un match por
 * prefijo lanzaría las sesiones del hijo dentro del padre.
 *
 * Defensiva (never-throws): filas o sources con shape inesperado se omiten.
 *
 * @param {any} projects - salida ya parseada de `bb project list --json` (array plano).
 * @param {string} path - path absoluto del repo.
 * @returns {string|null} project id, o null si ninguno matchea.
 */
export function findProjectIdByPath(projects, path) {
  const list = Array.isArray(projects) ? projects : [];
  const target = String(path ?? '');
  if (!target) return null;
  for (const p of list) {
    if (!p || typeof p.id !== 'string') continue;
    const sources = Array.isArray(p.sources) ? p.sources : [];
    if (sources.some((s) => s && s.path === target)) return p.id;
  }
  return null;
}

/**
 * Resuelve (y crea si hace falta) el proyecto de BB que corresponde al repo de kodo.
 *
 * SIN CACHÉ, y es una decisión, no un olvido. La ficha proponía cachear la resolución en
 * `~/.kodo/projects.json` o equivalente, pero una caché aquí solo ahorra algo si se
 * CONFÍA en ella sin revalidar — y un id de proyecto borrado desde la app de BB haría
 * fallar todo `thread spawn` posterior con un error que no apunta a la causa. Revalidarla
 * exige el mismo `project list` que se quería evitar, así que la caché queda en un
 * fichero más, un modo de fallo más y cero ahorro. Esta llamada corre UNA vez por
 * LANZAMIENTO (no en el bucle de reconcile) y va contra loopback.
 *
 * @param {string} projectPath - path absoluto del repo (el `project_path` de kodo).
 * @param {{ logger?: any }} [opts]
 * @returns {Promise<string>} project id de BB.
 */
export async function resolveProjectId(projectPath, opts = {}) {
  const path = String(projectPath ?? '');
  if (!path) throw new Error('bb resolveProjectId: `projectPath` es obligatorio');

  const found = findProjectIdByPath(await runJson(['project', 'list'], opts), path);
  if (found) return found;

  // Sin proyecto registrado para este repo → se crea. `--name` es el basename del path
  // (lo mismo que muestra la app), `--root` la source local.
  const name = path.split('/').filter(Boolean).pop() || 'kodo';
  const created = await runJson(['project', 'create', '--name', name, '--root', path], opts);
  const id = created?.id;
  if (typeof id !== 'string' || !id) {
    throw new Error('bb project create: la respuesta no trae id');
  }
  return id;
}

/**
 * Crea un thread de BB sobre un worktree nuevo para una sesión de kodo.
 *
 * Espejo semántico de `cmux.newWorkspace` / `orca.newWorkspace`, con UNA diferencia
 * material que el caller ya conoce (ver `hostDeliversPrompt` en `host/interface.js`): el
 * PROMPT viaja aquí, en el spawn, no en un `send` posterior. BB no abre un shell donde
 * teclear `claude …` — arranca Claude Code por el Agent SDK con el prompt como primer
 * mensaje del thread.
 *
 * `group` se IGNORA (BB organiza por secciones, no por grupos de sidebar; ver
 * `listWorkspaceGroups`). `command` se ignora también: no hay terminal donde lanzarlo.
 *
 * @param {{ name: string, cwd?: string, prompt?: string, model?: string,
 *           skipPermissions?: boolean, command?: string, group?: string }} opts
 * @returns {Promise<string>} workspace_ref (id del thread, `thr_…`)
 */
export async function newWorkspace(opts) {
  const cwd = opts.cwd;
  if (!cwd) throw new Error('bb newWorkspace: `cwd` es obligatorio (BB crea el worktree desde el repo)');
  const prompt = String(opts.prompt ?? '').trim();
  if (!prompt) throw new Error('bb newWorkspace: `prompt` es obligatorio (bb thread spawn lo exige)');

  const projectId = await resolveProjectId(cwd);
  const thread = await runJson(
    buildSpawnArgs({
      projectId,
      prompt,
      title: opts.name,
      model: opts.model,
      permissionMode: permissionModeFor(!!opts.skipPermissions),
    }),
    { timeoutMs: SPAWN_TIMEOUT_MS },
  );

  const ref = thread?.id;
  if (typeof ref !== 'string' || !ref) {
    throw new Error('bb thread spawn: la respuesta no trae thread.id');
  }
  return ref;
}

/**
 * Path del checkout que BB materializó para este thread.
 *
 * `environment.path` es el campo (VERIFICADO en vivo contra `thread show --json`; era una
 * de las dos incógnitas abiertas de la ficha). Se devuelve el path REAL de BB, sin
 * derivarlo ni añadirle `.bg-shell`: `worktree_path` significa «dónde vive el código de
 * esta sesión» y es lo que consume `worktree_path ?? project_path` en el overlay de
 * progreso del dashboard.
 *
 * @param {string} ref - id del thread.
 * @returns {Promise<string|null>} path absoluto, o null si BB no lo publica.
 */
export async function workspacePathFromRef(ref) {
  const shown = await runJson(['thread', 'show', ref]);
  const path = shown?.environment?.path;
  return typeof path === 'string' && path.startsWith('/') ? path : null;
}

/**
 * Envía un mensaje de seguimiento al thread (`thread tell`).
 *
 * NO es el carril del primer prompt (eso va en `newWorkspace`): esto cubre los mensajes
 * POSTERIORES — el nudge del orquestador, un `kodo comment`. Sobre un thread parado,
 * `tell` lo REANUDA (verificado: dispara `SessionStart` con `source=resume` y el mismo
 * session_id), que es justo lo que la reapertura tras el autocierre necesita.
 *
 * `stripTrailingNewlineEscape`: los call sites compartidos con cmux rematan su texto con
 * un `\n` LITERAL porque `cmux send` lo interpreta como Enter. BB recibe un mensaje, no
 * pulsaciones, así que ese sufijo llegaría como dos caracteres imprimibles. Se normaliza
 * aquí, en el adapter, en vez de ramificar por host en los call sites — misma decisión
 * que tomó `src/orca/client.js`.
 *
 * @param {{ workspace: string, text: string }} opts
 * @returns {Promise<any>}
 */
export async function send(opts) {
  return runJson(['thread', 'tell', opts.workspace, stripTrailingNewlineEscape(opts.text)]);
}

/**
 * Quita el escape `\n` LITERAL (barra invertida + n) del final de un payload. PURA.
 * Solo el sufijo: un `\n` literal en medio del texto es contenido y se respeta.
 * @param {any} text
 * @returns {string}
 */
export function stripTrailingNewlineEscape(text) {
  return String(text ?? '').replace(/\\n$/, '');
}

/**
 * Para el thread y libera el runtime del agente (`thread stop`).
 *
 * Es el verbo del AUTOCIERRE (`session/reconcile.js`): BB deja el thread en `idle` con el
 * proceso `claude` VIVO cuando el turno termina, así que sin este `stop` el hook
 * `SessionEnd` no dispara nunca y la sesión se queda colgada en el tablero de kodo.
 *
 * NO es destructivo: no archiva el thread ni toca el worktree — solo suelta el runtime.
 * `thread tell` lo reanuda después. El archivado, que sí es una decisión del humano,
 * NO se cablea aquí (ver el guard del walker de aislamiento).
 *
 * @param {{ workspace: string }} opts
 * @returns {Promise<any>}
 */
export async function close(opts) {
  return runJson(['thread', 'stop', opts.workspace]);
}

/**
 * Trae el foco de la app de BB al thread (`thread open`). Equivalente de `runFocus`
 * (cmux) y `focusWorkspace` (orca).
 * @param {{ workspace: string }} opts
 * @returns {Promise<any>}
 */
export async function focusWorkspace(opts) {
  return runJson(['thread', 'open', opts.workspace]);
}

/**
 * Lee el log del thread como texto plano — mismo shape de retorno que
 * `cmux.readScreen` / `orca.readScreen` (los consumidores, p. ej. el `detectIdle` de
 * `session/health.js` y la puerta de idle de `orchestrator/notify.js`, esperan un string
 * con saltos de línea).
 *
 * Se usa `--format minimal` (el default de BB): una línea de tiempo compacta y legible,
 * que es lo más parecido a «lo que se ve en pantalla». El `--limit` de BB solo aplica al
 * formato json, así que el recorte a `lines` se hace aquí, quedándose con la COLA (lo
 * último, que es lo que un lector de pantalla quiere ver).
 *
 * @param {{ workspace: string, lines?: number }} opts
 * @returns {Promise<string>}
 */
export async function readScreen(opts) {
  const out = await run(['thread', 'log', opts.workspace, '--format', 'minimal']);
  if (!opts.lines) return out;
  return out.split('\n').slice(-opts.lines).join('\n');
}

/**
 * Serializa la lista de threads al MISMO shape de texto plano que `cmux workspace list`
 * (`<ref>  <título>` por línea). PURA.
 *
 * No es cosmético: `session/health.js` decide si un workspace sigue existiendo con
 * `workspaceList.includes(session.workspace_ref)` sobre este string. Emitir el ref
 * literal preserva ese contrato sin tocar el consumidor.
 *
 * @param {any} threads - salida ya parseada de `thread list --json`.
 * @returns {string}
 */
export function formatThreadList(threads) {
  const list = Array.isArray(threads) ? threads : [];
  return list
    .filter((t) => t && typeof t.id === 'string')
    .map((t) => `${t.id}  ${threadTitle(t) ?? ''}`.trimEnd())
    .join('\n');
}

/**
 * Título legible de un thread. PURA.
 *
 * `title` es el que kodo fija en el spawn (lleva el `task_ref`); `titleFallback` es el
 * que BB deriva del prompt cuando no hay título. Se prefiere el explícito.
 *
 * @param {any} t
 * @returns {string|undefined}
 */
export function threadTitle(t) {
  if (typeof t?.title === 'string' && t.title) return t.title;
  if (typeof t?.titleFallback === 'string' && t.titleFallback) return t.titleFallback;
  return undefined;
}

/** @returns {Promise<string>} texto plano `<ref>  <título>` (espejo de `cmux workspace list`) */
export async function listWorkspaces() {
  return formatThreadList(await runJson(['thread', 'list']));
}

/**
 * Passthrough read-only de `thread list --json`. Devuelve el stdout CRUDO (sin parsear)
 * — el parseo defensivo vive en `src/host/bb.js`, igual que en los carriles cmux y orca.
 * @returns {Promise<string>}
 */
export async function listWorkspacesJson() {
  return run(['thread', 'list', '--json']);
}

/**
 * Traduce el listado de threads al SHAPE DE ÁRBOL de `cmux tree --all --json`
 * (`{windows:[{workspaces:[{id,ref,title}]}]}`). PURA.
 *
 * Existe para que el carril de identidad del orquestador (`findWorkspaceInTree`,
 * `verifyRegisteredOrchestrator`) funcione sin ramificar por host. Ese carril nació
 * resolviendo un problema EXCLUSIVO de cmux (los `workspace:N` se reciclan, así que la
 * identidad estable es un UUID aparte), pero la PREGUNTA que responde —«¿sigue vivo el
 * workspace que registré?»— es universal.
 *
 * En BB el id del thread YA es identidad estable, así que `id` y `ref` se emiten IGUALES:
 * el match por UUID degrada a un match por ref que aquí es exacto, no una heurística.
 * Un único "window" sintético: BB no tiene ese eje y el consumidor solo recorre.
 *
 * @param {any} threads - salida ya parseada de `thread list --json`.
 * @returns {{windows: {workspaces: {id: string, ref: string, title: string|null}[]}[]}}
 */
export function buildTreeFromThreads(threads) {
  const list = Array.isArray(threads) ? threads : [];
  const workspaces = list
    .filter((t) => t && typeof t.id === 'string')
    .map((t) => ({ id: t.id, ref: t.id, title: threadTitle(t) ?? null }));
  return { windows: [{ workspaces }] };
}

/**
 * Equivalente de `cmux.listTree()`: vista cross-window para la revalidación de identidad
 * del orquestador. Devuelve JSON serializado (mismo contrato de retorno que sus hermanos:
 * el caller hace el `JSON.parse`).
 * @returns {Promise<string>} JSON en el shape de `cmux tree --all --json`
 */
export async function listTree() {
  return JSON.stringify(buildTreeFromThreads(await runJson(['thread', 'list'])));
}

/**
 * Diagnóstico para `kodo doctor`: ¿está el servidor de BB en pie y con el provider
 * `claude-code` disponible? never-throws — devuelve un informe, no lanza.
 *
 * Las DOS comprobaciones importan por separado: un servidor vivo con `claude-code`
 * ausente (binario `claude` no instalado en la máquina de BB) deja lanzar threads que
 * mueren al arrancar, y ese fallo es invisible desde kodo.
 *
 * `fetchFn` es DI para poder testear sin red.
 *
 * @param {{ fetchFn?: typeof fetch }} [deps]
 * @returns {Promise<{ serverUrl: string, serverUp: boolean, providerAvailable: boolean|null, detail?: string }>}
 */
export async function doctor(deps = {}) {
  const serverUrl = getServerUrl();
  const doFetch = deps.fetchFn || fetch;

  let serverUp = false;
  let detail;
  try {
    // CUALQUIER respuesta HTTP prueba lo que aquí se pregunta: que kodo ALCANZA el
    // servidor. No se mira `res.ok` — un 404 o un 500 en `/` significan «BB está ahí y
    // contesta», y tratarlos como caído mandaría al operador a arrancar un servidor que
    // ya está arrancado. Si BB está roto por dentro, lo delata el check del provider.
    const res = await doFetch(serverUrl, { signal: AbortSignal.timeout(3000) });
    serverUp = !!res;
  } catch (err) {
    detail = String(/** @type {any} */ (err)?.message || '').slice(0, 200);
  }

  // Sin servidor no se pregunta por el provider: el CLI fallaría por la misma causa y el
  // segundo error solo añadiría ruido al informe.
  if (!serverUp) return { serverUrl, serverUp, providerAvailable: null, detail };

  try {
    const providers = await runJson(['provider', 'list']);
    const list = Array.isArray(providers) ? providers : [];
    const claudeCode = list.find((p) => p && p.id === 'claude-code');
    return { serverUrl, serverUp, providerAvailable: claudeCode?.available === true };
  } catch (err) {
    return {
      serverUrl,
      serverUp,
      providerAvailable: null,
      detail: String(/** @type {any} */ (err)?.message || '').slice(0, 200),
    };
  }
}

/**
 * NO-OP deliberado. BB no expone notificaciones de sistema en su CLI. Se resuelve en
 * vacío para que el launch path compartido con cmux/orca no necesite una rama por host —
 * el mismo criterio fail-open que ya aplica el caller (`.catch(() => {})`).
 * @param {{ title: string, body?: string, workspace?: string }} _opts
 * @returns {Promise<null>}
 */
export async function notify(_opts) {
  return null;
}

/**
 * NO-OP deliberado. BB agrupa threads por SECCIONES (`thread section`), un eje que kodo no
 * modela hoy: el sidebar doctor crea grupos por proyecto y BB ya separa por proyecto de
 * forma nativa, así que no hay nada que converger. Devolver un listado vacío hace que
 * `resolveWorkspaceGroup` (session/manager.js) no matchee y la sesión se lance sin
 * `--group` — exactamente la rama fail-open que ese código ya contempla.
 * @returns {Promise<string>} `'{"groups":[]}'`
 */
export async function listWorkspaceGroups() {
  return '{"groups":[]}';
}
