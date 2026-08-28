// @ts-check
//
// test/webhook-replay.test.js — KODO-46.
//
// EL AGUJERO: `verifySignature` es timing-safe pero el HMAC de Plane se firma SOLO sobre
// el body, y Plane no expone header temporal alguno (`X-Plane-Signature`, `X-Plane-Event`,
// `X-Plane-Delivery` — ninguno lleva timestamp). Quien capture un webhook válido puede
// reenviarlo indefinidamente: cada reenvío pasa el HMAC y dispara otro dispatch.
//
// Lo que fija este fichero:
//   1. Un reenvío IDÉNTICO dentro de la ventana no llega al dispatch, contesta 200 con
//      `duplicate:true` y deja rastro en el audit (`webhook.replay`).
//   2. Fuera de la ventana se procesa con normalidad — la protección es una ventana, no
//      un bloqueo permanente.
//   3. El 503 de KODO-34 REVOCA la marca: un reintento legítimo del provider trae el
//      mismo body y debe poder entrar. Sin esto, KODO-46 revertiría KODO-34.
//
// El tiempo se inyecta (`now`) en vez de dormir: la ventana real son minutos.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createReplayCache, keyForBody, DEFAULT_REPLAY_TTL_MS } from '../src/triggers/replay-cache.js';

const TTL_MS = 60_000;

/** @type {number} */
let clock;

/** Reloj inyectable — avanza solo cuando el test lo dice. */
const now = () => clock;

beforeEach(() => {
  clock = 1_000_000;
});

/**
 * @param {Partial<import('../src/interface.js').TaskProvider>} [overrides]
 */
function createFakeProvider(overrides = {}) {
  return {
    init: async () => {},
    getTask: async () => ({}),
    updateTaskState: async () => {},
    addComment: async () => {},
    listPendingTasks: async () => [],
    parseTriggerEvent: () => ({ taskRef: 'KL-46', action: 'state_change', provider: 'test', raw: {} }),
    verifySignature: () => true,
    resolveRef: async () => '',
    ...overrides,
  };
}

/** Logger de captura — mismo patrón que webhook.test.js (KODO-28). */
function createCapturingLogger() {
  /** @type {any[]} */
  const records = [];
  const sink = {
    debug: (_e, r) => records.push({ level: 'debug', ...r }),
    info: (_e, r) => records.push({ level: 'info', ...r }),
    warn: (_e, r) => records.push({ level: 'warn', ...r }),
    error: (_e, r) => records.push({ level: 'error', ...r }),
    child: () => sink,
  };
  return { logger: /** @type {any} */ (sink), records };
}

const BODY = JSON.stringify({ event: 'issue', action: 'updated', data: { id: 'abc' } });

describe('KODO-46: caché de idempotencia anti-replay del webhook', () => {
  it('un reenvío idéntico dentro de la ventana NO dispara segundo dispatch y contesta 200 duplicate', async () => {
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
    const replayCache = createReplayCache({ ttlMs: TTL_MS, now });
    /** @type {any[]} */
    const dispatches = [];
    const deps = {
      logger: null,
      replayCache,
      dispatchTriggerFn: async (event) => {
        dispatches.push(event);
        return { action: 'launched' };
      },
    };

    const first = await handleWebhookRequest(BODY, {}, createFakeProvider(), deps);
    assert.equal(first.status, 200);
    assert.equal(first.body.duplicate, undefined, 'la primera entrega no es duplicado');

    // El atacante reenvía el mismo body con la misma firma, 30 s después.
    clock += 30_000;
    const replay = await handleWebhookRequest(BODY, {}, createFakeProvider(), deps);

    assert.equal(replay.status, 200);
    assert.equal(replay.body.duplicate, true);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(dispatches.length, 1, 'el replay no debe llegar al dispatcher');
  });

  it('el replay descartado emite webhook.replay (warn) con task_ref, action y age_ms', async () => {
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
    const { logger, records } = createCapturingLogger();
    const replayCache = createReplayCache({ ttlMs: TTL_MS, now });
    const deps = { logger, replayCache, dispatchTriggerFn: async () => ({ action: 'launched' }) };

    await handleWebhookRequest(BODY, {}, createFakeProvider(), deps);
    clock += 25_000;
    await handleWebhookRequest(BODY, {}, createFakeProvider(), deps);

    const replays = records.filter((r) => r.event === 'webhook.replay');
    assert.equal(replays.length, 1);
    assert.equal(replays[0].level, 'warn');
    assert.equal(replays[0].task_ref, 'KL-46');
    assert.equal(replays[0].action, 'state_change');
    assert.equal(replays[0].age_ms, 25_000);
    assert.equal(replays[0].bytes, Buffer.byteLength(BODY, 'utf8'));

    // Invariante del carril: nada del payload viaja al audit.
    assert.equal(JSON.stringify(replays[0]).includes('abc'), false);

    // Y el replay NO se contabiliza como recibido: `webhook.received` solo la 1.ª vez.
    assert.equal(records.filter((r) => r.event === 'webhook.received').length, 1);
  });

  it('fuera de la ventana el mismo body se procesa con normalidad', async () => {
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
    const replayCache = createReplayCache({ ttlMs: TTL_MS, now });
    /** @type {any[]} */
    const dispatches = [];
    const deps = {
      logger: null,
      replayCache,
      dispatchTriggerFn: async (event) => {
        dispatches.push(event);
        return { action: 'launched' };
      },
    };

    await handleWebhookRequest(BODY, {}, createFakeProvider(), deps);
    clock += TTL_MS + 1; // la ventana venció
    const later = await handleWebhookRequest(BODY, {}, createFakeProvider(), deps);

    assert.equal(later.status, 200);
    assert.equal(later.body.duplicate, undefined);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(dispatches.length, 2);
  });

  it('un body DISTINTO del mismo task+action no se descarta (la clave es el body, no task_ref)', async () => {
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
    const replayCache = createReplayCache({ ttlMs: TTL_MS, now });
    /** @type {any[]} */
    const dispatches = [];
    const deps = {
      logger: null,
      replayCache,
      dispatchTriggerFn: async (event) => {
        dispatches.push(event);
        return { action: 'launched' };
      },
    };

    // Misma tarea y misma acción, transiciones distintas: In Progress → Done → In Progress
    // es una secuencia real y los tres webhooks son eventos legítimos.
    await handleWebhookRequest(JSON.stringify({ id: 'x', state: 'In Progress' }), {}, createFakeProvider(), deps);
    await handleWebhookRequest(JSON.stringify({ id: 'x', state: 'Done' }), {}, createFakeProvider(), deps);
    await handleWebhookRequest(JSON.stringify({ id: 'x', state: 'In Progress ' }), {}, createFakeProvider(), deps);

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(dispatches.length, 3);
  });

  it('KODO-34 intacto: el 503 revoca la marca, así que el reintento del provider entra', async () => {
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
    const replayCache = createReplayCache({ ttlMs: TTL_MS, now });
    let attempts = 0;
    const deps = {
      logger: null,
      replayCache,
      dispatchGraceMs: 500,
      dispatchTriggerFn: async () => {
        attempts++;
        // Solo el primer intento falla con un error transitorio (ECONNREFUSED → 503).
        if (attempts === 1) throw Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
        return { action: 'launched' };
      },
    };

    const failed = await handleWebhookRequest(BODY, {}, createFakeProvider(), deps);
    assert.equal(failed.status, 503);

    // El provider reintenta la MISMA entrega — mismo body, misma firma.
    clock += 1_000;
    const retried = await handleWebhookRequest(BODY, {}, createFakeProvider(), deps);
    assert.equal(retried.status, 200);
    assert.equal(retried.body.duplicate, undefined, 'el reintento tras 503 no es un replay');
    assert.equal(attempts, 2);
  });

  it('replayCache: null desactiva la protección (vía de escape explícita)', async () => {
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
    /** @type {any[]} */
    const dispatches = [];
    const deps = {
      logger: null,
      replayCache: null,
      dispatchTriggerFn: async (event) => {
        dispatches.push(event);
        return { action: 'launched' };
      },
    };

    await handleWebhookRequest(BODY, {}, createFakeProvider(), deps);
    await handleWebhookRequest(BODY, {}, createFakeProvider(), deps);

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(dispatches.length, 2);
  });

  it('un payload no despachable no ocupa entrada en la caché', async () => {
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
    const replayCache = createReplayCache({ ttlMs: TTL_MS, now });
    const provider = createFakeProvider({ parseTriggerEvent: () => null });

    const result = await handleWebhookRequest(BODY, {}, provider, {
      logger: null,
      replayCache,
      dispatchTriggerFn: async () => ({ action: 'launched' }),
    });

    assert.equal(result.body.ignored, true);
    assert.equal(replayCache.size(), 0);
  });
});

describe('KODO-46: createReplayCache', () => {
  it('claim registra y detecta el duplicado con su antigüedad', () => {
    const cache = createReplayCache({ ttlMs: TTL_MS, now });
    const key = keyForBody(BODY);

    assert.deepEqual(cache.claim(key), { fresh: true });
    clock += 10_000;
    assert.deepEqual(cache.claim(key), { fresh: false, ageMs: 10_000 });
  });

  it('un hit NO refresca la ventana — una ráfaga de replays no la extiende', () => {
    const cache = createReplayCache({ ttlMs: TTL_MS, now });
    const key = keyForBody(BODY);

    cache.claim(key);
    // Ráfaga de replays que abarca casi toda la ventana.
    for (let i = 0; i < 5; i++) {
      clock += 10_000;
      assert.equal(cache.claim(key).fresh, false);
    }
    // La ventana se mide desde el evento GENUINO, así que ya venció.
    clock += 10_001;
    assert.equal(cache.claim(key).fresh, true);
  });

  it('revoke suelta la clave inmediatamente', () => {
    const cache = createReplayCache({ ttlMs: TTL_MS, now });
    const key = keyForBody(BODY);

    cache.claim(key);
    cache.revoke(key);
    assert.deepEqual(cache.claim(key), { fresh: true });
  });

  it('purga las entradas vencidas en vez de acumularlas', () => {
    const cache = createReplayCache({ ttlMs: TTL_MS, now });

    for (let i = 0; i < 10; i++) cache.claim(keyForBody(`body-${i}`));
    assert.equal(cache.size(), 10);

    clock += TTL_MS + 1;
    cache.claim(keyForBody('nuevo'));
    assert.equal(cache.size(), 1, 'las 10 vencidas se purgan al primer claim posterior');
  });

  it('respeta el techo de entradas desalojando las más antiguas', () => {
    const cache = createReplayCache({ ttlMs: TTL_MS, maxEntries: 3, now });

    for (let i = 0; i < 5; i++) cache.claim(keyForBody(`body-${i}`));

    assert.equal(cache.size(), 3);
    assert.equal(cache.claim(keyForBody('body-0')).fresh, true, 'la más antigua fue desalojada');
    assert.equal(cache.claim(keyForBody('body-4')).fresh, false, 'la más reciente sigue viva');
  });

  it('una clave vencida que vuelve se reinserta al final (el orden de purga no se rompe)', () => {
    const cache = createReplayCache({ ttlMs: TTL_MS, now });
    const viejo = keyForBody('viejo');

    cache.claim(viejo);
    clock += TTL_MS + 1;
    cache.claim(viejo); // vuelve tras vencer
    cache.claim(keyForBody('nuevo'));

    // Si `viejo` hubiese conservado su posición de cabeza con expiración nueva, `purge`
    // cortaría en él y jamás limpiaría lo que viene detrás.
    clock += 1;
    cache.claim(keyForBody('otro'));
    assert.equal(cache.size(), 3);
    assert.equal(cache.claim(viejo).fresh, false, 'la reinserción mantiene la clave viva');
  });

  it('ttlMs 0 desactiva la caché por completo', () => {
    const cache = createReplayCache({ ttlMs: 0, now });
    const key = keyForBody(BODY);

    assert.deepEqual(cache.claim(key), { fresh: true });
    assert.deepEqual(cache.claim(key), { fresh: true });
    assert.equal(cache.size(), 0);
  });

  it('keyForBody es estable y discrimina bodies distintos', () => {
    assert.equal(keyForBody(BODY), keyForBody(BODY));
    assert.notEqual(keyForBody(BODY), keyForBody(`${BODY} `));
    assert.match(keyForBody(BODY), /^[0-9a-f]{64}$/);
    // El body NO se retiene: la clave es un hash, no el payload.
    assert.equal(keyForBody(BODY).includes('abc'), false);
  });

  it('la ventana por defecto es corta y acotada', () => {
    assert.equal(DEFAULT_REPLAY_TTL_MS, 5 * 60 * 1000);
  });
});
