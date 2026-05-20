// @ts-check
//
// test/session/find-session.test.js — Phase 30 LIFE-01 SC#3 coverage.
//
// Valida que `findSession` (`src/session/state.js`) escanea AMBOS
// `state.sessions` (activas) Y `state.history` (terminadas, FIFO 50-slot)
// retornando un tagged discriminated union
// `{ id, session, source: 'sessions' | 'history' }`.
//
// Cierra el CR-01 deferred de Phase 19. Driver real: ROMAN-132 (2026-05-15)
// confirmó state.json desync — `state.sessions = {}` mientras la sesión seguía
// viva en cmux y archivada en `state.history`. `kodo gsd verify <session-id>`
// y `kodo logs --session-of <task-id>` deben funcionar sobre sesiones que ya
// pasaron por `removeSession` (que las mueve a `state.history`).
//
// Decisiones aplicadas (de 30-CONTEXT.md):
//   - D-01: return shape tagged `{id, session, source}`.
//   - D-02: priority sessions cuando una entry aparece en ambos buckets.
//   - D-03: para history entries, `id = session.task_id` (sintetizado del
//     propio record; history es array sin key real).
//   - D-04: las 3 lookup keys (`sessionId`, `workspaceRef`, `cwd`) operan
//     idénticas sobre history (mismo shape gracias a removeSession).
//   - D-10: tests viven en subdirectorio nuevo `test/session/` (lockeado por
//     SC#3 ROADMAP).
//   - D-11: prefijo describe `'LIFE-01 — '` per convención de phases recientes
//     (Phase 29 REPORT-NN, QUICK-08).
//
// HOME-isolation scaffold copiado de test/session-of-resolver.test.js
// lineas 101-134 (mkdtempSync + HOME override + dynamic import POST-HOME).
// Crítico: `src/session/state.js` calcula `KODO_DIR` al module-load time
// desde `homedir()`. El dynamic import DEBE ocurrir DESPUÉS de
// `process.env.HOME = tmpHome`, si no, el módulo cacheado apunta al
// `~/.kodo/` real.
//

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
let findSession;
let addSession;
let removeSession;

const STATE_REL = ['.kodo', 'state.json'];

/**
 * Construye un SessionRecord con el shape canónico que addSession espera.
 * Mismos campos que test/session-of-resolver.test.js lineas 142-154.
 *
 * @param {string} sessionId
 * @param {string} taskId
 * @param {object} [overrides]
 */
function buildSession(sessionId, taskId, overrides = {}) {
  return {
    session_id: sessionId,
    task_id: taskId,
    task_ref: 'KL-' + taskId,
    gsd: false,
    status: 'running',
    provider: 'plane',
    project_id: 'p1',
    project_path: overrides.project_path || tmpHome,
    workspace_ref: overrides.workspace_ref || 'workspace:' + taskId,
    started_at: new Date().toISOString(),
    summary: 'session ' + taskId,
    ...overrides,
  };
}

describe('LIFE-01 — findSession scans history', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-life01-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Dynamic import POST-HOME — garantiza que KODO_DIR del módulo cacheado
    // resuelve al tmpdir aislado. Cualquier import transitivo posterior
    // recibe la misma instancia cacheada (CR-02 Phase 16).
    const stateMod = await import('../../src/session/state.js');
    findSession = stateMod.findSession;
    addSession = stateMod.addSession;
    removeSession = stateMod.removeSession;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  afterEach(() => {
    // Reset state.json a vacío SIN history field — verifica que el defensive
    // Array.isArray guard funciona para legacy state.json files.
    writeFileSync(
      join(tmpHome, ...STATE_REL),
      JSON.stringify({ schema_version: 2, sessions: {} }) + '\n',
    );
  });

  // ---------------------------------------------------------------------
  // Test 1 (D-01): source 'sessions' cuando la sesión está activa
  // ---------------------------------------------------------------------
  it('returns {source: "sessions"} when session is active', () => {
    const sessionId = 'sess-life01-active';
    const taskId = 'task-active';
    const session = buildSession(sessionId, taskId);
    addSession(taskId, session);

    const result = findSession({ sessionId });

    assert.ok(result, 'expected non-null result for active session');
    assert.equal(result.source, 'sessions', 'source must be "sessions"');
    assert.equal(result.id, taskId, 'id must be the sessions-bucket key (task_id)');
    assert.equal(result.session.session_id, sessionId);
    assert.equal(result.session.task_id, taskId);
  });

  // ---------------------------------------------------------------------
  // Test 2 (D-01 + D-03): source 'history' cuando la sesión fue removida
  // ---------------------------------------------------------------------
  it('returns {source: "history"} when session was removed', () => {
    const sessionId = 'sess-life01-archived';
    const taskId = 'task-archived';
    const session = buildSession(sessionId, taskId);
    addSession(taskId, session);
    removeSession(taskId);

    const result = findSession({ sessionId });

    assert.ok(result, 'expected non-null result for archived session');
    assert.equal(result.source, 'history', 'source must be "history" after removeSession');
    // D-03: id sintetizado desde el record (history es array sin key real).
    assert.equal(result.id, taskId, 'id must be session.task_id for history entries');
    assert.equal(result.session.session_id, sessionId);
    assert.equal(
      typeof result.session.ended_at,
      'string',
      'history entry must preserve ended_at timestamp from removeSession',
    );
  });

  // ---------------------------------------------------------------------
  // Test 3 (D-02): priority sessions over history en window degenerada
  // ---------------------------------------------------------------------
  it('priorities sessions over history when entry exists in both', () => {
    const sharedSessionId = 'sess-shared-id';
    const taskIdSessions = 'task-X';
    const sessionsEntry = buildSession(sharedSessionId, taskIdSessions, {
      summary: 'in sessions bucket',
    });
    const historyEntry = {
      ...buildSession(sharedSessionId, taskIdSessions, {
        summary: 'in history bucket',
      }),
      ended_at: '2026-05-15T12:00:00.000Z',
    };

    // Manual seed: ambos buckets contienen el mismo session_id.
    writeFileSync(
      join(tmpHome, ...STATE_REL),
      JSON.stringify({
        schema_version: 2,
        sessions: { [taskIdSessions]: sessionsEntry },
        history: [historyEntry],
      }) + '\n',
    );

    const result = findSession({ sessionId: sharedSessionId });

    assert.ok(result, 'expected non-null result when entry exists in both');
    assert.equal(
      result.source,
      'sessions',
      'D-02 priority sessions: sessions bucket wins in degenerate window',
    );
    assert.equal(result.session.summary, 'in sessions bucket');
  });

  // ---------------------------------------------------------------------
  // Test 4 (null path): findSession ausente retorna null
  // ---------------------------------------------------------------------
  it('returns null when session is in neither bucket', () => {
    // afterEach ya dejó state.json limpio sin history.
    const result = findSession({ sessionId: 'never-existed' });
    assert.equal(result, null);
  });
});
