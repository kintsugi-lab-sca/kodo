// @ts-check
//
// test/logs-session-of.test.js — cobertura del resolver `resolveSessionIdFromTaskId`.
//
// Contrato (D-20/D-21 del 07-CONTEXT.md):
//   Step 1 — loadState() busca por task_id o task_ref en ~/.kodo/state.json.
//   Step 2 — scan ~/.kodo/logs/*.ndjson: head-line-read → parse → match
//            `session.start` con `plane_task_id === taskId`.
//   Multi-match — sort DESC por timestamp, devuelve más reciente, warn stderr
//   con los descartados.
//
// Aislamiento: set HOME tmp ANTES del dynamic import del resolver (los módulos
// evaluarán KODO_DIR/STATE_PATH en tiempo de load).
//

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Fixa HOME ANTES de cargar config.js / state.js para que KODO_DIR y
// STATE_PATH se resuelvan contra un directorio temporal.
const HOME_DIR = mkdtempSync(join(tmpdir(), 'kodo-session-of-'));
process.env.HOME = HOME_DIR;

const KODO_DIR = join(HOME_DIR, '.kodo');
const LOGS_DIR = join(KODO_DIR, 'logs');
const STATE_PATH = join(KODO_DIR, 'state.json');

mkdirSync(LOGS_DIR, { recursive: true });

// Dynamic import AFTER HOME is set (config.js evalúa KODO_DIR al load).
const { resolveSessionIdFromTaskId } = await import('../src/logs/session-lookup.js');

/** Borra cualquier .ndjson del directorio de logs temporal. */
function clearLogs() {
  if (!existsSync(LOGS_DIR)) return;
  for (const f of readdirSync(LOGS_DIR)) {
    rmSync(join(LOGS_DIR, f), { force: true });
  }
}

after(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
});

describe('LOG-11: resolveSessionIdFromTaskId — step 1 (state.json)', () => {
  before(() => {
    clearLogs();
    rmSync(STATE_PATH, { force: true });
  });

  it('returns session_id cuando task_id matchea en state.sessions', async () => {
    writeFileSync(STATE_PATH, JSON.stringify({
      schema_version: 2,
      sessions: {
        'KL-42': {
          session_id: 'sess-abc',
          task_id: 'KL-42',
          task_ref: 'KL-42',
          provider: 'plane',
          project_path: '/tmp/foo',
          status: 'running',
          started_at: '2026-04-16T10:00:00.000Z',
        },
      },
    }));
    const sid = await resolveSessionIdFromTaskId('KL-42');
    assert.equal(sid, 'sess-abc');
  });

  it('también matchea por task_ref (alias humano)', async () => {
    writeFileSync(STATE_PATH, JSON.stringify({
      schema_version: 2,
      sessions: {
        'uuid-1': {
          session_id: 'sess-ref',
          task_id: 'uuid-internal',
          task_ref: 'KL-99',
          provider: 'plane',
          project_path: '/tmp/foo',
          status: 'running',
          started_at: '2026-04-16T10:00:00.000Z',
        },
      },
    }));
    const sid = await resolveSessionIdFromTaskId('KL-99');
    assert.equal(sid, 'sess-ref');
  });
});

describe('LOG-11: resolveSessionIdFromTaskId — step 2 (logs scan)', () => {
  before(() => {
    clearLogs();
    writeFileSync(STATE_PATH, JSON.stringify({ schema_version: 2, sessions: {} }));
  });

  it('encuentra session_id scaneando primera línea session.start', async () => {
    const header = JSON.stringify({
      timestamp: '2026-04-16T09:00:00.000Z',
      level: 'info',
      event: 'session.start',
      session_id: 'sess-xyz',
      plane_task_id: 'KL-77',
      provider: 'plane',
      project_path: '/tmp/xyz',
    });
    writeFileSync(join(LOGS_DIR, 'sess-xyz.ndjson'), `${header}\n{"msg":"other line"}\n`);

    const sid = await resolveSessionIdFromTaskId('KL-77');
    assert.equal(sid, 'sess-xyz');
  });

  it('ignora archivos cuya primera línea tiene JSON malformado (skip sin crash)', async () => {
    clearLogs();
    writeFileSync(join(LOGS_DIR, 'sess-bad.ndjson'), 'this-is-not-json\n');
    const valid = JSON.stringify({
      timestamp: '2026-04-16T09:00:00.000Z',
      level: 'info',
      event: 'session.start',
      session_id: 'sess-good',
      plane_task_id: 'KL-88',
      provider: 'plane',
      project_path: '/tmp/g',
    });
    writeFileSync(join(LOGS_DIR, 'sess-good.ndjson'), `${valid}\n`);
    const sid = await resolveSessionIdFromTaskId('KL-88');
    assert.equal(sid, 'sess-good');
  });

  it('returns null si no hay match ni en step 1 ni en step 2', async () => {
    clearLogs();
    writeFileSync(STATE_PATH, JSON.stringify({ schema_version: 2, sessions: {} }));
    const sid = await resolveSessionIdFromTaskId('KL-MISSING');
    assert.equal(sid, null);
  });
});

describe('LOG-11: resolveSessionIdFromTaskId — multi-match (D-21)', () => {
  before(() => {
    clearLogs();
    writeFileSync(STATE_PATH, JSON.stringify({ schema_version: 2, sessions: {} }));
  });

  it('devuelve la sesión más reciente por timestamp y warn en stderr', async (t) => {
    clearLogs();
    const older = JSON.stringify({
      timestamp: '2026-04-16T09:00:00.000Z',
      level: 'info',
      event: 'session.start',
      session_id: 'sess-old',
      plane_task_id: 'KL-DUP',
      provider: 'plane',
      project_path: '/tmp/a',
    });
    const newer = JSON.stringify({
      timestamp: '2026-04-16T11:00:00.000Z',
      level: 'info',
      event: 'session.start',
      session_id: 'sess-new',
      plane_task_id: 'KL-DUP',
      provider: 'plane',
      project_path: '/tmp/b',
    });
    writeFileSync(join(LOGS_DIR, 'sess-old.ndjson'), `${older}\n`);
    writeFileSync(join(LOGS_DIR, 'sess-new.ndjson'), `${newer}\n`);

    const captured = [];
    t.mock.method(process.stderr, 'write', (c) => { captured.push(c.toString()); return true; });

    const sid = await resolveSessionIdFromTaskId('KL-DUP');
    assert.equal(sid, 'sess-new');

    const out = captured.join('');
    assert.ok(out.includes('Multiple sessions for task KL-DUP'), `warn missing header: ${out}`);
    assert.ok(out.includes('sess-old'), `warn missing discarded: ${out}`);
    assert.ok(out.includes('Using most recent: sess-new'), `warn missing most-recent: ${out}`);
  });
});
