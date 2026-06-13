// @ts-check
//
// test/dashboard-progress.test.js — Phase 50 Plan 03 Task 1 (PROG-03; D-08/D-09).
//
// Tests PUROS (sin React, sin ink, sin disco real) del consumidor `readProgress` de
// src/cli/dashboard/progress.js. Espejo del mold de readLightPlan (plan.js:65-78):
//   - DI readFileFn/kodoProgressDir/homedirFn → HOME isolation, sin tocar el HOME del runner.
//   - discriminante de status: contenido → 'ok'; ENOENT → 'no-progress'; otro → 'error'.
//   - never-throws (D-09): JSON corrupto / EACCES degradan a 'error', jamás throw.
//   - path byte-idéntico al productor (Plan 02): join(progDir, `${taskId}.json`).
//
// Estado RED: ROJO hasta el Task 1 (progress.js no existe → ERR_MODULE_NOT_FOUND).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readProgress } from '../src/cli/dashboard/progress.js';

// Override DI `kodoProgressDir` aísla el HOME (D-08) — sin disco real.
const PROG = '/fake-home/.kodo/progress';

describe('readProgress — consumidor never-throws con discriminante de status (D-08/D-09)', () => {
  it('Test 1 (ok, en progreso): artefacto { n:1, m:3, completed:false } → { status:ok, n:1, m:3, completed:false }', () => {
    const deps = {
      kodoProgressDir: PROG,
      readFileFn: (p) => {
        assert.equal(p, `${PROG}/task-abc.json`, 'path byte-idéntico al productor');
        return JSON.stringify({ n: 1, m: 3, completed: false, updated_at: '2026-06-13T00:00:00.000Z' });
      },
    };
    const res = readProgress('task-abc', deps);
    assert.deepEqual(res, { status: 'ok', n: 1, m: 3, completed: false });
  });

  it('Test 2 (ok, completado): { n:3, m:3, completed:true } → { status:ok, n:3, m:3, completed:true }', () => {
    const deps = {
      kodoProgressDir: PROG,
      readFileFn: () => JSON.stringify({ n: 3, m: 3, completed: true }),
    };
    const res = readProgress('task-abc', deps);
    assert.deepEqual(res, { status: 'ok', n: 3, m: 3, completed: true });
  });

  it('Test 3 (no-progress): ENOENT (sin artefacto) → { status:no-progress }', () => {
    const deps = {
      kodoProgressDir: PROG,
      readFileFn: () => {
        const err = new Error(`ENOENT: no such file`);
        // @ts-expect-error code
        err.code = 'ENOENT';
        throw err;
      },
    };
    const res = readProgress('task-abc', deps);
    assert.deepEqual(res, { status: 'no-progress' });
  });

  it('Test 4a (error): EACCES → { status:error } (never-throws)', () => {
    const deps = {
      kodoProgressDir: PROG,
      readFileFn: () => {
        const err = new Error('EACCES');
        // @ts-expect-error code
        err.code = 'EACCES';
        throw err;
      },
    };
    const res = readProgress('task-abc', deps);
    assert.deepEqual(res, { status: 'error' });
  });

  it('Test 4b (error): JSON corrupto → { status:error } (never-throws)', () => {
    const deps = {
      kodoProgressDir: PROG,
      readFileFn: () => '{ esto no es json válido',
    };
    const res = readProgress('task-abc', deps);
    assert.deepEqual(res, { status: 'error' });
  });

  it('Test 5 (HOME isolation): kodoProgressDir inyectado → lee de ahí, no del HOME real', () => {
    let pathSeen = null;
    const deps = {
      kodoProgressDir: PROG,
      readFileFn: (p) => {
        pathSeen = p;
        return JSON.stringify({ n: 2, m: 5, completed: false });
      },
    };
    const res = readProgress('uuid-xyz', deps);
    assert.equal(pathSeen, `${PROG}/uuid-xyz.json`, 'lee del dir inyectado, no del HOME real');
    assert.deepEqual(res, { status: 'ok', n: 2, m: 5, completed: false });
  });

  it('completed se normaliza a bool con !! (un artefacto sin completed → false, no undefined)', () => {
    const deps = {
      kodoProgressDir: PROG,
      readFileFn: () => JSON.stringify({ n: 0, m: 4 }),
    };
    const res = readProgress('task-abc', deps);
    assert.deepEqual(res, { status: 'ok', n: 0, m: 4, completed: false });
  });
});
