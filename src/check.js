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
import { createFormatter } from './cli/format.js';
import { fetchFreshPending } from './tasks/pending.js';
// ORCH-07 (D-01): carril orquestador in-process. Importa SOLO scan/execute del
// motor del sidebar doctor (Phase 79) — NUNCA logger.js ni un cliente de provider.
// Llamar con `deps` sin `logger` resuelve a noopLogger (LOG-12 preservado: el grafo
// transitivo de sidebar-doctor.js está verificado limpio por test/check-isolation).
import { scan, execute } from './cmux/sidebar-doctor.js';

/**
 * Pure helper: queries the configured provider for pending tasks and returns
 * the lines/reasons to append to runCheck() output. Receives `getProviderFn`
 * for dependency injection in tests.
 *
 * @param {{
 *   config: { provider: string, claude: { max_parallel: number } },
 *   runningCount: number,
 *   getProviderFn: (name: string) => import('./interface.js').TaskProvider,
 *   formatterFn?: () => import('./cli/format.js').Formatter,
 * }} params
 * @returns {Promise<{ lines: string[], reasons: string[] }>}
 */
export async function checkPendingTasks({ config, runningCount, getProviderFn, formatterFn }) {
  const fmt = (formatterFn || (() => createFormatter(process.stdout)))();
  const lines = [];
  const reasons = [];

  try {
    const provider = getProviderFn(config.provider);
    await provider.init();
    // ORCH-05 (D-01): converge on the shared read lane. Consume fetchFreshPending in RAW
    // mode (NOT the resolver) — it propagates the throw, so the try/catch below and its
    // red error line stay byte-identical (D-07 / Pitfall 2).
    const pending = await fetchFreshPending(() => provider.listPendingTasks());
    const available = config.claude.max_parallel - runningCount;
    if (pending.length > 0 && available > 0) {
      lines.push(
        `[kodo:check] ${fmt.yellow(`${pending.length} pending kodo task(s), ${available} slot(s) available`)}`,
      );
      reasons.push(`${pending.length} tarea(s) pendientes con slots disponibles`);
    }
  } catch (err) {
    lines.push(
      `[kodo:check] ${fmt.red(`Error checking tasks: ${err.message}`)}`,
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
  const fmt = createFormatter(process.stdout);

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
    lines.push(`[kodo:check] ${fmt.ok('All clear')}`);
  }

  const summary = lines.join('\n');
  return { needsOrchestrator: reasons.length > 0, reasons, summary };
}

/**
 * Run check and launch orchestrator if needed.
 *
 * Firma DI opcional (espejo de `checkPendingTasks`): con defaults de producción,
 * `await runCheckAndAct()` sin args es byte-idéntico para el caller de `src/cli.js`.
 * Los params existen para inyectar stubs en tests (gate/orden/fail-open del carril).
 *
 * @param {{
 *   runCheckFn?: () => Promise<{ needsOrchestrator: boolean, reasons: string[], summary: string }>,
 *   scanFn?: (deps?: any) => Promise<any>,
 *   executeFn?: (deps?: any, opts?: { fix?: boolean }) => Promise<any>,
 *   launchFn?: () => Promise<void>,
 *   logFn?: (msg: string) => void,
 *   errorFn?: (msg: string) => void,
 * }} [deps]
 */
export async function runCheckAndAct({
  runCheckFn = runCheck,
  scanFn = scan,
  executeFn = execute,
  launchFn = launchOrchestrator,
  logFn = console.log,
  errorFn = console.error,
} = {}) {
  const result = await runCheckFn();
  logFn(result.summary);

  if (result.needsOrchestrator) {
    // ORCH-07: piggyback del sidebar doctor ANTES de launchOrchestrator (orden D-05).
    // El orquestador arranca con el sidebar ya convergido. try/catch propio: fail-open
    // total — un error del doctor loguea una línea y jamás bloquea el check ni el launch
    // (espejo EXACTO del catch de launchOrchestrator). El gate `needsOrchestrator` se
    // CONSUME aquí; el resultado del doctor NUNCA re-entra a `reasons` ni al gate (D-04).
    try {
      const deps = {}; // defaults de producción → noopLogger (LOG-12); NO inyectar logger real.
      const report = await scanFn(deps);
      const r = await executeFn(deps, { fix: true });
      const applied = (r.added || 0) + (r.ungrouped || 0);
      logFn(`[kodo:check] Sidebar: ${applied} acción(es) aplicadas`);
      // missing_group es advisory report-only (79-04): acción de operador, no se ejecuta.
      if (report && report.hasAdvisories) {
        logFn(`[kodo:check] Sidebar advisories: ${report.missing_group.length} (acción de operador)`);
      }
    } catch (err) {
      errorFn(`[kodo:check] Sidebar doctor error: ${err.message}`);
    }

    logFn(`[kodo:check] Launching orchestrator: ${result.reasons.join('; ')}`);
    try {
      await launchFn();
    } catch (err) {
      errorFn(`[kodo:check] Error launching orchestrator: ${err.message}`);
    }
  }
}
