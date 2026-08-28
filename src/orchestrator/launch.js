// @ts-check
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { loadConfig, isReportToProviderEnabled, getAgentDef } from '../config.js';
import { listSessions, getOrchestrator, setOrchestrator, clearOrchestrator } from '../session/state.js';
import { getHost, resolveHostName } from '../host/interface.js';
import { findWorkspaceInTree, resolveWorkspaceId } from '../host/workspace-id.js';
import { getSessionMode } from '../labels.js';
import { stripForPrompt } from '../cli/sanitize.js';
import { syncSkill } from '../skill/sync.js';
import { skillSyncAuto, skillSyncAutoError } from '../logger-events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, 'prompt.md');
export const ORCHESTRATOR_WORKSPACE_NAME = 'kodo-orchestrator';

// Ref persistido del orquestador. El daemon (POST /orchestrator) lo LEE de aquí en vez de
// consultar cmux en vivo: `cmux workspace list` es window-scoped (limitación P-4) y el daemon
// detached vive en otro window, así que una consulta en vivo jamás vería el ref del orquestador.
// launchOrchestrator (que SÍ corre en el window correcto, con TTY) lo escribe al lanzar/refrescar.
export const ORCHESTRATOR_REF_PATH = join(homedir(), '.kodo', 'orchestrator.json');

/**
 * Cliente de lifecycle del host ACTIVO (KODO-18).
 *
 * Este módulo hablaba con `cmux/client.js` directamente — era el último carril de kodo
 * cableado a un host concreto. Ahora pasa por `_legacy`, el mismo shape de funciones que
 * ya consumían `session/manager.js` y `session/health.js`, así que `kodo orchestrate`
 * funciona igual con `host: orca`.
 *
 * FAIL-SAFE: si la resolución del host falla (config ilegible, host desconocido),
 * `resolveHostName` ya cae a `'cmux'`; este try/catch adicional cubre el caso extremo de
 * que la factory lance, devolviendo un cliente de no-ops en vez de reventar el launch.
 *
 * @returns {any} cliente con newWorkspace/setColor/send/notify/listWorkspaces/listTree.
 */
function hostLegacy() {
  try {
    return getHost(resolveHostName())._legacy;
  } catch {
    return {};
  }
}

/**
 * Persiste el `workspace:N` del orquestador a ~/.kodo/orchestrator.json. never-throws
 * (fail-open): si el write falla, la tecla `O` degrada al hint "kodo orchestrate", pero el
 * launch NUNCA se rompe por no poder persistir el ref.
 *
 * @param {string} ref - `workspace:N` recién resuelto o creado.
 */
export function persistOrchestratorRef(ref) {
  try {
    writeFileSync(ORCHESTRATOR_REF_PATH, JSON.stringify({ ref }) + '\n');
  } catch {
    /* fail-open — persistir el ref es best-effort, no bloquea el launch */
  }
}

/**
 * Lee el `workspace:N` persistido del orquestador. never-throws → `null` si el fichero no
 * existe, es ilegible o su shape es inválida. El endpoint /orchestrator lo usa para resolver
 * el ref SIN cmux (daemon-safe, window-independiente).
 *
 * Staleness: si el workspace persistido murió (orquestador cerrado), el ref queda stale; el
 * focus downstream (cmux select-workspace) falla con el error de focus normal — aceptable
 * para una tecla de conveniencia (mismo trade-off que el ref reciclado de reconcile).
 *
 * @returns {string|null}
 */
export function readOrchestratorRef() {
  try {
    const data = JSON.parse(readFileSync(ORCHESTRATOR_REF_PATH, 'utf-8'));
    return typeof data?.ref === 'string' && data.ref ? data.ref : null;
  } catch {
    return null;
  }
}

/**
 * Resuelve el ref del orquestador desde el texto crudo de `listWorkspaces()`.
 * Puro / never-throws: devuelve el ref si `kodo-orchestrator` está en la lista, o `null`.
 * Fuente única de verdad del match (reusado por launchOrchestrator y el endpoint /orchestrator).
 *
 * KODO-18 — la regex dejó de exigir el shape `workspace:N` de cmux para admitir también el
 * `<repoId>::<path>` de Orca. Sigue siendo igual de estricta gracias al ANCLA DE LÍNEA: el
 * ref debe ser el PRIMER token de su línea y `kodo-orchestrator` el título COMPLETO, así que
 * un workspace titulado `"mi kodo-orchestrator"` no matchea (antes tampoco). Tolera el
 * sangrado y el marcador `*` de la fila seleccionada que cmux imprime.
 *
 * Formatos cubiertos (verificados contra ambos binarios):
 *   cmux → `  workspace:12  kodo-orchestrator`  ·  `* workspace:3  kodo-orchestrator  [selected]`
 *   orca → `<repoId>::/path/kodo-orchestrator  kodo-orchestrator`
 *
 * @param {string} workspaceListText - salida cruda de `listWorkspaces()`.
 * @returns {string|null} ref del host, o null si no existe / input no-string.
 */
export function findOrchestratorRef(workspaceListText) {
  if (typeof workspaceListText !== 'string') return null;
  const match = workspaceListText.match(
    /^[^\S\n]*\*?[^\S\n]*(\S+)[^\S\n]+kodo-orchestrator[^\S\n]*(?:\[selected\])?[^\S\n]*$/m,
  );
  return match ? match[1] : null;
}

// ── Revalidación por identidad (KODO-16) ──────────────────────────────────────
// `findOrchestratorRef` de arriba pregunta «¿hay una tab TITULADA kodo-orchestrator
// en MI window?». Las dos mitades de esa pregunta fallan:
//   · el título es mutable — `startServer` renombra a `心動 kodo service` el workspace
//     del que hereda CMUX_WORKSPACE_ID (server.js:859), así que reiniciar el daemon
//     desde la tab del orquestador le borra el nombre;
//   · `workspace list` es window-scoped (P-4) — un check desde otro window no la ve.
// En ambos casos el orquestador vivo se vuelve invisible y `kodo check` lanza un
// segundo supervisor sobre el mismo state.json y la misma cola.
// El carril de abajo pregunta en cambio «¿sigue vivo el workspace que REGISTRAMOS?»,
// contra `tree --all --json` (cross-window) y por UUID (inmune al rename Y al
// reciclaje de refs). `findOrchestratorRef` se conserva como fallback de migración
// para el orquestador que ya estuviera corriendo sin registro.

// `findWorkspaceInTree` y `resolveWorkspaceId` VIVEN en `../host/workspace-id.js`
// desde KODO-22 y se re-exportan aquí sin cambios (call sites y tests intactos).
// Se movieron porque `session/manager.js` necesita resolver el UUID del workspace
// de una sesión recién lanzada y NO puede importar este módulo: launch.js es el
// arranque completo del orquestador (prompt.md, sync de la skill, provider) y el
// dispatch de sesiones es camino caliente. Ese conocimiento es del HOST (la shape
// de su árbol), no del orquestador — misma frontera que motivó `target.js`.
export { findWorkspaceInTree, resolveWorkspaceId } from '../host/workspace-id.js';

/**
 * Revalida el registro del orquestador contra el host. Es el gate que decide si
 * `launchOrchestrator` puede crear un workspace nuevo.
 *
 * Veredictos:
 *   - `none`         — no hay registro. El caller sigue a su fallback y, si tampoco
 *                      encuentra nada, lanza.
 *   - `alive`        — el workspace registrado existe en algún window. NO lanzar.
 *   - `dead`         — el host respondió y el workspace NO está. Registro huérfano:
 *                      el caller lo limpia y lanza (criterio 3: la cola nunca se
 *                      queda sin supervisor).
 *   - `unverifiable` — hay registro pero el host no contestó (cmux caído, timeout,
 *                      JSON corrupto). NO lanzar.
 *   - `foreign-host` — hay registro pero se creó bajo OTRO cliente (KODO-18). NO lanzar
 *                      sin `--force`.
 *
 * `foreign-host` NO es `dead` (aunque el ref no aparezca) ni `unverifiable` (aunque no
 * se pueda comprobar), y merecía su propio veredicto en vez de colarse en cualquiera de
 * los dos:
 *
 *   · NO es `dead`, que exige «el host respondió y el workspace NO está». Aquí el host
 *     respondió sobre OTRO universo: la ausencia de un `workspace:N` en el árbol de Orca
 *     es ESTRUCTURAL, no evidencia de muerte. Tratarlo como dead limpiaba el registro y
 *     arrancaba un segundo supervisor mientras el primero seguía vivo — el escenario que
 *     el párrafo de abajo describe como «hace falta un humano para deshacerlo».
 *   · NO es `unverifiable`, cuya justificación entera es «el siguiente check reintenta a
 *     los pocos minutos». Aquí reintentar no resuelve NADA: la ceguera es permanente
 *     mientras no se vuelva al otro cliente, así que devolverlo dejaría la cola sin
 *     supervisor para siempre — violando el criterio 3.
 *
 * Por eso el veredicto propio: no se lanza solo, pero el mensaje dice exactamente qué
 * hacer y `--force` es la salida explícita. La decisión es del operador, que es el único
 * que puede mirar el otro cliente.
 *
 * El caso `unverifiable` es la única decisión no obvia, y va deliberadamente en
 * contra del fail-open habitual del repo. La asimetría de coste lo justifica: dos
 * orquestadores vivos comparten state.json y la cola — despachan la misma tarea dos
 * veces, se pisan los nudges y duplican comentarios en el provider, y hace falta un
 * humano para deshacerlo. No lanzar en cambio solo pierde UN pase: el siguiente check
 * reintenta a los pocos minutos, y si cmux está de verdad caído el launch tampoco
 * habría funcionado (`newWorkspace` habla con el mismo binario). «Muerto» exige
 * evidencia POSITIVA — silencio del host no es evidencia.
 *
 * @param {{
 *   listTreeFn?: () => Promise<string>,
 *   getOrchestratorFn?: () => import('../session/state.js').OrchestratorRegistration|null,
 *   hostName?: string,
 * }} [deps]
 * @returns {Promise<{ status: 'none' }
 *   | { status: 'alive'|'dead'|'unverifiable', ref: string }
 *   | { status: 'foreign-host', ref: string, host: string }>}
 */
export async function verifyRegisteredOrchestrator(deps = {}) {
  const listTreeFn = deps.listTreeFn || (() => hostLegacy().listTree());
  const getOrchestratorFn = deps.getOrchestratorFn || getOrchestrator;
  const hostName = deps.hostName ?? resolveHostName();

  const reg = getOrchestratorFn();
  if (!reg) return { status: 'none' };

  // KODO-18: registro de otro cliente. Se decide ANTES de tocar el árbol — preguntarle a
  // un host por el ref de otro no puede dar información, solo la ilusión de haberla
  // buscado (y una llamada de I/O de más). Exige evidencia POSITIVA de discrepancia:
  // un registro legacy sin `host` cae al camino de siempre.
  if (reg.host && hostName && reg.host !== hostName) {
    return { status: 'foreign-host', ref: reg.workspace_ref, host: reg.host };
  }

  let tree;
  try {
    tree = JSON.parse(await listTreeFn());
  } catch {
    return { status: 'unverifiable', ref: reg.workspace_ref };
  }

  const hit = findWorkspaceInTree(tree, { id: reg.workspace_id, ref: reg.workspace_ref });
  if (!hit) return { status: 'dead', ref: reg.workspace_ref };
  return { status: 'alive', ref: hit.ref || reg.workspace_ref };
}

// Phase 21 D-08 + Pattern C: KODO_ROOT override aditivo para test isolation
// (mismo patrón que src/hooks/stop.js:20; permite spawnSync con env.KODO_ROOT=tmpRepo).
const KODO_ROOT_FOR_SKILL = process.env.KODO_ROOT || process.cwd();

/**
 * Resolve {{placeholder}} tokens in the orchestrator prompt template.
 *
 * @param {string} template  Raw prompt.md content
 * @param {{ provider: string }} config  Active provider config
 * @returns {string} Prompt with all placeholders replaced
 */
export function resolvePromptTemplate(template, config) {
  const providerName = config.provider.charAt(0).toUpperCase() + config.provider.slice(1);
  const mcpTool = `${providerName} MCP server`;

  return template
    .replaceAll('{{provider_name}}', providerName)
    .replaceAll('{{provider}}', config.provider)
    .replaceAll('{{mcp_tool}}', mcpTool);
}

/**
 * Strip the reporting section from the prompt when reporting is disabled.
 * Block delimiters: <!-- BEGIN reporting --> ... <!-- END reporting -->
 * Markers included in the strip. When enabled === true, returns the prompt
 * unchanged. Idempotent: applying with enabled=false twice on the same
 * prompt yields identical output.
 *
 * Why a separate helper (not extending resolvePromptTemplate): placeholder
 * substitution and conditional gating are different concerns. Keeping them
 * separate makes each unit-testable in isolation and allows future gates
 * (other markers) without inflating resolvePromptTemplate.
 *
 * @param {string} prompt - Prompt content (may already be post-resolvePromptTemplate)
 * @param {boolean} enabled - true keeps the section, false strips it (markers included)
 * @returns {string}
 */
export function applyReportingGate(prompt, enabled) {
  if (enabled) return prompt;
  return prompt.replace(
    /<!-- BEGIN reporting -->[\s\S]*?<!-- END reporting -->\n?/g,
    '',
  );
}

/**
 * Construye el comando `claude` del ORQUESTADOR. Función PURA (sin I/O) — espejo de
 * `buildClaudeCommand` (session/manager.js) para el otro carril.
 *
 * KODO-12 — el modelo sale de `claude.orchestrator_model` (default `fable`), NO de
 * `claude.default_model`: el orquestador supervisa y despacha (lee `state.json`, hace
 * `read-screen`, manda nudges), mientras que `default_model` rige las sesiones de TRABAJO
 * que sí implementan. El `??` cubre un config parcial inyectado por un caller — `loadConfig`
 * rellena la clave por deep-merge, pero esta función no asume haber pasado por ahí.
 *
 * El prompt se recibe CRUDO y se envuelve en comillas simples tras escapar las que
 * contenga (`'` → `'\''`): el comando se teclea por `cmux.send`, así que las simples son
 * las únicas que neutralizan `$`, backtick y `$(...)` del texto del prompt.
 *
 * @param {ReturnType<import('../config.js').loadConfig>} config
 * @param {string} sessionId
 * @param {string} prompt - prompt del orquestador SIN escapar.
 * @returns {string} línea de comando lista para `cmux.send`.
 */
export function buildOrchestratorCommand(config, sessionId, prompt) {
  const escapedPrompt = String(prompt).replace(/'/g, "'\\''");
  const agent = getAgentDef(config);
  return [
    // HYG-01 (D-07): prefijo de entorno del shell que marca esta sesión como la
    // orquestadora. Se une con ' ' y se envía como texto por cmux.send (NO hay
    // spawn), así que el shell del workspace lo exporta al proceso `claude` y a
    // sus hijos (los hooks Stop/SessionEnd). El gate de stop.js lo lee para
    // habilitar el auto-commit de aprendizajes de la skill.
    'KODO_ORCHESTRATOR=1',
    // Mecánica del registro de agentes (config.agents, getAgentDef) — para
    // 'claude-code' produce exactamente `claude --model <m> --session-id <sid>`.
    agent.binary,
    agent.model_flag, config.claude.orchestrator_model ?? config.claude.default_model,
    agent.session_id_flag, sessionId,
    ...(config.claude.flags ?? []),
    `'${escapedPrompt}'`,
  ].join(' ');
}

/**
 * Launch the orchestrator Claude session in a dedicated cmux workspace.
 *
 * ADVISORY-03 / Plan 31-03 — Opción A "Lifecycle Simulator Hook".
 * `opts.spawnFn` es un DI hook OPCIONAL invocado post-cmux.send/notify y
 * pre-return en el branch new-workspace. Default `undefined` preserva el
 * comportamiento byte-exact pre-Phase-31: en producción, el lifecycle real
 * (addSession + sessionStart + NDJSON emission) lo realiza el binario
 * `claude` que cmux arranca DENTRO del workspace cmux tras `cmux.send`.
 * Los tests del ADVISORY-03 inyectan `spawnFn` para simular ese lifecycle
 * downstream y validar observables reales (state.json + NDJSON head-line
 * con event=session.start + transcript_path populated) sin requerir claude
 * ni cmux reales.
 *
 * KODO-16 — dos gates ANTES de crear nada, en este orden:
 *   1. `verifyRegisteredOrchestrator()`: revalida el registro de state.json contra el
 *      host (cross-window, por UUID). alive/unverifiable → return sin lanzar; dead →
 *      limpia el registro huérfano y sigue.
 *   2. `findOrchestratorRef()`: el check legacy por título (window-scoped), como
 *      fallback de migración. Si acierta, adopta ese workspace en el registro.
 * Idempotencia: en el camino nuevo, el workspace queda registrado antes del `cmux.send`.
 *
 * @param {{
 *   logger?: import('../logger.js').Logger,
 *   force?: boolean,
 *   spawnFn?: (ctx: {
 *     workspaceRef: string,
 *     sessionId: string,
 *     projectPath: string,
 *     kodoDir: string,
 *     taskRef: string,
 *   }) => Promise<void> | void,
 * }} [opts]
 * @returns {Promise<{ workspace: string, existing: boolean, verified?: boolean, foreignHost?: string }>}
 *   `verified:false` marca los casos en que `existing:true` NO significa «lo he visto
 *   vivo», sino «hay uno registrado y no he podido comprobarlo, así que no lanzo»:
 *   el host no contesta, o el registro es de otro cliente (`foreignHost`, KODO-18).
 */
export async function launchOrchestrator(opts = {}) {
  const config = loadConfig();
  const log = opts.logger?.child({ component: 'orchestrator' });
  log?.info('orchestrator.launch.start', { provider: config.provider });

  // ─── PHASE 21 D-03 fail-open auto-sync ──────────────────────────────────
  // Sincroniza canonical skill <repo>/.claude/skills/kodo-orchestrate/ → home
  // ANTES del primer side-effect cmux (D-08 SoSoT: mismo módulo que kodo skill sync).
  //
  // Insertado aquí (no antes de cmux.newWorkspace L70) para cubrir el caso
  // "orchestrator ya existe": el operador hace `kodo orchestrate` para refrescar
  // y home debe quedar coherente — RESEARCH §Inserción L44 vs L70.
  //
  // Si syncSkill falla: emit skill.sync.auto.error + continuar (D-03 fail-open —
  // la skill local del repo gana por construcción Phase 999.1 D-04, así el
  // orchestrator funciona aunque home quede stale). NUNCA prune (D-05c).
  //
  // SKILL-03 invariante: este bloque NO toca process.cwd() ni los args de
  // cmux.newWorkspace({ cwd: process.cwd() }) (línea ~72). La skill canonical
  // sigue siendo la del repo (cwd=repo Phase 999.1 D-04/D-05/D-06 intacto).
  try {
    const skillSource = join(KODO_ROOT_FOR_SKILL, '.claude', 'skills', 'kodo-orchestrate');
    const skillDest = join(homedir(), '.claude', 'skills', 'kodo-orchestrate');
    const skillResult = syncSkill({ source: skillSource, dest: skillDest }); // prune NEVER true (D-05c)
    if (skillResult.status === 'error') {
      if (log) skillSyncAutoError(log, { source: skillSource, dest: skillDest, error: skillResult.error || 'unknown' });
    } else if (skillResult.status === 'ok') {
      if (log) skillSyncAuto(log, { source: skillSource, dest: skillDest, files_changed: skillResult.files_changed });
    }
    // status === 'noop' → silencio total (D-03b — sin .noop event para evitar ruido).
  } catch (err) {
    // Defense in depth: si syncSkill throws inesperado, fail-open vía evento
    // NDJSON (no console.error — preservar el principio "fail-open via event"
    // del patrón Phase 19 cleanup D-03).
    if (log) {
      try {
        const skillSource = join(KODO_ROOT_FOR_SKILL, '.claude', 'skills', 'kodo-orchestrate');
        const skillDest = join(homedir(), '.claude', 'skills', 'kodo-orchestrate');
        skillSyncAutoError(log, { source: skillSource, dest: skillDest, error: /** @type {Error} */ (err).message });
      } catch {
        // silent — never crash the launch
      }
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  // ─── Gate 1 (KODO-16): revalidar el orquestador REGISTRADO contra el host ────
  // Primero por identidad persistida, porque es el único check que sobrevive tanto a
  // un rename de la tab como a correr desde otro window. Solo si este carril no
  // resuelve nada se consulta la detección por título de abajo.
  // KODO-18: el host activo se resuelve UNA vez por launch y se sella en el registro,
  // para que un `kodo orchestrate` posterior sepa bajo qué host se creó.
  const hostName = resolveHostName();
  const verdict = await verifyRegisteredOrchestrator({ hostName });
  if (verdict.status === 'alive') {
    // SIN nudge de refresh (decisión operador 2026-07-14, resuelve el spam que motivó la
    // Phase 73): el orquestador ya se auto-pacea con sus rondas de supervisión, y cualquier
    // disparador repetido (kodo check/orchestrate con needsOrchestrator legítimamente true)
    // re-inyectaba el mismo texto en CADA llamada quemando tokens. El nudge útil por-evento
    // (cierre de sesión) vive en session-end.js vía buildStopNudgeText — ese se conserva.
    console.log('[kodo] Orchestrator workspace already exists');
    persistOrchestratorRef(verdict.ref); // refresca el ref persistido (daemon/tecla O)
    return { workspace: verdict.ref, existing: true };
  }
  if (verdict.status === 'unverifiable') {
    // Hay registro pero el host no contesta. Abortamos SIN lanzar: ver la asimetría de
    // coste documentada en verifyRegisteredOrchestrator. El siguiente check reintenta.
    console.log(
      `[kodo] Orchestrator registrado en ${verdict.ref} pero cmux no responde — no se lanza otro`,
    );
    return { workspace: verdict.ref, existing: true, verified: false };
  }
  if (verdict.status === 'foreign-host') {
    // KODO-18 — el registro es de OTRO cliente, así que este host no puede decir nada
    // sobre él: su ausencia del árbol es estructural, no evidencia de muerte. Lanzar
    // igualmente arrancaría un segundo supervisor mientras el primero quizá sigue vivo,
    // y dos supervisores sobre el mismo state.json duplican comentarios en el provider y
    // despachan la misma tarea dos veces. Bloquear para siempre tampoco vale: reintentar
    // no resuelve nada mientras no se vuelva al otro cliente.
    //
    // Así que la decisión es del OPERADOR — el único que puede mirar el otro cliente — y
    // el mensaje dice exactamente qué hacer. `--force` es la salida explícita.
    if (!opts.force) {
      console.log(
        `[kodo] Orchestrator registrado en ${verdict.ref} pertenece al host '${verdict.host}' ` +
          `y el host activo es '${hostName}' — NO se lanza otro.\n` +
          `[kodo]   Desde '${hostName}' no puedo ver si sigue vivo. Si el orquestador de ` +
          `'${verdict.host}' está abierto, ciérralo; después: kodo orchestrate --force`,
      );
      return { workspace: verdict.ref, existing: true, verified: false, foreignHost: verdict.host };
    }
    console.log(
      `[kodo] --force: se descarta el registro del host '${verdict.host}' y se lanza en '${hostName}'`,
    );
    clearOrchestrator();
  }
  if (verdict.status === 'dead') {
    // Evidencia positiva de muerte: el host respondió y el workspace no está. Se limpia
    // el registro para que la cola no quede sin supervisor y se sigue al launch.
    console.log(`[kodo] Orchestrator registrado en ${verdict.ref} ya no existe — se relanza`);
    clearOrchestrator();
  }

  // ─── Gate 2 (legacy): detección por título, window-scoped ────────────────────
  // Cubre el orquestador que ya estuviera corriendo cuando no existía el registro.
  // Si lo encuentra, lo ADOPTA (resuelve su UUID y lo registra) para que a partir de
  // aquí sobreviva a renames y a un check desde otro window.
  let workspaceList;
  try {
    workspaceList = await hostLegacy().listWorkspaces();
  } catch {
    workspaceList = '';
  }

  const existingRef = findOrchestratorRef(workspaceList);
  if (existingRef) {
    console.log('[kodo] Orchestrator workspace already exists');
    persistOrchestratorRef(existingRef);
    setOrchestrator({
      workspace_ref: existingRef,
      workspace_id: await resolveWorkspaceId(existingRef),
      // Adopción: el session-id real lo eligió el launch original, que no dejó rastro.
      // El campo es informativo (no participa de la revalidación), así que vacío es
      // honesto — mejor que inventar un UUID que no corresponde a ninguna sesión.
      session_id: '',
      started_at: new Date().toISOString(),
      host: hostName, // KODO-18
    });
    return { workspace: existingRef, existing: true };
  }

  // Build context summary
  const sessions = listSessions();
  const contextSummary = buildContextSummary(sessions, config);

  // Read orchestrator prompt and resolve provider placeholders
  const rawPrompt = readFileSync(PROMPT_PATH, 'utf-8');
  const basePrompt = applyReportingGate(
    resolvePromptTemplate(rawPrompt, { provider: config.provider || 'plane' }),
    isReportToProviderEnabled(),
  );

  // Create workspace
  const workspaceRef = await hostLegacy().newWorkspace({
    name: ORCHESTRATOR_WORKSPACE_NAME,
    cwd: process.cwd(),
  });

  // Set orchestrator color (Indigo). KODO-18: en orca `setColor` es un no-op documentado
  // (no hay color por workspace) y la tarjeta se identifica por su nombre — el orquestador
  // no es una tarea, así que NO se le asigna una columna del tablero.
  await hostLegacy().setColor({ workspace: workspaceRef, color: 'Indigo' });

  // Build Claude command with orchestrator prompt + context
  const sessionId = randomUUID();

  // KODO-16: registrar la identidad AQUÍ, con la tab ya creada y ANTES del `cmux.send`.
  // El orden importa: si el send fallara, el workspace ya existe, y sin registro previo
  // el siguiente check crearía otro encima. Registrado, la revalidación lo ve vivo y no
  // duplica (el operador arregla la tab a medias; kodo no la multiplica).
  setOrchestrator({
    workspace_ref: workspaceRef,
    workspace_id: await resolveWorkspaceId(workspaceRef),
    session_id: sessionId,
    started_at: new Date().toISOString(),
    host: hostName, // KODO-18
  });

  const prompt = `${basePrompt}\n\n## Situación actual\n\n${contextSummary}`;

  // ─────────────────────────────────────────────────────────────────────
  // Phase 18 D-06: launchOrchestrator EXCLUIDO de --worktree.
  //
  // El orchestrator necesita cwd = repo kodo (línea cmux.newWorkspace
  // arriba: `cwd: process.cwd()`) para que Claude Code auto-cargue
  // `.claude/skills/kodo-orchestrate/skill.md` (Phase 999.1 D-05/D-06
  // constraint registrado en PROJECT.md §Constraints).
  //
  // Si se añadiera --worktree aquí, la sesión arrancaría en
  // <repo>/.bg-shell/<uuid>/ donde NO existe la skill, regresando al
  // fallback degradado de src/orchestrator/prompt.md (~37 LOC).
  //
  // Source-hygiene blindado por test/orchestrator-launch-isolation.test.js
  // que grep-asserta `--worktree` ausente del código (los comentarios sí
  // pueden mencionarlo — el test usa stripComments).
  //
  // Las sesiones de TRABAJO (launchWorkItem) sí van con --worktree (Plan 02
  // WT-01 + D-06b universal). Solo el orchestrator queda exento.
  // ─────────────────────────────────────────────────────────────────────
  const claudeCmd = buildOrchestratorCommand(config, sessionId, prompt);

  await hostLegacy().send({ workspace: workspaceRef, text: claudeCmd + '\\n' });

  // Notify
  await hostLegacy().notify({
    title: 'kodo: Orchestrator',
    body: `Lanzado con ${sessions.length} sesiones activas`,
    workspace: workspaceRef,
  });

  console.log(`[kodo] Orchestrator launched → ${workspaceRef}`);
  persistOrchestratorRef(workspaceRef); // persiste el ref para el daemon/tecla O (window-independiente)

  // ─── ADVISORY-03 (Plan 31-03) Opción A — Lifecycle Simulator Hook ──────
  // `opts.spawnFn` es un DI hook opcional. Default `undefined` → if-guard
  // lo elide y producción mantiene comportamiento byte-exact pre-Phase-31:
  // el lifecycle real (addSession + sessionStart + NDJSON) lo hace el
  // binario `claude` que cmux arranca dentro del workspace tras `cmux.send`
  // (ver línea ~184). Los tests del ADVISORY-03 inyectan `spawnFn` para
  // simular ese lifecycle downstream y verificar observables reales
  // (state.json mutado + NDJSON head-line con event=session.start +
  // transcript_path populated) sin claude ni cmux reales.
  //
  // Solo se invoca en la rama new-workspace (NO en la rama "existing" línea
  // ~128 refresh-nudge): el hook simula el PRIMER lifecycle de sesión, y
  // el refresh-nudge no crea sesión nueva.
  // ────────────────────────────────────────────────────────────────────────
  if (opts.spawnFn) {
    await opts.spawnFn({
      workspaceRef,
      sessionId,
      projectPath: process.cwd(),
      kodoDir: join(homedir(), '.kodo'),
      taskRef: ORCHESTRATOR_WORKSPACE_NAME,
    });
  }

  return { workspace: workspaceRef, existing: false };
}

// KODO-38: cotas del texto NO confiable que entra al prompt del orquestador.
// `summary` es literalmente `task.title` del proveedor (`session/manager.js:67`) y
// `task_ref` su identificador; ambos viajan desde Plane/GitHub sin que kodo los
// escriba. 120 chars es holgado para un título real (el carril del sidebar corta en
// 40 y el de la tarjeta en 60) y sigue acotando el relleno de contexto; el ref es un
// identificador corto (`KL-42`, `#42`), así que 40 sobra.
const PROMPT_TITLE_MAX = 120;
const PROMPT_REF_MAX = 40;

/**
 * Build a text summary of current state for the orchestrator
 *
 * KODO-38: el título de tarea llega de Plane/GitHub y aquí aterriza en un PROMPT, no
 * en el terminal. No hay shell-injection (el prompt viaja por fichero temporal,
 * `writePromptFile`), pero sí prompt-injection: un título con estructura markdown
 * falsificada o con «ignora las instrucciones anteriores» sesga al supervisor. Por eso
 * cada campo no confiable pasa por `stripForPrompt` (control chars + saltos aplanados
 * + longitud acotada) y el título va además envuelto en `<task_title>…</task_title>`,
 * que marca el límite exacto de lo que kodo no controla. El contrato que dice al
 * orquestador que ese contenido es DATO y no una orden vive en `prompt.md`
 * (§«Datos no confiables»): sin él los delimitadores son decoración.
 *
 * Lo demás de la línea (`workspace_ref`, `project_path`, elapsed) lo genera kodo o el
 * operador, no el proveedor, y se deja verbatim a propósito.
 *
 * @param {import('../session/state.js').Session[]} sessions
 * @param {ReturnType<import('../config.js').loadConfig>} config
 */
export function buildContextSummary(sessions, config) {
  const lines = [];

  const running = sessions.filter((s) => s.status === 'running');
  lines.push(`Sesiones activas: ${running.length}/${config.claude.max_parallel}`);

  if (running.length === 0) {
    lines.push('No hay sesiones corriendo.');
  } else {
    lines.push('');
    for (const s of running) {
      const elapsed = Math.floor((Date.now() - new Date(s.started_at).getTime()) / 60_000);
      // Phase 12 D-11: prioridad mode-first. Una sesión quick con phase_id
      // residual (no debería existir — dispatcher lo descarta — pero defensa
      // en profundidad) renderiza [GSD quick], no [GSD phase N].
      // D-12: cómputo inline (YAGNI — un solo callsite, no se extrae helper).
      // D-13: sesiones no-GSD siguen sin tag (status quo Phase 10 D-19).
      let gsdTag = '';
      if (s.gsd) {
        const mode = getSessionMode(s);
        const inner = mode === 'quick' ? 'quick' : (s.phase_id ? `phase ${s.phase_id}` : 'bootstrap');
        gsdTag = ` \`[GSD ${inner}]\``;
      }
      const ref = stripForPrompt(s.task_ref, PROMPT_REF_MAX);
      const title = stripForPrompt(s.summary, PROMPT_TITLE_MAX);
      lines.push(`- **${ref}**${gsdTag}: <task_title>${title}</task_title>`);
      lines.push(`  Workspace: ${s.workspace_ref} | ${elapsed}min | ${s.project_path}`);
    }
  }

  return lines.join('\n');
}
