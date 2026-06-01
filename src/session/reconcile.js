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

/** Ventana de retención antes de sellar una `dead` a `closed` (D-07 step 4). */
const SEAL_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Ventana de rescate desde history (D-07 step 3): solo entries recientes. */
const RESCUE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Ticks consecutivos con el mismo target antes de aplicar la transición (R-2). */
const DEBOUNCE_TICKS = 2;

/**
 * @typedef {import('./state.js').Session} Session
 * @typedef {import('./state.js').State} State
 * @typedef {{ workspace_ref: string, alive: boolean, needs_input?: boolean, last_activity?: string|null }} LiveRef
 * @typedef {{ pending_state: string, tick_count: number }} DebounceEntry
 */

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
    const live = liveByRef.get(session.workspace_ref);
    const target = deriveTarget(session, live);

    // Sellado a closed (D-07 step 4): dead con dead_since > 30 días → history.
    if (session.state === 'dead' && session.dead_since) {
      const deadMs = Date.parse(session.dead_since);
      if (Number.isFinite(deadMs) && now - deadMs > SEAL_AFTER_MS) {
        history.unshift({ ...session, state: 'closed', ended_at: new Date(now).toISOString() });
        sealed++;
        debounceStore.delete(session.workspace_ref);
        continue; // no re-añadir a sessions (closed es terminal)
      }
    }

    if (target === session.state) {
      // Estable: limpia cualquier debounce pendiente y refresca tab_alive.
      debounceStore.delete(session.workspace_ref);
      sessions[taskId] = applyLiveFields(session, live, target, now);
      continue;
    }

    // Debouncing (R-2): N ticks consecutivos con el mismo target antes de aplicar.
    const prev = debounceStore.get(session.workspace_ref) ?? { pending_state: null, tick_count: 0 };
    const next = prev.pending_state === target
      ? { pending_state: target, tick_count: prev.tick_count + 1 }
      : { pending_state: target, tick_count: 1 };

    if (next.tick_count >= DEBOUNCE_TICKS) {
      // Aplica la transición.
      debounceStore.delete(session.workspace_ref);
      const transitioned_session = applyLiveFields({ ...session, state: target }, live, target, now);
      if (target === 'dead' && session.state !== 'dead') {
        transitioned_session.dead_since = new Date(now).toISOString();
      }
      sessions[taskId] = transitioned_session;
      transitioned++;
    } else {
      // Aún en debounce: conserva el estado actual, guarda el pending.
      debounceStore.set(session.workspace_ref, next);
      sessions[taskId] = applyLiveFields(session, live, session.state, now);
    }
  }

  // ── (2) Rescate desde history (D-07 step 3) — cierra ROMAN-151/152 ─────────
  // Una entry de history cuyo workspace_ref sigue vivo en el host se "revive":
  // vuelve a sessions con el estado derivado (idle/needs-input) y tab_alive:true.
  const keptHistory = [];
  for (const entry of history) {
    const live = liveByRef.get(entry.workspace_ref);
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
 * Ejecuta UN tick de reconciliación con I/O: consulta el host, reconcilia, y
 * persiste si cambió. never-throws (D-07). Separado de startReconcileLoop para
 * testear el tick sin timers. El caller del server lo usa vía el loop.
 *
 * @param {object} deps
 * @param {{ listWorkspaces: () => Promise<LiveRef[]> }} deps.host - WorkspaceHost (Plan 01).
 * @param {() => State} deps.loadState - lector de state (de state.js).
 * @param {(state: State) => void} deps.saveState - escritor de state (de state.js).
 * @param {Map<string, DebounceEntry>} deps.debounceStore
 * @param {number} deps.tick
 * @param {() => number} deps.now - clock inyectable.
 * @param {{ info?: Function, warn?: Function }} [deps.logger]
 * @returns {Promise<{ rescued: number, sealed: number, transitioned: number, total: number }>}
 */
export async function runReconcileTick({ host, loadState, saveState, debounceStore, tick, now, logger }) {
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

  const state = loadState();
  const { state: newState, events } = reconcileTick(state, liveRefs, { debounceStore, tick, now: now(), logger });
  logger?.info?.('host.reconcile.tick', events);
  if (newState !== state) saveState(newState);
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
