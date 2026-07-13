// @ts-check
//
// test/hooks/stop-idempotency.test.js — Phase 30 CR-01 closure (gap closure).
//
// Cubre el bug crítico identificado en .planning/phases/30-sessionrecord-lifecycle/30-REVIEW.md
// §CR-01: el doble-scan de findSession (Phase 30 LIFE-01) rompió la idempotencia
// natural del stop hook. Pre-Phase 30, una segunda invocación del hook (race,
// restart, reload de Claude Code) recibía `findSession() === null` y hacía return
// temprano. Post-LIFE-01, findSession encuentra también entradas archivadas en
// `state.history`, por lo que la segunda invocación re-ejecuta el cleanup completo:
//   - cmuxClient.setColor sobre workspace potencialmente reasignado
//   - markSessionStatus con from='unknown' (la entry ya no está en state.sessions)
//   - segundo session.end / state.transition espurio
//   - worktree cleanup destructivo sobre paths ya removidos
//   - segundo nudge al orchestrator
//
// El fix CR-01 (Task 2): discriminator `result.source === 'history'` en stop.js#~134
// que retorna early con console.error informativo — preserva la idempotencia
// natural del hook sin tocar findSession (que sigue útil para verify.js +
// session-start.js leyendo entries de history).
//
// Patrón scaffold: copiado verbatim de test/stop-state-transition.test.js
//   - HOME-isolation con mkdtempSync (CR-02 Phase 16 — evita pollutar state.json real)
//   - makeLogger() memSink (test/gsd-verify-integration.test.js#73-83)
//   - Cmux stub (evita conexión a cmuxd real)
//   - Dynamic import POST-HOME para que KODO_DIR resuelva al tmpdir
//
// Acceptance criteria (PLAN 30-03):
//   - Pre-fix: el test FALLA (segunda invocación SÍ emite state.transition).
//   - Post-fix: el test PASA (segunda invocación es no-op completo).

import { describe, it, before, beforeEach, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Resueltos en `before` después de fijar HOME para que KODO_DIR del módulo
// state.js apunte al tmpdir aislado (mismo patrón que stop-state-transition.test.js).
let addSession;
let removeSession;
let listHistory;
let listSessions;

/**
 * Fake logger memSink — events array sobrevive a .child(...) porque child()
 * retorna el mismo logger.
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
 * Cmux stub — registra todas las llamadas para asserts de "no setColor en
 * la segunda invocación".
 */
function makeCmuxStub() {
  const calls = [];
  return {
    stub: {
      setColor: async (args) => { calls.push({ fn: 'setColor', args }); },
      notify: async (args) => { calls.push({ fn: 'notify', args }); },
      listWorkspaces: async () => { calls.push({ fn: 'listWorkspaces' }); return ''; },
      send: async (args) => { calls.push({ fn: 'send', args }); },
    },
    calls,
  };
}

describe('stop hook — Phase 30 idempotency (CR-01)', () => {
  let tmpHome;
  let origHome;

  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-test-stop-idem-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Dynamic import POST-HOME override: state.js evalúa KODO_DIR al module
    // load. Importar AHORA garantiza que el módulo cacheado (compartido por
    // stop.js → manager.js) apunta al tmpdir.
    const stateMod = await import('../../src/session/state.js');
    addSession = stateMod.addSession;
    removeSession = stateMod.removeSession;
    listHistory = stateMod.listHistory;
    listSessions = stateMod.listSessions;
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

  // Cleanup defensivo: cualquier task_id escrito a state.json se borra siempre,
  // incluso si un assertion falla en medio del flow.
  const writtenTaskIds = [];
  afterEach(() => {
    while (writtenTaskIds.length > 0) {
      const tid = writtenTaskIds.pop();
      try { removeSession(tid); } catch {}
    }
  });

  it('second invocation skips cleanup when session is in history', async () => {
    // CR-01 scenario: session no-GSD (sin worktree_path ni gsd:true para evitar
    // que los paths de worktree/lock disparen efectos colaterales no inyectables).
    const session = {
      session_id: 's-idem-1',
      task_id: 'kodo-test-stop-idem-1',
      task_ref: 'KL-idem-1',
      gsd: false,
      status: 'running',
      project_path: '/tmp/repo-idem',
      provider: 'plane',
      project_id: 'p-idem',
      workspace_ref: 'workspace:idem-1',
      started_at: new Date().toISOString(),
      summary: 'test session idempotency',
    };
    writtenTaskIds.push(session.task_id);
    addSession(session.task_id, session);

    // Phase 58 LIFE-03: el cleanup destructivo (removeSession→history) migró del
    // Stop hook al SessionEnd hook. La idempotencia vía guard `source === 'history'`
    // ahora se ejercita sobre runSessionEndHook.
    const { runSessionEndHook } = await import('../../src/hooks/session-end.js');

    // ===== FIRST INVOCATION =====
    // Usamos el findSession real (importado por el hook) para que el flow
    // post-primera-invocación encuentre la entry en state.history de forma
    // realista (no mockeada). El cleanup natural de removeSession (dentro de
    // performTerminalCleanup) mueve la session de state.sessions → state.history.
    const { logger: logger1, events: events1 } = makeLogger();
    const { stub: cmux1, calls: cmuxCalls1 } = makeCmuxStub();
    // Phase 72 HYG-04: la PRIMERA invocación de SessionEnd sí dispara los efectos
    // cosméticos (setColor/notify/nudge) tras el cleanup — no los asertamos aquí;
    // este test cubre la IDEMPOTENCIA (la segunda invocación no debe repetirlos).
    void cmuxCalls1;
    const removeSessionCalls1 = [];

    await runSessionEndHook(
      { session_id: session.session_id, cwd: '/tmp/repo-idem' },
      {
        cmux: cmux1,
        loggerFactory: () => logger1,
        // NO inyectamos findSessionFn — usamos el real para que el state.json del
        // tmpdir refleje la transición real sessions→history que el guard explota.
        removeSessionFn: (id) => {
          removeSessionCalls1.push(id);
          removeSession(id);
        },
      },
    );

    // Sanity: primera invocación emitió el typed session.end (terminal) y removió.
    const sessionEnd1 = events1.find((e) => e.fields?.event === 'session.end');
    assert.ok(sessionEnd1, 'primera invocación de SessionEnd debe emitir session.end');
    assert.deepEqual(removeSessionCalls1, [session.task_id], 'primera invocación remueve la sesión');

    // Después del primer run, removeSession ya movió la entry a history.
    const sessionsAfterFirst = listSessions();
    const historyAfterFirst = listHistory();
    assert.equal(sessionsAfterFirst.length, 0, 'state.sessions vacío post-primera invocación');
    assert.equal(historyAfterFirst.length, 1, 'state.history tiene 1 entry post-primera invocación');
    assert.equal(
      historyAfterFirst[0].session_id,
      session.session_id,
      'entry archivada conserva session_id',
    );

    // ===== SECOND INVOCATION =====
    // Mismo session_id, segundo trigger del hook (race / restart de Claude Code).
    // findSession (real, no mockeado) AHORA encontrará la entry en
    // state.history y retornará { ..., source: 'history' }. Pre-fix, el hook
    // re-procesa todo. Post-fix CR-01, retorna early.
    const { logger: logger2, events: events2 } = makeLogger();
    const { stub: cmux2, calls: cmuxCalls2 } = makeCmuxStub();
    const removeSessionCalls2 = [];

    // La SEGUNDA invocación early-returns (source==='history') ANTES de los
    // efectos HYG-04 — cmuxCalls2 debe quedar vacío (asserts abajo).
    await runSessionEndHook(
      { session_id: session.session_id, cwd: '/tmp/repo-idem' },
      {
        cmux: cmux2,
        loggerFactory: () => logger2,
        removeSessionFn: (id) => {
          removeSessionCalls2.push(id);
          removeSession(id);
        },
      },
    );

    // ===== CR-01 ASSERTIONS =====
    // El discriminator `source === 'history'` debe haber forzado early-return.
    // Ninguno de estos side-effects debe haber ocurrido en la segunda invocación.
    const transitions2 = events2.filter((e) => e.fields?.event === 'state.transition');
    assert.equal(
      transitions2.length,
      0,
      'CR-01: segunda invocación NO debe emitir state.transition (markSessionStatus skipped)',
    );

    const sessionEnds2 = events2.filter((e) => e.fields?.event === 'session.end');
    assert.equal(
      sessionEnds2.length,
      0,
      'CR-01: segunda invocación NO debe emitir session.end',
    );

    const setColorCalls2 = cmuxCalls2.filter((c) => c.fn === 'setColor');
    assert.equal(
      setColorCalls2.length,
      0,
      'CR-01: segunda invocación NO debe llamar cmux.setColor (workspace puede estar reasignado)',
    );

    const sendCalls2 = cmuxCalls2.filter((c) => c.fn === 'send');
    assert.equal(
      sendCalls2.length,
      0,
      'CR-01: segunda invocación NO debe llamar cmux.send (nudge espurio al orchestrator)',
    );

    assert.equal(
      removeSessionCalls2.length,
      0,
      'CR-01: segunda invocación NO debe llamar removeSession (entry ya está archivada)',
    );

    // History no se duplica — sigue habiendo exactamente 1 entry.
    const historyAfterSecond = listHistory();
    assert.equal(
      historyAfterSecond.length,
      1,
      'CR-01: state.history no se duplica tras la segunda invocación',
    );
  });
});

// ─── HYG-01 (Phase 72): gate KODO_ORCHESTRATOR + pathspec del auto-commit ────
//
// handleOrchestratorStop (stop.js) auto-commitea los aprendizajes de la skill
// SOLO en la sesión orquestadora. El gate `KODO_ORCHESTRATOR === '1'` (D-06)
// cubre TODO el bloque add+commit; sin el marcador, una sesión normal del repo
// kodo hace skip silencioso (cero commits fantasma). El pathspec del commit se
// restringe a `.claude/skills/kodo-orchestrate/` en add Y commit (D-07).
//
// Se ejercita indirectamente vía runStopHook con un input SIN sesión tracked y
// `cwd = KODO_ROOT` (la rama "no session found + orchestrator" de stop.js). Se
// usa un repo git tmp real (KODO_ROOT override) para no commitear en el repo de
// verdad.
//
// KODO_ROOT se fija a NIVEL DE MÓDULO (no en `before`): stop.js evalúa
// `KODO_ROOT = process.env.KODO_ROOT || …` al load-time, y ahora session-end.js
// (usado por el describe CR-01 de arriba) importa stop.js transitivamente. Fijar
// el override aquí, en la evaluación del fichero — ANTES de que cualquier test
// ejecute su import dinámico — garantiza que stop.js congela KODO_ROOT al tmp
// repo sin depender del orden de carga entre describes.
const HYG01_REPO = mkdtempSync(join(tmpdir(), 'kodo-test-hyg01-repo-'));
const HYG01_ORIG_KODO_ROOT = process.env.KODO_ROOT;
{
  const skillDir = join(HYG01_REPO, '.claude', 'skills', 'kodo-orchestrate');
  mkdirSync(skillDir, { recursive: true });
  const git = (args) => execSync(`git ${args}`, { cwd: HYG01_REPO, encoding: 'utf-8' });
  git('init -q');
  git('config user.email test@kodo.dev');
  git('config user.name "Kodo Test"');
  git('config commit.gpgsign false');
  writeFileSync(join(skillDir, 'skill.md'), '# skill v1\n');
  git('add -A');
  git('commit -q -m "initial skill"');
  process.env.KODO_ROOT = HYG01_REPO;
}

describe('stop hook — HYG-01 orchestrator auto-commit gate', () => {
  let origOrchEnv;
  let runStopHook;

  before(async () => {
    origOrchEnv = process.env.KODO_ORCHESTRATOR;
    ({ runStopHook } = await import('../../src/hooks/stop.js'));
  });

  beforeEach(() => {
    // WR-07: aísla KODO_ORCHESTRATOR ANTES de cada test (el afterEach solo lo borra DESPUÉS).
    // Si la suite hereda KODO_ORCHESTRATOR=1 del entorno — precisamente la sesión orquestadora
    // que esta fase crea vía launch.js, o cualquier hijo suyo que corra `npm test` — el primer
    // test («sin KODO_ORCHESTRATOR → skip») entraría al auto-commit y fallaría.
    delete process.env.KODO_ORCHESTRATOR;
    // Cambio SIN commitear que el auto-commit debe capturar (reset por test:
    // el test del gate abierto commitea y deja el árbol limpio).
    writeFileSync(
      join(HYG01_REPO, '.claude', 'skills', 'kodo-orchestrate', 'skill.md'),
      `# skill learnings ${Date.now()}\n`,
    );
  });

  after(() => {
    if (HYG01_ORIG_KODO_ROOT === undefined) delete process.env.KODO_ROOT;
    else process.env.KODO_ROOT = HYG01_ORIG_KODO_ROOT;
    if (origOrchEnv === undefined) delete process.env.KODO_ORCHESTRATOR;
    else process.env.KODO_ORCHESTRATOR = origOrchEnv;
    rmSync(HYG01_REPO, { recursive: true, force: true });
  });

  afterEach(() => {
    delete process.env.KODO_ORCHESTRATOR;
  });

  function commitCount() {
    return parseInt(execSync('git rev-list --count HEAD', { cwd: HYG01_REPO, encoding: 'utf-8' }).trim(), 10);
  }

  function makeCmuxStub() {
    return {
      setColor: async () => {},
      notify: async () => {},
      listWorkspaces: async () => '',
      send: async () => {},
    };
  }

  it('sin KODO_ORCHESTRATOR → skip (no crea commit)', async () => {
    const before = commitCount();
    await runStopHook(
      { session_id: 'no-such-session', cwd: HYG01_REPO },
      { findSessionFn: () => null, cmux: makeCmuxStub() },
    );
    assert.equal(commitCount(), before, 'sin el marcador NO debe crearse ningún commit');
  });

  it('con KODO_ORCHESTRATOR=1 → alcanza el auto-commit (crea commit del subdir de la skill)', async () => {
    process.env.KODO_ORCHESTRATOR = '1';
    const before = commitCount();
    await runStopHook(
      { session_id: 'no-such-session', cwd: HYG01_REPO },
      { findSessionFn: () => null, cmux: makeCmuxStub() },
    );
    assert.equal(commitCount(), before + 1, 'con el marcador debe crearse exactamente un commit');
    // El commit contiene SOLO el fichero de la skill (pathspec restringido).
    const files = execSync('git show --name-only --pretty=format: HEAD', { cwd: HYG01_REPO, encoding: 'utf-8' })
      .trim().split('\n').filter(Boolean);
    assert.deepEqual(
      files,
      ['.claude/skills/kodo-orchestrate/skill.md'],
      'el auto-commit solo toca el subdirectorio de la skill (pathspec D-07)',
    );
  });
});
