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
