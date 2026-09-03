// @ts-check
//
// src/cli/dashboard/usePoll.js — Phase 35 Plan 02 (TUI-05).
//
// Capa de scheduling (timing puro) del dashboard, desacoplada del render. Es la versión
// React/ink del loop self-scheduling YA en producción (`startPolling` en
// src/triggers/polling.js:478-575): recursive `setTimeout`, cancel flag, NUNCA `setInterval`
// (Anti-Pattern 3). Consume el `fn` que `App` (Plan 03) envuelve sobre `fetchStatus` (Plan 01,
// contrato { ok:true, data } | { ok:false, error }).
//
// Decisiones implementadas:
//   - D-03 single-flight: el `await savedFn(signal)` ocurre ANTES de re-armar el timer →
//     ≤1 request en vuelo. El siguiente tick se programa SOLO tras resolver el actual
//     (cf. polling.js:552-554, re-arma al final del tick).
//   - D-04 backoff por fallos CONSECUTIVOS: el interval del próximo tick es
//     min(baseMs * 2^failCount, maxMs) ante fallo (failCount cuenta fallos seguidos) y baseMs
//     al ok (reset de failCount a 0). Con baseMs=2500, maxMs=10000 → el PRIMER fallo programa
//     2500 (2^0), el segundo 5000, el tercero 10000, cap a 10000 → secuencia
//     [2500, 5000, 10000, 10000, …]; un ok resetea a 2500. (Equivale al doblado-con-cap
//     `min(prev*2, max)` pero anclado a base*2^k para que el PRIMER reintento use base, no
//     base*2 — la secuencia que la spec D-04 exige literalmente.)
//   - D-05 timeout: AbortController re-creado cada tick + schedule(() => ac.abort(), 5000).
//     El handle del controller vive en el loop para abortar on-unmount.
//   - D-09 teardown (Pitfall 9): cleanup = cancelled flag + cancel(timer) + ac?.abort().
//
// KODO-78 — refresco inmediato (`kick`). El dismiss de una fila dead necesita cerrar su ciclo
// visual: el DELETE ya cambió el estado server-side, pero la tabla seguía pintando la fila hasta
// el siguiente tick (hasta 2,5 s, o hasta 10 s si el backoff estaba abierto). `kick()` cancela el
// re-arme pendiente, aborta el request en vuelo y dispara un tick YA. Se expone por `opts.kickRef`
// (aditivo: sin ese ref el loop se comporta exactamente igual que antes).
//
// El kick OBLIGA a un tick-id guard, que el teardown por sí solo no daba: al abortar el request en
// vuelo, ese tick reanuda tras el `await` con un `{ok:false}` de abort y —sin guard— reportaría una
// desconexión falsa Y re-armaría su propio timer, dejando DOS loops corriendo. Por eso cada tick
// captura la generación vigente (`myGen`) y se retira en silencio si `kick()` la superó.
//
// Discretion (RESEARCH Open Question 2): el *timing* del backoff (el interval actual) vive
// aquí; el keep-last-good + connection display state vive en App (Plan 03). El loop solo
// reporta cada `{ok}` vía `onResult`.
//
// Arquitectura testeable: el scheduler vive en la función PURA `runPollLoop` (clock/schedule/
// cancel inyectables), que el hook `usePoll` envuelve dentro de `useEffect` (su retorno es el
// cleanup). El node test runner carece de `mock.module` y `ink-testing-library@4` no expone
// `waitUntilExit()`, así que `runPollLoop` permite ejercitar el loop sin host React, drivando
// el clock manualmente (test/dashboard-poll.test.js).
//
// Color-isolation (invariante D-12): este módulo NO importa `picocolors` ni el helper de color
// del CLI clásico. El color del dashboard sale solo de los <Text> de ink. El walker de
// test/format-isolation.test.js lo cubre automáticamente.

import { useEffect, useRef } from 'react';

/** Base backoff en ms (D-04). Intervalo nominal del poll cuando todo va bien. */
const BASE_MS = 2500;

/** Cap del backoff en ms (D-04). El interval nunca supera este valor. */
const MAX_MS = 10000;

/** Timeout por tick en ms antes de abortar el request en vuelo (D-05). */
const TICK_TIMEOUT_MS = 5000;

/**
 * @typedef {{ ok: boolean }} PollResult — el discriminante {ok} que `fn` resuelve (de client.js).
 */

/**
 * Opciones de inyección del scheduler. `schedule`/`cancel` por defecto delegan a los timers
 * globales (forma del `Clock` de src/triggers/polling.js:96-100). En tests se inyecta un fake
 * determinista que captura intervals y dispara callbacks manualmente.
 *
 * El re-arme del tick (`schedule`/`cancel`) está separado del timeout de abort de 5s
 * (`scheduleTimeout`/`cancelTimeout`) para que un fake clock pueda capturar SOLO los intervals
 * de re-arme (backoff) sin confundirlos con el timeout fijo de 5s — ambos por defecto delegan
 * a los timers globales.
 *
 * @typedef {object} PollOpts
 * @property {(fn: () => void, ms: number) => any} [schedule] — re-arme del tick (backoff). Default `setTimeout`.
 * @property {(handle: any) => void} [cancel] — cancela el timer del tick. Default `clearTimeout`.
 * @property {(fn: () => void, ms: number) => any} [scheduleTimeout] — timeout de abort (5s, D-05). Default `setTimeout`.
 * @property {(handle: any) => void} [cancelTimeout] — cancela el timeout de abort. Default `clearTimeout`.
 * @property {number} [baseMs] — override del intervalo base (default 2500).
 * @property {number} [maxMs] — override del cap del backoff (default 10000).
 * @property {{ current: (() => void) | null }} [kickRef] — KODO-78: ref donde el loop PUBLICA su
 *   `kick()` (refresco inmediato) mientras vive; el teardown lo devuelve a `null`. Omitirlo deja
 *   el loop idéntico al de antes.
 */

/**
 * Arranca el loop de polling self-scheduling y devuelve un teardown idempotente.
 *
 * El loop es la versión pura del tick de `startPolling`: cada `tick` (1) chequea el cancel
 * flag, (2) crea un `AbortController` nuevo + un timeout de 5s que lo aborta (D-05),
 * (3) `await savedFn(signal)` (single-flight, D-03), (4) cancela el timeout, (5) re-chequea
 * cancelled, (6) reporta el resultado vía `onResult`, (7) recalcula el backoff (D-04) y
 * (8) re-arma el timer con `schedule(tick, interval)` — SOLO ahora (cf. polling.js:552-554).
 *
 * El teardown setea `cancelled = true`, cancela el timer pendiente y aborta el controller
 * activo (D-09, Pitfall 9): ni timer huérfano ni fetch zombi tras unmount.
 *
 * @param {(signal: AbortSignal) => Promise<PollResult>} fn — el trabajo del tick (envuelve fetchStatus).
 * @param {(result: PollResult) => void} onResult — callback con cada resultado {ok}.
 * @param {PollOpts} [opts]
 * @returns {() => void} teardown — limpia timer + aborta controller (idempotente).
 */
export function runPollLoop(fn, onResult, opts = {}) {
  const schedule = opts.schedule || ((cb, ms) => setTimeout(cb, ms));
  const cancel = opts.cancel || ((handle) => clearTimeout(handle));
  // El timeout de abort (5s) es independiente del re-arme del tick: por defecto usa los timers
  // reales directamente (NO `schedule`), de modo que un fake `schedule` solo capture re-armes.
  const scheduleTimeout = opts.scheduleTimeout || ((cb, ms) => setTimeout(cb, ms));
  const cancelTimeout = opts.cancelTimeout || ((handle) => clearTimeout(handle));
  const baseMs = opts.baseMs ?? BASE_MS;
  const maxMs = opts.maxMs ?? MAX_MS;

  let cancelled = false;
  /** @type {any} */
  let timer = null;
  // Contador de fallos CONSECUTIVOS (D-04). El interval del próximo tick es
  // `min(baseMs * 2^failCount, maxMs)` ante fallo y `baseMs` (failCount=0) al ok →
  // secuencia [2500, 5000, 10000, 10000, …] con reset a 2500 al primer ok.
  let failCount = 0;
  /** @type {AbortController | null} */
  let ac = null;
  // KODO-78: generación del tick VIGENTE. Cada `kick()` la incrementa; un tick cuya generación
  // quedó atrás no reporta ni re-arma (ver el bloque de cabecera).
  let gen = 0;

  async function tick() {
    if (cancelled) return; // cf. polling.js:495 `if (stopped) return;`
    // KODO-78: la generación con la que ARRANCA este tick. Si un kick la supera durante el await,
    // este tick es historia y se retira sin tocar nada.
    const myGen = gen;

    // (D-05) AbortController re-creado cada tick + timeout de 5s que lo aborta.
    ac = new AbortController();
    const localAc = ac;
    const to = scheduleTimeout(() => localAc.abort(), TICK_TIMEOUT_MS);

    let result;
    try {
      // (D-03) el await ANTES de re-armar = single-flight (≤1 request en vuelo).
      result = await fn(localAc.signal);
    } finally {
      cancelTimeout(to);
    }

    // No reportar ni re-armar si se desmontó (D-09) o si un `kick()` superó a este tick (KODO-78):
    // en el segundo caso el `result` es el abort que el propio kick provocó, no una desconexión.
    if (cancelled || myGen !== gen) return;

    onResult(result);

    // (D-04) backoff por fallos consecutivos: el PRIMER fallo programa `baseMs`
    // (failCount=0 → 2^0=1), el segundo `baseMs*2`, etc., con cap a `maxMs`. Un ok
    // resetea `failCount` a 0 → el próximo interval vuelve a `baseMs`.
    let interval;
    if (result.ok) {
      failCount = 0;
      interval = baseMs;
    } else {
      interval = Math.min(baseMs * 2 ** failCount, maxMs);
      failCount++;
    }

    // re-arma SOLO ahora, recursivamente (cf. polling.js:552-554) — jamás un interval fijo.
    timer = schedule(tick, interval);
  }

  /**
   * KODO-78: refresco INMEDIATO. Invalida el tick vigente (gen++), cancela el re-arme pendiente,
   * aborta el request en vuelo y dispara un tick ya — por la MISMA microtask que el arranque, así
   * que sigue siendo un único tick en vuelo (D-03 intacto).
   *
   * `failCount` NO se toca: si el server está caído, un kick manual no debe borrar el backoff que
   * los fallos consecutivos ya ganaron.
   */
  function kick() {
    if (cancelled) return;
    gen++;
    if (timer) {
      cancel(timer);
      timer = null;
    }
    ac?.abort();
    Promise.resolve().then(tick);
  }

  // Publica el kick para el caller que lo pidió (App.js lo usa tras el DELETE del dismiss).
  if (opts.kickRef) opts.kickRef.current = kick;

  // Kick-off inmediato vía microtask (no real timer), igual que polling.js:557-559.
  Promise.resolve().then(tick);

  return () => {
    cancelled = true;
    if (timer) cancel(timer);
    ac?.abort();
    // El ref sobrevive al loop (vive en App); dejar el kick de un loop muerto sería una función
    // no-op colgada. Se limpia para que el consumidor vea honestamente que no hay loop.
    if (opts.kickRef) opts.kickRef.current = null;
  };
}

/**
 * Hook React que arranca `runPollLoop` dentro de un `useEffect` y limpia en el cleanup.
 *
 * `fn` y `onResult` se guardan en `useRef` para no re-armar el efecto en cada render: el
 * efecto depende solo de `deps`, pero el `tick` siempre invoca la versión más reciente de
 * `fn`/`onResult` vía la ref. El cleanup es el teardown que devuelve `runPollLoop` (D-09).
 *
 * KODO-78: `opts.kickRef` viaja tal cual al loop, que publica ahí su `kick()` mientras vive — el
 * consumidor (App.js) llama `kickRef.current?.()` para forzar un refresco inmediato.
 *
 * @param {(signal: AbortSignal) => Promise<PollResult>} fn — el trabajo del tick.
 * @param {(result: PollResult) => void} onResult — callback con cada resultado {ok}.
 * @param {any[]} [deps] — deps del efecto (re-arranca el loop cuando cambian, p. ej. baseUrl).
 * @param {PollOpts} [opts]
 */
export function usePoll(fn, onResult, deps = [], opts = {}) {
  const savedFn = useRef(fn);
  const savedOn = useRef(onResult);
  savedFn.current = fn;
  savedOn.current = onResult;

  useEffect(() => {
    const teardown = runPollLoop(
      (signal) => savedFn.current(signal),
      (result) => savedOn.current(result),
      opts,
    );
    return teardown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
