// @ts-check
//
// test/webhook-retry-dedup.test.js — KODO-34.
//
// INTEGRACIÓN webhook ↔ dispatcher REAL (no un stub de dispatch): lo que fija este
// fichero es la mitad del contrato que webhook.test.js no puede ver — que el 503 sea
// SEGURO. Un 503 sin dedupe intacto es peor que el bug original: en vez de perder el
// evento, Plane lo reentregaría y kodo lanzaría una segunda sesión sobre la misma
// tarea.
//
// Los tres guardas que deben sobrevivir al reintento:
//   1. `dispatch-<task_id>.lock` (cross-proceso, ~/.kodo/locks) — se adquiere ANTES
//      del launch y se libera en el `finally`, así que un fallo transitorio DURANTE
//      el launch no puede dejarlo colgado bloqueando el reintento hasta el TTL (120s).
//   2. `inFlight` (in-proceso, por task_id).
//   3. El guarda session-already-active contra el estado persistido.
//
// El lock dir se inyecta a un sandbox (`dispatchLockDir`) para no tocar el ~/.kodo
// real, y `_logger: null` desactiva el sink NDJSON del dispatcher.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @type {string} */
let sandbox;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'kodo-webhook-retry-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const TASK_ID = 'task-kodo-34';
const TASK_REF = 'KL-34';

/** El TaskProvider mínimo que consume `handleWebhookRequest` (firma + parseo). */
function createFakeProvider() {
  return {
    init: async () => {},
    getTask: async () => ({}),
    updateTaskState: async () => {},
    addComment: async () => {},
    listPendingTasks: async () => [],
    parseTriggerEvent: () => ({ taskRef: TASK_REF, action: 'state_change', provider: 'test', raw: {} }),
    verifySignature: () => true,
    resolveRef: async () => '',
  };
}

/** La work item que resuelve el dispatcher: non-GSD (etiqueta `kodo` a secas), sin `state`. */
function fakeTask() {
  return {
    id: TASK_ID,
    ref: TASK_REF,
    title: 'webhook retry',
    description: '',
    labels: ['kodo'],
    projectId: 'p',
    projectName: 'P',
    groups: [],
    url: '',
    priority: 'medium',
  };
}

/**
 * Construye un escenario: webhook real → dispatcher real, con el estado de sesiones
 * simulado en memoria (lo que el dispatcher persistiría entre entregas del webhook).
 *
 * @param {{ getTask?: () => Promise<any>, launch?: () => Promise<any> }} hooks
 */
function createScenario(hooks = {}) {
  /** @type {any[]} */
  const sessions = [];
  /** @type {number[]} */
  const launches = [];

  const deliver = async () => {
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    return handleWebhookRequest('{"event":"issue"}', {}, createFakeProvider(), {
      logger: null,
      dispatchTriggerFn: (event) =>
        dispatchTrigger(event, {}, {
          _logger: null,
          dispatchLockDir: join(sandbox, 'locks'),
          getProviderFn: () => ({
            getTask: hooks.getTask || (async () => fakeTask()),
          }),
          launchWorkItemFn: async () => {
            if (hooks.launch) await hooks.launch();
            launches.push(Date.now());
            const session = {
              workspace_ref: 'w1',
              session_id: 's1',
              task_id: TASK_ID,
              task_ref: TASK_REF,
              provider: 'test',
              project_id: 'p',
              summary: 'retry',
              status: 'running',
              started_at: new Date().toISOString(),
              project_path: '/tmp/x',
            };
            sessions.push(session);
            return session;
          },
          listSessionsFn: () => sessions.slice(),
          listWorkspacesFn: async () => sessions.map((s) => s.workspace_ref),
          removeSessionFn: () => {},
          // null → sin projectPath: salta el chequeo de colisión de worktree y deja
          // el camino mínimo. El dedupe (lo que se mide aquí) no depende de él.
          resolveProjectPathFn: () => null,
        }),
    });
  };

  return { deliver, launches, sessions };
}

/** Ficheros de lock vivos en el sandbox (0 = ninguno colgado). */
function heldLocks() {
  try {
    return readdirSync(join(sandbox, 'locks')).filter((f) => f.startsWith('dispatch-'));
  } catch {
    return [];
  }
}

describe('KODO-34: el reintento de Plane tras un 503 no duplica sesión', () => {
  it('fallo transitorio en getTask → 503 sin launch; el reintento lanza UNA sesión', async () => {
    let attempt = 0;
    const scenario = createScenario({
      getTask: async () => {
        attempt++;
        // Primera entrega: Plane devuelve 503. Segunda (el reintento): ya responde.
        if (attempt === 1) throw new Error('Plane API 503: /projects/p/work-items/ — service unavailable');
        return fakeTask();
      },
    });

    const first = await scenario.deliver();
    assert.equal(first.status, 503, 'la entrega fallida pide reintento');
    assert.equal(scenario.launches.length, 0, 'un dispatch que muere en getTask no lanza nada');

    const retry = await scenario.deliver();
    assert.equal(retry.status, 200, 'el reintento se procesa');
    assert.equal(scenario.launches.length, 1, 'el reintento lanza exactamente una sesión');
  });

  it('una tercera entrega (duplicada) NO abre una segunda sesión', async () => {
    let attempt = 0;
    const scenario = createScenario({
      getTask: async () => {
        attempt++;
        if (attempt === 1) throw new Error('Plane API 503: /projects/p/ — service unavailable');
        return fakeTask();
      },
    });

    await scenario.deliver(); // 503
    await scenario.deliver(); // reintento → launched
    const duplicate = await scenario.deliver();

    assert.equal(duplicate.status, 200);
    assert.equal(scenario.launches.length, 1, 'el guarda session-already-active corta el duplicado');
  });

  it('fallo transitorio DURANTE el launch → el lock cross-proceso se libera y el reintento pasa', async () => {
    // La regresión que cierra: si el `finally` del dispatcher no soltara
    // `dispatch-<task_id>.lock`, el reintento chocaría con un lock huérfano
    // (`already_active`, retries:0) y la tarea se quedaría sin sesión hasta el
    // TTL de 120 s — o sea, el bug original con otro disfraz.
    let attempt = 0;
    const scenario = createScenario({
      launch: async () => {
        attempt++;
        if (attempt === 1) {
          const err = /** @type {any} */ (new TypeError('fetch failed'));
          err.cause = Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' });
          throw err;
        }
      },
    });

    const first = await scenario.deliver();
    assert.equal(first.status, 503);
    assert.equal(scenario.launches.length, 0, 'el launch abortó antes de registrar la sesión');
    assert.deepEqual(heldLocks(), [], 'el lock de dispatch NO queda colgado tras el fallo');

    const retry = await scenario.deliver();
    assert.equal(retry.status, 200);
    assert.equal(scenario.launches.length, 1, 'el reintento sí lanza — el lock estaba libre');
    assert.deepEqual(heldLocks(), [], 'el lock se libera también en el camino feliz');
  });

  it('dos entregas CONCURRENTES tras el 503 → una sola sesión (dedupe in-flight intacto)', async () => {
    // Plane puede reentregar en paralelo. El guarda `inFlight` + el lock por task_id
    // deben dejar pasar exactamente un launch.
    let attempt = 0;
    const scenario = createScenario({
      getTask: async () => {
        attempt++;
        if (attempt === 1) throw new Error('Plane API 503: /projects/p/ — service unavailable');
        return fakeTask();
      },
      // Mantener el launch abierto un instante para que la entrega concurrente
      // aterrice DENTRO de la ventana in-flight.
      launch: () => new Promise((r) => setTimeout(r, 30)),
    });

    assert.equal((await scenario.deliver()).status, 503);

    const [a, b] = await Promise.all([scenario.deliver(), scenario.deliver()]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(scenario.launches.length, 1, 'exactamente un launch pese a las dos entregas');
  });

  it('fallo PERMANENTE (proyecto no configurado) → 200, sin reintento y sin lock colgado', async () => {
    const scenario = createScenario({
      getTask: async () => {
        throw new Error('No configured project with identifier "UNKNOWN"');
      },
    });

    const result = await scenario.deliver();
    assert.equal(result.status, 200, 'un fallo que no mejora al reintentar no pide reintento');
    assert.equal(scenario.launches.length, 0);
    assert.deepEqual(heldLocks(), []);
  });
});
