// @ts-check
//
// src/logger-events.js — FACADE de la taxonomía de eventos.
//
// La superficie pública no cambió con el split por dominio: todo consumidor sigue
// importando de `logger-events.js` (`import { EVENTS, sessionStart } from ".../logger-events.js"`).
// Lo que hay debajo son 6 módulos de dominio + `events.js` (la constante `EVENTS` y
// `resolveTranscriptPath`), para que descubrir qué eventos existen por subsistema sea
// abrir un fichero y no recorrer 1.200 líneas.
//
//   logger-events/events.js       EVENTS + resolveTranscriptPath
//   logger-events/session.js      session.* · state.transition · orchestrator.review · gsd.* · skill.sync.*
//   logger-events/provider.js     plane.api.* · github.api.* · provider.state.fetch.failed
//   logger-events/host.js         host.list_workspaces.* · host.reconcile.tick
//   logger-events/doctor.js       doctor.* · sidebar.doctor.*
//   logger-events/worktree.js     worktree.cleanup.* · worktree.branch.kept
//   logger-events/integration.js  polling.* · webhook.* · dispatch.* · integrate.action
//
// Contrato fijo por ROADMAP §Phase 7 + extensiones v0.3 (LOG-09) + Phases 19/21/23/25/28,
// Phase 38 (state migration + host reconcile), Phase 40 (provider_state), Phase 41 y 79
// (doctor + sidebar doctor), Phase 71 (backstop de In Review) y KODO-28 (webhook → dispatch).
//
// LOG-12 invariant (post-Phase-80): tras el carril orquestador (ORCH-07),
// `src/check.js → cmux/sidebar-doctor.js → logger-events.js` SÍ alcanza este módulo.
// No viola LOG-12: el subárbol entero sigue siendo pure transform zero-side-effect —
// sus únicos imports runtime son `node:os` + `node:path` en `logger-events/events.js`,
// no abre archivos ni loguea. El módulo PROHIBIDO en el grafo del vigilante es
// `logger.js` (el sink NDJSON real), NUNCA este helper de taxonomía.

export { EVENTS, resolveTranscriptPath } from './logger-events/events.js';

export {
  sessionStart,
  sessionEnd,
  stateTransition,
  orchestratorReview,
  gsdPhaseResolved,
  gsdBootstrap,
  sessionDismissed,
  skillSyncAuto,
  skillSyncAutoError,
  stateMigrationV3,
  sessionBackstopReview,
  sessionOrphanDetected,
  sessionCloseUnmatched,
} from './logger-events/session.js';

export {
  planeApiCall,
  planeApiCallFailed,
  githubApiCall,
  githubApiCallFailed,
  providerStateFetchFailed,
} from './logger-events/provider.js';

export {
  hostListOk,
  hostListFail,
  hostReconcileTick,
} from './logger-events/host.js';

export {
  doctorScan,
  doctorFixWorktree,
  doctorFixLock,
  doctorFixLog,
  doctorFixError,
  sidebarDoctorScan,
  sidebarDoctorFix,
  sidebarDoctorFixError,
} from './logger-events/doctor.js';

export {
  worktreeCleanupOk,
  worktreeCleanupDirty,
  worktreeCleanupError,
  worktreeBranchKept,
} from './logger-events/worktree.js';

export {
  pollingTick,
  pollingDispatch,
  pollingError,
  pollingTickSummary,
  integrateAction,
  webhookReceived,
  webhookRejected,
  webhookDispatchRetry,
  webhookReplay,
  dispatchDecision,
  dispatchError,
} from './logger-events/integration.js';
