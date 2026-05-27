// @ts-check
//
// test/dashboard-table.test.js — Phase 36 Plan 02 Wave 0 (TUI-07/09/10/11).
//
// Renderiza el componente `App` del dashboard con ink-testing-library y verifica la TABLA VIVA
// columnar que reemplaza la status line de Phase 35:
//   - columnas (TUI-07): task_ref · repo (derivado D-03) · phase/mode · status · age, con el
//     placeholder `—` para una sesión non-GSD.
//   - marca zombie (TUI-10/D-09): `running (zombie)` para la sesión running+!alive.
//   - contadores del header (TUI-11/D-11): el zombie se cuenta APARTE de running; indicador
//     `● live` (reusado de Phase 35) tras un poll ok.
//   - orden estable DESC (TUI-09): la sesión con `started_at` más reciente renderiza ARRIBA.
//   - estados vacíos (TUI-11/D-12): poll ok con 0 sesiones → `no active sessions`; un fetch que
//     falla desde el primer tick mantiene `waiting for server` (precedencia degradada, D-12).
//   - selección inicial (D-07): la primera fila (la más reciente) muestra el gutter `› `.
//
// Harness hermético reusado VERBATIM de test/dashboard-status-line.test.js: `makeFakeClock` /
// `injectProps` / `drain` / `okResponse`. Sin red ni timers reales (Pitfall 11). ink@4 NO expone
// `waitUntilExit()`, así que las aserciones usan `lastFrame()` tras drenar microtasks / disparar
// el fake schedule.
//
// Estado Wave 0: ROJO hasta que Task 2 modifique `App.js` para renderizar la tabla — hoy `App`
// renderiza la status line de Phase 35 (sin columnas, sin gutter, sin contadores por estado).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App from '../src/cli/dashboard/App.js';

/**
 * Fake clock con un `schedule` determinista para el RE-ARME del tick del loop de polling que
 * vive dentro de `usePoll` (NO usa timers reales — Pitfall 11):
 *   - `schedule(fn, ms)` guarda el callback de tick en `pending` con un handle incremental.
 *   - `cancel(handle)` lo descarta.
 *   - `flushTick()` dispara (y consume) el último callback de tick pendiente — avanza el loop.
 *
 * El timeout de abort de 5s (D-05) se inyecta como `scheduleTimeout` no-op: ni dispara ni cuelga
 * el proceso. `now()` es un reloj controlable (para la edad determinista de D-08).
 */
function makeFakeClock(startMs = 1_000_000) {
  /** @type {Array<{ handle: number, fn: Function }>} */
  let pending = [];
  let nextHandle = 1;
  let nowMs = startMs;

  const schedule = (fn) => {
    const handle = nextHandle++;
    pending.push({ handle, fn });
    return handle;
  };
  const cancel = (handle) => {
    pending = pending.filter((p) => p.handle !== handle);
  };
  // Timeout de abort (5s): no-op inerte para no colgar timers reales ni abortar en tests.
  let nextTimeoutHandle = 10000;
  const scheduleTimeout = () => nextTimeoutHandle++;
  const cancelTimeout = () => {};

  const flushTick = async () => {
    const entry = pending.pop();
    if (!entry) return false;
    await entry.fn();
    return true;
  };

  return {
    schedule,
    cancel,
    scheduleTimeout,
    cancelTimeout,
    flushTick,
    now: () => nowMs,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

/**
 * Construye las props de inyección que `App` propaga a `usePoll`/`fetchStatus`, más el reloj
 * `now` para la edad. El clock fake se reusa para `schedule`/`cancel`/`scheduleTimeout`/`now`.
 */
function injectProps(clock, fetchFn) {
  return {
    baseUrl: 'http://localhost:9090',
    fetchFn,
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    scheduleTimeout: clock.scheduleTimeout,
    cancelTimeout: clock.cancelTimeout,
  };
}

/**
 * Drena por completo la cola de microtasks pendientes (cadenas del kick-off `Promise.resolve()
 * .then(tick)` + `await fn()` + los setState/re-render que ink agenda). Más robusto que
 * `await Promise.resolve()` contra cadenas de profundidad variable.
 */
function drain() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Response-like mínimo con `ok`/`status`/`json()` (forma del fetch que consume client.js). */
function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

// Fixture D-03 (PATTERNS.md líneas 300-303): dos sesiones — una GSD running+alive (KL-1, kodo,
// 36/full, 5m) y una non-GSD zombie running+!alive (KL-2, /x/foo→'foo', sin phase/mode, 1h3m).
// KL-1 tiene el started_at más reciente (10:00 > 09:00) → debe renderizar ARRIBA (DESC, TUI-09).
const FIXTURE = {
  count: 2,
  sessions: [
    {
      task_id: 'a',
      task_ref: 'KL-1',
      status: 'running',
      alive: true,
      started_at: '2026-05-27T10:00:00Z',
      project_name: 'kodo',
      elapsed_min: 5,
      phase_id: '36',
      gsd_mode: 'full',
      summary: '',
    },
    {
      task_id: 'b',
      task_ref: 'KL-2',
      status: 'running',
      alive: false,
      started_at: '2026-05-27T09:00:00Z',
      project_path: '/x/foo',
      elapsed_min: 63,
      summary: '',
    }, // zombie, non-GSD
  ],
};

describe('TUI-07/09/10/11: tabla viva — columnas, orden DESC, zombie, contadores, vacíos (D-01/D-03/D-07/D-09/D-11/D-12)', () => {
  it('columnas (TUI-07): renderiza task_ref · repo · phase/mode · status · age con — para non-GSD', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    assert.match(frame, /KL-1/, `debe mostrar task_ref KL-1\n${frame}`);
    assert.match(frame, /kodo/, `debe mostrar el repo derivado 'kodo' (project_name)\n${frame}`);
    assert.match(frame, /36\/full/, `debe mostrar phase/mode 36/full\n${frame}`);
    assert.match(frame, /5m/, `debe mostrar age 5m\n${frame}`);
    assert.match(frame, /KL-2/, `debe mostrar task_ref KL-2\n${frame}`);
    assert.match(frame, /foo/, `debe mostrar el repo derivado 'foo' (basename de /x/foo)\n${frame}`);
    assert.match(frame, /1h3m/, `debe mostrar age 1h3m (elapsed_min 63)\n${frame}`);
    assert.match(frame, /—/, `debe mostrar el placeholder — para la sesión non-GSD\n${frame}`);
  });

  it('zombie (TUI-10/D-09): el running+!alive muestra la marca textual "running (zombie)"', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    assert.match(frame, /running \(zombie\)/, `el zombie (running+!alive) debe mostrar "running (zombie)"\n${frame}`);
  });

  it('contadores del header (TUI-11/D-11): zombie contado aparte de running + indicador ● live', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    // El fixture tiene 1 running+alive y 1 zombie → "1 running · 1 zombie" (zombie aparte).
    assert.match(frame, /1 running/, `el header debe contar 1 running (zombie aparte)\n${frame}`);
    assert.match(frame, /1 zombie/, `el header debe contar 1 zombie por separado\n${frame}`);
    // Indicador live reusado de Phase 35 tras un poll ok.
    assert.match(frame, /● live/, `tras poll ok debe mostrar el indicador ● live (reusado Phase 35)\n${frame}`);
  });

  it('orden DESC (TUI-09): la sesión más reciente (KL-1 @10:00) renderiza ARRIBA de KL-2 @09:00', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    const idx1 = frame.indexOf('KL-1');
    const idx2 = frame.indexOf('KL-2');
    assert.ok(idx1 !== -1 && idx2 !== -1, `ambas filas deben estar presentes\n${frame}`);
    assert.ok(
      idx1 < idx2,
      `KL-1 (más reciente) debe renderizar ANTES que KL-2 (DESC por started_at)\n${frame}`,
    );
  });

  it('selección inicial (D-07): la primera fila (KL-1, la más reciente) muestra el gutter "› "', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    assert.match(
      frame,
      /›\s+KL-1/,
      `la fila inicialmente seleccionada (KL-1 newest) debe llevar el gutter "› "\n${frame}`,
    );
  });

  it('empty (TUI-11/D-12a): poll ok con 0 sesiones muestra "no active sessions" (no "no sessions match")', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse({ count: 0, sessions: [] });

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    assert.match(frame, /no active sessions/, `poll ok + 0 sesiones debe mostrar "no active sessions"\n${frame}`);
    assert.doesNotMatch(
      frame,
      /no sessions match/,
      `con 0 sesiones reales NO debe mostrar "no sessions match" (eso es filtro sin match)\n${frame}`,
    );
  });

  it('precedencia degradada (D-12): un fetch que falla desde el primer tick mantiene "waiting for server" sin "no active sessions"', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => {
      throw new Error('ECONNREFUSED');
    };

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    assert.match(frame, /waiting for server/, `sin dato bueno debe mostrar "waiting for server"\n${frame}`);
    assert.doesNotMatch(
      frame,
      /no active sessions/,
      `el estado degradado (waiting) tiene precedencia sobre el vacío de la lista\n${frame}`,
    );
  });
});
