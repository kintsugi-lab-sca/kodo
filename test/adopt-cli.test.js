// @ts-check
//
// test/adopt-cli.test.js — Tests para el thin CLI handler `runAdoptCli`
// de `src/cli/adopt.js` (Phase 54, BIDIR-07).
//
// El handler es thin: TODA la lógica de negocio vive en `src/adopt.js`
// (`adoptSession`, Phase 53). Aquí verificamos SOLO la capa
// argv → resolución provider/projectPath → delegación → render → exit code.
//
// Cobertura (espejo de test/gsd-verify-cli-handler.test.js):
//   - Las 6 shapes del discriminante de adoptSession → exit codes (D-02):
//       ok:true → 0, ALREADY_ADOPTED → 0, INVALID_INPUT → 1, UNSUPPORTED → 1,
//       PERSIST_FAILED → 1, CREATE_FAILED → 2.
//   - Render éxito (task_id + task_url + session_id en stdout).
//   - PERSIST_FAILED LOUD en STDERR (vía errFn stub), NO en stdout.
//   - --json byte-determinista = JSON.stringify(result, null, 2) + '\n',
//     parseable, SIN ANSI aun con un formatter TTY inyectado.
//   - --project no mapeado → exit 1 + lista de projectIds en stderr;
//     adoptSessionFn NUNCA invocado (fail-fast pre-POST).
//   - Wiring estático en src/cli.js (command('adopt') + import + runAdoptCli).
//
// DI: cada test inyecta deps (adoptSessionFn, getProviderFn, loadProjectsFn,
// writeFn/errFn, formatterFn) → cero I/O real (state.json, registry, network).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runAdoptCli } from '../src/cli/adopt.js';

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

// --- Inline discriminant builders (mirror passResult/failResult de gsd-verify) ---

/** ok:true — task creada + fila sembrada. */
function okResult() {
  return {
    ok: true,
    task: { id: 'T-1', url: 'https://plane.example/T-1' },
    session: { session_id: 'S-1' },
  };
}

function alreadyAdoptedResult() {
  return { ok: false, code: 'ALREADY_ADOPTED', detail: { task_id: 'T-9' } };
}

function invalidInputResult() {
  return { ok: false, code: 'INVALID_INPUT', detail: { missing: ['cwd', 'sessionId'] } };
}

function unsupportedResult() {
  return { ok: false, code: 'UNSUPPORTED', detail: { providerName: 'github' } };
}

function persistFailedResult() {
  return {
    ok: false,
    code: 'PERSIST_FAILED',
    detail: {
      task_id: 'T-7',
      task_url: 'https://plane.example/T-7',
      hint: 'Re-run kodo adopt; createTask is idempotent on re-adopt.',
      message: 'EACCES: state.json not writable',
    },
  };
}

function createFailedResult() {
  return { ok: false, code: 'CREATE_FAILED', detail: { message: 'POST 503 Service Unavailable' } };
}

/** Standard happy-path opts shared by most tests. */
const OPTS = { workspaceRef: 'W', cwd: '/tmp/proj', sessionId: 'S', projectId: 'P' };

/** Standard stub deps that resolve provider + projectPath without real I/O. */
function baseDeps(overrides = {}) {
  return {
    getProviderFn: () => ({ createTask: () => {} }),
    loadProjectsFn: () => ({ P: '/tmp/proj' }),
    errFn: () => {},
    writeFn: () => {},
    ...overrides,
  };
}

describe('runAdoptCli — exit codes (D-02, Opción A)', () => {
  it('A1: ok:true → exit 0 + task_id/task_url/session_id en stdout', async () => {
    const out = makeStdoutStub();
    let received;
    const code = await runAdoptCli(
      OPTS,
      baseDeps({
        adoptSessionFn: async (args) => {
          received = args;
          return okResult();
        },
        writeFn: out.write,
      }),
    );
    assert.equal(code, 0);
    assert.match(out.get(), /task_id:\s+T-1/);
    assert.match(out.get(), /task_url:\s+https:\/\/plane\.example\/T-1/);
    assert.match(out.get(), /session_id:\s+S-1/);
    // projectPath resuelto y pasado al core.
    assert.equal(received.projectPath, '/tmp/proj');
    assert.equal(received.projectId, 'P');
    assert.equal(received.workspaceRef, 'W');
    assert.equal(received.sessionId, 'S');
  });

  it('A2: ALREADY_ADOPTED → exit 0 (idempotente, no-op) con el task_id existente', async () => {
    const out = makeStdoutStub();
    const code = await runAdoptCli(
      OPTS,
      baseDeps({
        adoptSessionFn: async () => alreadyAdoptedResult(),
        writeFn: out.write,
      }),
    );
    assert.equal(code, 0);
    assert.match(out.get(), /T-9/);
    assert.match(out.get(), /no-op|already adopted|ya adoptada/i);
  });

  it('A3: INVALID_INPUT → exit 1 + render del detail.missing', async () => {
    const err = makeStdoutStub();
    const code = await runAdoptCli(
      OPTS,
      baseDeps({
        adoptSessionFn: async () => invalidInputResult(),
        errFn: err.write,
      }),
    );
    assert.equal(code, 1);
    assert.match(err.get(), /INVALID_INPUT/);
    assert.match(err.get(), /cwd/);
    assert.match(err.get(), /sessionId/);
  });

  it('A4: UNSUPPORTED → exit 1 + providerName', async () => {
    const err = makeStdoutStub();
    const code = await runAdoptCli(
      OPTS,
      baseDeps({
        adoptSessionFn: async () => unsupportedResult(),
        errFn: err.write,
      }),
    );
    assert.equal(code, 1);
    assert.match(err.get(), /UNSUPPORTED/);
    assert.match(err.get(), /github/);
  });

  it('A5: PERSIST_FAILED → exit 1 + banner LOUD en STDERR (task_id+task_url+hint), NO en stdout', async () => {
    const out = makeStdoutStub();
    const err = makeStdoutStub();
    const code = await runAdoptCli(
      OPTS,
      baseDeps({
        adoptSessionFn: async () => persistFailedResult(),
        writeFn: out.write,
        errFn: err.write,
      }),
    );
    assert.equal(code, 1);
    assert.match(err.get(), /PERSIST_FAILED/);
    assert.match(err.get(), /T-7/);
    assert.match(err.get(), /https:\/\/plane\.example\/T-7/);
    assert.match(err.get(), /idempotent|Re-run/i);
    // El banner NO debe ir a stdout.
    assert.doesNotMatch(out.get(), /PERSIST_FAILED/);
    assert.doesNotMatch(out.get(), /T-7/);
  });

  it('A6: CREATE_FAILED → exit 2 (transient)', async () => {
    const err = makeStdoutStub();
    const code = await runAdoptCli(
      OPTS,
      baseDeps({
        adoptSessionFn: async () => createFailedResult(),
        errFn: err.write,
      }),
    );
    assert.equal(code, 2);
    assert.match(err.get(), /CREATE_FAILED/);
    assert.match(err.get(), /503/);
  });
});

describe('runAdoptCli — --json byte-determinismo', () => {
  it('JSON1: --json emite JSON.stringify(result,null,2)+\\n, parseable, SIN ANSI aun con formatter TTY', async () => {
    const { createFormatter } = await import('../src/cli/format.js');
    const out = makeStdoutStub();
    const result = okResult();
    const code = await runAdoptCli(
      { ...OPTS, json: true },
      baseDeps({
        adoptSessionFn: async () => result,
        writeFn: out.write,
        formatterFn: () => createFormatter({ isTTY: true }, {}),
      }),
    );
    assert.equal(code, 0);
    const raw = out.get();
    // Byte-igual al stringify del core.
    assert.equal(raw, JSON.stringify(result, null, 2) + '\n');
    // Parseable.
    const parsed = JSON.parse(raw);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.task.id, 'T-1');
    assert.equal(parsed.session.session_id, 'S-1');
    // SIN ANSI aun con TTY inyectado (bypass total de renderHuman).
    assert.doesNotMatch(raw, /\x1b\[/);
  });

  it('JSON2: --json sobre un fallo respeta el exit-code map (CREATE_FAILED→2)', async () => {
    const out = makeStdoutStub();
    const result = createFailedResult();
    const code = await runAdoptCli(
      { ...OPTS, json: true },
      baseDeps({
        adoptSessionFn: async () => result,
        writeFn: out.write,
      }),
    );
    assert.equal(code, 2);
    assert.equal(out.get(), JSON.stringify(result, null, 2) + '\n');
  });
});

describe('runAdoptCli — projectPath fail-fast (T-54-02)', () => {
  it('C12: --project no mapeado → exit 1 + lista de projectIds; adoptSessionFn NUNCA invocado', async () => {
    const err = makeStdoutStub();
    let adoptCalls = 0;
    const code = await runAdoptCli(
      OPTS,
      baseDeps({
        loadProjectsFn: () => ({ OTHER: '/tmp/other', SECOND: '/tmp/second' }),
        adoptSessionFn: async () => {
          adoptCalls += 1;
          return okResult();
        },
        errFn: err.write,
      }),
    );
    assert.equal(code, 1);
    assert.equal(adoptCalls, 0, 'adoptSession NO debe invocarse — fail-fast pre-POST');
    assert.match(err.get(), /No local path mapped/i);
    // Lista de projectIds disponibles.
    assert.match(err.get(), /OTHER/);
    assert.match(err.get(), /SECOND/);
  });

  it('C12b: --project mapeado a string resuelve projectPath y SÍ invoca adoptSession', async () => {
    let received;
    const code = await runAdoptCli(
      { ...OPTS, projectId: 'MAPPED' },
      baseDeps({
        loadProjectsFn: () => ({ MAPPED: '/tmp/mapped' }),
        adoptSessionFn: async (args) => {
          received = args;
          return okResult();
        },
      }),
    );
    assert.equal(code, 0);
    assert.equal(received.projectPath, '/tmp/mapped');
  });
});

describe('src/cli.js — adopt command registration (static)', () => {
  const cli = readFileSync('src/cli.js', 'utf-8');

  it('CLI1: registra .command("adopt")', () => {
    assert.ok(cli.includes("command('adopt')"), "expected literal command('adopt')");
  });

  it('CLI2: importa dinámicamente ./cli/adopt.js', () => {
    assert.ok(
      cli.includes("import('./cli/adopt.js')"),
      "expected literal import('./cli/adopt.js')",
    );
  });

  it('CLI3: invoca runAdoptCli', () => {
    assert.ok(cli.includes('runAdoptCli'), 'expected runAdoptCli identifier');
  });
});
