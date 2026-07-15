// @ts-check
//
// test/state/handoff-state.test.js — Phase 74 Plan 02 (LIVE-04, D-05/D-06).
//
// Persistence proof for `upsertTaskHandoff`, the writer of the additive
// top-level `state.tasks` key. The `NEXT:` is data of the TASK, not of the
// session: its whole value is surviving the session that produced it, so the
// NEXT session of that same task finds it (D-05 — `removeSession` archives the
// session row to `history` under a FIFO 50 cap and deletes it from
// `state.sessions`).
//
// HOME-isolation is MANDATORY and has a concrete trap: `config.js:11` evaluates
// `join(homedir(), '.kodo')` at MODULE-LOAD and `state.js:14` derives STATE_PATH
// from it. A static import of state.js in this file's header would make these
// tests write to the operator's REAL `~/.kodo`. Hence: `process.env.HOME =
// tmpHome` BEFORE a dynamic `await import(...)` inside `before()`. NEVER a
// static import of state.js.
//
// v3 seeding is equally mandatory (RESEARCH §Pitfall 5 — the silent failure of
// this plan): with no state.json on disk, `loadState():257` returns the **v2**
// shape `{schema_version: 2, sessions: {}}`; withStateLock would mutate that and
// saveState would persist a v2 file WITH `tasks`; the next loadState would fire
// `migrateStateV2toV3`, whose exhaustive rebuild (`:139-143`) DISCARDS every
// unknown key — `tasks` included. That lane is unreachable from the real hook
// (no file → findSession does not match → session-end.js:72-75 returns early)
// but is fully reachable from this test. Seed v3 always.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
let loadState;
let upsertTaskHandoff;
let STATE_PATH;

const STATE_REL = ['.kodo', 'state.json'];

/** v3-shaped empty state seed (canonical — mirrors state-writers-concurrency.test.js:47). */
function seedV3() {
  return { schema_version: 3, sessions: {}, history: [] };
}

/** Write the canonical v3 seed to the isolated state.json. */
function writeSeed(extra = {}) {
  writeFileSync(
    join(tmpHome, ...STATE_REL),
    JSON.stringify({ ...seedV3(), ...extra }, null, 2) + '\n',
  );
}

/** A collecting logger — captures events without importing logger.js. */
function spyLogger() {
  const calls = { info: [], warn: [], error: [] };
  return {
    calls,
    debug() {},
    info: (event, meta) => calls.info.push({ event, meta }),
    warn: (event, meta) => calls.warn.push({ event, meta }),
    error: (event, meta) => calls.error.push({ event, meta }),
    child() { return this; },
  };
}

describe('upsertTaskHandoff — state.tasks writer (LIVE-04, D-05/D-06)', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-handoff-state-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Dynamic import POST-HOME: the module's cached STATE_PATH resolves to the
    // isolated tmpdir. NO static import of state.js (would break isolation).
    const mod = await import('../../src/session/state.js');
    loadState = mod.loadState;
    upsertTaskHandoff = mod.upsertTaskHandoff;
    STATE_PATH = mod.STATE_PATH;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => writeSeed());
  afterEach(() => writeSeed());

  // -----------------------------------------------------------------------
  // Shape: the three-key entry lands verbatim.
  // -----------------------------------------------------------------------
  it('persists the {plan_path, next, updated_at} entry under state.tasks', () => {
    const r = upsertTaskHandoff('t1', {
      plan_path: '/p/t1.md',
      next: 'Arreglar X',
      updated_at: '2026-07-15T09:00:00.000Z',
    });

    assert.equal(r.ok, true, 'the write succeeded');
    assert.deepEqual(loadState().tasks.t1, {
      plan_path: '/p/t1.md',
      next: 'Arreglar X',
      updated_at: '2026-07-15T09:00:00.000Z',
    });
  });

  // -----------------------------------------------------------------------
  // Upsert, not append: same task_id twice → ONE entry with the later values.
  // -----------------------------------------------------------------------
  it('upserts: a second call for the same task_id replaces, never appends', () => {
    upsertTaskHandoff('t1', {
      plan_path: '/p/t1.md',
      next: 'Primero',
      updated_at: '2026-07-15T09:00:00.000Z',
    });
    upsertTaskHandoff('t1', {
      plan_path: '/p/t1-v2.md',
      next: 'Segundo',
      updated_at: '2026-07-15T10:00:00.000Z',
    });

    const tasks = loadState().tasks;
    assert.equal(Object.keys(tasks).length, 1, 'exactly ONE entry for the task');
    assert.deepEqual(tasks.t1, {
      plan_path: '/p/t1-v2.md',
      next: 'Segundo',
      updated_at: '2026-07-15T10:00:00.000Z',
    });
  });

  // -----------------------------------------------------------------------
  // Two task_ids coexist — neither clobbers the other.
  // -----------------------------------------------------------------------
  it('keeps two distinct task_ids side by side', () => {
    upsertTaskHandoff('t1', { plan_path: '/p/t1.md', next: 'Uno', updated_at: '2026-07-15T09:00:00.000Z' });
    upsertTaskHandoff('t2', { plan_path: '/p/t2.md', next: 'Dos', updated_at: '2026-07-15T09:01:00.000Z' });

    const tasks = loadState().tasks;
    assert.equal(Object.keys(tasks).length, 2, 'both entries survive');
    assert.equal(tasks.t1.next, 'Uno');
    assert.equal(tasks.t2.next, 'Dos');
  });

  // -----------------------------------------------------------------------
  // Additive guard: creates `tasks` when missing, preserves it when present.
  // -----------------------------------------------------------------------
  it('creates state.tasks when absent', () => {
    const before = loadState();
    assert.equal(before.tasks, undefined, 'the seed has no tasks key');

    upsertTaskHandoff('t1', { plan_path: '/p/t1.md', next: 'X', updated_at: '2026-07-15T09:00:00.000Z' });

    assert.ok(loadState().tasks.t1, 'the key was created');
  });

  it('preserves a pre-existing state.tasks and adds to it', () => {
    writeSeed({
      tasks: {
        viejo: { plan_path: '/p/viejo.md', next: 'Preexistente', updated_at: '2026-07-14T09:00:00.000Z' },
      },
    });

    upsertTaskHandoff('nuevo', { plan_path: '/p/nuevo.md', next: 'Nuevo', updated_at: '2026-07-15T09:00:00.000Z' });

    const tasks = loadState().tasks;
    assert.deepEqual(tasks.viejo, {
      plan_path: '/p/viejo.md',
      next: 'Preexistente',
      updated_at: '2026-07-14T09:00:00.000Z',
    }, 'the pre-existing entry is untouched');
    assert.equal(tasks.nuevo.next, 'Nuevo', 'the new entry landed');
  });

  // -----------------------------------------------------------------------
  // `next: null` — the mechanical block of D-03 has no NEXT:.
  // -----------------------------------------------------------------------
  it('persists next: null as null (mechanical block, D-03) — not undefined, not absent', () => {
    upsertTaskHandoff('t1', {
      plan_path: '/p/t1.md',
      next: null,
      updated_at: '2026-07-15T09:00:00.000Z',
    });

    const entry = loadState().tasks.t1;
    assert.ok('next' in entry, 'the key is present');
    assert.equal(entry.next, null, 'and its value is null');
  });

  it('defaults next to null when the field is omitted entirely', () => {
    upsertTaskHandoff('t1', { plan_path: '/p/t1.md', updated_at: '2026-07-15T09:00:00.000Z' });

    const entry = loadState().tasks.t1;
    assert.ok('next' in entry, 'the key is still present');
    assert.equal(entry.next, null, 'defaulted to null');
  });

  // -----------------------------------------------------------------------
  // `updated_at` is generated when omitted — the field never misses.
  // -----------------------------------------------------------------------
  it('generates an ISO-8601 updated_at when omitted', () => {
    upsertTaskHandoff('t1', { plan_path: '/p/t1.md', next: 'X' });

    const entry = loadState().tasks.t1;
    assert.equal(typeof entry.updated_at, 'string', 'the field never misses');
    assert.match(
      entry.updated_at,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      'and it is a well-formed ISO-8601 UTC timestamp',
    );
  });

  // -----------------------------------------------------------------------
  // D-06 fail-safe: lock busy → warn + {ok:false}, never a throw.
  // -----------------------------------------------------------------------
  it('with the lock held: returns the fail-safe, warns, and does NOT throw', () => {
    const lockPath = STATE_PATH + '.lock';
    // Live holder (our own pid) with a fresh acquired_at → never stale within
    // the TTL, so the retries exhaust (defaults 8 x 20ms ≈ 160ms) and the
    // primitive returns its fail-safe. Same technique as state-lock.test.js:129.
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, acquired_at: Date.now(), token: 'foreign' }),
    );

    const logger = spyLogger();
    let threw = false;
    let result;
    try {
      result = upsertTaskHandoff(
        't1',
        { plan_path: '/p/t1.md', next: 'X', updated_at: '2026-07-15T09:00:00.000Z' },
        logger,
      );
    } catch {
      threw = true;
    } finally {
      unlinkSync(lockPath);
    }

    assert.equal(threw, false, 'never throws — the close is NEVER blocked (D-06)');
    assert.equal(result.ok, false, 'returns the fail-safe {ok:false}');
    assert.equal(result.reason, 'lock-timeout', 'reason propagated verbatim');
    assert.ok(
      logger.calls.warn.some((w) => w.event === 'state.task.handoff_failed'),
      'emits the handoff_failed warn',
    );
    // WR-01: never claim a false success.
    assert.equal(
      logger.calls.info.length,
      0,
      'NO success telemetry on the failure lane (WR-01)',
    );
    assert.equal(loadState().tasks, undefined, 'and nothing was persisted');
  });

  // -----------------------------------------------------------------------
  // T-74-08: the logger carries only {task_id, reason} — never the `next`.
  // -----------------------------------------------------------------------
  it('never logs the `next` content (T-74-08)', () => {
    const logger = spyLogger();
    const secreto = 'CONTENIDO-REDACTADO-POR-EL-LLM';

    upsertTaskHandoff(
      't1',
      { plan_path: '/p/t1.md', next: secreto, updated_at: '2026-07-15T09:00:00.000Z' },
      logger,
    );

    const allLogs = JSON.stringify(logger.calls);
    assert.ok(!allLogs.includes(secreto), 'the `next` never reaches the telemetry');
    assert.ok(
      logger.calls.info.some((e) => e.event === 'state.task.handoff_saved'),
      'the success event is emitted',
    );
  });

  // -----------------------------------------------------------------------
  // The default logger is the noop: calling without one must not throw.
  // -----------------------------------------------------------------------
  it('defaults the logger to the noop (no logger argument → no throw)', () => {
    assert.doesNotThrow(() => {
      upsertTaskHandoff('t1', { plan_path: '/p/t1.md', next: 'X', updated_at: '2026-07-15T09:00:00.000Z' });
    });
  });

  // -----------------------------------------------------------------------
  // D-04 cross-milestone: the mutator touches ONLY state.tasks — never `alive`.
  // reconcileTick remains its ONLY writer.
  // -----------------------------------------------------------------------
  it('does not introduce or modify any `alive` key (D-04 cross-milestone)', () => {
    const sessionRow = {
      workspace_ref: 'workspace:1',
      session_id: 'sess-1',
      task_id: 't1',
      task_ref: 'KL-1',
      provider: 'plane',
      project_id: 'p1',
      summary: 's',
      status: 'running',
      started_at: '2026-07-15T08:00:00.000Z',
      project_path: '/dev/kodo',
      state: 'running',
      alive: true,
    };
    writeSeed({ sessions: { t1: sessionRow } });

    upsertTaskHandoff('t1', { plan_path: '/p/t1.md', next: 'X', updated_at: '2026-07-15T09:00:00.000Z' });

    assert.deepEqual(
      loadState().sessions.t1,
      sessionRow,
      'the session row is byte-for-byte untouched — `alive` included (reconcileTick is its ONLY writer)',
    );
  });

  // -----------------------------------------------------------------------
  // The additive key does NOT touch schema_version.
  // -----------------------------------------------------------------------
  it('never modifies schema_version', () => {
    upsertTaskHandoff('t1', { plan_path: '/p/t1.md', next: 'X', updated_at: '2026-07-15T09:00:00.000Z' });

    assert.equal(loadState().schema_version, 3, 'still v3 — the additive key needs no bump');
  });

  // -----------------------------------------------------------------------
  // ANTI-REGRESSION (RESEARCH §Pitfall 5) — the additivity does NOT die in the
  // migration. This is the direct proof of D-05: the write must land on a v3
  // file so `migrateStateV2toV3` (whose exhaustive rebuild at `:139-143` drops
  // every unknown key, `tasks` included) never fires on the re-read.
  // -----------------------------------------------------------------------
  it('survives the re-read: tasks intact and schema_version still 3 after reload', () => {
    upsertTaskHandoff('t1', {
      plan_path: '/p/t1.md',
      next: 'Sobrevive',
      updated_at: '2026-07-15T09:00:00.000Z',
    });

    // The RAW on-disk bytes must already be v3. If saveState had persisted a v2
    // shape (the trap: loadState returns v2 when no file exists), the very next
    // loadState would migrate and silently discard `tasks`.
    const raw = JSON.parse(readFileSync(join(tmpHome, ...STATE_REL), 'utf-8'));
    assert.equal(raw.schema_version, 3, 'the file ON DISK is v3 — migration never fires');
    assert.ok(raw.tasks.t1, 'and `tasks` is in the persisted bytes');

    // Re-read twice: migrateStateIfNeeded runs on every loadState; its v3
    // idempotency early-return (`:223`) must keep `tasks` alive.
    loadState();
    const reloaded = loadState();
    assert.equal(reloaded.schema_version, 3, 'still v3 after reload');
    assert.deepEqual(
      reloaded.tasks.t1,
      { plan_path: '/p/t1.md', next: 'Sobrevive', updated_at: '2026-07-15T09:00:00.000Z' },
      'the entry survives the reload byte for byte',
    );
  });
});
