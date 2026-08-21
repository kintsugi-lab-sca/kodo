// @ts-check
//
// test/hooks/phantom-close.test.js — KODO-27: el cierre fantasma.
//
// EL BUG (20-ago-2026, 13:23). Con dos sesiones del mismo `project_path` registradas, el
// cierre de CUALQUIER otra sesión de Claude Code cuyo `cwd` cayera dentro del repo (el
// orquestador, una sesión ad-hoc, un subagente) se imputaba a una tarea VIVA: `findSession`
// no encontraba el `session_id`, caía a `session.project_path === cwd` y devolvía la primera
// coincidencia en orden de inserción. KODO-26 acabó marcada idle, con un handoff automático
// falso en disco y movida a «In review» ocho segundos después de arrancar, con el agente
// todavía ejecutando herramientas.
//
// EL FIX. Los hooks que ESCRIBEN (`Stop`, `SessionEnd`) resuelven sólo por `session_id`. Sin
// match → no-op: cero mutaciones de `state.json`, cero llamadas al provider, cero handoff.
//
// POR QUÉ FAIL-CLOSED TAMBIÉN CON UNA SOLA SESIÓN (decisión pedida por el DoD). El guard de
// unicidad de `findSession` no basta aquí: con una única sesión registrada el fallback por cwd
// sigue siendo «único» y seguiría imputando el cierre ajeno — que es exactamente el caso del
// incidente. Además el fallback nunca sirvió al caso bueno: una sesión de kodo corre en su
// worktree (`<repo>/.claude/worktrees/<sid>`), no en `project_path`, así que jamás se matchea
// a sí misma por cwd. Se elige el no-op explícito en AMBOS casos: un cierre perdido lo
// recupera el reconcile; un cierre imputado a la sesión equivocada, no.
//
// Scaffold: HOME-isolation + dynamic import POST-HOME, copiado de
// test/hooks/stop-idempotency.test.js (CR-02 Phase 16 — nunca tocar el ~/.kodo real).
//

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = '/tmp/kodo27-repo';

let tmpHome;
let plansDir;
let origHome;
let addSession;
let removeSession;
let getSession;

/** Fake logger memSink — `events` sobrevive a `.child()` porque devuelve el mismo logger. */
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

/** Host client stub — cualquier llamada aquí ya sería un efecto de cierre indebido. */
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

/**
 * Provider espía. El DoD exige «cero llamadas al provider» en el no-op: cualquier método
 * invocado queda registrado en `calls`, así que el assert no depende de saber cuál usaría el
 * backstop. Proxy en vez de objeto literal para que también capture métodos futuros.
 */
function makeProviderSpy() {
  const calls = [];
  const spy = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined; // no confundir a await
      return async (...args) => { calls.push({ fn: String(prop), args }); return null; };
    },
  });
  return { spy, calls };
}

/** Captura de la cola de integración (KODO-26) stubeada — ver nota en stop-idempotency. */
const noCapture = async () => ({ captured: false, reason: 'stubbed', entry: null });

/** @param {string} sessionId @param {string} taskId */
function buildSession(sessionId, taskId, overrides = {}) {
  return {
    session_id: sessionId,
    task_id: taskId,
    task_ref: 'KODO-' + taskId,
    gsd: false,
    status: 'running',
    provider: 'plane',
    project_id: 'p-27',
    project_path: REPO,
    workspace_ref: 'workspace:' + taskId,
    started_at: new Date().toISOString(),
    summary: 'session ' + taskId,
    ...overrides,
  };
}

function readStateRaw() {
  return readFileSync(join(tmpHome, '.kodo', 'state.json'), 'utf8');
}

describe('KODO-27 — cierre fantasma: los hooks de cierre exigen session_id', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-27-'));
    plansDir = join(tmpHome, 'plans');
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    mkdirSync(plansDir, { recursive: true });
    // Dynamic import POST-HOME: state.js resuelve KODO_DIR al module-load.
    const stateMod = await import('../../src/session/state.js');
    addSession = stateMod.addSession;
    removeSession = stateMod.removeSession;
    getSession = stateMod.getSession;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  const writtenTaskIds = [];
  afterEach(() => {
    while (writtenTaskIds.length > 0) {
      const tid = writtenTaskIds.pop();
      try { removeSession(tid); } catch {}
    }
  });

  /** Registra N sesiones del MISMO project_path — el escenario del incidente. */
  function seed(n) {
    const sessions = [];
    for (let i = 1; i <= n; i++) {
      const s = buildSession(`s-27-${n}-${i}`, `task-27-${n}-${i}`);
      writtenTaskIds.push(s.task_id);
      addSession(s.task_id, s);
      sessions.push(s);
    }
    return sessions;
  }

  // -------------------------------------------------------------------------
  // DoD 1 — dos sesiones del mismo project_path + Stop con session_id desconocido
  // -------------------------------------------------------------------------
  it('Stop: 2 sesiones del mismo project_path + session_id desconocido → no-op, cero mutaciones', async () => {
    const [victim, other] = seed(2);
    const before = readStateRaw();

    const { logger, events } = makeLogger();
    const { stub: cmuxStub, calls: cmuxCalls } = makeCmuxStub();
    const { runStopHook } = await import('../../src/hooks/stop.js');

    // El `session_id` del orquestador: kodo no lo conoce. El `cwd` es la raíz del repo,
    // que es justo lo que el fallback comparaba contra `project_path`.
    await runStopHook(
      { session_id: 'orchestrator-unknown-id', cwd: REPO },
      { cmux: cmuxStub, loggerFactory: () => logger },
    );

    assert.equal(readStateRaw(), before, 'state.json debe quedar byte-idéntico');
    assert.equal(getSession(victim.task_id).status, 'running', 'la víctima sigue running');
    assert.equal(getSession(other.task_id).status, 'running', 'la otra sesión sigue running');
    assert.equal(
      events.filter((e) => e.fields?.event === 'state.transition').length,
      0,
      'ninguna transición de estado',
    );
    assert.equal(cmuxCalls.length, 0, 'ningún efecto sobre el host');
  });

  // -------------------------------------------------------------------------
  // DoD 1 (bis) — lo mismo sobre SessionEnd, que es el camino destructivo
  // -------------------------------------------------------------------------
  it('SessionEnd: 2 sesiones del mismo project_path + session_id desconocido → no-op, cero provider, cero handoff', async () => {
    const [victim] = seed(2);
    const before = readStateRaw();

    const { logger } = makeLogger();
    const { stub: cmuxStub, calls: cmuxCalls } = makeCmuxStub();
    const { spy: provider, calls: providerCalls } = makeProviderSpy();
    const removeSessionCalls = [];
    const gitCalls = [];

    const { runSessionEndHook } = await import('../../src/hooks/session-end.js');
    await runSessionEndHook(
      { session_id: 'ad-hoc-unknown-id', cwd: REPO },
      {
        cmux: cmuxStub,
        provider,
        plansDir,
        captureIntegrationFn: noCapture,
        getOrchestratorFn: () => null,
        loggerFactory: () => logger,
        gitFn: (cwd, args) => { gitCalls.push({ cwd, args }); return ''; },
        removeSessionFn: (id) => { removeSessionCalls.push(id); },
      },
    );

    assert.equal(readStateRaw(), before, 'state.json debe quedar byte-idéntico');
    assert.deepEqual(providerCalls, [], 'cero llamadas al provider');
    assert.deepEqual(removeSessionCalls, [], 'cero removeSession — el worktree de la víctima intacto');
    assert.deepEqual(gitCalls, [], 'cero comandos git');
    assert.equal(cmuxCalls.length, 0, 'ningún efecto sobre el host');
    assert.deepEqual(readdirSync(plansDir), [], 'ningún handoff escrito en disco');
    assert.equal(getSession(victim.task_id).status, 'running', 'la víctima sigue running');
  });

  // -------------------------------------------------------------------------
  // DoD 2 — una sola sesión: se documenta el fail-closed también aquí
  // -------------------------------------------------------------------------
  it('Stop: 1 sola sesión del repo + session_id desconocido → no-op explícito (fail-closed también aquí)', async () => {
    const [only] = seed(1);
    const before = readStateRaw();

    const { logger, events } = makeLogger();
    const { stub: cmuxStub, calls: cmuxCalls } = makeCmuxStub();
    const { runStopHook } = await import('../../src/hooks/stop.js');

    await runStopHook(
      { session_id: 'ad-hoc-unknown-id', cwd: REPO },
      { cmux: cmuxStub, loggerFactory: () => logger },
    );

    // DECISIÓN (DoD): no-op también con una sola sesión. El guard de unicidad de
    // findSession no cubre este caso — con un único candidato el fallback por cwd sería
    // «único» y volvería a imputar el cierre ajeno, que es el incidente literal.
    assert.equal(readStateRaw(), before, 'state.json debe quedar byte-idéntico');
    assert.equal(getSession(only.task_id).status, 'running', 'la única sesión sigue running');
    assert.equal(
      events.filter((e) => e.fields?.event === 'state.transition').length,
      0,
      'ninguna transición de estado',
    );
    assert.equal(cmuxCalls.length, 0, 'ningún efecto sobre el host');
  });

  // -------------------------------------------------------------------------
  // DoD 3 — el camino bueno no cambia: match por session_id sigue cerrando
  // -------------------------------------------------------------------------
  it('Stop: match por session_id sigue resolviendo con normalidad (sin regresión)', async () => {
    const sessions = seed(2);
    const target = sessions[1]; // la SEGUNDA — la que el fallback por cwd nunca elegía

    const { logger, events } = makeLogger();
    const { stub: cmuxStub } = makeCmuxStub();
    const { runStopHook } = await import('../../src/hooks/stop.js');

    await runStopHook(
      { session_id: target.session_id, cwd: REPO },
      { cmux: cmuxStub, loggerFactory: () => logger },
    );

    const transition = events.find((e) => e.fields?.event === 'state.transition');
    assert.ok(transition, 'el cierre legítimo sí emite state.transition');
    assert.equal(transition.fields.to, 'idle');
    assert.equal(getSession(target.task_id).status, 'idle', 'la sesión correcta pasa a idle');
    assert.equal(
      getSession(sessions[0].task_id).status,
      'running',
      'la otra sesión del mismo repo NO se toca',
    );
  });

  // -------------------------------------------------------------------------
  // DoD 4 — traza: el no-op es diagnosticable, no silencioso
  // -------------------------------------------------------------------------
  it('emite session.close.unmatched con los candidatos que el fallback habría cerrado', async () => {
    const sessions = seed(2);

    const { logger, events } = makeLogger();
    const { logger: unmatchedLog, events: unmatchedEvents } = makeLogger();
    const { stub: cmuxStub } = makeCmuxStub();
    const { runStopHook } = await import('../../src/hooks/stop.js');

    await runStopHook(
      { session_id: 'orchestrator-unknown-id', cwd: REPO },
      {
        cmux: cmuxStub,
        loggerFactory: () => logger,
        unmatchedLoggerFactory: () => unmatchedLog,
      },
    );

    const trace = unmatchedEvents.find((e) => e.fields?.event === 'session.close.unmatched');
    assert.ok(trace, 'el no-op debe dejar traza');
    assert.equal(trace.level, 'warn', 'nivel warn — filtrable de un vistazo');
    assert.equal(trace.fields.hook, 'stop');
    assert.equal(trace.fields.session_id, 'orchestrator-unknown-id');
    assert.equal(trace.fields.cwd, REPO);
    assert.equal(trace.fields.candidates, 2, 'las 2 sesiones vivas del repo eran candidatas');
    assert.deepEqual(
      [...trace.fields.candidate_task_refs].sort(),
      sessions.map((s) => s.task_ref).sort(),
      'la traza nombra a las víctimas potenciales',
    );
    // La traza NO va al log de la víctima — habla del hook que se contuvo.
    assert.equal(
      events.filter((e) => e.fields?.event === 'session.close.unmatched').length,
      0,
    );
  });

  it('no emite traza cuando no había ninguna sesión viva en ese cwd', async () => {
    const { logger: unmatchedLog, events: unmatchedEvents } = makeLogger();
    const { stub: cmuxStub } = makeCmuxStub();
    const { runStopHook } = await import('../../src/hooks/stop.js');

    // Sin `seed()`: ninguna sesión registrada para REPO. El `Stop` de cualquier sesión
    // ad-hoc de la máquina no es noticia — los hooks están instalados global y una línea
    // por turno sería ruido puro.
    await runStopHook(
      { session_id: 'ad-hoc-unknown-id', cwd: '/tmp/kodo27-otro-repo' },
      { cmux: cmuxStub, unmatchedLoggerFactory: () => unmatchedLog },
    );

    assert.deepEqual(unmatchedEvents, [], 'sin candidatos no hay traza');
  });
});
