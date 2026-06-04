// @ts-check
// Phase 41 Plan 02: cobertura hermética DI del módulo puro de saneo doctor.js.
//
// Espejo del estilo de worktree-cleanup.test.js / reconcile: logger en memoria,
// dependencias 100% inyectadas (loadState / readLock / isPidAlive / listLogFiles
// / statFile / listWorktreeDirs / now / cleanupWorktree / removeSession /
// unlinkFile / gitFn), CERO spawn real, CERO disco real (todo via stubs).
//
// scan() — pureza, detección de las 4 categorías, scoping a .bg-shell + state.json,
// state machine del lock, reuso del cutoff de retención, protected[] de los vivos.
// execute() — re-check de liveness por acción destructiva (TOCTOU), live-guard,
// fail-open per item, scoping por taskId (logs excluidos), shape distinto de scan.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { scan, execute } from '../src/gsd/doctor.js';

const MS_PER_DAY = 86_400_000;
const NOW = 1_700_000_000_000; // epoch ms fijo para los tests
const PROJECT = '/repo/proj';

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

/**
 * Construye un set de deps DI con defaults "clean" (nada que sanear), sobreescribibles.
 */
function makeDeps(overrides = {}) {
  const { logger } = makeMemLogger();
  return {
    loadState: () => ({ schema_version: 3, sessions: {}, history: [] }),
    listLockProjects: () => [], // por defecto sin locks (evita leer el .kodo.lock real del cwd)
    readLock: () => null,
    isPidAlive: () => false,
    listLogFiles: () => [], // [{ sessionId, path, mtimeMs }]
    statFile: (p) => ({ mtimeMs: NOW }),
    listWorktreeDirs: () => [], // [{ sessionId, path, projectPath }]
    now: () => NOW,
    logger,
    ...overrides,
  };
}

describe('Phase 41 Plan 02: scan() — pure 4-category detection', () => {
  it('clean state → all categories empty, hasGarbage === false', () => {
    const deps = makeDeps();
    const report = scan(deps);
    assert.deepEqual(report.worktrees, []);
    assert.deepEqual(report.zombies, []);
    assert.deepEqual(report.locks, []);
    assert.deepEqual(report.logs, []);
    assert.equal(report.hasGarbage, false);
  });

  it('is pure: two calls do not mutate injected state', () => {
    const state = { schema_version: 3, sessions: { 't1': { task_id: 't1', session_id: 's1', alive: false, project_path: PROJECT, worktree_path: `${PROJECT}/.bg-shell/s1` } }, history: [] };
    const snapshot = JSON.parse(JSON.stringify(state));
    const deps = makeDeps({ loadState: () => state });
    scan(deps);
    scan(deps);
    assert.deepEqual(state, snapshot, 'scan must not mutate injected state');
  });

  it('flags a .bg-shell dir as orphan only when its session has no live session', () => {
    const state = {
      schema_version: 3,
      sessions: {
        // live session — its worktree must be protected, never flagged
        't-live': { task_id: 't-live', session_id: 's-live', alive: true, project_path: PROJECT, worktree_path: `${PROJECT}/.bg-shell/s-live` },
      },
      history: [],
    };
    const deps = makeDeps({
      loadState: () => state,
      listWorktreeDirs: () => [
        { sessionId: 's-live', path: `${PROJECT}/.bg-shell/s-live`, projectPath: PROJECT },
        { sessionId: 's-orphan', path: `${PROJECT}/.bg-shell/s-orphan`, projectPath: PROJECT },
      ],
    });
    const report = scan(deps);
    assert.equal(report.worktrees.length, 1);
    assert.equal(report.worktrees[0].id, 's-orphan');
    assert.equal(report.worktrees[0].action, 'remove');
    // live session's worktree reported under protected, never worktrees
    assert.ok(report.protected.sessions.some((s) => s.id === 's-live'));
    assert.ok(!report.worktrees.some((w) => w.id === 's-live'));
    assert.equal(report.hasGarbage, true);
  });

  it('flags a state.json entry with alive===false as a zombie', () => {
    const state = {
      schema_version: 3,
      sessions: {
        't-zombie': { task_id: 't-zombie', session_id: 's-z', alive: false, project_path: PROJECT },
      },
      history: [],
    };
    const deps = makeDeps({ loadState: () => state });
    const report = scan(deps);
    assert.equal(report.zombies.length, 1);
    assert.equal(report.zombies[0].id, 't-zombie');
  });

  it('flags a hung lock when PID dead', () => {
    const lock = { session_id: 's1', task_id: 't1', task_ref: 'KL-1', pid: 4242, acquired_at: new Date(NOW).toISOString(), ttl_hours: 4 };
    const deps = makeDeps({
      listLockProjects: () => [PROJECT],
      readLock: () => lock,
      isPidAlive: (pid) => false, // dead
    });
    const report = scan(deps);
    assert.equal(report.locks.length, 1);
    assert.equal(report.locks[0].action, 'steal');
  });

  it('flags a hung lock when TTL exceeded even if PID alive', () => {
    const acquired = new Date(NOW - 5 * 3600_000).toISOString(); // 5h ago, ttl 4h
    const lock = { session_id: 's1', task_id: 't1', task_ref: 'KL-1', pid: 4242, acquired_at: acquired, ttl_hours: 4 };
    const deps = makeDeps({
      listLockProjects: () => [PROJECT],
      readLock: () => lock,
      isPidAlive: () => true,
    });
    const report = scan(deps);
    assert.equal(report.locks.length, 1);
    assert.equal(report.locks[0].action, 'steal');
  });

  it('keeps a live-PID + TTL-ok lock under protected, action keep', () => {
    const lock = { session_id: 's1', task_id: 't1', task_ref: 'KL-1', pid: 4242, acquired_at: new Date(NOW).toISOString(), ttl_hours: 4 };
    const deps = makeDeps({
      listLockProjects: () => [PROJECT],
      readLock: () => lock,
      isPidAlive: () => true,
    });
    const report = scan(deps);
    assert.deepEqual(report.locks, []);
    assert.ok(report.protected.locks.some((l) => l.action === 'keep'));
  });

  it('flags old ndjson of a non-live session, never the live session log', () => {
    const oldMs = NOW - 8 * MS_PER_DAY;   // past 7-day cutoff
    const freshMs = NOW - 1 * MS_PER_DAY; // within cutoff
    const state = {
      schema_version: 3,
      sessions: {
        't-live': { task_id: 't-live', session_id: 's-live', alive: true, project_path: PROJECT },
      },
      history: [],
    };
    const deps = makeDeps({
      loadState: () => state,
      listLogFiles: () => [
        { sessionId: 's-old', path: '/home/.kodo/logs/s-old.ndjson', mtimeMs: oldMs },
        { sessionId: 's-live', path: '/home/.kodo/logs/s-live.ndjson', mtimeMs: oldMs }, // live → never
        { sessionId: 's-fresh', path: '/home/.kodo/logs/s-fresh.ndjson', mtimeMs: freshMs }, // within cutoff
      ],
    });
    const report = scan(deps);
    assert.equal(report.logs.length, 1);
    assert.equal(report.logs[0].id, 's-old');
    assert.equal(report.logs[0].action, 'unlink');
  });

  it('emits a doctor.scan summary event via injected logger', () => {
    const { logger, events } = makeMemLogger();
    const deps = makeDeps({ logger });
    scan(deps);
    assert.ok(events.some((e) => e.fields?.event === 'doctor.scan'));
  });

  it('never throws: a detection failure returns an empty category', () => {
    const { logger, events } = makeMemLogger();
    const deps = makeDeps({
      logger,
      listWorktreeDirs: () => { throw new Error('readdir boom'); },
    });
    const report = scan(deps);
    assert.deepEqual(report.worktrees, []);
    // other categories still computed
    assert.equal(report.hasGarbage, false);
    assert.ok(events.some((e) => e.level === 'warn'));
  });
});

// ── execute() ────────────────────────────────────────────────────────────────

/**
 * Deps para execute(): extiende los de scan con removeSession / cleanupWorktree /
 * unlinkFile / gitFn, todos capturando llamadas para aserciones.
 */
function makeExecDeps(overrides = {}) {
  const cleanupCalls = [];
  const removeSessionCalls = [];
  const unlinkCalls = [];
  const base = makeDeps({
    cleanupWorktree: async (args) => { cleanupCalls.push(args); return { removed: true, moved_to: null, branch_deleted: true }; },
    removeSession: (taskId) => { removeSessionCalls.push(taskId); },
    unlinkFile: (p) => { unlinkCalls.push(p); },
    gitFn: () => '',
    ...overrides,
  });
  return { deps: base, cleanupCalls, removeSessionCalls, unlinkCalls };
}

describe('Phase 41 Plan 02: execute() — sanitize with per-action liveness re-check', () => {
  it('fix falsy → no-op, returns empty result shape distinct from scan', async () => {
    const { deps, cleanupCalls, unlinkCalls } = makeExecDeps();
    const result = await execute(deps, {}); // no fix
    assert.equal(cleanupCalls.length, 0);
    assert.equal(unlinkCalls.length, 0);
    // shape distinto de scan (D-04)
    assert.ok(result.worktrees && typeof result.worktrees.removed === 'number');
    assert.ok(result.locks && typeof result.locks.stolen === 'number');
    assert.ok(Array.isArray(result.errors));
  });

  it('fix=true removes an orphan worktree via cleanupWorktree', async () => {
    const state = {
      schema_version: 3,
      sessions: {},
      history: [],
    };
    const { deps, cleanupCalls } = makeExecDeps({
      loadState: () => state,
      listWorktreeDirs: () => [{ sessionId: 's-orphan', path: `${PROJECT}/.bg-shell/s-orphan`, projectPath: PROJECT }],
    });
    const result = await execute(deps, { fix: true });
    assert.equal(cleanupCalls.length, 1);
    assert.equal(cleanupCalls[0].sessionId, 's-orphan');
    assert.equal(result.worktrees.removed, 1);
  });

  it('live guard: execute does NOT touch a worktree/lock whose session is alive', async () => {
    const state = {
      schema_version: 3,
      sessions: {
        't-live': { task_id: 't-live', session_id: 's-live', alive: true, project_path: PROJECT, worktree_path: `${PROJECT}/.bg-shell/s-live` },
      },
      history: [],
    };
    const lock = { session_id: 's-live', task_id: 't-live', task_ref: 'KL-1', pid: 4242, acquired_at: new Date(NOW).toISOString(), ttl_hours: 4 };
    const { deps, cleanupCalls, unlinkCalls } = makeExecDeps({
      loadState: () => state,
      listWorktreeDirs: () => [{ sessionId: 's-live', path: `${PROJECT}/.bg-shell/s-live`, projectPath: PROJECT }],
      listLockProjects: () => [PROJECT],
      readLock: () => lock,
      isPidAlive: () => true, // PID vivo
    });
    const result = await execute(deps, { fix: true });
    assert.equal(cleanupCalls.length, 0, 'must not remove a live worktree');
    assert.equal(unlinkCalls.length, 0, 'must not steal a live lock');
    assert.equal(result.locks.kept, 1);
  });

  it('TOCTOU: re-checks liveness at execute-time, not from scan snapshot', async () => {
    // La sesión está "alive===false" en el state que scan vería, pero entre scan
    // y execute pasa a viva. execute re-detecta y debe SALTARLA.
    let aliveFlag = false;
    const makeState = () => ({
      schema_version: 3,
      sessions: {
        't1': { task_id: 't1', session_id: 's1', get alive() { return aliveFlag; }, project_path: PROJECT, worktree_path: `${PROJECT}/.bg-shell/s1` },
      },
      history: [],
    });
    const { deps, cleanupCalls } = makeExecDeps({
      loadState: () => makeState(),
      listWorktreeDirs: () => [{ sessionId: 's1', path: `${PROJECT}/.bg-shell/s1`, projectPath: PROJECT }],
    });
    // scan ve la sesión muerta (sería huérfana)...
    aliveFlag = false;
    const report = scan(deps);
    assert.equal(report.worktrees.length, 1);
    // ...pero justo antes de execute, la sesión revive:
    aliveFlag = true;
    const result = await execute(deps, { fix: true });
    assert.equal(cleanupCalls.length, 0, 'execute must re-detect and skip the now-live worktree');
    assert.equal(result.worktrees.skipped, 1);
  });

  it('fail-open: one item throwing does not abort the sweep', async () => {
    const state = {
      schema_version: 3,
      sessions: {},
      history: [],
    };
    const { deps, cleanupCalls } = makeExecDeps({
      loadState: () => state,
      listWorktreeDirs: () => [
        { sessionId: 's-boom', path: `${PROJECT}/.bg-shell/s-boom`, projectPath: PROJECT },
        { sessionId: 's-ok', path: `${PROJECT}/.bg-shell/s-ok`, projectPath: PROJECT },
      ],
      cleanupWorktree: async (args) => {
        cleanupCalls.push(args);
        if (args.sessionId === 's-boom') throw new Error('cleanup boom');
        return { removed: true, moved_to: null, branch_deleted: true };
      },
    });
    const result = await execute(deps, { fix: true });
    assert.equal(cleanupCalls.length, 2, 'second item still processed after first throws');
    assert.equal(result.worktrees.removed, 1);
    assert.ok(result.errors.length >= 1, 'error captured in result.errors');
  });

  it('steals a hung lock via unlinkFile', async () => {
    const lock = { session_id: 's1', task_id: 't1', task_ref: 'KL-1', pid: 4242, acquired_at: new Date(NOW).toISOString(), ttl_hours: 4 };
    const { deps, unlinkCalls } = makeExecDeps({
      listLockProjects: () => [PROJECT],
      readLock: () => lock,
      isPidAlive: () => false, // dead → steal
    });
    const result = await execute(deps, { fix: true });
    assert.equal(unlinkCalls.length, 1);
    assert.ok(unlinkCalls[0].includes('.kodo.lock'));
    assert.equal(result.locks.stolen, 1);
  });

  it('unlinks old logs (whole, via unlinkFile)', async () => {
    const oldMs = NOW - 8 * MS_PER_DAY;
    const { deps, unlinkCalls } = makeExecDeps({
      listLogFiles: () => [{ sessionId: 's-old', path: '/home/.kodo/logs/s-old.ndjson', mtimeMs: oldMs }],
    });
    const result = await execute(deps, { fix: true });
    assert.equal(unlinkCalls.length, 1);
    assert.equal(unlinkCalls[0], '/home/.kodo/logs/s-old.ndjson');
    assert.equal(result.logs.unlinked, 1);
  });

  it('removes zombie session entries via removeSession', async () => {
    const state = {
      schema_version: 3,
      sessions: { 't-z': { task_id: 't-z', session_id: 's-z', alive: false, project_path: PROJECT } },
      history: [],
    };
    const { deps, removeSessionCalls } = makeExecDeps({ loadState: () => state });
    const result = await execute(deps, { fix: true });
    assert.deepEqual(removeSessionCalls, ['t-z']);
    assert.equal(result.zombies.removed, 1);
  });

  it('execute({taskId}) scopes to one session and unlinks NO logs (D-05)', async () => {
    const state = {
      schema_version: 3,
      sessions: {
        't-target': { task_id: 't-target', session_id: 's-target', alive: false, project_path: PROJECT, worktree_path: `${PROJECT}/.bg-shell/s-target` },
        't-other': { task_id: 't-other', session_id: 's-other', alive: false, project_path: PROJECT, worktree_path: `${PROJECT}/.bg-shell/s-other` },
      },
      history: [],
    };
    const oldMs = NOW - 8 * MS_PER_DAY;
    const { deps, cleanupCalls, removeSessionCalls, unlinkCalls } = makeExecDeps({
      loadState: () => state,
      listWorktreeDirs: () => [
        { sessionId: 's-target', path: `${PROJECT}/.bg-shell/s-target`, projectPath: PROJECT },
        { sessionId: 's-other', path: `${PROJECT}/.bg-shell/s-other`, projectPath: PROJECT },
      ],
      listLockProjects: () => [PROJECT],
      readLock: () => ({ session_id: 's-target', task_id: 't-target', task_ref: 'KL-1', pid: 9, acquired_at: new Date(NOW).toISOString(), ttl_hours: 4 }),
      isPidAlive: () => false,
      // a stale log exists, but taskId scope must NOT touch logs
      listLogFiles: () => [{ sessionId: 's-target', path: '/home/.kodo/logs/s-target.ndjson', mtimeMs: oldMs }],
    });
    const result = await execute(deps, { fix: true, taskId: 't-target' });
    // only the target worktree
    assert.equal(cleanupCalls.length, 1);
    assert.equal(cleanupCalls[0].sessionId, 's-target');
    // only the target session entry removed
    assert.deepEqual(removeSessionCalls, ['t-target']);
    // NO logs unlinked under taskId scope (logs are global retention, D-05)
    assert.equal(unlinkCalls.filter((p) => p.endsWith('.ndjson')).length, 0);
    assert.equal(result.logs.unlinked, 0);
  });

  it('never throws at top level: returns partial result + errors on internal failure', async () => {
    const { deps } = makeExecDeps({
      loadState: () => { throw new Error('state boom'); },
    });
    const result = await execute(deps, { fix: true });
    assert.ok(Array.isArray(result.errors));
    // no throw escaped
  });
});
