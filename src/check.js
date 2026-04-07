// @ts-check
//
// kodo check — lightweight vigilante (no LLM, no tokens)
//
// Checks state, health, and pending tasks. If something needs
// human-level judgment, launches the orchestrator.
//

import { loadConfig, getPlaneApiKey } from './config.js';
import { loadState, removeSession } from './session/state.js';
import { checkHealth, actOnHealth } from './session/health.js';
import { PlaneClient } from './plane/client.js';
import { parseKodoLabels, resolveLabels } from './labels.js';
import * as cmux from './cmux/client.js';
import { launchOrchestrator } from './orchestrator/launch.js';

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
    const ids = inReview.map((s) => s.plane_identifier).join(', ');
    lines.push(`[kodo:check] In review: ${ids}`);
    reasons.push(`Tareas en review: ${ids}`);
  }

  // 3. Check for pending kodo tasks in Plane (if API key available)
  if (getPlaneApiKey()) {
    try {
      const pendingCount = await countPendingKodoTasks(config);
      if (pendingCount > 0 && running.length < config.claude.max_parallel) {
        lines.push(`[kodo:check] ${pendingCount} pending kodo task(s), ${config.claude.max_parallel - running.length} slot(s) available`);
        reasons.push(`${pendingCount} tarea(s) pendientes con slots disponibles`);
      }
    } catch (err) {
      lines.push(`[kodo:check] Error checking Plane: ${err.message}`);
    }
  }

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

/**
 * Count kodo-labeled tasks in Todo/Backlog states
 * @param {ReturnType<import('./config.js').loadConfig>} config
 * @returns {Promise<number>}
 */
async function countPendingKodoTasks(config) {
  const plane = new PlaneClient();
  let count = 0;

  for (const projectId of config.plane.projects) {
    try {
      const [workItems, states, allLabels] = await Promise.all([
        plane.listWorkItems(projectId),
        plane.listStates(projectId),
        plane.request(`/projects/${projectId}/labels/`).then((d) => d.results || d),
      ]);

      // Find kodo label IDs for this project
      const kodoLabelIds = new Set(
        allLabels.filter((l) => l.name.toLowerCase().startsWith('kodo')).map((l) => l.id)
      );

      if (kodoLabelIds.size === 0) continue;

      // Find pending state IDs (Backlog, Todo)
      const pendingStateIds = new Set(
        states
          .filter((s) => ['backlog', 'unstarted'].includes(s.group))
          .map((s) => s.id)
      );

      // Count work items with kodo label in pending states
      for (const item of workItems) {
        const stateId = typeof item.state === 'object' ? item.state.id : item.state;
        if (!pendingStateIds.has(stateId)) continue;

        const itemLabelIds = (item.labels || []).map((l) => (typeof l === 'object' ? l.id : l));
        if (itemLabelIds.some((id) => kodoLabelIds.has(id))) {
          count++;
        }
      }
    } catch {
      // Skip projects we can't access
    }
  }

  return count;
}
