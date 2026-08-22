// @ts-check
// Phase 19 WT-04: worktree cleanup (fail-open).
// Phase 58 LIFE-03: el cleanup terminal (incl. worktree) migró del Stop hook al
// SessionEnd hook (runSessionEndHook → performTerminalCleanup). La lógica de saneo
// del worktree es IDÉNTICA (mismo helper cleanupWorktree); solo cambia el hook que
// la dispara. Este test contractual ahora ejercita runSessionEndHook.
// Cobertura mixta unit (gitFn stub) + E2E smoke (git real con tmpdir).

import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// NO importar stop.js estáticamente: arrastra state.js → config.js (KODO_DIR al
// module-load → ~/.kodo REAL). Aunque estos tests inyectan findSessionFn/
// removeSessionFn por DI (no tocan state hoy), el import estático fijaría
// KODO_DIR al HOME real y un test futuro sin DI corrompería el state del usuario.
// Se carga dinámicamente tras aislar HOME (mismo patrón que stop.test.js,
// raíz del bug cazado en UAT live de Phase 38).
/** @type {typeof import('../src/hooks/session-end.js').runSessionEndHook} */
let runSessionEndHook;
let _origHome;
let _tmpHome;
before(async () => {
  _origHome = process.env.HOME;
  _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-test-wt-cleanup-'));
  process.env.HOME = _tmpHome;
  mkdirSync(join(_tmpHome, '.kodo'), { recursive: true });
  ({ runSessionEndHook } = await import('../src/hooks/session-end.js'));
});
after(() => {
  if (_origHome === undefined) delete process.env.HOME;
  else process.env.HOME = _origHome;
  if (_tmpHome) rmSync(_tmpHome, { recursive: true, force: true });
});

function makeMemLogger() {
  const events = [];
  const logger = {
    info: (msg, fields) => events.push({ level: 'info', msg, fields }),
    warn: (msg, fields) => events.push({ level: 'warn', msg, fields }),
    error: (msg, fields) => events.push({ level: 'error', msg, fields }),
    debug: (msg, fields) => events.push({ level: 'debug', msg, fields }),
    child: () => logger,
  };
  return { logger, events };
}

function makeSession(overrides = {}) {
  return {
    session_id: 'sess-wt-clean-test',
    task_id: 'task-1',
    task_ref: 'KL-99',
    provider: 'plane',
    project_id: 'proj-1',
    project_path: '/tmp/project',
    worktree_path: '/tmp/project/.bg-shell/sess-wt-clean-test',
    summary: 'Test',
    status: 'review',
    started_at: new Date().toISOString(),
    workspace_ref: 'workspace:1',
    gsd: false,
    ...overrides,
  };
}

function makeStubCmux() {
  return {
    setColor: async () => {},
    notify: async () => {},
    listWorkspaces: async () => '',
    send: async () => {},
  };
}

function makeGitFnStub(handler) {
  const calls = [];
  const gitFn = (cwd, args) => {
    calls.push({ cwd, args });
    return handler(cwd, args) ?? '';
  };
  return { gitFn, calls };
}

/**
 * Stub de la captura de la cola de integración (KODO-26).
 *
 * OBLIGATORIO en toda invocación de `runSessionEndHook`, misma clase de fuga que
 * `stateWriterFn`/`getOrchestratorFn`: sin inyectarlo, el hook consulta git de verdad y encola
 * en el `~/.kodo/state.json` REAL del operador (T-74-15), y además mete sus propios comandos en
 * cualquier `gitFn` que la suite esté contando. La cobertura de la captura vive en
 * test/integration/capture.test.js.
 */
const noCapture = async () => ({ captured: false, reason: 'stubbed', entry: null });

/**
 * Probe que declara «el worktree de la sesión SIGUE en disco» (KODO-30).
 *
 * Estos tests usan `worktree_path` sintéticos que nunca se crean — todo el git está
 * stubeado. Desde KODO-30 el cleanup hace un probe de existencia y, si el directorio no
 * está, bifurca al camino `already_gone` (que ni remueve ni mueve nada). Sin este stub la
 * suite entera mediría ese otro camino, no el que dice medir.
 *
 * Se inyecta por `existsFn` y NO sustituyendo `deps.fs`: un `fs` parcial dejaría sin
 * `mkdirSync` al bloque de handoff, que corre en el mismo hook.
 */
const WORKTREE_EXISTS = () => true;

describe('KODO-18: el worktree del HOST no se borra jamás', () => {
  // Guarda de SEGURIDAD, no de corrección: `worktree_path` también se rellena cuando el
  // checkout lo creó el host (Orca) —el dashboard lo necesita para leer el `.planning/`
  // de la sesión—, pero ese directorio es el workspace del operador, con su tarjeta y su
  // rama. Sin esta guarda, `cleanupWorktree` le haría `worktree remove` + `branch -D` en
  // cuanto el agente cerrara, destruyendo el sitio donde el humano iba a revisar.
  it('una sesión con host: orca NO dispara NINGÚN comando git de cleanup', async () => {
    const session = makeSession({
      host: 'orca',
      worktree_path: '/Users/x/orca/workspaces/kodo/kodo-42',
    });
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub(() => '');
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_EXISTS,
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );
    const destructive = calls.filter(
      (c) => (c.args[0] === 'worktree' && c.args[1] === 'remove') || (c.args[0] === 'branch' && c.args[1] === '-D'),
    );
    assert.deepEqual(destructive, [], 'ni worktree remove ni branch -D');
    assert.ok(
      !events.some((e) => String(e.fields?.event || '').startsWith('worktree.cleanup')),
      'el carril de cleanup ni siquiera arranca',
    );
  });

  it('se mira el host de LA SESIÓN, no el activo', async () => {
    // Una sesión lanzada bajo Orca no debe limpiarse aunque el operador haya vuelto a
    // cmux: el directorio sigue siendo de Orca. El test corre con el host activo por
    // defecto (cmux) y aun así la guarda debe morder.
    const session = makeSession({ host: 'orca', worktree_path: '/Users/x/orca/workspaces/kodo/kodo-9' });
    const { logger } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub(() => '');
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_EXISTS,
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );
    assert.deepEqual(calls, [], 'cero comandos git');
  });

  it('una sesión de cmux (o legacy sin `host`) SÍ se limpia — cero regresión', async () => {
    const session = makeSession({ host: 'cmux' });
    const { logger, events } = makeMemLogger();
    const { gitFn } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'kodo-sess-wt-clean-test';
      if (args.includes('--porcelain')) return '';
      return '';
    });
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_EXISTS,
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );
    assert.ok(
      events.some((e) => e.fields?.event === 'worktree.cleanup.ok'),
      'el carril de cmux sigue intacto',
    );
  });
});

describe('Phase 19 WT-04: worktree cleanup — unit (gitFn stub)', () => {
  it('CLEAN: removes worktree + deletes branch + emits cleanup.ok with branch_deleted=true', async () => {
    const session = makeSession();
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'kodo-sess-wt-clean-test';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'rev-list') return '0'; // KODO-21: rama totalmente mergeada
      return '';
    });
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_EXISTS,
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );

    const ok = events.find((e) => e.fields?.event === 'worktree.cleanup.ok');
    assert.ok(ok, 'must emit worktree.cleanup.ok');
    assert.equal(ok.level, 'info');
    assert.equal(ok.fields.branch_deleted, true);
    assert.equal(ok.fields.worktree_path, session.worktree_path);

    // Orden de calls: branch --show-current → status --porcelain → worktree remove → branch -D → prune
    const branchReadIdx = calls.findIndex((c) => c.args.includes('--show-current'));
    const statusIdx = calls.findIndex((c) => c.args.includes('--porcelain'));
    const removeIdx = calls.findIndex((c) => c.args[0] === 'worktree' && c.args[1] === 'remove');
    const branchDelIdx = calls.findIndex((c) => c.args[0] === 'branch' && c.args[1] === '-D');
    const pruneIdx = calls.findIndex((c) => c.args[0] === 'worktree' && c.args[1] === 'prune');
    assert.ok(branchReadIdx >= 0 && statusIdx > branchReadIdx, 'branch read BEFORE status (Pitfall #2)');
    assert.ok(removeIdx > statusIdx, 'remove after status');
    assert.ok(branchDelIdx > removeIdx, 'branch -D after remove');
    assert.ok(pruneIdx > branchDelIdx, 'prune oportunista al final (D-04)');
  });

  it('DIRTY: dirty status → move to .dirty/ + emit cleanup.dirty (D-02), branch preserved', async () => {
    const session = makeSession();
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'kodo-sess-wt-clean-test';
      if (args.includes('--porcelain')) return 'M file.txt\n?? new.txt\n';
      return '';
    });
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_EXISTS,
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );

    const dirty = events.find((e) => e.fields?.event === 'worktree.cleanup.dirty');
    assert.ok(dirty, 'must emit worktree.cleanup.dirty');
    assert.equal(dirty.level, 'warn');
    assert.equal(dirty.fields.moved_to, `${session.worktree_path}.dirty`);
    const branchDel = calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D');
    assert.equal(branchDel, undefined, 'branch must be PRESERVED when dirty (D-02)');
  });

  it('ERROR on remove: gitFn throws → emits cleanup.error{phase:remove} + fail-open', async () => {
    const session = makeSession();
    const { logger, events } = makeMemLogger();
    const gitFn = (cwd, args) => {
      if (args.includes('--show-current')) return 'kodo-sess-wt-clean-test';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'worktree' && args[1] === 'remove') throw new Error('EBUSY: rmdir failed');
      return '';
    };
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_EXISTS,
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );

    const err = events.find((e) => e.fields?.event === 'worktree.cleanup.error');
    assert.ok(err, 'must emit worktree.cleanup.error');
    assert.equal(err.level, 'error');
    assert.equal(err.fields.phase, 'remove');
    assert.match(err.fields.reason, /EBUSY/);
  });

  it('TARGET COLLISION: <wt>.dirty already exists → suffixed path (Pitfall #1)', async () => {
    // Crear tmp real para que existsSync devuelva true en el target canónico
    const tmpBase = mkdtempSync(join(tmpdir(), 'kodo-collision-'));
    const wt = join(tmpBase, 'wt');
    const dirty = `${wt}.dirty`;
    mkdirSync(wt, { recursive: true });
    mkdirSync(dirty, { recursive: true }); // pre-existing collision target
    const session = makeSession({ worktree_path: wt });
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'sess-x';
      if (args.includes('--porcelain')) return 'M something\n'; // dirty
      return '';
    });
    try {
      await runSessionEndHook(
        { session_id: session.session_id, cwd: session.project_path },
        {
          findSessionFn: () => ({ id: session.task_id, session }),
          captureIntegrationFn: noCapture,
          existsFn: WORKTREE_EXISTS,
          removeSessionFn: () => {},
          cmux: makeStubCmux(),
          loggerFactory: () => logger,
          gitFn,
        },
      );
      const moveCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'move');
      assert.ok(moveCall, 'must call worktree move');
      const target = moveCall.args[3] ?? moveCall.args[moveCall.args.length - 1];
      assert.notEqual(target, dirty, 'target must NOT be the colliding path');
      assert.match(target, new RegExp(`^${wt.replace(/\//g, '\\/')}\\.dirty-`), 'must use suffixed variant');
      const dirtyEv = events.find((e) => e.fields?.event === 'worktree.cleanup.dirty');
      assert.equal(dirtyEv?.fields?.moved_to, target);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('LEGACY v0.5: no worktree_path → cleanup skipped silently (D-09)', async () => {
    const session = makeSession({ worktree_path: undefined });
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub(() => '');
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_EXISTS,
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );
    assert.equal(calls.length, 0, 'gitFn must NOT be called for legacy v0.5 (D-09 silent)');
    const cleanupEvents = events.filter((e) => String(e.fields?.event || '').startsWith('worktree.cleanup.'));
    assert.equal(cleanupEvents.length, 0, 'no worktree.cleanup.* events for legacy (silent)');
  });

  it('BRANCH-D FAILURE: branch -D throws → cleanup.ok with branch_deleted=false (Pitfall #3 fail-open)', async () => {
    const session = makeSession();
    const { logger, events } = makeMemLogger();
    const gitFn = (cwd, args) => {
      if (args.includes('--show-current')) return 'sess-x';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'rev-list') return '0'; // KODO-21: rama mergeada → se intenta el borrado
      if (args[0] === 'branch' && args[1] === '-D') throw new Error('cannot delete branch in use');
      return '';
    };
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_EXISTS,
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );
    const ok = events.find((e) => e.fields?.event === 'worktree.cleanup.ok');
    assert.ok(ok, 'cleanup.ok must still be emitted');
    assert.equal(ok.fields.branch_deleted, false);
    const err = events.find((e) => e.fields?.event === 'worktree.cleanup.error');
    assert.equal(err, undefined, 'no cleanup.error for branch -D failure (warn-only per Pitfall #3)');
  });

  it('DANGLING SYMLINK: <wt>.dirty is a symlink to nonexistent path → suffixed (Pitfall #1 / CR-03)', async () => {
    const tmpBase = mkdtempSync(join(tmpdir(), 'kodo-dangling-'));
    const wt = join(tmpBase, 'wt');
    const dirty = `${wt}.dirty`;
    const nonexistent = join(tmpBase, 'nonexistent-target');
    mkdirSync(wt, { recursive: true });
    // Symlink colgante: <wt>.dirty → <tmpBase>/nonexistent-target (que NO existe).
    // existsSync(dirty) → false (sigue el symlink); lstatSync(dirty) → stat
    // exitoso del symlink en sí. CR-03 fix: dispara variante suffixed.
    const { symlinkSync } = await import('node:fs');
    symlinkSync(nonexistent, dirty);
    const session = makeSession({ worktree_path: wt });
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'sess-x';
      if (args.includes('--porcelain')) return 'M something\n'; // dirty
      return '';
    });
    try {
      await runSessionEndHook(
        { session_id: session.session_id, cwd: session.project_path },
        {
          findSessionFn: () => ({ id: session.task_id, session }),
          captureIntegrationFn: noCapture,
          existsFn: WORKTREE_EXISTS,
          removeSessionFn: () => {},
          cmux: makeStubCmux(),
          loggerFactory: () => logger,
          gitFn,
        },
      );
      const moveCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'move');
      assert.ok(moveCall, 'must call worktree move');
      const target = moveCall.args[3] ?? moveCall.args[moveCall.args.length - 1];
      assert.notEqual(target, dirty, 'target must NOT be the colliding symlink path');
      assert.ok(
        target.startsWith(`${wt}.dirty-`),
        `target must use suffixed variant, got: ${target}`,
      );
      const dirtyEv = events.find((e) => e.fields?.event === 'worktree.cleanup.dirty');
      assert.equal(dirtyEv?.fields?.moved_to, target);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('REGULAR FILE: <wt>.dirty is a plain file (not dir) → suffixed (Pitfall #1 / CR-03)', async () => {
    const tmpBase = mkdtempSync(join(tmpdir(), 'kodo-regfile-'));
    const wt = join(tmpBase, 'wt');
    const dirty = `${wt}.dirty`;
    mkdirSync(wt, { recursive: true });
    writeFileSync(dirty, 'pre-existing file blocking the dirty target');
    const session = makeSession({ worktree_path: wt });
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'sess-x';
      if (args.includes('--porcelain')) return 'M something\n'; // dirty
      return '';
    });
    try {
      await runSessionEndHook(
        { session_id: session.session_id, cwd: session.project_path },
        {
          findSessionFn: () => ({ id: session.task_id, session }),
          captureIntegrationFn: noCapture,
          existsFn: WORKTREE_EXISTS,
          removeSessionFn: () => {},
          cmux: makeStubCmux(),
          loggerFactory: () => logger,
          gitFn,
        },
      );
      const moveCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'move');
      assert.ok(moveCall, 'must call worktree move');
      const target = moveCall.args[3] ?? moveCall.args[moveCall.args.length - 1];
      assert.notEqual(target, dirty, 'target must NOT be the colliding regular file path');
      assert.ok(
        target.startsWith(`${wt}.dirty-`),
        `target must use suffixed variant, got: ${target}`,
      );
      const dirtyEv = events.find((e) => e.fields?.event === 'worktree.cleanup.dirty');
      assert.equal(dirtyEv?.fields?.moved_to, target);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});

describe('Phase 19 WT-04: worktree cleanup — E2E smoke (git real)', () => {
  let tmpBase;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), 'kodo-wt-e2e-'));
  });

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  function makeIsolatedRepoWithWorktree(branchName = 'kodo-sess-e2e') {
    const repo = join(tmpBase, 'repo');
    mkdirSync(repo, { recursive: true });
    const opts = { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] };
    execSync('git init -q', opts);
    execSync('git config user.email "test@kodo.local"', opts);
    execSync('git config user.name "kodo test"', opts);
    execSync('git config commit.gpgsign false', opts);
    writeFileSync(join(repo, 'seed.txt'), 'seed');
    execSync('git add -A && git commit -q -m "seed"', opts);
    const wt = join(repo, '.bg-shell', 'sess-e2e');
    execSync(`git worktree add -b ${branchName} ${wt}`, opts);
    return { repo, wt, branchName };
  }

  it('E2E CLEAN: worktree removed + branch deleted on disk', async () => {
    const { repo, wt, branchName } = makeIsolatedRepoWithWorktree();
    const session = makeSession({ project_path: repo, worktree_path: wt, session_id: 'sess-e2e' });
    const { logger, events } = makeMemLogger();
    await runSessionEndHook(
      { session_id: session.session_id, cwd: repo },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_EXISTS,
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        // gitFn default (execFileSync real)
      },
    );
    assert.equal(existsSync(wt), false, 'worktree dir must be removed');
    const branches = execSync('git branch', { cwd: repo, encoding: 'utf-8' });
    assert.ok(!branches.includes(branchName), `branch ${branchName} must be deleted`);
    assert.ok(events.find((e) => e.fields?.event === 'worktree.cleanup.ok'), 'cleanup.ok emitted');
  });

  // ── KODO-21 (DoD): una sesión que termina con commits sin mergear conserva su
  // rama. Es el caso que costó 5 commits y 652 inserciones en KODO-13.
  it('E2E UNMERGED: worktree limpio pero con commits propios → rama CONSERVADA en disco', async () => {
    const { repo, wt, branchName } = makeIsolatedRepoWithWorktree('kodo-sess-unmerged');
    const wtOpts = { cwd: wt, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] };
    // Trabajo COMMITEADO dentro del worktree: el árbol queda limpio (no dispara
    // el camino dirty) pero la rama acumula commits que no están en ningún otro sitio.
    writeFileSync(join(wt, 'trabajo.txt'), 'fix del provider + tests');
    execSync('git add -A && git commit -q -m "trabajo que no debe perderse"', wtOpts);
    const head = execSync('git rev-parse HEAD', wtOpts).trim();

    const session = makeSession({ project_path: repo, worktree_path: wt, session_id: 'sess-e2e-unmerged' });
    const { logger, events } = makeMemLogger();
    await runSessionEndHook(
      { session_id: session.session_id, cwd: repo },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_EXISTS,
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        // gitFn default (execFileSync real)
      },
    );

    // El worktree se sanea igual — lo que sobrevive es la rama con el trabajo.
    assert.equal(existsSync(wt), false, 'worktree dir must be removed');
    const branches = execSync('git branch --list', { cwd: repo, encoding: 'utf-8' });
    assert.ok(branches.includes(branchName), `branch ${branchName} must be PRESERVED (KODO-21)`);
    const tip = execSync(`git rev-parse ${branchName}`, { cwd: repo, encoding: 'utf-8' }).trim();
    assert.equal(tip, head, 'la rama conservada sigue apuntando al trabajo');

    const kept = events.find((e) => e.fields?.event === 'worktree.branch.kept');
    assert.ok(kept, 'must emit worktree.branch.kept');
    assert.equal(kept.fields.branch, branchName);
    assert.equal(kept.fields.unmerged_commits, 1);

    const ok = events.find((e) => e.fields?.event === 'worktree.cleanup.ok');
    assert.equal(ok.fields.branch_deleted, false);
  });

  it('E2E DIRTY: worktree moved to .dirty/ + branch preserved', async () => {
    const { repo, wt, branchName } = makeIsolatedRepoWithWorktree('kodo-sess-dirty');
    appendFileSync(join(wt, 'seed.txt'), 'uncommitted change');
    const session = makeSession({
      project_path: repo,
      worktree_path: wt,
      session_id: 'sess-e2e-dirty',
    });
    const { logger, events } = makeMemLogger();
    await runSessionEndHook(
      { session_id: session.session_id, cwd: repo },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_EXISTS,
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
      },
    );
    const dirtyEv = events.find((e) => e.fields?.event === 'worktree.cleanup.dirty');
    assert.ok(dirtyEv, 'cleanup.dirty emitted');
    assert.equal(existsSync(dirtyEv.fields.moved_to), true, 'moved_to path exists on disk');
    const branches = execSync('git branch', { cwd: repo, encoding: 'utf-8' });
    assert.ok(branches.includes(branchName), `branch ${branchName} preserved`);
  });
});

// ── KODO-30: cerrar una sesión cuyo worktree Claude Code ya borró ────────────
//
// El caso REAL del 2026-08-22 (cierres de ITCLIP-81 y ITCLIP-82 con /exit): el hook emitía
// `worktree.cleanup.error` y las ramas locales ya mergeadas quedaban huérfanas en el repo.
// Quién borra el worktree, observado después en el cierre de KODO-29: al salir, Claude Code
// ofrece «Keep worktree / Remove worktree»; con Remove borra el directorio y la rama
// `worktree-<sid>` ANTES de que arranque session-end.js. La rama renombrada por la sesión
// (`feat/…`) sobrevive — y es exactamente la que se quedaba sin podar.
// Aquí se cierra el ciclo entero por el hook, no por el helper: probe → already_gone →
// decisión sobre la rama PERSISTIDA.
describe('KODO-30: SessionEnd con el worktree ya borrado', () => {
  /** Probe que declara «el worktree de la sesión ya NO está en disco». */
  const WORKTREE_GONE = () => false;

  it('RAMA MERGEADA: la borra y NO emite worktree.cleanup.error', async () => {
    const session = makeSession({ branch: 'feat/itclip-81-piezas-prototipo' });
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args[0] === 'rev-list') return '0'; // gate KODO-21: todo mergeado
      return '';
    });
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_GONE,
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );

    // El síntoma exacto del bug.
    assert.equal(
      events.find((e) => e.fields?.event === 'worktree.cleanup.error'),
      undefined,
      'cerrar con el worktree ya borrado NO es un error',
    );
    const ok = events.find((e) => e.fields?.event === 'worktree.cleanup.ok');
    assert.ok(ok, 'must emit worktree.cleanup.ok');
    assert.equal(ok.fields.already_gone, true);
    assert.equal(ok.fields.branch_deleted, true);

    const branchDel = calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D');
    assert.ok(branchDel, 'la rama mergeada se borra — deja de quedar huérfana');
    assert.equal(branchDel.args[2], 'feat/itclip-81-piezas-prototipo');
  });

  it('RAMA NO MERGEADA: la conserva (el trabajo commiteado nunca se pierde)', async () => {
    const session = makeSession({ branch: 'feat/con-trabajo' });
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args[0] === 'rev-list') return '7\n';
      return '';
    });
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_GONE,
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );

    assert.equal(calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D'), undefined);
    const kept = events.find((e) => e.fields?.event === 'worktree.branch.kept');
    assert.ok(kept, 'must emit worktree.branch.kept');
    assert.equal(kept.fields.unmerged_commits, 7);
  });

  it('la sesión se archiva igual: removeSession corre en ambos caminos', async () => {
    const session = makeSession({ branch: 'feat/z' });
    const { logger } = makeMemLogger();
    const { gitFn } = makeGitFnStub((cwd, args) => (args[0] === 'rev-list' ? '0' : ''));
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        existsFn: WORKTREE_GONE,
        removeSessionFn: (id) => removed.push(id),
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );

    assert.deepEqual(removed, [session.task_id], 'el cierre completa igual');
  });
});
