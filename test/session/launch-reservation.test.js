// @ts-check
//
// test/session/launch-reservation.test.js — KODO-55.
//
// La reserva de slot (`status: 'launching'`) es una entrada NUEVA en `state.sessions`
// que no existía antes de KODO-55, y que el reconciliador tiene que tratar distinto de
// una sesión de trabajo. Este fichero congela ese trato, en los dos sentidos:
//
//   (1) NO la mata. Una reserva no tiene `workspace_ref` todavía — todo el sentido de
//       reservar es sostener el slot MIENTRAS se monta el workspace. Sin la guarda, el
//       bucle normal leería la ausencia del ref como «tab desaparecida» y la degradaría
//       a `dead`/`alive:false` a los dos ticks (5 s): el slot volvería al pool en pleno
//       lanzamiento y el TOCTOU quedaría reabierto por la puerta de atrás.
//
//   (2) SÍ barre la huérfana. Si el proceso que lanzaba murió entre la reserva y el
//       `addSession` (kill -9, crash del daemon), nadie va a llamar al release nunca, y
//       una reserva inmortal es una fuga de capacidad permanente — la misma clase de
//       bug (A4) que `isSchedulable` cerró para los zombis.
//
// Y (3) la paridad de los dos literales que `reconcile.js` duplica a propósito
// (`'launching'` y el TTL): el reconciliador es PURO y no importa `state.js`, así que
// la única forma de que la duplicación no derive es un test que la mire.
//
// Sujetos puros/inyectables (`reconcileTick`, `isSchedulable`, `isStaleReservation`) →
// sin FS, sin HOME, sin procesos.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTick, LAUNCH_RESERVATION_TTL_MS as RECONCILE_TTL } from '../../src/session/reconcile.js';
import {
  isSchedulable,
  isStaleReservation,
  LAUNCHING_STATUS,
  LAUNCH_RESERVATION_TTL_MS as STATE_TTL,
} from '../../src/session/state.js';

const T0 = Date.parse('2026-08-28T19:00:00.000Z');

/** Una reserva de slot tal y como la escribe `reserveLaunchSlot`. */
function reservation(ref, startedAtMs) {
  return {
    workspace_ref: '',
    workspace_id: null,
    session_id: '',
    task_id: '',
    task_ref: ref,
    provider: 'test',
    project_id: '',
    summary: `Lanzando ${ref}…`,
    status: 'launching',
    started_at: new Date(startedAtMs).toISOString(),
    project_path: '',
  };
}

/** Sesión de trabajo viva con tab presente. */
function runningSession(id, ref) {
  return {
    workspace_ref: ref,
    session_id: 'sess-' + id,
    task_id: 'task-' + id,
    task_ref: 'KL-' + id,
    provider: 'test',
    project_id: 'p1',
    summary: 'sesión ' + id,
    status: 'running',
    state: 'running',
    process_alive: true,
    alive: true,
    started_at: new Date(T0).toISOString(),
    project_path: '/dev/kodo',
  };
}

describe('la reserva ocupa un slot (KODO-55)', () => {
  it('isSchedulable cuenta las reservas igual que las sesiones running', () => {
    assert.equal(isSchedulable(reservation('KL-1', T0)), true);
    assert.equal(isSchedulable(runningSession('a', 'workspace:1')), true);
  });

  it('isSchedulable sigue excluyendo lo que ya excluía', () => {
    assert.equal(isSchedulable({ status: 'review' }), false);
    assert.equal(isSchedulable({ status: 'done' }), false);
    // El zombi de CONC-03: running con la tab muerta NO retiene slot.
    assert.equal(isSchedulable({ status: 'running', alive: false }), false);
    // Y una reserva a la que alguien le pusiera alive:false tampoco (misma regla).
    assert.equal(isSchedulable({ status: 'launching', alive: false }), false);
  });

  it('isStaleReservation solo vence reservas, y una sin reloj legible vence ya', () => {
    assert.equal(isStaleReservation(reservation('KL-1', T0), T0 + 1000), false);
    assert.equal(isStaleReservation(reservation('KL-1', T0), T0 + STATE_TTL + 1), true);
    // Una sesión running NUNCA es una reserva vencida, por vieja que sea.
    assert.equal(isStaleReservation(runningSession('a', 'workspace:1'), T0 + STATE_TTL * 100), false);
    // Sin `started_at` legible no podría caducar nunca → se declara vencida.
    assert.equal(isStaleReservation({ status: 'launching', started_at: 'no-es-una-fecha' }, T0), true);
    assert.equal(isStaleReservation({ status: 'launching' }, T0), true);
  });
});

describe('reconcileTick y las reservas (KODO-55)', () => {
  it('NO degrada una reserva viva, ni siquiera pasado el debounce', () => {
    let state = {
      schema_version: 3,
      sessions: {
        'launching:abc': reservation('KL-42', T0),
        keep: runningSession('keep', 'workspace:1'),
      },
      history: [],
    };
    const debounceStore = new Map();
    // El snapshot del host NO contiene la reserva — no puede: su workspace todavía no
    // existe. Es exactamente la señal que el bucle normal leería como «tab muerta».
    const liveRefs = [{ workspace_ref: 'workspace:1', alive: true, title: null }];

    for (let tick = 1; tick <= 4; tick++) {
      ({ state } = reconcileTick(state, liveRefs, {
        debounceStore,
        tick,
        now: T0 + tick * 2500,
        logger: { warn() {} },
      }));
    }

    const held = state.sessions['launching:abc'];
    assert.ok(held, 'la reserva viva sigue en el state tras 4 ticks');
    assert.equal(held.status, LAUNCHING_STATUS, 'sigue siendo una reserva');
    assert.equal(held.alive, undefined, 'reconcile no le escribe `alive` (no la observa)');
    assert.equal(held.state, undefined, 'reconcile no le deriva un estado de ciclo de vida');
    assert.equal(
      Object.values(state.sessions).filter(isSchedulable).length,
      2,
      'la reserva sigue ocupando su slot mientras el lanzamiento está en vuelo',
    );
  });

  it('barre la reserva huérfana pasada la ventana y devuelve el slot', () => {
    const warns = [];
    let state = {
      schema_version: 3,
      sessions: {
        'launching:muerta': reservation('KL-42', T0),
        keep: runningSession('keep', 'workspace:1'),
      },
      history: [],
    };
    const liveRefs = [{ workspace_ref: 'workspace:1', alive: true, title: null }];

    const out = reconcileTick(state, liveRefs, {
      debounceStore: new Map(),
      tick: 1,
      now: T0 + RECONCILE_TTL + 1,
      logger: { warn: (evt, payload) => warns.push([evt, payload]) },
    });

    assert.equal(out.events.expired, 1, 'el tick reporta la reserva barrida');
    assert.equal(
      out.sessions?.['launching:muerta'] ?? out.state.sessions['launching:muerta'],
      undefined,
      'la reserva huérfana desaparece de sessions',
    );
    assert.ok(out.state.sessions.keep, 'la sesión de trabajo viva no se toca');
    // Ni a history: una reserva no es una sesión que existió, es un launch que nunca
    // llegó a serlo. La traza va al log.
    assert.deepEqual(out.state.history, [], 'una reserva vencida NO se archiva en history');
    assert.deepEqual(
      warns.map(([evt]) => evt),
      ['host.reconcile.reservation_expired'],
      `se emite la traza del barrido; got: ${JSON.stringify(warns)}`,
    );
    assert.equal(warns[0][1].task_ref, 'KL-42');

    // El slot está de vuelta.
    assert.equal(Object.values(out.state.sessions).filter(isSchedulable).length, 1);
  });

  it('un tick que solo barre reservas SÍ persiste (state distinto del entrante)', () => {
    // Si `expired` no contara como cambio, el caller se saltaría el `saveState` (la
    // optimización de no-write) y la huérfana volvería a aparecer en el tick siguiente,
    // para siempre.
    const state = {
      schema_version: 3,
      sessions: { 'launching:muerta': reservation('KL-42', T0) },
      history: [],
    };
    const out = reconcileTick(state, [], {
      debounceStore: new Map(),
      tick: 1,
      now: T0 + RECONCILE_TTL + 1,
      logger: { warn() {} },
    });
    assert.notEqual(out.state, state, 'el state resultante debe ser NUEVO para forzar el save');
    assert.deepEqual(Object.keys(out.state.sessions), []);
  });

  it('un tick sin cambios sigue devolviendo el state original (no-write preservado)', () => {
    const state = {
      schema_version: 3,
      sessions: { 'launching:viva': reservation('KL-42', T0) },
      history: [],
    };
    const out = reconcileTick(state, [], {
      debounceStore: new Map(),
      tick: 1,
      now: T0 + 1000,
      logger: { warn() {} },
    });
    assert.equal(out.state, state, 'una reserva viva no debe provocar escrituras cada 2,5 s');
    assert.equal(out.events.expired, 0);
  });
});

describe('paridad de los literales duplicados (KODO-55)', () => {
  it('reconcile.js y state.js comparten el mismo TTL de reserva', () => {
    assert.equal(
      RECONCILE_TTL,
      STATE_TTL,
      'reconcile.js duplica el TTL como literal local (es puro, no importa state.js): ' +
        'si uno de los dos cambia, el barrido y el gate dejan de estar de acuerdo',
    );
  });

  it('el status de la reserva es el mismo literal en ambos lados', () => {
    // Se comprueba por COMPORTAMIENTO, no leyendo la constante privada de reconcile.js:
    // una reserva construida con el `LAUNCHING_STATUS` de state.js tiene que ser la que
    // el barrido de reconcile reconoce.
    const out = reconcileTick(
      {
        schema_version: 3,
        sessions: { r: { ...reservation('KL-1', T0), status: LAUNCHING_STATUS } },
        history: [],
      },
      [],
      { debounceStore: new Map(), tick: 1, now: T0 + STATE_TTL + 1, logger: { warn() {} } },
    );
    assert.equal(out.events.expired, 1, 'el literal de state.js debe casar el de reconcile.js');
  });
});
