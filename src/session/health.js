// @ts-check
import { loadConfig } from '../config.js';
import { loadState, updateSession, removeSession } from './state.js';
import { getHost } from '../host/interface.js';

/**
 * @typedef {'healthy'|'idle'|'stuck'|'gone'} SessionHealth
 *
 * @typedef {{
 *   taskId: string,
 *   ref: string,
 *   health: SessionHealth,
 *   elapsed_min: number,
 *   last_screen?: string,
 * }} HealthReport
 */

/**
 * Check health of all active sessions
 * @returns {Promise<HealthReport[]>}
 */
export async function checkHealth() {
  const config = loadConfig();
  const state = loadState();
  const sessions = Object.entries(state.sessions).filter(([, s]) => s.status === 'running');

  if (sessions.length === 0) return [];

  // Phase 38 SC#5: cmux confinado a src/host/. health.js consume el cliente
  // legacy vía host._legacy (passthrough fiel de cmux/client.js, CONTEXT.md D-09)
  // — comportamiento idéntico al previo `import * as cmux`; el walker
  // cmux-isolation queda verde. La migración al contrato D-03 (listWorkspaces
  // tipado + isAlive) la hace 38-02.
  const host = getHost('cmux');

  // Get current workspaces list once
  let workspaceList = '';
  try {
    workspaceList = await host._legacy.listWorkspaces();
  } catch {
    // If cmux is unavailable, skip health checks
    return [];
  }

  const reports = [];

  for (const [taskId, session] of sessions) {
    const elapsedMs = Date.now() - new Date(session.started_at).getTime();
    const elapsedMin = Math.floor(elapsedMs / 60_000);

    // Check if workspace still exists
    if (!workspaceList.includes(session.workspace_ref)) {
      reports.push({
        taskId,
        ref: session.task_ref,
        health: /** @type {const} */ ('gone'),
        elapsed_min: elapsedMin,
      });
      continue;
    }

    // Read last lines of screen to detect activity
    let lastScreen = '';
    try {
      lastScreen = await host._legacy.readScreen({ workspace: session.workspace_ref, lines: 5 });
    } catch {
      // Can't read screen — workspace might be closing
      reports.push({
        taskId,
        ref: session.task_ref,
        health: /** @type {const} */ ('gone'),
        elapsed_min: elapsedMin,
      });
      continue;
    }

    // Detect if Claude finished (prompt visible, no activity)
    const isIdle = detectIdle(lastScreen);
    const isStuck = elapsedMin >= config.server.stuck_threshold_min;

    /** @type {SessionHealth} */
    let health = 'healthy';
    if (isIdle && elapsedMin >= config.server.idle_threshold_min) {
      health = 'idle';
    }
    if (isStuck) {
      health = 'stuck';
    }

    reports.push({
      taskId,
      ref: session.task_ref,
      health,
      elapsed_min: elapsedMin,
      last_screen: lastScreen,
    });
  }

  return reports;
}

/**
 * Act on health reports — clean up gone sessions, notify on stuck
 * @param {HealthReport[]} reports
 */
export async function actOnHealth(reports) {
  // Phase 38 SC#5: notify vía host._legacy (passthrough fiel de cmux/client.js).
  const host = getHost('cmux');
  for (const report of reports) {
    switch (report.health) {
      case 'gone':
        console.log(`[kodo:health] ${report.ref} — workspace gone, cleaning up`);
        removeSession(report.taskId);
        break;

      case 'stuck':
        console.log(`[kodo:health] ${report.ref} — stuck (${report.elapsed_min}min)`);
        await host._legacy.notify({
          title: `kodo: ${report.ref} stuck`,
          body: `Lleva ${report.elapsed_min}min sin progreso`,
        }).catch(() => {});
        break;

      case 'idle':
        console.log(`[kodo:health] ${report.ref} — idle (${report.elapsed_min}min)`);
        break;
    }
  }
}

/**
 * Detect if a Claude session appears idle from screen content
 * @param {string} screen
 * @returns {boolean}
 */
function detectIdle(screen) {
  const lines = screen.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return true;

  const lastLine = lines[lines.length - 1].trim();

  // Common idle indicators: shell prompt, claude waiting for input
  if (lastLine.startsWith('>') || lastLine.startsWith('$') || lastLine.startsWith('%')) return true;
  if (lastLine.includes('What would you like to do?')) return true;
  if (lastLine.includes('[kodo:idle]')) return true;

  return false;
}

/** @type {ReturnType<typeof setInterval>|null} */
let healthInterval = null;

/**
 * Start periodic health checks
 * @param {{ intervalMs?: number }} [opts]
 */
export function startHealthLoop(opts = {}) {
  const intervalMs = opts.intervalMs || 60_000; // Default: every minute

  console.log(`[kodo:health] Starting health checks every ${intervalMs / 1000}s`);

  // Run immediately, then on interval
  runHealthCheck();
  healthInterval = setInterval(runHealthCheck, intervalMs);
}

export function stopHealthLoop() {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

async function runHealthCheck() {
  try {
    const reports = await checkHealth();
    const problems = reports.filter((r) => r.health !== 'healthy');
    if (problems.length > 0) {
      await actOnHealth(problems);
    }
  } catch (err) {
    console.error(`[kodo:health] Error: ${err.message}`);
  }
}
