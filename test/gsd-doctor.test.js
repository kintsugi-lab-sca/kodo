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
