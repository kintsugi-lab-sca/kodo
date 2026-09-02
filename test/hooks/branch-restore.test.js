// @ts-check
//
// test/hooks/branch-restore.test.js — KODO-68: la rama que borró OTRO.
//
// El gate KODO-21 garantiza que kodo nunca borra una rama con commits sin integrar, y lo
// cumple. Lo que no cubría es que kodo no es el único que borra ramas en ese instante: al
// salir de una sesión `--worktree`, el «Remove worktree» de Claude Code hace
// `worktree remove --force` + `branch -D worktree-<sid>` ANTES de que arranque `SessionEnd`,
// sin mirar si esa rama tenía trabajo dentro.
//
// Observado en SCP-21: dos commits que solo vivían ahí quedaron alcanzables únicamente por
// `git fsck --unreachable`, y la entrada que la cola encoló apuntaba a una rama inexistente
// con `commits_ahead: null` / `base_ok: null` / `suggested: review`.
//
// Cobertura mixta, misma estructura que `stop-worktree-cleanup.test.js`: unit con `gitFn`
// stub para cada camino de decisión, y un E2E con git REAL que reproduce la secuencia
// completa de SCP-21 a través de `runSessionEndHook`.

import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ORCH_INBOX_SEAMS } from '../helpers/orchestrator-inbox-seams.js';

import { restoreOrphanedBranch } from '../../src/hooks/worktree-cleanup.js';

// NO importar session-end.js ni capture.js estáticamente: arrastran state.js → config.js,
// que fija KODO_DIR al HOME REAL en el module-load. Mismo patrón que el resto de las suites
// de hooks.
/** @type {typeof import('../../src/hooks/session-end.js').runSessionEndHook} */
let runSessionEndHook;
/** @type {typeof import('../../src/integration/capture.js').captureIntegration} */
let captureIntegration;
let _origHome;
let _tmpHome;

before(async () => {
  _origHome = process.env.HOME;
  _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-test-branch-restore-'));
  process.env.HOME = _tmpHome;
  mkdirSync(join(_tmpHome, '.kodo'), { recursive: true });
  ({ runSessionEndHook } = await import('../../src/hooks/session-end.js'));
  ({ captureIntegration } = await import('../../src/integration/capture.js'));
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

function makeGitFnStub(handler) {
  const calls = [];
  const gitFn = (cwd, args) => {
    calls.push({ cwd, args });
    return handler(cwd, args) ?? '';
  };
  return { gitFn, calls };
}

/** ¿Se ejecutó el `git branch <name> <sha>` que recrea la rama? */
function sawBranchCreate(calls, branch, head) {
  return calls.some((c) => c.args[0] === 'branch' && c.args[1] === branch && c.args[2] === head);
}

const PROJECT = '/tmp/project';
const SESSION_ID = 'sess-68';
const WT = `${PROJECT}/.claude/worktrees/${SESSION_ID}`;
const BRANCH = `worktree-${SESSION_ID}`;
const HEAD = 'c'.repeat(40);

/**
 * `gitFn` del caso NOMINAL: la rama ya no existe, el objeto sellado sigue vivo, y tiene
 * `unreachable` commits que no están en ninguna otra ref.
 */
function orphanedGit({ unreachable = '2', objectAlive = true } = {}) {
  return makeGitFnStub((_cwd, args) => {
    if (args[0] === 'rev-parse') throw new Error("fatal: ref inexistente"); // rama borrada
    if (args[0] === 'cat-file') {
      if (!objectAlive) throw new Error('fatal: Not a valid object name');
      return '';
    }
    if (args[0] === 'rev-list') return unreachable;
    return '';
  });
}

describe('KODO-68: restoreOrphanedBranch — recrear la rama que borró Claude Code', () => {
  it('RESTAURA la rama desaparecida desde el SHA sellado y emite worktree.branch.restored', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = orphanedGit();

    const r = await restoreOrphanedBranch({
      project: PROJECT, branch: BRANCH, head: HEAD, sessionId: SESSION_ID, worktreePath: WT, gitFn, logger,
    });

    assert.deepEqual(r, { restored: true, reason: 'restored', unmerged: 2 });
    assert.ok(sawBranchCreate(calls, BRANCH, HEAD), 'debe ejecutar `git branch <rama> <sha>`');

    const ev = events.find((e) => e.fields?.event === 'worktree.branch.restored');
    assert.ok(ev, 'debe emitir worktree.branch.restored');
    assert.equal(ev.level, 'warn', 'es warn: el trabajo se salva, pero que hiciera falta salvarlo es grepeable');
    assert.equal(ev.fields.branch, BRANCH);
    assert.equal(ev.fields.head, HEAD);
    assert.equal(ev.fields.unmerged_commits, 2);
    assert.equal(ev.fields.session_id, SESSION_ID);
  });

  it('RAMA VIVA: no-op — la rama de disco puede ir por delante del SHA sellado', async () => {
    const { logger, events } = makeMemLogger();
    // Un commit hecho DESPUÉS del último Stop deja `branch_head` desfasado: tocar la rama
    // aquí retrocedería la punta y destruiría trabajo en vez de salvarlo.
    const { gitFn, calls } = makeGitFnStub((_cwd, args) => {
      if (args[0] === 'rev-parse') return HEAD;
      return '';
    });

    const r = await restoreOrphanedBranch({
      project: PROJECT, branch: BRANCH, head: HEAD, sessionId: SESSION_ID, gitFn, logger,
    });

    assert.deepEqual(r, { restored: false, reason: 'branch-exists', unmerged: null });
    assert.ok(!sawBranchCreate(calls, BRANCH, HEAD), 'NUNCA toca una rama que existe');
    assert.equal(events.length, 0, 'el caso normal no emite ruido');
  });

  it('SIN SHA sellado (sesión anterior a KODO-68): no-op sin consultar git', async () => {
    const { logger } = makeMemLogger();
    const { gitFn, calls } = orphanedGit();

    const r = await restoreOrphanedBranch({
      project: PROJECT, branch: BRANCH, head: null, sessionId: SESSION_ID, gitFn, logger,
    });

    assert.deepEqual(r, { restored: false, reason: 'no-head', unmerged: null });
    assert.equal(calls.length, 0, 'sin nada desde lo que restaurar, no se pregunta nada');
  });

  it('SIN RAMA sellada: no-op (no se adivina cómo se llamaba)', async () => {
    const { logger } = makeMemLogger();
    const { gitFn, calls } = orphanedGit();

    const r = await restoreOrphanedBranch({
      project: PROJECT, branch: null, head: HEAD, sessionId: SESSION_ID, gitFn, logger,
    });

    assert.deepEqual(r, { restored: false, reason: 'no-branch', unmerged: null });
    assert.equal(calls.length, 0);
  });

  it('OBJETO YA PODADO por gc: no restaura y lo distingue de «no hizo falta»', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = orphanedGit({ objectAlive: false });

    const r = await restoreOrphanedBranch({
      project: PROJECT, branch: BRANCH, head: HEAD, sessionId: SESSION_ID, gitFn, logger,
    });

    assert.deepEqual(r, { restored: false, reason: 'object-gone', unmerged: null });
    assert.ok(!sawBranchCreate(calls, BRANCH, HEAD));
    assert.equal(events.length, 0, 'no hay rescate que reportar — el caso irrecuperable va a stderr');
  });

  it('TRABAJO YA EN OTRA REF (count 0): la rama era desechable, no se recrea', async () => {
    const { logger } = makeMemLogger();
    const { gitFn, calls } = orphanedGit({ unreachable: '0' });

    const r = await restoreOrphanedBranch({
      project: PROJECT, branch: BRANCH, head: HEAD, sessionId: SESSION_ID, gitFn, logger,
    });

    assert.deepEqual(r, { restored: false, reason: 'merged', unmerged: 0 });
    assert.ok(!sawBranchCreate(calls, BRANCH, HEAD), 'recrearla solo ensuciaría el repo');
  });

  it('FAIL-SAFE: conteo no verificable → restaura igual (nunca se pierde trabajo)', async () => {
    const { logger } = makeMemLogger();
    // Simétrico invertido al fail-safe de KODO-21: allí, ante la duda, la rama se CONSERVA;
    // aquí, ante la duda, se RECUPERA. Una rama de más se borra en un segundo.
    const { gitFn, calls } = makeGitFnStub((_cwd, args) => {
      if (args[0] === 'rev-parse') throw new Error('fatal: ref inexistente');
      if (args[0] === 'cat-file') return '';
      if (args[0] === 'rev-list') throw new Error('fatal: bad revision');
      return '';
    });

    const r = await restoreOrphanedBranch({
      project: PROJECT, branch: BRANCH, head: HEAD, sessionId: SESSION_ID, gitFn, logger,
    });

    assert.deepEqual(r, { restored: true, reason: 'restored', unmerged: null });
    assert.ok(sawBranchCreate(calls, BRANCH, HEAD));
  });

  it('`git branch` FALLA: se reporta failed, no se lanza', async () => {
    const { logger } = makeMemLogger();
    const { gitFn } = makeGitFnStub((_cwd, args) => {
      if (args[0] === 'rev-parse') throw new Error('fatal: ref inexistente');
      if (args[0] === 'cat-file') return '';
      if (args[0] === 'rev-list') return '3';
      if (args[0] === 'branch') throw new Error('fatal: cannot lock ref');
      return '';
    });

    const r = await restoreOrphanedBranch({
      project: PROJECT, branch: BRANCH, head: HEAD, sessionId: SESSION_ID, gitFn, logger,
    });

    assert.deepEqual(r, { restored: false, reason: 'failed', unmerged: 3 });
  });

  it('NEVER-THROWS: un gitFn que lanza en todo no propaga', async () => {
    const { logger } = makeMemLogger();
    let r;
    await assert.doesNotReject(async () => {
      r = await restoreOrphanedBranch({
        project: PROJECT,
        branch: BRANCH,
        head: HEAD,
        sessionId: SESSION_ID,
        gitFn: () => { throw new Error('fatal: not a git repository'); },
        logger,
      });
    });
    assert.equal(r.restored, false);
  });
});

describe('KODO-68: SCP-21 end-to-end (git real) — el cierre que dejaba commits huérfanos', () => {
  let tmpBase;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), 'kodo-branch-restore-e2e-'));
  });

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  /**
   * Repo con un worktree de sesión, dos commits SOLO en su rama, y la secuencia exacta que
   * ejecuta el «Remove worktree» de Claude Code al salir: `worktree remove --force` +
   * `branch -D`, ambos ANTES de que arranque el hook.
   */
  function makeRepoAfterClaudeCodeRemovedTheWorktree(sid) {
    const repo = join(tmpBase, 'repo');
    mkdirSync(repo, { recursive: true });
    const opts = { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] };
    execSync('git init -q -b main', opts);
    execSync('git config user.email "test@kodo.local"', opts);
    execSync('git config user.name "kodo test"', opts);
    execSync('git config commit.gpgsign false', opts);
    writeFileSync(join(repo, 'seed.txt'), 'seed');
    execSync('git add -A && git commit -q -m "seed"', opts);

    const branch = `worktree-${sid}`;
    const wt = join(repo, '.claude', 'worktrees', sid);
    execSync(`git worktree add -q -b ${branch} ${wt}`, opts);

    // El trabajo de la sesión: informe + .compound, los dos commits de SCP-21.
    const wtOpts = { cwd: wt, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] };
    writeFileSync(join(wt, 'informe.md'), '# informe');
    execSync('git add -A && git commit -q -m "informe"', wtOpts);
    writeFileSync(join(wt, 'compound.md'), '# compound');
    execSync('git add -A && git commit -q -m "compound"', wtOpts);
    const head = execSync('git rev-parse HEAD', wtOpts).trim();

    // «Remove worktree» de Claude Code. Ocurre ANTES del hook, y es quien borra la rama.
    execSync(`git worktree remove --force ${wt}`, opts);
    execSync(`git branch -D ${branch}`, opts);

    return { repo, wt, branch, head, opts };
  }

  function makeSession(overrides) {
    return {
      session_id: 'sess-scp21',
      task_id: 'task-scp21',
      task_ref: 'SCP-21',
      provider: 'plane',
      project_id: 'proj-1',
      summary: 'Informe + compound',
      status: 'review',
      started_at: new Date().toISOString(),
      workspace_ref: 'workspace:1',
      gsd: false,
      ...overrides,
    };
  }

  const stubCmux = {
    setColor: async () => {},
    notify: async () => {},
    listWorkspaces: async () => '',
    send: async () => {},
  };

  it('recupera los 2 commits huérfanos y encola una entrada MEDIBLE, no una con nulls', async () => {
    const sid = 'sess-scp21';
    const { repo, wt, branch, head, opts } = makeRepoAfterClaudeCodeRemovedTheWorktree(sid);

    // Estado previo: los commits existen pero NINGUNA ref los alcanza — el caso que solo
    // `git fsck --unreachable` sabía encontrar.
    assert.equal(existsSync(wt), false, 'premisa: Claude Code ya borró el worktree');
    assert.ok(
      !execSync('git branch --list', opts).includes(branch),
      'premisa: Claude Code ya borró la rama',
    );

    const session = makeSession({
      project_path: repo,
      worktree_path: wt,
      // Lo que el hook Stop selló mientras el worktree aún vivía.
      branch,
      branch_head: head,
    });
    const { logger, events } = makeMemLogger();
    /** @type {any[]} */
    const enqueued = [];

    await runSessionEndHook(
      { session_id: sid, cwd: repo },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        // La captura REAL (es la mitad que degradaba a null), con el encolado stubeado para
        // no escribir en el state.json del operador.
        captureIntegrationFn: (args) => captureIntegration({
          ...args,
          enqueueFn: (input) => {
            enqueued.push(input);
            return { ok: true, value: { entry: input, replaced: false } };
          },
        }),
        existsFn: () => false, // el worktree ya no está en disco
        removeSessionFn: () => {},
        cmux: stubCmux,
        loggerFactory: () => logger,
        // gitFn default (execFileSync real)
      },
    );

    // 1. La rama vuelve a existir, apuntando al trabajo íntegro.
    assert.ok(
      execSync('git branch --list', opts).includes(branch),
      `la rama ${branch} debe haber sido restaurada`,
    );
    assert.equal(
      execSync(`git rev-parse ${branch}`, opts).trim(),
      head,
      'la rama restaurada apunta al SHA sellado',
    );
    assert.equal(
      execSync(`git rev-list --count main..${branch}`, opts).trim(),
      '2',
      'los 2 commits siguen ahí',
    );

    // 2. El evento hace la degradación visible.
    const restored = events.find((e) => e.fields?.event === 'worktree.branch.restored');
    assert.ok(restored, 'debe emitir worktree.branch.restored');
    assert.equal(restored.fields.unmerged_commits, 2);

    // 3. La cola mide de verdad: era `commits_ahead: null` / `base_ok: null` / `review`.
    assert.equal(enqueued.length, 1, 'la rama con trabajo entra en la cola');
    assert.equal(enqueued[0].branch, branch);
    assert.equal(enqueued[0].commits_ahead, 2, 'ya no degrada a null');
    assert.equal(enqueued[0].base_branch, 'main');
    assert.equal(enqueued[0].base_ok, true);

    // 4. El cleanup terminal corre DESPUÉS y no deshace el rescate: el gate KODO-21 ve los
    // 2 commits y conserva la rama.
    assert.ok(
      events.find((e) => e.fields?.event === 'worktree.branch.kept'),
      'la rama restaurada sobrevive al cleanup del mismo cierre',
    );
  });

  it('cierre MERGEADO: la rama borrada no se resucita (su trabajo ya está en main)', async () => {
    const sid = 'sess-merged';
    const repo = join(tmpBase, 'repo');
    mkdirSync(repo, { recursive: true });
    const opts = { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] };
    execSync('git init -q -b main', opts);
    execSync('git config user.email "test@kodo.local"', opts);
    execSync('git config user.name "kodo test"', opts);
    execSync('git config commit.gpgsign false', opts);
    writeFileSync(join(repo, 'seed.txt'), 'seed');
    execSync('git add -A && git commit -q -m "seed"', opts);

    const branch = `worktree-${sid}`;
    const wt = join(repo, '.claude', 'worktrees', sid);
    execSync(`git worktree add -q -b ${branch} ${wt}`, opts);
    const wtOpts = { cwd: wt, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] };
    writeFileSync(join(wt, 'fix.txt'), 'fix');
    execSync('git add -A && git commit -q -m "fix"', wtOpts);
    const head = execSync('git rev-parse HEAD', wtOpts).trim();
    // La sesión integró su trabajo antes de cerrar.
    execSync(`git merge -q --ff-only ${branch}`, opts);
    execSync(`git worktree remove --force ${wt}`, opts);
    execSync(`git branch -D ${branch}`, opts);

    const session = makeSession({
      session_id: sid, task_id: 'task-merged', task_ref: 'KODO-68',
      project_path: repo, worktree_path: wt, branch, branch_head: head,
    });
    const { logger, events } = makeMemLogger();

    await runSessionEndHook(
      { session_id: sid, cwd: repo },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: async () => ({ captured: false, reason: 'merged', entry: null }),
        existsFn: () => false,
        removeSessionFn: () => {},
        cmux: stubCmux,
        loggerFactory: () => logger,
      },
    );

    assert.ok(
      !execSync('git branch --list', opts).includes(branch),
      'una rama cuyo trabajo ya está en main NO se resucita',
    );
    assert.ok(
      !events.find((e) => e.fields?.event === 'worktree.branch.restored'),
      'sin rescate no hay evento de rescate',
    );
  });
});
