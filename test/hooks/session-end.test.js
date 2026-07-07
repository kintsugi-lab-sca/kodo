// @ts-check
//
// test/hooks/session-end.test.js — Tests del hook SessionEnd (Phase 58, LIFE-03).
//
// SessionEnd hace el cleanup terminal DESTRUCTIVO al cierre real de la sesión:
// typed session.end event → lock release backstop → performTerminalCleanup
// (worktree + promptFile + removeSession). Idempotente (guard source==='history')
// y never-throws. La cobertura de worktree vive en stop-worktree-cleanup.test.js
// (re-apuntado a runSessionEndHook); aquí cubrimos la ruta sin worktree + guards.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSessionEndHook } from '../../src/hooks/session-end.js';
import { sessionBackstopReview, EVENTS } from '../../src/logger-events.js';

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

describe('runSessionEndHook — cleanup terminal (LIFE-03)', () => {
  it('sesión viva (no worktree): emite session.end + remueve la sesión', async () => {
    const session = makeSession();
    const { logger, events } = makeLogger();
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
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
        // Simula una sesión ya archivada (Stop espurio, SessionEnd previo, doctor).
        findSessionFn: () => ({ id: session.task_id, session, source: 'history' }),
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
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
        findSessionFn: () => null,
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
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
          findSessionFn: () => ({ id: session.task_id, session }),
          removeSessionFn: () => { throw new Error('state.json locked'); },
          loggerFactory: () => logger,
        },
      ),
      'el hook nunca debe rechazar (never-throws / fail-open)',
    );
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

describe('runSessionEndHook — review backstop (DELIV-04)', () => {
  it('tarea in_progress + reason limpio → transiciona a review + comenta + emite session.backstop.review; cleanup sigue', async () => {
    const session = makeSession();
    const { logger, events } = makeLogger();
    const { provider, calls } = makeProvider({ state: 'in_progress' });
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path, reason: 'clear' },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
        provider,
        config: makeConfig(),
      },
    );
    assert.equal(calls.updateTaskState.length, 1, 'updateTaskState llamado una vez');
    assert.equal(calls.updateTaskState[0].stateName, 'In review', 'con el reviewState resuelto');
    assert.equal(calls.updateTaskState[0].task.id, session.task_id, 'TaskItem mínimo reconstruido con task_id');
    assert.equal(calls.updateTaskState[0].task.projectId, session.project_id, 'TaskItem con projectId');
    assert.equal(calls.addComment.length, 1, 'addComment llamado una vez');
    assert.equal(calls.addComment[0].text, 'cierre automático', 'comentario «cierre automático»');
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
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
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
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
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
          findSessionFn: () => ({ id: session.task_id, session }),
          removeSessionFn: (id) => removed.push(id),
          loggerFactory: () => logger,
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
          findSessionFn: () => ({ id: session.task_id, session }),
          removeSessionFn: (id) => removed.push(id),
          loggerFactory: () => logger,
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
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: () => {},
        loggerFactory: () => logger,
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
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
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
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
        provider,
        config: { provider: 'plane', providers: { plane: { states: { review: 'In review', done: 'Done' } } } },
      },
    );
    assert.equal(calls.updateTaskState.length, 1, 'transiciona (estado no-terminal)');
    assert.equal(calls.updateTaskState[0].stateName, 'In review', 'con el reviewState resuelto');
    assert.equal(calls.addComment.length, 1, 'comenta «cierre automático»');
    assert.equal(calls.addComment[0].text, 'cierre automático');
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
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
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
          findSessionFn: () => ({ id: session.task_id, session }),
          removeSessionFn: () => {},
          loggerFactory: () => logger,
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
