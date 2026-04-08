// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { TASK_PROVIDER_METHODS } from '../src/interface.js';

/** @type {import('../src/providers/plane/provider.js')['createPlaneProvider']} */
let createPlaneProvider;

const MOCK_CONFIG = {
  baseUrl: 'https://test.example.com',
  apiKey: 'test-key',
  workspaceSlug: 'test',
  projects: [{ id: 'proj-uuid', identifier: 'TST', name: 'Test' }],
  states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
  webhookSecret: 'test-secret',
};

describe('PlaneProvider', () => {
  beforeEach(async () => {
    ({ createPlaneProvider } = await import('../src/providers/plane/provider.js'));
  });

  it('createPlaneProvider returns object with all TaskProvider methods', () => {
    const provider = createPlaneProvider(MOCK_CONFIG);
    for (const method of TASK_PROVIDER_METHODS) {
      assert.equal(typeof provider[method], 'function', `Missing method: ${method}`);
    }
  });

  it('verifySignature returns true for valid HMAC', () => {
    const provider = createPlaneProvider(MOCK_CONFIG);
    const payload = '{"event":"issue","action":"update"}';
    const expected = createHmac('sha256', 'test-secret').update(payload).digest('hex');
    const result = provider.verifySignature(payload, { 'x-plane-signature': expected });
    assert.equal(result, true);
  });

  it('verifySignature returns false for invalid signature', () => {
    const provider = createPlaneProvider(MOCK_CONFIG);
    const payload = '{"event":"issue","action":"update"}';
    const result = provider.verifySignature(payload, { 'x-plane-signature': 'deadbeef' });
    assert.equal(result, false);
  });

  it('verifySignature returns false for missing signature', () => {
    const provider = createPlaneProvider(MOCK_CONFIG);
    const payload = '{"event":"issue","action":"update"}';
    const result = provider.verifySignature(payload, {});
    assert.equal(result, false);
  });

  it('verifySignature returns false for missing secret', () => {
    const configNoSecret = { ...MOCK_CONFIG, webhookSecret: undefined };
    const provider = createPlaneProvider(configNoSecret);
    const payload = '{"event":"issue","action":"update"}';
    const result = provider.verifySignature(payload, { 'x-plane-signature': 'anything' });
    assert.equal(result, false);
  });
});
