// @ts-check
// Phase 41 Plan 03: cobertura hermética DI del handler CLI `kodo gsd doctor`.
//
// Espejo del estilo de gsd-inspect-cli.test.js: scanFn/executeFn/writeFn/errFn/
// formatterFn 100% inyectados, CERO disco real, CERO spawn. Verifica:
//   - exit code 0/1 (hasGarbage), dry-run NUNCA llama executeFn, --fix llama
//     executeFn exactamente UNA vez DESPUÉS de scan
//   - protected (recursos vivos) NO afecta al exit code (D-09)
//   - --json byte-determinista idéntico TTY/no-TTY (D-01, DX-06)
//   - render humano agrupa las 4 categorías con la acción exacta por item (D-08)
//   - source-hygiene: el handler no importa picocolors (color isolation)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { runGsdDoctor } from '../src/cli/gsd-doctor.js';
import { createFormatter } from '../src/cli/format.js';

/** Captura las strings escritas. */
function makeStdoutStub() {
  let buf = '';
  return {
    write: (s) => { buf += s; },
    get: () => buf,
  };
}

/** Formatter NO_COLOR fixture — cero ANSI. */
function nocolorFormatter() {
  return createFormatter({ isTTY: false }, /** @type {any} */ ({}));
}

/** Report limpio (nada que sanear). */
function cleanReport() {
  return {
    worktrees: [],
    zombies: [],
    locks: [],
    logs: [],
    protected: { sessions: [], locks: [] },
    hasGarbage: false,
  };
}

/** Report con basura en las 4 categorías. */
function garbageReport() {
  return {
    worktrees: [{ id: 's1', path: '/repo/.bg-shell/s1', action: 'remove', reason: 'no live session' }],
    zombies: [{ id: 't2', path: '/repo/.bg-shell/s2', action: 'remove-session', reason: 'alive===false' }],
    locks: [{ id: 's3', path: '/repo/.planning/.kodo.lock', action: 'steal', reason: 'PID 999999 dead' }],
    logs: [{ id: 's4', path: '/home/.kodo/logs/s4.ndjson', action: 'unlink', reason: 'mtime > 7d' }],
    protected: { sessions: [], locks: [] },
    hasGarbage: true,
  };
}

/** Result de execute por defecto (nada ejecutado). */
function emptyResult() {
  return {
    worktrees: { removed: 0, moved: 0, pruned: 0, skipped: 0 },
    zombies: { removed: 0 },
    locks: { stolen: 0, kept: 0 },
    logs: { unlinked: 0 },
    errors: [],
  };
}

describe('runGsdDoctor — exit code (D-03)', () => {
  it('clean state → returns 0', async () => {
    const stdout = makeStdoutStub();
    const code = await runGsdDoctor({}, {
      scanFn: () => cleanReport(),
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    assert.equal(code, 0);
    assert.match(stdout.get(), /clean/, 'clean verdict rendered');
  });

  it('garbage present → returns 1', async () => {
    const stdout = makeStdoutStub();
    const code = await runGsdDoctor({}, {
      scanFn: () => garbageReport(),
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    assert.equal(code, 1);
    assert.match(stdout.get(), /garbage found/, 'garbage verdict rendered');
  });

  it('live-only state (only protected, no garbage) → returns 0 (D-09: protected never affects exit)', async () => {
    const stdout = makeStdoutStub();
    const report = cleanReport();
    report.protected.sessions.push({ id: 's-live', path: '/repo/.bg-shell/s-live', action: 'keep', reason: 'session alive' });
    report.protected.locks.push({ id: 's-live', path: '/repo/.planning/.kodo.lock', action: 'keep', reason: 'PID alive, TTL ok' });
    // hasGarbage stays false even with protected resources present.
    const code = await runGsdDoctor({}, {
      scanFn: () => report,
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    assert.equal(code, 0, 'protected resources must NOT bump exit to 1');
    assert.match(stdout.get(), /protected: 1 live sessions \/ 1 active locks/, 'protected summary rendered');
  });
});

describe('runGsdDoctor — dry-run vs --fix (D-03/D-07)', () => {
  it('dry-run (fix:false) NEVER calls executeFn', async () => {
    let executeCalls = 0;
    const code = await runGsdDoctor({}, {
      scanFn: () => garbageReport(),
      executeFn: async () => { executeCalls++; return emptyResult(); },
      writeFn: () => {},
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    assert.equal(code, 1);
    assert.equal(executeCalls, 0, 'executeFn must not run without --fix');
  });

  it('--fix calls executeFn exactly once AFTER scan', async () => {
    const order = [];
    const result = emptyResult();
    result.worktrees.removed = 1;
    result.locks.stolen = 1;
    result.logs.unlinked = 1;
    result.zombies.removed = 1;
    const stdout = makeStdoutStub();
    const code = await runGsdDoctor({ fix: true }, {
      scanFn: () => { order.push('scan'); return garbageReport(); },
      executeFn: async (deps, opts) => {
        order.push('execute');
        assert.equal(opts.fix, true, 'execute must be called with {fix:true}');
        return result;
      },
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    assert.equal(code, 1, 'exit code still derives from scan().hasGarbage');
    assert.deepEqual(order, ['scan', 'execute'], 'scan must run before execute, execute exactly once');
    const out = stdout.get();
    assert.match(out, /executed/, 'executed section rendered under --fix');
    assert.match(out, /worktrees: 1 removed/, 'execute result rendered');
    assert.match(out, /logs:\s+1 unlinked/, 'log result rendered');
  });

  it('--fix surfaces execute errors in the render', async () => {
    const result = emptyResult();
    result.errors.push({ category: 'worktree', target: '/repo/.bg-shell/s1', reason: 'git remove failed' });
    const stdout = makeStdoutStub();
    await runGsdDoctor({ fix: true }, {
      scanFn: () => garbageReport(),
      executeFn: async () => result,
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    const out = stdout.get();
    assert.match(out, /errors \(1\)/, 'errors header rendered');
    assert.match(out, /git remove failed/, 'error reason rendered');
  });
});

describe('runGsdDoctor — --json byte-determinism (D-01 / DX-06)', () => {
  it('--json output is valid JSON and is the serialized scan report', async () => {
    const stdout = makeStdoutStub();
    const report = garbageReport();
    const code = await runGsdDoctor({ json: true }, {
      scanFn: () => report,
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    assert.equal(code, 1);
    const parsed = JSON.parse(stdout.get());
    assert.equal(parsed.hasGarbage, true);
    assert.equal(parsed.worktrees[0].id, 's1');
    assert.equal(parsed.locks[0].action, 'steal');
    // No human framing in JSON mode.
    assert.doesNotMatch(stdout.get(), /Worktrees huérfanos/, 'no human render in JSON mode');
  });

  it('--json is identical regardless of stream.isTTY (byte-determinism)', async () => {
    const report = garbageReport();
    const ttyOut = makeStdoutStub();
    const nonTtyOut = makeStdoutStub();
    await runGsdDoctor({ json: true }, {
      scanFn: () => report,
      writeFn: ttyOut.write,
      errFn: () => {},
      formatterFn: () => createFormatter({ isTTY: true }, /** @type {any} */ ({ FORCE_COLOR: '1' })),
    });
    await runGsdDoctor({ json: true }, {
      scanFn: () => report,
      writeFn: nonTtyOut.write,
      errFn: () => {},
      formatterFn: () => createFormatter({ isTTY: false }, /** @type {any} */ ({})),
    });
    assert.equal(ttyOut.get(), nonTtyOut.get(), 'JSON bytes must be identical TTY vs non-TTY');
    // And contain zero ANSI escapes.
    assert.doesNotMatch(ttyOut.get(), /\x1b\[/, 'JSON must contain no ANSI escapes');
  });

  it('--json under --fix merges the execute result under `executed`', async () => {
    const stdout = makeStdoutStub();
    const result = emptyResult();
    result.worktrees.removed = 2;
    await runGsdDoctor({ json: true, fix: true }, {
      scanFn: () => garbageReport(),
      executeFn: async () => result,
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    const parsed = JSON.parse(stdout.get());
    assert.equal(parsed.hasGarbage, true);
    assert.equal(parsed.executed.worktrees.removed, 2, 'execute result merged under executed');
  });
});

describe('runGsdDoctor — human render groups 4 categories with exact action (D-08)', () => {
  it('renders each category header + per-item exact action', async () => {
    const stdout = makeStdoutStub();
    await runGsdDoctor({}, {
      scanFn: () => garbageReport(),
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    const out = stdout.get();
    assert.match(out, /Worktrees huérfanos \(1\)/, 'worktree category header');
    assert.match(out, /worktree remove — s1/, 'exact worktree action per item');
    assert.match(out, /Sesiones zombie \(1\)/, 'zombie category header');
    assert.match(out, /remove-session — t2/, 'exact zombie action');
    assert.match(out, /Locks colgados \(1\)/, 'lock category header');
    assert.match(out, /lock steal — s3/, 'exact lock action');
    assert.match(out, /Logs antiguos \(1\)/, 'log category header');
    assert.match(out, /log unlink — s4/, 'exact log action');
  });

  it('renders "none" for empty categories', async () => {
    const stdout = makeStdoutStub();
    await runGsdDoctor({}, {
      scanFn: () => cleanReport(),
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    const out = stdout.get();
    assert.match(out, /Worktrees huérfanos: none/, 'empty worktree category shows none');
    assert.match(out, /Locks colgados: none/, 'empty lock category shows none');
  });
});

describe('runGsdDoctor — source hygiene', () => {
  it('handler imports no picocolors directly (color isolation)', () => {
    const src = readFileSync(new URL('../src/cli/gsd-doctor.js', import.meta.url), 'utf-8');
    assert.ok(!/picocolors/.test(src), 'gsd-doctor.js must not import picocolors');
  });

  it('exports runGsdDoctor', async () => {
    const mod = await import('../src/cli/gsd-doctor.js');
    assert.equal(typeof mod.runGsdDoctor, 'function', 'runGsdDoctor must be exported');
  });
});
