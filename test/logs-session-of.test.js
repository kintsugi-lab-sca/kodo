// @ts-check
/**
 * LOG-11 contract tests for `--session-of <task-id>` resolver (D-20, D-21).
 *
 * Valida:
 *  - D-20 step 1: `loadState()` match directo por `task_id` en ~/.kodo/state.json.
 *  - D-20 step 2: si no hay match en state, escanea ~/.kodo/logs/*.ndjson leyendo
 *    sólo la primera línea y matcheando `plane_task_id` en `session.start`.
 *  - D-21: multi-match → devuelve la sesión más reciente (timestamp DESC) + warn
 *    a stderr listando las descartadas.
 *  - No match ni en state ni en logs → devuelve `null`.
 *
 * `../src/logs/session-lookup.js` no existe todavía — Plan 07-04 lo crea. Hasta
 * entonces este test falla con ERR_MODULE_NOT_FOUND (Nyquist-expected).
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpHome } from './helpers/logger-fixtures.js';
import { captureStderr } from './helpers/logger-sink.js';

/**
 * Escribe `~/.kodo/state.json` con el contenido dado.
 * @param {string} homeDir
 * @param {object} state
 */
function seedState(homeDir, state) {
  const dir = join(homeDir, '.kodo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
}

/**
 * Escribe `~/.kodo/logs/<sessionId>.ndjson` con una única línea NDJSON — la
 * cabecera `session.start` que el resolver paso 2 parsea head-line-only.
 * @param {string} homeDir
 * @param {string} sessionId
 * @param {object} firstLine
 */
function seedLogLines(homeDir, sessionId, firstLine) {
  const dir = join(homeDir, '.kodo', 'logs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.ndjson`), JSON.stringify(firstLine) + '\n');
}

describe('LOG-11: --session-of resolver — step 1 (state.json)', () => {
  it('returns session_id when task_id matches in state.json', async () => {
    const fx = makeTmpHome({ sessionId: 'unused', label: 'so-step1' });
    after(() => fx.cleanup());
    seedState(fx.homeDir, {
      schema_version: 2,
      sessions: {
        'KL-42': {
          session_id: 'sess-abc',
          task_id: 'KL-42',
          task_ref: 'KL-42',
          status: 'running',
        },
      },
    });
    const { resolveSessionIdFromTaskId } = await import('../src/logs/session-lookup.js');
    const out = await resolveSessionIdFromTaskId('KL-42');
    assert.equal(out, 'sess-abc');
  });
});

describe('LOG-11: --session-of resolver — step 2 (head-line scan)', () => {
  it('scans logs/ and finds session.start with matching plane_task_id', async () => {
    const fx = makeTmpHome({ sessionId: 'unused', label: 'so-step2' });
    after(() => fx.cleanup());
    seedState(fx.homeDir, { schema_version: 2, sessions: {} });
    seedLogLines(fx.homeDir, 'sess-xyz', {
      timestamp: '2026-04-16T10:00:00.000Z',
      level: 'info',
      session_id: 'sess-xyz',
      msg: 'session.start',
      event: 'session.start',
      plane_task_id: 'KL-99',
      provider: 'plane',
      project_path: '/tmp',
      transcript_path: '/tmp/t',
      started_at: '2026-04-16T10:00:00.000Z',
    });
    const { resolveSessionIdFromTaskId } = await import('../src/logs/session-lookup.js');
    const out = await resolveSessionIdFromTaskId('KL-99');
    assert.equal(out, 'sess-xyz');
  });
});

describe('D-21: multi-match picks most recent + warns descarded', () => {
  it('returns latest by timestamp DESC and warns others to stderr', async () => {
    const fx = makeTmpHome({ sessionId: 'unused', label: 'so-multi' });
    after(() => fx.cleanup());
    seedState(fx.homeDir, { schema_version: 2, sessions: {} });
    seedLogLines(fx.homeDir, 'sess-old', {
      timestamp: '2026-04-16T09:00:00.000Z',
      level: 'info',
      session_id: 'sess-old',
      msg: 'session.start',
      event: 'session.start',
      plane_task_id: 'KL-DUP',
      provider: 'plane',
      project_path: '/tmp',
      started_at: '2026-04-16T09:00:00.000Z',
    });
    seedLogLines(fx.homeDir, 'sess-new', {
      timestamp: '2026-04-16T11:00:00.000Z',
      level: 'info',
      session_id: 'sess-new',
      msg: 'session.start',
      event: 'session.start',
      plane_task_id: 'KL-DUP',
      provider: 'plane',
      project_path: '/tmp',
      started_at: '2026-04-16T11:00:00.000Z',
    });
    const { resolveSessionIdFromTaskId } = await import('../src/logs/session-lookup.js');
    const { captured, result } = await captureStderr(() =>
      resolveSessionIdFromTaskId('KL-DUP'),
    );
    assert.equal(result, 'sess-new');
    const warn = captured.join('');
    assert.ok(warn.includes('Multiple sessions'));
    assert.ok(warn.includes('sess-old'));
  });
});

describe('LOG-11: no match → null', () => {
  it('returns null when neither state nor logs contain task_id', async () => {
    const fx = makeTmpHome({ sessionId: 'unused', label: 'so-none' });
    after(() => fx.cleanup());
    seedState(fx.homeDir, { schema_version: 2, sessions: {} });
    const { resolveSessionIdFromTaskId } = await import('../src/logs/session-lookup.js');
    const out = await resolveSessionIdFromTaskId('KL-NONE');
    assert.equal(out, null);
  });
});
