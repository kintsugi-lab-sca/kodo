// @ts-check
//
// test/adopt.test.js — Phase 53 Plan 02 (BIDIR-03, BIDIR-04, BIDIR-05, BIDIR-08).
//
// Unit coverage for the deterministic 0-token adoption core `src/adopt.js`:
// `adoptSession` (async orchestrator, 5-state never-throws discriminant),
// `buildSessionFromAdoption` (pure SessionRecord builder mirroring
// `buildSessionFromTask`), and `sanitizeAdoptionData` (pure backstop).
//
// HOME-isolation scaffold copied from test/session/find-session.test.js:76-103
// (mkdtempSync + HOME override + DYNAMIC import POST-HOME). Critical: `adopt.js`
// transitively imports `src/session/state.js`, which caches STATE_PATH from
// `KODO_DIR` at module-load time. The dynamic import MUST happen AFTER
// `process.env.HOME = tmpHome`, else the cached module points at the real
// `~/.kodo/` (Pitfall 5).
//
// DI for PERSIST_FAILED (BIDIR-05 / D-03): adoptSession accepts a second
// `deps = { addSession, findSession }` arg defaulting to the real state.js
// imports, so a throwing addSession can be injected without making the real
// state.json unwritable.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { basename, join } from 'node:path';

let tmpHome;
let origHome;
let adoptSession;
let buildSessionFromAdoption;
let sanitizeAdoptionData;

const STATE = ['.kodo', 'state.json'];

/** Canonical TaskItem shape returned by provider.createTask (already normalized). */
const fakeTaskItem = {
  id: 'KL-99',
  ref: 'KL-99',
  title: 'adopt smoke',
  url: 'https://x/KL-99',
  projectId: 'p1',
  projectName: 'Proj',
};

/** Minimal provider exposing the optional createTask capability. */
const fakeProvider = { createTask: async () => fakeTaskItem };

/** Base args for a successful adopt; cwd === projectPath so the guard fires on re-run. */
function baseArgs(overrides = {}) {
  return {
    provider: fakeProvider,
    providerName: 'plane',
    workspaceRef: 'w:1',
    cwd: '/dev/foo',
    sessionId: 's1',
    projectId: 'p1',
    projectPath: '/dev/foo',
    ...overrides,
  };
}

describe('Phase 53 Plan 02 — src/adopt.js (BIDIR-03/04/05/08)', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-adopt-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // DYNAMIC import POST-HOME — see header (Pitfall 5).
    const mod = await import('../src/adopt.js');
    adoptSession = mod.adoptSession;
    buildSessionFromAdoption = mod.buildSessionFromAdoption;
    sanitizeAdoptionData = mod.sanitizeAdoptionData;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  afterEach(() => {
    // Reset state.json to a clean v3 shape between cases — each test starts empty.
    writeFileSync(
      join(tmpHome, ...STATE),
      JSON.stringify({ schema_version: 3, sessions: {}, history: [] }) + '\n',
    );
  });

  // ---------------------------------------------------------------------
  // BIDIR-03: UNSUPPORTED — provider without createTask, POST never reached.
  // ---------------------------------------------------------------------
  it('UNSUPPORTED when provider lacks createTask (createTask never reached)', async () => {
    const r = await adoptSession(baseArgs({ provider: {} }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'UNSUPPORTED');
  });

  // ---------------------------------------------------------------------
  // BIDIR-03/04: ok:true seeds the row + reconcile-owned/GSD omission invariant.
  // ---------------------------------------------------------------------
  it('ok:true seeds the state.json row and omits reconcile-owned + GSD fields', async () => {
    const r = await adoptSession(baseArgs());
    assert.equal(r.ok, true);
    assert.equal(r.session.status, 'running');
    // Invariant: reconcileTick is the sole writer of these — adopt must NOT seed them.
    assert.equal(r.session.dead_since, undefined);
    assert.equal(r.session.alive, undefined);
    assert.equal(r.session.last_seen_alive, undefined);
    assert.equal(r.session.worktree_path, undefined);
    assert.equal(r.session.gsd, undefined);
  });

  // ---------------------------------------------------------------------
  // BIDIR-04: ALREADY_ADOPTED — re-adopt same args, no second createTask POST.
  // ---------------------------------------------------------------------
  it('ALREADY_ADOPTED on second adopt with no second createTask call', async () => {
    let calls = 0;
    const counting = {
      createTask: async () => {
        calls += 1;
        return fakeTaskItem;
      },
    };
    const args = baseArgs({ provider: counting });
    const r1 = await adoptSession(args);
    assert.equal(r1.ok, true);

    const r2 = await adoptSession(args);
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'ALREADY_ADOPTED');
    assert.equal(calls, 1, 'createTask must NOT be called the second time');
  });

  // ---------------------------------------------------------------------
  // BIDIR-05 / D-03: PERSIST_FAILED carries task_id + task_url (LOUD orphan).
  // ---------------------------------------------------------------------
  it('PERSIST_FAILED carries task_id + task_url when addSession throws', async () => {
    const throwingAddSession = () => {
      throw new Error('disk full');
    };
    const r = await adoptSession(baseArgs(), { addSession: throwingAddSession });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PERSIST_FAILED');
    assert.equal(r.detail.task_id, fakeTaskItem.id);
    assert.equal(r.detail.task_url, fakeTaskItem.url);
  });

  // ---------------------------------------------------------------------
  // BIDIR-03: CREATE_FAILED — provider.createTask throws LOUD, converted to code.
  // ---------------------------------------------------------------------
  it('CREATE_FAILED when provider.createTask throws (detail.message present)', async () => {
    const throwingProvider = {
      createTask: async () => {
        throw new Error('plane 422 unprocessable');
      },
    };
    const r = await adoptSession(baseArgs({ provider: throwingProvider }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'CREATE_FAILED');
    assert.equal(typeof r.detail.message, 'string');
    assert.ok(r.detail.message.length > 0);
  });

  // ---------------------------------------------------------------------
  // BIDIR-08 / D-06: sanitizeAdoptionData — title default, home redaction,
  // abs-path strip, no transcript param (structural).
  // ---------------------------------------------------------------------
  it('sanitizeAdoptionData defaults title to basename(cwd) when omitted', () => {
    const r = sanitizeAdoptionData({ cwd: '/dev/projects/my-app' });
    assert.equal(r.title, basename('/dev/projects/my-app'));
    assert.equal(r.title, 'my-app');
  });

  it('sanitizeAdoptionData redacts homedir prefix to ~', () => {
    // Inject a fixed homedir so the assertion does not depend on the real $HOME.
    const fakeHome = '/Users/alex';
    const r = sanitizeAdoptionData(
      { cwd: '/dev/foo', title: fakeHome + '/secret' },
      () => fakeHome,
    );
    assert.equal(r.title, '~/secret');
  });

  it('sanitizeAdoptionData strips/redacts a non-home absolute path', () => {
    // A POSIX absolute path NOT under the (fake) home dir must not survive verbatim.
    const r = sanitizeAdoptionData(
      { cwd: '/dev/foo', title: 'see /Users/bob/private/notes' },
      () => '/Users/alex',
    );
    assert.notEqual(
      r.title,
      'see /Users/bob/private/notes',
      'a non-home absolute path must be stripped/redacted, not forwarded verbatim',
    );
  });

  it('sanitizeAdoptionData applies the same rules to description when present', () => {
    const fakeHome = '/Users/alex';
    const r = sanitizeAdoptionData(
      { cwd: '/dev/foo', title: 't', description: fakeHome + '/notes.md' },
      () => fakeHome,
    );
    assert.equal(r.description, '~/notes.md');
  });

  // CR-01 regression: the path-sanitization backstop must close the documented
  // leak shapes. Each input crosses the local→external trust boundary and MUST
  // NOT survive with filesystem layout intact.
  it('sanitizeAdoptionData redacts //double-slash absolute paths (CR-01)', () => {
    const r = sanitizeAdoptionData(
      { cwd: '/dev/foo', title: '//etc/secret' },
      () => '/Users/alex',
    );
    assert.equal(r.title, '<path>', '//-rooted runs must not survive verbatim');
    assert.ok(!r.title.includes('etc/secret'));
  });

  it('sanitizeAdoptionData redacts a path after a bare colon key:/abs (CR-01)', () => {
    const r = sanitizeAdoptionData(
      { cwd: '/dev/foo', title: 'path:/Users/bob/x' },
      () => '/Users/alex',
    );
    assert.ok(!r.title.includes('/Users/bob/x'), 'key:/abs must be redacted, not spared as a URL');
    assert.equal(r.title, 'path:<path>');
  });

  it('sanitizeAdoptionData does NOT corrupt a superset-username path (CR-01)', () => {
    // home '/Users/alex' must NOT partial-match '/Users/alexandra/...' — the old
    // naive split() produced '~andra/secret' (partial leak + nonsense path).
    const r = sanitizeAdoptionData(
      { cwd: '/dev/foo', title: '/Users/alexandra/secret' },
      () => '/Users/alex',
    );
    assert.ok(!r.title.startsWith('~andra'), 'must not corrupt into ~andra/...');
    assert.ok(!r.title.includes('andra/secret'), 'sibling-user tail must not leak');
    assert.equal(r.title, '<path>');
  });

  it('sanitizeAdoptionData still strips abs paths when home is empty (CR-01)', () => {
    // A stubbed/containerized homedirFn returning '' must NOT disable the abs-path
    // strip — home redaction is skipped safely, step (2) still fires.
    const r = sanitizeAdoptionData(
      { cwd: '/dev/foo', title: 'see /Users/bob/private/notes' },
      () => '',
    );
    assert.ok(!r.title.includes('/Users/bob/private/notes'), 'empty home must not widen the leak');
    assert.equal(r.title, 'see <path>');
  });

  it('sanitizeAdoptionData spares genuine URLs while redacting abs paths (CR-01)', () => {
    const r = sanitizeAdoptionData(
      { cwd: '/dev/foo', title: 'see https://x/KL-99 at /Users/bob/z' },
      () => '/Users/alex',
    );
    assert.ok(r.title.includes('https://x/KL-99'), 'real URLs must survive');
    assert.ok(!r.title.includes('/Users/bob/z'), 'abs path must still be redacted');
    assert.equal(r.title, 'see https://x/KL-99 at <path>');
  });

  it('sanitizeAdoptionData has no transcript parameter (structural backstop)', () => {
    // Passing a transcript key must NOT leak into the output — the function does
    // not accept/forward it (defense by construction, not a filter).
    const r = sanitizeAdoptionData({
      cwd: '/dev/foo',
      title: 'clean title',
      transcript: 'SECRET TRANSCRIPT BODY',
    });
    assert.equal(r.title, 'clean title');
    assert.equal(r.transcript, undefined);
    assert.ok(
      !JSON.stringify(r).includes('SECRET TRANSCRIPT BODY'),
      'transcript body must never appear in sanitized output',
    );
  });

  // ---------------------------------------------------------------------
  // buildSessionFromAdoption pure-shape invariant (mirrors buildSessionFromTask).
  // ---------------------------------------------------------------------
  it('buildSessionFromAdoption produces status:running and omits reconcile/GSD fields', () => {
    const s = buildSessionFromAdoption({
      task: fakeTaskItem,
      providerName: 'plane',
      workspaceRef: 'w:1',
      cwd: '/dev/foo',
      sessionId: 's1',
      projectPath: '/dev/foo',
    });
    assert.equal(s.status, 'running');
    assert.equal(s.task_id, fakeTaskItem.id);
    assert.equal(s.task_url, fakeTaskItem.url);
    assert.equal(s.project_path, '/dev/foo');
    assert.equal(s.summary, fakeTaskItem.title);
    // Reconcile-owned + GSD fields MUST be absent.
    for (const k of [
      'dead_since', 'last_seen_alive', 'alive', 'tab_alive', 'process_alive',
      'needs_input', 'state', 'gsd', 'gsd_mode', 'phase_id', 'brief', 'worktree_path',
    ]) {
      assert.equal(s[k], undefined, `buildSessionFromAdoption must omit ${k}`);
    }
  });
});
