// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetReplayCache } from '../src/triggers/replay-cache.js';

// KODO-46: la caché anti-replay es de PROCESO y este fichero entrega decenas de webhooks
// con bodies repetidos entre casos, que la caché tomaría por replays. Se limpia entre
// tests para que cada uno arranque con la ventana vacía. La caché en sí se cubre en
// test/webhook-replay.test.js.
beforeEach(() => {
  resetReplayCache();
});

/**
 * Build a fake TaskProvider for webhook tests.
 * @param {Partial<import('../../src/interface.js').TaskProvider>} overrides
 */
function createFakeProvider(overrides = {}) {
  return {
    init: async () => {},
    getTask: async () => ({}),
    updateTaskState: async () => {},
    addComment: async () => {},
    listPendingTasks: async () => [],
    parseTriggerEvent: () => ({ taskRef: 'KL-42', action: 'state_change', provider: 'test', raw: {} }),
    verifySignature: () => true,
    resolveRef: async () => '',
    ...overrides,
  };
}

describe('handleWebhookRequest', () => {
  /** @type {any[]} */
  let dispatchCalls;

  beforeEach(() => {
    dispatchCalls = [];
  });

  it('Test 1: valid signature + recognized event -> calls dispatchTrigger, returns 200', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');

    const provider = createFakeProvider();
    const body = JSON.stringify({ event: 'issue', action: 'updated', data: { id: '1' } });
    const headers = { 'x-webhook-signature': 'valid' };

    const result = await handleWebhookRequest(body, headers, provider, {
      logger: null, // KODO-28: audit NDJSON off (mantiene el test hermetico)
      dispatchTriggerFn: async (event, opts) => {
        dispatchCalls.push({ event, opts });
        return { action: 'launched' };
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    // Fire-and-forget — dispatch was called (may still be pending)
    // Give microtask a chance to run
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(dispatchCalls.length, 1);
    assert.equal(dispatchCalls[0].event.taskRef, 'KL-42');
  });

  it('Test 2: invalid signature -> returns 401, does NOT call dispatchTrigger', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');

    const provider = createFakeProvider({
      verifySignature: () => false,
    });
    const body = JSON.stringify({ event: 'issue' });
    const headers = {};

    const result = await handleWebhookRequest(body, headers, provider, {
      logger: null, // KODO-28: audit NDJSON off (mantiene el test hermetico)
      dispatchTriggerFn: async (event) => {
        dispatchCalls.push(event);
        return { action: 'launched' };
      },
    });

    assert.equal(result.status, 401);
    assert.equal(result.body.error, 'Invalid signature');
    assert.equal(dispatchCalls.length, 0);
  });

  it('Test 3: invalid JSON -> returns 400', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');

    const provider = createFakeProvider();
    const body = 'not-json{{{';
    const headers = {};

    const result = await handleWebhookRequest(body, headers, provider, {
      logger: null, // KODO-28: audit NDJSON off (mantiene el test hermetico)
      dispatchTriggerFn: async (event) => {
        dispatchCalls.push(event);
        return { action: 'launched' };
      },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'Invalid JSON');
    assert.equal(dispatchCalls.length, 0);
  });

  it('Test 4: parseTriggerEvent returns null (unrecognized) -> returns 200 with ignored:true', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');

    const provider = createFakeProvider({
      parseTriggerEvent: () => null,
    });
    const body = JSON.stringify({ event: 'unknown', action: 'created' });
    const headers = {};

    const result = await handleWebhookRequest(body, headers, provider, {
      logger: null, // KODO-28: audit NDJSON off (mantiene el test hermetico)
      dispatchTriggerFn: async (event) => {
        dispatchCalls.push(event);
        return { action: 'launched' };
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.ignored, true);
    assert.equal(dispatchCalls.length, 0);
  });

  it('Test 5: calls provider.verifySignature(rawBody, headers)', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');

    let verifyArgs = /** @type {any} */ (null);
    const provider = createFakeProvider({
      verifySignature: (rawBody, headers) => {
        verifyArgs = { rawBody, headers };
        return true;
      },
    });
    const body = JSON.stringify({ test: true });
    const headers = { 'x-signature': 'abc123' };

    await handleWebhookRequest(body, headers, provider, {
      logger: null, // KODO-28: audit NDJSON off (mantiene el test hermetico)
      dispatchTriggerFn: async () => ({ action: 'launched' }),
    });

    assert.ok(verifyArgs, 'verifySignature should have been called');
    assert.equal(verifyArgs.rawBody, body);
    assert.deepEqual(verifyArgs.headers, headers);
  });

  it('Test 6: calls provider.parseTriggerEvent(payload)', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');

    let parseArg = /** @type {any} */ (null);
    const payload = { event: 'issue', action: 'updated', data: { id: '42' } };
    const provider = createFakeProvider({
      parseTriggerEvent: (raw) => {
        parseArg = raw;
        return { taskRef: 'KL-42', action: 'state_change', provider: 'test', raw };
      },
    });
    const body = JSON.stringify(payload);
    const headers = {};

    await handleWebhookRequest(body, headers, provider, {
      logger: null, // KODO-28: audit NDJSON off (mantiene el test hermetico)
      dispatchTriggerFn: async () => ({ action: 'launched' }),
    });

    assert.ok(parseArg, 'parseTriggerEvent should have been called');
    assert.deepEqual(parseArg, payload);
  });

  it('Test 7: dispatch errors are caught and logged, do not affect HTTP response', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');

    const provider = createFakeProvider();
    const body = JSON.stringify({ event: 'issue', action: 'updated' });
    const headers = {};

    const result = await handleWebhookRequest(body, headers, provider, {
      logger: null, // KODO-28: audit NDJSON off (mantiene el test hermetico)
      dispatchTriggerFn: async () => {
        throw new Error('dispatch boom');
      },
    });

    // Response should still be 200 — errors in dispatch are fire-and-forget
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    // Give fire-and-forget catch handler time to run
    await new Promise((r) => setTimeout(r, 10));
  });
});

// ─── KODO-28: audit estructurado del carril webhook ──────────────────────────
//
// El bug que cierra este bloque: desde a01de1d el daemon detached nacía con
// stdio 'ignore', así que los `console.log('[kodo] Webhook received: ...')` de
// server.js se perdían y no había forma de auditar si un webhook llegó, si lo
// rechazó el HMAC, ni qué se decidió. Estos tests fijan el contrato del NDJSON,
// que es lo único que sobrevive al proceso.

describe('KODO-28: handleWebhookRequest emite el audit estructurado', () => {
  /** Logger espía con la misma superficie que usa logger-events (info/warn/error). */
  function makeSpyLogger() {
    /** @type {any[]} */
    const records = [];
    const push = (level) => (msg, fields) => records.push({ level, msg, ...fields });
    return {
      records,
      info: push('info'),
      warn: push('warn'),
      error: push('error'),
      child: () => makeSpyLogger(),
    };
  }

  it('acepta: emite webhook.received con provider, action, task_ref y bytes', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');
    const logger = makeSpyLogger();
    const provider = createFakeProvider();
    const body = JSON.stringify({ event: 'issue', action: 'updated' });

    await handleWebhookRequest(body, {}, provider, {
      logger,
      providerName: 'plane',
      dispatchTriggerFn: async () => ({ action: 'launched' }),
    });

    assert.equal(logger.records.length, 1);
    const rec = logger.records[0];
    assert.equal(rec.event, 'webhook.received');
    assert.equal(rec.level, 'info');
    // provider sale del TriggerEvent (autoritativo), no de deps.providerName.
    assert.equal(rec.provider, 'test');
    assert.equal(rec.action, 'state_change');
    assert.equal(rec.task_ref, 'KL-42');
    assert.equal(rec.bytes, Buffer.byteLength(body, 'utf8'));
  });

  it('firma inválida: emite webhook.rejected reason=signature (warn) y NO received', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');
    const logger = makeSpyLogger();
    const provider = createFakeProvider({ verifySignature: () => false });

    const result = await handleWebhookRequest('{"a":1}', {}, provider, {
      logger,
      providerName: 'plane',
      dispatchTriggerFn: async () => ({ action: 'launched' }),
    });

    assert.equal(result.status, 401);
    assert.equal(logger.records.length, 1);
    assert.equal(logger.records[0].event, 'webhook.rejected');
    assert.equal(logger.records[0].level, 'warn');
    assert.equal(logger.records[0].reason, 'signature');
    assert.equal(logger.records[0].provider, 'plane', 'pre-parse el provider lo inyecta el caller');
    assert.equal(logger.records[0].bytes, 7);
  });

  it('JSON roto: emite webhook.rejected reason=parse', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');
    const logger = makeSpyLogger();

    await handleWebhookRequest('not-json{{{', {}, createFakeProvider(), {
      logger,
      providerName: 'plane',
      dispatchTriggerFn: async () => ({ action: 'launched' }),
    });

    assert.equal(logger.records.length, 1);
    assert.equal(logger.records[0].reason, 'parse');
  });

  it('evento no despachable: emite webhook.rejected reason=payload (no silencio)', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');
    const logger = makeSpyLogger();
    const provider = createFakeProvider({ parseTriggerEvent: () => null });

    const result = await handleWebhookRequest('{"event":"x"}', {}, provider, {
      logger,
      providerName: 'plane',
      dispatchTriggerFn: async () => ({ action: 'launched' }),
    });

    // 200 + ignored:true, pero el audit lo registra: "llegó y se descartó" ≠ "no llegó".
    assert.equal(result.status, 200);
    assert.equal(result.body.ignored, true);
    assert.equal(logger.records.length, 1);
    assert.equal(logger.records[0].reason, 'payload');
  });

  it('el audit NUNCA persiste el body — solo su tamaño', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');
    const logger = makeSpyLogger();
    const body = JSON.stringify({ event: 'issue', secret_field: 'hunter2' });

    await handleWebhookRequest(body, {}, createFakeProvider(), {
      logger,
      providerName: 'plane',
      dispatchTriggerFn: async () => ({ action: 'launched' }),
    });

    assert.equal(JSON.stringify(logger.records).includes('hunter2'), false);
  });

  it('un logger que lanza no cambia el status ni el body de la respuesta', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');
    const exploding = {
      info: () => { throw new Error('sink caído'); },
      warn: () => { throw new Error('sink caído'); },
      error: () => { throw new Error('sink caído'); },
    };

    const ok = await handleWebhookRequest('{"e":1}', {}, createFakeProvider(), {
      logger: exploding,
      dispatchTriggerFn: async () => ({ action: 'launched' }),
    });
    assert.equal(ok.status, 200);

    const rejected = await handleWebhookRequest('{"e":1}', {}, createFakeProvider({ verifySignature: () => false }), {
      logger: exploding,
      dispatchTriggerFn: async () => ({ action: 'launched' }),
    });
    assert.equal(rejected.status, 401);
  });
});

// ─── KODO-34: 503 en fallo transitorio de dispatch ───────────────────────────
//
// El bug que cierra este bloque: el dispatch era fire-and-forget y el handler
// respondía 200 SIEMPRE. Plane no reintenta un 200, así que un fallo transitorio
// (Plane 5xx, red caída, timeout del AbortSignal de PlaneClient) perdía el evento
// para siempre y dejaba la tarea en In Progress sin sesión ni explicación. Ahora un
// rechazo transitorio dentro de la ventana de gracia contesta 503 y Plane reintenta.

describe('KODO-34: classifyDispatchError', () => {
  it('Plane API 5xx → transitorio', async () => {
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    // Forma EXACTA que lanza PlaneClient.request (client.js:76).
    assert.equal(classify(new Error('Plane API 503: /projects/p/work-items/ — service unavailable')), 'transient');
    assert.equal(classify(new Error('Plane API 500: /projects/p/ — ')), 'transient');
    assert.equal(classify(new Error('Plane API 502: /projects/p/ — bad gateway')), 'transient');
    assert.equal(classify(new Error('Plane API 504: /projects/p/ — gateway timeout')), 'transient');
  });

  it('429 y 408 → transitorio (el servidor pide explícitamente el reintento)', async () => {
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    assert.equal(classify(new Error('Plane API 429: /projects/p/ — slow down')), 'transient');
    assert.equal(classify(new Error('Plane API 408: /projects/p/ — request timeout')), 'transient');
  });

  it('4xx del cliente → permanente (reintentar no cambia nada)', async () => {
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    assert.equal(classify(new Error('Plane API 404: /projects/p/ — not found')), 'permanent');
    assert.equal(classify(new Error('Plane API 401: /projects/p/ — unauthorized')), 'permanent');
    assert.equal(classify(new Error('Plane API 400: /projects/p/ — bad request')), 'permanent');
    assert.equal(classify(new Error('Plane API 409: /projects/p/ — conflict')), 'permanent');
  });

  it('errores de config → permanente (el caso KODO-10: evita la tormenta de reintentos)', async () => {
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    assert.equal(classify(new Error('No configured project with identifier "UNKNOWN"')), 'permanent');
    assert.equal(classify(new Error('Invalid task ref: xx. Expected format: KL-42')), 'permanent');
    assert.equal(classify(new Error('Plane API key not found. Set PLANE_API_KEY env var.')), 'permanent');
  });

  it('códigos de red de Node → transitorio, incluso anidados en err.cause', async () => {
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    assert.equal(classify(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })), 'transient');
    assert.equal(classify(Object.assign(new Error('reset'), { code: 'ECONNRESET' })), 'transient');
    assert.equal(classify(Object.assign(new Error('dns'), { code: 'EAI_AGAIN' })), 'transient');
    // La forma REAL de undici: el código de red viaja ANIDADO bajo `fetch failed`.
    const nested = /** @type {any} */ (new TypeError('fetch failed'));
    nested.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), { code: 'ECONNREFUSED' });
    assert.equal(classify(nested), 'transient');
  });

  it('ENOTFOUND → permanente (una base_url mal configurada falla igual en cada reintento)', async () => {
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    assert.equal(classify(Object.assign(new Error('dns'), { code: 'ENOTFOUND' })), 'permanent');
  });

  it('abort/timeout del AbortSignal de PlaneClient → transitorio', async () => {
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    assert.equal(classify(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'transient');
    assert.equal(classify(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), 'transient');
  });

  it('`fetch failed` sin cause utilizable → transitorio (fallo de red de undici)', async () => {
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    assert.equal(classify(new TypeError('fetch failed')), 'transient');
  });

  it('un status explícito gana al match por mensaje: un 404 cuyo body dice "fetch failed" es permanente', async () => {
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    assert.equal(classify(new Error('Plane API 404: /projects/p/ — fetch failed')), 'permanent');
  });

  it('desconocido → permanente (default-closed)', async () => {
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    assert.equal(classify(new Error('dispatch boom')), 'permanent');
    assert.equal(classify(null), 'permanent');
    assert.equal(classify(undefined), 'permanent');
    assert.equal(classify('a string'), 'permanent');
  });

  it('never-throws ante una cadena de causes cíclica', async () => {
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    const a = /** @type {any} */ (new Error('a'));
    const b = /** @type {any} */ (new Error('b'));
    a.cause = b;
    b.cause = a;
    assert.equal(classify(a), 'permanent');
  });

  it('never-throws ante un getter hostil en la cadena', async () => {
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    const hostile = new Error('boom');
    Object.defineProperty(hostile, 'code', { get() { throw new Error('getter hostil'); } });
    assert.equal(classify(hostile), 'permanent');
  });

  it('never-throws cuando el getter hostil está en `cause` (el avance de la cadena)', async () => {
    // Si el throw escapara, subiría hasta server.js y el webhook contestaría un 400
    // espurio en vez de decidir 200/503.
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    const hostile = new Error('boom');
    Object.defineProperty(hostile, 'cause', { get() { throw new Error('getter hostil'); } });
    assert.equal(classify(hostile), 'permanent');
  });

  it('un transitorio anidado a profundidad 2 sigue detectándose', async () => {
    const { classifyDispatchError: classify } = await import('../../src/triggers/webhook.js');
    const outer = /** @type {any} */ (new Error('launch failed'));
    const middle = /** @type {any} */ (new TypeError('fetch failed'));
    middle.cause = Object.assign(new Error('connect'), { code: 'ETIMEDOUT' });
    outer.cause = middle;
    assert.equal(classify(outer), 'transient');
  });
});

describe('KODO-34: handleWebhookRequest traduce el fallo de dispatch a status HTTP', () => {
  /** Logger espía con la misma superficie que usa logger-events (info/warn/error). */
  function makeSpyLogger() {
    /** @type {any[]} */
    const records = [];
    const push = (level) => (msg, fields) => records.push({ level, msg, ...fields });
    return { records, info: push('info'), warn: push('warn'), error: push('error'), child: () => makeSpyLogger() };
  }

  it('fallo transitorio (Plane 503) → responde 503 para que Plane reintente', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');

    const result = await handleWebhookRequest('{"event":"issue"}', {}, createFakeProvider(), {
      logger: null,
      dispatchTriggerFn: async () => {
        throw new Error('Plane API 503: /projects/p/work-items/ — service unavailable');
      },
    });

    assert.equal(result.status, 503);
    assert.equal(result.body.ok, false);
  });

  it('fallo transitorio de red (ECONNREFUSED anidado en err.cause) → 503', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');

    const result = await handleWebhookRequest('{"event":"issue"}', {}, createFakeProvider(), {
      logger: null,
      dispatchTriggerFn: async () => {
        const err = /** @type {any} */ (new TypeError('fetch failed'));
        err.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), { code: 'ECONNREFUSED' });
        throw err;
      },
    });

    assert.equal(result.status, 503);
  });

  it('fallo permanente (proyecto no configurado) → sigue en 200: no hay nada que reintentar', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');

    const result = await handleWebhookRequest('{"event":"issue"}', {}, createFakeProvider(), {
      logger: null,
      dispatchTriggerFn: async () => {
        throw new Error('No configured project with identifier "UNKNOWN"');
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
  });

  it('el 503 NUNCA filtra el err.message al body (NET-04)', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');

    const result = await handleWebhookRequest('{"event":"issue"}', {}, createFakeProvider(), {
      logger: null,
      dispatchTriggerFn: async () => {
        throw new Error('Plane API 503: /projects/secret-project-uuid/ — internal detail');
      },
    });

    assert.equal(result.status, 503);
    assert.equal(JSON.stringify(result.body).includes('secret-project-uuid'), false);
  });

  it('emite webhook.dispatch.retry (warn) con provider, task_ref y error truncado a 200 chars', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');
    const logger = makeSpyLogger();

    await handleWebhookRequest('{"event":"issue"}', {}, createFakeProvider(), {
      logger,
      providerName: 'plane',
      dispatchTriggerFn: async () => {
        throw new Error('Plane API 503: /projects/p/ — ' + 'x'.repeat(500));
      },
    });

    // 1) webhook.received (el evento SÍ se aceptó)  2) webhook.dispatch.retry
    assert.equal(logger.records.length, 2);
    const retry = logger.records[1];
    assert.equal(retry.event, 'webhook.dispatch.retry');
    assert.equal(retry.level, 'warn');
    // provider sale del TriggerEvent (autoritativo), igual que en webhook.received.
    assert.equal(retry.provider, 'test');
    assert.equal(retry.task_ref, 'KL-42');
    assert.ok(retry.error.length <= 200, `error truncado a 200 chars, es ${retry.error.length}`);
  });

  it('un fallo permanente NO emite webhook.dispatch.retry', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');
    const logger = makeSpyLogger();

    await handleWebhookRequest('{"event":"issue"}', {}, createFakeProvider(), {
      logger,
      providerName: 'plane',
      dispatchTriggerFn: async () => {
        throw new Error('dispatch boom');
      },
    });

    assert.equal(logger.records.length, 1);
    assert.equal(logger.records[0].event, 'webhook.received');
  });

  it('un logger que lanza no impide el 503', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');
    const exploding = {
      info: () => { throw new Error('sink caído'); },
      warn: () => { throw new Error('sink caído'); },
      error: () => { throw new Error('sink caído'); },
    };

    const result = await handleWebhookRequest('{"event":"issue"}', {}, createFakeProvider(), {
      logger: exploding,
      dispatchTriggerFn: async () => {
        throw new Error('Plane API 503: /p/ — down');
      },
    });

    assert.equal(result.status, 503);
  });

  it('dispatch lento: la ventana de gracia vence → 200 inmediato y el dispatch sigue vivo', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');
    /** @type {any} */
    let openGate;
    const gate = new Promise((r) => { openGate = r; });

    const started = Date.now();
    const result = await handleWebhookRequest('{"event":"issue"}', {}, createFakeProvider(), {
      logger: null,
      dispatchGraceMs: 30,
      dispatchTriggerFn: async () => {
        await gate;
        return { action: 'launched' };
      },
    });

    // 200 sin esperar al launch: el camino feliz JAMÁS puede agotar el timeout de Plane.
    assert.equal(result.status, 200);
    assert.ok(Date.now() - started < 1000, 'la respuesta no espera al dispatch completo');
    openGate();
    await gate;
  });

  it('un fallo transitorio TARDÍO (fuera de la ventana) no tumba el proceso ni cambia el 200', async () => {
    // Regresión del unhandled rejection: `settled` absorbe el error aunque gane el timer.
    // Sin esa absorción, el rejection tardío mataría el daemon (--unhandled-rejections=throw).
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');

    const result = await handleWebhookRequest('{"event":"issue"}', {}, createFakeProvider(), {
      logger: null,
      dispatchGraceMs: 10,
      dispatchTriggerFn: async () => {
        await new Promise((r) => setTimeout(r, 60));
        throw new Error('Plane API 503: /p/ — llegó tarde');
      },
    });

    assert.equal(result.status, 200);
    // Si el rejection tardío quedara sin manejar, el proceso moriría durante esta espera.
    await new Promise((r) => setTimeout(r, 120));
  });

  it('dispatchGraceMs:0 → fire-and-forget puro (vía de escape al contrato previo)', async () => {
    const { handleWebhookRequest } = await import('../../src/triggers/webhook.js');

    const result = await handleWebhookRequest('{"event":"issue"}', {}, createFakeProvider(), {
      logger: null,
      dispatchGraceMs: 0,
      dispatchTriggerFn: async () => {
        throw new Error('Plane API 503: /p/ — down');
      },
    });

    assert.equal(result.status, 200);
    await new Promise((r) => setTimeout(r, 10));
  });
});
