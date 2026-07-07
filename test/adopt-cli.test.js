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
import { runAdoptCli, resolveProjectPath } from '../src/cli/adopt.js';
import { adoptSession } from '../src/adopt.js';

describe('resolveProjectPath — project_path = ancestro más cercano del cwd (UAT 2026-06-19)', () => {
  const roman = {
    default: '/Users/alex/dev/roman/fvf',
    modules: { OptiAI: '/Users/alex/dev/roman/optiai', WAG: '/Users/alex/dev/roman/wag/app' },
  };
  it('cwd en un módulo → path del módulo (no el default)', () => {
    assert.equal(resolveProjectPath('/Users/alex/dev/roman/optiai', roman), '/Users/alex/dev/roman/optiai');
  });
  it('cwd en subdir de un módulo → path del módulo', () => {
    assert.equal(resolveProjectPath('/Users/alex/dev/roman/optiai/src', roman), '/Users/alex/dev/roman/optiai');
  });
  it('cwd en el default → default', () => {
    assert.equal(resolveProjectPath('/Users/alex/dev/roman/fvf', roman), '/Users/alex/dev/roman/fvf');
  });
  it('cwd sin match → fallback al default', () => {
    assert.equal(resolveProjectPath('/tmp/elsewhere', roman), '/Users/alex/dev/roman/fvf');
  });
  it('entrada string plana → tal cual', () => {
    assert.equal(resolveProjectPath('/Users/alex/dev/klab/kodo/sub', '/Users/alex/dev/klab/kodo'), '/Users/alex/dev/klab/kodo');
  });
  it('cwd no-string / modules basura → no lanza, cae al default', () => {
    assert.equal(resolveProjectPath(undefined, roman), '/Users/alex/dev/roman/fvf');
    assert.equal(resolveProjectPath('/x', { default: '/d', modules: { bad: 123 } }), '/d');
  });
});

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

/** ok:true con un TaskItem completo (ref + title) — usado por los tests de liveness rename (Phase 59). */
function okResultWithRef() {
  return {
    ok: true,
    task: { id: 'T-1', ref: 'ROMAN-192', title: 'Casual chat session', url: 'https://plane.example/T-1' },
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

describe('runAdoptCli — module auto-derive from cwd (Phase 57 module-placement gap-fix)', () => {
  /** Capture the args passed to adoptSession. */
  function capturingDeps(projects, extra = {}) {
    let received;
    const deps = baseDeps({
      loadProjectsFn: () => projects,
      adoptSessionFn: async (args) => {
        received = args;
        return okResult();
      },
      ...extra,
    });
    return { deps, get: () => received };
  }

  it('M1: derives the module NAME from cwd against the project modules map (nearest ancestor)', async () => {
    const { deps, get } = capturingDeps({
      ROMAN: { default: '/Users/op/dev/roman', modules: { FVF: '/Users/op/dev/roman/fvf' } },
    });
    const code = await runAdoptCli(
      { ...OPTS, projectId: 'ROMAN', cwd: '/Users/op/dev/roman/fvf/sub' },
      deps,
    );
    assert.equal(code, 0);
    assert.equal(get().module, 'FVF', 'cwd under the FVF module path → module FVF');
    // UAT 2026-06-19: projectPath = ancestro más cercano del cwd (el path del módulo FVF),
    // NO el default ciego — para que la columna repo del dashboard y la resolución de plan
    // apunten al sitio real (ROMAN-192 salía como fvf estando en optiai).
    assert.equal(get().projectPath, '/Users/op/dev/roman/fvf');
  });

  it('M2: explicit --module overrides the derived value', async () => {
    const { deps, get } = capturingDeps({
      ROMAN: { default: '/Users/op/dev/roman', modules: { FVF: '/Users/op/dev/roman/fvf' } },
    });
    const code = await runAdoptCli(
      { ...OPTS, projectId: 'ROMAN', cwd: '/Users/op/dev/roman/fvf/sub', module: 'OVERRIDE' },
      deps,
    );
    assert.equal(code, 0);
    assert.equal(get().module, 'OVERRIDE', 'explicit flag wins over auto-derive');
  });

  it('M3: flat-string project entry → no module (key omitted)', async () => {
    const { deps, get } = capturingDeps({ MAPPED: '/tmp/mapped' });
    const code = await runAdoptCli({ ...OPTS, projectId: 'MAPPED', cwd: '/tmp/mapped/x' }, deps);
    assert.equal(code, 0);
    assert.ok(!('module' in get()), 'flat-string entry has no modules → module omitted');
  });

  it('M4: non-matching cwd → no module (no throw)', async () => {
    const { deps, get } = capturingDeps({
      ROMAN: { default: '/Users/op/dev/roman', modules: { FVF: '/Users/op/dev/roman/fvf' } },
    });
    const code = await runAdoptCli(
      { ...OPTS, projectId: 'ROMAN', cwd: '/Users/op/dev/roman/other' },
      deps,
    );
    assert.equal(code, 0);
    assert.ok(!('module' in get()), 'cwd outside any module path → module omitted');
  });

  it('M5: longest-match wins among nested module paths', async () => {
    const { deps, get } = capturingDeps({
      ROMAN: {
        default: '/Users/op/dev/roman',
        modules: { OUTER: '/Users/op/dev/roman/fvf', INNER: '/Users/op/dev/roman/fvf/inner' },
      },
    });
    const code = await runAdoptCli(
      { ...OPTS, projectId: 'ROMAN', cwd: '/Users/op/dev/roman/fvf/inner/deep' },
      deps,
    );
    assert.equal(code, 0);
    assert.equal(get().module, 'INNER', 'most specific (longest) ancestor path wins');
  });

  it('M6: garbage modules map (non-string path) never throws → no module', async () => {
    const { deps, get } = capturingDeps({
      ROMAN: { default: '/Users/op/dev/roman', modules: { BAD: 123, NULLISH: null } },
    });
    const code = await runAdoptCli(
      { ...OPTS, projectId: 'ROMAN', cwd: '/Users/op/dev/roman/x' },
      deps,
    );
    assert.equal(code, 0);
    assert.ok(!('module' in get()), 'non-string module paths skipped, no throw');
  });

  it('M7: sibling path does NOT match (separator boundary)', async () => {
    const { deps, get } = capturingDeps({
      ROMAN: { default: '/Users/op/dev/roman', modules: { FVF: '/Users/op/dev/roman/fvf' } },
    });
    const code = await runAdoptCli(
      { ...OPTS, projectId: 'ROMAN', cwd: '/Users/op/dev/roman/fvf-sibling' },
      deps,
    );
    assert.equal(code, 0);
    assert.ok(!('module' in get()), 'fvf-sibling must not match the fvf module');
  });
});

describe('runAdoptCli — liveness workspace rename (Phase 59 gap-fix)', () => {
  it('L1: on a successful adopt, renames the workspace to a title carrying the task_ref (word-bounded); exit still 0', async () => {
    let renamed;
    const code = await runAdoptCli(
      OPTS,
      baseDeps({
        adoptSessionFn: async () => okResultWithRef(),
        renameWorkspaceFn: async (args) => {
          renamed = args;
        },
      }),
    );
    assert.equal(code, 0, 'success exit code unchanged');
    assert.ok(renamed, 'renameWorkspaceFn was invoked on a successful adopt');
    assert.equal(renamed.workspaceRef, 'W', 'renamed the adopted workspaceRef');
    // El título DEBE llevar el ref con límite de palabra: el ':' tras el ref satisface
    // titleIdentifiesSession (reconcile.js).
    assert.ok(renamed.title.startsWith('ROMAN-192:'), `title carries the ref: ${renamed.title}`);
    assert.match(renamed.title, /ROMAN-192/);
  });

  it('L2: fail-open — when renameWorkspaceFn throws, runAdoptCli still returns exit 0 and renders success', async () => {
    const out = makeStdoutStub();
    let code;
    await assert.doesNotReject(async () => {
      code = await runAdoptCli(
        OPTS,
        baseDeps({
          adoptSessionFn: async () => okResultWithRef(),
          writeFn: out.write,
          renameWorkspaceFn: async () => {
            throw new Error('cmux socket down');
          },
        }),
      );
    });
    assert.equal(code, 0, 'rename failure must NOT change the success exit code');
    // El render de éxito sigue presente (la adopción ocurrió).
    assert.match(out.get(), /Adopted/);
    assert.match(out.get(), /task_id:\s+T-1/);
  });

  it('L3: rename NOT called on ALREADY_ADOPTED / INVALID_INPUT / CREATE_FAILED (solo en result.ok===true)', async () => {
    for (const builder of [alreadyAdoptedResult, invalidInputResult, createFailedResult]) {
      let called = 0;
      await runAdoptCli(
        OPTS,
        baseDeps({
          adoptSessionFn: async () => builder(),
          renameWorkspaceFn: async () => {
            called += 1;
          },
        }),
      );
      assert.equal(called, 0, `renameWorkspaceFn NOT called for ${builder.name}`);
    }
  });

  it('L4: rename SKIPPED (not called) when task.ref is missing/empty (fail-open, no throw)', async () => {
    let called = 0;
    const code = await runAdoptCli(
      OPTS,
      baseDeps({
        // okResult() has no task.ref → rename must be skipped.
        adoptSessionFn: async () => okResult(),
        renameWorkspaceFn: async () => {
          called += 1;
        },
      }),
    );
    assert.equal(code, 0);
    assert.equal(called, 0, 'no ref → no rename attempt');
  });
});

describe('runAdoptCli — reenvío de flags de recuperación --task-url/--task-id (DELIV-03, D-08)', () => {
  it('R1: con --task-url/--task-id, el objeto pasado a adoptSessionFn incluye task_url/task_id', async () => {
    let received;
    const code = await runAdoptCli(
      { ...OPTS, taskUrl: 'https://plane.example/T-7', taskId: 'T-7' },
      baseDeps({
        adoptSessionFn: async (args) => {
          received = args;
          return okResult();
        },
      }),
    );
    assert.equal(code, 0);
    assert.equal(received.task_url, 'https://plane.example/T-7', 'reenvía taskUrl → task_url');
    assert.equal(received.task_id, 'T-7', 'reenvía taskId → task_id');
  });

  it('R2: SIN los flags, el objeto NO contiene las claves task_url/task_id (spread-when-present, nunca undefined)', async () => {
    let received;
    const code = await runAdoptCli(
      OPTS,
      baseDeps({
        adoptSessionFn: async (args) => {
          received = args;
          return okResult();
        },
      }),
    );
    assert.equal(code, 0);
    assert.ok(!('task_url' in received), 'task_url ausente cuando no se pasa --task-url');
    assert.ok(!('task_id' in received), 'task_id ausente cuando no se pasa --task-id');
  });
});

describe('runAdoptCli — recuperación END-TO-END vía el handler: UN SOLO createTask (DELIV-03)', () => {
  it('E2E: run inicial → PERSIST_FAILED (createTask 1x); re-run con --task-url/--task-id → reused:true SIN segundo createTask', async () => {
    // TaskItem fijo que el createTask espía devuelve. Su url/id son EXACTAMENTE lo que el
    // operador reintroduce en el re-run de recuperación (los dos campos que PERSIST_FAILED expone).
    const fakeTaskItem = {
      id: 'T-7',
      ref: 'ROMAN-7',
      url: 'https://plane.example/T-7',
      projectId: 'P',
      title: 'proj',
    };
    let calls = 0;
    const provider = {
      createTask: async () => {
        calls += 1;
        return fakeTaskItem;
      },
    };

    // addSession conmutable: lanza en el run inicial (ventana PERSIST_FAILED),
    // no-op en el re-run de recuperación.
    let addThrows = true;
    const stateDeps = {
      findSession: () => null, // nunca hay fila → el guard sessionId no corta
      listSessions: () => [], // barrido local (c2.a) sin match
      listHistory: () => [],
      addSession: () => {
        if (addThrows) throw new Error('disk full');
      },
    };

    // adoptSession REAL con state inyectado, disparado DESDE runAdoptCli (no directo):
    // es la brecha exacta que marcó la verificación (mecanismo correcto pero inalcanzable).
    const deps = {
      getProviderFn: () => provider,
      loadProjectsFn: () => ({ P: '/tmp/proj' }),
      loadConfigFn: () => ({ provider: 'plane' }),
      adoptSessionFn: (args) => adoptSession(args, stateDeps),
      errFn: () => {},
      writeFn: () => {},
    };

    // RUN INICIAL (sin flags de recuperación): addSession lanza → rama (d) createTask
    // (contador → 1) → PERSIST_FAILED. exit 1, calls === 1.
    const code1 = await runAdoptCli(
      { workspaceRef: 'W', cwd: '/tmp/proj', sessionId: 'S', projectId: 'P' },
      deps,
    );
    assert.equal(code1, 1, 'run inicial devuelve exit 1 (PERSIST_FAILED)');
    assert.equal(calls, 1, 'el run inicial llama createTask exactamente una vez');

    // RE-RUN (recuperación): mismos identificadores, ahora con --task-url/--task-id y
    // addSession que YA NO lanza. --json para capturar el discriminante.
    addThrows = false;
    const out = makeStdoutStub();
    const code2 = await runAdoptCli(
      {
        workspaceRef: 'W',
        cwd: '/tmp/proj',
        sessionId: 'S',
        projectId: 'P',
        taskUrl: 'https://plane.example/T-7',
        taskId: 'T-7',
        json: true,
      },
      { ...deps, writeFn: out.write },
    );
    assert.equal(code2, 0, 're-run reconcilia con éxito (exit 0)');
    assert.equal(calls, 1, 'NINGÚN segundo createTask: contador sigue en 1 (sin duplicado en Plane)');
    const parsed = JSON.parse(out.get());
    assert.equal(parsed.ok, true, 'el re-run devuelve ok:true');
    assert.equal(parsed.reused, true, 'el re-run marca reused:true (reconciliación, no creación)');
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

  it('CLI4: registra la opción --module y la pasa a runAdoptCli (Phase 57)', () => {
    assert.ok(cli.includes("'--module <name>'"), 'expected --module option declaration');
    assert.ok(cli.includes('module: opts.module'), 'expected module passed into runAdoptCli');
  });
});
