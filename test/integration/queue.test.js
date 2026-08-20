// @ts-check
//
// test/integration/queue.test.js — KODO-26: el store de la cola sobre state.json.
//
// AISLAMIENTO DEL HOME OBLIGATORIO, con la misma trampa que documenta
// `test/state/handoff-state.test.js:11-17`: `config.js:11` evalúa `join(homedir(), '.kodo')` en
// MODULE-LOAD y `state.js:14` deriva STATE_PATH de ahí. Un import ESTÁTICO de queue.js en la
// cabecera de este fichero escribiría en el `~/.kodo` REAL del operador en cada `npm test`. De
// ahí el `process.env.HOME = tmpHome` ANTES del `await import(...)` dentro de `before()`.
//
// SEMBRADO v3 igual de obligatorio (misma referencia): sin fichero en disco, `loadState`
// devuelve la forma v2 y la siguiente carga dispararía `migrateStateV2toV3`, cuya reconstrucción
// exhaustiva DESCARTA toda clave desconocida — `integration_queue` incluida.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
/** @type {typeof import('../../src/integration/queue.js').enqueueIntegration} */
let enqueueIntegration;
/** @type {typeof import('../../src/integration/queue.js').resolveIntegration} */
let resolveIntegration;
/** @type {typeof import('../../src/integration/queue.js').listIntegrationQueue} */
let listIntegrationQueue;
/** @type {typeof import('../../src/integration/queue.js').findPendingIntegration} */
let findPendingIntegration;
let RESOLVED_CAP;

const STATE_REL = ['.kodo', 'state.json'];

function writeSeed(extra = {}) {
  writeFileSync(
    join(tmpHome, ...STATE_REL),
    JSON.stringify({ schema_version: 3, sessions: {}, history: [], ...extra }, null, 2) + '\n',
  );
}

function readRawState() {
  return JSON.parse(readFileSync(join(tmpHome, ...STATE_REL), 'utf-8'));
}

/** Input mínimo de captura; los tests sobreescriben lo que les interesa. */
function input(overrides = {}) {
  return {
    task_ref: 'KODO-26',
    task_id: 'uuid-26',
    project_path: '/repo/kodo',
    branch: 'worktree-abc',
    base_branch: 'main',
    commits_ahead: 3,
    base_ok: true,
    files_changed: 2,
    lines_changed: 40,
    suggested: /** @type {'merge'} */ ('merge'),
    ...overrides,
  };
}

describe('cola de integración — store sobre state.json', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-intq-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    const mod = await import('../../src/integration/queue.js');
    enqueueIntegration = mod.enqueueIntegration;
    resolveIntegration = mod.resolveIntegration;
    listIntegrationQueue = mod.listIntegrationQueue;
    findPendingIntegration = mod.findPendingIntegration;
    RESOLVED_CAP = mod.RESOLVED_CAP;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => writeSeed());

  it('encola una entrada con las 17 claves en ORDEN FIJO (byte-determinismo del --json)', () => {
    const r = enqueueIntegration(input(), undefined, { now: () => new Date('2026-08-20T10:00:00.000Z') });
    assert.equal(r.ok, true);

    const [entry] = readRawState().integration_queue;
    assert.deepEqual(Object.keys(entry), [
      'task_ref',
      'task_id',
      'project_path',
      'branch',
      'base_branch',
      'commits_ahead',
      'base_ok',
      'files_changed',
      'lines_changed',
      'suggested',
      'status',
      'created_at',
      'updated_at',
      'action',
      'sha',
      'outcome',
      'resolved_at',
    ]);
    assert.equal(entry.status, 'pending');
    assert.equal(entry.created_at, '2026-08-20T10:00:00.000Z');
    assert.equal(entry.action, null);
    assert.equal(entry.sha, null);
    assert.equal(entry.resolved_at, null);
  });

  it('la clave es ADITIVA: un state.json sin `integration_queue` se lee como cola vacía', () => {
    assert.deepEqual(listIntegrationQueue({}), []);
    assert.equal(readRawState().integration_queue, undefined, 'un listado NO crea la clave');
  });

  it('dedupe por (project_path, branch): el segundo cierre REFRESCA, no duplica', () => {
    enqueueIntegration(input(), undefined, { now: () => new Date('2026-08-20T10:00:00.000Z') });
    const r2 = enqueueIntegration(
      input({ commits_ahead: 7, suggested: 'pr', base_ok: false }),
      undefined,
      { now: () => new Date('2026-08-20T12:00:00.000Z') },
    );

    assert.equal(r2.ok, true);
    assert.equal(r2.value.deduped, true);
    const queue = readRawState().integration_queue;
    assert.equal(queue.length, 1, 'una sola fila para la misma rama');
    assert.equal(queue[0].commits_ahead, 7, 'el conteo se refresca');
    assert.equal(queue[0].suggested, 'pr');
    assert.equal(queue[0].base_ok, false);
    assert.equal(queue[0].created_at, '2026-08-20T10:00:00.000Z', 'la EDAD se conserva');
    assert.equal(queue[0].updated_at, '2026-08-20T12:00:00.000Z', 'updated_at sí avanza');
  });

  it('dos ramas del mismo repo, o la misma rama en repos distintos, son entradas DISTINTAS', () => {
    enqueueIntegration(input({ branch: 'rama-a' }));
    enqueueIntegration(input({ branch: 'rama-b' }));
    enqueueIntegration(input({ branch: 'rama-a', project_path: '/repo/otro' }));
    assert.equal(readRawState().integration_queue.length, 3);
  });

  it('resolver NO borra: la entrada queda con status/action/sha/outcome y sale de pending', () => {
    enqueueIntegration(input());
    const r = resolveIntegration(
      'KODO-26',
      { action: 'merge', sha: 'abc123', outcome: 'merged' },
      undefined,
      { now: () => new Date('2026-08-20T13:00:00.000Z') },
    );

    assert.equal(r.ok, true);
    const queue = readRawState().integration_queue;
    assert.equal(queue.length, 1, 'la entrada SIGUE en state.json (traza)');
    assert.equal(queue[0].status, 'done');
    assert.equal(queue[0].action, 'merge');
    assert.equal(queue[0].sha, 'abc123');
    assert.equal(queue[0].outcome, 'merged');
    assert.equal(queue[0].resolved_at, '2026-08-20T13:00:00.000Z');
    assert.deepEqual(listIntegrationQueue({}), [], 'ya no está pendiente');
    assert.equal(listIntegrationQueue({ all: true }).length, 1, 'pero sigue listándose con --all');
  });

  it('--drop marca `dropped` sin sha', () => {
    enqueueIntegration(input());
    resolveIntegration('KODO-26', { action: 'drop', outcome: 'dropped' });
    const [entry] = readRawState().integration_queue;
    assert.equal(entry.status, 'dropped');
    assert.equal(entry.action, 'drop');
    assert.equal(entry.sha, null);
  });

  it('resolver una ref inexistente o ya resuelta → not-found (no re-escribe la traza)', () => {
    assert.deepEqual(resolveIntegration('NO-EXISTE', { action: 'ff', outcome: 'x' }), {
      ok: false,
      reason: 'not-found',
    });
    enqueueIntegration(input());
    resolveIntegration('KODO-26', { action: 'ff', sha: 'aaa', outcome: 'fast-forwarded' });
    const second = resolveIntegration('KODO-26', { action: 'drop', outcome: 'dropped' });
    assert.deepEqual(second, { ok: false, reason: 'not-found' });
    assert.equal(readRawState().integration_queue[0].action, 'ff', 'la traza original no se pisa');
  });

  it('el selector acepta también el nombre de la rama', () => {
    enqueueIntegration(input());
    assert.equal(findPendingIntegration('worktree-abc')?.task_ref, 'KODO-26');
    const r = resolveIntegration('worktree-abc', { action: 'drop', outcome: 'dropped' });
    assert.equal(r.ok, true);
  });

  it('una rama que vuelve a acumular trabajo tras un merge se encola de NUEVO', () => {
    enqueueIntegration(input());
    resolveIntegration('KODO-26', { action: 'merge', sha: 'abc', outcome: 'merged' });
    const r = enqueueIntegration(input({ commits_ahead: 1 }));
    assert.equal(r.ok, true);
    assert.equal(r.value.deduped, false, 'una resuelta NO bloquea el re-encolado');
    const queue = readRawState().integration_queue;
    assert.equal(queue.length, 2, 'la resuelta se conserva como traza junto a la nueva');
    assert.equal(listIntegrationQueue({}).length, 1);
  });

  it('el cap de resueltas evicta las más antiguas y NUNCA toca las pendientes', () => {
    // Una pendiente ANTIGUA primero: debe sobrevivir a toda la presión posterior.
    enqueueIntegration(input({ branch: 'pendiente-vieja' }));
    for (let i = 0; i < RESOLVED_CAP + 5; i++) {
      enqueueIntegration(input({ task_ref: `T-${i}`, branch: `rama-${i}` }));
      resolveIntegration(`T-${i}`, { action: 'drop', outcome: 'dropped' });
    }
    const queue = readRawState().integration_queue;
    const resolved = queue.filter((e) => e.status !== 'pending');
    const pending = queue.filter((e) => e.status === 'pending');
    assert.equal(resolved.length, RESOLVED_CAP, 'las resueltas quedan acotadas al cap');
    assert.equal(resolved[0].task_ref, 'T-5', 'se evictan las MÁS ANTIGUAS (FIFO)');
    assert.deepEqual(pending.map((e) => e.branch), ['pendiente-vieja'], 'la pendiente sobrevive');
  });

  it('listIntegrationQueue never-throws ante un state.json corrupto', () => {
    writeFileSync(join(tmpHome, ...STATE_REL), '{ esto no es json');
    assert.deepEqual(listIntegrationQueue({}), []);
    assert.equal(findPendingIntegration('KODO-26'), null);
  });

  it('el logger recibe telemetría SIN contenido de negocio más allá de ref/rama/tier', () => {
    const calls = { info: [], warn: [] };
    const logger = {
      debug() {},
      info: (event, meta) => calls.info.push({ event, meta }),
      warn: (event, meta) => calls.warn.push({ event, meta }),
      error() {},
      child() { return this; },
    };
    enqueueIntegration(input(), /** @type {any} */ (logger));
    assert.equal(calls.info.length, 1);
    assert.equal(calls.info[0].event, 'integration.queue.enqueued');
    assert.deepEqual(Object.keys(calls.info[0].meta).sort(), ['branch', 'deduped', 'suggested', 'task_ref']);
  });
});
