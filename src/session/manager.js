// @ts-check
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadConfig, loadProjects, getAgentDef } from '../config.js';
import { initRegistry, getProvider } from '../providers/registry.js';
import { parseKodoLabels, getGsdMode } from '../labels.js';
import { getHost, resolveHostName, hostIsolatesWorktree } from '../host/interface.js';
import { resolveWorkspaceId } from '../host/workspace-id.js';
import { addSession, listSessions, updateSession, computeWorktreePath } from './state.js';
import { resolveOrchestratorTargets, sendToOrchestrator } from '../orchestrator/target.js';
import { writePromptFile } from './prompt-file.js';
import { stateTransition } from '../logger-events.js';
import { stripForKeystroke, stripControlChars } from '../cli/sanitize.js';

/**
 * Build the session record saved to state from a resolved TaskItem.
 * Pure function — no I/O.
 *
 * @param {{
 *   task: import('../interface.js').TaskItem,
 *   providerName: string,
 *   projectPath: string,
 *   workspaceRef: string,
 *   sessionId: string,
 *   workspaceId?: string|null, // KODO-22: UUID del workspace resuelto contra el árbol del host.
 *                              //          `null` explícito cuando el host no lo resolvió (fail-open).
 *   flags?: string[],
 *   phaseId?: string,      // Phase 9 D-03: resolved phase id threaded from dispatcher (action === 'phase').
 *   brief?: string,        // Phase 9 D-09: bootstrap brief (only set when resolver returned 'bootstrap').
 *   hostName?: string,     // KODO-18: host bajo el que se lanzó ('cmux'|'orca'). Aditivo
 *                          //          opcional — lo consume la guarda por host de
 *                          //          reconcileTick para no degradar sesiones del otro
 *                          //          cliente cuando el operador conmuta `config.host`.
 *   worktreePath?: string, // Phase 18 D-03: deterministic worktree path computed by computeWorktreePath
 *                          //               (single source of truth in src/session/state.js). Persisted
 *                          //               PRE-spawn so kodo logs / consumers can resolve the path
 *                          //               immediately. Aditivo opcional (D-03c) — mismo idiom que
 *                          //               phaseId/brief/gsdMode.
 * }} params
 * @returns {import('./state.js').Session}
 */
export function buildSessionFromTask({ task, providerName, projectPath, workspaceRef, sessionId, workspaceId, flags, phaseId, brief, worktreePath, hostName }) {
  // Phase 11 (D-03): GSD execution mode derived locally from flags. Single source
  // of truth: `flags`. The signature does NOT grow — gsdMode is a local derivation,
  // mirroring the dispatcher pattern at src/triggers/dispatcher.js:74.
  const gsdMode = getGsdMode(flags);
  return {
    workspace_ref: workspaceRef,
    // KODO-22: identidad ESTABLE del workspace. `workspace_ref` se recicla (cmux reusa
    // los `workspace:N` al cerrar y crear tabs) y no es lo que el host exporta dentro de
    // la tab: ahí vive este UUID, como `CMUX_WORKSPACE_ID`. Sin él, el guard de branding
    // (shouldBrandWorkspace, server.js) comparaba un UUID contra `workspace:N` y no
    // casaba nunca, así que `kodo up` desde la tab de una sesión viva la rebautizaba
    // `心動 kodo service` (el síntoma que dejó la tarea KODO-8 con ese nombre).
    //
    // A DIFERENCIA de los campos aditivos de arriba (worktree_path, gsd_mode…), este NO
    // usa spread condicional: se persiste SIEMPRE, con `null` explícito cuando el host no
    // lo resolvió. `null` y campo ausente significan cosas distintas — "esta sesión se
    // lanzó y el host no contestó" vs "sesión legacy anterior a KODO-22" — y el guard
    // degrada al match por ref en ambos casos. Sin bump de schema_version.
    workspace_id: workspaceId ?? null,
    session_id: sessionId,
    task_id: task.id,
    task_ref: task.ref,
    provider: providerName,
    project_id: task.projectId,
    summary: task.title,
    status: /** @type {const} */ ('running'),
    started_at: new Date().toISOString(),
    project_path: projectPath,
    task_url: task.url,
    project_name: task.projectName,
    // Phase 11 (D-03/D-04): GSD mode derived locally from flags via getGsdMode.
    // When set, gsd_mode is ALWAYS persisted alongside gsd:true (no missing-mode
    // shape post-v0.4). Legacy sessions with gsd:true and no gsd_mode are read
    // as 'full' by getSessionMode (D-08). 'kodo:gsd-quick' wins over 'kodo:gsd'
    // (precedence centralized in getGsdMode — single point of change for new modes).
    ...(gsdMode ? { gsd: true, gsd_mode: gsdMode } : {}),
    // Phase 9: phase_id and brief threaded from dispatcher after resolvePhase().
    // Both optional — only present on GSD sessions where the resolver produced
    // `action: 'phase'` (phaseId) or `action: 'bootstrap'` (brief). Never both.
    ...(phaseId ? { phase_id: phaseId } : {}),
    ...(brief ? { brief } : {}),
    // Phase 18 (D-03c): aditivo opcional. Falsy/undefined → campo omitido del shape
    // (consumers downstream toleran falsy — legacy v0.5 sessions sin este campo
    // se siguen leyendo). Mismo idiom que gsd_mode (Phase 11 D-08), phase_id y brief.
    ...(worktreePath ? { worktree_path: worktreePath } : {}),
    // KODO-18: sella el cliente bajo el que corre la sesión. Sin esto, conmutar
    // `config.host` con sesiones vivas hace que el siguiente tick de reconcile no
    // encuentre sus `workspace_ref` en el snapshot del host NUEVO y las degrade a
    // idle/dead — corrompiendo sesiones perfectamente sanas del cliente anterior.
    // Mismo spread condicional que los campos de arriba: una sesión sin él (legacy)
    // desactiva la guarda y conserva el comportamiento previo.
    ...(hostName ? { host: hostName } : {}),
  };
}

/**
 * Resolve the local project path for a task.
 * Supports both flat strings and module-aware objects in projects map.
 * Pure function — accepts the projects map as argument.
 *
 * @param {import('../interface.js').TaskItem} task
 * @param {Record<string, string | {default?: string, modules?: Record<string, string>}>} projects
 * @returns {string}
 */
export function resolveProjectPath(task, projects) {
  const entry = projects[task.projectId];
  if (!entry) {
    throw new Error(
      `No local path mapped for project "${task.projectName || task.projectId}" (${task.projectId}). ` +
      `Run: kodo config --map-project`,
    );
  }

  // Flat string — legacy format, no module support
  if (typeof entry === 'string') return entry;

  // Object format — check module mapping first
  const moduleName = deriveModuleName(task);
  if (moduleName && entry.modules?.[moduleName]) {
    return entry.modules[moduleName];
  }

  // Fall back to default path
  if (entry.default) return entry.default;

  throw new Error(
    `No path for module "${moduleName || '(none)'}" in project "${task.projectName || task.projectId}". ` +
    `Run: kodo config to map modules.`,
  );
}

/**
 * Derive the module name from a TaskItem's groups array.
 * Pure function.
 *
 * @param {import('../interface.js').TaskItem} task
 * @returns {string|null}
 */
export function deriveModuleName(task) {
  return task.groups && task.groups.length > 0 ? task.groups[0] : null;
}

/**
 * Deriva el nombre de grupo cmux ESPERADO para una tarea, a partir de su ref y del
 * path resuelto (GRP-02). Función pura — no toca cmux ni config (D-08).
 *
 * Contrato (D-01/D-02):
 *   - Path resuelto == `entry.default` (o `entry` flat string) → identifier humano a
 *     secas (`KODO`, `ROMAN`). Los F0..F6 de SCP (todos == default) colapsan aquí.
 *   - Módulo con path PROPIO distinto del default → `IDENTIFIER/Módulo` (`ROMAN/FVF`).
 *     El compuesto es obligatorio, no estético (D-02: un módulo pelado es ambiguo).
 *
 * El identifier se deriva de `task.ref` sin plumbear config a la función pura
 * (cross-provider): Plane `IDENT-<seq>` → `IDENT` (strip trailing `-<dígitos>`);
 * GitHub `owner/repo#n` → basename antes de `#`.
 *
 * GUARDA de entrada degenerada (primera línea): si `task.ref` no es un string no-vacío
 * (ausente, `undefined`, no-string, o solo whitespace tras `trim`) → `return null` de
 * inmediato. NO deriva un nombre bogus (`'undefined'`, `''`) sobre input malformado:
 * `null` propaga limpio a `resolveWorkspaceGroup` (que no matchea `null`) → la sesión se
 * lanza sin `--group` (fail-open). Esto blinda el `replace(/-\d+$/,'')` de correr sobre
 * `undefined`.
 *
 * @param {import('../interface.js').TaskItem} task
 * @param {string | {default?: string, modules?: Record<string,string>}} entry  projects[task.projectId]
 * @param {string} resolvedPath  el output de resolveProjectPath (el "path resuelto" de GRP-02)
 * @returns {string|null} nombre de grupo esperado (`"KODO"`, `"ROMAN/FVF"`) o `null` si `ref` degenerado
 */
export function deriveExpectedGroupName(task, entry, resolvedPath) {
  // Guarda de entrada degenerada — ref debe ser un string; se DERIVA sobre el ref
  // TRIMEADO (IN-01): un whitespace de borde (`"KODO-9 "`) ya no rompe el strip
  // trailing -digits ni pierde el grupo. Se conserva el rechazo por tipo (number /
  // object → null) para no coaccionar `42`/`{}` a un identifier bogus.
  const rawRef = task && task.ref;
  if (typeof rawRef !== 'string') return null;
  const ref = rawRef.trim();
  if (ref === '') return null;

  // Identifier humano desde task.ref — cross-provider, sin config en la función pura.
  //   Plane:  "KODO-9"    → "KODO"  (strip trailing -digits)
  //   GitHub: "acme/x#7"  → "x"     (basename antes de #)
  const identifier = ref.includes('#')
    ? ref.split('#')[0].split('/').pop()
    : ref.replace(/-\d+$/, '');

  // WR-01: si la derivación colapsa a vacío (`"#7"`→"", `"-9"`→""), fail-open a null.
  // Un identifier `''` matchearía un grupo whitespace-only y aterrizaría la tarea en
  // un grupo arbitrario — se rechaza antes de resolver.
  if (!identifier || identifier.trim() === '') return null;

  const moduleName = deriveModuleName(task); // task.groups[0] || null

  // Flat string (kodo) o path resuelto == default → identifier a secas (D-01).
  // Módulo con path propio DISTINTO del default → "IDENTIFIER/Módulo" (D-01).
  const isFlat = typeof entry === 'string';
  const usesModulePath = !isFlat && moduleName && resolvedPath !== entry?.default;
  return usesModulePath ? `${identifier}/${moduleName}` : identifier;
}

/**
 * Resuelve un nombre de grupo esperado a su ref `workspace_group:N` contra la salida
 * ya parseada de `workspace-group list --json`. Función pura DEFENSIVA — never-throws,
 * calcada de `normalizeSurface`/`buildTitleMap` (host/cmux.js): shapes inesperados → null
 * (D-03/D-07).
 *
 * Match: NFC + lowercase + trim (cubre `Traça Web` y los grupos live `Kodo`/`SCRIBBA`
 * contra identifiers `KODO`/`SCRIBBA`). Empate (dos grupos que normalizan al mismo
 * nombre) → el ref del PRIMERO de la lista (determinista/estable, D-03).
 *
 * @param {any} groupsJson  salida ya parseada de `workspace-group list --json`
 * @param {string|null|undefined} expectedName
 * @returns {string|null} ref `"workspace_group:N"` o `null`
 */
export function resolveWorkspaceGroup(groupsJson, expectedName) {
  const norm = (s) => String(s).normalize('NFC').toLowerCase().trim();
  if (!groupsJson || !Array.isArray(groupsJson.groups)) return null; // shape inesperado → null
  if (typeof expectedName !== 'string') return null; // sin nombre válido no hay match
  const target = norm(expectedName);
  for (const g of groupsJson.groups) {
    // first-match wins (D-03 empate); type-check por campo (never-throws). IN-02:
    // el ref debe cumplir el shape canónico `workspace_group:N` — un ref anómalo de
    // cmux (otro shape, con `\n` u otro carácter) se rechaza antes de devolverse/
    // loguearse (defensa contra forja de líneas de log).
    if (
      g &&
      typeof g.name === 'string' &&
      typeof g.ref === 'string' &&
      /^workspace_group:\d+$/.test(g.ref) &&
      norm(g.name) === target
    ) {
      return g.ref;
    }
  }
  return null;
}

/**
 * Lanza un workspace con fallback fail-open de dos capas para el flag `--group` (D-10).
 * El `newWorkspaceFn` y el `log` son inyectables → el retry TOCTOU tiene dientes reales
 * en test (no solo source-hygiene).
 *
 * - Sin `group` → `newWorkspaceFn(baseOpts)` una vez (como hoy).
 * - Con `group` → intenta `{ ...baseOpts, group }`; si RECHAZA (ref inválido = grupo
 *   borrado entre `list` y `new-workspace`, exit=1 fatal) → EXACTAMENTE UN reintento
 *   SIN `group` + una línea de log (D-11: solo el ref/motivo, nunca contenido de usuario).
 * - Un fallo del reintento (sin grupo) PROPAGA como hoy (no se captura).
 *
 * @param {(opts:{name:string,cwd?:string,group?:string}) => Promise<string>} newWorkspaceFn
 * @param {{name:string, cwd?:string}} baseOpts
 * @param {string|null} group
 * @param {(msg:string)=>void} [log]  inyectable; default console.log (precedente worktree_skipped_nongit)
 * @returns {Promise<string>}
 */
export async function newWorkspaceWithGroupFallback(newWorkspaceFn, baseOpts, group, log = console.log) {
  if (!group) return newWorkspaceFn(baseOpts); // sin grupo → como hoy
  try {
    return await newWorkspaceFn({ ...baseOpts, group }); // intento con --group
  } catch {
    log(`[kodo] group_skipped — retry_sin_grupo ${group}`); // D-11: solo ref/motivo
    return newWorkspaceFn(baseOpts); // capa 2: reintento SIN --group (D-10)
  }
}

/**
 * Resolve a human ref into the launch context: task, project path, module,
 * labels, and derived model/flags. Does not touch cmux or state — returns
 * everything the caller needs to launch a session.
 *
 * @param {{
 *   provider: Pick<import('../interface.js').TaskProvider, 'init' | 'getTask'>,
 *   identifier: string,
 *   projects: Record<string, string>,
 * }} params
 */
export async function resolveTaskAndLaunchContext({ provider, identifier, projects }) {
  await provider.init();
  const task = await provider.getTask(identifier);

  const projectPath = resolveProjectPath(task, projects);
  const moduleName = deriveModuleName(task);

  // parseKodoLabels expects objects with .name — wrap string labels
  const { model, flags } = parseKodoLabels(task.labels.map((name) => ({ name })));

  return {
    task,
    projectPath,
    moduleName,
    description: task.description,
    model,
    flags,
  };
}

/**
 * Launch a Claude Code session for a provider-backed task.
 *
 * @param {string} identifier e.g. "KL-42"
 * @param {{
 *   model?: string|null,
 *   flags?: string[],
 *   sessionId?: string,
 *   projectPath?: string, // Phase 18 WR-01: dispatcher-resolved path threaded
 *                         //                  para evitar double-resolution.
 *                         //                  Cuando presente, salta el
 *                         //                  resolveProjectPath interno —
 *                         //                  garantiza consistencia con el
 *                         //                  path validado por collision-check
 *                         //                  (existsSyncFn).
 *   phase_id?: string,  // Phase 9: threaded from dispatcher when resolver returned 'phase'.
 *   brief?: string,     // Phase 9: threaded from dispatcher when resolver returned 'bootstrap'.
 * }} [opts]
 *   If `opts.sessionId` is provided (e.g. from the GSD dispatcher which acquires
 *   the repo lock before calling), it is used verbatim as the session_id. Otherwise
 *   a fresh randomUUID() is generated (backwards-compatible for non-GSD paths).
 *   `phase_id` and `brief` are persisted on the Session record for the hook
 *   SessionStart to consume via findSession().
 */
/**
 * ¿Cuenta esta sesión contra el gate de `max_parallel`? (CONC-03 / D-05).
 *
 * Solo las sesiones `status === 'running'` Y `alive !== false` ocupan un slot. Un
 * zombi que `reconcileTick` marcó `alive:false` (porque su TAB de cmux murió — la
 * TAB, no el proceso: D-06b) deja de contar, liberando la fuga de capacidad más
 * dañina de la auditoría (A4: un slot retenido hasta 30 días).
 *
 * `!== false` (no `=== true`) es DELIBERADO: las sesiones legacy sin el campo
 * `alive` (pre-v0.9) siguen contando — cero regresión. El gate solo LEE `alive`;
 * el ÚNICO escritor de ese campo sigue siendo `reconcileTick` (invariante v0.9/v0.10).
 *
 * @param {{ status?: string, alive?: boolean }} session
 * @returns {boolean}
 */
export function isSchedulable(session) {
  return session.status === 'running' && session.alive !== false;
}

/**
 * Detecta si `projectPath` está dentro de un working tree de git.
 *
 * `claude --worktree <sessionId>` EXIGE un repo git y aborta en caso contrario
 * (`Error: Can only use --worktree in a git repository ...`). launchWorkItem usa
 * este check para decidir si emite el flag: proyectos git → con aislamiento por
 * worktree (comportamiento Phase 18 intacto); proyectos no-git → sin `--worktree`,
 * la sesión arranca directamente en el directorio del proyecto.
 *
 * NUNCA lanza: cualquier error (no es repo, git ausente, EACCES, ENOENT del cwd)
 * se interpreta como "no es git" (fail-safe deliberado → path sin aislamiento).
 * Un launch no-git siempre es válido; un `--worktree` erróneo es fatal, así que
 * ante la duda preferimos NO aislar. Sigue el idiom `execFileSync('git', ['-C', …])`
 * ya usado en src/hooks/terminal-cleanup.js y src/gsd/doctor.js.
 *
 * @param {string} projectPath - Directorio del proyecto (cwd de la sesión).
 * @param {(cwd: string, args: string[]) => string} [gitFn] - Inyectable para tests.
 *   Por defecto ejecuta `git -C <cwd> <args>` de forma síncrona (stderr silenciado
 *   para no ensuciar la consola con el "fatal: not a git repository" esperado).
 * @returns {boolean}
 */
export function isGitRepo(projectPath, gitFn) {
  const git = gitFn || ((cwd, args) =>
    execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim());
  try {
    return git(projectPath, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

export async function launchWorkItem(identifier, opts = {}) {
  const config = loadConfig();

  await initRegistry();
  const provider = getProvider(config.provider);

  // Check max parallel sessions (CONC-03 / D-05): cuenta solo sesiones vivas
  // (ver isSchedulable). El gate solo LEE `alive`; reconcile sigue siendo el ÚNICO
  // escritor de ese campo (invariante v0.9/v0.10).
  const active = listSessions().filter(isSchedulable);
  if (active.length >= config.claude.max_parallel) {
    throw new Error(
      `Max parallel sessions (${config.claude.max_parallel}) reached. ` +
      `Active: ${active.map((s) => s.task_ref).join(', ')}`,
    );
  }

  // Resolve task + launch context via provider
  const projects = loadProjects();
  const {
    task,
    projectPath: resolvedProjectPath,
    moduleName,
    description,
    model: labelModel,
    flags: labelFlags,
  } = await resolveTaskAndLaunchContext({ provider, identifier, projects });
  // Phase 18 WR-01: prefer dispatcher-resolved path when present — el
  // dispatcher ya lo computó para el collision-check, threadearlo aquí
  // evita re-leer ~/.kodo/projects.json y elimina la ventana donde el
  // config humano podría editarse entre check y launch (path validado
  // ≠ path usado). Fallback al resolver interno cuando no hay opts —
  // backward-compat para callers no-dispatcher (kodo launch CLI directo).
  const projectPath = opts.projectPath || resolvedProjectPath;

  // Create cmux workspace
  // Move task to "In Progress" in the provider
  try {
    const providerStates = config.providers?.[config.provider]?.states;
    if (providerStates?.trigger && task.state !== providerStates.trigger) {
      await provider.updateTaskState(task, providerStates.trigger);
      console.log(`[kodo] ${task.ref} → ${providerStates.trigger}`);
    }
  } catch (err) {
    console.error(`[kodo] Error moving to In Progress: ${err.message}`);
  }

  // Phase 38 SC#5: el cliente del host queda confinado a src/host/. Los métodos de
  // lifecycle no-contract (newWorkspace/setStatus/send/notify) se consumen vía
  // host._legacy — passthrough fiel del cliente (CONTEXT.md D-09).
  // KODO-18: el host ya no es el literal 'cmux' sino el ACTIVO (`config.host`). Todo lo
  // que sigue en esta función habla el vocabulario del contrato, no el de cmux.
  const hostName = resolveHostName();
  const host = getHost(hostName);

  // Phase 77 (GRP-01/02/03 · D-09/D-12): resolver el grupo cmux del path resuelto EN
  // FRESCO por lanzamiento. Capa 1 fail-open englobante — cualquier fallo de list /
  // JSON.parse / derivación deja groupRef=null y la sesión se lanza SIN --group,
  // exactamente como hoy (cmux viejo, daemon headless, socket roto, sin match). Esta es
  // la ÚNICA llamada cmux extra por lanzamiento (cero en el reconcile loop) y SIEMPRE va
  // por host._legacy (nunca import de cmux/client.js — walker cmux-isolation). El
  // console.log lleva solo el motivo, sin contenido de usuario (D-11, precedente
  // worktree_skipped_nongit :312). El groupRef NO se persiste (GRP-04).
  const entry = projects[task.projectId];
  let groupRef = null;
  try {
    const expectedName = deriveExpectedGroupName(task, entry, projectPath);
    // IN-04: solo consultar cmux cuando HAY un nombre esperado. Con expectedName null
    // (ref degenerado, proyecto sin identifier) la llamada `workspace-group list` es
    // garantizada-inútil (~50ms/timeout por lanzamiento) → se evita tras el guard.
    if (expectedName) {
      const raw = await host._legacy.listWorkspaceGroups();
      groupRef = resolveWorkspaceGroup(JSON.parse(raw), expectedName);
    }
  } catch (err) {
    // IN-03: el motivo acotado hace diagnosticable la degradación. La causa viene de
    // cmux / JSON.parse, NUNCA del título de tarea (D-11 preservado); slice(0,80)
    // acota el ruido en el log.
    console.log(`[kodo] group_skipped — resolucion_fallo: ${String(err?.message).slice(0, 80)}`);
  }

  const prefix = moduleName ? `${task.ref} [${moduleName}]` : task.ref;
  // IN-04 (Phase 78): task.title es contenido NO confiable (LLM/Plane) y llega a cmux
  // como arg CLI de newWorkspace. No es carril de keystroke (no son pulsaciones), así
  // que basta el saneador de RENDER (stripControlChars) — neutraliza CSI/OSC/C0/C1/DEL/CR
  // sin colapsar \n/\t. Se sanea ANTES de truncar para que el recorte mida texto limpio.
  const workspaceName = `${prefix}: ${truncate(stripControlChars(task.title), 40)}`;
  // Phase 77 (D-10 capa 2 TOCTOU): si el new-workspace CON --group falla (grupo borrado
  // entre list y launch, ref inválido = exit=1 fatal), UN reintento SIN --group salva la
  // sesión. `cwd: projectPath` LITERAL (invariante Phase 18 D-04 — el worktree lo
  // materializa claude, no el newWorkspace).
  const workspaceRef = await newWorkspaceWithGroupFallback(
    host._legacy.newWorkspace,
    { name: workspaceName, cwd: projectPath },
    groupRef,
  );

  // Marca el estado inicial de la sesión en el host. KODO-18: verbo HOST-AGNÓSTICO
  // (`setStatus`) en vez del `setColor` de vocabulario cmux — cada host elige su canal:
  // color de tab en cmux, columna del tablero en orca. La resolución del color vive
  // ahora dentro de host/cmux.js, que es lo que permite que este módulo deje de
  // importar `cmux/colors.js`.
  await host._legacy.setStatus({ workspace: workspaceRef, status: 'running' });

  // Marca kodo del workspace: description "⬢ <ref> · <título>". Es el marcador
  // machine-readable de "sesión gestionada por kodo" (el título es heurístico y
  // editable por el usuario) y aparece como línea secundaria/tooltip en el sidebar
  // nativo de cmux. COSMÉTICO fail-open: un cmux sin `set-description` o un fallo
  // del socket NO aborta el dispatch — a diferencia del setColor de arriba, que
  // conserva su semántica pre-existente. Mismo saneado RENDER que workspaceName.
  try {
    await host._legacy.setDescription({
      workspace: workspaceRef,
      description: `⬢ ${task.ref} · ${truncate(stripControlChars(task.title), 60)}`,
    });
  } catch { /* sin description si falla — cosmético */ }

  // KODO-22: sella la identidad ESTABLE del workspace recién creado. `workspace_ref`
  // no vale: cmux recicla los `workspace:N`, y dentro de la tab el host exporta el UUID
  // (`CMUX_WORKSPACE_ID`) — que es contra lo que compara el guard de branding del daemon
  // (shouldBrandWorkspace, server.js). Mismo carril que ya usa launchOrchestrator al
  // registrarse (orchestrator/launch.js).
  //
  // AQUÍ y no después: `addSession` corre PRE-spawn a propósito (Phase 18 D-03 / WR-01),
  // y resolverlo luego con un `updateSession` abriría una ventana en la que la sesión ya
  // existe y el guard todavía no ve su UUID — justo el hueco que esta tarea cierra. El
  // coste medido de `cmux tree --all --json` es ~50ms, sobre los ≥4 round-trips a cmux
  // que este launch ya hace antes de este punto: no mueve la aguja del arranque.
  //
  // Fail-open TOTAL: `resolveWorkspaceId` es never-throws y devuelve `null` si cmux no
  // contesta, el JSON no parsea o el ref no está en el árbol. La sesión es la carga útil;
  // el UUID es identidad de conveniencia — NUNCA aborta el lanzamiento (misma postura que
  // --group, Phase 77). Va por `host._legacy` para no tocar `cmux/client.js` (SC#5); un host
  // que no exponga árbol (NullHost) degrada a `null` SIN caer al cliente cmux por detrás.
  const listTreeFn = host._legacy?.listTree;
  const workspaceId = listTreeFn ? await resolveWorkspaceId(workspaceRef, { listTreeFn }) : null;

  // Build Claude command — prefer opts overrides, fall back to label parsing.
  // CR-01 fix: accept opts.sessionId so the GSD dispatcher can thread the same
  // UUID it stamped into the lock file — acquire, persist and release share
  // identity. Non-GSD paths (no sessionId in opts) keep the pre-existing behavior.
  const sessionId = opts.sessionId || randomUUID();
  const modelOverride = opts.model ?? labelModel;
  const combinedFlags = Array.from(new Set([...(opts.flags || []), ...labelFlags]));
  // KODO-9 bugfix: `claude --worktree` EXIGE un repo git. En proyectos no-git
  // aborta al instante (proceso claude nunca vive) dejando un falso positivo
  // running/alive en state.json. Detectamos el cwd ANTES de montar el comando:
  // git → aislamiento por worktree (Phase 18 intacto); no-git → sin --worktree.
  const gitBacked = isGitRepo(projectPath);
  // KODO-18: hay hosts que YA aíslan por su cuenta. `orca worktree create` materializa
  // un checkout git propio en `~/orca/workspaces/<repo>/<slug>`, así que pedir ADEMÁS
  // `claude --worktree` anidaría un segundo worktree y —lo grave— dejaría el
  // `worktree_path` de state.json apuntando a `<projectPath>/.bg-shell/<sessionId>`, un
  // path que nadie crea: session-end intentaría un cleanup fantasma. Con cmux esto es
  // `false` y TODO el comportamiento previo queda intacto.
  const hostOwnsWorktree = hostIsolatesWorktree(hostName);
  const isolateWithClaude = gitBacked && !hostOwnsWorktree;
  // Phase 18 (D-01, D-02, D-03): compute deterministic worktree path PRE-spawn.
  // Single source of truth: computeWorktreePath de session/state.js (Plan 01).
  // El path NO se crea aquí — `claude --worktree <sessionId>` lo materializa al
  // arrancar la sesión del lado de claude. Plan 03 valida la unicidad del path
  // (D-05 fail-fast canonical error en el dispatcher, fuera de launchWorkItem).
  // KODO-9: solo para proyectos git. En no-git no hay worktree que materializar,
  // así que worktree_path queda sin persistir (buildSessionFromTask lo omite vía
  // spread condicional) y session-end no intenta un cleanup fantasma.
  //
  // KODO-18: cuando el aislamiento lo pone el HOST, el campo NO se deja vacío — se
  // rellena con el checkout que el host creó. `worktree_path` significa «dónde vive el
  // código de esta sesión», y es lo que consume `worktree_path ?? project_path` en
  // dashboard/plan.js: con el campo vacío, el overlay de progreso GSD leería el
  // `.planning/` del repo PRINCIPAL en vez del de la sesión. Lo que NO debe hacerse con
  // un worktree del host es borrarlo al cerrar — eso lo corta la guarda de
  // `performTerminalCleanup`, que es donde vive esa decisión.
  //
  // `workspaceCwd` es OPCIONAL y typeof-detected (solo lo tienen los hosts que crean
  // checkout). Fail-open: si falta o falla, el campo queda vacío y el comportamiento es
  // el de antes de este arreglo — se pierde precisión en el overlay, nunca la sesión.
  let worktreePath = isolateWithClaude ? computeWorktreePath(projectPath, sessionId) : null;
  if (hostOwnsWorktree && typeof host._legacy?.workspaceCwd === 'function') {
    try {
      worktreePath = (await host._legacy.workspaceCwd(workspaceRef)) || null;
    } catch {
      /* fail-open: sin path, el overlay cae a project_path (comportamiento previo) */
    }
  }
  const claudeCmd = buildClaudeCommand(config, sessionId, task, description, modelOverride, combinedFlags, moduleName, isolateWithClaude);
  // KODO-9: traza canónica y greppable cuando se omite el aislamiento por ser no-git.
  if (!gitBacked) {
    console.log(`[kodo] worktree_skipped_nongit — ${task.ref}: ${projectPath} no es un repositorio git; se lanza sin --worktree`);
  } else if (hostOwnsWorktree) {
    // KODO-18: traza hermana, greppable, para no confundir la ausencia de --worktree
    // con el caso no-git de arriba.
    console.log(`[kodo] worktree_skipped_host — ${task.ref}: el host '${hostName}' ya aísla por worktree; se lanza sin --worktree`);
  }

  // Track session in state with generic task fields
  const session = buildSessionFromTask({
    task,
    providerName: config.provider,
    projectPath,
    workspaceRef,
    sessionId,
    // KODO-22: UUID resuelto arriba (o null si el host no contestó). Persistido en el
    // MISMO addSession PRE-spawn — sin updateSession posterior, sin ventana ciega.
    workspaceId,
    flags: combinedFlags,
    // Phase 9: resolver outputs threaded by dispatcher via opts. Conditional
    // spread in buildSessionFromTask omits the fields when undefined — keeps
    // Session records clean for non-GSD paths.
    phaseId: opts.phase_id,
    brief: opts.brief,
    // Phase 18 (D-03): persist el path ANTES de cmux.send. Conditional spread
    // dentro de buildSessionFromTask preserva compat para call sites sin path.
    worktreePath,
    hostName, // KODO-18: el host activo resuelto arriba
  });

  // Phase 18 (D-03 PRE-spawn ordering): persist BEFORE cmux.send so consumers
  // (kodo logs --session-of, stop hook recovery, future readers) see the
  // worktree_path immediately. Si addSession falla, cmux.send NO se llama
  // (la sesión NO arranca) — orden refuerza la garantía de trace previa.
  // Si cmux.send falla tras este addSession, el dispatcher WR-01 ya libera el
  // lock GSD; el SessionRecord queda en estado 'running' hasta el siguiente
  // ciclo de housekeeping (mismo comportamiento que tenemos hoy con session
  // records huérfanos por crashes — no es nueva superficie).
  // WR-01: surface the state-persist fail-safe BEFORE cmux.send. If addSession
  // dropped the write on a lock-timeout, spawning the Claude session would leave
  // an orphaned running agent with no state entry (undercounting max_parallel,
  // enabling duplicate launches). Abort instead — the dispatcher's catch releases
  // the GSD lock. Happy path is unchanged.
  const added = addSession(task.id, session);
  if (added && added.ok === false) {
    throw new Error(
      `state persist failed for ${task.ref} (${added.reason}) — aborting before spawn`,
    );
  }

  // Send Claude command to workspace
  await host._legacy.send({ workspace: workspaceRef, text: claudeCmd });

  // Notify
  await host._legacy.notify({
    title: `kodo: ${task.ref}`,
    // IN-04 (Phase 78): body de la notificación de SO con task.title no confiable. No es
    // carril de keystroke → saneador de RENDER (stripControlChars), consistente con el
    // nombre del workspace de arriba.
    body: `Lanzada sesión para: ${stripControlChars(task.title)}`,
    workspace: workspaceRef,
  });

  // Notify orchestrator if running.
  // KODO-16: el destinatario sale de `resolveOrchestratorTargets` — ref registrado
  // primero, título después. El match por título solo no bastaba: es mutable y
  // window-scoped, así que tras un reinicio del daemon este aviso se perdía en silencio.
  // KODO-20: `opts.getOrchestratorFn` es el seam de aislamiento, gemelo del de
  // `session-end.js`. Sin él, resolver el destinatario LEE el `~/.kodo/state.json` real:
  // hoy nadie ejecuta `launchWorkItem` en la suite (solo hay tests de source-hygiene), así
  // que la fuga es LATENTE, pero el primer test de ejecución que se escriba heredaría
  // exactamente el fallo no determinista que KODO-20 arregló en el hook. Ausente → default
  // al `getOrchestrator` real, comportamiento en producción idéntico.
  // Capturado FUERA del try: dentro, el `(opts) => host._legacy.send(opts)` shadowa el
  // `opts` de la función, y leer el seam desde ahí sería un bug silencioso.
  const getOrchestratorFn = opts.getOrchestratorFn;
  try {
    const workspaces = await host._legacy.listWorkspaces().catch(() => '');
    await sendToOrchestrator(
      (opts) => host._legacy.send(opts),
      resolveOrchestratorTargets(workspaces, { getOrchestratorFn }),
      `Nueva sesión lanzada: ${stripForKeystroke(task.ref)} (${stripForKeystroke(task.title)}) en ${workspaceRef}. Path: ${stripForKeystroke(projectPath)}\\n`,
    );
  } catch {}

  return session;
}

/**
 * @param {ReturnType<import('../config.js').loadConfig>} config
 * @param {string} sessionId
 * @param {import('../interface.js').TaskItem} task
 * @param {string} description
 * @param {string|null|undefined} modelOverride
 * @param {string[]} [kodoFlags]
 * @param {string|null} [moduleName]
 * @param {boolean} [isGitRepo] - KODO-9: cuando es `false` (proyecto no-git) se
 *   OMITE `--worktree`, porque `claude --worktree` exige un repo git y aborta si
 *   no lo hay. Default `true` → backward-compat total (proyectos git y todos los
 *   callers/tests previos siguen emitiendo `--worktree` exactamente como antes).
 */
export function buildClaudeCommand(config, sessionId, task, description, modelOverride, kodoFlags = [], moduleName = null, isGitRepo = true) {
  const model = modelOverride || config.claude.default_model;
  const moduleCtx = moduleName ? ` Módulo: ${moduleName}.` : '';
  const prompt = `Trabaja en: ${task.title}.${moduleCtx} ${description ? 'Descripción: ' + description : ''}`.trim();

  // Las sesiones GSD (full y quick) corren slash commands autónomos; pedir
  // confirmación por tool call rompe la automatización. Cualquier modo GSD
  // implica skip-permissions, igual que kodo:yolo explícito. Un solo punto
  // de cambio: añadir un nuevo modo a getGsdMode() basta (D-01/D-02 Phase 11).
  const skipPerms = kodoFlags.includes('yolo') || getGsdMode(kodoFlags) !== null;
  const cliFlags = skipPerms ? '--dangerously-skip-permissions' : '';

  // Phase 18 (D-01, D-06b): `--worktree <sessionId>` se emite para las sesiones de
  // launchWorkItem (full + quick + no-GSD) SIEMPRE QUE el proyecto sea git (KODO-9).
  // El sessionId va como arg POSICIONAL explícito (NO `--worktree=...`, NO bare
  // `--worktree`) para garantizar el path determinístico `<projectPath>/.bg-shell/<sessionId>`.
  //
  // KODO-9: en proyectos no-git (`isGitRepo === false`) el flag se OMITE por
  // completo — `claude --worktree` exige un repo git y aborta si no lo hay. El
  // `.replace(/\s+/g, ' ')` colapsa el hueco que deja el flag ausente.
  //
  // Orden de flags (contractual, golden-bytes QUICK-07):
  //   --model X --session-id Y [--worktree Y] [--dangerously-skip-permissions] <prompt-ref>
  //
  // Las tags `[GSD quick]`/`[GSD phase N]`/`[GSD bootstrap]` viven en el PROMPT
  // (último arg) — añadir `--worktree` en el header NO muta los offsets relativos
  // de las tags. Phase 20 (HOOK-01) opera sobre buildSessionContext/buildGsdContext.
  // Mecánica de invocación desde el registro de agentes (config.agents) — un solo
  // punto de cambio para multi-agente. Para 'claude-code' el header resultante es
  // byte-idéntico al literal previo (golden-bytes QUICK-07 intactos).
  const agent = getAgentDef(config);
  const worktreeFlag = isGitRepo ? `--worktree ${sessionId}` : '';
  const header = `${agent.binary} ${agent.model_flag} ${model} ${agent.session_id_flag} ${sessionId} ${worktreeFlag} ${cliFlags}`.replace(/\s+/g, ' ').trim();

  // El prompt NO se teclea inline. `host._legacy.send` → `cmux send` inyecta el
  // comando como PULSACIONES de teclado, e interpreta `\n`/`\r`/`\t` como
  // Enter/Tab; además puede perder caracteres mientras el shell del workspace
  // termina de arrancar (powerlevel10k instant-prompt, nvm, direnv…). Cualquiera
  // de las dos cosas parte el comando a mitad → el síntoma "prompt cortado, hay
  // que ponerlo a mano". Lo escribimos a un fichero temporal y tecleamos solo una
  // referencia corta y ASCII; el shell expande `"$(cat …)"` EN EJECUCIÓN, sin
  // escapes ni multibyte en la línea tecleada. El contenido va sin tocar: command
  // substitution entre comillas dobles lo pasa como un único argumento literal a
  // claude (sin re-interpretar comillas ni colapsar espacios).
  const promptPath = writePromptFile(sessionId, prompt);
  return `${header} "$(cat ${promptPath})"`;
}

/**
 * @param {string} str
 * @param {number} max
 */
function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/**
 * Update a session's status and emit a typed state.transition event when a
 * logger is provided. Retrocompatible: callers that do not pass a logger
 * behave identically to a direct updateSession() call.
 *
 * Phase 30 LIFE-02 (WR-07 Phase 22 closure): el path de falsy `taskId` ya
 * NO es un no-op silencioso. Emite un warn observable cuando hay logger y
 * retorna un shape determinístico discriminado para facilitar drift-debugging
 * futuro. Callers existentes (verify.js#267, stop.js#188) NO capturan el
 * return value — fire-and-forget dentro de try/catch — por lo que la
 * semántica externa se preserva intacta (D-06).
 *
 * @param {string} taskId
 * @param {'running'|'idle'|'needs-input'|'dead'|'closed'|'done'|'error'|'review'|'interrupted'} nextStatus
 *   Phase 38 D-04: 4 estados nuevos del ciclo de vida (idle/needs-input/dead/closed)
 *   sumados a los legacy. `'done'` es input DEPRECATED — el shim lo mapea a `'idle'`
 *   antes de persistir (D-12; eliminado en v0.10).
 * @param {string} reason
 * @param {import('../logger.js').Logger} [logger]
 * @param {string} [sessionId] - Phase 30 D-07: opcional, para observability del
 *   falsy-taskId warn payload. Defaults a 'unknown' string literal cuando no se
 *   provee. Callers en producción (verify.js + stop.js) ya tienen `session.session_id`
 *   en scope y lo pasan como 5º arg.
 * @returns {{ok: true, from: string, to: string} | {ok: false, reason: 'missing-task-id' | 'lock-timeout'}}
 *   Discriminated union (D-05). Success path expone `from`/`to` para observabilidad
 *   downstream; falsy path expone `reason: 'missing-task-id'` (kebab-case literal)
 *   o `reason: 'lock-timeout'` (WR-01: el updateSession subyacente no persistió).
 *   Phase 38: `to` puede ser `'idle'` cuando el caller pasó `'done'` (post-shim).
 */
export function markSessionStatus(taskId, nextStatus, reason, logger, sessionId) {
  // Phase 38 D-12: compat shim 'done' → 'idle'. Eliminado en v0.10.
  // El stop hook ya no marca las sesiones como muertas/done — quedan 'idle'
  // (lock liberado, esperando humano). Los callers legacy externos que aún
  // emitan 'done' reciben un warn DEPRECATED y el mapeo automático. El shim
  // corre ANTES del guard !taskId para que el warn refleje el input real.
  if (nextStatus === 'done') {
    if (logger) {
      logger.warn('markSessionStatus.deprecated', {
        input_status: 'done',
        mapped_to: 'idle',
        task_id: taskId,
        session_id: sessionId || 'unknown',
        reason,
      });
    }
    nextStatus = 'idle';
  }

  // Phase 30 D-09: falsy guard. Cubre null, undefined, '' simultáneamente
  // (mismo idiom defensivo que isGsdChild en src/labels.js#114). NO se llama a
  // listSessions ni updateSession en el falsy path — early return preserva la
  // semántica de no-op silencioso pero ahora con observabilidad observable.
  if (!taskId) {
    if (logger) {
      // SC#2 ROADMAP literal byte-exact (single space después del colon).
      // Keys locked: {session_id, status, reason}.
      // D-07 fallback: sessionId opcional → 'unknown' string literal.
      // NO `logger.child(...)` aquí — no hay task_id válido para el child context.
      logger.warn('markSessionStatus: missing task_id', {
        session_id: sessionId || 'unknown',
        status: nextStatus,
        reason,
      });
    }
    return { ok: false, reason: 'missing-task-id' };
  }

  // Success path (D-05): preservado del comportamiento Phase 16/19.
  // listSessions() scan ONLY state.sessions — fromStatus de sesiones archivadas
  // reporta 'unknown' (pitfall #3 de PATTERNS.md — out of scope para Phase 30).
  const current = listSessions().find((s) => s.task_id === taskId || s.task_ref === taskId);
  const fromStatus = current?.status || 'unknown';
  // WR-01: updateSession returns the lock fail-safe. If the write was dropped on
  // a lock-timeout, do NOT emit the state-transition log or report success — the
  // status never persisted, so callers must not believe the transition happened.
  const upd = updateSession(taskId, { status: nextStatus });
  if (upd && upd.ok === false) {
    if (logger) {
      logger.warn('markSessionStatus.persist_failed', {
        session_id: sessionId || 'unknown',
        task_id: taskId,
        status: nextStatus,
        reason: upd.reason,
      });
    }
    return { ok: false, reason: 'lock-timeout' };
  }
  if (logger) {
    const log = logger.child({ component: 'session', task_id: taskId });
    stateTransition(log, { from: fromStatus, to: nextStatus, reason });
  }
  return { ok: true, from: fromStatus, to: nextStatus };
}
