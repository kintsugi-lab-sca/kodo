// @ts-check
//
// src/gsd/verify.js — Orquestación del verification gate GSD (Phase 10, CONTEXT §D-01..§D-17).
//
// Responsabilidades:
//   1. findSession({ sessionId }) → SessionRecord (task_ref, project_path, phase_id, provider).
//   2. Descubrir .planning/phases/<padded>-<slug>/<padded>-VERIFICATION.md via readdirSync + prefix match.
//   3. Leer + parsear frontmatter (Plan 10-01 verification.js).
//   4. computeVerdict → Verdict discriminated union.
//   5. getProvider.getTask(task_ref) → addComment(markdown) → (si pass) updateTaskState(reviewState).
//   6. orchestratorReview(logger, { phase_id, verdict: mapActionToLegacy(action), reason }).
//
// Invariantes:
//   - addComment se invoca SIEMPRE que getTask devuelva un task válido (D-14). Si getTask falla, NO se comenta.
//   - updateTaskState SÓLO en verdict pass Y solo si addComment previo tuvo éxito (D-11, D-12).
//   - orchestratorReview emitido UNA SOLA VEZ, al final, en todas las ramas (D-17).
//   - NO duplicamos el evento de llamadas Plane OK — el provider lo emite
//     internamente (Pitfall #5). Solo emitimos `plane.api.call.failed{step:…}`
//     en las ramas de error (getTask / addComment / updateTaskState).
//   - Usar config.providers[provider].states.review (bajo providers, NO top-level, Pitfall #1).
//   - Fail-open Plane: getTask/addComment/updateTaskState en try/catch individuales (D-17).
//   - Provider obtenido UNA sola vez por ejecución (hoisted const provider). Sub-concern H.
//   - Idempotencia NO implementada en v0.3: duplicados aceptados (Pitfall #7).
//
// Legacy verdict mapping (Pitfall #2):
//   pass + side-effects OK  → 'approved' (reason: 'gate-passed')
//   pass pero getTask falla → 'blocked'  (reason: 'plane-unreachable:getTask-failed')
//   fail                    → 'blocked'  (reason: '<reason>:<detail>')
//   missing                 → 'blocked'  (reason: 'missing')
//   malformed               → 'blocked'  (reason: 'malformed:<detail>')

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findSession } from '../session/state.js';
import { loadConfig } from '../config.js';
import { initRegistry, getProvider } from '../providers/registry.js';
import { parseVerificationFrontmatter, computeVerdict } from './verification.js';
import { orchestratorReview, planeApiCallFailed } from '../logger-events.js';
import { createLogger } from '../logger.js';
import { markSessionStatus } from '../session/manager.js';

/**
 * @typedef {{ sessionId: string }} RunGsdVerifyOpts
 *
 * @typedef {{
 *   findSessionFn?: (opts: { sessionId: string }) => any,
 *   getProviderFn?: () => Promise<import('../interface.js').TaskProvider> | import('../interface.js').TaskProvider,
 *   loadConfigFn?: typeof loadConfig,
 *   readFileFn?: (path: string) => string,
 *   existsFn?: (path: string) => boolean,
 *   readdirFn?: (path: string) => string[],
 *   loggerFactory?: (sessionId: string) => import('../logger.js').Logger,
 * }} RunGsdVerifyDeps
 *
 * @typedef {import('./verification.js').Verdict | { action: 'missing', phase_id: string }} VerdictWithMissing
 *
 * @typedef {{
 *   verdict: VerdictWithMissing,
 *   plane: { commented: boolean, transitioned: boolean, comment_body: string },
 *   session: { session_id: string, task_ref: string, phase_id: string },
 * }} RunGsdVerifyResult
 */

/**
 * Run the GSD verification gate for a given session.
 *
 * @param {RunGsdVerifyOpts} opts
 * @param {RunGsdVerifyDeps} [deps]
 * @returns {Promise<RunGsdVerifyResult>}
 */
export async function runGsdVerify(opts, deps = {}) {
  // --- DI defaults -------------------------------------------------------
  // The real findSession returns `{ id, session } | null`. Tests inject a
  // mock that returns the session directly. Normalize here so the default
  // call-site matches the test contract: a Session object or undefined.
  const findSessionFn =
    deps.findSessionFn ||
    ((q) => {
      const r = findSession(q);
      return r ? r.session : undefined;
    });
  const loadConfigFn = deps.loadConfigFn || loadConfig;
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  const existsFn = deps.existsFn || existsSync;
  const readdirFn = deps.readdirFn || readdirSync;
  const loggerFactory =
    deps.loggerFactory ||
    ((sid) =>
      createLogger({
        sessionId: sid,
        minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
      }).child({ component: 'gsd' }));

  let getProviderFn = deps.getProviderFn;
  if (!getProviderFn) {
    await initRegistry();
    getProviderFn = () => getProvider(/** @type {any} */ (undefined));
  }

  // --- 1. Resolve session ------------------------------------------------
  const session = findSessionFn({ sessionId: opts.sessionId });
  if (!session) throw new Error(`session not found: ${opts.sessionId}`);
  if (!session.gsd) throw new Error(`session is not GSD: ${opts.sessionId}`);

  const log = loggerFactory(session.session_id).child({ task_id: session.task_id });

  // --- 2. Pitfall #4: phase_id ausente → malformed sin tocar filesystem --
  if (!session.phase_id) {
    /** @type {VerdictWithMissing} */
    const verdict = {
      action: 'malformed',
      phase_id: '',
      detail: 'session has no phase_id (bootstrap?)',
    };
    return finalize({ verdict, session, log, getProviderFn, loadConfigFn });
  }

  // --- 3. Descubrir directorio de fase (Pitfall #3) ----------------------
  // Canónico: entries.find((e) => e.startsWith(`${padded}-`)) — prefijo exacto.
  // Así "03" matchea "03-foundation" pero NO "30-other".
  const padded = /^\d+$/.test(session.phase_id)
    ? session.phase_id.padStart(2, '0')
    : session.phase_id; // "02.1" se queda como está
  const phasesRoot = join(session.project_path, '.planning', 'phases');

  /** @type {VerdictWithMissing} */
  let verdict;
  if (!existsFn(phasesRoot)) {
    verdict = { action: 'missing', phase_id: session.phase_id };
  } else {
    /** @type {string[]} */
    let entries;
    try {
      entries = readdirFn(phasesRoot);
    } catch (err) {
      // WR-02: sólo ENOENT colapsa a 'missing'. Errores de permisos (EACCES),
      // demasiados descriptores (EMFILE) u otros fallos son malformed — la fase
      // existe pero no se puede inspeccionar, distinto de "no existe".
      const code = /** @type {NodeJS.ErrnoException} */ (err).code;
      if (code === 'ENOENT') {
        entries = [];
      } else {
        verdict = {
          action: 'malformed',
          phase_id: session.phase_id,
          detail: `cannot read phases dir: ${code || 'unknown'}`,
        };
        return finalize({ verdict, session, log, getProviderFn, loadConfigFn });
      }
    }
    const match = entries.find((e) => e.startsWith(`${padded}-`));
    if (!match) {
      verdict = { action: 'missing', phase_id: session.phase_id };
    } else {
      const verPath = join(phasesRoot, match, `${padded}-VERIFICATION.md`);
      if (!existsFn(verPath)) {
        verdict = { action: 'missing', phase_id: session.phase_id };
      } else {
        // WR-02: readFile puede lanzar EACCES incluso si existsFn=true. Mapear
        // a malformed en vez de dejar burbujear como excepción no capturada.
        let md;
        try {
          md = readFileFn(verPath);
        } catch (err) {
          const code = /** @type {NodeJS.ErrnoException} */ (err).code;
          verdict = {
            action: 'malformed',
            phase_id: session.phase_id,
            detail: `cannot read VERIFICATION.md: ${code || 'unknown'}`,
          };
          return finalize({ verdict, session, log, getProviderFn, loadConfigFn });
        }
        const parsed = parseVerificationFrontmatter(md);
        verdict = computeVerdict(parsed, session.phase_id);
      }
    }
  }

  // --- 4. Finalize: postear + transicionar + loggear ---------------------
  return finalize({ verdict, session, log, getProviderFn, loadConfigFn });
}

/**
 * Post comment, transition (if pass + OK), and emit orchestrator.review.
 *
 * Hoists the provider: ONE call to `getProviderFn()` per execution; the same
 * instance is reused for getTask + addComment + updateTaskState.
 *
 * @param {{
 *   verdict: VerdictWithMissing,
 *   session: any,
 *   log: import('../logger.js').Logger,
 *   getProviderFn: () => Promise<import('../interface.js').TaskProvider> | import('../interface.js').TaskProvider,
 *   loadConfigFn: typeof loadConfig,
 * }} args
 * @returns {Promise<RunGsdVerifyResult>}
 */
async function finalize({ verdict, session, log, getProviderFn, loadConfigFn }) {
  const phaseName = session.summary || `Phase ${verdict.phase_id}`;
  const markdown = renderComment(verdict, phaseName);

  let commented = false;
  let transitioned = false;
  /** @type {any} */
  let task;

  // Hoist provider: UNA sola llamada a getProviderFn() por ejecución.
  const provider = await getProviderFn();

  try {
    task = await provider.getTask(session.task_ref);
  } catch (err) {
    planeApiCallFailed(log, {
      step: 'getTask',
      error: /** @type {Error} */ (err).message,
    });
  }

  if (task) {
    try {
      await provider.addComment(task, markdown);
      commented = true;
    } catch (err) {
      planeApiCallFailed(log, {
        step: 'addComment',
        error: /** @type {Error} */ (err).message,
      });
    }

    // updateTaskState: sólo si verdict pass Y addComment tuvo éxito.
    if (verdict.action === 'pass' && commented) {
      // Pitfall #1: config.providers[provider].states.review — NO top-level.
      const config = loadConfigFn();
      const providerName = session.provider || config.provider;
      const providerCfg = (config.providers && config.providers[providerName]) || {};
      const reviewState = (providerCfg.states && providerCfg.states.review) || 'In review';
      try {
        await provider.updateTaskState(task, reviewState);
        transitioned = true;
        // Phase 16 LOG-14 (D-11): mark session 'review' SOLO cuando pass + addComment OK
        // + updateTaskState OK. El reason 'gate-passed' espeja el verdict legacy mapping
        // documentado en la cabecera de este archivo (sección "Legacy verdict mapping":
        // pass + side-effects OK → 'approved', reason 'gate-passed') y el
        // orchestratorReview emitido abajo. El helper emite state.transition con
        // from/to reales vía logger. SC#3: las ramas fail/missing/malformed y errores
        // Plane NO emiten state.transition (verificado por
        // test/gsd-verify-integration.test.js Task 2).
        //
        // CR-01 fix (Phase 16): markSessionStatus → updateSession → writeFileSync sobre
        // ~/.kodo/state.json puede lanzar (EACCES, ENOSPC, EROFS, NFS hiccup). Sin este
        // catch local, el throw burbujea por finalize() y SALTA orchestratorReview abajo,
        // violando el invariante D-17 ("orchestratorReview emitido en TODAS las ramas").
        // En ese punto la cadena Plane ya completó (comment + transition), así que Plane
        // queda en "In review" pero el orquestador NUNCA recibe el verdict → split-brain.
        // state.transition es observability-only; orchestratorReview es el contractual
        // signal que consume el orquestador. Silenciar fallos de fs aquí preserva D-17.
        try {
          markSessionStatus(session.task_id, 'review', 'gate-passed', log);
        } catch {
          // intencionalmente vacío — ver comentario CR-01 arriba.
        }
      } catch (err) {
        planeApiCallFailed(log, {
          step: 'updateTaskState',
          error: /** @type {Error} */ (err).message,
        });
      }
    }
  }

  // --- 5. Pitfall #2: mapear action → legacy verdict ---------------------
  // Si verdict.action=pass pero task no se obtuvo (side-effect incompleto),
  // degradar a 'blocked' con reason 'plane-unreachable' — el orquestador
  // puede reintentar.
  let legacyVerdict;
  let reasonForLog;
  if (verdict.action === 'pass') {
    if (!task) {
      legacyVerdict = 'blocked';
      reasonForLog = 'plane-unreachable:getTask-failed';
    } else {
      legacyVerdict = 'approved';
      reasonForLog = 'gate-passed';
    }
  } else {
    legacyVerdict = 'blocked';
    if (verdict.action === 'fail') {
      reasonForLog = `${verdict.reason}:${verdict.detail}`;
    } else if (verdict.action === 'missing') {
      reasonForLog = 'missing';
    } else {
      // malformed
      reasonForLog = `malformed:${verdict.detail}`;
    }
  }

  orchestratorReview(log, {
    phase_id: verdict.phase_id,
    verdict: /** @type {'approved'|'blocked'} */ (legacyVerdict),
    reason: reasonForLog,
  });

  return {
    verdict,
    // Plan 15-04 Task 1 (DX-04): exponer markdown ya generado para que el CLI
    // pueda mostrar un summary slice SIN re-renderizar (Pitfall #2 Phase 10:
    // una sola superficie de generación → determinismo byte-a-byte intacto).
    plane: { commented, transitioned, comment_body: markdown },
    session: {
      session_id: session.session_id,
      task_ref: session.task_ref,
      phase_id: verdict.phase_id,
    },
  };
}

// --- Plantillas de comentario (deterministas, en español) ----------------
//
// D-15: mismo verdict → mismo comentario byte-a-byte (no timestamp).
// D-16: idioma español, prefijo `[kodo:gsd]` para grep en Plane.
// D-14: se postea en TODAS las ramas del verdict (pass, fail, missing, malformed).

/**
 * @param {VerdictWithMissing} verdict
 * @param {string} phaseName
 * @returns {string}
 */
export function renderComment(verdict, phaseName) {
  switch (verdict.action) {
    case 'pass':
      return renderPassComment(verdict, phaseName);
    case 'fail':
      return renderFailComment(verdict, phaseName);
    case 'missing':
      return renderMissingComment(verdict, phaseName);
    case 'malformed':
      return renderMalformedComment(verdict, phaseName);
  }
  // Exhaustividad — nunca alcanzado con el tipo correcto.
  return '';
}

/**
 * @param {import('./verification.js').PassVerdict} v
 * @param {string} phaseName
 * @returns {string}
 */
export function renderPassComment(v, phaseName) {
  return [
    `[kodo:gsd] ✅ Phase ${v.phase_id} verificada — ${phaseName}`,
    '',
    `- Must-haves: ${v.must_haves}/${v.must_haves} verificados`,
    `- Gaps: 0`,
    `- Transicionada a Review`,
    '',
    `Ver: \`.planning/phases/${padPhaseForPath(v.phase_id)}-*/${padPhaseForPath(v.phase_id)}-VERIFICATION.md\``,
  ].join('\n');
}

/**
 * @param {import('./verification.js').FailVerdict} v
 * @param {string} phaseName
 * @returns {string}
 */
export function renderFailComment(v, phaseName) {
  const header = `[kodo:gsd] ❌ Phase ${v.phase_id} bloqueada — ${phaseName}`;
  let body;
  switch (v.reason) {
    case 'gaps-found':
      body = `Motivo: ${v.detail}. Corrige VERIFICATION.md y re-dispara el flujo.`;
      break;
    case 'must-haves-incomplete':
      body = `Motivo: must_haves incompletos (${v.detail}). Completa los must-haves restantes y re-dispara.`;
      break;
    case 'status-failed':
      body = `Motivo: ${v.detail}. Revisa el artefacto, ajusta el status a passed cuando esté listo, y re-dispara.`;
      break;
    default:
      body = `Motivo: ${v.reason} (${v.detail}).`;
  }
  return [header, '', body].join('\n');
}

/**
 * @param {{ action: 'missing', phase_id: string }} v
 * @param {string} phaseName
 * @returns {string}
 */
export function renderMissingComment(v, phaseName) {
  return [
    `[kodo:gsd] ⚠️ VERIFICATION.md no encontrado para Phase ${v.phase_id}`,
    '',
    `Ejecuta \`/gsd-verify-work\` en la sesión y re-dispara el flujo.`,
  ].join('\n');
}

/**
 * @param {import('./verification.js').MalformedVerdict} v
 * @param {string} phaseName
 * @returns {string}
 */
export function renderMalformedComment(v, phaseName) {
  // WR-01: session sin phase_id (bootstrap) comparte action=malformed pero no
  // es un problema de VERIFICATION.md — no hay fase a verificar. Rama propia
  // en la plantilla para que el comentario en Plane sea accionable.
  if (!v.phase_id) {
    return [
      `[kodo:gsd] ⚠️ Sesión sin phase_id — verificación no aplicable`,
      '',
      `Detalle: ${v.detail}`,
      `Asocia la sesión a una fase del ROADMAP antes de verificar.`,
    ].join('\n');
  }
  return [
    `[kodo:gsd] ⚠️ VERIFICATION.md presente pero inválido (Phase ${v.phase_id})`,
    '',
    `Detalle: ${v.detail}`,
    `Corrige el frontmatter y re-dispara el flujo.`,
  ].join('\n');
}

/** Pad numeric phase_id to 2 digits; leave non-numeric (e.g. "02.1") as-is. */
function padPhaseForPath(phaseId) {
  return /^\d+$/.test(String(phaseId)) ? String(phaseId).padStart(2, '0') : String(phaseId);
}
