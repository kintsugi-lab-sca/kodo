// @ts-check
//
// test/hooks/task-progress.test.js — Phase 50 Plan 02 Task 1 (PROG-02; D-03/D-04/D-05).
//
// Tests PUROS (sin spawn, sin disco real cuando es posible) del hook de captura
// `src/hooks/task-progress.js`. El hook es un hook SEPARADO (NO append a
// session-start.js — golden-bytes HOOK-02) y es never-throws fire-and-forget.
//
// Cubre los 9 behaviors del plan:
//   1. recuento: 3 N.json (1 completed, 2 pending) → { n:1, m:3, completed:false }
//   2. completado: 3 de 3 completed → { n:3, m:3, completed:true }
//   3. filtrado: .lock/.highwatermark NO se cuentan en M
//   4. status estricto: cancelled/blocked/in_progress NO inflan N; N nunca > M
//   5. never-throws / tasks-dir ausente (ENOENT) → no escribe, no lanza
//   6. never-throws / JSON corrupto → no cuenta, no lanza, los demás cuentan
//   7. sesión no rastreada (findSession → null) → no-op silencioso
//   8. anti-traversal: task_id con / \ .. → NO escribe
//   9. payload basura (sin session_id / no-JSON) → salida silenciosa
//
// Inyección de dependencias (mold readLightPlan plan.js:65-69): el hook expone
// helpers puros con DI para aislar el HOME en tests sin tocar el disco real.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveProgress, runProgressHook } from '../../src/hooks/task-progress.js';

// ── Fake de tasks-dir en memoria ────────────────────────────────────────────
/**
 * Construye DI deps para deriveProgress/runProgressHook con un tasks-dir en memoria.
 * @param {{ entries?: string[], files?: Record<string, string> }} opts
 *   `entries`: nombres devueltos por readdir del tasks-dir.
 *   `files`: nombre → contenido JSON crudo de cada N.json.
 */
function makeTasksFs({ entries = [], files = {} } = {}) {
  return {
    readdirFn: (/** @type {string} */ _dir) => entries.slice(),
    readFileFn: (/** @type {string} */ p) => {
      // p es join(tasksDir, name); extraemos el basename.
      const name = p.split('/').pop();
      if (name && name in files) return files[name];
      const err = /** @type {NodeJS.ErrnoException} */ (new Error(`ENOENT: ${p}`));
      err.code = 'ENOENT';
      throw err;
    },
  };
}

function taskJson(status) {
  return JSON.stringify({ id: '1', subject: 's', description: 'd', status, blocks: [], blockedBy: [] });
}

describe('task-progress hook — deriveProgress (recuento autoritativo)', () => {
  it('Test 1: 3 N.json (1 completed, 2 pending) → n:1 m:3 completed:false', () => {
    const fs = makeTasksFs({
      entries: ['1.json', '2.json', '3.json'],
      files: { '1.json': taskJson('completed'), '2.json': taskJson('pending'), '3.json': taskJson('pending') },
    });
    const r = deriveProgress('/fake/tasks/sid', fs);
    assert.deepEqual(r, { n: 1, m: 3 });
  });

  it('Test 2: 3 de 3 completed → n:3 m:3 (completed:true se deriva en el snapshot)', () => {
    const fs = makeTasksFs({
      entries: ['1.json', '2.json', '3.json'],
      files: { '1.json': taskJson('completed'), '2.json': taskJson('completed'), '3.json': taskJson('completed') },
    });
    const r = deriveProgress('/fake/tasks/sid', fs);
    assert.deepEqual(r, { n: 3, m: 3 });
  });

  it('Test 3: filtra .lock/.highwatermark — M cuenta solo *.json sin punto inicial', () => {
    const fs = makeTasksFs({
      entries: ['.lock', '.highwatermark', '1.json', '2.json'],
      files: { '1.json': taskJson('completed'), '2.json': taskJson('pending') },
    });
    const r = deriveProgress('/fake/tasks/sid', fs);
    assert.equal(r.m, 2, 'M solo cuenta los *.json sin . inicial');
    assert.equal(r.n, 1);
  });

  it('Test 4: status estricto — cancelled/blocked/in_progress NO inflan N; N <= M', () => {
    const fs = makeTasksFs({
      entries: ['1.json', '2.json', '3.json', '4.json'],
      files: {
        '1.json': taskJson('completed'),
        '2.json': taskJson('cancelled'),
        '3.json': taskJson('blocked'),
        '4.json': taskJson('in_progress'),
      },
    });
    const r = deriveProgress('/fake/tasks/sid', fs);
    assert.equal(r.m, 4);
    assert.equal(r.n, 1, 'solo status==="completed" cuenta (igualdad estricta)');
    assert.ok(r.n <= r.m, 'N nunca > M');
  });

  it('Test 5: tasks-dir ausente (ENOENT en readdir) → null (no escribe)', () => {
    const fs = {
      readdirFn: () => {
        const err = /** @type {NodeJS.ErrnoException} */ (new Error('ENOENT'));
        err.code = 'ENOENT';
        throw err;
      },
      readFileFn: () => '',
    };
    const r = deriveProgress('/fake/tasks/missing', fs);
    assert.equal(r, null, 'ENOENT → null (cohorte sin tasks-dir tolerada)');
  });

  it('Test 6: JSON corrupto → no cuenta como completed, no lanza, los demás cuentan', () => {
    const fs = makeTasksFs({
      entries: ['1.json', '2.json', '3.json'],
      files: { '1.json': taskJson('completed'), '2.json': '{ corrupto a medio', '3.json': taskJson('completed') },
    });
    const r = deriveProgress('/fake/tasks/sid', fs);
    assert.equal(r.m, 3, 'el corrupto sí cuenta en M (es un *.json)');
    assert.equal(r.n, 2, 'el corrupto no cuenta como completed (self-heal)');
  });
});

describe('task-progress hook — runProgressHook (never-throws, correlación, escritura)', () => {
  /** Crea DI con un writer que captura las escrituras. */
  function makeDeps({ entries = [], files = {}, found = undefined, readdirThrows = false } = {}) {
    const writes = [];
    const mkdirs = [];
    return {
      writes,
      mkdirs,
      deps: {
        readdirFn: readdirThrows
          ? () => { const e = /** @type {NodeJS.ErrnoException} */ (new Error('ENOENT')); e.code = 'ENOENT'; throw e; }
          : () => entries.slice(),
        readFileFn: (/** @type {string} */ p) => {
          const name = p.split('/').pop();
          if (name && name in files) return files[name];
          const err = /** @type {NodeJS.ErrnoException} */ (new Error('ENOENT')); err.code = 'ENOENT'; throw err;
        },
        findSessionFn: (/** @type {any} */ _q) => found,
        mkdirFn: (/** @type {string} */ d) => { mkdirs.push(d); },
        writeFileFn: (/** @type {string} */ p, /** @type {string} */ c) => { writes.push({ p, c }); },
        homedirFn: () => '/home/test',
      },
    };
  }

  it('Test 7: findSession → null → no-op silencioso (no escribe)', async () => {
    const { writes, deps } = makeDeps({
      entries: ['1.json'],
      files: { '1.json': taskJson('completed') },
      found: null,
    });
    await runProgressHook({ session_id: 'sid-untracked' }, deps);
    assert.equal(writes.length, 0, 'sesión no rastreada → no escribe artefacto');
  });

  it('escribe artefacto con found.session.task_id (UUID) y completed:true cuando n===m', async () => {
    const { writes, deps } = makeDeps({
      entries: ['1.json', '2.json'],
      files: { '1.json': taskJson('completed'), '2.json': taskJson('completed') },
      found: { id: 'x', session: { task_id: 'uuid-kodo-abc' }, source: 'sessions' },
    });
    await runProgressHook({ session_id: 'sid-1', task_id: '1' }, deps);
    assert.equal(writes.length, 1);
    assert.ok(
      writes[0].p.endsWith('/home/test/.kodo/progress/uuid-kodo-abc.json'.replace('/home/test', '/home/test')),
      `ruta byte-idéntica al consumidor: ${writes[0].p}`,
    );
    assert.equal(writes[0].p, '/home/test/.kodo/progress/uuid-kodo-abc.json');
    const snap = JSON.parse(writes[0].c);
    assert.equal(snap.n, 2);
    assert.equal(snap.m, 2);
    assert.equal(snap.completed, true);
    assert.equal(typeof snap.updated_at, 'string');
    assert.ok(writes[0].c.endsWith('\n'), 'el artefacto termina en newline');
  });

  it('completed:false cuando n<m', async () => {
    const { writes, deps } = makeDeps({
      entries: ['1.json', '2.json'],
      files: { '1.json': taskJson('completed'), '2.json': taskJson('pending') },
      found: { id: 'x', session: { task_id: 'uuid-kodo-def' }, source: 'sessions' },
    });
    await runProgressHook({ session_id: 'sid-2' }, deps);
    const snap = JSON.parse(writes[0].c);
    assert.equal(snap.completed, false);
    assert.equal(snap.n, 1);
    assert.equal(snap.m, 2);
  });

  it('Test 8: anti-traversal — task_id con / \\ .. → NO escribe', async () => {
    for (const evil of ['../evil', 'a/b', 'a\\b', '..']) {
      const { writes, deps } = makeDeps({
        entries: ['1.json'],
        files: { '1.json': taskJson('completed') },
        found: { id: 'x', session: { task_id: evil }, source: 'sessions' },
      });
      await runProgressHook({ session_id: 'sid-evil' }, deps);
      assert.equal(writes.length, 0, `task_id traversal "${evil}" no debe escribir`);
    }
  });

  it('anti-traversal: task_id falsy → NO escribe', async () => {
    const { writes, deps } = makeDeps({
      entries: ['1.json'],
      files: { '1.json': taskJson('completed') },
      found: { id: 'x', session: { task_id: '' }, source: 'sessions' },
    });
    await runProgressHook({ session_id: 'sid-empty' }, deps);
    assert.equal(writes.length, 0);
  });

  it('Test 5b (never-throws / tasks-dir ausente): readdir ENOENT → no escribe, no lanza', async () => {
    const { writes, deps } = makeDeps({
      readdirThrows: true,
      found: { id: 'x', session: { task_id: 'uuid-kodo-z' }, source: 'sessions' },
    });
    await assert.doesNotReject(runProgressHook({ session_id: 'sid-noenoent' }, deps));
    assert.equal(writes.length, 0, 'sin tasks-dir → no escribe');
  });

  it('Test 9: payload sin session_id → salida silenciosa, no escribe, no lanza', async () => {
    const { writes, deps } = makeDeps({
      found: { id: 'x', session: { task_id: 'uuid' }, source: 'sessions' },
    });
    await assert.doesNotReject(runProgressHook({ cwd: '/x' }, deps));
    assert.equal(writes.length, 0);
  });

  it('Test 9b: payload null/basura → never-throws', async () => {
    const { writes, deps } = makeDeps({});
    await assert.doesNotReject(runProgressHook(null, deps));
    await assert.doesNotReject(runProgressHook(undefined, deps));
    await assert.doesNotReject(runProgressHook(42, deps));
    assert.equal(writes.length, 0);
  });

  it('Test 6b (never-throws / writeFile lanza): un writeFileFn que lanza no propaga', async () => {
    const { deps } = makeDeps({
      entries: ['1.json'],
      files: { '1.json': taskJson('completed') },
      found: { id: 'x', session: { task_id: 'uuid-kodo-w' }, source: 'sessions' },
    });
    deps.writeFileFn = () => { throw new Error('EACCES'); };
    await assert.doesNotReject(runProgressHook({ session_id: 'sid-wfail' }, deps));
  });
});
