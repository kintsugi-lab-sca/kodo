// @ts-check
//
// test/gsd-verify-cli-handler.test.js — Tests para el thin CLI handler
// `runGsdVerifyCli` de `src/cli/gsd-verify.js`.
//
// Cobertura:
//   - Exit codes 0/1/2 (Pitfall #6, Opción A): verdict pass/fail/missing/malformed → 0;
//     session not found / is not GSD → 1; provider fetch failure transient → 2.
//   - JSON output (--json) parseable; human output NO parseable como JSON.
//   - renderHuman switch exhaustivo sobre los 4 verdicts.
//   - DI: runVerifyFn mockeable, no toca filesystem real.
//   - Wiring estático en src/cli.js (CLI1..CLI4) — lectura de archivo vs spawnSync.
//
// El handler es thin: toda la lógica vive en src/gsd/verify.js (Plan 10-02).
// Aquí verificamos SOLO la capa argv → delegación → render → exit code.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runGsdVerifyCli } from '../src/cli/gsd-verify.js';

/**
 * Captures writes to stdout/stderr for assertion.
 */
function makeStdoutStub() {
  let buf = '';
  return {
    write: (s) => {
      buf += s;
    },
    get: () => buf,
  };
}

/** Shorthand builder for a pass-verdict result from runGsdVerify. */
function passResult() {
  return {
    verdict: { action: 'pass', phase_id: '10', must_haves: 8 },
    plane: { commented: true, transitioned: true },
    session: { session_id: 's1', task_ref: 'KL-42', phase_id: '10' },
  };
}

function failResult() {
  return {
    verdict: {
      action: 'fail',
      phase_id: '10',
      reason: 'gaps-found',
      detail: 'gaps_count=2',
    },
    plane: { commented: true, transitioned: false },
    session: { session_id: 's1', task_ref: 'KL-42', phase_id: '10' },
  };
}

function missingResult() {
  return {
    verdict: { action: 'missing', phase_id: '10' },
    plane: { commented: true, transitioned: false },
    session: { session_id: 's1', task_ref: 'KL-42', phase_id: '10' },
  };
}

function malformedResult() {
  return {
    verdict: {
      action: 'malformed',
      phase_id: '10',
      detail: 'missing field must_haves_total',
    },
    plane: { commented: true, transitioned: false },
    session: { session_id: 's1', task_ref: 'KL-42', phase_id: '10' },
  };
}

describe('runGsdVerifyCli — exit codes (Pitfall #6, Opción A)', () => {
  it('C1: verdict pass → exit 0 + render', async () => {
    const stdout = makeStdoutStub();
    const code = await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => passResult(),
        writeFn: stdout.write,
        errFn: () => {},
      },
    );
    assert.equal(code, 0);
    assert.match(stdout.get(), /action:\s+pass/);
    assert.match(stdout.get(), /phase_id:\s+10/);
    assert.match(stdout.get(), /must_haves:\s+8/);
    assert.match(stdout.get(), /commented=true transitioned=true/);
  });

  it('C2: verdict fail → exit 0 (gate corrió, entregó verdict)', async () => {
    const stdout = makeStdoutStub();
    const code = await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => failResult(),
        writeFn: stdout.write,
        errFn: () => {},
      },
    );
    assert.equal(code, 0);
    assert.match(stdout.get(), /action:\s+fail/);
    assert.match(stdout.get(), /reason:\s+gaps-found/);
    assert.match(stdout.get(), /detail:\s+gaps_count=2/);
    assert.match(stdout.get(), /transitioned=false/);
  });

  it('C3: verdict missing → exit 0', async () => {
    const stdout = makeStdoutStub();
    const code = await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => missingResult(),
        writeFn: stdout.write,
        errFn: () => {},
      },
    );
    assert.equal(code, 0);
    assert.match(stdout.get(), /action:\s+missing/);
    assert.match(stdout.get(), /phase_id:\s+10/);
  });

  it('C4: verdict malformed → exit 0', async () => {
    const stdout = makeStdoutStub();
    const code = await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => malformedResult(),
        writeFn: stdout.write,
        errFn: () => {},
      },
    );
    assert.equal(code, 0);
    assert.match(stdout.get(), /action:\s+malformed/);
    assert.match(stdout.get(), /detail:\s+missing field must_haves_total/);
  });

  it('C5: error "session not found" → exit 1', async () => {
    const stderr = makeStdoutStub();
    const code = await runGsdVerifyCli(
      { sessionId: 'nope' },
      {
        runVerifyFn: async () => {
          throw new Error('session not found: nope');
        },
        writeFn: () => {},
        errFn: stderr.write,
      },
    );
    assert.equal(code, 1);
    assert.match(stderr.get(), /session not found/);
  });

  it('C6: error "is not GSD" → exit 1', async () => {
    const stderr = makeStdoutStub();
    const code = await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => {
          throw new Error('session is not GSD: s1');
        },
        writeFn: () => {},
        errFn: stderr.write,
      },
    );
    assert.equal(code, 1);
    assert.match(stderr.get(), /is not GSD/);
  });

  it('C7: error "provider fetch failed" → exit 2 (transient)', async () => {
    const stderr = makeStdoutStub();
    const code = await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => {
          throw new Error('provider fetch failed: ECONNREFUSED 127.0.0.1:8000');
        },
        writeFn: () => {},
        errFn: stderr.write,
      },
    );
    assert.equal(code, 2);
    assert.match(stderr.get(), /provider fetch failed/);
  });

  it('C7b: error ETIMEDOUT también mapea a exit 2', async () => {
    const stderr = makeStdoutStub();
    const code = await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => {
          throw new Error('request failed: ETIMEDOUT');
        },
        writeFn: () => {},
        errFn: stderr.write,
      },
    );
    assert.equal(code, 2);
    assert.match(stderr.get(), /ETIMEDOUT/);
  });

  it('C7c: error network también mapea a exit 2', async () => {
    const stderr = makeStdoutStub();
    const code = await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => {
          throw new Error('network unreachable');
        },
        writeFn: () => {},
        errFn: stderr.write,
      },
    );
    assert.equal(code, 2);
  });

  it('C7d: error interno genérico → exit 1 (NO transient)', async () => {
    const stderr = makeStdoutStub();
    const code = await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => {
          throw new Error('state.json not readable');
        },
        writeFn: () => {},
        errFn: stderr.write,
      },
    );
    assert.equal(code, 1);
    assert.match(stderr.get(), /state\.json/);
  });
});

describe('runGsdVerifyCli — output format', () => {
  it('C8: --json emite JSON parseable con verdict/plane/session', async () => {
    const stdout = makeStdoutStub();
    await runGsdVerifyCli(
      { sessionId: 's1', json: true },
      {
        runVerifyFn: async () => passResult(),
        writeFn: stdout.write,
        errFn: () => {},
      },
    );
    const parsed = JSON.parse(stdout.get());
    assert.equal(parsed.verdict.action, 'pass');
    assert.equal(parsed.verdict.phase_id, '10');
    assert.equal(parsed.plane.commented, true);
    assert.equal(parsed.plane.transitioned, true);
    assert.equal(parsed.session.session_id, 's1');
  });

  it('C9: sin --json NO es JSON parseable (human-readable)', async () => {
    const stdout = makeStdoutStub();
    await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => passResult(),
        writeFn: stdout.write,
        errFn: () => {},
      },
    );
    assert.throws(() => JSON.parse(stdout.get()));
    assert.match(stdout.get(), /Verdict:/);
  });
});

describe('runGsdVerifyCli — renderHuman switch exhaustive', () => {
  it('C10.pass: incluye action/phase_id/must_haves', async () => {
    const stdout = makeStdoutStub();
    await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => passResult(),
        writeFn: stdout.write,
        errFn: () => {},
      },
    );
    const out = stdout.get();
    assert.match(out, /action:\s+pass/);
    assert.match(out, /phase_id:\s+10/);
    assert.match(out, /must_haves:\s+8/);
  });

  it('C10.fail: incluye action/phase_id/reason/detail', async () => {
    const stdout = makeStdoutStub();
    await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => failResult(),
        writeFn: stdout.write,
        errFn: () => {},
      },
    );
    const out = stdout.get();
    assert.match(out, /action:\s+fail/);
    assert.match(out, /phase_id:\s+10/);
    assert.match(out, /reason:\s+gaps-found/);
    assert.match(out, /detail:\s+gaps_count=2/);
  });

  it('C10.missing: incluye action/phase_id (sin detail)', async () => {
    const stdout = makeStdoutStub();
    await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => missingResult(),
        writeFn: stdout.write,
        errFn: () => {},
      },
    );
    const out = stdout.get();
    assert.match(out, /action:\s+missing/);
    assert.match(out, /phase_id:\s+10/);
    // renderHuman missing branch NO debe imprimir "detail:"
    assert.ok(!/detail:/.test(out.split('Verdict:')[1] || ''));
  });

  it('C10.malformed: incluye action/phase_id/detail', async () => {
    const stdout = makeStdoutStub();
    await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => malformedResult(),
        writeFn: stdout.write,
        errFn: () => {},
      },
    );
    const out = stdout.get();
    assert.match(out, /action:\s+malformed/);
    assert.match(out, /phase_id:\s+10/);
    assert.match(out, /detail:\s+missing field must_haves_total/);
  });

  it('C11: renderHuman emite línea final "Plane: commented=... transitioned=..."', async () => {
    const stdout = makeStdoutStub();
    await runGsdVerifyCli(
      { sessionId: 's1' },
      {
        runVerifyFn: async () => passResult(),
        writeFn: stdout.write,
        errFn: () => {},
      },
    );
    assert.match(stdout.get(), /Plane: commented=true transitioned=true/);
  });
});

describe('runGsdVerifyCli — DI determinismo', () => {
  it('C12: runVerifyFn se invoca exactamente una vez con sessionId', async () => {
    let callCount = 0;
    let received;
    const stdout = makeStdoutStub();
    await runGsdVerifyCli(
      { sessionId: 'abc-123' },
      {
        runVerifyFn: async (opts) => {
          callCount += 1;
          received = opts;
          return passResult();
        },
        writeFn: stdout.write,
        errFn: () => {},
      },
    );
    assert.equal(callCount, 1);
    assert.deepEqual(received, { sessionId: 'abc-123' });
  });
});

describe('src/cli.js — gsd verify subcommand registration (static)', () => {
  const cli = readFileSync('src/cli.js', 'utf-8');

  it('CLI1: registra .command("verify <session-id>")', () => {
    assert.ok(
      cli.includes(".command('verify <session-id>')"),
      "expected literal .command('verify <session-id>')",
    );
  });

  it('CLI2: importa dinámicamente ./cli/gsd-verify.js', () => {
    assert.ok(
      cli.includes("import('./cli/gsd-verify.js')"),
      "expected literal import('./cli/gsd-verify.js')",
    );
  });

  it('CLI3: invoca runGsdVerifyCli', () => {
    assert.ok(cli.includes('runGsdVerifyCli'), 'expected runGsdVerifyCli identifier');
  });

  it('CLI4: descripción documenta idempotencia (Pitfall #7)', () => {
    assert.ok(
      /idempotent|duplicates accepted/i.test(cli),
      'descripción del comando debe mencionar idempotencia',
    );
  });
});
