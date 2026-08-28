// @ts-check
//
// test/server-error-hygiene.test.js — Phase 69 Plan 02, Task 2 (NET-04, T-69-05, D-09).
//
// A route handler that throws must return a neutral 500 body {error:'internal error'}.
// The thrown message (which may carry DB errors / internal detail) goes to the log
// only — it must never appear in the response body. We exercise the /comments path:
// a seeded session + a provider whose listComments throws a secret-bearing error.
//
// KODO-39 extends the file to the SECOND route that synthesizes its own 500 body:
// DELETE /sessions/{id} (dismiss). Its body is built by the pure handler in
// src/server/dismiss.js and serialized verbatim by the thin adapter in server.js
// (`res.end(JSON.stringify(body))`), so asserting the handler's body — plus the
// exact bytes the adapter would write — covers the wire contract without needing
// doctor.execute to throw for real (it is never-throws by design, Phase 41).
//
// IMPORT-ORDER LANDMINE: src/server/dismiss.js pulls in src/session/state.js, which
// freezes STATE_PATH from process.env.HOME AT MODULE LOAD. A static import here would
// resolve it against the real HOME before the /comments suite's before() hook points
// HOME at the tmp dir — the module cache is shared, so the seeded session would be
// invisible and /comments would 404 instead of 500. Hence the dynamic import inside
// each dismiss test (the handler is fully DI'd, so it never reads the real state).

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


/**
 * Swap console.error for a capturing stub: NET-04 requires the thrown detail to
 * survive server-side, so the log is part of the contract under test (and the
 * expected error line must not pollute the test output).
 */
function captureConsoleError() {
  const lines = [];
  const original = console.error;
  console.error = (...args) => { lines.push(args.join(' ')); };
  return { lines, restore() { console.error = original; } };
}

/** A DoctorResult with every counter at zero (mirror doctor.js emptyResult). */
function emptyDoctorResult() {
  return {
    worktrees: { removed: 0, moved: 0, pruned: 0, skipped: 0 },
    zombies: { removed: 0 },
    locks: { stolen: 0, kept: 0 },
    errors: [],
  };
}

describe('dismiss error hygiene — DELETE /sessions/{id} (NET-04, KODO-39)', () => {
  it('a throwing executeFn → 500 with a neutral body and NO thrown detail leaked', async () => {
    const { createDismissHandler } = await import('../src/server/dismiss.js');
    const dismiss = createDismissHandler({
      loadState: () => ({ sessions: { [TASK_ID]: { task_id: TASK_ID, alive: false } } }),
      executeFn: async () => { throw new Error(SECRET_MESSAGE); },
    });

    const logged = captureConsoleError();
    let status, body;
    try {
      ({ status, body } = await dismiss(TASK_ID));
    } finally {
      logged.restore();
    }

    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'internal error' });
    // The exact bytes server.js writes on the wire (thin adapter, server.js:512-514).
    const wire = JSON.stringify(body);
    assert.doesNotMatch(wire, /hunter2/, 'the thrown secret must not appear in the body');
    assert.equal(wire.includes(SECRET_MESSAGE), false, 'no thrown message text in the response body');
    // …but it MUST survive server-side, same as /comments (console.error).
    assert.match(logged.lines.join('\n'), /hunter2/, 'the thrown detail must reach the server log');
  });

  it('a throwing loadState → 500 with a neutral body, execute never runs', async () => {
    let executed = false;
    const { createDismissHandler } = await import('../src/server/dismiss.js');
    const dismiss = createDismissHandler({
      loadState: () => { throw new Error(SECRET_MESSAGE); },
      executeFn: async () => { executed = true; return emptyDoctorResult(); },
    });

    const logged = captureConsoleError();
    let status, body;
    try {
      ({ status, body } = await dismiss(TASK_ID));
    } finally {
      logged.restore();
    }

    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'internal error' });
    assert.equal(JSON.stringify(body).includes(SECRET_MESSAGE), false);
    assert.match(logged.lines.join('\n'), /hunter2/, 'the thrown detail must reach the server log');
    assert.equal(executed, false, 'a thrown loadState must short-circuit before execute');
  });
});
