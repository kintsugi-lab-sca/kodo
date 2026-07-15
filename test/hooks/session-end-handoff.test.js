// @ts-check
//
// test/hooks/session-end-handoff.test.js — Phase 74 Plan 04.
//
// Cubre `writeHandoff` (el RMW del plan bajo withFileLock) y su cableado en el seam
// `session-end.js:97`. Todo el I/O va contra un `mkdtempSync` inyectado por `plansDir`
// — JAMÁS el `~/.kodo` real del operador (T-74-15).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as realFs from 'node:fs';
import { writeHandoff, runSessionEndHook } from '../../src/hooks/session-end.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

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
 * Cmux stub — copiado de session-end.test.js:33-44, adaptado para EMPUJAR a un array
 * `calls` COMPARTIDO (en vez de crear el suyo) para poder assertar el orden de efectos
 * entre el handoff, el cleanup y el trío cosmético.
 */
function makeCmuxStub(calls) {
  return {
    setColor: async (args) => { calls.push({ fn: 'setColor', args }); },
    notify: async (args) => { calls.push({ fn: 'notify', args }); },
    listWorkspaces: async () => { calls.push({ fn: 'listWorkspaces' }); return ''; },
    send: async (args) => { calls.push({ fn: 'send', args }); },
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

/** Spy del escritor de state.tasks — sustituye a upsertTaskHandoff (Plan 02). */
function makeStateWriter() {
  const calls = [];
  return {
    calls,
    fn: (taskId, entry, logger) => {
      calls.push({ taskId, entry, logger });
      return { ok: true };
    },
  };
}

const FIXED_NOW = new Date('2026-07-15T10:30:00.000Z');

let plansDir;
beforeEach(() => {
  plansDir = mkdtempSync(join(tmpdir(), 'kodo-handoff-'));
});
afterEach(() => {
  rmSync(plansDir, { recursive: true, force: true });
});

// ── Task 1: writeHandoff ───────────────────────────────────────────────────────

describe('writeHandoff — RMW del plan bajo withFileLock (D-07/D-08/D-09)', () => {
  it('es SÍNCRONA — un fn asíncrono liberaría el lock antes de que la escritura aterrice (Pitfall 4)', () => {
    assert.equal(writeHandoff.constructor.name, 'Function');
    assert.notEqual(writeHandoff.constructor.name, 'AsyncFunction');
  });

  it('plan ausente → lo CREA con la cabecera mínima + el bloque mecánico (D-09)', () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const writer = makeStateWriter();
    const planPath = join(plansDir, `${session.task_id}.md`);
    assert.equal(existsSync(planPath), false, 'precondición: el plan no existe');

    writeHandoff(
      { session, input: { reason: 'clear' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );

    assert.equal(existsSync(planPath), true, 'el fichero del plan existe tras la llamada');
    const md = readFileSync(planPath, 'utf-8');
    assert.ok(md.startsWith(`# ${session.task_ref} — ${session.summary}`), 'cabecera mínima de buildPlanHeader');
    assert.ok(md.includes('## Handoff '), 'gana un bloque de handoff');
    assert.ok(md.includes('— automático'), 'el bloque es el mecánico (distinguible, LIVE-03)');
  });

  it('plan existente sin marcador de esta sesión → appendea el mecánico; el contenido previo queda ÍNTEGRO byte a byte (LIVE-03)', () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const writer = makeStateWriter();
    const planPath = join(plansDir, `${session.task_id}.md`);
    const original = '# Mi plan\n\nPaso 1: hacer algo\nPaso 2: hacer otra cosa\n';
    writeFileSync(planPath, original);

    writeHandoff(
      { session, input: { reason: 'clear' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );

    const md = readFileSync(planPath, 'utf-8');
    assert.ok(md.startsWith(original), 'el contenido previo es un PREFIJO íntegro del resultado');
    assert.ok(md.length > original.length, 'algo se appendeó');
    assert.ok(md.includes('— automático'), 'el bloque mecánico está presente');
  });

  it('plan CON el marcador de ESTA sesión → el fichero NO cambia (D-04: el LLM ya escribió)', () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const writer = makeStateWriter();
    const planPath = join(plansDir, `${session.task_id}.md`);
    const original = [
      '# Mi plan',
      '',
      `## Handoff 2026-07-15 10:00 <!-- kodo:handoff v=1 session=${session.session_id} author=llm at=2026-07-15T08:00:00.000Z -->`,
      '',
      '**Hecho:** el LLM escribió su handoff',
      '**NEXT:** revisar el PR #42',
      '',
    ].join('\n');
    writeFileSync(planPath, original);

    writeHandoff(
      { session, input: { reason: 'clear' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );

    assert.equal(readFileSync(planPath, 'utf-8'), original, 'el fichero es idéntico byte a byte');
  });

  it('CASO CRÍTICO D-04: bloque de una sesión ANTERIOR + esta sesión sin escribir → SÍ appendea; acaba con DOS bloques', () => {
    const session = makeSession({ session_id: 's-nueva' });
    const { logger } = makeLogger();
    const writer = makeStateWriter();
    const planPath = join(plansDir, `${session.task_id}.md`);
    const original = [
      '# Mi plan',
      '',
      '## Handoff 2026-07-14 09:00 <!-- kodo:handoff v=1 session=s-anterior author=llm at=2026-07-14T07:00:00.000Z -->',
      '',
      '**Hecho:** trabajo de la sesión anterior',
      '',
    ].join('\n');
    writeFileSync(planPath, original);

    writeHandoff(
      { session, input: { reason: 'clear' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );

    const md = readFileSync(planPath, 'utf-8');
    assert.ok(md.startsWith(original), 'el bloque de la sesión anterior queda ÍNTEGRO');
    const blocks = md.split('\n').filter((l) => l.startsWith('## Handoff '));
    assert.equal(blocks.length, 2, 'el fichero acaba con DOS bloques — el detector es scoped, no por conteo');
    assert.ok(md.includes('session=s-nueva'), 'el segundo bloque es el de esta sesión');
  });

  it('acumulación (LIVE-02): dos llamadas con session_id distintos dejan DOS bloques y el primero íntegro', () => {
    const { logger } = makeLogger();
    const writer = makeStateWriter();
    const planPath = join(plansDir, `${makeSession().task_id}.md`);

    writeHandoff(
      { session: makeSession({ session_id: 's-1' }), input: { reason: 'clear' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );
    const afterFirst = readFileSync(planPath, 'utf-8');

    writeHandoff(
      { session: makeSession({ session_id: 's-2' }), input: { reason: 'logout' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );
    const afterSecond = readFileSync(planPath, 'utf-8');

    assert.ok(afterSecond.startsWith(afterFirst), 'el primer bloque queda íntegro');
    assert.equal(
      afterSecond.split('\n').filter((l) => l.startsWith('## Handoff ')).length,
      2,
      'dos bloques acumulados',
    );
    assert.ok(afterSecond.includes('session=s-1'), 'bloque de la sesión 1');
    assert.ok(afterSecond.includes('session=s-2'), 'bloque de la sesión 2');
  });

  it('persistencia (LIVE-04): el stateWriterFn recibe (task_id, {plan_path, next, updated_at})', () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const writer = makeStateWriter();

    writeHandoff(
      { session, input: { reason: 'clear' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );

    assert.equal(writer.calls.length, 1, 'el escritor de state se llama exactamente una vez');
    const [call] = writer.calls;
    assert.equal(call.taskId, session.task_id, 'con el task_id');
    assert.equal(call.entry.plan_path, join(plansDir, `${session.task_id}.md`), 'plan_path apunta al fichero escrito');
    assert.equal(call.entry.updated_at, FIXED_NOW.toISOString(), 'updated_at del reloj inyectado');
  });

  it('bloque mecánico appendeado → el `next` que llega al stateWriterFn es null (D-03: sin NEXT)', () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const writer = makeStateWriter();

    writeHandoff(
      { session, input: { reason: 'clear' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );

    assert.equal(writer.calls[0].entry.next, null, 'el bloque mecánico no tiene NEXT');
  });

  it('el LLM ya escribió con **NEXT:** → ese valor llega al stateWriterFn, truncado a 200 (D-02)', () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const writer = makeStateWriter();
    const planPath = join(plansDir, `${session.task_id}.md`);
    writeFileSync(
      planPath,
      [
        '# Mi plan',
        '',
        `## Handoff 2026-07-15 10:00 <!-- kodo:handoff v=1 session=${session.session_id} author=llm at=2026-07-15T08:00:00.000Z -->`,
        '',
        '**NEXT:** revisar el PR #42 y desplegar',
        '',
      ].join('\n'),
    );

    writeHandoff(
      { session, input: { reason: 'clear' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );

    assert.equal(writer.calls[0].entry.next, 'revisar el PR #42 y desplegar', 'el NEXT extraído del bloque del LLM');
  });

  it('el NEXT se trunca a 200 caracteres al persistir (D-02)', () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const writer = makeStateWriter();
    const long = 'x'.repeat(500);
    writeFileSync(
      join(plansDir, `${session.task_id}.md`),
      [
        `## Handoff 2026-07-15 10:00 <!-- kodo:handoff v=1 session=${session.session_id} author=llm at=2026-07-15T08:00:00.000Z -->`,
        '',
        `**NEXT:** ${long}`,
        '',
      ].join('\n'),
    );

    writeHandoff(
      { session, input: { reason: 'clear' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );

    assert.equal(writer.calls[0].entry.next.length, 200, 'truncado duro a 200');
  });

  it('T-74-01: task_id = "../../evil" → NO crea ningún fichero, emite warn, y NO llama al stateWriterFn', () => {
    const session = makeSession({ task_id: '../../evil' });
    const { logger, events } = makeLogger();
    const writer = makeStateWriter();
    const escapee = join(plansDir, '..', '..', 'evil.md');

    writeHandoff(
      { session, input: { reason: 'clear' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );

    assert.deepEqual(readdirSync(plansDir), [], 'plansDir sigue vacío');
    assert.equal(existsSync(escapee), false, 'no se creó ningún fichero fuera de plansDir');
    assert.equal(writer.calls.length, 0, 'el stateWriterFn NO se llamó');
    assert.ok(events.some((e) => e.level === 'warn'), 'emite un warn del task_id inseguro');
  });

  it('T-74-08: los logs llevan SOLO {task_id, reason} — nunca el next ni el summary', () => {
    const session = makeSession({ task_id: '../../evil', summary: 'SECRETO-SUMMARY' });
    const { logger, events } = makeLogger();
    const writer = makeStateWriter();

    writeHandoff(
      { session, input: { reason: 'clear' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );

    const warn = events.find((e) => e.level === 'warn');
    assert.ok(warn, 'hay un warn');
    const keys = Object.keys(warn.fields || {});
    assert.ok(keys.every((k) => k === 'task_id' || k === 'reason'), `campos permitidos, vi: ${keys}`);
    assert.ok(!JSON.stringify(warn.fields).includes('SECRETO-SUMMARY'), 'el summary nunca sale en los logs');
  });

  it('SC#5 — plan ilegible: un fs cuyo readFileSync lanza EACCES → writeHandoff PROPAGA (el caller lo captura)', () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const writer = makeStateWriter();
    writeFileSync(join(plansDir, `${session.task_id}.md`), '# plan\n');
    const fsStub = {
      ...realFs,
      readFileSync: () => {
        const err = new Error('permission denied');
        /** @type {any} */ (err).code = 'EACCES';
        throw err;
      },
    };

    assert.throws(
      () =>
        writeHandoff(
          { session, input: { reason: 'clear' }, log: logger },
          { plansDir, fs: fsStub, stateWriterFn: writer.fn, now: () => FIXED_NOW },
        ),
      /permission denied/,
      'propaga — el try/catch del seam (Task 2) es quien lo captura',
    );
    assert.equal(writer.calls.length, 0, 'no persiste state tras un fallo de lectura');
  });

  it('SC#5 — lock ocupado por un pid VIVO → warn, sin stateWriterFn, sin throw', () => {
    const session = makeSession();
    const { logger, events } = makeLogger();
    const writer = makeStateWriter();
    const lockPath = join(plansDir, `${session.task_id}.md.lock`);
    // Lock fresco de un pid vivo (el nuestro) → acquireLock agota reintentos → {ok:false}.
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, acquired_at: Date.now(), token: 'otro-dueño' }),
    );

    assert.doesNotThrow(() =>
      writeHandoff(
        { session, input: { reason: 'clear' }, log: logger },
        { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
      ),
    );

    assert.equal(existsSync(join(plansDir, `${session.task_id}.md`)), false, 'no escribió el plan');
    assert.equal(writer.calls.length, 0, 'no persiste state en lock-timeout (D-06)');
    assert.ok(events.some((e) => e.level === 'warn'), 'emite un warn del lock ocupado');
  });

  it('determinismo: con un `now` fijo, dos ejecuciones sobre el mismo estado inicial dan ficheros byte-idénticos', () => {
    const { logger } = makeLogger();
    const writer = makeStateWriter();
    const run = () => {
      const dir = mkdtempSync(join(tmpdir(), 'kodo-det-'));
      writeHandoff(
        { session: makeSession(), input: { reason: 'clear' }, log: logger },
        { plansDir: dir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
      );
      const md = readFileSync(join(dir, `${makeSession().task_id}.md`), 'utf-8');
      rmSync(dir, { recursive: true, force: true });
      return md;
    };
    assert.equal(run(), run(), 'byte-idénticos');
  });

  it('higiene del tmp: tras una escritura correcta no queda ningún fichero .tmp. en plansDir', () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const writer = makeStateWriter();

    writeHandoff(
      { session, input: { reason: 'clear' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );

    assert.deepEqual(
      readdirSync(plansDir).filter((f) => f.includes('.tmp.')),
      [],
      'sin residuo de tmp',
    );
  });

  it('el `reason` desconocido de stdin colapsa a `other` antes de interpolar (D-03, T-74-02)', () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const writer = makeStateWriter();

    writeHandoff(
      { session, input: { reason: 'valor-inventado-hostil' }, log: logger },
      { plansDir, stateWriterFn: writer.fn, now: () => FIXED_NOW },
    );

    const md = readFileSync(join(plansDir, `${session.task_id}.md`), 'utf-8');
    assert.ok(md.includes('motivo: other'), 'el enum cerrado colapsa lo desconocido');
    assert.ok(!md.includes('valor-inventado-hostil'), 'el valor crudo NUNCA aterriza en el markdown');
  });
});
