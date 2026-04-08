// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_PROVIDER_METHODS } from '../src/interface.js';

/** @type {import('../src/providers/registry.js')['getProvider']} */
let getProvider;
/** @type {import('../src/providers/registry.js')['registerProvider']} */
let registerProvider;
/** @type {import('../src/providers/registry.js')['clearRegistry']} */
let clearRegistry;

/**
 * Create a fake TaskProvider with all required methods as no-ops.
 * @returns {Record<string, Function>}
 */
function createFakeProvider() {
  const provider = {};
  for (const method of TASK_PROVIDER_METHODS) {
    provider[method] = () => {};
  }
  return provider;
}

describe('Provider Registry', () => {
  beforeEach(async () => {
    ({ getProvider, registerProvider, clearRegistry } = await import('../src/providers/registry.js'));
    clearRegistry();
  });

  it('getProvider returns registered provider', () => {
    registerProvider('test', () => createFakeProvider());
    const provider = getProvider('test');
    for (const method of TASK_PROVIDER_METHODS) {
      assert.equal(typeof provider[method], 'function', `Missing method: ${method}`);
    }
  });

  it('getProvider caches instances (singleton)', () => {
    registerProvider('test', () => createFakeProvider());
    const first = getProvider('test');
    const second = getProvider('test');
    assert.equal(first, second, 'Expected same instance (singleton)');
  });

  it('getProvider throws for unknown provider', () => {
    assert.throws(
      () => getProvider('nonexistent'),
      { message: /Unknown provider: nonexistent/ },
    );
  });

  it('registerProvider validates interface compliance', () => {
    registerProvider('bad', () => {
      // Missing 'init' method
      const provider = {};
      for (const method of TASK_PROVIDER_METHODS.slice(1)) {
        provider[method] = () => {};
      }
      return provider;
    });
    assert.throws(
      () => getProvider('bad'),
      { message: /missing method: init/i },
    );
  });

  it('clearRegistry resets cache', () => {
    let callCount = 0;
    registerProvider('test', () => {
      callCount++;
      return createFakeProvider();
    });
    getProvider('test');
    assert.equal(callCount, 1);
    clearRegistry();
    registerProvider('test', () => {
      callCount++;
      return createFakeProvider();
    });
    getProvider('test');
    assert.equal(callCount, 2, 'Expected new factory call after clearRegistry');
  });
});
