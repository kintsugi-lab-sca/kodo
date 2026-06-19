// @ts-check
//
// src/cli/adopt.js — Action handler de `kodo adopt`.
//
// El PRIMER consumidor (y referencia de contrato) de la fontanería determinista
// 0-token `adoptSession` (Phase 53, src/adopt.js). Es un thin handler:
// argv → resolución provider/projectPath → delegación → render → exit code.
// Espejo estructural 1:1 de `runGsdVerifyCli` (src/cli/gsd-verify.js).
//
// Cero lógica de negocio nueva. La única lógica original del CLI es:
//   1. Resolver `provider`/`providerName` (registry) + `projectPath`
//      (loadProjects()[projectId], fail-fast si no mapeado — ANTES de cualquier POST).
//   2. El switch discriminante → exit code (D-02 / Opción A).
//   3. Los strings de render.
//
// Exit codes (D-02, espejo Opción A de gsd-verify):
//   0 = ok (task creada + fila sembrada) | ALREADY_ADOPTED (idempotente, no-op)
//   1 = INVALID_INPUT | UNSUPPORTED | PERSIST_FAILED (huérfano, LOUD, recuperable)
//   2 = CREATE_FAILED (POST falló — transient, retryable por script)
//
// Color isolation (LOCKED): el color sale SOLO de createFormatter de ./format.js.
// JAMAS se importa el paquete de color directamente (guard:
// test/format-isolation.test.js — single-source D-07).

import { adoptSession } from '../adopt.js';
import { createFormatter } from './format.js';
// NOTE: provider + projectPath resolution se lazy-importa DENTRO del handler
// (espejo gsd-verify.js DI + el bloque launch src/cli.js:212-217) para que los
// tests inyecten getProviderFn/loadProjectsFn sin tocar el registry real ni
// ~/.kodo/projects.json.

/**
 * Resuelve el `project_path` a registrar para una sesión adoptada: el path configurado
 * (default o de un módulo) que es el ANCESTRO MÁS CERCANO del `cwd` de la sesión. Una
 * entrada string plana se devuelve tal cual. Para `{ default, modules }`, considera
 * `default` + todos los paths de `modules` y elige el más largo que sea ancestro (o igual)
 * del cwd; si ninguno casa, cae al `default`. Puro, never-throws sobre shapes raros.
 *
 * @param {string} cwd
 * @param {string | { default?: string, modules?: Record<string, string> }} entry
 * @returns {string}
 */
export function resolveProjectPath(cwd, entry) {
  if (typeof entry === 'string') return entry;
  const fallback = typeof entry?.default === 'string' ? entry.default : '';
  const candidates = [entry?.default, ...Object.values(entry?.modules || {})].filter(
    (p) => typeof p === 'string' && p.length > 0,
  );
  const norm = (p) => p.replace(/\/+$/, '');
  const c = typeof cwd === 'string' ? norm(cwd) : '';
  let best = '';
  if (c) {
    for (const p of candidates) {
      const n = norm(p);
      if ((c === n || c.startsWith(`${n}/`)) && n.length > best.length) best = n;
    }
  }
  return best || fallback;
}

/**
 * @typedef {{
 *   workspaceRef: string,
 *   cwd: string,
 *   sessionId: string,
 *   projectId: string,
 *   title?: string,
 *   description?: string,
 *   module?: string,
 *   json?: boolean,
 * }} RunAdoptCliOpts
 *
 * @typedef {{
 *   adoptSessionFn?: typeof adoptSession,
 *   getProviderFn?: () => any,
 *   loadProjectsFn?: () => Record<string, string | { default?: string, modules?: Record<string, string> }>,
 *   loadConfigFn?: () => { provider: string },
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   renameWorkspaceFn?: (args: { workspaceRef: string, title: string }) => Promise<void>,
 * }} RunAdoptCliDeps
 */

/**
 * Adopt an ad-hoc session into a persistent task — thin CLI handler.
 *
 * Toda la lógica de adopción (capability gate, sanitización, idempotency guard,
 * persist atómico) vive en `src/adopt.js` (`adoptSession`). Esta función es
 * puramente: argv → resolver provider/projectPath → delegación → render.
 *
 * @param {RunAdoptCliOpts} opts
 * @param {RunAdoptCliDeps} [deps]
 * @returns {Promise<number>} exit code (D-02 / Opción A).
 */
export async function runAdoptCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const adoptSessionFn = deps.adoptSessionFn || adoptSession;
  // Formatter lazy — no tocar process.stdout durante el import (gsd-verify.js:62-64).
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();

  // PASO 1 — resolver provider/providerName (espejo del bloque launch cli.js:212-217).
  // Lazy-import para no acoplar el registry al import del módulo; los tests
  // inyectan getProviderFn/loadConfigFn y nunca tocan el registry real.
  const { loadConfig, loadProjects } = await import('../config.js');
  let providerName;
  let provider;
  if (deps.getProviderFn) {
    // En tests, getProviderFn resuelve el provider sin registry; el providerName
    // se deriva del config inyectado o cae a un valor neutro.
    providerName = (deps.loadConfigFn || loadConfig)().provider || '(injected)';
    provider = deps.getProviderFn();
  } else {
    const { initRegistry, getProvider } = await import('../providers/registry.js');
    await initRegistry();
    providerName = (deps.loadConfigFn || loadConfig)().provider;
    provider = getProvider(providerName);
  }

  // PASO 2 — resolver projectPath (espejo de las ERROR SEMANTICS de
  // resolveProjectPath, manager.js:78-103; NO llamamos a la función porque toma
  // un `task` inexistente en tiempo de CLI). loadProjects() devuelve
  // Record<projectId, string | {default?}>. Fail-fast ANTES de cualquier POST
  // (T-54-02 — un --project no mapeado nunca llega a adoptSession).
  const projects = (deps.loadProjectsFn || loadProjects)();
  const entry = projects[opts.projectId];
  if (entry === undefined) {
    err(
      `No local path mapped for project "${opts.projectId}".\n` +
        `Available projects: ${Object.keys(projects).join(', ') || '(none)'}\n` +
        `Run: kodo config --map-project\n`,
    );
    return 1;
  }
  // project_path = el path configurado ANCESTRO MÁS CERCANO del cwd de la sesión, NO el
  // default ciego: una sesión adoptada en un MÓDULO (p.ej. optiai bajo el proyecto roman
  // cuyo default es fvf) debe registrar SU path, para que la columna `repo` del dashboard y
  // la resolución de plan (worktree_path ?? project_path) apunten al sitio real (UAT
  // 2026-06-19 — ROMAN-192 salía como fvf estando en optiai). Misma semántica que el
  // reverse-lookup de resolveProjectId/deriveModuleFromCwd. Fallback al default.
  const projectPath = resolveProjectPath(opts.cwd, entry);
  if (!projectPath) {
    err(`Project "${opts.projectId}" mapped but no default path.\n`);
    return 1;
  }

  // PASO 2b — MODULE PLACEMENT (Phase 57 gap-fix). An adopted Plane work item must land in the
  // correct MODULE board, not just the project. The explicit `--module` flag WINS; when absent we
  // AUTO-DERIVE the module NAME from `opts.cwd` by reverse-looking-up the resolved project's
  // `modules` map (path → name), nearest-ancestor wins — the SAME semantics as resolveProjectId in
  // dashboard/select.js (`norm(cwd) === norm(p)` || `norm(cwd).startsWith(norm(p) + '/')`, longest
  // match wins). A flat-string project entry (no modules) → no module. Never throws on a
  // missing/garbage modules map (operator-editable projects.json). `module` is OPTIONAL downstream:
  // none → undefined, behavior unchanged; the provider FAILS OPEN on an unresolvable module.
  const module =
    opts.module !== undefined && opts.module !== null
      ? opts.module
      : deriveModuleFromCwd(opts.cwd, entry);

  // PASO 3 — delegar al core. NO derivamos default de título ni saneo: todo eso lo hace
  // adoptSession (Pitfall 2 — el CLI solo resuelve datos de entrada). title/description se pasan
  // SIN tocar (el core los sanea, BIDIR-08). `module` es un NOMBRE config-derivado (no free-text),
  // por eso NO pasa por el sanitizer — pero sí lo valida string el core.
  const result = await adoptSessionFn({
    provider,
    providerName,
    workspaceRef: opts.workspaceRef,
    cwd: opts.cwd,
    sessionId: opts.sessionId,
    projectId: opts.projectId,
    projectPath,
    title: opts.title,
    description: opts.description,
    ...(module !== undefined ? { module } : {}),
  });

  // PASO 4 — render. --json hace bypass total de renderHuman (byte-determinismo,
  // sin color, sin reshape — la shape la posee el core).
  if (opts.json) {
    write(JSON.stringify(result, null, 2) + '\n');
  } else {
    renderHuman(result, write, err, fmt);
  }

  // PASO 5 — LIVENESS (Phase 59 gap-fix). Tras una adopción NUEVA (result.ok === true),
  // renombramos el workspace de cmux para que su título contenga el task_ref recién
  // creado. reconcile.liveForSession identifica la sesión viva por
  // titleIdentifiesSession(workspace.title, task_ref) — defensa anti-reciclaje de
  // workspace_ref (Phase 43). Las sesiones LANZADAS por kodo ya tienen el workspace
  // auto-nombrado con el ref; una sesión ADOPTADA vive en un workspace con título
  // cmux/usuario que NUNCA contiene el ref recién creado → reconcile la marca dead/zombie.
  // Fijar el título a "<ref>: <título>" hace que el check EXISTENTE pase en el próximo
  // tick → la sesión se muestra running/idle/needs-input. UNA sola llamada a cmux en
  // tiempo de adopt; cero coste por-tick; SIN tocar reconcile.
  //
  // FAIL-OPEN ABSOLUTO: el rename es un side-effect DESPUÉS de decidir el discriminante.
  // Un fallo (cmux caído, sin host, host non-cmux, método ausente, set-title error) NUNCA
  // debe fallar el adopt ni cambiar el exit code. La tarea ya está adoptada; un workspace
  // mostrado dead es estrictamente mejor que un adopt fallido. exitCodeFor(result) intacto.
  if (result.ok === true && result.task && typeof result.task.ref === 'string' && result.task.ref) {
    try {
      const title = `${result.task.ref}: ${result.task.title ?? ''}`;
      const renameFn = deps.renameWorkspaceFn || defaultRenameWorkspace;
      await renameFn({ workspaceRef: opts.workspaceRef, title });
    } catch (e) {
      // Swallow: liveness display degradado, adopción intacta. Log a warn como mucho.
      err(`warn: workspace rename for liveness failed (task still adopted): ${String(e?.message || e)}\n`);
    }
  }

  return exitCodeFor(result);
}

/**
 * Default `renameWorkspaceFn` — renombra el workspace cmux vía el contrato WorkspaceHost
 * (`getHost('cmux')._legacy.rename`). Lazy-import para no acoplar el host al import del
 * módulo CLI ni traer child_process salvo que se use. La regla transversal LOCKED exige
 * que TODA llamada a cmux pase por `src/host/` (getHost) — nunca desde adopt.js/reconcile.
 *
 * never-throws-en-la-práctica: si el host no es cmux, no expone `_legacy.rename`, o el
 * binario falla, el caller (runAdoptCli) ya lo envuelve en try/catch FAIL-OPEN. Aquí
 * además guardamos `typeof host?._legacy?.rename === 'function'` para degradar limpio.
 *
 * @param {{ workspaceRef: string, title: string }} args
 * @returns {Promise<void>}
 */
async function defaultRenameWorkspace({ workspaceRef, title }) {
  const { getHost } = await import('../host/interface.js');
  const host = getHost('cmux');
  if (host && host._legacy && typeof host._legacy.rename === 'function') {
    await host._legacy.rename({ workspace: workspaceRef, title });
  }
}

/**
 * Reverse-lookup `cwd → module NAME` over a single resolved project entry (Phase 57 module-placement
 * gap-fix). Pure, no I/O (string path ops only — NO `path`/`fs`). Mirrors the nearest-ancestor
 * semantics of `resolveProjectId` (dashboard/select.js) but resolves the MODULE within ONE already-
 * resolved project's `modules` map instead of the project across all entries.
 *
 * Algorithm:
 *   - a flat-string entry (no modules) → undefined (no module concept),
 *   - an object entry → over `modules: Record<name, path>`, a module path `p` matches when
 *     `norm(cwd) === norm(p)` || `norm(cwd).startsWith(norm(p) + '/')` (the `+ '/'` prevents a
 *     sibling like `/a/b-x` matching `/a/b`),
 *   - the LONGEST matching path wins (most specific ancestor) → returns its module NAME,
 *   - no match → undefined.
 *
 * Never-throws on a missing/garbage modules map (projects.json is operator-editable, UNvalidated):
 * non-string module paths are filtered BEFORE `norm`; a non-string `cwd` collapses to '' (matches
 * nothing). The caller passes `entry` (already resolved from `loadProjects()[projectId]`).
 *
 * @param {string} cwd
 * @param {string | { default?: string, modules?: Record<string, string> } | undefined} entry
 * @returns {string | undefined} module name, or undefined when none derivable.
 */
function deriveModuleFromCwd(cwd, entry) {
  if (!entry || typeof entry !== 'object') return undefined; // flat-string entry → no modules
  const modules = entry.modules;
  if (!modules || typeof modules !== 'object') return undefined;
  const norm = (/** @type {string} */ p) => p.replace(/\/+$/, '');
  const c = typeof cwd === 'string' ? norm(cwd) : '';
  /** @type {{ name: string, len: number } | null} */
  let best = null;
  for (const [name, rawPath] of Object.entries(modules)) {
    if (typeof rawPath !== 'string') continue; // never-throws: skip garbage paths before norm()
    const p = norm(rawPath);
    if (c === p || c.startsWith(p + '/')) {
      if (best === null || p.length > best.len) best = { name, len: p.length };
    }
  }
  return best ? best.name : undefined;
}

/**
 * Mapea el discriminante de adoptSession a un exit code (D-02 / Opción A).
 * EXACTAMENTE 5 cases de error (no añadir un 6º — Pitfall 1; src/adopt.js:135-140).
 *
 * @private
 * @param {any} result
 * @returns {number}
 */
function exitCodeFor(result) {
  if (result.ok) return 0; // task creada + fila sembrada
  switch (result.code) {
    case 'ALREADY_ADOPTED':
      return 0; // no-op idempotente, NO es un fallo (D-02)
    case 'INVALID_INPUT':
      return 1;
    case 'UNSUPPORTED':
      return 1;
    case 'PERSIST_FAILED':
      return 1; // huérfano, LOUD, recuperable (NO transient)
    case 'CREATE_FAILED':
      return 2; // POST falló — transient, retryable (espejo gsd-verify exit 2)
    default:
      return 1; // defensivo
  }
}

/**
 * Render human-readable del discriminante con color por severidad
 * (espejo gsd-verify.js renderHuman / D-14). El branch --json hace bypass.
 *
 * Reparto stdout/stderr:
 *   - éxito + ALREADY_ADOPTED → stdout
 *   - PERSIST_FAILED → STDERR LOUD (Pitfall 4 / Phase 53 D-03)
 *   - CREATE_FAILED / INVALID_INPUT / UNSUPPORTED → stderr
 *
 * Color por severidad: éxito/task_id = green/ok; CREATE_FAILED transient =
 * yellow; INVALID_INPUT/UNSUPPORTED/PERSIST_FAILED = red.
 *
 * @private
 * @param {any} result
 * @param {(s: string) => void} write   stdout
 * @param {(s: string) => void} err     stderr
 * @param {import('./format.js').Formatter} fmt
 */
function renderHuman(result, write, err, fmt) {
  if (result.ok) {
    const { task, session } = result;
    write(`${fmt.ok('Adopted')}\n`);
    write(`  task_id:    ${fmt.green(task.id)}\n`);
    write(`  task_url:   ${task.url}\n`);
    write(`  session_id: ${session.session_id}\n`);
    return;
  }
  switch (result.code) {
    case 'ALREADY_ADOPTED':
      write(`Already adopted (no-op). Existing task: ${result.detail.task_id}\n`);
      return;
    case 'PERSIST_FAILED':
      // LOUD en STDERR — la tarea del provider SÍ se creó, pero la escritura
      // local falló; el operador debe re-correr (idempotente) para sembrar la fila.
      err(`${fmt.red('PERSIST_FAILED')} — provider task created but local write failed.\n`);
      err(`  task_id:  ${result.detail.task_id}\n`);
      err(`  task_url: ${result.detail.task_url}\n`);
      err(`  hint:     ${result.detail.hint}\n`);
      return;
    case 'CREATE_FAILED':
      err(`${fmt.yellow('CREATE_FAILED')} (transient): ${result.detail.message}\n`);
      return;
    case 'INVALID_INPUT':
      err(`${fmt.red('INVALID_INPUT')}: missing ${result.detail.missing.join(', ')}\n`);
      return;
    case 'UNSUPPORTED':
      err(`${fmt.red('UNSUPPORTED')}: provider "${result.detail.providerName}" cannot create tasks.\n`);
      return;
  }
}
