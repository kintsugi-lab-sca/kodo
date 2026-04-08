import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_PROVIDER_METHODS, VALID_PRIORITIES } from '../src/interface.js';

describe('interface contracts', () => {
  it('module imports without errors', () => {
    assert.ok(TASK_PROVIDER_METHODS);
    assert.ok(VALID_PRIORITIES);
  });

  it('TASK_PROVIDER_METHODS has the 8 exact methods', () => {
    const expected = ['init', 'getTask', 'updateTaskState', 'addComment',
      'listPendingTasks', 'parseTriggerEvent', 'verifySignature', 'resolveRef'];
    assert.deepEqual(TASK_PROVIDER_METHODS, expected);
  });

  it('VALID_PRIORITIES has the 5 normalized values', () => {
    assert.deepEqual(VALID_PRIORITIES, ['urgent', 'high', 'medium', 'low', 'none']);
  });
});
