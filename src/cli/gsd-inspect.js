// @ts-check
//
// src/cli/gsd-inspect.js — Action handler de `kodo gsd inspect <task-id>`.
//
// Responsabilidades (CONTEXT §D-16..D-19):
//   1. Resolver task via provider (igual shape que dispatcher pero sin launch).
//   2. Resolver projectPath via resolveProjectPath.
//   3. Llamar resolvePhase() — MISMA función que el dispatcher (D-04 invariant).
//   4. Renderizar preview de buildGsdContext con session sintético.
//   5. Emitir human-readable (default) o JSON (--json, D-17).
//   6. Exit code 0 si phase|bootstrap, 1 si error (D-19).
//
// Dry-run estricto (D-18): NO lock, NO state, NO cmux. Pure read-only.
// Esta invariante está protegida por un test dedicado en test/gsd-inspect-cli.test.js
// que aserta que `acquireGsdLockFn`, `addSession`, y cualquier llamada a cmux
// nunca son invocadas durante una ejecución de runGsdInspect.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePhase } from '../gsd/resolver.js';
import { buildBriefFromTask } from '../gsd/brief.js';
import { buildGsdContext } from '../hooks/session-start.js';
import { resolveProjectPath } from '../session/manager.js';
import { loadProjects } from '../config.js';
import { initRegistry, getProvider } from '../providers/registry.js';

/**
 * @typedef {{ taskId: string, json?: boolean }} RunGsdInspectOpts
 *
 * @typedef {{
 *   getProviderFn?: () => import('../interface.js').TaskProvider,
 *   resolveProjectPathFn?: (task: any) => string,
 *   resolvePhaseFn?: (params: { projectPath: string, task: any }) => import('../gsd/resolver.js').ResolveResult,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 * }} RunGsdInspectDeps
 */

/**
 * Dry-run of the GSD phase resolver for a single task. Read-only.
 *
 * @param {RunGsdInspectOpts} opts
 * @param {RunGsdInspectDeps} [deps]
 * @returns {Promise<number>} exit code (0 success, 1 resolver error, 2 fetch failure)
 */
export async function runGsdInspect(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));

  let getProviderFn = deps.getProviderFn;
  if (!getProviderFn) {
    await initRegistry();
    getProviderFn = () => getProvider(/** @type {any} */ (undefined));
  }
  const resolveProjectPathFn = deps.resolveProjectPathFn
    || ((task) => resolveProjectPath(task, /** @type {any} */ (loadProjects())));
  const resolvePhaseFn = deps.resolvePhaseFn || resolvePhase;

  // 1. Fetch task — best-effort; on fetch failure, exit 2 with message.
  let task;
  try {
    const provider = getProviderFn();
    task = await provider.getTask(opts.taskId);
  } catch (e) {
    err(`Error fetching task ${opts.taskId}: ${/** @type {Error} */ (e).message}\n`);
    return 2;
  }

  // 2. Resolve project path (may throw if task's project has no mapping).
  let projectPath;
  try {
    projectPath = resolveProjectPathFn(task);
  } catch (e) {
    err(`Error resolving project path: ${/** @type {Error} */ (e).message}\n`);
    return 2;
  }

  // 3. Call resolver — MISMA función que el dispatcher (D-04).
  const verdict = resolvePhaseFn({ projectPath, task });

  // 4. Detect presence of .planning/PROJECT.md for the human report section 2.
  const hasPlanning = existsSync(join(projectPath, '.planning', 'PROJECT.md'));

  // 5. Build the brief (only meaningful for bootstrap verdicts, but we always
  //    compute it so JSON mode can include it verbatim for operator inspection).
  const brief = verdict.action === 'bootstrap' ? buildBriefFromTask(task) : null;

  // 6. Render: --json (D-17) or human (D-16).
  if (opts.json) {
    write(JSON.stringify({
      task: { ref: task.ref, title: task.title, labels: task.labels },
      project_path: projectPath,
      has_planning_dir: hasPlanning,
      verdict,
      brief,
    }, null, 2) + '\n');
  } else {
    renderHuman({ task, projectPath, hasPlanning, verdict, brief, write });
  }

  // 7. Exit code (D-19).
  return verdict.action === 'error' ? 1 : 0;
}

/**
 * Render the human-readable 4-section report per D-16.
 * @private
 */
function renderHuman({ task, projectPath, hasPlanning, verdict, brief, write }) {
  // Section 1: task resolution
  write(`Task:         ${task.ref} — ${task.title}\n`);
  write(`Labels:       [${(task.labels || []).join(', ')}]\n`);
  write(`Project path: ${projectPath}\n\n`);

  // Section 2: .planning/PROJECT.md presence
  write(`.planning/PROJECT.md: ${hasPlanning ? 'present' : 'MISSING'}\n\n`);

  // Section 3: verdict — exhaustive switch per D-02
  write('Verdict:\n');
  switch (verdict.action) {
    case 'phase':
      write(`  action:        phase\n`);
      write(`  phase_id:      ${verdict.phase_id}\n`);
      write(`  match_heading: ${verdict.match_heading}\n`);
      write(`  match_reason:  ${verdict.match_reason}\n`);
      break;
    case 'bootstrap':
      write(`  action:        bootstrap (${verdict.reason})\n`);
      break;
    case 'error':
      write(`  action:        error\n`);
      write(`  code:          ${verdict.code}\n`);
      if (verdict.detail) write(`  detail:        ${verdict.detail}\n`);
      if (verdict.matches) write(`  matches:       ${verdict.matches.join(', ')}\n`);
      break;
  }
  write('\n');

  // Section 4: preview of buildGsdContext with a synthetic session
  const syntheticSession = /** @type {any} */ ({
    task_ref: task.ref,
    summary: task.title,
    project_path: projectPath,
    session_id: '<dry-run-preview>',
    task_id: task.id,
    project_id: task.projectId,
    gsd: true,
    // Only include phase_id when the verdict matched a phase.
    ...(verdict.action === 'phase' ? { phase_id: verdict.phase_id } : {}),
  });
  const preview = buildGsdContext(syntheticSession, { brief });

  write('─── buildGsdContext preview ───\n');
  write(preview);
  if (!preview.endsWith('\n')) write('\n');
  write('───────────────────────────────\n');
}
