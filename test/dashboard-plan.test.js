// @ts-check
//
// test/dashboard-plan.test.js — Phase 44 Plan 01 Task 1 (PLAN-01/PLAN-02; D-03/D-04/D-05/D-06/D-13).
//
// Tests PUROS (sin React, sin ink, sin disco real) del helper `readPlan` de
// src/cli/dashboard/plan.js. Cubren:
//   - phase_id primary (D-03) + prefijo padded correcto (verify.js canónico: "04" no matchea "40").
//   - concatenación ascendente de varios *-PLAN.md con cabecera por fichero (D-06).
//   - fallback resolvePhaseFn never-throws → SIEMPRE colapsa a 'no-phase' (Pitfall 2: NO se asserta
//     que el fallback tenga éxito; el row del dashboard no lleva task.title).
//   - never-throws (D-05): ENOENT → 'no-plan', EACCES/otros → 'error', readFile que lanza degrada
//     ese fichero a `(unreadable)` sin abortar el resto (best-effort).
//   - anti-ReDoS (D-13): un nombre con metacaracteres regex se matchea LITERAL por endsWith.
//
// Estado RED: ROJO hasta el Task 1 (plan.js no existe → ERR_MODULE_NOT_FOUND).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { readPlan } from '../src/cli/dashboard/plan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Fakes de filesystem inyectables ─────────────────────────────────────────
/**
 * Construye un set de DI deps con un árbol de directorios en memoria.
 * `tree` mapea path absoluto de directorio → array de entradas (nombres).
 * `files` mapea path absoluto de fichero → contenido string.
 * @param {{ dirs?: Record<string, string[]>, files?: Record<string, string>, exists?: (p: string) => boolean }} opts
 */
function makeFs({ dirs = {}, files = {}, exists } = {}) {
  return {
    existsFn: exists ?? ((p) => p in dirs || p in files),
    readdirFn: (p) => {
      if (p in dirs) return dirs[p];
      const err = new Error(`ENOENT: ${p}`);
      // @ts-expect-error code es propiedad de NodeJS.ErrnoException
      err.code = 'ENOENT';
      throw err;
    },
    readFileFn: (p) => {
      if (p in files) return files[p];
      const err = new Error(`ENOENT: ${p}`);
      // @ts-expect-error code es propiedad de NodeJS.ErrnoException
      err.code = 'ENOENT';
      throw err;
    },
  };
}

const BASE = '/proj';
const PHASES = '/proj/.planning/phases';

describe('readPlan — resolución de fase y lectura (D-03/D-04/D-06)', () => {
  it('phase_id="44" + dir "44-foo" con 44-01-PLAN.md → status ok, lines incluyen el contenido', () => {
    const deps = makeFs({
      dirs: {
        [PHASES]: ['44-foo'],
        [`${PHASES}/44-foo`]: ['44-01-PLAN.md', 'README.md'],
      },
      files: { [`${PHASES}/44-foo/44-01-PLAN.md`]: 'objective line\nsecond line' },
    });
    const res = readPlan({ phase_id: '44', project_path: BASE }, deps);
    assert.equal(res.status, 'ok');
    assert.ok(res.lines.includes('objective line'), `lines debe incluir el contenido\n${res.lines.join('\n')}`);
    assert.ok(res.lines.includes('second line'));
    assert.equal(res.render, 'plain', 'Phase 75: la rama GSD ok → render:plain (byte-idéntico, D-02 LOCKED)');
  });

  it('prefijo padded correcto: phase_id="4" matchea "04-foo" NO "40-foo" (startsWith `${padded}-`)', () => {
    const deps = makeFs({
      dirs: {
        [PHASES]: ['40-other', '04-foo'],
        [`${PHASES}/04-foo`]: ['04-01-PLAN.md'],
        [`${PHASES}/40-other`]: ['40-01-PLAN.md'],
      },
      files: {
        [`${PHASES}/04-foo/04-01-PLAN.md`]: 'four',
        [`${PHASES}/40-other/40-01-PLAN.md`]: 'forty',
      },
    });
    const res = readPlan({ phase_id: '4', project_path: BASE }, deps);
    assert.equal(res.status, 'ok');
    assert.ok(res.lines.includes('four'), 'debe leer el dir 04-foo');
    assert.ok(!res.lines.includes('forty'), 'NO debe leer el dir 40-other');
  });

  it('dos PLAN.md → concatenados ascendentes con cabecera `── <f> ──` antes de cada uno (D-06)', () => {
    const deps = makeFs({
      dirs: {
        [PHASES]: ['44-foo'],
        [`${PHASES}/44-foo`]: ['44-02-PLAN.md', '44-01-PLAN.md'],
      },
      files: {
        [`${PHASES}/44-foo/44-01-PLAN.md`]: 'first plan',
        [`${PHASES}/44-foo/44-02-PLAN.md`]: 'second plan',
      },
    });
    const res = readPlan({ phase_id: '44', project_path: BASE }, deps);
    assert.equal(res.status, 'ok');
    const text = res.lines.join('\n');
    assert.ok(text.includes('── 44-01-PLAN.md ──'), 'cabecera del primer fichero');
    assert.ok(text.includes('── 44-02-PLAN.md ──'), 'cabecera del segundo fichero');
    // Orden ascendente: 44-01 antes que 44-02.
    assert.ok(
      text.indexOf('── 44-01-PLAN.md ──') < text.indexOf('── 44-02-PLAN.md ──'),
      'orden ascendente por nombre de fichero',
    );
    assert.ok(text.indexOf('first plan') < text.indexOf('second plan'), 'contenido en orden');
  });

  it('worktree_path tiene prioridad sobre project_path como base (D-04)', () => {
    const WT = '/wt';
    const WT_PHASES = '/wt/.planning/phases';
    const deps = makeFs({
      dirs: {
        [WT_PHASES]: ['44-foo'],
        [`${WT_PHASES}/44-foo`]: ['44-01-PLAN.md'],
      },
      files: { [`${WT_PHASES}/44-foo/44-01-PLAN.md`]: 'from worktree' },
    });
    const res = readPlan({ phase_id: '44', worktree_path: WT, project_path: BASE }, deps);
    assert.equal(res.status, 'ok');
    assert.ok(res.lines.includes('from worktree'), 'debe leer desde worktree_path');
  });
});

describe('readPlan — fallback resolvePhaseFn (Pitfall 2: never-throws, NUNCA assert éxito)', () => {
  it('phase_id ausente + resolvePhaseFn devolviendo bootstrap → "no-phase" (nunca throw)', () => {
    const deps = makeFs({ dirs: { [PHASES]: ['44-foo'] } });
    const resolvePhaseFn = () => ({ action: 'bootstrap', reason: 'no-planning-dir' });
    const res = readPlan({ project_path: BASE }, { ...deps, resolvePhaseFn });
    assert.equal(res.status, 'no-phase');
    assert.deepEqual(res.lines, []);
  });

  it('phase_id ausente + resolvePhaseFn devolviendo no-match → "no-phase"', () => {
    const deps = makeFs({ dirs: { [PHASES]: ['44-foo'] } });
    const resolvePhaseFn = () => ({ action: 'error', code: 'no-match' });
    const res = readPlan({ project_path: BASE }, { ...deps, resolvePhaseFn });
    assert.equal(res.status, 'no-phase');
  });

  it('phase_id ausente + sin resolvePhaseFn → "no-phase"', () => {
    const deps = makeFs({ dirs: { [PHASES]: ['44-foo'] } });
    const res = readPlan({ project_path: BASE }, deps);
    assert.equal(res.status, 'no-phase');
  });

  it('resolvePhaseFn que lanza NO propaga el throw → colapsa a algo seguro (never-throws)', () => {
    const deps = makeFs({ dirs: { [PHASES]: ['44-foo'] } });
    const resolvePhaseFn = () => {
      throw new Error('boom');
    };
    let res;
    assert.doesNotThrow(() => {
      res = readPlan({ project_path: BASE }, { ...deps, resolvePhaseFn });
    });
    assert.equal(res.status, 'no-phase');
  });
});

describe('readPlan — estados vacíos / errores discriminados (D-05)', () => {
  it('dir de fase existe pero cero *-PLAN.md → "no-plan"', () => {
    const deps = makeFs({
      dirs: {
        [PHASES]: ['44-foo'],
        [`${PHASES}/44-foo`]: ['44-CONTEXT.md', 'README.md'],
      },
    });
    const res = readPlan({ phase_id: '44', project_path: BASE }, deps);
    assert.equal(res.status, 'no-plan');
  });

  it('phasesRoot inexistente (existsFn false) → "no-plan"', () => {
    const deps = makeFs({ dirs: {}, exists: () => false });
    const res = readPlan({ phase_id: '44', project_path: BASE }, deps);
    assert.equal(res.status, 'no-plan');
  });

  it('readdirFn lanzando ENOENT en phasesRoot → "no-plan", nunca throw', () => {
    const deps = {
      existsFn: () => true, // existe pero readdir lanza ENOENT (TOCTOU)
      readdirFn: () => {
        const err = new Error('ENOENT');
        // @ts-expect-error code
        err.code = 'ENOENT';
        throw err;
      },
      readFileFn: () => '',
    };
    let res;
    assert.doesNotThrow(() => {
      res = readPlan({ phase_id: '44', project_path: BASE }, deps);
    });
    assert.equal(res.status, 'no-plan');
  });

  it('readdirFn lanzando EACCES → "error", nunca throw', () => {
    const deps = {
      existsFn: () => true,
      readdirFn: () => {
        const err = new Error('EACCES');
        // @ts-expect-error code
        err.code = 'EACCES';
        throw err;
      },
      readFileFn: () => '',
    };
    let res;
    assert.doesNotThrow(() => {
      res = readPlan({ phase_id: '44', project_path: BASE }, deps);
    });
    assert.equal(res.status, 'error');
  });

  it('readFileFn que lanza en 1 de 2 ficheros → ese degrada a `(unreadable)`, el otro renderiza', () => {
    const deps = {
      existsFn: () => true,
      readdirFn: (p) => {
        if (p === PHASES) return ['44-foo'];
        if (p === `${PHASES}/44-foo`) return ['44-01-PLAN.md', '44-02-PLAN.md'];
        return [];
      },
      readFileFn: (p) => {
        if (p === `${PHASES}/44-foo/44-01-PLAN.md`) return 'readable content';
        const err = new Error('EACCES');
        // @ts-expect-error code
        err.code = 'EACCES';
        throw err; // 44-02 no se puede leer
      },
    };
    let res;
    assert.doesNotThrow(() => {
      res = readPlan({ phase_id: '44', project_path: BASE }, deps);
    });
    assert.equal(res.status, 'ok', 'best-effort: el overlay sigue siendo ok');
    const text = res.lines.join('\n');
    assert.ok(text.includes('readable content'), 'el fichero legible renderiza');
    assert.ok(text.includes('── 44-02-PLAN.md (unreadable) ──'), 'el ilegible degrada a (unreadable)');
  });
});

describe('readPlan — fallback plan ligero (D-05/D-08/D-09)', () => {
  // Phase 46 PLAN-04: cuando phaseId == null pero la fila lleva task_id, readPlan cae al
  // artefacto de plan ligero de Phase 45 (~/.kodo/plans/<task_id>.md). Override DI
  // `kodoPlansDir` aísla el HOME (D-08) — sin disco real, sin tocar el HOME del runner.
  const PLANS = '/fake-home/.kodo/plans';

  it('task_id + artefacto presente → status ok, lines incluyen el contenido', () => {
    const deps = {
      kodoPlansDir: PLANS,
      readFileFn: (p) => {
        if (p === `${PLANS}/task-abc.md`) return '# Mi plan\npaso uno\npaso dos';
        const err = new Error(`ENOENT: ${p}`);
        // @ts-expect-error code
        err.code = 'ENOENT';
        throw err;
      },
    };
    const res = readPlan({ task_id: 'task-abc' }, deps);
    assert.equal(res.status, 'ok');
    assert.ok(res.lines.includes('paso uno'), `lines debe incluir el contenido\n${res.lines.join('\n')}`);
    assert.ok(res.lines.includes('paso dos'));
    // Phase 75 (D-07): el carril de plan ligero 'ok' es el ÚNICO que se marca 'markdown'.
    assert.equal(res.render, 'markdown', 'readLightPlan ok → render:markdown (mini-renderer)');
  });

  it('task_id + ENOENT (artefacto ausente) → status no-light-plan', () => {
    const deps = {
      kodoPlansDir: PLANS,
      readFileFn: (p) => {
        const err = new Error(`ENOENT: ${p}`);
        // @ts-expect-error code
        err.code = 'ENOENT';
        throw err;
      },
    };
    const res = readPlan({ task_id: 'task-abc' }, deps);
    assert.equal(res.status, 'no-light-plan');
    assert.deepEqual(res.lines, []);
  });

  it('task_id + EACCES (artefacto ilegible) → status error', () => {
    const deps = {
      kodoPlansDir: PLANS,
      readFileFn: () => {
        const err = new Error('EACCES');
        // @ts-expect-error code
        err.code = 'EACCES';
        throw err;
      },
    };
    const res = readPlan({ task_id: 'task-abc' }, deps);
    assert.equal(res.status, 'error');
    assert.deepEqual(res.lines, []);
  });

  it('sin phase_id Y sin task_id → status no-phase (D-06 terminal)', () => {
    const res = readPlan({}, { kodoPlansDir: PLANS });
    assert.equal(res.status, 'no-phase');
    assert.deepEqual(res.lines, []);
  });

  it('readFileFn lanza un Error plano sin .code → status error AND never-throws (D-09)', () => {
    const deps = {
      kodoPlansDir: PLANS,
      readFileFn: () => {
        throw new Error('boom (sin code)');
      },
    };
    let res;
    assert.doesNotThrow(() => {
      res = readPlan({ task_id: 'task-abc' }, deps);
    });
    assert.equal(res.status, 'error');
    assert.deepEqual(res.lines, []);
  });

  it('task_id con path-traversal → no lee fuera de plansDir (guard de contención D-09)', () => {
    let readPath = null;
    const deps = {
      kodoPlansDir: PLANS,
      readFileFn: (p) => {
        readPath = p;
        const err = new Error(`ENOENT: ${p}`);
        // @ts-expect-error code
        err.code = 'ENOENT';
        throw err;
      },
    };
    const res = readPlan({ task_id: '../../etc/passwd' }, deps);
    // El guard trata el task_id no utilizable igual que falsy → no-phase terminal (D-06).
    assert.equal(res.status, 'no-phase', 'un task_id con separadores degrada a no-phase, no escapa del root');
    assert.equal(readPath, null, 'readFileFn NUNCA se invoca con una ruta que escape de plansDir');
  });
});

describe('readPlan — anti-ReDoS (D-13)', () => {
  it('un nombre con metacaracteres regex se matchea LITERAL por endsWith("-PLAN.md")', () => {
    const weird = '44-(a|b)-PLAN.md';
    const deps = makeFs({
      dirs: {
        [PHASES]: ['44-foo'],
        [`${PHASES}/44-foo`]: [weird],
      },
      files: { [`${PHASES}/44-foo/${weird}`]: 'literal match content' },
    });
    const res = readPlan({ phase_id: '44', project_path: BASE }, deps);
    assert.equal(res.status, 'ok', 'el nombre con (|) se trata como literal, no como patrón');
    assert.ok(res.lines.join('\n').includes('literal match content'));
    // Phase 75 (D-02 LOCKED, SC3): la rama GSD 'ok' se marca 'plain' → nunca pasa por el mini-renderer.
    assert.equal(res.render, 'plain', 'la rama GSD ok → render:plain (byte-idéntico)');
  });

  it('plan.js no compila ningún new RegExp (anti-ReDoS estructural, D-13)', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'cli', 'dashboard', 'plan.js'),
      'utf-8',
    );
    assert.ok(!src.includes('new RegExp'), 'plan.js NO debe contener `new RegExp` (D-13)');
  });
});
