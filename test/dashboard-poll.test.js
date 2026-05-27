// @ts-check
//
// test/dashboard-poll.test.js — Phase 35 Plan 02 Wave 0 (TUI-05).
//
// Tests del scheduler de polling self-scheduling de `usePoll`. El loop se ejercita
// SIN un host React vía la función pura `runPollLoop` (el scheduler extraído que el
// hook envuelve dentro de useEffect — Discretion de Task 2 / RESEARCH Open Question 2):
// `ink-testing-library@4` NO expone `waitUntilExit()` y el node test runner carece de
// `mock.module`, así que la única vía hermética es la DI por parámetro.
//
// Ensambla dos patrones existentes (No Analog Found en 35-PATTERNS.md):
//   - DI de `fn` (fake async que resuelve `{ok}`) del estilo `makeFetch` de
//     test/providers/github/client.test.js:52-88
//   - fake clock/schedule del estilo DEFAULT_CLOCK de src/triggers/polling.js:96-100,
//     pero con un schedule que (a) registra cada `interval` recibido para las aserciones
//     de backoff y (b) permite disparar el callback manualmente (clock determinista, sin
//     timers reales — Pitfall 11).
//
// Verifica los 4 comportamientos de D-03/D-04/D-09:
//   - single-flight (maxInFlight === 1) — el siguiente tick NO se programa hasta resolver
//     el fn actual (await antes de re-armar)
//   - backoff sube [2500, 5000, 10000, 10000, …] (cap a 10000) ante fallos consecutivos
//   - backoff resetea a 2500 al primer ok
//   - teardown: el cleanup llama clearTimeout(timer) + ac.abort(); ningún onResult tras cancelled
//
// Estado Wave 0: ROJO hasta Task 2 (usePoll.js no existe → ERR_MODULE_NOT_FOUND).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runPollLoop } from '../src/cli/dashboard/usePoll.js';

/**
 * Fake clock con un `schedule` determinista para el RE-ARME del tick (NO usa timers reales):
 *   - `schedule(fn, interval)` registra `interval` en `intervals[]` (para las aserciones de
 *     backoff) y guarda el callback en `pending` con un handle incremental; devuelve el handle.
 *   - `cancel(handle)` registra el handle en `cancelled[]` (spy de clearTimeout) y lo descarta.
 *   - `flushTick()` dispara (y consume) el último callback de tick pendiente — avanza el loop.
 *
 * El timeout de abort de 5s (D-05) NO pasa por este fake: `runPollLoop` lo programa vía
 * `scheduleTimeout`/`cancelTimeout` (opciones separadas). El test inyecta un `scheduleTimeout`
 * no-op para que ese timer ni dispare ni mantenga el proceso vivo, dejando `intervals[]`
 * conteniendo SOLO los intervals de re-arme (backoff).
 */
function makeFakeClock() {
  /** @type {number[]} */
  const intervals = []; // intervals de re-arme del loop (backoff)
  /** @type {any[]} */
  const cancelled = []; // handles pasados a cancel() — spy de clearTimeout
  /** @type {Array<{ handle: number, fn: Function }>} */
  let pending = [];
  let nextHandle = 1;

  const schedule = (fn, interval) => {
    const handle = nextHandle++;
    intervals.push(interval);
    pending.push({ handle, fn });
    return handle;
  };

  const cancel = (handle) => {
    cancelled.push(handle);
    pending = pending.filter((p) => p.handle !== handle);
  };

  // El timeout de abort (5s) es un no-op en tests: devuelve un handle inerte. Esto evita
  // timers reales colgando y mantiene `intervals[]` limpio (solo re-armes del tick).
  let nextTimeoutHandle = 10000;
  const scheduleTimeout = () => nextTimeoutHandle++;
  const cancelTimeout = () => {};

  /**
   * Dispara (y consume) el último callback de tick pendiente. Retorna true si disparó algo.
   */
  const flushTick = async () => {
    const entry = pending.pop();
    if (!entry) return false;
    await entry.fn();
    return true;
  };

  return { schedule, cancel, scheduleTimeout, cancelTimeout, intervals, cancelled, flushTick, pending: () => pending };
}

/**
 * Fake `fn` que resuelve un patrón de resultados {ok}. Cuenta inFlight/maxInFlight
 * para el assert single-flight. `delay` opcional simula trabajo asíncrono lento
 * (resuelve en un microtask diferido controlado por el array `resolvers`).
 *
 * @param {Array<{ ok: boolean }>} results — secuencia de resultados a devolver por tick.
 */
function makeFn(results) {
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  /** @type {AbortSignal[]} */
  const signals = [];
  const fn = async (signal) => {
    signals.push(signal);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Cede el turno para que, si el loop re-armara ANTES de resolver, se solapara.
    await Promise.resolve();
    inFlight--;
    const idx = Math.min(calls, results.length - 1);
    calls++;
    return results[idx];
  };
  return {
    fn,
    get calls() {
      return calls;
    },
    get maxInFlight() {
      return maxInFlight;
    },
    signals,
  };
}

/**
 * Drena por completo la cola de microtasks pendientes. Un `setImmediate` se ejecuta DESPUÉS
 * de que todas las microtasks encoladas (incluidas las cadenas de promesas anidadas del
 * kick-off `Promise.resolve().then(tick)` y del `await fn()` interno) se hayan resuelto.
 * Más robusto que `await Promise.resolve()` contra cadenas de profundidad variable.
 */
function drain() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('usePoll scheduler: self-scheduling, single-flight, backoff, teardown (D-03/04/05/09, TUI-05)', () => {
  it('single-flight: maxInFlight === 1 a lo largo de varios ticks', async () => {
    const clock = makeFakeClock();
    const f = makeFn([{ ok: true }]);
    const results = [];

    const teardown = runPollLoop(f.fn, (r) => results.push(r), {
      schedule: clock.schedule,
      cancel: clock.cancel,
      scheduleTimeout: clock.scheduleTimeout,
      cancelTimeout: clock.cancelTimeout,
    });

    // El primer tick se lanza inmediatamente (microtask). Drenar el event loop.
    await drain();
    // Avanzar varios ticks manualmente.
    for (let i = 0; i < 4; i++) {
      await clock.flushTick();
      await drain();
    }

    assert.equal(f.maxInFlight, 1, 'nunca debe haber >1 request en vuelo (single-flight)');
    teardown();
  });

  it('backoff sube: intervals [2500, 5000, 10000, 10000] ante fallos consecutivos (cap 10000)', async () => {
    const clock = makeFakeClock();
    const f = makeFn([{ ok: false }]); // siempre falla
    const teardown = runPollLoop(f.fn, () => {}, {
      schedule: clock.schedule,
      cancel: clock.cancel,
      scheduleTimeout: clock.scheduleTimeout,
      cancelTimeout: clock.cancelTimeout,
    });

    await drain();
    // 3 ticks más → 4 re-armes en total.
    for (let i = 0; i < 3; i++) {
      await clock.flushTick();
      await drain();
    }

    assert.deepEqual(
      clock.intervals.slice(0, 4),
      [2500, 5000, 10000, 10000],
      'backoff debe duplicar con cap a 10000',
    );
    teardown();
  });

  it('backoff resetea: tras {ok:false}×2 luego {ok:true}, el siguiente interval vuelve a 2500', async () => {
    const clock = makeFakeClock();
    const f = makeFn([{ ok: false }, { ok: false }, { ok: true }, { ok: true }]);
    const teardown = runPollLoop(f.fn, () => {}, {
      schedule: clock.schedule,
      cancel: clock.cancel,
      scheduleTimeout: clock.scheduleTimeout,
      cancelTimeout: clock.cancelTimeout,
    });

    await drain();
    for (let i = 0; i < 3; i++) {
      await clock.flushTick();
      await drain();
    }

    // intervals: tick1 fail→2500, tick2 fail→5000, tick3 ok→reset 2500, tick4 ok→2500
    assert.deepEqual(
      clock.intervals.slice(0, 4),
      [2500, 5000, 2500, 2500],
      'al primer ok el interval debe resetear a 2500',
    );
    teardown();
  });

  it('teardown: el cleanup llama cancel(timer) y ac.abort(); ningún onResult tras cancelled', async () => {
    const clock = makeFakeClock();
    const f = makeFn([{ ok: true }]);
    const results = [];
    const teardown = runPollLoop(f.fn, (r) => results.push(r), {
      schedule: clock.schedule,
      cancel: clock.cancel,
      scheduleTimeout: clock.scheduleTimeout,
      cancelTimeout: clock.cancelTimeout,
    });

    await drain();
    await clock.flushTick();
    await drain();

    const resultsBeforeTeardown = results.length;
    teardown();

    // El cleanup debe haber cancelado al menos un handle (el timer del próximo tick).
    assert.ok(clock.cancelled.length >= 1, 'teardown debe llamar cancel() (clearTimeout) al menos una vez');

    // El AbortController del último tick debe estar abortado (D-05/D-09).
    const lastSignal = f.signals[f.signals.length - 1];
    assert.ok(lastSignal && lastSignal.aborted, 'teardown debe abortar el AbortSignal del controller activo');

    // Disparar cualquier pending residual tras cancelled NO debe producir más onResult.
    await clock.flushTick();
    await drain();
    assert.equal(results.length, resultsBeforeTeardown, 'ningún onResult debe invocarse tras el teardown (cancelled)');
  });
});
