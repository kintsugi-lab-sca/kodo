// @ts-check
//
// src/cli/gsd-inspect.js — Action handler de `kodo gsd inspect <task-id>`.
//
// Responsabilidades (CONTEXT §D-12, D-13, D-16..D-19):
//   1. Resolver task via provider (igual shape que dispatcher pero sin launch).
//   2. Resolver projectPath via resolveProjectPath.
//   3. Llamar resolvePhase() — MISMA función que el dispatcher (D-04 invariant).
//   4. Renderizar 4 secciones literales (`config / fetch / roadmap / match`)
//      con `✓`/`✗` por sección (D-12) + `Exit: N` como última línea (D-13).
//   5. Emitir human-readable (default) o JSON (--json, D-17).
//   6. Exit codes (D-19): 0=phase|bootstrap, 1=verdict error OR config
//      error, 2=provider fetch failure (transient).
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
import { loadProjects, loadConfig } from '../config.js';
import { initRegistry, getProvider } from '../providers/registry.js';
import { createFormatter } from './format.js';

/**
 * @typedef {{ taskId: string, json?: boolean }} RunGsdInspectOpts
 *
 * @typedef {{
 *   getProviderFn?: () => import('../interface.js').TaskProvider,
 *   resolveProjectPathFn?: (task: any) => string,
 *   resolvePhaseFn?: (params: { projectPath: string, task: any }) => import('../gsd/resolver.js').ResolveResult,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 * }} RunGsdInspectDeps
 */

/**
 * Dry-run of the GSD phase resolver for a single task. Read-only.
 *
 * @param {RunGsdInspectOpts} opts
 * @param {RunGsdInspectDeps} [deps]
 * @returns {Promise<number>} exit code per D-19:
 *   0 = verdict 'phase' or 'bootstrap' (happy path)
 *   1 = verdict 'error' (resolver) OR config error (project mapping missing)
 *   2 = provider.getTask fetch failure (transient, retryable)
 */
export async function runGsdInspect(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();

  let getProviderFn = deps.getProviderFn;
  if (!getProviderFn) {
    await initRegistry();
    // KODO-4 fix: inspect es dry-run sin estado (D-18), así que NO hay
    // session.provider que leer — el provider se resuelve desde el default del
    // config (`config.provider`). Antes se invocaba `getProvider(undefined)`
    // → "Unknown provider: undefined". Patrón canónico: getProvider(config.provider)
    // (server.js:366, manager.js:174).
    const providerName = loadConfig().provider;
    getProviderFn = () => getProvider(providerName);
  }
  const resolveProjectPathFn = deps.resolveProjectPathFn
    || ((task) => resolveProjectPath(task, /** @type {any} */ (loadProjects())));
  const resolvePhaseFn = deps.resolvePhaseFn || resolvePhase;

  // 1. Fetch task — best-effort; on fetch failure, exit 2 with message.
  //    `Exit: 2` se imprime también a stdout (consistencia operador, D-13)
  //    salvo en --json mode donde rompería el JSON parseable.
  let task;
  try {
    const provider = getProviderFn();
    task = await provider.getTask(opts.taskId);
  } catch (e) {
    err(`Error fetching task ${opts.taskId}: ${/** @type {Error} */ (e).message}\n`);
    if (!opts.json) write(`Exit: 2\n`);
    return 2;
  }

  // 2. Resolve project path. A missing mapping is a config error (semantic
  //    failure) — exit 1 per D-19, NOT 2. Exit code 2 is reserved for
  //    provider fetch failure (transient). Scripts with retry-on-2 must
  //    not reintentar cuando el operador necesita corregir config.
  let projectPath;
  try {
    projectPath = resolveProjectPathFn(task);
  } catch (e) {
    err(`Error resolving project path: ${/** @type {Error} */ (e).message}\n`);
    if (!opts.json) write(`Exit: 1\n`);
    return 1;
  }

  // 3. Call resolver — MISMA función que el dispatcher (D-04).
  const verdict = resolvePhaseFn({ projectPath, task });

  // 4. Detect presence of .planning/PROJECT.md for the human report `roadmap` section.
  const hasPlanning = existsSync(join(projectPath, '.planning', 'PROJECT.md'));

  // 5. Build the brief (only meaningful for bootstrap verdicts, but we always
  //    compute it so JSON mode can include it verbatim for operator inspection).
  const brief = verdict.action === 'bootstrap' ? buildBriefFromTask(task) : null;

  // 6. Exit code (D-19) — calcular antes de renderizar para que renderHuman
  //    lo imprima como última línea (D-13 invariante: visible N === return N).
  const exitCode = verdict.action === 'error' ? 1 : 0;

  // 7. Render: --json (D-17) preserva shape original; human mode usa 4 secciones (D-12).
  if (opts.json) {
    write(JSON.stringify({
      task: { ref: task.ref, title: task.title, labels: task.labels },
      project_path: projectPath,
      has_planning_dir: hasPlanning,
      verdict,
      brief,
    }, null, 2) + '\n');
  } else {
    renderHuman({ task, projectPath, hasPlanning, verdict, brief, write, fmt, exitCode });
  }

  return exitCode;
}

/**
 * Render the human-readable 4-section report per D-12 / D-13.
 *
 * Invariantes:
 *   - 4 secciones literales en orden `config / fetch / roadmap / match`.
 *   - `config` y `fetch` siempre `✓ OK` aquí — cualquier fallo previo retornó
 *     antes via `errFn` y NUNCA llega a `renderHuman`.
 *   - `Exit: N` como última línea, donde N coincide con el código retornado
 *     por `runGsdInspect` (consistencia D-13).
 *   - Bloque preview de `buildGsdContext` se preserva sólo para `bootstrap`
 *     (Discretion CONTEXT línea 70 — útil para auditoría).
 *
 * @private
 * @param {{
 *   task: any,
 *   projectPath: string,
 *   hasPlanning: boolean,
 *   verdict: import('../gsd/resolver.js').ResolveResult,
 *   brief: string | null,
 *   write: (s: string) => void,
 *   fmt: import('./format.js').Formatter,
 *   exitCode: number,
 * }} params
 */
function renderHuman({ task, projectPath, hasPlanning, verdict, brief, write, fmt, exitCode }) {
  // Header (info de contexto, sin OK/FAIL — son hechos).
  write(`Task:         ${task.ref} — ${task.title}\n`);
  write(`Labels:       [${(task.labels || []).join(', ')}]\n`);
  write(`Project path: ${projectPath}\n\n`);

  // 4 secciones literales (orden SC#3): config / fetch / roadmap / match.
  // config y fetch siempre OK aquí — cualquier fallo previo retornó antes via errFn.
  write(`config:  ${fmt.ok('OK')}\n`);
  write(`fetch:   ${fmt.ok('OK')}\n`);
  write(`roadmap: ${hasPlanning ? fmt.ok('OK') : fmt.fail('FAIL')}\n`);

  const matchOk = verdict.action !== 'error';
  let matchLine = `match:   ${matchOk ? fmt.ok('OK') : fmt.fail('FAIL')}`;
  if (verdict.action === 'phase') {
    matchLine += ` — phase ${verdict.phase_id}`;
  } else if (verdict.action === 'bootstrap') {
    matchLine += ` — bootstrap (${verdict.reason})`;
  } else if (verdict.action === 'error') {
    matchLine += ` — ${verdict.code}${verdict.detail ? `: ${verdict.detail}` : ''}`;
  }
  write(`${matchLine}\n\n`);

  // Bloque opcional: preview de buildGsdContext sólo para bootstrap (CONTEXT línea 70).
  if (verdict.action === 'bootstrap' && brief) {
    const syntheticSession = /** @type {any} */ ({
      task_ref: task.ref,
      summary: task.title,
      project_path: projectPath,
      session_id: '<dry-run-preview>',
      task_id: task.id,
      project_id: task.projectId,
      gsd: true,
    });
    const preview = buildGsdContext(syntheticSession, { brief });
    write('─── buildGsdContext preview ───\n');
    write(preview);
    if (!preview.endsWith('\n')) write('\n');
    write('───────────────────────────────\n');
  }

  // Última línea: Exit: N (D-13) — el N coincide con el return del handler.
  write(`Exit: ${exitCode}\n`);
}
