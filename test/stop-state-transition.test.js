// @ts-check
//
// test/stop-state-transition.test.js — Phase 16 LOG-15 SC#5 coverage.
//
// Cubre la cadena `stop hook → markSessionStatus → state.transition` en los
// tres regímenes definidos por el plan original Phase 16.
//
// Phase 19 CR-02 update (2026-05-12):
//   - markSessionStatus se relocaliza FUERA del bloque `if (session.gsd)` para
//     que TODAS las sesiones (GSD + no-GSD) transiten a 'done' antes de
//     sessionEnd. El observable NDJSON refleja ahora el estado terminal real
//     también para sesiones no-GSD.
//   - La razón canónica del mark cambia de 'session-stop:lock-released' a
//     'session-stop' — el mark ya no ocurre PRE-lock-release, sino antes del
//     bloque entero session-end + GSD lock.
//   - Test 3 (non-GSD): ahora SÍ emite state.transition. La premisa antigua
//     "D-07: solo dentro de if (session.gsd)" queda overrideada por la
//     decisión CR-02 del code review de Phase 19 (REVIEW.md §CR-02).
//
// Regímenes actualizados:
//
//   1. full mode  — session.status='review' (post-verify) + mark
//                  → emits state.transition from='review' to='done'
//                  con reason='session-stop' (D-05 preserved; reason updated).
//   2. quick mode — session.status='running' (no verify) + mark
//                  → emits state.transition from='running' to='done'
//                  con reason='session-stop'.
//   3. non-GSD    — session.gsd=false → SÍ emite state.transition (Phase 19
//                  CR-02). El removeSession también ejecuta — full flow.
//   4. D-04 invariante MANDATORY (N-2): full y quick emiten `to='done'` fijo.
//
// El test usa el export `runStopHook(input, deps)` con DI completa (W-4):
//   findSessionFn, removeSessionFn, cmux, loggerFactory.
//
// Logger memSink mismo patrón que test/gsd-verify-integration.test.js:73-83.
//
// Deviation Rule 1: markSessionStatus en src/session/manager.js lee el `from`
// status desde listSessions() (state.json real). Para que los asserts sobre
// `from='review'`/`from='running'` funcionen sin pollutar state.json del
// usuario, los tests escriben la session vía addSession() y limpian con
// removeSession() en try/finally garantizado.
//
// CR-02 fix (Phase 16): los tests originalmente escribían sobre
// ~/.kodo/state.json REAL del desarrollador (race con sesiones productivas,
// orphans en SIGKILL/OOM, contaminación cross-job en CI compartido,
// fragilidad ante migración de schema). Mismo patrón que
// test/gsd-verify-integration.test.js: mkdtempSync + override de HOME para
// que KODO_DIR resuelva al tmpdir. Como `state.js` calcula KODO_DIR al
// import-time (`join(homedir(), '.kodo')`), la importación se hace DINÁMICA
// dentro del setup `before`, DESPUÉS de fijar HOME — todos los imports
// transitivos de state.js (incluyendo el que hace stop.js → manager.js)
// resuelven al mismo tmpdir porque comparten module cache.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Estas referencias se resuelven en `before` después de fijar HOME, para
// garantizar que KODO_DIR del módulo state.js apunta al tmpdir aislado.
let addSession;
let removeSession;

/**
 * Fake logger memSink — same pattern as test/gsd-verify-integration.test.js:73-83.
 * child() returns the same logger so events array survives .child(...) calls
 * (markSessionStatus interno hace `logger.child({component:'session', task_id})`).
 */
function makeLogger() {
  const events = [];
  const logger = {
    info: (m, f) => events.push({ level: 'info', msg: m, fields: f }),
    warn: (m, f) => events.push({ level: 'warn', msg: m, fields: f }),
    error: (m, f) => events.push({ level: 'error', msg: m, fields: f }),
    debug: (m, f) => events.push({ level: 'debug', msg: m, fields: f }),
    child: () => logger,
  };
  return { logger, events };
}

/**
 * Cmux stub — evita conexión a cmuxd real durante tests (W-4).
 * El flow de stop.js invoca setColor + notify + listWorkspaces + send tanto en
 * GSD como no-GSD. Sin stub los tests intentarían conectar al daemon real.
 */
function makeCmuxStub() {
  const calls = [];
  return {
    stub: {
      setColor: async (args) => { calls.push({ method: 'setColor', args }); },
      notify: async (args) => { calls.push({ method: 'notify', args }); },
      listWorkspaces: async () => { calls.push({ method: 'listWorkspaces' }); return ''; },
      send: async (args) => { calls.push({ method: 'send', args }); },
    },
    calls,
  };
}

/** Persist a synthetic session into state.json so markSessionStatus reads
 *  the correct `from` status. Returns a cleanup function. */
function persistSession(session) {
  addSession(session.task_id, session);
  return () => {
    try { removeSession(session.task_id); } catch {}
  };
}

describe('SC#5 LOG-15: stop hook state.transition coverage', () => {
  // CR-02 fix: tmpdir HOME override para que ~/.kodo/state.json apunte a un
  // directorio aislado, NO al state real del desarrollador. Mismo patrón que
  // gsd-verify-integration.test.js (mkdtempSync + cleanup en after).
  let tmpHome;
  let origHome;

  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-test-stop-state-'));
    process.env.HOME = tmpHome;
    // Crear ~/.kodo dentro del tmpdir (state.js no lo crea al cargar; sí lo
    // hace ensureDir() de config.js bajo loadConfig, pero state.js usa
    // KODO_DIR directamente sin asegurar la dir → mkdir explícito aquí).
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Dynamic import: state.js evalúa KODO_DIR = join(homedir(), '.kodo') al
    // module load time. Importarlo AHORA (con HOME ya overrideado) garantiza
    // que el módulo cacheado apunta al tmpdir. Cualquier otro módulo que
    // importe state.js posteriormente recibe la misma instancia cacheada.
    const stateMod = await import('../src/session/state.js');
    addSession = stateMod.addSession;
    removeSession = stateMod.removeSession;
  });

  after(() => {
    if (origHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = origHome;
    }
    if (tmpHome) {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  // Track all task_ids written to state.json so we always clean up,
  // even if a test throws before its local cleanup runs.
  const writtenTaskIds = [];
  afterEach(() => {
    while (writtenTaskIds.length > 0) {
      const tid = writtenTaskIds.pop();
      try { removeSession(tid); } catch {}
    }
  });

  it('full mode: session.status="review" + lock release → emits state.transition from=review to=done (D-05)', async () => {
    const session = {
      session_id: 's-full-1',
      task_id: 'kodo-test-stop-full-1',
      task_ref: 'KL-full-1',
      gsd: true,
      gsd_mode: 'full',
      status: 'review',
      project_path: '/tmp/repo-full',
      provider: 'plane',
      project_id: 'p-full',
      workspace_ref: 'workspace:1',
      started_at: new Date().toISOString(),
      summary: 'test session full',
    };
    writtenTaskIds.push(session.task_id);
    const cleanup = persistSession(session);
    try {
      const { logger, events } = makeLogger();
      const { stub: cmuxStub } = makeCmuxStub();
      const findSessionFn = ({ sessionId }) =>
        sessionId === session.session_id ? { id: session.task_id, session } : null;
      const removeSessionCalls = [];
      const removeSessionFn = (id) => removeSessionCalls.push(id);

      const { runStopHook } = await import('../src/hooks/stop.js');
      await runStopHook(
        { session_id: session.session_id, cwd: '/tmp/repo-full' },
        {
          findSessionFn,
          removeSessionFn,
          cmux: cmuxStub,
          loggerFactory: () => logger,
        },
      );

      const transition = events.find((e) => e.fields?.event === 'state.transition');
      assert.ok(transition, 'full mode debe emitir state.transition');
      assert.equal(transition.fields.from, 'review', 'D-05: from debe ser el status previo (review post-verify)');
      assert.equal(transition.fields.to, 'idle', 'Phase 38 D-12: to migrado de "done" a "idle" (esperando humano)');
      assert.equal(transition.fields.reason, 'session-stop:lock-released', 'Phase 38 D-12: reason migrado (lock released, no muerta)');
      assert.deepEqual(removeSessionCalls, [], 'Phase 58 LIFE-03: Stop ya NO remueve la sesión (migró a SessionEnd)');
    } finally {
      cleanup();
    }
  });

  it('quick mode: session.status="running" + lock release → emits state.transition from=running to=done', async () => {
    const session = {
      session_id: 's-quick-1',
      task_id: 'kodo-test-stop-quick-1',
      task_ref: 'KL-quick-1',
      gsd: true,
      gsd_mode: 'quick',
      status: 'running',
      project_path: '/tmp/repo-quick',
      provider: 'plane',
      project_id: 'p-quick',
      workspace_ref: 'workspace:2',
      started_at: new Date().toISOString(),
      summary: 'test session quick',
    };
    writtenTaskIds.push(session.task_id);
    const cleanup = persistSession(session);
    try {
      const { logger, events } = makeLogger();
      const { stub: cmuxStub } = makeCmuxStub();
      const findSessionFn = ({ sessionId }) =>
        sessionId === session.session_id ? { id: session.task_id, session } : null;
      const removeSessionCalls = [];
      const removeSessionFn = (id) => removeSessionCalls.push(id);

      const { runStopHook } = await import('../src/hooks/stop.js');
      await runStopHook(
        { session_id: session.session_id, cwd: '/tmp/repo-quick' },
        { findSessionFn, removeSessionFn, cmux: cmuxStub, loggerFactory: () => logger },
      );

      const transition = events.find((e) => e.fields?.event === 'state.transition');
      assert.ok(transition, 'quick mode debe emitir state.transition');
      assert.equal(transition.fields.from, 'running', 'from debe ser el status previo (running — quick no pasa por verify)');
      assert.equal(transition.fields.to, 'idle', 'Phase 38 D-12: to migrado a "idle" (mismo para ambos modos)');
      assert.equal(transition.fields.reason, 'session-stop:lock-released', 'Phase 38 D-12: reason migrado');
    } finally {
      cleanup();
    }
  });

  it('non-GSD (Phase 19 CR-02): session.gsd=false → DOES emit state.transition (mark applies to ALL sessions)', async () => {
    // Phase 19 CR-02 override: previamente el test afirmaba que non-GSD NO
    // emitía state.transition (mark estaba dentro de `if (session.gsd)`). El
    // code review de Phase 19 (REVIEW.md §CR-02) identificó que sessionEnd
    // emitía status: session.status stale para non-GSD. El fix relocaliza
    // markSessionStatus fuera del if, así que ahora TODAS las sesiones
    // transitan a 'done' antes del removeSession.
    const session = {
      session_id: 's-nogsd-1',
      task_id: 'kodo-test-stop-nogsd-1',
      task_ref: 'KL-nogsd-1',
      gsd: false,
      status: 'running',
      project_path: '/tmp/repo-nogsd',
      provider: 'plane',
      project_id: 'p-nogsd',
      workspace_ref: 'workspace:3',
      started_at: new Date().toISOString(),
      summary: 'test session no-gsd',
    };
    writtenTaskIds.push(session.task_id);
    const cleanup = persistSession(session);
    try {
      const { logger, events } = makeLogger();
      const { stub: cmuxStub } = makeCmuxStub();
      const findSessionFn = ({ sessionId }) =>
        sessionId === session.session_id ? { id: session.task_id, session } : null;
      const removeSessionCalls = [];
      const removeSessionFn = (id) => removeSessionCalls.push(id);

      const { runStopHook } = await import('../src/hooks/stop.js');
      await runStopHook(
        { session_id: session.session_id, cwd: '/tmp/repo-nogsd' },
        { findSessionFn, removeSessionFn, cmux: cmuxStub, loggerFactory: () => logger },
      );

      const transition = events.find((e) => e.fields?.event === 'state.transition');
      assert.ok(transition, 'Phase 19 CR-02: non-GSD ahora emite state.transition (mark fuera de if gsd)');
      assert.equal(transition.fields.from, 'running', 'from debe ser el status previo (running)');
      assert.equal(transition.fields.to, 'idle', 'Phase 38 D-12: to migrado a "idle" — aplica también a non-GSD');
      assert.equal(transition.fields.reason, 'session-stop:lock-released', 'Phase 38 D-12: reason migrado');
      assert.deepEqual(removeSessionCalls, [], 'Phase 58 LIFE-03: Stop ya NO remueve la sesión (migró a SessionEnd)');
    } finally {
      cleanup();
    }
  });

  // N-2 MANDATORY: D-04 es LOCKED. Este test cierra drift futuro — si un
  // implementer infiere modo y emite 'review' para quick (violando D-04),
  // este test cae con assertion message específico citando D-04.
  it('D-04 invariante MANDATORY: ambos modos full y quick emiten to="done" (no se infiere modo)', async () => {
    const fullSession = {
      session_id: 's-d04-full',
      task_id: 'kodo-test-stop-d04-full',
      task_ref: 'KL-d04-full',
      gsd: true, gsd_mode: 'full', status: 'review',
      project_path: '/tmp/d04-full', provider: 'plane',
      project_id: 'p-d04-full',
      workspace_ref: 'workspace:4',
      started_at: new Date().toISOString(),
      summary: 'd04 full',
    };
    const quickSession = {
      session_id: 's-d04-quick',
      task_id: 'kodo-test-stop-d04-quick',
      task_ref: 'KL-d04-quick',
      gsd: true, gsd_mode: 'quick', status: 'running',
      project_path: '/tmp/d04-quick', provider: 'plane',
      project_id: 'p-d04-quick',
      workspace_ref: 'workspace:5',
      started_at: new Date().toISOString(),
      summary: 'd04 quick',
    };

    const { runStopHook } = await import('../src/hooks/stop.js');

    for (const session of [fullSession, quickSession]) {
      writtenTaskIds.push(session.task_id);
      const cleanup = persistSession(session);
      try {
        const { logger, events } = makeLogger();
        const { stub: cmuxStub } = makeCmuxStub();
        const findSessionFn = ({ sessionId }) =>
          sessionId === session.session_id ? { id: session.task_id, session } : null;
        const removeSessionFn = () => {};
        await runStopHook(
          { session_id: session.session_id, cwd: session.project_path },
          { findSessionFn, removeSessionFn, cmux: cmuxStub, loggerFactory: () => logger },
        );
        const transition = events.find((e) => e.fields?.event === 'state.transition');
        assert.ok(transition, `D-04 invariante: modo ${session.gsd_mode} debe emitir state.transition`);
        assert.equal(transition.fields.to, 'idle',
          `Phase 38 D-12: to debe ser 'idle' fijo (modo ${session.gsd_mode}) — el stop hook ya no infiere modo ni marca muerta`);
        const expectedFrom = session.gsd_mode === 'full' ? 'review' : 'running';
        assert.equal(
          transition.fields.from,
          expectedFrom,
          `WR-04 Phase 16: from debe ser '${expectedFrom}' para modo ${session.gsd_mode} — Test D-04 invariante MANDATORY ya NO es estructuralmente débil`,
        );
      } finally {
        cleanup();
      }
    }
  });
});

