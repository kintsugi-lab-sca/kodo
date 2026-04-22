// @ts-check
//
// src/cli/gsd-verify.js — Action handler de `kodo gsd verify <session-id>`.
//
// Responsabilidades (CONTEXT §D-20, §D-21, Claude's Discretion exit codes):
//   1. Invocar runGsdVerify de src/gsd/verify.js (toda la lógica vive ahí).
//   2. Render human-readable (default) o JSON (--json, scriptable).
//   3. Exit codes (Pitfall #6, Opción A — alineada con gsd-inspect.js):
//        0 = gate corrió entregando cualquier verdict (pass/fail/missing/malformed).
//        1 = error interno (session-id no encontrado, session.gsd false, state.json no legible).
//        2 = provider fetch failure (transient, retryable por script operador).
//
// Idempotencia (Pitfall #7): kodo NO deduplica comentarios Plane. Re-invocar este CLI
// para la misma sesión postea un comentario adicional byte-idéntico (excepto timestamp).
// Aceptado en v0.3 para minimizar superficie; ver .planning/phases/10-*/10-CONTEXT.md §Deferred.

import { runGsdVerify } from '../gsd/verify.js';

/**
 * @typedef {{ sessionId: string, json?: boolean }} RunGsdVerifyCliOpts
 *
 * @typedef {{
 *   runVerifyFn?: typeof runGsdVerify,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 * }} RunGsdVerifyCliDeps
 */

/**
 * Errors whose messages match this pattern are classified as transient
 * (exit code 2). Anything else → internal error (exit code 1).
 *
 * Rationale: Phase 10 CONTEXT Claude's Discretion — Opción A exit codes
 * require distinguishing transient (provider fetch, network) from internal
 * (config, session resolution). The provider's Plane client throws with
 * messages containing "provider fetch failed", "ECONNREFUSED", "ETIMEDOUT",
 * or "network"; these are retryable by an operator script.
 */
const TRANSIENT_PATTERNS = /provider.*fetch|fetch.*failed|ECONNREFUSED|ETIMEDOUT|network|getaddrinfo/i;

/**
 * Run the GSD verification gate for a session — thin CLI handler.
 *
 * All gate logic (session resolution, VERIFICATION.md discovery + parsing,
 * verdict computation, Plane side-effects, NDJSON emission) lives in
 * `src/gsd/verify.js`. This function is purely: argv → delegation → render.
 *
 * @param {RunGsdVerifyCliOpts} opts
 * @param {RunGsdVerifyCliDeps} [deps]
 * @returns {Promise<number>} exit code (Pitfall #6, Opción A):
 *   0 = gate corrió (cualquier verdict)
 *   1 = error interno (session not found, is not GSD, config error)
 *   2 = provider fetch failure transient
 */
export async function runGsdVerifyCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const runVerifyFn = deps.runVerifyFn || runGsdVerify;

  let result;
  try {
    result = await runVerifyFn({ sessionId: opts.sessionId });
  } catch (e) {
    const msg = /** @type {Error} */ (e).message || String(e);
    err(`Error verifying session ${opts.sessionId}: ${msg}\n`);
    // Distinguir transient (exit 2, retryable) vs interno (exit 1).
    if (TRANSIENT_PATTERNS.test(msg)) return 2;
    return 1;
  }

  if (opts.json) {
    write(JSON.stringify(result, null, 2) + '\n');
  } else {
    renderHuman(result, write);
  }
  return 0;
}

/**
 * Render the verdict + plane side-effect result in human-readable form.
 * Exhaustive switch over the 4 verdict actions (pass/fail/missing/malformed).
 *
 * @private
 * @param {any} result
 * @param {(s: string) => void} write
 */
function renderHuman(result, write) {
  const { verdict, plane, session } = result;
  write(`Session:      ${session.session_id}\n`);
  write(`Task:         ${session.task_ref}\n\n`);
  write('Verdict:\n');
  switch (verdict.action) {
    case 'pass':
      write(`  action:      pass\n`);
      write(`  phase_id:    ${verdict.phase_id}\n`);
      write(`  must_haves:  ${verdict.must_haves}\n`);
      break;
    case 'fail':
      write(`  action:      fail\n`);
      write(`  phase_id:    ${verdict.phase_id}\n`);
      write(`  reason:      ${verdict.reason}\n`);
      write(`  detail:      ${verdict.detail}\n`);
      break;
    case 'missing':
      write(`  action:      missing\n`);
      write(`  phase_id:    ${verdict.phase_id}\n`);
      break;
    case 'malformed':
      write(`  action:      malformed\n`);
      write(`  phase_id:    ${verdict.phase_id}\n`);
      write(`  detail:      ${verdict.detail}\n`);
      break;
  }
  write('\n');
  write(`Plane: commented=${plane.commented} transitioned=${plane.transitioned}\n`);
}
