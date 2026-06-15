// @ts-check
//
// test/dashboard-progress.test.js — Phase 50.1 Plan 01 (PROG-02; DG-01/DG-02/DG-07).
//
// Tests PUROS (sin React, sin ink, sin disco real) del lector `readGsdProgress` de
// src/cli/dashboard/progress.js. La FUENTE es el bloque `progress:` del STATE.md del
// worktree GSD (DG-02), NO ~/.claude/tasks/ ni ~/.kodo/progress/.
//
// Espejo del mold de readLightPlan (plan.js:65-78):
//   - DI readFileFn → HOME isolation, markdown sintético, sin tocar el disco real.
//   - discriminante de status: bloque parseable → 'ok'; ENOENT → 'no-progress';
//     STATE.md parcial (sin total_phases) → 'no-progress'; otro error / corrupto → 'error'.
//   - never-throws (DG-07): JSON corrupto / EACCES / sin frontmatter degradan a 'error',
//     jamás throw.
//   - path byte-idéntico: join(worktreeBase, '.planning', 'STATE.md').
//   - N/M = FASES (DG-01): m=total_phases, n=completed_phases ?? 0, completed = m>0 && n===m.
//
// Estado RED: ROJO hasta el Task 2 (readGsdProgress no existe → falla el import nombrado).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readGsdProgress, parseProgressBlock } from '../src/cli/dashboard/progress.js';

// Worktree base sintético — el lector construye join(base, '.planning', 'STATE.md').
const BASE = '/fake-worktree';
const STATE_PATH = `${BASE}/.planning/STATE.md`;

/** Construye un STATE.md sintético con frontmatter `progress:` y las keys dadas. */
function stateMd(progressLines) {
  return [
    '---',
    'milestone: v0.12',
    'progress:',
    ...progressLines.map((l) => `  ${l}`),
    '---',
    '',
    '# Project State',
    '',
  ].join('\n');
}

describe('readGsdProgress — lector del bloque progress: del STATE.md (DG-01/DG-02/DG-07)', () => {
  it('Test 1 (ok, en progreso): total_phases:5 completed_phases:3 → { ok, n:3, m:5, completed:false }', () => {
    const md = stateMd(['total_phases: 5', 'completed_phases: 3', 'total_plans: 7', 'completed_plans: 7', 'percent: 60']);
    const deps = {
      readFileFn: (p) => {
        assert.equal(p, STATE_PATH, 'path byte-idéntico: join(base, .planning, STATE.md)');
        return md;
      },
    };
    const res = readGsdProgress(BASE, deps);
    assert.deepEqual(res, { status: 'ok', n: 3, m: 5, completed: false });
  });

  it('Test 2 (ok, completado): total_phases:5 completed_phases:5 → { ok, n:5, m:5, completed:true }', () => {
    const md = stateMd(['total_phases: 5', 'completed_phases: 5', 'percent: 100']);
    const deps = { readFileFn: () => md };
    const res = readGsdProgress(BASE, deps);
    assert.deepEqual(res, { status: 'ok', n: 5, m: 5, completed: true });
  });

  it('Test 3 (parcial sin total_phases): STATE.md sin total_phases → { no-progress }', () => {
    // El generador GSD añade cada key con `if (x !== null)` — sin total_phases no hay denominador.
    const md = stateMd(['completed_plans: 2', 'percent: 40']);
    const deps = { readFileFn: () => md };
    const res = readGsdProgress(BASE, deps);
    assert.deepEqual(res, { status: 'no-progress' });
  });

  it('Test 4 (parcial con total_phases sin completed_phases): n=0, m=total_phases, ok', () => {
    // completed_phases ausente → n=0 (default), m presente → progreso 0/M válido.
    const md = stateMd(['total_phases: 4']);
    const deps = { readFileFn: () => md };
    const res = readGsdProgress(BASE, deps);
    assert.deepEqual(res, { status: 'ok', n: 0, m: 4, completed: false });
  });

  it('Test 5 (no-progress): ENOENT (sin STATE.md) → { no-progress }', () => {
    const deps = {
      readFileFn: () => {
        const err = new Error('ENOENT: no such file');
        // @ts-expect-error code
        err.code = 'ENOENT';
        throw err;
      },
    };
    const res = readGsdProgress(BASE, deps);
    assert.deepEqual(res, { status: 'no-progress' });
  });

  it('Test 6a (error): EACCES → { error } (never-throws)', () => {
    const deps = {
      readFileFn: () => {
        const err = new Error('EACCES');
        // @ts-expect-error code
        err.code = 'EACCES';
        throw err;
      },
    };
    const res = readGsdProgress(BASE, deps);
    assert.deepEqual(res, { status: 'error' });
  });

  it('Test 6b (error): contenido corrupto sin frontmatter --- → { error } (never-throws)', () => {
    const deps = { readFileFn: () => 'esto no tiene frontmatter\nprogress sin delimitadores' };
    const res = readGsdProgress(BASE, deps);
    assert.deepEqual(res, { status: 'error' });
  });

  it('determinismo: mismo STATE.md → mismo resultado', () => {
    const md = stateMd(['total_phases: 5', 'completed_phases: 3']);
    const deps = { readFileFn: () => md };
    assert.deepEqual(readGsdProgress(BASE, deps), readGsdProgress(BASE, deps));
  });

  it('WR-02 (clamp n>m): completed_phases:5 con total_phases:3 → n clampado a m (3/3, completed)', () => {
    // LOAD-BEARING (WR-02): un over-count del artefacto externo no debe renderizar 5/3.
    // n se acota a [0, m]; con n===m el set se marca completado.
    const md = stateMd(['total_phases: 3', 'completed_phases: 5']);
    const res = readGsdProgress(BASE, { readFileFn: () => md });
    assert.deepEqual(res, { status: 'ok', n: 3, m: 3, completed: true }, 'n debe clampar a m, no 5/3');
  });

  it('WR-01 (scoping): keys allowlisted bajo un bloque NO-progress: se ignoran → { no-progress }', () => {
    // LOAD-BEARING (WR-01): total_phases/completed_phases indentadas bajo `other:`
    // (sin bloque `progress:` en absoluto) NO deben alimentar el N/M del dashboard.
    const md = ['---', 'other:', '  total_phases: 42', '  completed_phases: 7', '---', '', '# State', ''].join('\n');
    const res = readGsdProgress(BASE, { readFileFn: () => md });
    assert.deepEqual(res, { status: 'no-progress' }, 'keys fuera de progress: no deben contar');
  });

  it('WR-01 (scoping): solo el bloque progress: alimenta N/M aunque otro bloque reuse las keys', () => {
    // Un bloque `other:` con keys-señuelo PRECEDE a `progress:`. El parser debe leer
    // exclusivamente las del bloque progress: (3/5), no las del señuelo (7/42).
    const md = [
      '---',
      'other:',
      '  total_phases: 42',
      '  completed_phases: 7',
      'progress:',
      '  total_phases: 5',
      '  completed_phases: 3',
      '---',
      '',
    ].join('\n');
    const res = readGsdProgress(BASE, { readFileFn: () => md });
    assert.deepEqual(res, { status: 'ok', n: 3, m: 5, completed: false }, 'solo el bloque progress: cuenta');
  });

  it('WR-01 (parseProgressBlock): extrae solo las keys indentadas bajo progress:', () => {
    const md = [
      '---',
      'progress:',
      '  total_phases: 5',
      '  completed_phases: 3',
      'other:',
      '  total_phases: 99', // señuelo tras el bloque progress: → debe ignorarse
      '---',
      '',
    ].join('\n');
    assert.deepEqual(parseProgressBlock(md), { total_phases: 5, completed_phases: 3 });
  });
});
