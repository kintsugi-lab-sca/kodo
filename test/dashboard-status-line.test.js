// @ts-check
//
// test/dashboard-status-line.test.js — Phase 35 Plan 03 Wave 0 (TUI-06).
//
// Renderiza el componente `App` del dashboard con ink-testing-library y verifica la
// STATUS LINE VIVA (D-01) + la resiliencia observable de TUI-06:
//   - keep-last-good (load-bearing): fetch succeed×2-then-throw → el contador NO se blanquea
//     (sigue mostrando "3 sessions") Y aparece "server caído"/"retrying" (estado stale, D-06).
//   - dos estados de degradación (D-06): fetch que falla desde el primer tick (sin dato bueno)
//     → "waiting for server" sin contador; fetch ok → "● live" + "N sessions".
//   - JSON corrupto = poll fallido (D-07): un `json()` que lanza colapsa al mismo path que
//     ECONNREFUSED (status line stale, keep-last-good) y NUNCA crashea el árbol ink (el frame
//     sigue existiendo).
//
// Harness hermético (RESEARCH Open Question 2): `fetchFn` y un clock/schedule fake se inyectan en
// `App` vía props (igual que `baseUrl` ya se inyecta en test/dashboard-render.test.js:40) — sin red
// ni timers reales. El harness ink@4 no expone un await-de-unmount, así que las aserciones usan
// `lastFrame()` tras avanzar el loop disparando manualmente los callbacks del fake schedule.
//
// Estado Wave 0: ROJO hasta que Task 2 modifique `App.js` para aceptar las props de inyección
// y renderizar la status line (hoy `App` ignora `fetchFn`/clock y renderiza `starting…`).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render, renderInk, waitForFrame } from './helpers/ink-frame.js';
import { createElement } from 'react';
import App, { UNAUTHORIZED_MESSAGE } from '../src/cli/dashboard/App.js';

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

/** Response-like mínimo con `ok`/`status`/`json()` (forma del fetch que consume client.js). */
function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe('TUI-06: status line viva — keep-last-good + dos estados + JSON corrupto (D-01/D-06/D-07/D-08)', () => {
  it('keep-last-good: succeed×2-then-throw conserva "3 sessions" Y muestra server caído/retrying', async () => {
    const clock = makeFakeClock();
    let calls = 0;
    // succeed×2 (count:3) luego throw (ECONNREFUSED) en cada tick posterior.
    const fetchFn = async () => {
      calls++;
      if (calls <= 2) return okResponse({ sessions: [{}, {}, {}], count: 3 });
      throw new Error('ECONNREFUSED');
    };

    const { lastFrame } = renderInk(createElement(App, injectProps(clock, fetchFn)));

    // Tick 1 (kick-off): ok → indicador "● live" (Phase 36: el contador `N sessions` del live
    // se reemplazó por contadores por estado; en este fixture las sesiones son objetos vacíos sin
    // status, así que el live no muestra contadores — basta con el indicador ● live).
    await waitForFrame(lastFrame, /● live/, `tras primer poll ok debe mostrar el indicador ● live`);

    // Tick 2: ok (count:3 de nuevo). Avanzar el reloj para que la edad sea > 0 al caer.
    clock.advance(8000);
    await clock.flushTick();

    // Tick 3: throw (ECONNREFUSED) → estado stale, keep-last-good.
    clock.advance(8000);
    await clock.flushTick();

    // estado stale: server caído / retrying.
    const frame = await waitForFrame(
      lastFrame,
      /server caído|retrying/,
      'debe mostrar el estado stale (server caído/retrying)',
    );
    // keep-last-good: el contador NO se blanquea.
    assert.match(frame, /3 sessions/, `keep-last-good: el contador 3 sessions NO debe blanquearse\n${frame}`);
  });

  it('waiting: fetch que falla desde el primer tick muestra "waiting for server" sin contador', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => {
      throw new Error('ECONNREFUSED');
    };

    const { lastFrame } = renderInk(createElement(App, injectProps(clock, fetchFn)));
    const frame = await waitForFrame(lastFrame, /waiting for server/, `sin dato bueno debe mostrar "waiting for server"`);
    assert.doesNotMatch(frame, /\d+ sessions/, `waiting NO debe mostrar un contador de sessions\n${frame}`);
  });

  it('live: fetch ok muestra "● live" y la tabla con las filas (Phase 36 reemplaza el contador del live)', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse({ sessions: [{}, {}, {}, {}, {}], count: 5 });

    const { lastFrame } = renderInk(createElement(App, injectProps(clock, fetchFn)));
    const frame = await waitForFrame(lastFrame, /● live/, `poll ok debe mostrar "● live"`);
    // Phase 36: el live ya no muestra `N sessions`; las sesiones se renderizan como filas de la
    // tabla. La cabecera de columnas confirma que la tabla (no la status line) está montada.
    assert.match(frame, /task_ref/, `poll ok debe montar la tabla (cabecera de columnas)\n${frame}`);
  });

  it('JSON corrupto = poll fallido: json() que lanza no crashea el render (frame sobrevive, estado stale)', async () => {
    const clock = makeFakeClock();
    let calls = 0;
    // Tick 1 ok (count:2). Ticks posteriores: json() lanza (JSON corrupto) → mismo path que ECONNREFUSED.
    const fetchFn = async () => {
      calls++;
      if (calls === 1) return okResponse({ sessions: [{}, {}], count: 2 });
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      };
    };

    const { lastFrame } = renderInk(createElement(App, injectProps(clock, fetchFn)));
    // Phase 36: el live muestra el indicador ● live (el contador `N sessions` se movió al estado
    // stale / a los contadores por estado). Confirma que el primer poll ok montó la tabla viva.
    await waitForFrame(lastFrame, /● live/, 'tras primer poll ok debe mostrar el indicador ● live');

    // Tick 2: json() lanza → client.js lo degrada a {ok:false} → estado stale, NUNCA crash.
    clock.advance(5000);
    await clock.flushTick();

    // keep-last-good + stale: conserva el contador y muestra el estado degradado.
    const frame = await waitForFrame(
      lastFrame,
      /2 sessions/,
      'keep-last-good tras JSON corrupto: conserva 2 sessions',
    );
    // El árbol ink sobrevive: lastFrame() sigue devolviendo un frame no vacío.
    assert.ok(frame && frame.length > 0, `el frame debe sobrevivir a un JSON corrupto (sin crash)\n${frame}`);
    assert.match(frame, /server caído|retrying/, `JSON corrupto = poll fallido → estado stale\n${frame}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 69 Plan 03 (NET-02, D-08): estado 401 "no autorizado". Un poll con
//   code:'unauthorized' (401 del carril autenticado) DEBE renderizar el literal
//   exportado UNAUTHORIZED_MESSAGE en amarillo, con precedencia sobre la
//   degradación genérica (waiting/server caído) y NUNCA un frame vacío (D-08).
//   Un poll OK posterior limpia el estado y vuelve a "● live".
// ─────────────────────────────────────────────────────────────────────────────

describe('NET-02 (D-08): estado 401 "no autorizado" — banner accionable, nunca frame vacío', () => {
  it('401 renderiza UNAUTHORIZED_MESSAGE con precedencia; un poll OK vuelve a ● live', async () => {
    const clock = makeFakeClock();
    let phase = 'unauth';
    // Primer(es) tick(s): 401 (ok:false, status:401 → fetchStatus yields code:'unauthorized').
    // Tras cambiar phase: 200 válido → el estado 401 se limpia.
    const fetchFn = async () => {
      if (phase === 'unauth') return { ok: false, status: 401, json: async () => ({}) };
      return okResponse({ sessions: [{}, {}], count: 2 });
    };

    const { lastFrame } = renderInk(createElement(App, injectProps(clock, fetchFn)));

    const frame = await waitForFrame(
      lastFrame,
      /no autorizado — revisa KODO_API_TOKEN/,
      'un 401 debe renderizar UNAUTHORIZED_MESSAGE',
    );
    // Nunca un blank screen en un 401 (D-08): el árbol renderiza y contiene el mensaje.
    assert.ok(frame && frame.length > 0, `el frame nunca queda vacío en un 401 (D-08)\n${frame}`);
    // Precedencia sobre la degradación genérica: NO cae a "waiting for server" pese a no tener
    // dato bueno previo (el 401 es una condición específica y accionable, no un drop transitorio).
    assert.doesNotMatch(frame, /waiting for server/, `el 401 gana a "waiting for server"\n${frame}`);
    // El literal renderizado ES la constante exportada (mata el drift code/render).
    assert.ok(frame.includes(UNAUTHORIZED_MESSAGE), `el frame contiene la constante exportada\n${frame}`);

    // Un poll OK limpia el estado 401 y vuelve a "● live".
    phase = 'ok';
    clock.advance(5000);
    await clock.flushTick();

    const frame2 = await waitForFrame(lastFrame, /● live/, 'un poll OK vuelve a ● live');
    assert.doesNotMatch(frame2, /no autorizado/, `el estado 401 se limpia tras un poll OK\n${frame2}`);
  });
});
