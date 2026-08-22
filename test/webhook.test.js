// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Build a fake TaskProvider for webhook tests.
 * @param {Partial<import('../src/interface.js').TaskProvider>} overrides
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
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');

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
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');

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
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');

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
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');

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
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');

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
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');

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
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');

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
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
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
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
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
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
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
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
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
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
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
    const { handleWebhookRequest } = await import('../src/triggers/webhook.js');
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
