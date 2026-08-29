// @ts-check
//
// src/session/reconcile.js — Phase 38 Plan 04 (TUI-20 / SC#4).
//
// Reconciliación host↔state: dada una snapshot de los workspaces vivos del host
// (`liveRefs`, ya consultada por el caller — esta función NO hace I/O), aplica
// las transiciones del ciclo de vida v3 (D-04) con debouncing 2-tick (R-2),
// rescata sesiones desde history cuya tab sigue viva (D-07 step 3 — cierra
// ROMAN-151/152) y sella a `closed` las dead viejas (D-07 step 4).
//
// PURA + never-throws (D-07): no abre sockets, no escribe disco, no lanza. El
// caller (el server kodo) consulta el host, invoca reconcileTick, y persiste el
// `state` resultante si cambió — su save participa del state lock compartido
// (Phase 70 Plan 02, withStateLock) junto con los otros escritores de state.json
// (hooks/CLI/dispatcher), NO es el único escritor. El logger se inyecta vía opts
// (LOG-12: este módulo NO importa logger.js).
//
// Modelo de estado (D-11): cada session tiene dimensiones independientes
// `state` / `process_alive` / `tab_alive` / `needs_input` / `last_seen_alive`.
// El target del tick se deriva de (tab viva?, proceso vivo?, needs_input?):
//   - !tab            → 'dead'
//   - tab + proceso   → 'running'
//   - tab + !proceso SOSTENIDO (KODO-15, ver abajo) → 'dead'
//   - tab + !proceso + needs_input → 'needs-input'
//   - tab + !proceso + !needs_input → 'idle'
//
// KODO-15 (sesión zombi): hasta esta fase el target salía SOLO de la vitalidad de
// la tab, así que un proceso claude muerto dentro de una tab que el operador deja
// abierta (kill, OOM, crash) se estancaba en `idle` para siempre: nunca se fijaba
// `dead_since` y el barrido de huérfanas (orphan-sweep.js, que consume ese campo)
// no la veía — la tarea se quedaba en «In Progress» sin sesión real detrás. El
// brazo nuevo cierra ese hueco con un reloj persistido, `process_dead_since`.
//
// LOG-12: NO importa logger.js (se inyecta). El único import es execFileSync,
// usado SOLO en isSessionProcessAlive (derivación de process_alive vía pgrep).

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

/** Ventana de retención antes de sellar una `dead` a `closed` (D-07 step 4). */
const SEAL_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * KODO-55: `status` de una RESERVA de slot de `max_parallel` (`reserveSessionSlot`,
 * state.js) y su TTL. Duplicados a propósito como literales locales: este módulo es
 * PURO y no importa `state.js` (recibe `loadState`/`saveState` inyectados, LOG-12), así
 * que importarlos metería `state.js` → `config.js` en el grafo del reconciliador. Son
 * los dos únicos átomos del contrato de la reserva que el barrido necesita; la fuente de
 * verdad es `state.js` (`LAUNCHING_STATUS`, `LAUNCH_RESERVATION_TTL_MS`), y
 * test/session/launch-reservation.test.js congela que ambos pares coinciden.
 */
const LAUNCHING_STATUS = 'launching';
export const LAUNCH_RESERVATION_TTL_MS = 5 * 60 * 1000;

/** Ventana de rescate desde history (D-07 step 3): solo entries recientes. */
const RESCUE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Ticks consecutivos con el mismo target antes de aplicar la transición (R-2). */
const DEBOUNCE_TICKS = 2;

/**
 * Cuánto tiempo debe llevar muerto el proceso claude, con la tab AÚN VIVA, antes de
 * dar la sesión por muerta (KODO-15). Espeja `ORPHAN_GRACE_MS` del sweep: un kill
 * tarda ~2 min en llegar a `dead` y otros ~2 min en producir el comentario.
 *
 * La ventana existe para absorber un `pgrep` que falla puntualmente (timeout de 3 s
 * bajo carga): el reloj se reinicia en cuanto el proceso vuelve a verse, y el
 * debouncing 2-tick actúa además ENCIMA de la ventana. Un tick suelto no mata nada.
 */
export const PROCESS_DEAD_GRACE_MS = 2 * 60 * 1000;

/**
 * @typedef {import('./state.js').Session} Session
 * @typedef {import('./state.js').State} State
 * @typedef {{ workspace_ref: string, alive: boolean, needs_input?: boolean, last_activity?: string|null, title?: string }} LiveRef
 * @typedef {{ pending_state: string, tick_count: number }} DebounceEntry
 */

/** @param {string} ch @returns {boolean} alfanumérico ASCII (sin RegExp — anti-ReDoS D-10). */
function isAlnum(ch) {
  return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

/**
 * ¿El título de un workspace host identifica a esta sesión? cmux RECICLA los índices
 * `workspace:N` al cerrar/crear tabs, así que la presencia de un ref en listWorkspaces NO
 * garantiza que siga siendo el workspace de la misma sesión. kodo fija el título con el
 * task_ref ("ROMAN-170 [FVF]: …"), así que casamos por token con límite de palabra para
 * evitar falsos positivos por prefijo (p. ej. "ROMAN-17" NO debe casar "ROMAN-170").
 * String ops puras — NUNCA RegExp sobre el título (host-controlado, anti-ReDoS D-10).
 * @param {string} [title]
 * @param {string} [taskRef]
 * @returns {boolean}
 */
export function titleIdentifiesSession(title, taskRef) {
  if (!title || !taskRef) return false;
  let from = 0;
  while (from <= title.length) {
    const i = title.indexOf(taskRef, from);
    if (i === -1) return false;
    const before = i === 0 ? '' : title[i - 1];
    const after = i + taskRef.length >= title.length ? '' : title[i + taskRef.length];
    if (!isAlnum(before) && !isAlnum(after)) return true;
    from = i + 1;
  }
  return false;
}

/**
 * Resuelve la entrada viva del host que corresponde a ESTA sesión, defendiéndose del
 * reciclado de `workspace_ref`. Si el host expone `title`, exige que identifique a la
 * sesión (si el ref fue reasignado a otro task, devuelve undefined → la sesión va a dead).
 * Si el host NO expone `title` (adapters legacy/no-op, fixtures antiguos), se mantiene el
 * comportamiento previo: presencia del ref = match.
 * @param {LiveRef|undefined} live
 * @param {Session} session
 * @returns {LiveRef|undefined}
 */
function liveForSession(live, session) {
  if (!live) return undefined;
  if (live.title == null) return live;
  return titleIdentifiesSession(live.title, session.task_ref) ? live : undefined;
}

/**
 * ¿El proceso claude de esta sesión lleva muerto MÁS que la ventana de gracia?
 * (KODO-15). PURA, never-throws.
 *
 * El reloj `process_dead_since` NO es «process_alive es false»: lo fija
 * `runReconcileTick` únicamente cuando OBSERVA la transición `true → false`, y lo
 * limpia cuando el proceso revive. Esa distinción es la guarda contra el falso
 * positivo estructural de la detección: `isSessionProcessAlive` casa
 * `pgrep -f "session-id <id>"`, y hay sesiones VIVAS que nunca casan ese patrón —
 * una reanudada (`claude --resume <uuid>`) o una adoptada por `adopt.js` no llevan
 * `--session-id` en su cmdline. Esas viven con `process_alive:false` permanente; sin
 * el reloj acabarían en `dead` con un comentario de cierre incompleto falso. Al
 * exigir una muerte OBSERVADA, solo barremos sesiones cuya detección demostró
 * funcionar al menos una vez.
 *
 * KODO-49: esa misma exigencia deja abierto el caso simétrico — una sesión que SÍ se
 * vio viva y después cambió de cmdline (`--resume` / adopt) sin morir. Ver el docblock
 * de `deriveTargetForeign`, donde el falso `dead` no tiene segunda señal que lo frene.
 *
 * @param {Session & { process_dead_since?: string|null }} session
 * @param {number} now - timestamp ms (inyectado).
 * @returns {boolean}
 */
export function isProcessDeadBeyondGrace(session, now) {
  if (!session || session.process_alive) return false;
  const deadMs = session.process_dead_since ? Date.parse(session.process_dead_since) : NaN;
  if (!Number.isFinite(deadMs)) return false;
  return now - deadMs >= PROCESS_DEAD_GRACE_MS;
}

/**
 * Deriva el estado objetivo de una session dada su presencia en el host (D-04).
 * @param {Session} session
 * @param {LiveRef|undefined} live
 * @param {number} now - timestamp ms (para la ventana de proceso muerto, KODO-15).
 * @returns {'running'|'idle'|'needs-input'|'dead'}
 */
function deriveTarget(session, live, now) {
  if (!live || !live.alive) return 'dead';
  if (session.process_alive) return 'running';
  // KODO-15: proceso muerto SOSTENIDO con la tab aún viva → zombi. Va ANTES de
  // needs_input a propósito: si el proceso ya no existe, la notificación pendiente
  // que el host expone es un residuo — no hay nadie que pueda recibir ese input.
  if (isProcessDeadBeyondGrace(session, now)) return 'dead';
  if (live.needs_input) return 'needs-input';
  return 'idle';
}

/**
 * Deriva el estado objetivo de una sesión que pertenece a OTRO host (KODO-18).
 *
 * La diferencia con `deriveTarget` es CUÁNTA evidencia hay, no cuánta se ignora. Para
 * una sesión de otro cliente kodo tiene DOS señales y solo una es ciega:
 *
 *   · la TAB es inobservable — su `workspace_ref` no puede aparecer en el snapshot de
 *     este host. Por eso se omite la primera línea de `deriveTarget`
 *     (`if (!live || !live.alive) return 'dead'`), que es la que corrompía sesiones
 *     sanas al leer la ausencia estructural como desaparición.
 *   · el PROCESO sí es observable: `process_alive` sale de un `pgrep` por session_id,
 *     que no sabe ni le importa en qué cliente vive la tab.
 *
 * Descartar también la señal del proceso —que es lo que hacía la primera versión de la
 * guarda, saltándose la sesión entera— dejaba dos fugas: una sesión congelada en
 * `running`/`alive:true` retenía su slot de `max_parallel` para siempre (la fuga de
 * capacidad A4 que `isSchedulable` cerró), y una ya `dead` nunca llegaba a sellarse a
 * `closed`, engordando `state.sessions` sin techo.
 *
 * Sin evidencia concluyente devuelve el estado ACTUAL, que en el caller significa
 * «estable» → ni transición ni escritura.
 *
 * ---------------------------------------------------------------------------
 * EDGE CASE CONOCIDO (KODO-49): falso `dead` por cmdline que dejó de casar
 * ---------------------------------------------------------------------------
 * La única señal de esta función — `process_alive` — no observa el proceso: observa
 * si su CMDLINE casa `pgrep -f "session-id <id>"`. Son cosas distintas, y se separan
 * cuando la cmdline cambia bajo un proceso que sigue vivo:
 *
 *   1. la sesión se lanzó con `--session-id <id>` → pgrep casa → `process_alive:true`;
 *   2. el agente se reanuda (`claude --resume <uuid>`) o lo re-adopta `adopt.js`. El
 *      proceso NUEVO no lleva `--session-id` en su cmdline;
 *   3. el siguiente tick ve `true → false`. Para `runReconcileTick` esa transición es
 *      una muerte OBSERVADA, así que arranca `process_dead_since`;
 *   4. pasados PROCESS_DEAD_GRACE_MS (2 min), `isProcessDeadBeyondGrace` devuelve true
 *      y esta función declara `dead` — una sesión que está viva y trabajando.
 *
 * El guard de `isProcessDeadBeyondGrace` NO cubre esto: protege a las sesiones que
 * NUNCA se vieron vivas (nacidas ya sin `--session-id`), exigiendo `process_alive ===
 * true` estricto antes de arrancar el reloj. Aquí la sesión SÍ estuvo viva, y esa
 * misma condición — la que cierra el otro agujero — es la que dispara este.
 *
 * Duele más en el camino EXTRANJERO que en `deriveTarget`: ahí la tab es una segunda
 * señal que puede contradecir al pgrep; aquí `process_alive` es la ÚNICA evidencia, y
 * un falso `dead` va directo a comentario de cierre + sellado a `closed`.
 *
 * VALORACIÓN de las salidas (ninguna implementada, KODO-49 solo documenta):
 *   · flag `cmdline_matchable` persistido en la sesión, consultado antes de arrancar
 *     el reloj. Cubre solo la mitad: alguien tiene que ponerlo a false al reanudar, y
 *     eso solo ocurre si el resume pasa por código de kodo (`adopt.js`). Un
 *     `claude --resume` que el operador lanza a mano deja el flag mintiendo en `true`,
 *     que es exactamente el caso que rompe hoy. Además añade un campo de state cuya
 *     verdad hay que mantener sincronizada con un proceso que no controlamos.
 *   · relajar el patrón a `pgrep -f "<uuid>"` (casaría también `--resume <uuid>`):
 *     más simple, pero introduce falsos POSITIVOS peores que el negativo actual — los
 *     worktrees de sesión llevan el uuid EN EL PATH (`.claude/worktrees/<uuid>/`), así
 *     que cualquier proceso lanzado ahí dentro casaría y mantendría viva para siempre
 *     una sesión muerta, reteniendo su slot de `max_parallel`.
 *   · señal independiente de la cmdline: mtime del transcript
 *     (`resolveTranscriptPath(project_path, session_id)`, ya existente en
 *     logger-events), que sobrevive al resume porque el fichero se indexa por
 *     session_id. Es la más robusta y la más cara — cambia la semántica de
 *     `process_alive` de «existe el proceso» a «hubo actividad reciente», con su propio
 *     umbral que calibrar. Candidata si el falso `dead` se observa en producción.
 *
 * Mitigación vigente: ninguna automática. La gracia de 2 min acota la ventana pero no
 * el desenlace. En la práctica un tick posterior NO lo corrige, porque la cmdline ya no
 * volverá a casar mientras dure ese proceso reanudado.
 *
 * @param {Session} session
 * @param {number} now - timestamp ms (inyectado).
 * @returns {'running'|'idle'|'needs-input'|'dead'}
 */
function deriveTargetForeign(session, now) {
  // Muerte del proceso SOSTENIDA: el agente ya no existe. Que la tab siga o no abierta
  // en el otro cliente es irrelevante — la sesión terminó, y declararlo es lo que
  // libera su slot y permite el sellado posterior. Es la ÚNICA afirmación que estos
  // datos sostienen.
  if (isProcessDeadBeyondGrace(session, now)) return 'dead';
  // Proceso vivo: sabemos que el agente EXISTE, no si está trabajando o esperando —
  // ese matiz lo da la tab, que es justo lo que no vemos. Devolver `'running'` aquí
  // sería inventarlo (y además relabelaría a running toda sesión `idle` del otro
  // cliente, con su escritura espuria). Conservar es lo honesto y lo barato: el caller
  // lo lee como «estable» → ni transición ni escritura.
  return session.state;
}

/**
 * Espejo de `applyLiveFields` para sesiones de otro host (KODO-18): actualiza SOLO lo
 * derivable y PRESERVA lo que no se puede observar.
 *
 * `applyLiveFields` escribiría `tab_alive:false` / `needs_input:false` a partir de un
 * `live` undefined — pero ese undefined aquí no significa «la tab no está», significa
 * «no puedo verla». Afirmar `false` sería inventar. `alive` sí se recalcula: es una
 * función pura del estado efectivo, no una observación del host.
 *
 * @param {Session} session
 * @param {'running'|'idle'|'needs-input'|'dead'} effectiveState
 * @returns {Session}
 */
function applyForeignFields(session, effectiveState) {
  return {
    ...session,
    alive: effectiveState === 'running' || effectiveState === 'idle' || effectiveState === 'needs-input',
  };
}

/**
 * Nombre del host activo, resuelto PEREZOSAMENTE (KODO-18). `require` en vez de import
 * estático para no romper el invariante de este módulo: nada de I/O ni de lectura de
 * config al CARGARLO (los tests lo importan puro). never-throws → `undefined` desactiva
 * la guarda por host, que es el comportamiento previo.
 *
 * @returns {string|undefined}
 */
function resolveActiveHostName() {
  try {
    return createRequire(import.meta.url)('../host/interface.js').resolveHostName();
  } catch {
    return undefined;
  }
}

/**
 * Aplica un tick de reconciliación. PURA: no muta `state` (clona lo que cambia)
 * ni hace I/O. never-throws.
 *
 * @param {State} state - el state actual (v3).
 * @param {LiveRef[]|null} liveRefs - snapshot del host; `null` si listWorkspaces falló.
 * @param {object} opts
 * @param {Map<string, DebounceEntry>} opts.debounceStore - estado del debouncing per workspace_ref (vive entre ticks).
 * @param {number} opts.tick - número de tick monotónico (para trazas).
 * @param {number} opts.now - timestamp ms (inyectado — NO Date.now() interno, testabilidad).
 * @param {{ warn: Function, info?: Function }} [opts.logger] - logger inyectado (LOG-12). Opcional.
 * @param {string} [opts.hostName] - KODO-18: nombre del host que produjo `liveRefs`. Cuando
 *   se pasa, las sesiones cuyo `host` PERSISTIDO no coincide se dejan INTACTAS (ver el
 *   guard dentro del bucle). Omitirlo mantiene el comportamiento previo (todas se evalúan).
 * @returns {{ state: State, events: { rescued: number, sealed: number, transitioned: number, total: number, foreign: number, expired: number } }}
 */
export function reconcileTick(state, liveRefs, { debounceStore, tick, now, logger, hostName }) {
  // F5 (D-07): host falló → skip tick, sin cambios. El caller ya emitió el
  // host.list_workspaces.fail; aquí solo dejamos traza del skip.
  if (liveRefs === null || liveRefs === undefined) {
    logger?.warn?.('host.reconcile.skip', { tick, reason: 'host-unavailable' });
    return { state, events: { rescued: 0, sealed: 0, transitioned: 0, total: 0 } };
  }

  const liveByRef = new Map(liveRefs.map((w) => [w.workspace_ref, w]));
  const total = Object.keys(state.sessions).length;
  let transitioned = 0;
  let rescued = 0;
  let sealed = 0;
  let foreign = 0; // KODO-18: sesiones de otro host, no observables desde este snapshot
  let expired = 0; // KODO-55: reservas de slot huérfanas barridas en este tick

  // Trabajamos sobre copias para preservar la pureza (no mutar el input).
  /** @type {Record<string, Session>} */
  const sessions = {};
  /** @type {Array<Session & { ended_at: string }>} */
  let history = Array.isArray(state.history) ? [...state.history] : [];

  // ── (1) Transiciones + sellado sobre las sessions activas ──────────────────
  for (const [taskId, session] of Object.entries(state.sessions)) {
    // ── KODO-55: reservas de slot (`status: 'launching'`) ───────────────────
    // Una reserva es la entrada que `reserveSessionSlot` escribe bajo el lock para
    // sostener el slot de `max_parallel` mientras el lanzamiento monta provider,
    // worktree y workspace. Todavía NO tiene `workspace_ref`, así que el bucle normal
    // la leería como «tab desaparecida» y la degradaría a `dead`/`alive:false` a los
    // dos ticks (5 s) — devolviendo el slot en pleno lanzamiento y reabriendo el
    // TOCTOU que la reserva cierra. Por eso se salta antes de derivar nada: la retira
    // el `finally` de `launchWorkItem`, no el reconciliador.
    //
    // El barrido por TTL es la contrapartida: si el proceso que lanzaba MURIÓ entre la
    // reserva y el `addSession` (kill -9, crash del daemon), nadie va a retirarla, y
    // una reserva inmortal es una fuga de capacidad permanente. Vencida → fuera de
    // `sessions` y fuera de `history`: una reserva no es una sesión que existió, es un
    // lanzamiento que nunca llegó a serlo. La traza va al log, no al historial.
    if (session && session.status === LAUNCHING_STATUS) {
      const startedMs = session.started_at ? Date.parse(session.started_at) : NaN;
      // Un `started_at` ilegible cuenta como vencido: sin reloj no puede caducar nunca.
      const stale = !Number.isFinite(startedMs) || now - startedMs > LAUNCH_RESERVATION_TTL_MS;
      if (stale) {
        // `task_ref` es la ref de la tarea (`KODO-42`), no contenido de usuario — mismo
        // criterio de D-11 que el resto de trazas de este carril.
        logger?.warn?.('host.reconcile.reservation_expired', {
          tick,
          key: taskId,
          task_ref: session.task_ref,
        });
        debounceStore.delete(taskId);
        expired++;
        continue; // no re-añadir a sessions: el slot vuelve al pool
      }
      sessions[taskId] = session; // reserva viva: intacta, sin derivación
      continue;
    }

    // ── KODO-18: guarda por HOST ────────────────────────────────────────────
    // Desde que `config.host` es conmutable, `state.sessions` puede contener sesiones
    // de un cliente que ya no es el activo. Su `workspace_ref` NUNCA aparece en este
    // snapshot —no puede—, así que sin la guarda el bucle leería esa ausencia
    // ESTRUCTURAL como «tab desaparecida» y degradaría a idle/dead sesiones
    // perfectamente vivas en el otro cliente (observado en el UAT de KODO-18 sobre
    // cuatro sesiones reales). Ausencia de evidencia no es evidencia de muerte: mismo
    // criterio que el `unverifiable` del gate del orquestador, y el reverso de
    // ROMAN-151/152.
    //
    // La guarda degrada la EVIDENCIA, no salta la sesión: la tab es inobservable, pero
    // el proceso sí lo es (`pgrep` por session_id no depende del cliente). Ver
    // `deriveTargetForeign` — saltarla entera fugaba slots de `max_parallel` y bloqueaba
    // el sellado a `closed`.
    //
    // Exige evidencia POSITIVA de discrepancia: ambos nombres presentes y distintos.
    // Una sesión legacy sin `host` (pre-KODO-18) o un caller sin `hostName` caen al
    // comportamiento previo — cero regresión.
    const isForeign = Boolean(hostName && session.host && session.host !== hostName);
    if (isForeign) foreign++;

    // Identidad-verificada: si el ref fue reciclado a otra sesión, `live` es undefined
    // → deriveTarget → 'dead' (cmux reusa workspace:N — ver liveForSession).
    const live = isForeign ? undefined : liveForSession(liveByRef.get(session.workspace_ref), session);
    const target = isForeign ? deriveTargetForeign(session, now) : deriveTarget(session, live, now);

    // Sellado a closed (D-07 step 4): dead con dead_since > 30 días → history.
    if (session.state === 'dead' && session.dead_since) {
      const deadMs = Date.parse(session.dead_since);
      if (Number.isFinite(deadMs) && now - deadMs > SEAL_AFTER_MS) {
        history.unshift({ ...session, state: 'closed', ended_at: new Date(now).toISOString() });
        sealed++;
        debounceStore.delete(taskId);
        continue; // no re-añadir a sessions (closed es terminal)
      }
    }

    if (target === session.state) {
      // Estable: limpia cualquier debounce pendiente. NOTA: NO refrescamos
      // tab_alive/last_seen_alive aquí — si lo hiciéramos, last_seen_alive
      // cambiaría cada tick (timestamp) y forzaría una escritura de state.json
      // cada 2.5s, matando la optimización de no-write. Esos campos son metadata
      // informativa (NO load-bearing: el target se deriva de `live` fresco, no
      // del tab_alive almacenado) y se refrescan al transicionar. La rama estable
      // conserva la session tal cual (mismo objeto) → el state final puede ser
      // referencialmente idéntico y saltarse la escritura.
      debounceStore.delete(taskId);
      sessions[taskId] = session;
      continue;
    }

    // Debouncing (R-2): N ticks consecutivos con el mismo target antes de aplicar.
    // Keyed por taskId (identidad ÚNICA de la sesión), NO por workspace_ref: cmux recicla
    // `workspace:N`, así que dos sesiones pueden compartir ref y, si el debounce se keyeara
    // por el ref, pelearían por la misma entrada reseteándose mutuamente → la transición a
    // dead de la fantasma nunca aplicaría (segundo síntoma del reciclado de refs).
    const prev = debounceStore.get(taskId) ?? { pending_state: null, tick_count: 0 };
    const next = prev.pending_state === target
      ? { pending_state: target, tick_count: prev.tick_count + 1 }
      : { pending_state: target, tick_count: 1 };

    if (next.tick_count >= DEBOUNCE_TICKS) {
      // Aplica la transición.
      debounceStore.delete(taskId);
      const transitioned_session = isForeign
        ? applyForeignFields({ ...session, state: target }, target)
        : applyLiveFields({ ...session, state: target }, live, target, now);
      if (target === 'dead' && session.state !== 'dead') {
        transitioned_session.dead_since = new Date(now).toISOString();
      }
      sessions[taskId] = transitioned_session;
      transitioned++;
    } else {
      // Aún en debounce: conserva el estado actual, guarda el pending.
      debounceStore.set(taskId, next);
      sessions[taskId] = isForeign
        ? applyForeignFields(session, session.state)
        : applyLiveFields(session, live, session.state, now);
    }
  }

  // ── (2) Rescate desde history (D-07 step 3) — cierra ROMAN-151/152 ─────────
  // Una entry de history cuyo workspace_ref sigue vivo en el host se "revive":
  // vuelve a sessions con el estado derivado (idle/needs-input) y tab_alive:true.
  const keptHistory = [];
  for (const entry of history) {
    // KODO-18: simetría con el carril (1). Una entry de OTRO host no puede ser
    // rescatada por este snapshot: su ref no está aquí, y si alguna vez lo estuviera
    // sería por colisión de formato entre clientes, nunca por identidad real. Hoy los
    // refs de cmux (`workspace:N`) y orca (`<repoId>::<path>`) no pueden colisionar, así
    // que esto es un cierre estructural, no un parche a un fallo observado.
    if (hostName && entry.host && entry.host !== hostName) {
      keptHistory.push(entry);
      continue;
    }
    // Mismo guard de identidad: NO revivir una entry porque su ref reciclado esté vivo
    // bajo OTRA sesión (evita resucitar la sesión equivocada).
    const live = liveForSession(liveByRef.get(entry.workspace_ref), entry);
    const endedMs = entry.ended_at ? Date.parse(entry.ended_at) : NaN;
    const recent = Number.isFinite(endedMs) && now - endedMs < RESCUE_WINDOW_MS;
    // No rescatar las que acabamos de sellar a closed en este mismo tick.
    if (live && live.alive && recent && entry.state !== 'closed') {
      const rescuedState = live.needs_input ? 'needs-input' : 'idle';
      const { ended_at, ...rest } = entry;
      sessions[entry.task_id] = {
        ...rest,
        state: rescuedState,
        process_alive: false,
        // KODO-15: el reloj de proceso muerto se reinicia al rescatar. Si la entry
        // arrastrase el `process_dead_since` con el que murió, la sesión revivida
        // volvería a `dead` en el tick siguiente — el rescate no puede regresar por
        // un reloj heredado. Vuelve a arrancar solo si se OBSERVA otra muerte.
        process_dead_since: null,
        tab_alive: true,
        needs_input: !!live.needs_input,
        last_seen_alive: new Date(now).toISOString(),
        alive: true,
      };
      rescued++;
    } else {
      keptHistory.push(entry);
    }
  }
  history = keptHistory;

  // NO emitir host.reconcile.tick aquí: este es el reconciliador PURO. La
  // telemetría del tick la emite el caller con I/O (runReconcileTick) — emitir
  // en ambos sitios duplicaba la línea en el log (cazado en UAT live 2026-06-01).

  // Si nada cambió, retornar el state original (referencialmente) para que el
  // caller pueda saltarse la escritura a disco. KODO-55: `expired` cuenta como cambio —
  // barrer una reserva huérfana sin persistirlo la dejaría en disco para siempre.
  if (transitioned === 0 && rescued === 0 && sealed === 0 && expired === 0) {
    return { state, events: { rescued, sealed, transitioned, total, foreign, expired } };
  }

  return {
    state: { ...state, sessions, history },
    events: { rescued, sealed, transitioned, total, foreign, expired },
  };
}

/**
 * Devuelve una copia de la session con los campos derivados del host refrescados.
 * No cambia `state` salvo que el caller ya lo haya fijado en la copia entrante.
 * @param {Session} session
 * @param {LiveRef|undefined} live
 * @param {string} effectiveState - el state que tendrá la session tras este tick.
 * @param {number} now
 * @returns {Session}
 */
function applyLiveFields(session, live, effectiveState, now) {
  const tabAlive = !!(live && live.alive);
  return {
    ...session,
    tab_alive: tabAlive,
    needs_input: !!(live && live.needs_input),
    last_seen_alive: tabAlive ? new Date(now).toISOString() : session.last_seen_alive ?? null,
    alive: effectiveState === 'running' || effectiveState === 'idle' || effectiveState === 'needs-input',
  };
}

/** Cadencia del loop de reconciliación (ms). Espeja BASE_MS del poll del dashboard. */
const RECONCILE_INTERVAL_MS = 2500;

/**
 * ¿Sigue vivo el proceso Claude de una sesión? (Phase 38 Plan 04 — cierra el gap
 * detectado en UAT live: `reconcileTick` leía `process_alive` pero nadie lo
 * derivaba en producción → la transición running→idle nunca disparaba.)
 *
 * El proceso Claude se lanza con `--session-id <session_id>` (ver
 * manager.js buildClaudeCommand), así que `pgrep -f "session-id <id>"` lo
 * localiza. fail-safe hacia MUERTO: si pgrep no encuentra match sale con código
 * 1 (execFileSync lanza) → tratamos como muerto. Marcar idle algo vivo por error
 * es seguro — el siguiente tick lo corrige cuando pgrep vuelva a encontrarlo
 * (debouncing 2-tick además amortigua un falso negativo puntual).
 *
 * @param {string} sessionId
 * @param {(sessionId: string) => string} [pgrep] - inyectable (tests). Default execFileSync pgrep.
 * @returns {boolean}
 */
export function isSessionProcessAlive(sessionId, pgrep) {
  const run = pgrep || ((sid) =>
    execFileSync('pgrep', ['-f', `session-id ${sid}`], { encoding: 'utf-8', timeout: 3000 }));
  try {
    const out = run(sessionId);
    return String(out || '').trim().length > 0;
  } catch {
    // pgrep exit 1 (sin match) u otro error → conservador: muerto.
    return false;
  }
}

/**
 * Ejecuta UN tick de reconciliación con I/O: consulta el host, reconcilia, y
 * persiste si cambió. never-throws (D-07). Separado de startReconcileLoop para
 * testear el tick sin timers. El caller del server lo usa vía el loop.
 *
 * Phase 70 Plan 02 (CONC-01, Pitfall 1): el save participa del MISMO state lock
 * que los mutators (withStateLock), PERO sin sostener el lock a través de la I/O
 * async del host. La snapshot del host (`listWorkspaces` + `pgrep`) se toma
 * FUERA del lock; la derivación pura + el save condicional se aplican DENTRO,
 * re-leyendo el state fresco para no pisar una escritura concurrente de un hook.
 * `reconcileTick` sigue siendo el ÚNICO escritor de `alive`.
 *
 * @param {object} deps
 * @param {{ listWorkspaces: () => Promise<LiveRef[]> }} deps.host - WorkspaceHost (Plan 01).
 * @param {() => State} deps.loadState - lector de state (de state.js).
 * @param {(state: State) => void} deps.saveState - escritor de state (de state.js).
 * @param {<T>(fn: () => T) => { ok: boolean, value?: T }} [deps.withStateLock] - lock-runner
 *   (state.js runUnderStateLock) que serializa el save con los mutators. Default:
 *   passthrough sin lock (los tests que inyectan loadState/saveState in-memory no
 *   tocan el FS; producción inyecta el lock real vía server.js).
 * @param {Map<string, DebounceEntry>} deps.debounceStore
 * @param {number} deps.tick
 * @param {() => number} deps.now - clock inyectable.
 * @param {{ info?: Function, warn?: Function }} [deps.logger]
 * @param {(sessionId: string) => string} [deps.pgrep] - inyectable (tests) para isSessionProcessAlive.
 * @returns {Promise<{ rescued: number, sealed: number, transitioned: number, total: number }>}
 */
export async function runReconcileTick({ host, loadState, saveState, withStateLock, debounceStore, tick, now, logger, pgrep, hostName: hostNameOpt }) {
  // KODO-18: nombre del host que produce el snapshot. Inyectable para los tests; por
  // defecto el activo. Lo consume la guarda por host de `reconcileTick`.
  const hostName = hostNameOpt ?? resolveActiveHostName();
  const started = now();
  /** @type {LiveRef[]|null} */
  let liveRefs = null;
  try {
    const raw = await host.listWorkspaces();
    // El contrato WorkspaceHost.listWorkspaces (Plan 01) retorna WorkspaceInfo[]
    // con {workspace_ref, alive, needs_input}. Es directamente liveRefs.
    liveRefs = Array.isArray(raw) ? raw : [];
    // LOG-hygiene: éxito rutinario emitido en CADA tick (~2.5s) → debug, no info.
    // A info inflaba reconcile.ndjson (cientos de MB). El fallo sigue en warn (abajo).
    logger?.debug?.('host.list_workspaces.ok', { count: liveRefs.length, duration_ms: now() - started });
  } catch (err) {
    logger?.warn?.('host.list_workspaces.fail', {
      code: /** @type {any} */ (err)?.code || 'UNKNOWN',
      detail: String(/** @type {any} */ (err)?.message || '').slice(0, 200),
      duration_ms: now() - started,
    });
    liveRefs = null; // → reconcileTick skipea el tick (F5)
  }

  // Pitfall 1 (NON-NEGOTIABLE): derivar process_alive vía pgrep es I/O del host
  // (execFileSync, hasta 3s por sesión). Se hace FUERA del lock — sostenerlo a
  // través de N pgrep serializaría el poll y podría exceder el TTL del lock,
  // provocando un steal. Snapshot keyed por session_id para re-aplicarlo al state
  // fresco leído DENTRO del lock.
  /** @type {Map<string, boolean>} */
  const aliveBySessionId = new Map();
  if (liveRefs !== null) {
    for (const s of Object.values(loadState().sessions)) {
      if (s.session_id && !aliveBySessionId.has(s.session_id)) {
        aliveBySessionId.set(s.session_id, isSessionProcessAlive(s.session_id, pgrep));
      }
    }
  }

  // Aplica la derivación pura + save condicional DENTRO del state lock, re-leyendo
  // el state FRESCO (anti-clobber D-02). SIN `await` dentro del callback — el
  // pgrep ya corrió arriba (Pitfall 1). Default passthrough para los tests que
  // inyectan loadState/saveState in-memory (no tocan el FS).
  const runLocked = withStateLock ?? /** @type {<T>(fn: () => T) => { ok: boolean, value: T }} */ ((fn) => ({ ok: true, value: fn() }));
  /** @type {{ rescued: number, sealed: number, transitioned: number, total: number, foreign: number, expired: number }} */
  // KODO-18: `foreign` cuenta las sesiones de otro cliente que este tick NO pudo
  // observar por tab. Va en la telemetría para que la degradación sea visible en
  // `host.reconcile.tick` en vez de silenciosa.
  let events = { rescued: 0, sealed: 0, transitioned: 0, total: 0, foreign: 0, expired: 0 };
  // LOG-hygiene: ¿el tick cambió algo (persistió)? Es el señalador de "acción real"
  // — más fiel que los contadores (la derivación idle persiste pero no incrementa
  // `transitioned`). Un tick sin cambios es el heartbeat idle que inflaba el NDJSON.
  let persisted = false;

  runLocked(() => {
    // Re-lectura FRESCA bajo el lock: si un hook escribió entre la snapshot del
    // host y ahora, lo vemos y NO lo pisamos.
    let state = loadState();

    // Phase 38 Plan 04 (gap fix): aplicar el process_alive derivado (snapshot de
    // arriba) al state fresco. reconcileTick es puro y solo LEE process_alive; sin
    // este refresh el campo se queda stale (siempre true) y la transición
    // running→idle nunca dispara — justo ROMAN-151/152. Una sesión añadida por un
    // writer concurrente que no estaba en la snapshot cae a su process_alive
    // almacenado (el siguiente tick la refresca). Solo clonamos si algo cambió
    // (preserva la optimización de no-write).
    if (liveRefs !== null) {
      let changed = false;
      const at = now();
      /** @type {Record<string, Session>} */
      const sessions = {};
      for (const [taskId, s] of Object.entries(state.sessions)) {
        const aliveNow = s.session_id && aliveBySessionId.has(s.session_id)
          ? /** @type {boolean} */ (aliveBySessionId.get(s.session_id))
          : !!s.process_alive;

        // KODO-15: reloj de proceso muerto. Arranca SOLO en la transición OBSERVADA
        // `true → false` (`s.process_alive === true` estricto, no falsy): una sesión
        // cuyo proceso NUNCA se detectó vivo — adoptada, o reanudada con `--resume`,
        // cuya cmdline no lleva `--session-id` y por tanto no casa el pgrep — tiene
        // un `process_alive:false` que es un falso negativo de la detección, no una
        // muerte, y no debe recibir reloj. Se limpia en cuanto el proceso reaparece.
        const prevDeadSince = /** @type {any} */ (s).process_dead_since ?? null;
        const deadSince = aliveNow ? null : (s.process_alive === true ? new Date(at).toISOString() : prevDeadSince);

        if (aliveNow !== s.process_alive || deadSince !== prevDeadSince) {
          sessions[taskId] = { ...s, process_alive: aliveNow, process_dead_since: deadSince };
          changed = true;
        } else {
          sessions[taskId] = s;
        }
      }
      if (changed) state = { ...state, sessions };
    }

    const { state: newState, events: ev } = reconcileTick(state, liveRefs, { debounceStore, tick, now: now(), logger, hostName });
    events = ev;
    // Save condicional DENTRO del lock: solo si algo cambió (no-write optimization).
    if (newState !== state) {
      persisted = true;
      saveState(newState);
    }
  });

  // LOG-hygiene: un tick que cambió estado va a info; el heartbeat idle (sin cambios)
  // baja a debug para no inflar reconcile.ndjson cada ~2.5s.
  if (persisted) {
    logger?.info?.('host.reconcile.tick', events);
  } else {
    logger?.debug?.('host.reconcile.tick', events);
  }
  return events;
}

/**
 * Arranca el loop periódico de reconciliación (D-07). Vive en el proceso server
 * (NO en el dashboard cliente, que es read-only). Su save se serializa con los
 * demás escritores de state.json vía el state lock compartido (Plan 02). Retorna
 * un teardown que detiene el loop.
 *
 * @param {object} deps
 * @param {{ listWorkspaces: () => Promise<LiveRef[]> }} deps.host
 * @param {() => State} deps.loadState
 * @param {(state: State) => void} deps.saveState
 * @param {<T>(fn: () => T) => { ok: boolean, value?: T }} [deps.withStateLock] - lock-runner
 *   (state.js runUnderStateLock) para serializar el save con los mutators (Plan 02).
 * @param {{ info?: Function, warn?: Function }} [deps.logger]
 * @param {number} [deps.intervalMs] - cadencia (default RECONCILE_INTERVAL_MS).
 * @param {(cb: () => void, ms: number) => any} [deps.setInterval] - inyectable (tests).
 * @param {(handle: any) => void} [deps.clearInterval] - inyectable (tests).
 * @param {() => number} [deps.now] - clock inyectable (default Date.now).
 * @returns {() => void} teardown
 */
export function startReconcileLoop(deps) {
  const debounceStore = new Map();
  // KODO-18: el host activo se resuelve UNA vez al arrancar el loop, no en cada tick.
  // `resolveActiveHostName()` acaba en `loadConfig()`, que lee y valida
  // ~/.kodo/config.json: hacerlo cada 2,5 s durante toda la vida del daemon sería I/O
  // de disco en el bucle caliente a cambio de nada. Cambiar `config.host` ya exige
  // reiniciar el daemon (como el resto del config), así que un valor por loop es tan
  // fresco como puede ser. Los callers directos de `runReconcileTick` (tests, CLI)
  // siguen resolviéndolo ellos.
  const hostName = deps.hostName ?? resolveActiveHostName();
  let tick = 0;
  let running = false; // single-flight: no solapar ticks si uno tarda > interval
  const intervalMs = deps.intervalMs ?? RECONCILE_INTERVAL_MS;
  const setIv = deps.setInterval ?? setInterval;
  const clearIv = deps.clearInterval ?? clearInterval;
  const now = deps.now ?? (() => Date.now());

  const handle = setIv(async () => {
    if (running) return; // skip si el tick previo sigue en vuelo (single-flight D-03)
    running = true;
    tick++;
    try {
      await runReconcileTick({
        host: deps.host,
        loadState: deps.loadState,
        saveState: deps.saveState,
        withStateLock: deps.withStateLock,
        debounceStore,
        tick,
        now,
        logger: deps.logger,
        hostName, // KODO-18: resuelto una vez arriba, fuera del bucle caliente
      });
    } catch (err) {
      // never-throws: un fallo del tick no debe tumbar el server.
      deps.logger?.warn?.('host.reconcile.error', { detail: String(/** @type {any} */ (err)?.message || '').slice(0, 200) });
    } finally {
      running = false;
    }
  }, intervalMs);

  // No mantener el proceso vivo solo por este timer (cierre limpio del server).
  if (handle && typeof handle.unref === 'function') handle.unref();

  return () => clearIv(handle);
}
