// @ts-check
//
// kodo check — lightweight vigilante (no LLM, no tokens)
//
// Checks state, health, and pending tasks. If something needs
// human-level judgment, launches the orchestrator.
//

import { loadConfig } from './config.js';
import { loadState } from './session/state.js';
import { checkHealth, actOnHealth } from './session/health.js';
import { initRegistry, getProvider } from './providers/registry.js';
import { launchOrchestrator } from './orchestrator/launch.js';

const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED = '\x1b[31m';
const ANSI_RESET = '\x1b[0m';

/**
 * Pure helper: queries the configured provider for pending tasks and returns
 * the lines/reasons to append to runCheck() output. Receives `getProviderFn`
 * for dependency injection in tests.
 *
 * @param {{
 *   config: { provider: string, claude: { max_parallel: number } },
 *   runningCount: number,
 *   getProviderFn: (name: string) => import('./interface.js').TaskProvider,
 * }} params
 * @returns {Promise<{ lines: string[], reasons: string[] }>}
 */
export async function checkPendingTasks({ config, runningCount, getProviderFn }) {
  const lines = [];
  const reasons = [];

  try {
    const provider = getProviderFn(config.provider);
    await provider.init();
    const pending = await provider.listPendingTasks();
    const available = config.claude.max_parallel - runningCount;
    if (pending.length > 0 && available > 0) {
      lines.push(
        `${ANSI_YELLOW}[kodo:check] ${pending.length} pending kodo task(s), ${available} slot(s) available${ANSI_RESET}`,
      );
      reasons.push(`${pending.length} tarea(s) pendientes con slots disponibles`);
    }
  } catch (err) {
    lines.push(
      `${ANSI_RED}[kodo:check] Error checking tasks: ${err.message}${ANSI_RESET}`,
    );
  }

  return { lines, reasons };
}

/**
 * Run a single check cycle. Returns a summary of findings.
 * @returns {Promise<{ needsOrchestrator: boolean, reasons: string[], summary: string }>}
 */
export async function runCheck() {
  const config = loadConfig();
  const state = loadState();
  const reasons = [];
  const lines = [];

  const running = Object.values(state.sessions).filter((s) => s.status === 'running');
  const inReview = Object.values(state.sessions).filter((s) => s.status === 'review');

  lines.push(`[kodo:check] Sessions: ${running.length} running, ${inReview.length} in review`);

  // 1. Health check — clean up gone sessions, detect stuck
  const healthReports = await checkHealth().catch(() => []);
  const stuck = healthReports.filter((r) => r.health === 'stuck');
  const gone = healthReports.filter((r) => r.health === 'gone');

  if (gone.length > 0) {
    lines.push(`[kodo:check] Cleaning ${gone.length} gone session(s)`);
    await actOnHealth(gone);
  }

  if (stuck.length > 0) {
    const ids = stuck.map((s) => s.identifier).join(', ');
    lines.push(`[kodo:check] Stuck: ${ids}`);
    reasons.push(`Sesiones stuck: ${ids}`);
  }

  // 2. Sessions in review — need orchestrator to evaluate
  if (inReview.length > 0) {
    const ids = inReview.map((s) => s.task_ref).join(', ');
    lines.push(`[kodo:check] In review: ${ids}`);
    reasons.push(`Tareas en review: ${ids}`);
  }

  // 3. Check for pending tasks via the configured provider
  await initRegistry();
  const pendingResult = await checkPendingTasks({
    config,
    runningCount: running.length,
    getProviderFn: getProvider,
  });
  lines.push(...pendingResult.lines);
  reasons.push(...pendingResult.reasons);

  // 4. Summary
  if (reasons.length === 0) {
    lines.push('[kodo:check] All clear ✓');
  }

  const summary = lines.join('\n');
  return { needsOrchestrator: reasons.length > 0, reasons, summary };
}

/**
 * Run check and launch orchestrator if needed
 */
export async function runCheckAndAct() {
  const result = await runCheck();
  console.log(result.summary);

  if (result.needsOrchestrator) {
    console.log(`[kodo:check] Launching orchestrator: ${result.reasons.join('; ')}`);
    try {
      await launchOrchestrator();
    } catch (err) {
      console.error(`[kodo:check] Error launching orchestrator: ${err.message}`);
    }
  }
}
