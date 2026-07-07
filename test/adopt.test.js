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
let isGsdProject;

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
    isGsdProject = mod.isGsdProject;
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
  // WR-03: never-throws contract — hostile/edge inputs return a discriminant
  // instead of throwing before the try/catch.
  // ---------------------------------------------------------------------
  it('returns UNSUPPORTED (never throws) when provider is null (WR-03)', async () => {
    const r = await adoptSession(baseArgs({ provider: null }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'UNSUPPORTED');
  });

  it('returns INVALID_INPUT (never throws) when cwd is omitted (WR-03)', async () => {
    const args = baseArgs();
    delete args.cwd;
    const r = await adoptSession(args);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INVALID_INPUT');
    assert.ok(r.detail.missing.includes('cwd'), 'detail.missing names the absent arg');
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
  // 56-03 UAT gap-fix: the idempotency guard MUST key by sessionId (stable
  // checkpoint_id), NOT by {workspaceRef, cwd}. cmux RECYCLES workspace refs and
  // a single cwd is shared by multiple ad-hoc sessions, so keying by
  // workspaceRef/cwd falsely rejects a genuinely-new session as ALREADY_ADOPTED
  // (UAT Test 1 blocker). Consistent with Phase 55 D-06 + Phase 56 computeAdoptable.
  // ---------------------------------------------------------------------
  it('two adoptions sharing cwd+workspaceRef but DIFFERENT sessionId both succeed (UAT blocker)', async () => {
    // First adopt seeds a row at /dev/foo + w:1 + sessionId s1.
    const r1 = await adoptSession(baseArgs({ sessionId: 's1' }));
    assert.equal(r1.ok, true);

    // Second adopt: SAME cwd + SAME workspaceRef, but a genuinely-new sessionId.
    // The OLD guard ({workspaceRef, cwd}) would falsely return ALREADY_ADOPTED.
    // The sessionId-keyed guard must let this through as a real adopt.
    const r2 = await adoptSession(baseArgs({ sessionId: 's2' }));
    assert.equal(r2.ok, true, 'a new sessionId in the same cwd/workspace must NOT be ALREADY_ADOPTED');
    assert.notEqual(r2.code, 'ALREADY_ADOPTED');
  });

  it('true re-adopt (SAME sessionId) still returns ALREADY_ADOPTED', async () => {
    const args = baseArgs({ sessionId: 's-stable' });
    const r1 = await adoptSession(args);
    assert.equal(r1.ok, true);

    const r2 = await adoptSession(args);
    assert.equal(r2.ok, false, 're-adopting the SAME sessionId must be idempotent');
    assert.equal(r2.code, 'ALREADY_ADOPTED');
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
  // DELIV-03 (Task 1): recuperación idempotente por task_url. Cierra la ventana
  // PERSIST_FAILED (createTask OK pero addSession lanzó → tarea en el provider sin
  // fila local): un re-run que pasa el task_url devuelto reconcilia la fila
  // reintentando SOLO addSession, con UN SOLO createTask en total (T-71-05).
  // ---------------------------------------------------------------------
  it('re-run tras PERSIST_FAILED pasando task_url reconcilia con UN SOLO createTask (DELIV-03)', async () => {
    let calls = 0;
    const counting = {
      createTask: async () => {
        calls += 1;
        return fakeTaskItem;
      },
    };
    const throwingAddSession = () => {
      throw new Error('disk full');
    };
    // Adopt inicial: createTask crea la tarea, addSession lanza → PERSIST_FAILED{task_url}.
    const r1 = await adoptSession(baseArgs({ provider: counting }), { addSession: throwingAddSession });
    assert.equal(r1.ok, false);
    assert.equal(r1.code, 'PERSIST_FAILED');
    assert.equal(r1.detail.task_url, fakeTaskItem.url);
    assert.equal(calls, 1, 'el adopt inicial llama createTask una vez');

    // Re-run de recuperación: el caller pasa el task_url/task_id del PERSIST_FAILED;
    // addSession ya no lanza. Debe reconciliar SIN un segundo createTask.
    const r2 = await adoptSession(
      baseArgs({ provider: counting, task_url: r1.detail.task_url, task_id: r1.detail.task_id }),
      { addSession: () => {} },
    );
    assert.equal(r2.ok, true, 'la reconciliación es un éxito reutilizado');
    assert.equal(r2.reused, true, 'el retorno marca reused:true');
    assert.equal(r2.task.url, fakeTaskItem.url);
    assert.equal(calls, 1, 'createTask EXACTAMENTE una vez en total (initial + re-run)');
  });

  it('re-run de recuperación cuyo addSession vuelve a lanzar → PERSIST_FAILED, sin segundo createTask (DELIV-03)', async () => {
    let calls = 0;
    const counting = {
      createTask: async () => {
        calls += 1;
        return fakeTaskItem;
      },
    };
    const throwingAddSession = () => {
      throw new Error('disk full');
    };
    const r1 = await adoptSession(baseArgs({ provider: counting }), { addSession: throwingAddSession });
    assert.equal(r1.code, 'PERSIST_FAILED');
    assert.equal(calls, 1);

    const r2 = await adoptSession(
      baseArgs({ provider: counting, task_url: r1.detail.task_url, task_id: r1.detail.task_id }),
      { addSession: throwingAddSession },
    );
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'PERSIST_FAILED', 're-run recuperable sigue devolviendo PERSIST_FAILED');
    assert.equal(r2.detail.task_url, fakeTaskItem.url);
    assert.equal(r2.detail.hint, 'recoverable via idempotent re-run');
    assert.equal(calls, 1, 'la recuperación NO invoca createTask');
  });

  // ---------------------------------------------------------------------
  // DELIV-03 (Task 2): barrido local por task_url. Cuando una fila viva (sessions o
  // history) YA tiene el task_url candidato, la tarea está adoptada y persistida →
  // ALREADY_ADOPTED sin createTask (re-adopción de una tarea ya adoptada; distinto de
  // la ventana PERSIST_FAILED, donde la fila NO existe y se reconcilia).
  // ---------------------------------------------------------------------
  it('barrido local: fila viva en sessions con el mismo task_url → ALREADY_ADOPTED sin createTask (DELIV-03)', async () => {
    let calls = 0;
    const counting = {
      createTask: async () => {
        calls += 1;
        return fakeTaskItem;
      },
    };
    const liveRow = { task_id: 'KL-99', task_url: 'https://x/KL-99', session_id: 'otra' };
    const r = await adoptSession(
      baseArgs({ provider: counting, task_url: 'https://x/KL-99' }),
      { listSessions: () => [liveRow], listHistory: () => [] },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'ALREADY_ADOPTED');
    assert.equal(r.detail.task_id, 'KL-99');
    assert.equal(calls, 0, 'no createTask cuando la fila ya vive localmente');
  });

  it('barrido local: encuentra la fila en history (no solo sessions) → ALREADY_ADOPTED (DELIV-03)', async () => {
    let calls = 0;
    const counting = {
      createTask: async () => {
        calls += 1;
        return fakeTaskItem;
      },
    };
    const histRow = { task_id: 'KL-77', task_url: 'https://x/KL-77', ended_at: '2026-07-07T00:00:00Z' };
    const r = await adoptSession(
      baseArgs({ provider: counting, task_url: 'https://x/KL-77' }),
      { listSessions: () => [], listHistory: () => [histRow] },
    );
    assert.equal(r.code, 'ALREADY_ADOPTED');
    assert.equal(r.detail.task_id, 'KL-77');
    assert.equal(calls, 0);
  });

  it('sin match local ni task_url explícito → flujo normal createTask una vez (rama c intacta) (DELIV-03)', async () => {
    let calls = 0;
    const counting = {
      createTask: async () => {
        calls += 1;
        return fakeTaskItem;
      },
    };
    const r = await adoptSession(baseArgs({ provider: counting }), {
      listSessions: () => [],
      listHistory: () => [],
    });
    assert.equal(r.ok, true);
    assert.equal(r.reused, undefined, 'un adopt normal NO marca reused');
    assert.equal(calls, 1, 'sin task_url ni match el flujo normal crea la tarea una vez');
  });

  it('task_url presente pero SIN match local → reconcilia (recovery), no ALREADY_ADOPTED (DELIV-03)', async () => {
    let calls = 0;
    const counting = {
      createTask: async () => {
        calls += 1;
        return fakeTaskItem;
      },
    };
    const r = await adoptSession(
      baseArgs({ provider: counting, task_url: 'https://x/KL-99', task_id: 'KL-99' }),
      { listSessions: () => [], listHistory: () => [], addSession: () => {} },
    );
    assert.equal(r.ok, true);
    assert.equal(r.reused, true, 'sin fila local el task_url reconcilia (ventana PERSIST_FAILED)');
    assert.equal(calls, 0, 'la reconciliación no llama createTask');
  });

  // ---------------------------------------------------------------------
  // DELIV-03 (Task 2): regresión explícita de los 5 discriminados preexistentes +
  // el nuevo {ok:true, reused:true}. El eje sessionId y el never-throws quedan intactos.
  // ---------------------------------------------------------------------
  it('regresión: los 5 discriminados preexistentes conservan code + detail shape (DELIV-03)', async () => {
    // UNSUPPORTED{providerName}
    const u = await adoptSession(baseArgs({ provider: {} }));
    assert.equal(u.ok, false);
    assert.equal(u.code, 'UNSUPPORTED');
    assert.equal(u.detail.providerName, 'plane');

    // INVALID_INPUT{missing}
    const iaArgs = baseArgs();
    delete iaArgs.projectId;
    const ia = await adoptSession(iaArgs);
    assert.equal(ia.code, 'INVALID_INPUT');
    assert.ok(Array.isArray(ia.detail.missing) && ia.detail.missing.includes('projectId'));

    // CREATE_FAILED{message}
    const cf = await adoptSession(
      baseArgs({ provider: { createTask: async () => { throw new Error('plane 422'); } } }),
    );
    assert.equal(cf.code, 'CREATE_FAILED');
    assert.equal(typeof cf.detail.message, 'string');
    assert.ok(cf.detail.message.length > 0);

    // PERSIST_FAILED{task_id, task_url, hint, message}
    const pf = await adoptSession(baseArgs(), { addSession: () => { throw new Error('disk'); } });
    assert.equal(pf.code, 'PERSIST_FAILED');
    assert.equal(pf.detail.task_id, fakeTaskItem.id);
    assert.equal(pf.detail.task_url, fakeTaskItem.url);
    assert.equal(pf.detail.hint, 'recoverable via idempotent re-run');
    assert.equal(typeof pf.detail.message, 'string');

    // ALREADY_ADOPTED{task_id} por sessionId (eje existente intacto)
    const a1 = await adoptSession(baseArgs({ sessionId: 'reg-s' }));
    assert.equal(a1.ok, true);
    const a2 = await adoptSession(baseArgs({ sessionId: 'reg-s' }));
    assert.equal(a2.ok, false);
    assert.equal(a2.code, 'ALREADY_ADOPTED');
    assert.equal(a2.detail.task_id, fakeTaskItem.id);
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
  // WR-04: createTask payload omits `description` when absent; includes it
  // (unchanged) when provided.
  // ---------------------------------------------------------------------
  it('omits description key from createTask payload when absent (WR-04)', async () => {
    let received;
    const capturing = {
      createTask: async (payload) => {
        received = payload;
        return fakeTaskItem;
      },
    };
    const r = await adoptSession(baseArgs({ provider: capturing }));
    assert.equal(r.ok, true);
    assert.ok(!('description' in received), 'description key must be omitted when absent');
  });

  it('forwards description in createTask payload when provided (WR-04)', async () => {
    let received;
    const capturing = {
      createTask: async (payload) => {
        received = payload;
        return fakeTaskItem;
      },
    };
    const r = await adoptSession(baseArgs({ provider: capturing, description: 'a note' }));
    assert.equal(r.ok, true);
    assert.equal(received.description, 'a note');
  });

  // ---------------------------------------------------------------------
  // Phase 57 module-placement gap-fix: `module` is threaded into createTask
  // when provided (config-derived NAME, NOT sanitized), omitted otherwise.
  // ---------------------------------------------------------------------
  it('forwards module in createTask payload when provided (Phase 57)', async () => {
    let received;
    const capturing = {
      createTask: async (payload) => {
        received = payload;
        return fakeTaskItem;
      },
    };
    const r = await adoptSession(baseArgs({ provider: capturing, module: 'FVF' }));
    assert.equal(r.ok, true);
    assert.equal(received.module, 'FVF', 'module name threaded through unchanged');
  });

  it('omits module key from createTask payload when absent (Phase 57)', async () => {
    let received;
    const capturing = {
      createTask: async (payload) => {
        received = payload;
        return fakeTaskItem;
      },
    };
    const r = await adoptSession(baseArgs({ provider: capturing }));
    assert.equal(r.ok, true);
    assert.ok(!('module' in received), 'module key omitted when not supplied');
  });

  it('omits module when given a non-string/empty value (Phase 57)', async () => {
    let received;
    const capturing = {
      createTask: async (payload) => {
        received = payload;
        return fakeTaskItem;
      },
    };
    const r = await adoptSession(baseArgs({ provider: capturing, module: '' }));
    assert.equal(r.ok, true);
    assert.ok(!('module' in received), 'empty-string module omitted (never reaches provider)');
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
  it('buildSessionFromAdoption produces status:running and omits reconcile/GSD fields (non-GSD project)', () => {
    const s = buildSessionFromAdoption({
      task: fakeTaskItem,
      providerName: 'plane',
      workspaceRef: 'w:1',
      cwd: '/dev/foo',
      sessionId: 's1',
      projectPath: '/dev/foo',
      existsSyncFn: () => false, // Phase 61: project_path no-GSD → gsd fields omitidos (determinista)
    });
    assert.equal(s.status, 'running');
    assert.equal(s.task_id, fakeTaskItem.id);
    assert.equal(s.task_url, fakeTaskItem.url);
    assert.equal(s.project_path, '/dev/foo');
    assert.equal(s.summary, fakeTaskItem.title);
    // Reconcile-owned fields MUST be absent siempre; GSD fields ausentes cuando NO es proyecto GSD.
    for (const k of [
      'dead_since', 'last_seen_alive', 'alive', 'tab_alive', 'process_alive',
      'needs_input', 'state', 'gsd', 'gsd_mode', 'phase_id', 'brief', 'worktree_path',
    ]) {
      assert.equal(s[k], undefined, `buildSessionFromAdoption must omit ${k}`);
    }
  });

  // Phase 61 (PROG-04, D-3): detección GSD al adoptar.
  it('buildSessionFromAdoption marca gsd:true + gsd_mode:full cuando project_path es proyecto GSD', () => {
    const s = buildSessionFromAdoption({
      task: fakeTaskItem,
      providerName: 'plane',
      workspaceRef: 'w:1',
      cwd: '/dev/gsd',
      sessionId: 's2',
      projectPath: '/dev/gsd',
      existsSyncFn: (p) => p.endsWith('.planning/PROJECT.md') || p.endsWith('.planning/STATE.md'),
    });
    assert.equal(s.gsd, true, 'gsd:true cuando hay .planning/PROJECT.md o STATE.md');
    assert.equal(s.gsd_mode, 'full', 'gsd_mode:full para sesión adoptada GSD');
    assert.equal(s.phase_id, undefined, 'phase_id NO se deriva (un adopt no mapea a una fase del roadmap)');
  });

  it('isGsdProject: true si existe .planning/PROJECT.md o STATE.md; false si no; never-throws', () => {
    const yes = isGsdProject('/p', (path) => path.endsWith('.planning/STATE.md'));
    const yes2 = isGsdProject('/p', (path) => path.endsWith('.planning/PROJECT.md'));
    const no = isGsdProject('/p', () => false);
    assert.equal(yes, true);
    assert.equal(yes2, true);
    assert.equal(no, false);
    assert.equal(isGsdProject('', () => true), false, 'projectPath vacío → false');
    assert.equal(isGsdProject(undefined, () => true), false, 'projectPath no-string → false');
    assert.equal(isGsdProject('/p', () => { throw new Error('fs error'); }), false, 'never-throws → false');
  });
});
