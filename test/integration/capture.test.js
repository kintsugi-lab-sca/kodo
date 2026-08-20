// @ts-check
//
// test/integration/capture.test.js — KODO-26: la captura al cerrar la sesión.
//
// Todo por DI: `gitFn` es un stub que responde por args y `enqueueFn` es un espía, así que
// estos casos NO tocan git de verdad NI el `~/.kodo/state.json` del operador. La cobertura del
// store real (que sí aísla HOME) vive en test/integration/queue.test.js; la del cableado en el
// hook, en test/hooks/session-end-integrate.test.js.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { captureIntegration } from '../../src/integration/capture.js';

/**
 * Stub de git dirigido por args. `respond` recibe el array de args ya normalizado a string y
 * devuelve el stdout; devolver `undefined` equivale a stdout vacío, y lanzar simula un exit
 * distinto de 0 (contrato de `execFileSync`, que es lo que el gitFn real hace).
 */
function makeGit(respond) {
  const calls = [];
  const gitFn = (cwd, args) => {
    calls.push({ cwd, args: args.join(' ') });
    const out = respond(args.join(' '), cwd);
    if (out instanceof Error) throw out;
    return out ?? '';
  };
  return { gitFn, calls };
}

/** Espía de encolado con la forma de retorno de `enqueueIntegration`. */
function makeEnqueue() {
  const calls = [];
  const enqueueFn = (input) => {
    calls.push(input);
    return { ok: true, value: { entry: { ...input, status: 'pending' }, deduped: false } };
  };
  return { enqueueFn, calls };
}

const session = {
  task_ref: 'KODO-26',
  task_id: 'uuid-26',
  project_path: '/repo/kodo',
  session_id: 'sess-1',
};

/** Respuestas de un repo sano: rama con 3 commits propios, base al día, diff de docs. */
function healthyRepo(overrides = {}) {
  return (args) => {
    if (args.includes('branch --show-current')) return overrides.branch ?? 'worktree-abc';
    if (args.startsWith('symbolic-ref')) return overrides.originHead ?? 'origin/main';
    if (args.startsWith('rev-parse --verify')) return overrides.refExists ?? 'deadbeef';
    if (args.startsWith('rev-list --count worktree-abc --not')) return overrides.unmerged ?? '3';
    if (args.startsWith('rev-list --count worktree-abc..main')) return overrides.behind ?? '0';
    if (args.startsWith('diff --numstat')) return overrides.numstat ?? '3\t1\tREADME.md';
    return '';
  };
}

describe('captureIntegration — qué SÍ entra en la cola', () => {
  it('rama con commits propios → encola con conteo, base, diff y sugerencia', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session, worktree: '/wt/sess-1', gitFn, enqueueFn });

    assert.equal(r.captured, true);
    assert.equal(r.reason, 'queued');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      task_ref: 'KODO-26',
      task_id: 'uuid-26',
      project_path: '/repo/kodo',
      branch: 'worktree-abc',
      base_branch: 'main',
      commits_ahead: 3,
      base_ok: true,
      files_changed: 1,
      lines_changed: 4,
      suggested: 'ff',
    });
  });

  it('la rama se lee del WORKTREE de la sesión (que el cleanup destruye después)', async () => {
    const { gitFn, calls } = makeGit(healthyRepo());
    const { enqueueFn } = makeEnqueue();
    await captureIntegration({ session, worktree: '/wt/sess-1', gitFn, enqueueFn });
    const read = calls.find((c) => c.args.includes('branch --show-current'));
    assert.ok(read.args.startsWith('-C /wt/sess-1 '), `debe scopear al worktree: ${read.args}`);
  });

  it('sesión adoptada (sin worktree) → la rama se lee del propio repo', async () => {
    const { gitFn, calls } = makeGit(healthyRepo());
    const { enqueueFn } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn });
    const read = calls.find((c) => c.args.includes('branch --show-current'));
    assert.equal(read.args, 'branch --show-current');
    assert.equal(read.cwd, '/repo/kodo');
  });

  it('el diff se mide con TRES puntos (base...branch), la vista de un PR', async () => {
    const { gitFn, calls } = makeGit(healthyRepo());
    const { enqueueFn } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn });
    assert.ok(calls.some((c) => c.args === 'diff --numstat main...worktree-abc'));
  });

  it('los binarios (`-\\t-\\tpath`) cuentan como fichero pero no suman líneas', async () => {
    const { gitFn } = makeGit(healthyRepo({ numstat: '-\t-\tlogo.png\n5\t2\tsrc/a.js' }));
    const { enqueueFn, calls } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn });
    assert.equal(calls[0].files_changed, 2);
    assert.equal(calls[0].lines_changed, 7);
  });
});

describe('captureIntegration — qué NO entra en la cola', () => {
  it('rama ya mergeada (conteo 0 de KODO-21) → NO se encola', async () => {
    const { gitFn } = makeGit(healthyRepo({ unmerged: '0' }));
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session, worktree: '/wt/sess-1', gitFn, enqueueFn });
    assert.equal(r.captured, false);
    assert.equal(r.reason, 'merged');
    assert.deepEqual(calls, []);
  });

  it('HEAD desacoplado (sin rama) → no hay nada que encolar', async () => {
    const { gitFn } = makeGit(healthyRepo({ branch: '' }));
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session, worktree: '/wt/sess-1', gitFn, enqueueFn });
    assert.equal(r.reason, 'detached');
    assert.deepEqual(calls, []);
  });

  it('la sesión cerró trabajando SOBRE la base → no se encola main contra main', async () => {
    const { gitFn } = makeGit(healthyRepo({ branch: 'main' }));
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session, worktree: null, gitFn, enqueueFn });
    assert.equal(r.reason, 'is-base');
    assert.deepEqual(calls, []);
  });

  it('sesión sin project_path → no-op', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session: {}, worktree: null, gitFn, enqueueFn });
    assert.equal(r.reason, 'no-project');
    assert.deepEqual(calls, []);
  });
});

describe('captureIntegration — base atrasada (criterio explícito del DoD)', () => {
  it('la base avanzó por debajo → base_ok:false y la sugerencia NUNCA es ff', async () => {
    // Diff de docs puro: sin la degradación esto sería 'ff'. `rev-list --count branch..main`
    // devuelve 4 ⇒ a la rama le faltan 4 commits de main ⇒ el ff no es aplicable.
    const { gitFn } = makeGit(healthyRepo({ behind: '4' }));
    const { enqueueFn, calls } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn });
    assert.equal(calls[0].base_ok, false);
    assert.notEqual(calls[0].suggested, 'ff');
    assert.equal(calls[0].suggested, 'merge');
  });

  it('base no resoluble (ni origin/HEAD ni main ni master) → base_ok null y review', async () => {
    const { gitFn } = makeGit((args) => {
      if (args.includes('branch --show-current')) return 'worktree-abc';
      if (args.startsWith('symbolic-ref')) return new Error('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref');
      if (args.startsWith('rev-parse --verify')) return ''; // ni main ni master existen
      if (args.startsWith('rev-list --count')) return '3';
      return '';
    });
    const { enqueueFn, calls } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn });
    assert.equal(calls[0].base_branch, null);
    assert.equal(calls[0].base_ok, null);
    assert.equal(calls[0].files_changed, null, 'sin base no hay diff que medir');
    assert.equal(calls[0].suggested, 'review');
  });

  it('origin/HEAD apunta a una rama que no existe en local → cae a main', async () => {
    const { gitFn } = makeGit((args) => {
      if (args.includes('branch --show-current')) return 'worktree-abc';
      if (args.startsWith('symbolic-ref')) return 'origin/develop';
      if (args.includes('refs/heads/develop')) return ''; // no existe en local
      if (args.includes('refs/heads/main')) return 'cafe1234';
      if (args.startsWith('rev-list --count worktree-abc --not')) return '2';
      if (args.startsWith('rev-list --count worktree-abc..main')) return '0';
      if (args.startsWith('diff --numstat')) return '10\t0\tsrc/a.js';
      return '';
    });
    const { enqueueFn, calls } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn });
    assert.equal(calls[0].base_branch, 'main');
    assert.equal(calls[0].suggested, 'merge');
  });
});

describe('captureIntegration — fail-open (la sesión SIEMPRE cierra)', () => {
  it('el conteo de KODO-21 no verificable → se encola como review, no se descarta', async () => {
    // Ante la duda la rama se conserva (KODO-21); la simetría aquí es encolarla para que la mire
    // un humano, nunca asumir que estaba mergeada.
    const { gitFn } = makeGit(healthyRepo({ unmerged: 'no-soy-un-numero' }));
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session, worktree: null, gitFn, enqueueFn });
    assert.equal(r.captured, true);
    assert.equal(calls[0].commits_ahead, null);
  });

  it('git lanza en TODOS los comandos → no lanza, devuelve detached y no encola', async () => {
    const { gitFn } = makeGit(() => new Error('git: command not found'));
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session, worktree: '/wt/sess-1', gitFn, enqueueFn });
    assert.equal(r.captured, false);
    assert.deepEqual(calls, []);
  });

  it('un enqueue que falla (lock-timeout) NO propaga', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const r = await captureIntegration({
      session,
      worktree: null,
      gitFn,
      enqueueFn: () => ({ ok: false, reason: 'lock-timeout' }),
    });
    assert.equal(r.captured, false);
    assert.equal(r.reason, 'enqueue-failed');
  });

  it('un enqueue que LANZA tampoco propaga (fail-open de cuerpo entero)', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const r = await captureIntegration({
      session,
      worktree: null,
      gitFn,
      enqueueFn: () => { throw new Error('EROFS'); },
    });
    assert.equal(r.captured, false);
    assert.equal(r.reason, 'error');
  });
});
