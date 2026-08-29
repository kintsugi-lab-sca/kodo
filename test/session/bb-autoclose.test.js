// @ts-check
//
// test/session/bb-autoclose.test.js — KODO-31.
//
// El carril de AUTOCIERRE. Existe porque BB rompe una premisa que cmux y orca cumplían:
// allí el proceso `claude` muere cuando el humano cierra la tab, y esa muerte dispara
// `SessionEnd` → cleanup, handoff, backstop a «In Review», nudge al orquestador. En BB no:
// al terminar el turno el thread queda `idle` y el proceso SIGUE VIVO, así que sin un
// `bb thread stop` explícito la tarea se queda para siempre en «In Progress».
//
// Dos niveles de prueba:
//   (1) `selectAutoCloseTargets` — la decisión PURA. Cada condición tiene su test, y las
//       negativas (pending, dentro de gracia, otro host) importan más que la positiva:
//       un cierre indebido mata el runtime de un agente que estaba esperando respuesta.
//   (2) `runReconcileTick` — el cableado: que el gate sea por CAPACIDAD (`typeof close`),
//       que cmux/orca no ejecuten nada, y que un fallo de BB no tumbe el tick.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectAutoCloseTargets, runReconcileTick, DEFAULT_IDLE_CLOSE_GRACE_MS } from '../../src/session/reconcile.js';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');
const GRACE_MS = 90 * 1000;

/** Sesión BB asentada en idle desde hace `idleMs`. */
function bbSession(overrides = {}, idleMs = 5 * 60 * 1000) {
  return {
    workspace_ref: 'thr_alpha',
    session_id: 'sess-real-de-bb',
    task_id: 't1',
    task_ref: 'KODO-31',
    provider: 'plane',
    project_id: 'p1',
    summary: 'host bb',
    status: 'idle',
    started_at: '2026-08-29T11:00:00.000Z',
    project_path: '/dev/kodo',
    host: 'bb',
    state: 'idle',
    process_alive: true,
    tab_alive: true,
    needs_input: false,
    last_seen_alive: new Date(NOW - idleMs).toISOString(),
    ...overrides,
  };
}

const stateWith = (sessions) => ({ sessions, history: [] });

describe('selectAutoCloseTargets — la decisión pura (KODO-31)', () => {
  it('CIERRA: sesión bb, idle, sin interacción pendiente y pasada la gracia', () => {
    const out = selectAutoCloseTargets(stateWith({ t1: bbSession() }), {
      now: NOW,
      graceMs: GRACE_MS,
      hostName: 'bb',
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].taskId, 't1');
    assert.equal(out[0].ref, 'thr_alpha');
    assert.equal(out[0].taskRef, 'KODO-31');
    assert.equal(out[0].idleMs, 5 * 60 * 1000);
  });

  it('NO CIERRA con interacción pendiente, por muy larga que sea la espera', () => {
    // La condición cuya violación causa el daño peor: parar el runtime mientras el agente
    // espera una respuesta pierde la pregunta que le hizo al humano.
    const out = selectAutoCloseTargets(
      stateWith({ t1: bbSession({ needs_input: true }, 60 * 60 * 1000) }),
      { now: NOW, graceMs: GRACE_MS, hostName: 'bb' },
    );
    assert.deepEqual(out, []);
  });

  it('NO CIERRA dentro de la gracia (el agente puede estar pensando entre herramientas)', () => {
    const out = selectAutoCloseTargets(stateWith({ t1: bbSession({}, 89 * 1000) }), {
      now: NOW,
      graceMs: GRACE_MS,
      hostName: 'bb',
    });
    assert.deepEqual(out, []);
  });

  it('la gracia es inclusiva: exactamente el umbral SÍ cierra', () => {
    const out = selectAutoCloseTargets(stateWith({ t1: bbSession({}, GRACE_MS) }), {
      now: NOW,
      graceMs: GRACE_MS,
      hostName: 'bb',
    });
    assert.equal(out.length, 1);
  });

  it('NO CIERRA una sesión que no está idle (running / needs-input / dead)', () => {
    for (const state of ['running', 'needs-input', 'dead', 'closed']) {
      const out = selectAutoCloseTargets(stateWith({ t1: bbSession({ state }) }), {
        now: NOW,
        graceMs: GRACE_MS,
        hostName: 'bb',
      });
      assert.deepEqual(out, [], `state=${state} no debe cerrarse`);
    }
  });

  it('NO CIERRA sesiones de OTRO host aunque cumplan todo lo demás', () => {
    // Con `config.host` conmutable, state.sessions puede tener sesiones de cmux y orca.
    // Pararlas sería, además de inútil, un `bb thread stop` sobre un ref que no es suyo.
    for (const host of ['cmux', 'orca', undefined]) {
      const out = selectAutoCloseTargets(stateWith({ t1: bbSession({ host }) }), {
        now: NOW,
        graceMs: GRACE_MS,
        hostName: 'bb',
      });
      assert.deepEqual(out, [], `host=${host} no debe cerrarse`);
    }
  });

  it('NO CIERRA si el reloj no es parseable: sin reloj no hay gracia que medir', () => {
    // Cerrar sin reloj sería cerrar al instante — el fallo abierto peor posible.
    for (const last_seen_alive of [null, undefined, '', 'ayer', 0]) {
      const out = selectAutoCloseTargets(stateWith({ t1: bbSession({ last_seen_alive }) }), {
        now: NOW,
        graceMs: GRACE_MS,
        hostName: 'bb',
      });
      assert.deepEqual(out, [], `last_seen_alive=${last_seen_alive} no debe cerrarse`);
    }
  });

  it('NO CIERRA sin workspace_ref utilizable', () => {
    for (const workspace_ref of [null, '', 42]) {
      const out = selectAutoCloseTargets(stateWith({ t1: bbSession({ workspace_ref }) }), {
        now: NOW,
        graceMs: GRACE_MS,
        hostName: 'bb',
      });
      assert.deepEqual(out, []);
    }
  });

  it('sin hostName resuelto NO cierra nada (la guarda por host se desactiva en seguro)', () => {
    const out = selectAutoCloseTargets(stateWith({ t1: bbSession() }), {
      now: NOW,
      graceMs: GRACE_MS,
      hostName: undefined,
    });
    assert.deepEqual(out, []);
  });

  it('never-throws ante un state degenerado', () => {
    for (const state of [null, undefined, {}, { sessions: null }, { sessions: { t1: null } }]) {
      assert.doesNotThrow(() =>
        selectAutoCloseTargets(state, { now: NOW, graceMs: GRACE_MS, hostName: 'bb' }),
      );
    }
  });

  it('selecciona varias a la vez y deja fuera las que no cumplen', () => {
    const out = selectAutoCloseTargets(
      stateWith({
        t1: bbSession({ workspace_ref: 'thr_a', task_ref: 'KODO-1' }),
        t2: bbSession({ workspace_ref: 'thr_b', task_ref: 'KODO-2', needs_input: true }),
        t3: bbSession({ workspace_ref: 'thr_c', task_ref: 'KODO-3' }),
      }),
      { now: NOW, graceMs: GRACE_MS, hostName: 'bb' },
    );
    assert.deepEqual(out.map((t) => t.ref).sort(), ['thr_a', 'thr_c']);
  });

  it('el default de la gracia son 90 s (documentado en bb.idle_close_grace_s)', () => {
    assert.equal(DEFAULT_IDLE_CLOSE_GRACE_MS, 90 * 1000);
  });

  // KODO-31 × KODO-55 — el placeholder de reserva de slot NO es una sesión cerrable.
  it('NUNCA cierra una RESERVA de slot de max_parallel (placeholder `launching`)', () => {
    // `reserveLaunchSlot` escribe una entrada con `workspace_ref: ''` y sin `state` ni
    // `host` mientras el lanzamiento monta provider/worktree/workspace. Llamar
    // `bb thread stop('')` sobre ella sería, en el mejor caso, un error de BB; en el peor,
    // parar algo que no es. Tres guardas independientes lo impiden y este test las fija
    // como conjunto: si alguna se relaja, aquí salta.
    const reservation = {
      workspace_ref: '',
      workspace_id: null,
      session_id: '',
      task_id: '',
      task_ref: 'KODO-42',
      provider: 'plane',
      project_id: '',
      summary: 'Lanzando KODO-42…',
      status: 'launching',
      started_at: new Date(NOW - 10 * 60 * 1000).toISOString(),
      project_path: '',
    };
    const out = selectAutoCloseTargets(stateWith({ 'launching:abc': reservation }), {
      now: NOW,
      graceMs: GRACE_MS,
      hostName: 'bb',
    });
    assert.deepEqual(out, []);
  });

  it('una reserva CON host/state/ref rellenados a mano tampoco se cuela por el ref vacío', () => {
    // Defensa del caso patológico: aunque un futuro placeholder llevara `host: 'bb'` y
    // `state: 'idle'`, el `workspace_ref` vacío sigue bastando para descartarlo.
    const out = selectAutoCloseTargets(
      stateWith({
        'launching:abc': bbSession({ workspace_ref: '', status: 'launching' }),
      }),
      { now: NOW, graceMs: GRACE_MS, hostName: 'bb' },
    );
    assert.deepEqual(out, []);
  });
});

describe('runReconcileTick — cableado del autocierre (KODO-31)', () => {
  /** Arnés mínimo: state en memoria, sin lock real, host inyectado. */
  function harness({ host, sessions, logger }) {
    let state = stateWith(sessions);
    return {
      deps: {
        host,
        loadState: () => state,
        saveState: (s) => {
          state = s;
        },
        debounceStore: new Map(),
        tick: 1,
        now: () => NOW,
        logger,
        // pgrep inyectado: sin él, el tick dispararía el pgrep real del sistema.
        pgrep: () => 'pid',
        hostName: 'bb',
        idleCloseGraceMs: GRACE_MS,
      },
    };
  }

  it('llama a _legacy.close(ref) de la sesión elegible y emite session.autoclose', async () => {
    const closed = [];
    const events = [];
    const host = {
      listWorkspaces: async () => [{ workspace_ref: 'thr_alpha', alive: true, needs_input: false }],
      _legacy: { close: async (ref) => closed.push(ref) },
    };
    const { deps } = harness({
      host,
      sessions: { t1: bbSession() },
      logger: { info: (e, p) => events.push([e, p]), warn: () => {}, debug: () => {} },
    });
    await runReconcileTick(deps);

    assert.deepEqual(closed, ['thr_alpha']);
    const autoclose = events.find(([e]) => e === 'session.autoclose');
    assert.ok(autoclose, 'debe emitirse session.autoclose');
    assert.equal(autoclose[1].thread_id, 'thr_alpha');
    assert.equal(autoclose[1].task_ref, 'KODO-31');
    assert.equal(autoclose[1].grace_s, 90);
    assert.equal(autoclose[1].host, 'bb');
  });

  it('un host SIN _legacy.close no ejecuta el carril (cmux y orca quedan intactos)', async () => {
    // El gate es por CAPACIDAD, no por nombre: así el carril no existe siquiera para los
    // hosts que no lo necesitan, en vez de existir y auto-saltarse.
    const host = {
      listWorkspaces: async () => [{ workspace_ref: 'thr_alpha', alive: true, needs_input: false }],
      _legacy: {},
    };
    const { deps } = harness({ host, sessions: { t1: bbSession() }, logger: undefined });
    await assert.doesNotReject(() => runReconcileTick(deps));
  });

  it('si el snapshot del host FALLÓ no se cierra nada (evidencia degradada)', async () => {
    // Con `liveRefs === null` el tick no transiciona nada; tomar una decisión irreversible
    // con la misma evidencia degradada sería incoherente.
    const closed = [];
    const host = {
      listWorkspaces: async () => {
        throw new Error('ECONNREFUSED');
      },
      _legacy: { close: async (ref) => closed.push(ref) },
    };
    const { deps } = harness({ host, sessions: { t1: bbSession() }, logger: undefined });
    await runReconcileTick(deps);
    assert.deepEqual(closed, []);
  });

  it('un close que falla NO tumba el tick y deja traza (never-throws)', async () => {
    const warns = [];
    const host = {
      listWorkspaces: async () => [{ workspace_ref: 'thr_alpha', alive: true, needs_input: false }],
      _legacy: {
        close: async () => {
          throw new Error('bb thread stop failed: thread already stopped');
        },
      },
    };
    const { deps } = harness({
      host,
      sessions: { t1: bbSession() },
      logger: { info: () => {}, warn: (e, p) => warns.push([e, p]), debug: () => {} },
    });
    await assert.doesNotReject(() => runReconcileTick(deps));
    assert.ok(warns.some(([e]) => e === 'session.autoclose.fail'));
  });

  it('NO cierra una sesión con interacción pendiente ni siquiera con el host capaz', async () => {
    // El mismo invariante del selector, comprobado extremo a extremo: es la regla cuya
    // violación pierde la pregunta que el agente le hizo al humano.
    const closed = [];
    const host = {
      listWorkspaces: async () => [{ workspace_ref: 'thr_alpha', alive: true, needs_input: true }],
      _legacy: { close: async (ref) => closed.push(ref) },
    };
    const { deps } = harness({
      host,
      sessions: { t1: bbSession({ needs_input: true }) },
      logger: undefined,
    });
    await runReconcileTick(deps);
    assert.deepEqual(closed, []);
  });

  it('el autocierre NO escribe estado: SessionEnd es el dueño del camino de cierre', async () => {
    // Marcar la sesión aquí duplicaría a un escritor que no controlamos (el hook corre en
    // el proceso hijo de BB). Lo único que hace este carril es apretar el botón.
    const host = {
      listWorkspaces: async () => [{ workspace_ref: 'thr_alpha', alive: true, needs_input: false }],
      _legacy: { close: async () => {} },
    };
    let state = stateWith({ t1: bbSession() });
    const before = JSON.stringify(state);
    await runReconcileTick({
      host,
      loadState: () => state,
      saveState: (s) => {
        state = s;
      },
      debounceStore: new Map(),
      tick: 1,
      now: () => NOW,
      pgrep: () => 'pid',
      hostName: 'bb',
      idleCloseGraceMs: GRACE_MS,
    });
    assert.equal(JSON.stringify(state), before, 'el tick no debe mutar la sesión por cerrarla');
  });
});
