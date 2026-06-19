// @ts-check
//
// src/cli/comment.js — Action handler de `kodo comment <ref>`.
//
// Consumidor determinista 0-token que postea un comentario-resumen en una tarea
// EXISTENTE vía el método FROZEN-9 `addComment` (src/interface.js). Es el carril
// BACKFILL del enriquecimiento de tareas adoptadas (Phase 60 / BIDIR-F2): una
// tarea ya adoptada (título = basename, sin descripción) se enriquece con un
// resumen que el ORQUESTADOR (único carril LLM) deriva del contexto real y pasa
// como `--body`. El cuerpo se sanea con el MISMO backstop del núcleo (BIDIR-08,
// sanitizeAdoptionData) ANTES del POST — el LLM no es de fiar para no filtrar
// rutas absolutas / home dir.
//
// Espejo estructural de `runAdoptCli` (./adopt.js) y `runGsdInspect`
// (./gsd-inspect.js): argv → resolver provider → getTask → addComment → render.
// Cero lógica de negocio nueva: NO añade métodos al contrato (reusa addComment),
// NO usa LLM, NO toca state/lock/cmux (dry-write puro sobre el provider).
//
// Exit codes (espejo Opción A de adopt/gsd-verify):
//   0 = ok (comentario posteado)
//   1 = INVALID_INPUT (ref o body vacío — error del operador, NO retryable)
//   2 = FETCH_FAILED | POST_FAILED (getTask/addComment falló — transient, retryable)
//
// Color isolation (LOCKED): el color sale SOLO de createFormatter de ./format.js.

import { sanitizeAdoptionData } from '../adopt.js';
import { createFormatter } from './format.js';

/**
 * @typedef {{ ref: string, body: string, json?: boolean }} RunCommentCliOpts
 *
 * @typedef {{
 *   getProviderFn?: () => any,
 *   loadConfigFn?: () => { provider: string },
 *   sanitizeFn?: typeof sanitizeAdoptionData,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 * }} RunCommentCliDeps
 */

/**
 * Postea un comentario-resumen en una tarea existente — thin CLI handler.
 *
 * @param {RunCommentCliOpts} opts
 * @param {RunCommentCliDeps} [deps]
 * @returns {Promise<number>} exit code.
 */
export async function runCommentCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const sanitize = deps.sanitizeFn || sanitizeAdoptionData;
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();

  // PASO 0 — validación de input (INVALID_INPUT, error del operador). Un ref o
  // body vacío nunca llega al provider (espejo del fail-fast de adopt).
  const ref = typeof opts.ref === 'string' ? opts.ref.trim() : '';
  const rawBody = typeof opts.body === 'string' ? opts.body : '';
  const missing = [];
  if (!ref) missing.push('ref');
  if (!rawBody.trim()) missing.push('body');
  if (missing.length > 0) {
    err(`${fmt.red('INVALID_INPUT')}: missing ${missing.join(', ')}\n`);
    return 1;
  }

  // PASO 1 — resolver provider (espejo adopt.js PASO 1). Lazy-import del registry;
  // los tests inyectan getProviderFn y nunca tocan el registry real.
  const { loadConfig } = await import('../config.js');
  let provider;
  if (deps.getProviderFn) {
    provider = deps.getProviderFn();
  } else {
    const { initRegistry, getProvider } = await import('../providers/registry.js');
    await initRegistry();
    const providerName = (deps.loadConfigFn || loadConfig)().provider;
    provider = getProvider(providerName);
  }

  // PASO 2 — fetch task (best-effort; fetch failure = transient → exit 2, espejo
  // gsd-inspect). El ref se resuelve igual que `kodo gsd inspect` (getTask directo).
  let task;
  try {
    task = await provider.getTask(ref);
  } catch (e) {
    err(`${fmt.yellow('FETCH_FAILED')} (transient): cannot fetch task ${ref}: ${String(e?.message || e)}\n`);
    return 2;
  }

  // PASO 3 — sanear el body con el backstop del núcleo (BIDIR-08). El orquestador
  // deriva el resumen con un LLM; el CLI es el guard determinista que strip-ea
  // rutas absolutas / redacta el home dir ANTES del POST. Reusa sanitizeAdoptionData
  // (pasamos el resumen como `description`; title/cwd no se usan para el comentario).
  const cleanBody = sanitize({ cwd: '', title: '', description: rawBody }).description ?? '';

  // PASO 4 — postear el comentario (POST failure = transient → exit 2).
  try {
    await provider.addComment(task, cleanBody);
  } catch (e) {
    err(`${fmt.yellow('POST_FAILED')} (transient): addComment failed for ${ref}: ${String(e?.message || e)}\n`);
    return 2;
  }

  // PASO 5 — render.
  if (opts.json) {
    write(JSON.stringify({ ok: true, ref: task.ref ?? ref, task_url: task.url ?? null }, null, 2) + '\n');
  } else {
    write(`${fmt.ok('Commented')}\n`);
    write(`  ref:      ${fmt.green(task.ref ?? ref)}\n`);
    if (task.url) write(`  task_url: ${task.url}\n`);
  }
  return 0;
}
