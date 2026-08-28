// @ts-check
//
// test/hooks/session-end.test.js — Tests del hook SessionEnd (Phase 58, LIFE-03).
//
// SessionEnd hace el cleanup terminal DESTRUCTIVO al cierre real de la sesión:
// typed session.end event → lock release backstop → performTerminalCleanup
// (worktree + promptFile + removeSession). Idempotente (guard source==='history')
// y never-throws. La cobertura de worktree vive en stop-worktree-cleanup.test.js
// (re-apuntado a runSessionEndHook); aquí cubrimos la ruta sin worktree + guards.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessionEndHook } from '../../src/hooks/session-end.js';
import { sessionBackstopReview, EVENTS } from '../../src/logger-events.js';
// KODO-53: seams de aislamiento de la bandeja del orquestador. Obligatorios en TODA
// invocacion del hook — sin ellos la suite escribe en el state.json real y puede teclear
// avisos en el terminal del operador (ver el docblock del helper).
import { ORCH_INBOX_SEAMS, recordingInboxSeams } from '../helpers/orchestrator-inbox-seams.js';

// ── Aislamiento del HOME (Phase 74, T-74-15) ───────────────────────────────────
// OBLIGATORIO, no cosmético. Este fichero NO aísla HOME — no lo necesitaba, porque
// inyecta findSessionFn/removeSessionFn y nunca tocaba el fs. Con el bloque de handoff
// cableado en session-end.js:97, cada caso de aquí ejecuta writeHandoff, cuyos defaults
// resuelven a `join(KODO_DIR, 'plans')` y a `upsertTaskHandoff` — es decir, al
// `~/.kodo/plans` y al `state.json` REALES del operador, en cada `npm test`. La fuga es
// SILENCIOSA: los tests seguirían verdes mientras ensucian el HOME de quien los corre.
// (Verificado empíricamente durante el Plan 04: la primera ejecución de esta suite con el
// seam cableado y sin DI creó `~/.kodo/plans/kodo-end-1.md` y una entrada
// `tasks['kodo-end-1']` en el state.json real.)
//
// `config.js:11` evalúa `homedir()` en MODULE-LOAD, así que pisar `process.env.HOME` no
// cierra la fuga desde un fichero con imports estáticos: la única salida limpia es la DI
// que los Tasks 1 y 2 añadieron.
// El tmpdir se nombra `handoffTmpdir` a propósito, y NO con el nombre de la clave de
// deps: así ese literal aparece exactamente una vez por invocación del hook, y el
// criterio de aceptación que cuenta invocaciones contra invocaciones-aisladas mide de
// verdad lo que quiere medir — que NINGUNA se escape al HOME real.
let handoffTmpdir;
before(() => {
  handoffTmpdir = mkdtempSync(join(tmpdir(), 'kodo-send-'));
});
after(() => {
  rmSync(handoffTmpdir, { recursive: true, force: true });
  assert.equal(existsSync(handoffTmpdir), false, 'higiene: el tmpdir se borra');
});

/** Spy no-op — sustituye a upsertTaskHandoff para que el state.json real no se toque. */
const noopStateWriter = () => ({ ok: true });

// ── Aislamiento del REGISTRO del orquestador (KODO-20) ─────────────────────────
// Misma clase de fuga que la de arriba, un escalón más abajo y en sentido inverso: aquí
// no se ESCRIBE el state.json real, se LEE. Desde KODO-16 el destinatario del nudge de
// cierre sale de `state.orchestrator` y solo cae al título de `workspace list` como
// fallback, así que `resolveOrchestratorTargets` sin deps consulta el `~/.kodo/state.json`
// del operador. Con un orquestador vivo en la máquina, su ref GANA al del stub de
// `listWorkspaces` y la suite falla con `actual: 'workspace:12'` / `expected:
// 'workspace:9'` — verde o rojo según quién corra `npm test` y cuándo.
//
// Por eso el stub va en TODAS las invocaciones del hook, no solo en las que asertan el
// ref: un caso que solo comprueba «hubo send» pasa por casualidad cuando hay orquestador
// registrado, y esa casualidad es justo lo que esconde la regresión.
const noOrchestrator = () => null;

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
 * Cmux stub — registra las llamadas de los efectos de cierre (HYG-04) para
 * asserts. Sin inyectarlo, runSessionEndHook usaría el cmux real (conexión a
 * cmuxd + loadConfig) al disparar los efectos tras el cleanup.
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

function makeSession(overrides = {}) {
  return {
    session_id: 's-end-1',
    task_id: 'kodo-end-1',
    task_ref: 'KL-end-1',
    task_url: 'https://plane.example/KL-end-1',
    provider: 'plane',
    project_id: 'p-1',
    project_path: '/tmp/repo-end',
    summary: 'test session end',
    status: 'review',
    started_at: new Date().toISOString(),
    workspace_ref: 'workspace:end-1',
    gsd: false,
    ...overrides,
  };
}

/**
 * Stub de la captura de la cola de integración (KODO-26).
 *
 * OBLIGATORIO en toda invocación de `runSessionEndHook`, misma clase de fuga que
 * `stateWriterFn`/`getOrchestratorFn`: sin inyectarlo, el hook consulta git de verdad y encola
 * en el `~/.kodo/state.json` REAL del operador (T-74-15), y además mete sus propios comandos en
 * cualquier `gitFn` que la suite esté contando. La cobertura de la captura vive en
 * test/integration/capture.test.js.
 */
const noCapture = async () => ({ captured: false, reason: 'stubbed', entry: null });

describe('runSessionEndHook — cleanup terminal (LIFE-03)', () => {
  it('sesión viva (no worktree): emite session.end + remueve la sesión', async () => {
    const session = makeSession();
    const { logger, events } = makeLogger();
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
      },
    );
    const end = events.find((e) => e.fields?.event === 'session.end');
    assert.ok(end, 'debe emitir el typed session.end event');
    assert.equal(end.fields.status, 'done', 'session.end status=done');
    assert.deepEqual(removed, [session.task_id], 'removeSession llamado con el id');
  });

  it('idempotencia: source==="history" → no-op (no remueve, no emite session.end)', async () => {
    const session = makeSession();
    const { logger, events } = makeLogger();
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        ...ORCH_INBOX_SEAMS,
        // Simula una sesión ya archivada (Stop espurio, SessionEnd previo, doctor).
        findSessionFn: () => ({ id: session.task_id, session, source: 'history' }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
      },
    );
    assert.deepEqual(removed, [], 'NO remueve una sesión ya archivada');
    assert.equal(events.filter((e) => e.fields?.event === 'session.end').length, 0, 'NO emite session.end');
  });

  it('sin sesión tracked → no-op silencioso (sesión ad-hoc/orquestador)', async () => {
    const { logger, events } = makeLogger();
    const removed = [];
    await runSessionEndHook(
      { session_id: 'unknown', cwd: '/tmp/elsewhere' },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => null,
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
      },
    );
    assert.deepEqual(removed, [], 'nada que remover');
    assert.equal(events.length, 0, 'no emite eventos');
  });

  it('never-throws: un removeSessionFn que lanza NO crashea el hook', async () => {
    const session = makeSession();
    const { logger } = makeLogger();
    await assert.doesNotReject(
      runSessionEndHook(
        { session_id: session.session_id, cwd: session.project_path },
        {
          ...ORCH_INBOX_SEAMS,
          findSessionFn: () => ({ id: session.task_id, session }),
          captureIntegrationFn: noCapture,
          plansDir: handoffTmpdir,
          stateWriterFn: noopStateWriter,
          getOrchestratorFn: noOrchestrator,
          removeSessionFn: () => { throw new Error('state.json locked'); },
          loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
        },
      ),
      'el hook nunca debe rechazar (never-throws / fail-open)',
    );
  });
});

describe('runSessionEndHook — efectos de cierre HYG-04 (color/notify/aviso)', () => {
  it('dispara setColor(review) + notify + el aviso al orquestador DESPUÉS del cleanup terminal', async () => {
    // KODO-53: el tercer efecto dejó de ser un `send` con el texto largo. Ahora encola el
    // evento en la bandeja y delega el aviso — el `send`, si lo hay, sale de
    // `maybeNotifyOrchestrator` y solo si el orquestador está idle.
    const session = makeSession();
    const { logger, events } = makeLogger();
    const { stub: cmuxStub, calls } = makeCmuxStub();
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...recordingInboxSeams(calls),
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
        cmux: cmuxStub,
        config: {},
      },
    );

    const setColor = calls.find((c) => c.fn === 'setColor');
    const notify = calls.find((c) => c.fn === 'notify');
    const enqueue = calls.find((c) => c.fn === 'enqueue');
    const maybeNotify = calls.find((c) => c.fn === 'maybeNotify');
    assert.ok(setColor, 'invoca setColor(review) en SessionEnd');
    assert.equal(setColor.args.workspace, session.workspace_ref, 'colorea el workspace de la sesión');
    assert.ok(notify, 'invoca notify de cierre en SessionEnd');
    assert.equal(notify.args.title, `kodo: ${session.task_ref} cerrada`, 'título de cierre');
    assert.ok(enqueue, 'encola el evento en la bandeja del orquestador');
    assert.equal(enqueue.args.kind, 'session-end');
    assert.equal(enqueue.args.task_ref, session.task_ref);
    assert.equal(enqueue.args.session_id, session.session_id);
    assert.match(enqueue.args.text, /está en Review/, 'el texto del evento sale de buildStopNudgeText');
    assert.ok(maybeNotify, 'delega la decisión de avisar al carril del idle');
    // El cleanup (removeSession) corre ANTES de los efectos cosméticos.
    assert.deepEqual(removed, [session.task_id], 'el cleanup terminal corrió');
  });

  it('KODO-53: en modo `inbox` (default) NO teclea el texto largo — ese era el ruido a retirar', async () => {
    // El caso concreto que motivó KODO-53: el nudge llegaba tarde, duplicaba lo que la
    // ronda ya sabía y ensuciaba el prompt del operador. Con la bandeja, `cmuxClient.send`
    // no se toca desde el hook: el único envío posible viene de `maybeNotifyOrchestrator`,
    // y es de una línea.
    const session = makeSession();
    const { logger } = makeLogger();
    const { stub: cmuxStub, calls } = makeCmuxStub();
    cmuxStub.listWorkspaces = async () => {
      calls.push({ fn: 'listWorkspaces' });
      return 'workspace:9 kodo-orchestrator\n';
    };
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...recordingInboxSeams(calls),
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: () => {},
        loggerFactory: () => logger,
        cmux: cmuxStub,
        config: {},
      },
    );
    assert.equal(calls.filter((c) => c.fn === 'send').length, 0, 'CERO keystrokes desde el hook');
    assert.equal(calls.filter((c) => c.fn === 'enqueue').length, 1, 'el evento sí se persiste');
  });

  it('KODO-53: modo `keystroke` restaura el carril legacy — teclea el texto largo y NO encola', async () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const { stub: cmuxStub, calls } = makeCmuxStub();
    cmuxStub.listWorkspaces = async () => {
      calls.push({ fn: 'listWorkspaces' });
      return 'workspace:9 kodo-orchestrator\n';
    };
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...recordingInboxSeams(calls),
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: () => {},
        loggerFactory: () => logger,
        cmux: cmuxStub,
        config: { orchestrator: { nudges: 'keystroke' } },
      },
    );
    const send = calls.find((c) => c.fn === 'send');
    assert.ok(send, 'el opt-in explícito recupera el keystroke');
    assert.equal(send.args.workspace, 'workspace:9', 'usa el ref del orquestador resuelto');
    assert.match(send.args.text, /está en Review/, 'con el texto de buildStopNudgeText');
    assert.equal(calls.filter((c) => c.fn === 'enqueue').length, 0, 'el carril legacy NO pasa por la bandeja');
  });

  it('KODO-53: modo `off` persiste el evento pero NUNCA teclea (apaga el aviso, no la memoria)', async () => {
    // `off` apaga el teclado, no la bandeja: si apagara ambas, un cierre durante una
    // ausencia del operador se perdería — justo lo contrario de lo que KODO-53 arregla.
    const session = makeSession();
    const { logger } = makeLogger();
    const { stub: cmuxStub, calls } = makeCmuxStub();
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...recordingInboxSeams(calls),
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: () => {},
        loggerFactory: () => logger,
        cmux: cmuxStub,
        config: { orchestrator: { nudges: 'off' } },
      },
    );
    assert.equal(calls.filter((c) => c.fn === 'enqueue').length, 1, 'el evento se persiste igual');
    assert.equal(calls.filter((c) => c.fn === 'maybeNotify').length, 0, 'ni se plantea avisar');
    assert.equal(calls.filter((c) => c.fn === 'send').length, 0, 'cero keystrokes');
  });

  it('KODO-53: un `nudges` desconocido cae al default `inbox` en vez de dejar el carril indefinido', async () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const { stub: cmuxStub, calls } = makeCmuxStub();
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...recordingInboxSeams(calls),
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: () => {},
        loggerFactory: () => logger,
        cmux: cmuxStub,
        config: { orchestrator: { nudges: 'a-gritos' } },
      },
    );
    assert.equal(calls.filter((c) => c.fn === 'enqueue').length, 1);
    assert.equal(calls.filter((c) => c.fn === 'maybeNotify').length, 1);
    assert.equal(calls.filter((c) => c.fn === 'send').length, 0);
  });

  it('KODO-53 never-throws: un enqueue que LANZA no impide que el hook termine', async () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const { stub: cmuxStub, calls } = makeCmuxStub();
    const removed = [];
    await assert.doesNotReject(
      runSessionEndHook(
        { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
        {
          enqueueOrchestratorEventFn: () => { throw new Error('state.json ilegible'); },
          maybeNotifyOrchestratorFn: async () => ({ sent: false, reason: 'nothing-unseen' }),
          findSessionFn: () => ({ id: session.task_id, session }),
          captureIntegrationFn: noCapture,
          plansDir: handoffTmpdir,
          stateWriterFn: noopStateWriter,
          getOrchestratorFn: noOrchestrator,
          removeSessionFn: (id) => removed.push(id),
          loggerFactory: () => logger,
          cmux: cmuxStub,
          config: {},
        },
      ),
      'un fallo de la bandeja JAMÁS bloquea el cierre de Claude Code',
    );
    assert.deepEqual(removed, [session.task_id], 'el cleanup terminal corrió igual');
  });

  it('KODO-18: prefiere setStatus(review) cuando el host lo expone (host-agnóstico)', async () => {
    // Los dos hosts reales (cmux y orca) implementan `_legacy.setStatus`. Este test fija
    // la PREFERENCIA: con setStatus disponible, el hook NO debe caer al setColor de
    // vocabulario cmux — si lo hiciera, la tarjeta de Orca se quedaría en `in-progress`
    // al cerrar la sesión.
    const session = makeSession();
    const calls = [];
    const hostStub = {
      setStatus: async (args) => { calls.push({ fn: 'setStatus', args }); },
      setColor: async (args) => { calls.push({ fn: 'setColor', args }); },
      notify: async () => {},
      listWorkspaces: async () => '',
      send: async () => {},
    };
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: () => {},
        loggerFactory: () => makeLogger().logger,
        cmux: hostStub,
      },
    );
    const setStatus = calls.find((c) => c.fn === 'setStatus');
    assert.ok(setStatus, 'invoca setStatus cuando el cliente del host lo expone');
    assert.equal(setStatus.args.status, 'review');
    assert.equal(setStatus.args.workspace, session.workspace_ref);
    assert.ok(!calls.some((c) => c.fn === 'setColor'), 'NO debe llamar además a setColor');
  });

  it('KODO-18: sin setStatus, cae a setColor(review) — degradación typeof, cero regresión', async () => {
    // La rama de compatibilidad: un cliente cmux-shaped (como los stubs históricos de
    // esta suite) sigue funcionando exactamente igual que antes de KODO-18.
    const session = makeSession();
    const { stub: cmuxStub, calls } = makeCmuxStub();
    assert.equal(typeof cmuxStub.setStatus, 'undefined', 'el stub NO expone setStatus');
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: () => {},
        loggerFactory: () => makeLogger().logger,
        cmux: cmuxStub,
      },
    );
    const setColor = calls.find((c) => c.fn === 'setColor');
    assert.ok(setColor, 'cae a setColor cuando no hay setStatus');
    assert.equal(setColor.args.workspace, session.workspace_ref);
  });

  it('los efectos van DESPUÉS del backstop (session.backstop.review precede a setColor)', async () => {
    const session = makeSession();
    const seq = [];
    const events = [];
    const logger = {
      info: (m, f) => { events.push({ level: 'info', msg: m, fields: f }); if (f?.event === 'session.backstop.review') seq.push('backstop'); },
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => logger,
    };
    const { provider } = makeProvider({ state: 'in_progress' });
    const cmuxStub = {
      setColor: async () => { seq.push('setColor'); },
      notify: async () => { seq.push('notify'); },
      listWorkspaces: async () => '',
      send: async () => {},
    };
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: () => {},
        loggerFactory: () => logger,
        provider,
        config: makeConfig(),
        cmux: cmuxStub,
      },
    );
    assert.deepEqual(seq, ['backstop', 'setColor', 'notify'], 'orden LOCKED: backstop → setColor → notify (D-08)');
  });

  it('never-throws: un setColor que lanza NO impide notify, el aviso ni el cleanup', async () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const calls = [];
    const cmuxStub = {
      setColor: async () => { calls.push({ fn: 'setColor' }); throw new Error('cmux down'); },
      notify: async () => { calls.push({ fn: 'notify' }); },
      listWorkspaces: async () => { calls.push({ fn: 'listWorkspaces' }); return 'workspace:9 kodo-orchestrator\n'; },
      send: async () => { calls.push({ fn: 'send' }); },
    };
    const removed = [];
    await assert.doesNotReject(
      runSessionEndHook(
        { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
        {
          ...recordingInboxSeams(calls),
          findSessionFn: () => ({ id: session.task_id, session }),
          captureIntegrationFn: noCapture,
          plansDir: handoffTmpdir,
          stateWriterFn: noopStateWriter,
          getOrchestratorFn: noOrchestrator,
          removeSessionFn: (id) => removed.push(id),
          loggerFactory: () => logger,
          cmux: cmuxStub,
          config: {},
        },
      ),
      'un fallo de setColor nunca crashea el hook (never-throws individual)',
    );
    const fns = calls.map((c) => c.fn);
    assert.ok(fns.includes('setColor'), 'intentó setColor');
    assert.ok(fns.includes('notify'), 'notify corre pese al fallo de setColor');
    // KODO-53: el tercer efecto ya no es un `send` — es el encolado en la bandeja. La
    // propiedad que se vigila no cambia: un fallo del primer efecto no cancela los demás.
    assert.ok(fns.includes('enqueue'), 'la bandeja se escribe pese al fallo de setColor');
    assert.deepEqual(removed, [session.task_id], 'el cleanup terminal corrió antes de los efectos');
  });

  // Regresión (Phase 74): vigila la MITAD de D-07 que dice qué NO cambia. El bloque de
  // handoff se inserta ANTES del trío cosmético; insertar antes de una secuencia no la
  // reordena, y este caso lo fija sobre el array `calls` COMPARTIDO del cmux stub más un
  // push desde removeSessionFn. Si alguien mueve el handoff (o el trío) y rompe el orden
  // LOCKED de D-08 (v0.16 Phase 71), esto muerde.
  it('REGRESIÓN D-08: con el bloque de handoff insertado, el orden removeSession → setColor → notify sigue intacto', async () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const { stub: cmuxStub, calls } = makeCmuxStub();
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: () => { calls.push({ fn: 'removeSession' }); },
        loggerFactory: () => logger,
        cmux: cmuxStub,
      },
    );
    const iRemove = calls.findIndex((c) => c.fn === 'removeSession');
    const iColor = calls.findIndex((c) => c.fn === 'setColor');
    const iNotify = calls.findIndex((c) => c.fn === 'notify');
    assert.ok(iRemove !== -1 && iColor !== -1 && iNotify !== -1, 'los tres efectos ocurrieron');
    assert.ok(iRemove < iColor, 'removeSession antes de setColor');
    assert.ok(iColor < iNotify, 'setColor antes de notify — el trío LOCKED no se reordena');
  });
});

/**
 * Provider mock con spies + contadores para el backstop (DELIV-04).
 * `state` es lo que devuelve getTaskState; los flags *Throws simulan fallos de red.
 * `omit` permite quitar métodos para simular capability-gating (GitHub degrada).
 */
function makeProvider(opts = {}) {
  const calls = { getTaskState: [], updateTaskState: [], addComment: [] };
  const provider = {
    getTaskState: async (task) => {
      calls.getTaskState.push(task);
      if (opts.getStateThrows) throw new Error('getTaskState network down');
      return opts.state ?? 'in_progress';
    },
    updateTaskState: async (task, stateName) => {
      calls.updateTaskState.push({ task, stateName });
      if (opts.updateThrows) throw new Error('updateTaskState network down');
    },
    addComment: async (task, text) => {
      calls.addComment.push({ task, text });
      if (opts.commentThrows) throw new Error('addComment network down');
    },
  };
  for (const m of opts.omit || []) delete provider[m];
  return { provider, calls };
}

function makeConfig(reviewState = 'In review') {
  return { provider: 'plane', providers: { plane: { states: { review: reviewState } } } };
}

// ── KODO-20 ────────────────────────────────────────────────────────────────────
// Estos casos NO cubren el comportamiento del nudge (eso es HYG-04, arriba): cubren su
// HERMETICIDAD. Fijan que el ref al que se avisa sale de lo que el test inyecta y de nada
// más, para que `npm test` dé el mismo resultado con y sin orquestador vivo en la máquina.
// Antes del fix, el primero de ellos fallaba en cualquier máquina con orquestador
// registrado y pasaba en CI: exactamente el modo de fallo que motivó la tarea.
describe('runSessionEndHook — hermeticidad del aviso al orquestador (KODO-20)', () => {
  // La invariante de KODO-20 no cambia con KODO-53: el hook JAMÁS resuelve al orquestador
  // leyendo el `~/.kodo/state.json` de la máquina. Lo que cambió es DÓNDE se ejerce.
  //   · modo `keystroke` — el hook sigue llamando a `resolveOrchestratorTargets` él mismo,
  //     así que el seam se observa igual que antes: por el ref del `send`.
  //   · modo `inbox` (default) — la resolución vive en `maybeNotifyOrchestrator`, y lo que
  //     hay que demostrar es que el hook le PASA el seam en vez de dejar que caiga a su
  //     default real. Se observa sobre el argumento que recibe el stub.
  // Ambos carriles se cubren: comprobar solo uno dejaría el otro leyendo el HOME real.

  /**
   * Corre el hook en modo `keystroke` y devuelve el ref al que se tecleó (o null).
   */
  async function nudgeRefCon({ getOrchestratorFn, workspaceList }) {
    const session = makeSession();
    const { logger } = makeLogger();
    const { stub, calls } = makeCmuxStub();
    stub.listWorkspaces = async () => workspaceList;
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn,
        removeSessionFn: () => {},
        loggerFactory: () => logger,
        cmux: stub,
        config: { orchestrator: { nudges: 'keystroke' } },
      },
    );
    return calls.find((c) => c.fn === 'send')?.args.workspace ?? null;
  }

  it('el carril keystroke CONSULTA el getOrchestratorFn inyectado — el seam está cableado, no ignorado', async () => {
    // El assert que de verdad importa: `resolveOrchestratorTargets` resuelve
    // `deps.getOrchestratorFn || getOrchestrator`, así que una sola invocación del stub
    // demuestra que el default real (el que lee ~/.kodo/state.json) NO entró en juego.
    let consultas = 0;
    const ref = await nudgeRefCon({
      getOrchestratorFn: () => { consultas++; return { workspace_ref: 'workspace:77' }; },
      workspaceList: 'workspace:9 kodo-orchestrator\n',
    });
    assert.equal(consultas, 1, 'el hook consulta el registro inyectado exactamente una vez');
    assert.equal(ref, 'workspace:77', 'y el nudge va al ref inyectado, no al del state real');
  });

  it('dos registros inyectados distintos → dos refs distintos, con el MISMO state.json de la máquina', async () => {
    // Ambas corridas comparten el `~/.kodo/state.json` real (no se toca). Si el hook lo
    // leyera, las dos darían el mismo ref y este assert caería.
    const uno = await nudgeRefCon({
      getOrchestratorFn: () => ({ workspace_ref: 'workspace:101' }),
      workspaceList: '',
    });
    const dos = await nudgeRefCon({
      getOrchestratorFn: () => ({ workspace_ref: 'workspace:202' }),
      workspaceList: '',
    });
    assert.equal(uno, 'workspace:101');
    assert.equal(dos, 'workspace:202');
  });

  it('sin registro inyectado (() => null), el ref sale SOLO del stub de listWorkspaces', async () => {
    const ref = await nudgeRefCon({
      getOrchestratorFn: noOrchestrator,
      workspaceList: 'workspace:9 kodo-orchestrator\n',
    });
    assert.equal(ref, 'workspace:9', 'fallback por título — el único candidato del test');
  });

  it('sin registro y sin título → no hay a quién avisar: cero send', async () => {
    const ref = await nudgeRefCon({ getOrchestratorFn: noOrchestrator, workspaceList: '' });
    assert.equal(ref, null);
  });

  it('KODO-53: en modo `inbox` el seam se THREADEA a maybeNotifyOrchestrator (no cae a su default real)', async () => {
    // Sin este threading, el aviso resolvería al orquestador por el `getOrchestrator` real
    // y la suite volvería a depender de si la máquina tiene uno vivo — exactamente el
    // fallo no determinista que KODO-20 cerró, reabierto un piso más abajo.
    const session = makeSession();
    const { logger } = makeLogger();
    const { stub } = makeCmuxStub();
    const seam = () => ({ workspace_ref: 'workspace:303' });
    let recibido = null;
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        enqueueOrchestratorEventFn: () => ({ ok: true, value: { id: 'x' } }),
        maybeNotifyOrchestratorFn: async (o) => { recibido = o; return { sent: false, reason: 'busy' }; },
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: seam,
        removeSessionFn: () => {},
        loggerFactory: () => logger,
        cmux: stub,
        config: {},
      },
    );
    assert.ok(recibido, 'el carril del aviso se invocó');
    assert.equal(recibido.getOrchestratorFn, seam, 'con el MISMO seam que recibió el hook');
    assert.equal(recibido.hostClient, stub, 'y con el cliente del host inyectado, nunca cmux directo');
  });
});

describe('runSessionEndHook — review backstop (DELIV-04)', () => {
  it('tarea in_progress + reason limpio → transiciona a review + comenta + emite session.backstop.review; cleanup sigue', async () => {
    const session = makeSession();
    const { logger, events } = makeLogger();
    const { provider, calls } = makeProvider({ state: 'in_progress' });
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
        provider,
        config: makeConfig(),
      },
    );
    assert.equal(calls.updateTaskState.length, 1, 'updateTaskState llamado una vez');
    assert.equal(calls.updateTaskState[0].stateName, 'In review', 'con el reviewState resuelto');
    assert.equal(calls.updateTaskState[0].task.id, session.task_id, 'TaskItem mínimo reconstruido con task_id');
    assert.equal(calls.updateTaskState[0].task.projectId, session.project_id, 'TaskItem con projectId');
    assert.equal(calls.addComment.length, 1, 'addComment llamado una vez');
    // KODO-11: el texto pasó del literal 'cierre automático' a buildBackstopComment
    // (cierre automático + handoff). Lo invariante es que se identifique como
    // automático y NO se presente como un resumen del agente.
    assert.match(calls.addComment[0].text, /Cierre automático de kodo/, 'comentario de cierre automático');
    assert.match(calls.addComment[0].text, /NO lo escribió el agente/, 'se etiqueta como no escrito por el agente');
    const ev = events.find((e) => e.fields?.event === 'session.backstop.review');
    assert.ok(ev, 'emite session.backstop.review');
    assert.equal(ev.fields.from, 'in_progress');
    assert.equal(ev.fields.to, 'In review');
    assert.equal(ev.fields.session_id, session.session_id);
    assert.deepEqual(removed, [session.task_id], 'performTerminalCleanup/removeSession corre igual');
  });

  it('tarea ya en in_review → no-op idempotente (D-11): cero updateTaskState/addComment', async () => {
    const session = makeSession();
    const { logger, events } = makeLogger();
    const { provider, calls } = makeProvider({ state: 'in_review' });
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
        provider,
        config: makeConfig(),
      },
    );
    assert.equal(calls.updateTaskState.length, 0, 'no transiciona lo ya movido por el LLM');
    assert.equal(calls.addComment.length, 0, 'no comenta');
    assert.equal(events.filter((e) => e.fields?.event === 'session.backstop.review').length, 0, 'no emite el evento');
    assert.deepEqual(removed, [session.task_id], 'cleanup sigue');
  });

  it('provider sin getTaskState/updateTaskState (sin capacidades) → no-op por capability-gate; el hook completa el cleanup', async () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const { provider, calls } = makeProvider({ omit: ['getTaskState', 'updateTaskState'] });
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
        provider,
        config: makeConfig(),
      },
    );
    assert.equal(calls.updateTaskState.length, 0, 'no llama transición');
    assert.equal(calls.addComment.length, 0, 'no comenta');
    assert.deepEqual(removed, [session.task_id], 'el hook completa el cleanup');
  });

  it('updateTaskState que lanza (fallo de red) → el hook NO crashea, warn emitido, cleanup corre (fail-open)', async () => {
    const session = makeSession();
    const { logger, events } = makeLogger();
    const { provider, calls } = makeProvider({ state: 'in_progress', updateThrows: true });
    const removed = [];
    await assert.doesNotReject(
      runSessionEndHook(
        { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
        {
          ...ORCH_INBOX_SEAMS,
          findSessionFn: () => ({ id: session.task_id, session }),
          captureIntegrationFn: noCapture,
          plansDir: handoffTmpdir,
          stateWriterFn: noopStateWriter,
          getOrchestratorFn: noOrchestrator,
          removeSessionFn: (id) => removed.push(id),
          loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
          provider,
          config: makeConfig(),
        },
      ),
      'el backstop nunca crashea el hook (fail-open por paso)',
    );
    assert.equal(calls.updateTaskState.length, 1, 'intentó la transición');
    assert.equal(calls.addComment.length, 0, 'un fallo de transición sale antes de comentar');
    assert.ok(events.some((e) => e.level === 'warn'), 'emite un warn del fallo');
    assert.equal(events.filter((e) => e.fields?.event === 'session.backstop.review').length, 0, 'no emite el evento tras fallo de transición');
    assert.deepEqual(removed, [session.task_id], 'performTerminalCleanup corre igualmente');
  });

  it('getTaskState que lanza → fail-open: no transiciona, warn, cleanup corre', async () => {
    const session = makeSession();
    const { logger, events } = makeLogger();
    const { provider, calls } = makeProvider({ getStateThrows: true });
    const removed = [];
    await assert.doesNotReject(
      runSessionEndHook(
        { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
        {
          ...ORCH_INBOX_SEAMS,
          findSessionFn: () => ({ id: session.task_id, session }),
          captureIntegrationFn: noCapture,
          plansDir: handoffTmpdir,
          stateWriterFn: noopStateWriter,
          getOrchestratorFn: noOrchestrator,
          removeSessionFn: (id) => removed.push(id),
          loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
          provider,
          config: makeConfig(),
        },
      ),
    );
    assert.equal(calls.updateTaskState.length, 0, 'sin estado no arriesga la transición');
    assert.ok(events.some((e) => e.level === 'warn'), 'emite un warn del fallo de getTaskState');
    assert.deepEqual(removed, [session.task_id], 'cleanup corre');
  });

  it('reviewState resuelto desde config.providers[provider].states.review custom (Pitfall #1)', async () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const { provider, calls } = makeProvider({ state: 'in_progress' });
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: () => {},
        loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
        provider,
        config: makeConfig('QA Column'),
      },
    );
    assert.equal(calls.updateTaskState.length, 1);
    assert.equal(calls.updateTaskState[0].stateName, 'QA Column', 'usa el reviewState custom, no el default ni top-level');
  });

  // --- Gate de estado no-terminal (GAP 2 / DELIV-04, 71-05) ------------------
  // El backstop NUNCA transiciona a un estado terminal/de cierre: para GitHub
  // (`states.review:'closed'`) queda no-op — NUNCA cierra el issue; para Plane
  // (`'In review'`, no-terminal) transiciona como hoy.

  it('GitHub REAL (3 capacidades) + states.review:"closed" → no-op por gate de estado terminal (NUNCA cierra el issue)', async () => {
    const session = makeSession({ provider: 'github' });
    const { logger, events } = makeLogger();
    // Provider mock con las 3 capacidades REALES (getTaskState/updateTaskState/addComment),
    // como el provider de GitHub — el capability-gate PASA; el no-op viene del gate de estado.
    const { provider, calls } = makeProvider({ state: 'in_progress' });
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
        provider,
        config: { provider: 'github', providers: { github: { states: { review: 'closed' } } } },
      },
    );
    assert.equal(calls.updateTaskState.length, 0, 'NUNCA cierra el issue de GitHub (updateTaskState no llamado)');
    assert.equal(calls.addComment.length, 0, 'no comenta');
    assert.equal(
      events.filter((e) => e.fields?.event === 'session.backstop.review').length,
      0,
      'no emite el evento de transición',
    );
    assert.ok(
      events.some((e) => e.msg === 'session.backstop.skipped_terminal'),
      'emite el log de skip por estado terminal',
    );
    const skip = events.find((e) => e.msg === 'session.backstop.skipped_terminal');
    assert.deepEqual(
      Object.keys(skip.fields).sort(),
      ['session_id', 'state', 'task_id'],
      'el log de skip contiene SOLO {session_id, task_id, state} (sin contenido de usuario)',
    );
    assert.equal(skip.fields.state, 'closed', 'el state loggeado es el reviewState terminal resuelto');
    assert.deepEqual(removed, [session.task_id], 'performTerminalCleanup/removeSession corre igual');
  });

  it('Plane (states.review:"In review", no-terminal) → transiciona + comenta + evento (comportamiento de hoy preservado)', async () => {
    const session = makeSession({ provider: 'plane' });
    const { logger, events } = makeLogger();
    const { provider, calls } = makeProvider({ state: 'in_progress' });
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
        provider,
        config: { provider: 'plane', providers: { plane: { states: { review: 'In review', done: 'Done' } } } },
      },
    );
    assert.equal(calls.updateTaskState.length, 1, 'transiciona (estado no-terminal)');
    assert.equal(calls.updateTaskState[0].stateName, 'In review', 'con el reviewState resuelto');
    assert.equal(calls.addComment.length, 1, 'comenta el cierre automático');
    assert.match(calls.addComment[0].text, /Cierre automático de kodo/);
    assert.ok(
      events.find((e) => e.fields?.event === 'session.backstop.review'),
      'emite el evento NDJSON del backstop',
    );
  });

  it('states.done captura un review terminal por vía agnóstica (review==="Done"===done) → no-op sin depender del literal "closed"', async () => {
    const session = makeSession({ provider: 'x' });
    const { logger, events } = makeLogger();
    const { provider, calls } = makeProvider({ state: 'in_progress' });
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        ...ORCH_INBOX_SEAMS,
        findSessionFn: () => ({ id: session.task_id, session }),
        captureIntegrationFn: noCapture,
        plansDir: handoffTmpdir,
        stateWriterFn: noopStateWriter,
        getOrchestratorFn: noOrchestrator,
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
        provider,
        config: { provider: 'x', providers: { x: { states: { review: 'Done', done: 'Done' } } } },
      },
    );
    assert.equal(calls.updateTaskState.length, 0, 'no transiciona: el gate lo captura por igualdad con states.done');
    assert.equal(calls.addComment.length, 0, 'no comenta');
    assert.ok(
      events.some((e) => e.msg === 'session.backstop.skipped_terminal'),
      'emite el log de skip por estado terminal',
    );
    assert.deepEqual(removed, [session.task_id], 'cleanup corre');
  });

  it('gate never-throws sobre config basura (states.done no-string) → no crashea; estado no-terminal transiciona', async () => {
    const session = makeSession({ provider: 'plane' });
    const { logger } = makeLogger();
    const { provider, calls } = makeProvider({ state: 'in_progress' });
    await assert.doesNotReject(
      runSessionEndHook(
        { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
        {
          ...ORCH_INBOX_SEAMS,
          findSessionFn: () => ({ id: session.task_id, session }),
          captureIntegrationFn: noCapture,
          plansDir: handoffTmpdir,
          stateWriterFn: noopStateWriter,
          getOrchestratorFn: noOrchestrator,
          removeSessionFn: () => {},
          loggerFactory: () => logger,
          cmux: makeCmuxStub().stub,
          provider,
          // states.done no-string y review no-terminal: el gate debe tolerarlo sin lanzar.
          config: { provider: 'plane', providers: { plane: { states: { review: 'In review', done: 123 } } } },
        },
      ),
      'el gate nunca crashea el hook con config basura (never-throws)',
    );
    assert.equal(calls.updateTaskState.length, 1, '«In review» sigue siendo no-terminal → transiciona');
  });
});

// ── KODO-36 ────────────────────────────────────────────────────────────────────
// El comentario del backstop era fail-open y fail-SILENT: un blip de red dejaba solo un
// warn en el NDJSON, la tarea YA transicionada a «In review» y al humano sin una línea de
// contexto. Ahora el texto se persiste como marcador (`state.pending_comments`) para que el
// barrido de huérfanas lo reintente. Estos casos fijan las dos mitades del contrato: se
// marca cuando falla, y NO se marca cuando no falla.
describe('runSessionEndHook — marcador de comentario pendiente (KODO-36)', () => {
  /** Corre el hook con el seam del marcador cableado y devuelve lo que se marcó. */
  async function cierreCon({ commentThrows, markThrows = false }) {
    const session = makeSession();
    const { logger, events } = makeLogger();
    const { provider, calls } = makeProvider({ state: 'in_progress', commentThrows });
    const marcados = [];
    const removed = [];
    await assert.doesNotReject(
      runSessionEndHook(
        { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
        {
          // KODO-53 (añadido al mergear): estos casos llegan al bloque de efectos de
          // cierre, así que necesitan también los seams de la bandeja del orquestador —
          // sin ellos encolan en el `~/.kodo/state.json` real y, con un orquestador idle
          // en la máquina, le teclean un aviso. Misma clase de fuga que el
          // `markPendingCommentFn` que este mismo bloque inyecta.
          ...ORCH_INBOX_SEAMS,
          findSessionFn: () => ({ id: session.task_id, session }),
          captureIntegrationFn: noCapture,
          plansDir: handoffTmpdir,
          stateWriterFn: noopStateWriter,
          getOrchestratorFn: noOrchestrator,
          removeSessionFn: (id) => removed.push(id),
          loggerFactory: () => logger,
          cmux: makeCmuxStub().stub,
          provider,
          config: makeConfig(),
          markPendingCommentFn: (entry) => {
            marcados.push(entry);
            if (markThrows) throw new Error('state.json ilegible');
            return { ok: true, value: entry };
          },
        },
      ),
      'el marcador es una mejora del fail-open, jamás una vía nueva de crasheo',
    );
    return { session, calls, events, marcados, removed };
  }

  it('addComment que lanza → persiste el marcador con el TEXTO y el TaskItem completos', async () => {
    const { session, calls, events, marcados, removed } = await cierreCon({ commentThrows: true });

    assert.equal(calls.updateTaskState.length, 1, 'la transición SÍ ocurrió (paso 6, antes del comentario)');
    assert.equal(calls.addComment.length, 1, 'se intentó comentar');
    assert.equal(marcados.length, 1, 'y el fallo dejó exactamente UN marcador');

    const marca = marcados[0];
    assert.equal(marca.task_id, session.task_id);
    assert.equal(marca.project_id, session.project_id);
    assert.equal(marca.task_ref, session.task_ref);
    assert.equal(marca.session_id, session.session_id);
    // El texto marcado es BYTE A BYTE el que el provider rechazó: el reintento publica el
    // mismo comentario, no uno reconstruido más tarde con otro contexto.
    assert.equal(marca.text, calls.addComment[0].text, 'se marca el texto exacto que falló');
    assert.match(marca.text, /Cierre automático de kodo/);

    assert.ok(
      events.some((e) => e.msg === 'session.backstop.comment_failed'),
      'el warn previo a KODO-36 se conserva',
    );
    assert.deepEqual(removed, [session.task_id], 'el cleanup terminal corre igualmente');
  });

  it('addComment con éxito → NO marca nada (el marcador es solo para el fallo)', async () => {
    const { calls, marcados } = await cierreCon({ commentThrows: false });
    assert.equal(calls.addComment.length, 1, 'comentó');
    assert.deepEqual(marcados, [], 'y no dejó marcador que el barrido reintentaría en vano');
  });

  it('un writer del marcador que LANZA no crashea el hook ni impide el cleanup', async () => {
    const { session, events, marcados, removed } = await cierreCon({
      commentThrows: true,
      markThrows: true,
    });
    assert.equal(marcados.length, 1, 'se intentó marcar');
    assert.ok(
      events.some((e) => e.msg === 'session.backstop.pending_mark_failed'),
      'y el fallo del marcador queda trazado',
    );
    assert.deepEqual(removed, [session.task_id], 'el cierre termina igual que antes de KODO-36');
  });

  it('el hook CONSULTA el markPendingCommentFn inyectado — el seam está cableado, no ignorado', async () => {
    // Mismo argumento de hermeticidad que el de getOrchestratorFn (KODO-20): una sola
    // invocación del stub demuestra que el default real —que escribe en el ~/.kodo del
    // operador— NO entró en juego durante `npm test`.
    const { marcados } = await cierreCon({ commentThrows: true });
    assert.equal(marcados.length, 1);
  });
});

describe('sessionBackstopReview — evento NDJSON del backstop (DELIV-04, T-25-02)', () => {
  it('emite SOLO {event, session_id, task_id, from, to} y descarta campos extra', () => {
    const { logger, events } = makeLogger();
    sessionBackstopReview(logger, {
      session_id: 's-1',
      task_id: 'kodo-1',
      from: 'in_progress',
      to: 'In review',
      // Campos de contenido que NUNCA deben filtrarse al sink NDJSON (guardrail T-25-02).
      title: 'SECRETO — no debe filtrarse',
      description: 'tampoco esto',
    });
    assert.equal(events.length, 1, 'emite exactamente un record');
    const rec = events[0];
    assert.equal(rec.level, 'info', 'nivel info');
    assert.equal(rec.msg, EVENTS.SESSION_BACKSTOP_REVIEW, 'msg = clave del evento');
    assert.deepEqual(
      rec.fields,
      {
        event: 'session.backstop.review',
        session_id: 's-1',
        task_id: 'kodo-1',
        from: 'in_progress',
        to: 'In review',
      },
      'record contiene exactamente los 4 campos + event, nada más',
    );
    assert.ok(!('title' in rec.fields), 'no filtra title');
    assert.ok(!('description' in rec.fields), 'no filtra description');
  });
});

describe('session-end.js source hygiene', () => {
  it('no importa PlaneClient ni el registry de providers (cleanup mecánico)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'hooks', 'session-end.js'),
      'utf-8',
    );
    assert.ok(!src.includes('PlaneClient'), 'no debe importar PlaneClient');
    // El cleanup mecánico sigue estáticamente DESACOPLADO del registry/config: no
    // hay `import { ... } from '.../registry.js'` ni de config en el bloque de
    // imports estáticos de cabecera. El backstop de review (DELIV-04) resuelve el
    // provider vía `await import(...)` perezoso (default de la DI), preservando el
    // never-throws — por eso el string aparece SOLO en un import dinámico.
    assert.ok(
      !/^\s*import\s+\{[^}]*\}\s+from\s+['"][^'"]*registry\.js['"]/m.test(src),
      'no debe importar estáticamente el registry (solo await import perezoso en el backstop)',
    );
    assert.ok(src.includes('performTerminalCleanup'), 'usa el helper compartido performTerminalCleanup');
  });
});
