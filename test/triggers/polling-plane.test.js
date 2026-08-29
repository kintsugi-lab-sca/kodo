// @ts-check
//
// test/triggers/polling-plane.test.js — KODO-60.
//
// El carril de polling con el provider Plane: descubrir por sondeo lo que hasta ahora
// solo llegaba por webhook, sin exigir una URL pública por operador.
//
// HOME aislado ANTES de cualquier import dinámico (mismo motivo que
// test/triggers/dispatcher.test.js): el bloque de convivencia usa el `dispatchTrigger`
// REAL, que escribe audit NDJSON y locks de dedup bajo `~/.kodo`. Sin el sandbox,
// estos tests contaminarían la traza del operador.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
process.env.HOME = mkdtempSync(join(tmpdir(), 'kodo-polling-plane-'));

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startPolling } from '../../src/triggers/polling.js';

// Guard de fuga de red: cualquier path que toque `fetch` en vez del provider inyectado
// falla ruidosamente en vez de salir a tasks.kintsugi-lab.com.
const _originalFetch = globalThis.fetch;
before(() => {
  // @ts-ignore — override deliberado, acotado a este fichero.
  globalThis.fetch = () => {
    throw new Error('live fetch leak: el test debe inyectar opts.provider');
  };
});
after(() => {
  globalThis.fetch = _originalFetch;
});

// ── Andamiaje ───────────────────────────────────────────────────────────────

/** Clock virtual (lift de test/triggers/polling.test.js). */
function createTestClock() {
  /** @type {Array<{ts: number, fn: () => void, handle: number}>} */
  const queue = [];
  let nextHandle = 1;
  let virtualNow = 0;
  return {
    clock: {
      setTimeout(fn, ms) {
        const handle = nextHandle++;
        queue.push({ ts: virtualNow + ms, fn, handle });
        queue.sort((a, b) => a.ts - b.ts);
        return handle;
      },
      clearTimeout(handle) {
        const i = queue.findIndex((q) => q.handle === handle);
        if (i >= 0) queue.splice(i, 1);
      },
      now() {
        return virtualNow;
      },
    },
    async advance(ms) {
      const target = virtualNow + ms;
      while (queue.length && queue[0].ts <= target) {
        const next = /** @type {any} */ (queue.shift());
        virtualNow = next.ts;
        next.fn();
        await new Promise((r) => globalThis.setImmediate(r));
      }
      virtualNow = target;
    },
  };
}

async function drain() {
  await new Promise((r) => globalThis.setImmediate(r));
}

const PROJ_KODO = 'ba0d5b91-0000-4000-8000-000000000001';
const PROJ_SCP = 'ba0d5b91-0000-4000-8000-000000000002';

/** Scopes tal como los produce `resolvePollingPlan` para Plane. */
const SCOPE_KODO = { owner: 'k-lab', repo: 'KODO', id: PROJ_KODO };
const SCOPE_SCP = { owner: 'k-lab', repo: 'SCP', id: PROJ_SCP };

/**
 * TaskItem normalizado como el que devuelve `normalizeWorkItem` de Plane.
 * @param {{ ref: string, updated: string, project?: string, created?: string }} p
 */
function makeTask({ ref, updated, project = PROJ_KODO, created = '2026-08-01T00:00:00Z' }) {
  return {
    id: `wi-${ref}`,
    ref,
    title: `Tarea ${ref}`,
    description: '',
    labels: ['kodo'],
    projectId: project,
    projectName: 'kodo',
    groups: [],
    url: `https://tasks.kintsugi-lab.com/k-lab/browse/${ref}`,
    priority: null,
    assignees: ['op-1'],
    state: 'In Progress',
    updated_at: updated,
    created_at: created,
  };
}

/**
 * Provider de mentira con la superficie que el loop usa. Cuenta las llamadas a
 * `listPendingTasks` — el contador es una aserción por sí mismo (una por tick).
 * @param {(tick: number) => Promise<any[]>} listFn
 */
function makeFakeProvider(listFn) {
  const calls = { listPendingTasks: 0, init: 0 };
  return {
    calls,
    async init() {
      calls.init += 1;
    },
    async getTask() {
      throw new Error('no usado en este path');
    },
    async updateTaskState() {},
    async addComment() {},
    async listPendingTasks() {
      calls.listPendingTasks += 1;
      return listFn(calls.listPendingTasks);
    },
    parseTriggerEvent: () => null,
    verifySignature: () => true,
    async resolveRef() {
      return '';
    },
  };
}

let sandbox;
let statePath;
/** @type {{ stop: () => void } | null} */
let handle = null;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'kodo-polling-plane-state-'));
  statePath = join(sandbox, 'polling-state.json');
});

afterEach(() => {
  if (handle) handle.stop();
  handle = null;
  rmSync(sandbox, { recursive: true, force: true });
});

/** Lee el cache de watermarks del disco. */
function readState() {
  return JSON.parse(readFileSync(statePath, 'utf-8'));
}

// ── Watermark y anti-storm ──────────────────────────────────────────────────

describe('polling Plane — watermark por proyecto', () => {
  it('primer tick: NO lanza el backlog, solo apunta el watermark', async () => {
    const { clock } = createTestClock();
    const dispatched = [];
    const provider = makeFakeProvider(async () => [
      makeTask({ ref: 'KODO-1', updated: '2026-08-29T10:00:00Z' }),
      makeTask({ ref: 'KODO-2', updated: '2026-08-29T11:00:00Z' }),
    ]);
    handle = startPolling({
      provider,
      providerName: 'plane',
      scopes: [SCOPE_KODO],
      dispatchTriggerFn: async (e) => {
        dispatched.push(e);
        return { action: 'launched' };
      },
      intervalSec: 60,
      clock,
      statePath,
    });
    await drain();

    assert.equal(dispatched.length, 0, 'el backlog previo no despierta sesiones');
    const state = readState();
    assert.equal(state[PROJ_KODO].observed, true, 'el proyecto queda marcado como observado');
    assert.equal(
      state[PROJ_KODO].last_updated_at,
      '2026-08-29T11:00:00Z',
      'el cursor se puebla con max(updated_at)',
    );
  });

  it('la clave del cursor es el UUID del proyecto, no el owner/repo', async () => {
    const { clock } = createTestClock();
    const provider = makeFakeProvider(async () => [
      makeTask({ ref: 'KODO-1', updated: '2026-08-29T10:00:00Z' }),
    ]);
    handle = startPolling({
      provider,
      providerName: 'plane',
      scopes: [SCOPE_KODO],
      dispatchTriggerFn: async () => ({ action: 'launched' }),
      clock,
      statePath,
    });
    await drain();
    const state = readState();
    assert.ok(state[PROJ_KODO], 'el watermark vive bajo el UUID del proyecto');
    assert.equal(state['k-lab/KODO'], undefined, 'y NO bajo la etiqueta legible');
  });

  it('tick sin cambios → 0 dispatch', async () => {
    writeFileSync(
      statePath,
      JSON.stringify({ [PROJ_KODO]: { last_updated_at: '2026-08-29T12:00:00Z', observed: true } }),
    );
    const { clock } = createTestClock();
    const dispatched = [];
    const provider = makeFakeProvider(async () => [
      makeTask({ ref: 'KODO-1', updated: '2026-08-29T10:00:00Z' }),
      makeTask({ ref: 'KODO-2', updated: '2026-08-29T12:00:00Z' }), // igual al cursor: NO es nuevo
    ]);
    handle = startPolling({
      provider,
      providerName: 'plane',
      scopes: [SCOPE_KODO],
      dispatchTriggerFn: async (e) => {
        dispatched.push(e);
        return { action: 'launched' };
      },
      clock,
      statePath,
    });
    await drain();
    assert.equal(dispatched.length, 0, 'nada por debajo o igual al watermark vuelve a lanzarse');
  });

  it('tick con 2 nuevas → 2 dispatch, con provider "plane" en el evento', async () => {
    writeFileSync(
      statePath,
      JSON.stringify({ [PROJ_KODO]: { last_updated_at: '2026-08-29T09:00:00Z', observed: true } }),
    );
    const { clock } = createTestClock();
    const dispatched = [];
    const provider = makeFakeProvider(async () => [
      makeTask({ ref: 'KODO-7', updated: '2026-08-29T10:00:00Z' }),
      makeTask({ ref: 'KODO-8', updated: '2026-08-29T10:05:00Z' }),
    ]);
    handle = startPolling({
      provider,
      providerName: 'plane',
      scopes: [SCOPE_KODO],
      dispatchTriggerFn: async (e) => {
        dispatched.push(e);
        return { action: 'launched' };
      },
      clock,
      statePath,
    });
    await drain();

    assert.equal(dispatched.length, 2);
    assert.deepEqual(
      dispatched.map((e) => e.taskRef).sort(),
      ['KODO-7', 'KODO-8'],
    );
    // El campo `provider` NO es decorativo: `dispatchTrigger` lo usa para elegir el
    // adaptador con el que re-lee la tarea. Un 'github' aquí mandaría la consulta al
    // provider equivocado.
    assert.ok(
      dispatched.every((e) => e.provider === 'plane'),
      'el TriggerEvent lleva provider "plane"',
    );
    assert.ok(dispatched.every((e) => e.action === 'polling'));
    assert.equal(readState()[PROJ_KODO].last_updated_at, '2026-08-29T10:05:00Z');
  });

  it('cada proyecto lleva SU watermark: uno avanza sin arrastrar al otro', async () => {
    writeFileSync(
      statePath,
      JSON.stringify({
        [PROJ_KODO]: { last_updated_at: '2026-08-29T09:00:00Z', observed: true },
        [PROJ_SCP]: { last_updated_at: '2026-08-29T09:00:00Z', observed: true },
      }),
    );
    const { clock } = createTestClock();
    const dispatched = [];
    const provider = makeFakeProvider(async () => [
      makeTask({ ref: 'KODO-9', updated: '2026-08-29T10:00:00Z', project: PROJ_KODO }),
      makeTask({ ref: 'SCP-3', updated: '2026-08-29T08:00:00Z', project: PROJ_SCP }),
    ]);
    handle = startPolling({
      provider,
      providerName: 'plane',
      scopes: [SCOPE_KODO, SCOPE_SCP],
      dispatchTriggerFn: async (e) => {
        dispatched.push(e);
        return { action: 'launched' };
      },
      clock,
      statePath,
    });
    await drain();

    assert.deepEqual(dispatched.map((e) => e.taskRef), ['KODO-9']);
    const state = readState();
    assert.equal(state[PROJ_KODO].last_updated_at, '2026-08-29T10:00:00Z');
    assert.equal(state[PROJ_SCP].last_updated_at, '2026-08-29T09:00:00Z', 'SCP no se mueve');
  });

  it('cada tick revalida los caches del provider (init con su propio TTL)', async () => {
    // Sin esto, un daemon de días leería el tablero con el vocabulario de estados y
    // etiquetas del día que arrancó: una etiqueta `kodo` creada después sería invisible.
    const { clock, advance } = createTestClock();
    const provider = makeFakeProvider(async () => []);
    handle = startPolling({
      provider,
      providerName: 'plane',
      scopes: [SCOPE_KODO, SCOPE_SCP],
      dispatchTriggerFn: async () => ({ action: 'launched' }),
      intervalSec: 60,
      clock,
      statePath,
    });
    await drain();
    assert.equal(provider.calls.init, 1, 'una vez por tick, no una por proyecto');
    await advance(60_000);
    await drain();
    assert.equal(provider.calls.init, 2);
  });

  it('un init que falla NO salta el tick: se sigue con los caches anteriores', async () => {
    writeFileSync(
      statePath,
      JSON.stringify({ [PROJ_KODO]: { last_updated_at: '2026-08-29T09:00:00Z', observed: true } }),
    );
    const { clock } = createTestClock();
    const dispatched = [];
    const provider = makeFakeProvider(async () => [
      makeTask({ ref: 'KODO-20', updated: '2026-08-29T10:00:00Z' }),
    ]);
    provider.init = async () => {
      throw new Error('GET /states 503');
    };
    handle = startPolling({
      provider,
      providerName: 'plane',
      scopes: [SCOPE_KODO],
      dispatchTriggerFn: async (e) => {
        dispatched.push(e);
        return { action: 'launched' };
      },
      clock,
      statePath,
    });
    await drain();
    assert.deepEqual(dispatched.map((e) => e.taskRef), ['KODO-20']);
  });

  it('UNA sola llamada a listPendingTasks por tick, aunque haya varios proyectos', async () => {
    // `listPendingTasks` ya itera internamente todos los proyectos configurados: pedirla
    // una vez por scope sería N² peticiones contra un provider con rate limit.
    const { clock, advance } = createTestClock();
    const provider = makeFakeProvider(async () => []);
    handle = startPolling({
      provider,
      providerName: 'plane',
      scopes: [SCOPE_KODO, SCOPE_SCP],
      dispatchTriggerFn: async () => ({ action: 'launched' }),
      intervalSec: 60,
      clock,
      statePath,
    });
    await drain();
    assert.equal(provider.calls.listPendingTasks, 1, 'tick 1 → 1 petición para 2 proyectos');

    await advance(60_000);
    await drain();
    assert.equal(provider.calls.listPendingTasks, 2, 'tick 2 → otra petición (el memo no persiste)');
  });
});

// ── catch-up ────────────────────────────────────────────────────────────────

describe('polling Plane — catch-up', () => {
  it('con catchUp, el primer tick SÍ lanza lo que ya estaba en el estado trigger', async () => {
    const { clock } = createTestClock();
    const dispatched = [];
    const provider = makeFakeProvider(async () => [
      makeTask({ ref: 'KODO-1', updated: '2026-08-29T10:00:00Z' }),
      makeTask({ ref: 'KODO-2', updated: '2026-08-29T11:00:00Z' }),
    ]);
    handle = startPolling({
      provider,
      providerName: 'plane',
      scopes: [SCOPE_KODO],
      catchUp: true,
      dispatchTriggerFn: async (e) => {
        dispatched.push(e);
        return { action: 'launched' };
      },
      clock,
      statePath,
    });
    await drain();
    assert.equal(dispatched.length, 2, 'el backlog se recupera bajo orden explícita');
  });

  it('catchUp es INERTE una vez el proyecto ya quedó observado', async () => {
    writeFileSync(
      statePath,
      JSON.stringify({ [PROJ_KODO]: { last_updated_at: '2026-08-29T12:00:00Z', observed: true } }),
    );
    const { clock } = createTestClock();
    const dispatched = [];
    const provider = makeFakeProvider(async () => [
      makeTask({ ref: 'KODO-1', updated: '2026-08-29T10:00:00Z' }),
    ]);
    handle = startPolling({
      provider,
      providerName: 'plane',
      scopes: [SCOPE_KODO],
      catchUp: true,
      dispatchTriggerFn: async (e) => {
        dispatched.push(e);
        return { action: 'launched' };
      },
      clock,
      statePath,
    });
    await drain();
    assert.equal(dispatched.length, 0, 'catch-up no reabre lo que ya está por debajo del cursor');
  });
});

// ── Resiliencia: un 5xx no mata el bucle ────────────────────────────────────

describe('polling Plane — un 5xx no mata el bucle', () => {
  it('503 → reintenta con backoff acotado y el siguiente tick sigue vivo', async () => {
    writeFileSync(
      statePath,
      JSON.stringify({ [PROJ_KODO]: { last_updated_at: '2026-08-29T09:00:00Z', observed: true } }),
    );
    const { clock, advance } = createTestClock();
    const dispatched = [];
    let failing = true;
    const provider = makeFakeProvider(async () => {
      if (failing) {
        const err = /** @type {any} */ (new Error('Plane 503'));
        err.status = 503;
        throw err;
      }
      return [makeTask({ ref: 'KODO-11', updated: '2026-08-29T10:00:00Z' })];
    });
    handle = startPolling({
      provider,
      providerName: 'plane',
      scopes: [SCOPE_KODO],
      dispatchTriggerFn: async (e) => {
        dispatched.push(e);
        return { action: 'launched' };
      },
      intervalSec: 60,
      clock,
      statePath,
    });
    await drain();
    // 1 intento + 3 reintentos con backoff 2s/4s/8s (T-25-03, acotado).
    await advance(2000);
    await drain();
    await advance(4000);
    await drain();
    await advance(8000);
    await drain();
    assert.equal(provider.calls.listPendingTasks, 4, '1 intento + 3 reintentos, ni uno más');
    assert.equal(dispatched.length, 0, 'el tick fallido no lanza nada');
    // El cursor NO se toca: el fallo no debe enterrar trabajo sin ver.
    assert.equal(readState()[PROJ_KODO].last_updated_at, '2026-08-29T09:00:00Z');

    // El bucle sigue programado: el siguiente tick recupera con normalidad.
    failing = false;
    await advance(60_000);
    await drain();
    assert.deepEqual(dispatched.map((e) => e.taskRef), ['KODO-11'], 'el bucle sobrevivió al 5xx');
  });

  it('un error NO transitorio (404) tampoco tumba el bucle: warn-and-continue', async () => {
    writeFileSync(
      statePath,
      JSON.stringify({ [PROJ_KODO]: { last_updated_at: '2026-08-29T09:00:00Z', observed: true } }),
    );
    const { clock, advance } = createTestClock();
    const dispatched = [];
    let failing = true;
    const provider = makeFakeProvider(async () => {
      if (failing) {
        const err = /** @type {any} */ (new Error('Plane 404'));
        err.status = 404;
        throw err;
      }
      return [makeTask({ ref: 'KODO-12', updated: '2026-08-29T10:00:00Z' })];
    });
    handle = startPolling({
      provider,
      providerName: 'plane',
      scopes: [SCOPE_KODO],
      dispatchTriggerFn: async (e) => {
        dispatched.push(e);
        return { action: 'launched' };
      },
      intervalSec: 60,
      clock,
      statePath,
    });
    await drain();
    assert.equal(provider.calls.listPendingTasks, 1, 'no transitorio → fail-fast, sin reintentos');

    failing = false;
    await advance(60_000);
    await drain();
    assert.deepEqual(dispatched.map((e) => e.taskRef), ['KODO-12']);
  });
});

// ── Convivencia webhook + polling ───────────────────────────────────────────

describe('polling Plane — convivencia con el webhook', () => {
  /**
   * Monta el `dispatchTrigger` REAL con dependencias de mentira y un directorio de
   * locks propio. Devuelve la función de dispatch y el registro de lanzamientos.
   * @param {any} task
   */
  async function makeRealDispatch(task) {
    const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
    const launches = [];
    /** @type {any[]} */
    const sessions = [];
    const provider = {
      init: async () => {},
      getTask: async () => task,
      updateTaskState: async () => {},
      addComment: async () => {},
      listPendingTasks: async () => [],
      parseTriggerEvent: () => null,
      verifySignature: () => true,
      resolveRef: async () => '',
    };
    const deps = {
      getProviderFn: () => provider,
      launchWorkItemFn: async (ref) => {
        launches.push(ref);
        const session = {
          workspace_ref: `workspace:${ref}`,
          session_id: randomUUID(),
          task_id: task.id,
          task_ref: ref,
          provider: 'plane',
          project_id: task.projectId,
          summary: task.title,
          status: 'running',
          started_at: new Date().toISOString(),
          project_path: sandbox,
        };
        sessions.push(session);
        return session;
      },
      listSessionsFn: () => sessions,
      listWorkspacesFn: async () => sessions.map((s) => s.workspace_ref).join('\n'),
      removeSessionFn: () => {},
      resolveProjectPathFn: () => sandbox,
      existsSyncFn: () => false,
      dispatchLockDir: join(sandbox, 'locks'),
    };
    return {
      launches,
      dispatch: (event) => dispatchTrigger(event, {}, deps),
    };
  }

  it('la misma tarea vista por webhook y por polling → UN solo lanzamiento', async () => {
    const task = makeTask({ ref: 'KODO-42', updated: '2026-08-29T10:00:00Z' });
    const { launches, dispatch } = await makeRealDispatch(task);

    // 1) Llega el webhook de Plane.
    const webhookVerdict = await dispatch({
      taskRef: 'KODO-42',
      action: 'updated',
      provider: 'plane',
      raw: {},
    });
    assert.equal(webhookVerdict.action, 'launched');

    // 2) El tick de polling ve la MISMA tarea (el webhook no borra nada del tablero).
    writeFileSync(
      statePath,
      JSON.stringify({ [PROJ_KODO]: { last_updated_at: '2026-08-29T09:00:00Z', observed: true } }),
    );
    const { clock } = createTestClock();
    const verdicts = [];
    const provider = makeFakeProvider(async () => [task]);
    handle = startPolling({
      provider,
      providerName: 'plane',
      scopes: [SCOPE_KODO],
      dispatchTriggerFn: async (event) => {
        const v = await dispatch(event);
        verdicts.push(v);
        return v;
      },
      clock,
      statePath,
    });
    await drain();

    assert.equal(verdicts.length, 1, 'el polling SÍ intentó despachar (no es un falso verde)');
    assert.equal(verdicts[0].action, 'already_active', 'y el guard de sesión activa lo frenó');
    assert.equal(launches.length, 1, 'UN solo lanzamiento entre los dos carriles');
  });

  it('webhook y polling SIMULTÁNEOS sobre la misma tarea → UN solo lanzamiento', async () => {
    const task = makeTask({ ref: 'KODO-43', updated: '2026-08-29T10:00:00Z' });
    const { launches, dispatch } = await makeRealDispatch(task);

    const [a, b] = await Promise.all([
      dispatch({ taskRef: 'KODO-43', action: 'updated', provider: 'plane', raw: {} }),
      dispatch({ taskRef: 'KODO-43', action: 'polling', provider: 'plane', raw: task }),
    ]);

    assert.equal(launches.length, 1, 'el dedup por task_id corta el segundo');
    const actions = [a.action, b.action].sort();
    assert.deepEqual(actions, ['already_active', 'launched']);
  });
});
