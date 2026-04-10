// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkPendingTasks } from '../src/check.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECK_SOURCE_PATH = join(__dirname, '..', 'src', 'check.js');

/**
 * Build a fake provider with all TaskProvider methods. Only listPendingTasks is
 * meaningfully overridden for each test.
 * @param {{ listPendingTasks?: () => Promise<any[]> }} overrides
 */
function createFakeProvider(overrides = {}) {
  return {
    init: async () => {},
    getTask: async () => ({}),
    updateTaskState: async () => {},
    addComment: async () => {},
    listPendingTasks: overrides.listPendingTasks || (async () => []),
    parseTriggerEvent: () => null,
    verifySignature: () => false,
    resolveRef: async () => '',
  };
}

const BASE_CONFIG = {
  provider: 'test',
  providers: { test: {} },
  claude: { max_parallel: 3 },
};

describe('check.js — checkPendingTasks (pure)', () => {
  it('Test 1: calls provider.listPendingTasks() and reports count when pending > 0 and slots available', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [
        { id: '1', ref: 'KL-1' },
        { id: '2', ref: 'KL-2' },
      ],
    });

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 1,
      getProviderFn: () => provider,
    });

    assert.match(result.lines.join('\n'), /2 pending/);
    assert.ok(
      result.reasons.some((r) => r.includes('2 tarea')),
      `Expected reasons to include "2 tarea", got: ${JSON.stringify(result.reasons)}`,
    );
  });

  it('does not add reasons when no slots available', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [{ id: '1', ref: 'KL-1' }],
    });

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 3, // max_parallel reached
      getProviderFn: () => provider,
    });

    assert.equal(result.reasons.length, 0);
  });

  it('does not add reasons when no pending tasks', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [],
    });

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
    });

    assert.equal(result.reasons.length, 0);
  });

  it('Test 3: handles provider error gracefully (no throw, includes error in output)', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => {
        throw new Error('network down');
      },
    });

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
    });

    const output = result.lines.join('\n');
    assert.match(output, /Error checking tasks/);
    assert.match(output, /network down/);
  });

  it('Test 4: skips pending check when provider not configured (no crash)', async () => {
    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => {
        throw new Error('Unknown provider: test');
      },
    });

    // Should return gracefully with an error line, not throw
    assert.ok(result);
    assert.equal(result.reasons.length, 0);
    assert.match(result.lines.join('\n'), /Error checking tasks/);
  });

  it('Test 5a: pending output uses yellow ANSI color', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [{ id: '1', ref: 'KL-1' }],
    });

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
    });

    assert.match(
      result.lines.join('\n'),
      /\x1b\[33m/,
      'Expected yellow (\\x1b[33m) for pending warning',
    );
  });

  it('Test 5b: error output uses red ANSI color', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => {
        throw new Error('boom');
      },
    });

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
    });

    assert.match(
      result.lines.join('\n'),
      /\x1b\[31m/,
      'Expected red (\\x1b[31m) for error',
    );
  });
});

describe('check.js — source invariants', () => {
  it('Test 2: source file does NOT import or reference PlaneClient', () => {
    const source = readFileSync(CHECK_SOURCE_PATH, 'utf-8');
    assert.ok(
      !source.includes('PlaneClient'),
      'check.js must not reference PlaneClient',
    );
    assert.ok(
      !source.includes("from './plane/client.js'"),
      'check.js must not import from ./plane/client.js',
    );
  });

  it('imports initRegistry and getProvider from providers/registry.js', () => {
    const source = readFileSync(CHECK_SOURCE_PATH, 'utf-8');
    assert.match(source, /initRegistry/, 'check.js must reference initRegistry');
    assert.match(source, /getProvider/, 'check.js must reference getProvider');
    assert.match(
      source,
      /from ['"]\.\/providers\/registry\.js['"]/,
      'check.js must import from ./providers/registry.js',
    );
  });
});
