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
 * Fake clock con un `schedule` determinista. NO usa timers reales:
 *   - `schedule(fn, interval)` registra `interval` en `intervals[]` y guarda el callback
 *     en `pending` con un handle incremental; devuelve ese handle.
 *   - `flush()` dispara el último callback pendiente (avanza el loop un paso).
 *   - `cancel(handle)` registra el handle cancelado en `cancelled[]` (spy de clearTimeout).
 *   - `abortTimeout` es la rama del timeout de 5s (D-05): la registramos aparte para no
 *     confundirla con el re-arme del loop.
 *
 * El loop hace dos `schedule` por tick: (1) el timeout de abort (5000) y (2) el re-arme
 * del tick (interval de backoff). Distinguimos por el valor de `interval`: 5000 → abort.
 */
function makeFakeClock() {
  /** @type {number[]} */
  const intervals = []; // intervals de re-arme del loop (NO el abort de 5s)
  /** @type {number[]} */
  const abortIntervals = []; // intervals del timeout de abort (D-05)
  /** @type {any[]} */
  const cancelled = []; // handles pasados a cancel() — spy de clearTimeout
  /** @type {Array<{ handle: number, fn: Function, interval: number }>} */
  let pending = [];
  let nextHandle = 1;

  const schedule = (fn, interval) => {
    const handle = nextHandle++;
    if (interval === 5000) {
      abortIntervals.push(interval);
    } else {
      intervals.push(interval);
    }
    pending.push({ handle, fn, interval });
    return handle;
  };

  const cancel = (handle) => {
    cancelled.push(handle);
    pending = pending.filter((p) => p.handle !== handle);
  };

  /**
   * Dispara el último tick re-armado pendiente (interval !== 5000) y lo consume.
   * Retorna true si disparó algo.
   */
  const flushTick = async () => {
    // Buscar el último pending que NO sea el abort-timeout.
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].interval !== 5000) {
        const { fn } = pending[i];
        pending.splice(i, 1);
        await fn();
        return true;
      }
    }
    return false;
  };

  return { schedule, cancel, intervals, abortIntervals, cancelled, flushTick, pending: () => pending };
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

describe('usePoll scheduler: self-scheduling, single-flight, backoff, teardown (D-03/04/05/09, TUI-05)', () => {
  it('single-flight: maxInFlight === 1 a lo largo de varios ticks', async () => {
    const clock = makeFakeClock();
    const f = makeFn([{ ok: true }]);
    const results = [];

    const teardown = runPollLoop(f.fn, (r) => results.push(r), {
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    // El primer tick se lanza inmediatamente (microtask). Drenar microtasks.
    await Promise.resolve();
    await Promise.resolve();
    // Avanzar varios ticks manualmente.
    for (let i = 0; i < 4; i++) {
      await clock.flushTick();
      await Promise.resolve();
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
    });

    await Promise.resolve();
    await Promise.resolve();
    // 3 ticks más → 4 re-armes en total.
    for (let i = 0; i < 3; i++) {
      await clock.flushTick();
      await Promise.resolve();
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
    });

    await Promise.resolve();
    await Promise.resolve();
    for (let i = 0; i < 3; i++) {
      await clock.flushTick();
      await Promise.resolve();
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
    });

    await Promise.resolve();
    await Promise.resolve();
    await clock.flushTick();
    await Promise.resolve();

    const resultsBeforeTeardown = results.length;
    teardown();

    // El cleanup debe haber cancelado al menos un handle (el timer del próximo tick).
    assert.ok(clock.cancelled.length >= 1, 'teardown debe llamar cancel() (clearTimeout) al menos una vez');

    // El AbortController del último tick debe estar abortado (D-05/D-09).
    const lastSignal = f.signals[f.signals.length - 1];
    assert.ok(lastSignal && lastSignal.aborted, 'teardown debe abortar el AbortSignal del controller activo');

    // Disparar cualquier pending residual tras cancelled NO debe producir más onResult.
    await clock.flushTick();
    await Promise.resolve();
    assert.equal(results.length, resultsBeforeTeardown, 'ningún onResult debe invocarse tras el teardown (cancelled)');
  });
});
