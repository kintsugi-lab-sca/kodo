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

  it('Test 5a: pending output uses yellow ANSI color (via formatter, TTY)', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [{ id: '1', ref: 'KL-1' }],
    });
    const { createFormatter } = await import('../src/cli/format.js');

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
      // env={} so the test does not inherit NO_COLOR / FORCE_COLOR=0 from the caller.
      formatterFn: () => createFormatter({ isTTY: true }, {}),
    });

    assert.match(
      result.lines.join('\n'),
      /\x1b\[33m/,
      'Expected yellow (\\x1b[33m) for pending warning',
    );
  });

  it('Test 5b: error output uses red ANSI color (via formatter, TTY)', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => {
        throw new Error('boom');
      },
    });
    const { createFormatter } = await import('../src/cli/format.js');

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
      formatterFn: () => createFormatter({ isTTY: true }, {}),
    });

    assert.match(
      result.lines.join('\n'),
      /\x1b\[31m/,
      'Expected red (\\x1b[31m) for error',
    );
  });

  it('Test 5d: no ANSI escapes when formatter is non-TTY (NO_COLOR-equivalent)', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [{ id: '1', ref: 'KL-1' }],
    });
    const { createFormatter } = await import('../src/cli/format.js');

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
      formatterFn: () => createFormatter({ isTTY: false }, {}),
    });

    const out = result.lines.join('\n');
    assert.doesNotMatch(out, /\x1b\[/, 'No ANSI escapes expected with isTTY=false');
    assert.match(
      out,
      /\[kodo:check\] 1 pending kodo task\(s\)/,
      'Plain text shape preserved',
    );
  });

  it('Test 5d-error: no ANSI escapes for error path when non-TTY', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => {
        throw new Error('boom');
      },
    });
    const { createFormatter } = await import('../src/cli/format.js');

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
      formatterFn: () => createFormatter({ isTTY: false }, {}),
    });

    const out = result.lines.join('\n');
    assert.doesNotMatch(out, /\x1b\[/, 'No ANSI escapes expected with isTTY=false');
    assert.match(
      out,
      /\[kodo:check\] Error checking tasks: boom/,
      'Plain text error shape preserved',
    );
  });

  // Phase 76 Plan 02 (ORCH-05 / D-07): after routing through fetchFreshPending the sane
  // `/N pending/` line must stay byte-identical, and the red error line must still carry
  // the REAL err.message (fetchFreshPending propagates the throw raw — no wrapping).
  it('ORCH-05: routes through fetchFreshPending, sane /N pending/ line byte-identical', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [{ id: '1', ref: 'KL-1' }, { id: '2', ref: 'KL-2' }],
    });

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
    });

    const out = result.lines.join('\n');
    assert.match(out, /\[kodo:check\] 2 pending kodo task\(s\), 3 slot\(s\) available/);
    assert.ok(
      result.reasons.some((r) => r.includes('2 tarea')),
      `Expected reasons to include "2 tarea", got: ${JSON.stringify(result.reasons)}`,
    );
  });

  it('ORCH-05/D-07: fetchFreshPending propagates the throw — real err.message in red line', async () => {
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

    assert.match(
      result.lines.join('\n'),
      /\[kodo:check\] Error checking tasks: network down/,
      'real err.message must survive fetchFreshPending (raw propagation, D-07)',
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

  it('Test 5c: imports createFormatter from ./cli/format.js (Phase 15 wiring)', () => {
    const source = readFileSync(CHECK_SOURCE_PATH, 'utf-8');
    assert.match(
      source,
      /import \{ createFormatter \} from ['"]\.\/cli\/format\.js['"]/,
      'check.js must import createFormatter from ./cli/format.js',
    );
  });

  it('Test 5c: contains no ANSI inline literals (D-09 cleanup)', () => {
    const source = readFileSync(CHECK_SOURCE_PATH, 'utf-8');
    assert.doesNotMatch(
      source,
      /ANSI_(YELLOW|RED|RESET)/,
      'check.js must not declare ANSI_* literals (use formatter instead)',
    );
    assert.doesNotMatch(
      source,
      /\\x1b\[/,
      'check.js must not contain raw \\x1b ANSI escapes (use formatter instead)',
    );
  });

  it('Test 5e: All clear path uses fmt.ok with ✓-leading order (D-10 byte-order change)', () => {
    // runCheck() does not accept formatterFn DI (Option A — fmt local). The visible
    // ✓-leading bytes are produced by `fmt.ok('All clear')` in src/check.js, which
    // expands to `${OK_SYMBOL} ${pc.green(s)}` per format.js:165.
    // Color (green) is covered by test/format.test.js Phase 14; here we only assert
    // the source uses fmt.ok and that the pre-Phase-15 trailing-✓ shape is gone.
    const source = readFileSync(CHECK_SOURCE_PATH, 'utf-8');
    assert.match(
      source,
      /fmt\.ok\(['"]All clear['"]\)/,
      'check.js must call fmt.ok(\'All clear\') (✓ is prepended by the helper)',
    );
    assert.doesNotMatch(
      source,
      /All clear ✓/,
      'Pre-Phase-15 trailing-✓ shape must be gone',
    );
  });
});
