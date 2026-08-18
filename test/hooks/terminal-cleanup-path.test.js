// @ts-check
// KODO-21 (capa B) / inbox 1yx98p: `session.worktree_path` se persiste con la
// convención LEGACY `<project>/.bg-shell/<sid>`, que no existe en disco — el
// worktree real de Claude Code vive en `<project>/.claude/worktrees/<sid>`.
// Antes de este fix, cada cierre de sesión emitía
// `worktree.cleanup.error{phase:status}` contra el path fantasma y dejaba el
// worktree real sin sanear. Estos tests congelan el fallback y su estrechez.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { performTerminalCleanup } from '../../src/hooks/terminal-cleanup.js';

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

describe('KODO-21 capa B: performTerminalCleanup resuelve el worktree REAL', () => {
  let tmpBase;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), 'kodo-wt-path-'));
  });

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  /**
   * Repo con el worktree donde Claude Code lo crea de verdad
   * (`.claude/worktrees/<sid>`), NO donde kodo lo persiste (`.bg-shell/<sid>`).
   */
  function makeRepo(sessionId) {
    const repo = join(tmpBase, 'repo');
    mkdirSync(repo, { recursive: true });
    const opts = { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] };
    execSync('git init -q', opts);
    execSync('git config user.email "test@kodo.local"', opts);
    execSync('git config user.name "kodo test"', opts);
    execSync('git config commit.gpgsign false', opts);
    writeFileSync(join(repo, 'seed.txt'), 'seed');
    execSync('git add -A && git commit -q -m "seed"', opts);
    const realWt = join(repo, '.claude', 'worktrees', sessionId);
    execSync(`git worktree add -b worktree-${sessionId} ${realWt}`, opts);
    return { repo, realWt, phantomWt: join(repo, '.bg-shell', sessionId) };
  }

  it('worktree_path fantasma + worktree real presente → sanea el REAL', async () => {
    const sessionId = 'sess-path-fallback';
    const { repo, realWt, phantomWt } = makeRepo(sessionId);
    const { logger, events } = makeMemLogger();

    assert.equal(existsSync(phantomWt), false, 'precondición: el path persistido no existe');

    await performTerminalCleanup({
      id: 'task-1',
      session: {
        session_id: sessionId,
        task_id: 'task-1',
        task_ref: 'KODO-21',
        project_path: repo,
        worktree_path: phantomWt,
      },
      loggerFactory: () => logger,
      removeSessionFn: () => {},
    });

    assert.equal(existsSync(realWt), false, 'el worktree REAL debe quedar saneado');
    const ok = events.find((e) => e.fields?.event === 'worktree.cleanup.ok');
    assert.ok(ok, 'must emit worktree.cleanup.ok');
    assert.equal(ok.fields.worktree_path, realWt, 'el evento apunta al worktree real');
    const statusErr = events.find(
      (e) => e.fields?.event === 'worktree.cleanup.error' && e.fields?.phase === 'status',
    );
    assert.equal(statusErr, undefined, 'ya no se emite el cleanup.error contra el path fantasma');
  });

  it('worktree_path persistido que SÍ existe → se usa tal cual (sin fallback)', async () => {
    const sessionId = 'sess-path-honest';
    const { repo } = makeRepo(sessionId);
    // Segundo worktree, esta vez en la ruta que kodo persiste.
    const persisted = join(repo, '.bg-shell', sessionId);
    execSync(`git worktree add -b kodo-${sessionId} ${persisted}`, {
      cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const realWt = join(repo, '.claude', 'worktrees', sessionId);
    const { logger, events } = makeMemLogger();

    await performTerminalCleanup({
      id: 'task-2',
      session: {
        session_id: sessionId,
        task_id: 'task-2',
        task_ref: 'KODO-21',
        project_path: repo,
        worktree_path: persisted,
      },
      loggerFactory: () => logger,
      removeSessionFn: () => {},
    });

    assert.equal(existsSync(persisted), false, 'el worktree persistido se saneó');
    assert.equal(existsSync(realWt), true, 'el otro worktree NO se toca — el fallback es estrecho');
    const ok = events.find((e) => e.fields?.event === 'worktree.cleanup.ok');
    assert.equal(ok.fields.worktree_path, persisted);
  });

  it('sin worktree_path (sesión legacy) → cleanup de worktree omitido', async () => {
    const { logger, events } = makeMemLogger();
    let removed = false;

    await performTerminalCleanup({
      id: 'task-3',
      session: {
        session_id: 'sess-legacy',
        task_id: 'task-3',
        task_ref: 'KODO-21',
        project_path: tmpBase,
      },
      loggerFactory: () => logger,
      removeSessionFn: () => { removed = true; },
    });

    assert.equal(events.length, 0, 'ningún evento de worktree para sesiones legacy (D-09)');
    assert.equal(removed, true, 'la fila de la sesión se retira igualmente');
  });
});
