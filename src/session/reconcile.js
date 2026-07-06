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
// caller (el server kodo — único escritor de state.json) consulta el host,
// invoca reconcileTick, y persiste el `state` resultante si cambió. El logger
// se inyecta vía opts (LOG-12: este módulo NO importa logger.js).
//
// Modelo de estado (D-11): cada session tiene dimensiones independientes
// `state` / `process_alive` / `tab_alive` / `needs_input` / `last_seen_alive`.
// El target del tick se deriva de (tab viva?, proceso vivo?, needs_input?):
//   - !tab            → 'dead'
//   - tab + proceso   → 'running'
//   - tab + !proceso + needs_input → 'needs-input'
//   - tab + !proceso + !needs_input → 'idle'
//
// LOG-12: NO importa logger.js (se inyecta). El único import es execFileSync,
// usado SOLO en isSessionProcessAlive (derivación de process_alive vía pgrep).

import { execFileSync } from 'node:child_process';

/** Ventana de retención antes de sellar una `dead` a `closed` (D-07 step 4). */
const SEAL_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Ventana de rescate desde history (D-07 step 3): solo entries recientes. */
const RESCUE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Ticks consecutivos con el mismo target antes de aplicar la transición (R-2). */
const DEBOUNCE_TICKS = 2;

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
 * Deriva el estado objetivo de una session dada su presencia en el host (D-04).
 * @param {Session} session
 * @param {LiveRef|undefined} live
 * @returns {'running'|'idle'|'needs-input'|'dead'}
 */
function deriveTarget(session, live) {
  if (!live || !live.alive) return 'dead';
  if (session.process_alive) return 'running';
  if (live.needs_input) return 'needs-input';
  return 'idle';
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
 * @returns {{ state: State, events: { rescued: number, sealed: number, transitioned: number, total: number } }}
 */
export function reconcileTick(state, liveRefs, { debounceStore, tick, now, logger }) {
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

  // Trabajamos sobre copias para preservar la pureza (no mutar el input).
  /** @type {Record<string, Session>} */
  const sessions = {};
  /** @type {Array<Session & { ended_at: string }>} */
  let history = Array.isArray(state.history) ? [...state.history] : [];

  // ── (1) Transiciones + sellado sobre las sessions activas ──────────────────
  for (const [taskId, session] of Object.entries(state.sessions)) {
    // Identidad-verificada: si el ref fue reciclado a otra sesión, `live` es undefined
    // → deriveTarget → 'dead' (cmux reusa workspace:N — ver liveForSession).
    const live = liveForSession(liveByRef.get(session.workspace_ref), session);
    const target = deriveTarget(session, live);

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
      const transitioned_session = applyLiveFields({ ...session, state: target }, live, target, now);
      if (target === 'dead' && session.state !== 'dead') {
        transitioned_session.dead_since = new Date(now).toISOString();
      }
      sessions[taskId] = transitioned_session;
      transitioned++;
    } else {
      // Aún en debounce: conserva el estado actual, guarda el pending.
      debounceStore.set(taskId, next);
      sessions[taskId] = applyLiveFields(session, live, session.state, now);
    }
  }

  // ── (2) Rescate desde history (D-07 step 3) — cierra ROMAN-151/152 ─────────
  // Una entry de history cuyo workspace_ref sigue vivo en el host se "revive":
  // vuelve a sessions con el estado derivado (idle/needs-input) y tab_alive:true.
  const keptHistory = [];
  for (const entry of history) {
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
  // caller pueda saltarse la escritura a disco.
  if (transitioned === 0 && rescued === 0 && sealed === 0) {
    return { state, events: { rescued, sealed, transitioned, total } };
  }

  return {
    state: { ...state, sessions, history },
    events: { rescued, sealed, transitioned, total },
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
export async function runReconcileTick({ host, loadState, saveState, withStateLock, debounceStore, tick, now, logger, pgrep }) {
  const started = now();
  /** @type {LiveRef[]|null} */
  let liveRefs = null;
  try {
    const raw = await host.listWorkspaces();
    // El contrato WorkspaceHost.listWorkspaces (Plan 01) retorna WorkspaceInfo[]
    // con {workspace_ref, alive, needs_input}. Es directamente liveRefs.
    liveRefs = Array.isArray(raw) ? raw : [];
    logger?.info?.('host.list_workspaces.ok', { count: liveRefs.length, duration_ms: now() - started });
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
  /** @type {{ rescued: number, sealed: number, transitioned: number, total: number }} */
  let events = { rescued: 0, sealed: 0, transitioned: 0, total: 0 };

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
      /** @type {Record<string, Session>} */
      const sessions = {};
      for (const [taskId, s] of Object.entries(state.sessions)) {
        const aliveNow = s.session_id && aliveBySessionId.has(s.session_id)
          ? /** @type {boolean} */ (aliveBySessionId.get(s.session_id))
          : !!s.process_alive;
        if (aliveNow !== s.process_alive) {
          sessions[taskId] = { ...s, process_alive: aliveNow };
          changed = true;
        } else {
          sessions[taskId] = s;
        }
      }
      if (changed) state = { ...state, sessions };
    }

    const { state: newState, events: ev } = reconcileTick(state, liveRefs, { debounceStore, tick, now: now(), logger });
    events = ev;
    // Save condicional DENTRO del lock: solo si algo cambió (no-write optimization).
    if (newState !== state) saveState(newState);
  });

  logger?.info?.('host.reconcile.tick', events);
  return events;
}

/**
 * Arranca el loop periódico de reconciliación (D-07). Vive en el proceso server
 * (único escritor de state.json — NO en el dashboard cliente). Retorna un
 * teardown que detiene el loop.
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
