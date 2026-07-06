// @ts-check
//
// test/server-error-hygiene.test.js — Phase 69 Plan 02, Task 2 (NET-04, T-69-05, D-09).
//
// A route handler that throws must return a neutral 500 body {error:'internal error'}.
// The thrown message (which may carry DB errors / internal detail) goes to the log
// only — it must never appear in the response body. We exercise the /comments path:
// a seeded session + a provider whose listComments throws a secret-bearing error.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'test-token-hyg-0123456789abcdef';
const SECRET_MESSAGE = 'PGERROR host=10.0.0.5 password=hunter2 internal detail';
const TASK_ID = 'task-hygiene-1';

function getFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

const throwingProvider = {
  init: async () => {},
  listPendingTasks: async () => [],
  getTaskState: async () => null,
  listComments: async () => { throw new Error(SECRET_MESSAGE); },
};

describe('server error hygiene (NET-04, T-69-05)', () => {
  /** @type {string} */ let tmpHome;
  /** @type {Record<string, string | undefined>} */ let saved;
  /** @type {any} */ let handle;
  /** @type {string} */ let base;

  before(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-hyg-'));
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Seed a session so /comments/:id reaches provider.listComments (which throws)
    // rather than short-circuiting on 404 Session not found.
    writeFileSync(
      join(tmpHome, '.kodo', 'state.json'),
      JSON.stringify({
        schema_version: 3,
        sessions: {
          [TASK_ID]: {
            task_id: TASK_ID, task_ref: 'T-1', project_id: 'proj-1',
            started_at: '2026-01-01T00:00:00.000Z', status: 'running',
          },
        },
        history: [],
      }) + '\n',
    );
    saved = { HOME: process.env.HOME, KODO_API_TOKEN: process.env.KODO_API_TOKEN };
    process.env.HOME = tmpHome;
    process.env.KODO_API_TOKEN = TOKEN;
    const port = await getFreePort();
    const config = {
      provider: 'plane',
      providers: { plane: { projects: [] } },
      server: { port, bind: '127.0.0.1' },
    };
    const mod = await import(`../src/server.js?hyg-${Date.now()}`);
    handle = await mod.startServer({
      managed: true, insecure: true, port,
      _loadConfig: () => config, _provider: throwingProvider,
    });
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    try { handle?.stopReconcile(); } catch {}
    if (handle?.server) await new Promise((r) => handle.server.close(() => r(undefined)));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it('a throwing handler → 500 with a neutral body and NO thrown detail leaked', async () => {
    const res = await fetch(`${base}/comments/${TASK_ID}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: 'internal error' });
    assert.doesNotMatch(text, /hunter2/, 'the thrown secret must not appear in the body');
    assert.equal(text.includes(SECRET_MESSAGE), false, 'no thrown message text in the response body');
  });
});
