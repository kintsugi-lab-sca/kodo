// @ts-check
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getProvider } from '../providers/registry.js';
import { loadConfig, loadProjects, KODO_DIR } from '../config.js';
import { parseKodoLabels, getGsdMode, isGsdChild, isAdopted } from '../labels.js';
import { assigneeVerdict, SKIP_UNASSIGNED } from '../operator.js';
import {
  blockerVerdict,
  blockerSignature,
  formatBlockedComment,
  shouldAnnounceBlock,
  forgetAnnouncedBlock,
} from '../blockers.js';
import { listSessions, removeSession, computeRealWorktreePath } from '../session/state.js';
import { launchWorkItem, resolveProjectPath } from '../session/manager.js';
import { acquireGsdLock, releaseGsdLock } from '../gsd/lock.js';
import { acquireLock, releaseLock, startLockHeartbeat } from '../session/state-lock.js';
import { getHost, resolveHostName } from '../host/interface.js';
import { resolvePhase } from '../gsd/resolver.js';
import { buildBriefFromTask, isBriefEmpty } from '../gsd/brief.js';
import { countPendingForProject } from '../integration/queue.js';
import { enqueueOrchestratorEvent } from '../orchestrator/inbox.js';
import { EVENTS, gsdPhaseResolved, gsdBootstrap, dispatchDecision, dispatchError } from '../logger-events.js';

/** In-flight dispatch locks keyed by task_id (prevents duplicate sessions from concurrent webhooks) */
const inFlight = new Set();

/**
 * TTL del dedup lock non-GSD (KODO-48).
 *
 * Sube de 120s a 300s. El TTL solo importa para un dueño VIVO: si el proceso murió,
 * `acquireLock` lo detecta por `isPidAlive` y roba al instante sin esperar plazo
 * alguno. Así que alargarlo no retrasa la recuperación del caso frecuente (crash),
 * solo la del raro (proceso vivo pero colgado dentro del launch).
 *
 * Es el SUELO, no la defensa principal: la defensa es el heartbeat de abajo, que
 * mantiene el lock fresco durante todo el launch. El TTL cubre el hueco en que el
 * latido no puede sonar —event loop bloqueado por trabajo síncrono largo— y ahí
 * 300s da un margen mucho más honesto que 120s.
 *
 * Override por env SOLO para tests (mismo precedente que `KODO_TEST_FORCE_THROW`):
 * un escenario que quiera ejercer «launch más largo que el TTL» no puede esperar
 * cinco minutos de reloj.
 */
const DISPATCH_LOCK_TTL_MS = Number(process.env.KODO_DISPATCH_LOCK_TTL_MS) || 300_000;

/**
 * Cadencia del heartbeat: TTL/3 (KODO-48). Tres latidos por ventana de TTL — se
 * pueden perder dos seguidos (GC largo, IO síncrono) sin que el lock envejezca
 * hasta stale.
 */
const DISPATCH_LOCK_HEARTBEAT_MS = Math.max(50, Math.floor(DISPATCH_LOCK_TTL_MS / 3));

/**
 * Techo de renovación: 6 × TTL (30 min por defecto).
 *
 * El trade-off del heartbeat, explícito: renovar sin límite convierte un launch
 * colgado-pero-vivo en un lock INMORTAL, y esa tarea no se volvería a despachar
 * jamás. Pasado este techo el latido calla y el TTL recupera el lock, así que el
 * bloqueo máximo queda acotado en `maxHold + TTL` (~35 min) en vez de infinito.
 * Un launch legítimo de media hora no existe; si apareciera, el problema sería el
 * launch, no el lock.
 */
const DISPATCH_LOCK_MAX_HOLD_MS = DISPATCH_LOCK_TTL_MS * 6;

/**
 * KODO-10 (deliverable B): convierte un verdict fail-closed del resolver GSD en una pista
 * ACCIONABLE para el log del daemon. `resolver_failed — <ref>: no-match` a secas no explica el
 * contrato kodo:gsd (el título de la tarea debe coincidir EXACTAMENTE con el título de una fase
 * de ROADMAP.md), lo que costó una segunda ronda de diagnóstico en el caso SCP. Pura, never-throws.
 *
 * @param {{ code: string, detail?: string, matches?: string[] }} verdict
 * @param {{ taskTitle?: string, projectPath?: string|null, mode?: string }} [ctx]
 * @returns {string}
 */
export function resolverFailureHint(verdict, ctx = {}) {
  const proj = ctx.projectPath || '<project>';
  switch (verdict.code) {
    case 'no-match':
      return `task title "${ctx.taskTitle ?? ''}" does not match any ROADMAP phase of ${proj} — rename the task to an exact phase title ("## Phase N: Título", sin sufijos entre el número y ":") or add the kodo:gsd-quick label for one-off tasks`;
    case 'roadmap-missing':
      return `${proj} has .planning/PROJECT.md but no ROADMAP.md${verdict.detail ? ` (${verdict.detail})` : ''} — create the ROADMAP or run the GSD roadmap step`;
    case 'multi-match':
      return `task title matches multiple ROADMAP phases${verdict.matches ? ` (${verdict.matches.join(' | ')})` : ''} — phase titles must be unique`;
    default:
      return verdict.detail || verdict.code;
  }
}

/**
 * AVISO de presión de integración (KODO-72). JAMÁS un bloqueo.
 *
 * El dispatcher lanza hasta `max_parallel` sesiones sin mirar la cola de integración, así que
 * hoy nada avisa de que se abre una rama nueva sobre un repo que YA acumula ramas sin integrar.
 * Ramas paralelas sobre el mismo árbol conflictúan — es lo que pasó el 2026-09-01 con SCP-21 /
 * SCP-15 (commits huérfanos y un merge de recuperación a mano).
 *
 * POR QUÉ AVISO Y NO GATE. El precedente externo (swarm-forge, `ready_for_next_guard.bb:112-114`)
 * se NIEGA a aceptar trabajo nuevo mientras el rol tenga una entrega en vuelo: imprime
 * WAITING_FOR_APPROVAL y para. Aquí no, y no es un descuido:
 *
 *   1. Bloquear rompe el paralelismo, que es el punto entero de kodo. Dos ramas sobre el mismo
 *      repo son el caso NORMAL, no la anomalía; lo que falta no es un permiso, es una mirada.
 *   2. Un gate que molesta acaba apagado (el razonamiento es de KODO-69). Un aviso que se lee
 *      una vez por lanzamiento sobrevive; un `--no-verify` mental no.
 *
 * Así que esta función no tiene veredicto: cuenta, avisa por las dos superficies que el operador
 * ya mira, y devuelve. El caller sigue al launch pase lo que pase aquí.
 *
 * DOS SUPERFICIES, ninguna nueva:
 *   - `console.log('[kodo:dispatch] integration_pressure — …')`, el mismo carril por el que ya
 *     salen `worktree_collision`, `gsd_locked`, `resolver_failed` y `dispatch.skipped`.
 *   - Un evento `integration-pressure` en la bandeja del orquestador, que la ronda ya lee en su
 *     paso 1 (y que, a diferencia del stdout del daemon, sobrevive al proceso).
 *
 * NEVER-THROWS DE CUERPO ENTERO y FAIL-OPEN: cualquier fallo —contar, loguear o encolar— se traga
 * y devuelve. Un aviso que pudiera abortar un lanzamiento sería exactamente el bloqueo que esta
 * tarea prohíbe.
 *
 * CERO LLAMADAS A GIT: el conteo sale del bloque `integration_queue` de `state.json`.
 *
 * COLA VACÍA ⇒ NADA. Con `pending === 0` se vuelve ANTES de tocar stdout o la bandeja, así que el
 * camino de lanzamiento habitual queda byte-idéntico al de antes de KODO-72.
 *
 * @param {{ ref: string }} task
 * @param {string|null} projectPath repo destino ya resuelto por el dispatcher.
 * @param {DispatchDeps} deps
 * @returns {number} las entradas pending contadas (0 = sin aviso). Solo para tests y trazas.
 */
function noticeIntegrationPressure(task, projectPath, deps) {
  const countFn = deps.countPendingIntegrationsFn || countPendingForProject;
  const enqueueFn = deps.enqueueOrchestratorEventFn || enqueueOrchestratorEvent;

  let pending = 0;
  try {
    pending = countFn(projectPath || '');
  } catch {
    return 0; // fail-open: una cola que no se puede contar es una cola sin presión.
  }
  if (!Number.isFinite(pending) || pending <= 0) return 0;

  const plural = pending === 1 ? 'entrada' : 'entradas';
  try {
    console.log(
      `[kodo:dispatch] integration_pressure — ${task.ref} va a un repo con ${pending} ${plural} pending en la cola de integración (${projectPath}); se lanza igualmente`,
    );
  } catch {
    // silencioso: un stdout roto (EPIPE bajo launchd) no puede frenar el launch.
  }
  try {
    enqueueFn({
      kind: 'integration-pressure',
      task_ref: task.ref,
      // El saneo del texto lo hace `buildOrchestratorEvent` en el punto de construcción
      // (invariante STATE.md:176), igual que con el resto de productores de la bandeja.
      text:
        `${task.ref} va a un repo con ${pending} ${plural} pending en la cola de integración. ` +
        `Path: ${projectPath}. Aviso, no bloqueo: la sesión se lanzó igual. Repasa la cola ` +
        `(paso 5b) antes de que se acumulen más ramas sin integrar sobre el mismo árbol.`,
    });
  } catch {
    // silencioso: `enqueueOrchestratorEvent` ya es never-throws; el catch cubre el seam.
  }
  return pending;
}

/**
 * @typedef {{
 *   getProviderFn?: (name?: string) => import('../interface.js').TaskProvider,
 *   launchWorkItemFn?: (ref: string, opts: object) => Promise<any>,
 *   listSessionsFn?: () => any[],
 *   listWorkspacesFn?: () => Promise<string>,
 *   removeSessionFn?: (id: string) => void,
 *   acquireGsdLockFn?: (projectPath: string, sessionInfo: {session_id: string, task_id: string, task_ref: string}) => {acquired: boolean, holder?: object},
 *   releaseGsdLockFn?: (projectPath: string, sessionId: string) => void,
 *   resolveProjectPathFn?: (task: import('../interface.js').TaskItem, projects: Record<string, any>) => string,
 *   resolvePhaseFn?: (params: { projectPath: string, task: object }) => import('../gsd/resolver.js').ResolveResult,
 *   existsSyncFn?: (path: string) => boolean,
 *   acquireLockFn?: (lockPath: string, opts?: object) => ({ token: string } | null),
 *   releaseLockFn?: (lockPath: string, token: string) => void,
 *   startLockHeartbeatFn?: (lockPath: string, token: string, opts: { intervalMs: number, maxHoldMs: number }) => (() => void),
 *   dispatchLockDir?: string,
 *   countPendingIntegrationsFn?: (projectPath: string) => number,
 *   enqueueOrchestratorEventFn?: (input: object) => any,
 *   _logger?: any,
 * }} DispatchDeps
 */

/**
 * Central dispatch function for all trigger sources.
 * Provider-agnostic: accepts a TriggerEvent and decides whether to launch,
 * ignore, or detect stale sessions.
 *
 * @param {import('../interface.js').TriggerEvent} event
 * @param {{ model?: string|null, flags?: string[], force?: boolean }} [opts]
 * @param {DispatchDeps} [deps] - Injectable dependencies for testing
 * @returns {Promise<{ action: 'launched'|'ignored'|'already_active'|'stale_relaunch'|'cleaned'|'gsd_locked'|'resolver_failed'|'worktree_collision', session?: object, holder?: object, code?: string, detail?: string }>}
 */
async function dispatchTriggerImpl(event, opts = {}, deps = {}) {
  const getProviderFn = deps.getProviderFn || ((name) => getProvider(name || event.provider));
  const launchWorkItemFn = deps.launchWorkItemFn || launchWorkItem;
  const listSessionsFn = deps.listSessionsFn || listSessions;
  // KODO-18: la lista de workspaces sale del host ACTIVO (`_legacy`), no del binario
  // cmux. El seam `deps.listWorkspacesFn` no cambia — solo su default.
  const listWorkspacesFn =
    deps.listWorkspacesFn || (() => getHost(resolveHostName())._legacy.listWorkspaces());
  const removeSessionFn = deps.removeSessionFn || removeSession;
  const acquireGsdLockFn = deps.acquireGsdLockFn || acquireGsdLock;
  const releaseGsdLockFn = deps.releaseGsdLockFn || releaseGsdLock;
  const resolveProjectPathFn = deps.resolveProjectPathFn || ((task) => resolveProjectPath(task, loadProjects()));
  const resolvePhaseFn = deps.resolvePhaseFn || resolvePhase;
  // Phase 18 D-05: parametrizable for test hygiene (precedente: la mayoría
  // de IO en dispatch ya está parametrizado vía DispatchDeps).
  const existsSyncFn = deps.existsSyncFn || existsSync;
  // Phase 70 (CONC-08/D-13): per-task_id cross-process dedup lock on the NON-GSD
  // lane. Reuses the Plan-01 primitive (state-lock.js) — NOT a new lock impl.
  // Mirrors the GSD lane's acquireGsdLockFn/releaseGsdLockFn DI. The lock dir
  // defaults to `~/.kodo/locks` (KODO_DIR) and is injectable for HOME-isolated tests.
  const acquireLockFn = deps.acquireLockFn || acquireLock;
  const releaseLockFn = deps.releaseLockFn || releaseLock;
  // KODO-48: heartbeat del dedup lock, inyectable con la misma forma que sus dos
  // hermanos (acquire/release) para que un test pueda observarlo sin timers reales.
  const startLockHeartbeatFn = deps.startLockHeartbeatFn || startLockHeartbeat;
  const dispatchLockDir = deps.dispatchLockDir || join(KODO_DIR, 'locks');

  // 1. Resolve task via provider
  const provider = getProviderFn(event.provider);
  console.log(`[kodo:dispatch] Resolving taskRef: ${event.taskRef}`);
  const task = await provider.getTask(event.taskRef);
  console.log(`[kodo:dispatch] Task: ${task.ref} — labels: [${task.labels.join(', ')}]`);

  // 1b. Anti-recursion guard — kodo:gsd-child labels mark sub-issues created
  // by the agent (Phase 15+) for progress reporting. Drop them BEFORE any
  // further processing, even under opts.force. Hard safety property: see
  // Phase 14 D-06 (cuts before parseKodoLabels) and D-07 (--force does NOT
  // bypass). Cuts before lock acquisition and resolver to avoid wasted work.
  if (isGsdChild(task.labels)) {
    console.log(`[kodo:dispatch] Ignored — kodo:gsd-child filtered (anti-recursion)`);
    return { action: 'ignored', code: 'gsd_child' };
  }

  // 1c. Anti-recursion guard — kodo:adopted marks tasks created by `createTask`
  // for an adopted ad-hoc session (Phase 52 BIDIR-06). Drop them BEFORE any
  // further processing, even under opts.force. Hard safety property (D-02):
  // cuts before parseKodoLabels / lock / resolver / launch so a freshly adopted
  // task is NEVER re-dispatched into a second, colliding session. LOAD-BEARING
  // (Pitfall 1): parseKodoLabels treats kodo:adopted as isKodo:true, so the
  // primary "no kodo label" gate below would NOT suppress it once the marker is
  // present — this early cut is what fully suppresses it, and --force does NOT
  // bypass it (must precede the force-skip block below).
  if (isAdopted(task.labels)) {
    console.log(`[kodo:dispatch] Ignored — kodo:adopted filtered (anti-recursion)`);
    return { action: 'ignored', code: 'adopted' };
  }

  // 2. Check kodo labels (skip if force=true)
  if (!opts.force) {
    const kodoConfig = parseKodoLabels(task.labels.map((name) => ({ name })));
    console.log(`[kodo:dispatch] isKodo: ${kodoConfig.isKodo}, model: ${kodoConfig.model}`);
    if (!kodoConfig.isKodo) {
      console.log(`[kodo:dispatch] Ignored — no kodo label`);
      // KODO-28: `code` añadido para que `dispatch.decision` distinga POR QUÉ se
      // ignoró. Las ramas gsd_child/adopted ya lo traían; estas tres no, y sin él
      // el audit solo veía `action:'ignored'` para tres causas muy distintas.
      return { action: 'ignored', code: 'no_kodo_label' };
    }
  }

  // Parse labels for model/flags regardless of force (needed for launch opts)
  const kodoConfig = parseKodoLabels(task.labels.map((name) => ({ name })));

  // GSD execution mode (full|quick|null). 'kodo:gsd-quick' takes precedence
  // over 'kodo:gsd' if both labels are present (more specific intent).
  // Both modes share lock + bootstrap paths; only the prompt and phase
  // resolution semantics diverge.
  const gsdMode = getGsdMode(kodoConfig.flags);

  // Un solo `loadConfig()` para los dos gates que lo necesitan (2b estados, 2c operador).
  const config = loadConfig();

  // 2b. Handle terminal states — clean up session if task moved to Done/Cancelled
  if (task.state) {
    const providerStates = config.providers?.[event.provider]?.states || {};
    const terminalStates = [providerStates.done, 'Cancelled'].filter(Boolean);
    if (terminalStates.some((s) => s.toLowerCase() === task.state.toLowerCase())) {
      const existing = listSessionsFn().find((s) => s.task_id === task.id);
      if (existing) {
        // KODO-47: `removeSessionFn` degrada a `{ok:false, reason:'lock-timeout'}` sin
        // lanzar (D-03). El `action` se mantiene en `cleaned` —el veredicto del
        // dispatcher para esta tarea NO cambia: sigue siendo terminal y no se lanza
        // nada— pero el `code` distingue el pase que SÍ escribió del que se quedó sin
        // lock, para que `dispatch.decision` no registre una limpieza inexistente. La
        // fila sigue en state.json y el próximo evento de esta tarea vuelve a entrar
        // aquí y reintenta; el `code` es lo único que faltaba para poder verlo.
        const r = removeSessionFn(task.id);
        if (r && r.ok === false) {
          console.warn(
            `[kodo:dispatch] ${task.ref} — limpieza NO aplicada (${r.reason}); la sesión sigue en state.json`,
          );
          return { action: 'cleaned', code: 'cleanup_lock_timeout' };
        }
        console.log(`[kodo:dispatch] Cleaned session for ${task.ref} — moved to "${task.state}"`);
        return { action: 'cleaned' };
      }
      console.log(`[kodo:dispatch] Ignored — state "${task.state}" is terminal`);
      return { action: 'ignored', code: 'terminal_state' };
    }

    // Ignore inactive states (skip if force=true)
    // Default: Backlog + configured review state (human turn, no re-dispatch)
    if (!opts.force) {
      const defaultIgnore = ['Backlog'];
      if (providerStates.review) defaultIgnore.push(providerStates.review);
      const ignoreStates = providerStates.ignore || defaultIgnore;
      if (ignoreStates.some((s) => s.toLowerCase() === task.state.toLowerCase())) {
        console.log(`[kodo:dispatch] Ignored — state "${task.state}" is inactive`);
        return { action: 'ignored', code: 'inactive_state' };
      }
    }
  }

  // 2c. Multi-operador (KODO-58) — esta tarea, ¿es de ESTA máquina?
  //
  // Con dos daemons sobre los mismos proyectos (dos operadores, dos máquinas), el mismo
  // webhook llega a los dos y hasta aquí AMBOS lanzaban la sesión. Ni `max_parallel`
  // (KODO-55) ni `state.json` lo evitan: son por máquina, y cada una cree tener el
  // trabajo para ella sola. La única señal que ya distingue a un operador de otro en el
  // tablero es a quién está ASIGNADA la tarea, y es la que se usa aquí.
  //
  // POSICIÓN EN LA SECUENCIA — va DESPUÉS del bloque 2b, y eso es LOAD-BEARING: si una
  // tarea que lanzamos nosotros se reasigna a otro operador y luego se cierra, la
  // limpieza de su sesión local (`removeSessionFn`) tiene que seguir ocurriendo. Cortar
  // antes dejaría esa fila colgada en `state.json` para siempre. Va ANTES del in-flight
  // guard y del lock porque, ya decidido que no es nuestra, todo lo demás es trabajo
  // tirado.
  //
  // `--force` lo salta, mismo patrón que el gate de etiqueta y el de estados inactivos:
  // `kodo launch <ref> --force` es una orden explícita de un humano sentado en ESTA
  // máquina, y ahí la regla de reparto sobra.
  if (!opts.force) {
    // `getOperator` es OPCIONAL (typeof-detected, igual que getTaskState/createTask):
    // un provider que no la implemente deja el gate inerte por construcción.
    const operatorId =
      typeof provider.getOperator === 'function' ? provider.getOperator()?.id : null;
    const verdict = assigneeVerdict({
      assignees: task.assignees,
      operatorId,
      requireAssignee: config.dispatch?.require_assignee !== false,
    });
    if (!verdict.eligible) {
      // La línea de SIN ASIGNADO se emite aparte y con su propio motivo porque no
      // describe un reparto, sino un agujero: mientras nadie la reclame, esa tarea no la
      // lanza NADIE. Es exactamente lo que evita el doble lanzamiento, y el operador
      // tiene que poder verlo en el log para saber que le toca asignarla.
      const reason = verdict.code;
      console.log(
        `[kodo:dispatch] dispatch.skipped reason=${reason} — ${task.ref}` +
          (reason === SKIP_UNASSIGNED
            ? ' no tiene asignado; asígnatela para que este daemon la lance'
            : ' está asignada a otro operador'),
      );
      return { action: 'ignored', code: reason };
    }
  }

  // 2d. Bloqueos declarados en el tablero (KODO-73) — ¿puede esta tarea empezar YA?
  //
  // kodo no tiene concepto de dependencia entre tareas: lanza por prioridad y slots
  // libres. Una tarea marcada como bloqueada en el board se lanzaba igual, y la sesión
  // descubría el bloqueo a mitad de trabajo — o construía sobre una base inexistente.
  // No hace falta un grafo propio: el proveedor YA modela `blocked_by`; basta con no
  // lanzar lo que el tablero ya declara bloqueado.
  //
  // CAPABILITY-GATED por `typeof`, igual que getTaskState/createTask/getOperator: el
  // contrato TaskProvider sigue FROZEN en 9 métodos. GitHub Issues no tiene equivalente
  // nativo de `blocked_by` y su provider no implementa `listBlockers`, así que ahí el
  // path de lanzamiento queda IDÉNTICO al anterior — cero llamadas extra, no solo cero
  // efecto. Ese `typeof` es también la respuesta al coste: solo paga la llamada quien
  // tiene la capacidad, y solo después de que los gates baratos (etiqueta, estado,
  // operador) hayan descartado la tarea.
  //
  // POSICIÓN — después del gate de operador (2c) y antes del in-flight guard (3): una
  // tarea de otro operador no debe pagar la llamada a relaciones, y una bloqueada no
  // debe consumir lock ni resolver de fase. Cubre webhook Y polling de una sola vez
  // porque ambos carriles entran por aquí.
  //
  // FAIL-OPEN ante error: un `/relations/` caído degrada al comportamiento anterior a
  // KODO-73, nunca a un daemon que no lanza nada. Mismo criterio que el gate de
  // operador ante identidad desconocida.
  //
  // NO se toca el estado de la tarea, a propósito: todas las ramas `ignored` de este
  // dispatcher son de solo lectura, y devolver la tarea a Todo pelearía con el operador
  // que la movió a mano (ping-pong en cada tick hasta que cierre el bloqueador). La
  // constancia se deja en un comentario, que es aditivo y no pisa intención humana.
  if (
    !opts.force &&
    config.dispatch?.respect_blockers !== false &&
    typeof provider.listBlockers === 'function'
  ) {
    /** @type {any} */
    let blockers = null;
    try {
      blockers = await provider.listBlockers(task);
    } catch (err) {
      // `blockers` se queda en null → blockerVerdict lo lee como «no lo sé» y deja pasar.
      console.warn(
        `[kodo:dispatch] blockers_probe_failed — ${task.ref}: ${/** @type {any} */ (err)?.message ?? err}`,
      );
    }
    const verdict = blockerVerdict({ blockers });
    if (verdict.blocked) {
      const signature = blockerSignature(verdict.open);
      // Un comentario por CONJUNTO de bloqueadores: el polling revisita la tarea en cada
      // tick y sin esto una tarea bloqueada una semana acumula cientos de avisos
      // idénticos. Si el conjunto cambia, eso sí es información nueva y se vuelve a decir.
      if (shouldAnnounceBlock(task.id, signature)) {
        try {
          await provider.addComment(task, formatBlockedComment(task.ref, verdict.open));
        } catch (err) {
          // El comentario es la CONSTANCIA, no el veredicto: que falle no puede convertir
          // una tarea bloqueada en lanzable. Se olvida la firma para reintentar el aviso
          // en el próximo tick.
          forgetAnnouncedBlock(task.id);
          console.warn(
            `[kodo:dispatch] blocked_comment_failed — ${task.ref}: ${/** @type {any} */ (err)?.message ?? err}`,
          );
        }
      }
      console.log(
        `[kodo:dispatch] dispatch.skipped reason=${verdict.code} — ${task.ref} bloqueada por ${signature}`,
      );
      return { action: 'ignored', code: verdict.code, detail: signature };
    }
    // Ya no está bloqueada: se olvida lo anunciado para que un bloqueo que reaparezca
    // vuelva a avisar en vez de quedarse mudo por una firma vieja.
    //
    // SOLO con lectura BUENA (`Array.isArray`), y esa condición es el arreglo de un bug
    // real: a este punto también se llega con `blockers === null` cuando la sonda falló,
    // y olvidar ahí borraría la firma de un bloqueo que sigue vigente. El siguiente tick
    // volvería a comentar lo mismo, y el contrato de «un aviso por conjunto» se
    // convertiría en «un aviso por cada fallo de red».
    if (Array.isArray(blockers)) forgetAnnouncedBlock(task.id);
  }

  // 3. In-flight guard — prevents duplicate dispatches for the same task
  //    when webhooks arrive in rapid succession (state.json is written
  //    only after launchWorkItem finishes, which can take seconds).
  if (inFlight.has(task.id)) {
    console.log(`[kodo:dispatch] Ignored — ${task.ref} already dispatching`);
    return { action: 'already_active' };
  }

  // 3b. GSD repo lock guard — per D-08, only for GSD-flagged tasks.
  // Generate the sessionId BEFORE acquiring the lock (fix CR-01: acquire,
  // persist, and release must share the same ownership identity). Thread it
  // through to launchWorkItemFn via opts.sessionId so buildSessionFromTask
  // persists the same value that the stop hook will later use to release.
  let gsdSessionId = null;
  let gsdProjectPath = null;
  if (gsdMode) {
    try {
      gsdProjectPath = resolveProjectPathFn(task);
    } catch {
      // Cannot resolve path — skip lock guard (launch will fail later with same error)
      gsdProjectPath = null;
    }
    if (gsdProjectPath) {
      gsdSessionId = randomUUID();
      const lockResult = acquireGsdLockFn(gsdProjectPath, {
        session_id: gsdSessionId,
        task_id: task.id,
        task_ref: task.ref,
      });
      if (!lockResult.acquired) {
        console.log(`[kodo:dispatch] gsd_locked — ${task.ref} blocked by lock on ${gsdProjectPath}`);
        return { action: 'gsd_locked', holder: lockResult.holder };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Phase 18 D-05, D-05b, D-06b: fail-fast worktree_collision canonical
  // error. Single source of truth para el path: computeRealWorktreePath de
  // session/state.js (KODO-30 — antes el legacy `.bg-shell`, que comprobaba
  // colisión sobre un directorio que Claude Code nunca crea: el check no podía
  // dar positivo jamás). Patrón paralelo a gsd_locked (Phase 8
  // D-19) y resolver_failed (Phase 9 D-13): action explícito + return
  // early ANTES de invocar launchWorkItem.
  //
  // Para sesiones GSD: gsdSessionId ya está generado tras lock acquire.
  // Para sesiones no-GSD (D-06b): generamos sessionId aquí early-bird
  // para poder check colisión PRE-launch. Threaded a launchWorkItem via
  // opts.sessionId (mismo mecanismo que GSD por CR-01 fix).
  //
  // INVARIANTE WT-03: el lock per-repo (Phase 8 GSD-10) sigue siendo
  // sobre projectPath, JAMÁS sobre worktreePath. acquireGsdLockFn arriba
  // NO se modifica.
  //
  // Si resolveProjectPathFn throws (config humano roto) el path no se
  // computa y se omite el check — graceful, heredado v0.5: launchWorkItem
  // fallará luego con su propio error.
  //
  // WR-03 (review): ventana TOCTOU aceptada (threat model T-18-07). Entre
  // existsSyncFn (línea 179) y cmux.send (manager.js:255) hay decenas/
  // cientos de ms donde un proceso externo podría crear
  // <projectPath>/.claude/worktrees/<sessionId>/. Probabilidad efectiva ~0 (UUID
  // v4 de 122 bits + dispatcher es punto único de generación de sessionId
  // por phase). Si ocurre, el síntoma es un fallo de `claude --worktree`
  // en runtime (no en collision-check). No emitimos canonical
  // `worktree_collision` en ese caso — el operador verá el error opaco
  // de cmux y debe inferir TOCTOU. Instrumentación deferida a v0.6.
  // ─────────────────────────────────────────────────────────────────────
  let dispatchSessionId = gsdSessionId;
  let dispatchProjectPath = gsdProjectPath;
  if (!gsdMode) {
    try {
      dispatchProjectPath = resolveProjectPathFn(task);
    } catch {
      dispatchProjectPath = null;
    }
    if (dispatchProjectPath) dispatchSessionId = randomUUID();
  }
  if (dispatchSessionId && dispatchProjectPath) {
    const worktreePath = computeRealWorktreePath(dispatchProjectPath, dispatchSessionId);
    // WR-04 (review): existsSync devuelve `false` ante TODO error
    // (EACCES, ENOTDIR, EIO, FUSE disconnect) — false-negative silencioso.
    // Si el directorio no puede verificarse, procedemos al launch (el path
    // determinístico con UUID v4 hace que la colisión real sea ~imposible);
    // logueamos el probe failure para forensic post-mortem si claude
    // --worktree falla luego con un error opaco.
    let pathExists = false;
    try {
      pathExists = existsSyncFn(worktreePath);
    } catch (probeErr) {
      console.log(`[kodo:dispatch] worktree_probe_failed — ${task.ref}: ${probeErr.message}`);
      // pathExists stays false — proceed to launch. Si existe-pero-no-podemos-leer,
      // claude --worktree fallará con su propio error de filesystem.
    }
    if (pathExists) {
      // Release lock if GSD acquired one (no leak — Phase 8 D-09 idempotent)
      if (gsdSessionId && gsdProjectPath) {
        try {
          releaseGsdLockFn(gsdProjectPath, gsdSessionId);
        } catch {
          // silent — release is idempotent (Phase 8 D-09)
        }
      }
      console.log(`[kodo:dispatch] worktree_collision — ${task.ref} blocked by existing worktree at ${worktreePath}`);
      return { action: 'worktree_collision', code: 'worktree_exists', detail: worktreePath };
    }
  }

  // 3c. GSD phase resolution (Phase 9, D-03). Runs AFTER lock acquisition and
  // BEFORE the session-already-active guard so that stale relaunches also
  // receive phase_id + brief threaded (pattern-mapper refinement #2 — if this
  // moved below the already-active check, relaunches of stale sessions would
  // miss the resolver output).
  //
  // Fail-closed (D-13): error verdicts release the lock and return early.
  let gsdPhaseId = null;
  let gsdBrief = null;
  let resolverVerdict = null;
  if (gsdMode && gsdProjectPath) {
    resolverVerdict = resolvePhaseFn({ projectPath: gsdProjectPath, task });
    switch (resolverVerdict.action) {
      case 'phase':
        // Quick mode is phase-agnostic: a phase match is incidental, the
        // session runs `/gsd-quick` regardless. Discard the matched phase_id.
        if (gsdMode === 'full') {
          gsdPhaseId = resolverVerdict.phase_id;
        }
        break;
      case 'bootstrap':
        // Both modes bootstrap identically (user decision: same `/gsd-new-project` path).
        gsdBrief = buildBriefFromTask(task);
        break;
      case 'error':
        // Quick mode tolerates 'no-match' — `/gsd-quick` is meant for one-off
        // tasks not necessarily tied to a ROADMAP phase. roadmap-missing and
        // multi-match are still data-quality errors that fail closed.
        if (gsdMode === 'quick' && resolverVerdict.code === 'no-match') {
          // D-06: quick + no-match is tolerated, not silent. Emit info-level
          // gsd.phase.resolved {matched:false, code:'no-match', tolerated:true,
          // mode:'quick'} for forensic reconstruction by `kodo logs --session-of`.
          // Dispatcher remains the single source of gsd.phase.resolved (D-14
          // Phase 9 invariant preserved). Field name `code` (not `error_code`)
          // distinguishes this tolerated condition from the fail-closed warn
          // emit below which uses `error_code`.
          try {
            const { createLogger } = await import('../logger.js');
            const log = createLogger({
              sessionId: gsdSessionId || 'dispatch',
              minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
            }).child({ component: 'dispatcher', task_id: task.id });
            log.info(EVENTS.GSD_PHASE_RESOLVED, {
              event: EVENTS.GSD_PHASE_RESOLVED,
              matched: false,
              code: 'no-match',
              tolerated: true,
              mode: 'quick',
              task_ref: task.ref,
            });
          } catch {
            // silent — never block dispatch on logger failure (mirror existing
            // forensic warn pattern below)
          }
          break;
        }
        // D-13: fail-closed. Release lock, emit forensic event, return early.
        if (gsdSessionId && gsdProjectPath) {
          try { releaseGsdLockFn(gsdProjectPath, gsdSessionId); } catch {
            // silent — lock.js release is idempotent
          }
        }
        // D-14: emit gsd.phase.resolved with matched:false for forensic logging.
        try {
          const { createLogger } = await import('../logger.js');
          const log = createLogger({
            sessionId: gsdSessionId || 'dispatch',
            minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
          }).child({ component: 'dispatcher', task_id: task.id });
          log.warn(EVENTS.GSD_PHASE_RESOLVED, {
            event: EVENTS.GSD_PHASE_RESOLVED,
            matched: false,
            error_code: resolverVerdict.code,
            detail: resolverVerdict.detail,
            task_ref: task.ref,
            mode: gsdMode,  // D-07 schema homogeneity: warn fail-closed also distinguishes mode
          });
        } catch {
          // silent — never block the return on logger failure
        }
        console.log(`[kodo:dispatch] resolver_failed — ${task.ref}: ${resolverVerdict.code} — ${resolverFailureHint(resolverVerdict, { taskTitle: task.title, projectPath: gsdProjectPath, mode: gsdMode })}`);
        return {
          action: 'resolver_failed',
          code: resolverVerdict.code,
          detail: resolverVerdict.detail,
        };
    }
    // D-14: emit matched-true gsd.phase.resolved (phase branch) or gsd.bootstrap (bootstrap branch).
    try {
      const { createLogger } = await import('../logger.js');
      const log = createLogger({
        sessionId: gsdSessionId,
        minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
      }).child({ component: 'dispatcher', task_id: task.id });
      if (resolverVerdict.action === 'phase') {
        // D-05: mode in payload — emit phase_id + match_heading even in quick
        // mode (forensic: operator can see "resolver matched phase X but session
        // is phase-agnostic"). Session record itself drops phase_id when quick
        // (see the case 'phase' handler above).
        gsdPhaseResolved(log, {
          phase_id: resolverVerdict.phase_id,
          match_heading: resolverVerdict.match_heading,
          mode: gsdMode,  // 'full' | 'quick' — never null inside if(gsdMode && ...)
        });
      } else if (resolverVerdict.action === 'bootstrap') {
        // D-07: mode in payload — homogeneous schema for kodo logs filtering.
        // D-14 (Phase 9 invariant) + Phase 11 lift: emit via the typed helper
        // gsdBootstrap (closed taxonomy) instead of the literal log.info — the
        // helper already exists in src/logger-events.js and accepts brief_empty.
        gsdBootstrap(log, {
          project_path: gsdProjectPath,
          brief_empty: isBriefEmpty(task),
          mode: gsdMode,  // 'full' | 'quick'
        });
      }
    } catch {
      // silent — never crash dispatch on logger failure
    }
  }

  // 4. Session-already-active guard (checks persisted state)
  const active = listSessionsFn();
  const existing = active.find((s) => s.task_id === task.id);

  if (existing) {
    try {
      const workspaces = await listWorkspacesFn();
      if (workspaces.includes(existing.workspace_ref)) {
        return { action: 'already_active' };
      }
      // Workspace gone - clean up stale session
      removeSessionFn(task.id);
    } catch {
      removeSessionFn(task.id);
    }

    // KODO-72: el relanzamiento tras limpiar una sesión stale ES un lanzamiento — abre una
    // sesión nueva sobre el repo igual que el camino de abajo — así que merece el mismo aviso.
    noticeIntegrationPressure(task, dispatchProjectPath, deps);

    // Relaunch after stale cleanup
    inFlight.add(task.id);
    try {
      const launchOpts = {
        model: opts.model ?? kodoConfig.model,
        flags: [...(opts.flags || []), ...kodoConfig.flags],
        // Phase 18 CR-01 fix: thread `dispatchSessionId` (NOT `gsdSessionId`)
        // — for GSD: dispatchSessionId === gsdSessionId by construction
        // (línea 167). Para non-GSD: dispatchSessionId fue el UUID que pasó
        // por el collision-check (líneas 175-179). Si pasáramos gsdSessionId
        // aquí, sería `null` en non-GSD y launchWorkItem generaría un UUID
        // fresh sin validar colisión — rompería el contrato D-05.
        // Misma idiom que el path "Launch" (línea 377).
        ...(dispatchSessionId ? { sessionId: dispatchSessionId } : {}),
        // Phase 18 WR-01 fix: thread projectPath ya resuelto para evitar
        // double-resolution y cerrar la ventana de inconsistencia con el
        // path validado por collision-check.
        ...(dispatchProjectPath ? { projectPath: dispatchProjectPath } : {}),
        // Phase 9: thread phase_id (match) or brief (bootstrap) so Session
        // record persists them for the hook SessionStart to render.
        ...(gsdPhaseId ? { phase_id: gsdPhaseId } : {}),
        ...(gsdBrief ? { brief: gsdBrief } : {}),
      };
      const session = await launchWorkItemFn(event.taskRef, launchOpts);
      return { action: 'stale_relaunch', session };
    } catch (err) {
      // WR-01: if launch throws after the GSD lock was acquired, release it
      // so the repo does not stay locked until TTL. Phase 18 D-03 inverted
      // the ordering in launchWorkItem to `addSession → cmux.send`: si el
      // throw ocurre ANTES de addSession (provider/cmux.newWorkspace) no hay
      // SessionRecord y la sesión no arranca; si ocurre DESPUÉS de addSession
      // pero ANTES de cmux.send, queda un SessionRecord 'running' huérfano
      // (mismo modo que crashes post-spawn — el stop hook lo limpia en el
      // siguiente ciclo). En ambos casos, liberar el lock aquí es correcto.
      if (gsdSessionId && gsdProjectPath) {
        try { releaseGsdLockFn(gsdProjectPath, gsdSessionId); } catch {
          // silent — best effort, never mask the original error
        }
      }
      throw err;
    } finally {
      inFlight.delete(task.id);
    }
  }

  // 5. Launch
  //
  // Phase 70 (CONC-08/D-13): per-task_id cross-process dedup lock on the NON-GSD
  // lane. The in-process `inFlight` guard (step 3) only dedups within ONE process;
  // two processes (rapid webhook + poll) can both pass it and launch the same
  // non-GSD task twice. We mirror that guard cross-process with a per-task_id
  // file lock via the Plan-01 primitive: acquire BEFORE the launch, release in
  // the existing finally. `retries:0` makes a concurrent loser return null
  // IMMEDIATELY (never wait for the winner to finish, which would then launch a
  // duplicate) — the exact cross-process analog of the in-process early return.
  //
  // GSD lane is UNAFFECTED (WT-03 invariant): GSD tasks are already serialized by
  // acquireGsdLockFn on projectPath (step 3b); this lock is ONLY for `!gsdMode`.
  let dispatchLockPath = null;
  let dispatchLockToken = null;
  let stopDispatchHeartbeat = null;
  if (!gsdMode) {
    dispatchLockPath = join(dispatchLockDir, `dispatch-${task.id}.lock`);
    // WR-02: the dedup lock is held across `await launchWorkItemFn` (provider +
    // cmux round-trips) which can exceed the primitive's 10s default TTL. With a
    // 10s TTL a duplicate arriving mid-launch would see the lock as TTL-stale,
    // steal it, and DOUBLE-LAUNCH the same task_id.
    //
    // KODO-48: un TTL fijo —fuera 120s, ahora 300s— no es la respuesta completa,
    // porque la duración del launch NO está acotada por construcción: siempre
    // existe un launch más lento que el plazo que elijamos, y ahí el lock queda
    // stale con su dueño todavía trabajando. Por eso el TTL pasa a ser el suelo y
    // la defensa real es el heartbeat: mientras dure el launch renovamos
    // `acquired_at`, así que un duplicado que llegue a mitad NUNCA ve el lock
    // caducado y se va con `already_active` en vez de robarlo.
    // Keep `retries:0` so a real concurrent duplicate returns already_active now.
    const held = acquireLockFn(dispatchLockPath, { retries: 0, ttlMs: DISPATCH_LOCK_TTL_MS });
    if (!held) {
      console.log(`[kodo:dispatch] Ignored — ${task.ref} already dispatching (cross-process)`);
      return { action: 'already_active' };
    }
    dispatchLockToken = held.token;
    // El latido arranca AQUÍ, pegado al acquire, no dentro del `try`: cualquier
    // camino que salga de aquí en adelante pasa por el `finally` que lo para.
    stopDispatchHeartbeat = startLockHeartbeatFn(dispatchLockPath, held.token, {
      intervalMs: DISPATCH_LOCK_HEARTBEAT_MS,
      maxHoldMs: DISPATCH_LOCK_MAX_HOLD_MS,
    });
  }

  // KODO-72: el aviso va DESPUÉS del dedup lock y ANTES del launch. Después del lock porque un
  // perdedor cross-process se va por `already_active` sin lanzar nada, y avisar ahí sería ruido
  // sobre un lanzamiento que no ocurre. Antes del launch porque el aviso describe una decisión ya
  // tomada («esta tarea VA a este repo»), y así se emite aunque `launchWorkItemFn` acabe fallando.
  noticeIntegrationPressure(task, dispatchProjectPath, deps);

  inFlight.add(task.id);
  try {
    const launchOpts = {
      model: opts.model ?? kodoConfig.model,
      flags: [...(opts.flags || []), ...kodoConfig.flags],
      // Phase 18: thread dispatchSessionId (puede ser GSD generado pre-lock
      // o no-GSD generado en collision-check block arriba). launchWorkItem
      // consume vía `opts.sessionId || randomUUID()` — si está presente lo
      // usa verbatim. Garantiza que la UUID del worktree path == sessionId
      // del lock file (CR-01 + WT-01/WT-03 invariants).
      ...(dispatchSessionId ? { sessionId: dispatchSessionId } : {}),
      // Phase 18 WR-01 fix: thread projectPath ya resuelto para evitar
      // double-resolution y cerrar la ventana de inconsistencia con el
      // path validado por collision-check.
      ...(dispatchProjectPath ? { projectPath: dispatchProjectPath } : {}),
      // Phase 9: thread phase_id (match) or brief (bootstrap) so Session
      // record persists them for the hook SessionStart to render.
      ...(gsdPhaseId ? { phase_id: gsdPhaseId } : {}),
      ...(gsdBrief ? { brief: gsdBrief } : {}),
    };
    const session = await launchWorkItemFn(event.taskRef, launchOpts);
    return { action: 'launched', session };
  } catch (err) {
    // WR-01: if launch throws after the GSD lock was acquired, release it so
    // the repo does not stay locked until TTL. Phase 18 D-03 reordered
    // launchWorkItem to `addSession → cmux.send`: en el peor caso queda un
    // SessionRecord 'running' huérfano si cmux.send falla — el stop hook lo
    // limpia. El lock release sigue siendo idempotente y seguro aquí.
    if (gsdSessionId && gsdProjectPath) {
      try { releaseGsdLockFn(gsdProjectPath, gsdSessionId); } catch {
        // silent — best effort, never mask the original error
      }
    }
    throw err;
  } finally {
    inFlight.delete(task.id);
    // KODO-48: parar el latido ANTES de liberar. Al revés dejaría una ventana en la
    // que el heartbeat puede re-crear con `renameSync` el lock que acabamos de
    // borrar, y el lock resucitado ya no tendría a nadie que lo liberase: quedaría
    // hasta que venciera el TTL, bloqueando el siguiente dispatch legítimo.
    if (stopDispatchHeartbeat) {
      try { stopDispatchHeartbeat(); } catch {
        // silent — stop() es idempotente + never-throws en la primitiva
      }
    }
    // Phase 70 (D-13): release the per-task_id dedup lock (idempotent, never throws).
    if (dispatchLockToken) {
      try { releaseLockFn(dispatchLockPath, dispatchLockToken); } catch {
        // silent — release is ownership-checked + never-throws in the primitive
      }
    }
  }
}

/**
 * Logger del carril dispatch, memoizado por proceso (KODO-28).
 *
 * Sink: `~/.kodo/logs/dispatch.ndjson` — id sintético `dispatch`, el mismo que ya
 * usaban los emits de `gsd.phase.resolved` cuando aún no hay `gsdSessionId`
 * (`createLogger({ sessionId: gsdSessionId || 'dispatch' })` más abajo). El
 * veredicto del dispatcher se decide ANTES de que exista sesión — de hecho la
 * mayoría de veredictos son "no la crees" — así que colgarlo de un session_id
 * real no es posible.
 *
 * Import DINÁMICO obligatorio: `src/logger.js` es el módulo prohibido en el grafo
 * de `kodo check` (LOG-12, test/check-isolation.test.js), y este fichero cuelga de
 * `polling.js`, que a su vez está excluido de ese grafo precisamente por arrastrar
 * al dispatcher. Un import estático rompería la invariante.
 *
 * @type {any}
 */
let cachedDispatchLogger = null;

/**
 * @returns {Promise<any>} el logger del carril, o null si no se pudo construir.
 */
async function getDispatchLogger() {
  if (cachedDispatchLogger) return cachedDispatchLogger;
  try {
    const { createLogger } = await import('../logger.js');
    cachedDispatchLogger = createLogger({
      sessionId: 'dispatch',
      minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
    }).child({ component: 'dispatcher' });
    return cachedDispatchLogger;
  } catch {
    // never-throws: el audit es best-effort, jamás altera el veredicto.
    return null;
  }
}

/** Techo del `error` de `dispatch.error` — mismo contrato que pollingError. */
const DISPATCH_ERROR_MAX_CHARS = 200;

/**
 * Central dispatch function for all trigger sources — punto de entrada público.
 *
 * Envoltorio de auditoría sobre `dispatchTriggerImpl` (KODO-28). Se hace aquí, en
 * UN solo sitio, en vez de sembrar un emit en cada uno de los ~10 `return` de la
 * implementación: los returns ya son un discriminante cerrado (`action` + `code`
 * + `detail`), así que el wrapper tiene toda la información sin duplicar lógica, y
 * un `return` nuevo en el futuro queda auditado por construcción en lugar de
 * olvidarse.
 *
 * Contrato preservado byte a byte: mismo nombre, misma firma, mismo valor de
 * retorno, y los throws se RE-LANZAN intactos (el caller de webhook.js sigue
 * viendo su `err.message` para la pista accionable de KODO-10).
 *
 * @param {import('../interface.js').TriggerEvent} event
 * @param {{ model?: string|null, flags?: string[], force?: boolean }} [opts]
 * @param {DispatchDeps} [deps] - Injectable dependencies for testing
 * @returns {Promise<{ action: 'launched'|'ignored'|'already_active'|'stale_relaunch'|'cleaned'|'gsd_locked'|'resolver_failed'|'worktree_collision', session?: object, holder?: object, code?: string, detail?: string }>}
 */
export async function dispatchTrigger(event, opts = {}, deps = {}) {
  // `_logger: null` desactiva el audit (tests que no quieren tocar el disco).
  const log = deps._logger !== undefined ? deps._logger : await getDispatchLogger();
  try {
    const result = await dispatchTriggerImpl(event, opts, deps);
    if (log) {
      try {
        dispatchDecision(log, {
          provider: event.provider,
          task_ref: event.taskRef,
          action: result.action,
          code: result.code,
          detail: result.detail,
        });
      } catch {
        // never-throws — el audit no puede cambiar el veredicto.
      }
    }
    return result;
  } catch (err) {
    if (log) {
      try {
        dispatchError(log, {
          provider: event.provider,
          task_ref: event.taskRef,
          error: String(/** @type {any} */ (err)?.message ?? err).slice(0, DISPATCH_ERROR_MAX_CHARS),
        });
      } catch {
        // never-throws — jamás enmascarar el error original.
      }
    }
    throw err;
  }
}
