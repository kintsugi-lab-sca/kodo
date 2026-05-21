// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { loadConfig, isReportToProviderEnabled } from '../config.js';
import { listSessions } from '../session/state.js';
import * as cmux from '../cmux/client.js';
import { getSessionMode } from '../labels.js';
import { syncSkill } from '../skill/sync.js';
import { skillSyncAuto, skillSyncAutoError } from '../logger-events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, 'prompt.md');
const ORCHESTRATOR_WORKSPACE_NAME = 'kodo-orchestrator';
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
 * @param {{
 *   logger?: import('../logger.js').Logger,
 *   spawnFn?: (ctx: {
 *     workspaceRef: string,
 *     sessionId: string,
 *     projectPath: string,
 *     kodoDir: string,
 *     taskRef: string,
 *   }) => Promise<void> | void,
 * }} [opts]
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

  // Check if orchestrator is already running
  let workspaceList;
  try {
    workspaceList = await cmux.listWorkspaces();
  } catch {
    workspaceList = '';
  }

  if (workspaceList.includes(ORCHESTRATOR_WORKSPACE_NAME)) {
    console.log('[kodo] Orchestrator workspace already exists');
    // Send a nudge to refresh
    const match = workspaceList.match(/(workspace:\d+)\s+kodo-orchestrator/);
    if (match) {
      await cmux.send({ workspace: match[1], text: 'Revisa el estado actual de las sesiones y tareas pendientes.\\n' });
      console.log('[kodo] Sent refresh nudge to existing orchestrator');
      return { workspace: match[1], existing: true };
    }
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
  const workspaceRef = await cmux.newWorkspace({
    name: ORCHESTRATOR_WORKSPACE_NAME,
    cwd: process.cwd(),
  });

  // Set orchestrator color (Indigo)
  await cmux.setColor({ workspace: workspaceRef, color: 'Indigo' });

  // Build Claude command with orchestrator prompt + context
  const sessionId = randomUUID();
  const prompt = `${basePrompt}\n\n## Situación actual\n\n${contextSummary}`;
  const escapedPrompt = prompt.replace(/'/g, "'\\''");

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
  const claudeCmd = [
    'claude',
    '--model', config.claude.default_model,
    '--session-id', sessionId,
    ...config.claude.flags,
    `'${escapedPrompt}'`,
  ].join(' ');

  await cmux.send({ workspace: workspaceRef, text: claudeCmd + '\\n' });

  // Notify
  await cmux.notify({
    title: 'kodo: Orchestrator',
    body: `Lanzado con ${sessions.length} sesiones activas`,
    workspace: workspaceRef,
  });

  console.log(`[kodo] Orchestrator launched → ${workspaceRef}`);

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

/**
 * Build a text summary of current state for the orchestrator
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
      lines.push(`- **${s.task_ref}**${gsdTag}: ${s.summary}`);
      lines.push(`  Workspace: ${s.workspace_ref} | ${elapsed}min | ${s.project_path}`);
    }
  }

  return lines.join('\n');
}
