// @ts-check
//
// test/dashboard-tasks.test.js — Phase 75 Plan 01 Task 1 (LIVE-05; D-01/D-02).
//
// Tests PUROS (sin React, sin ink, sin disco real del operador) del reader leaf
// `readTasks` de src/cli/dashboard/tasks.js. Cubren los cuatro caminos de dato:
//   - state.json con clave `tasks` → devuelve exactamente ese objeto.
//   - state.json inexistente (ENOENT) → {} (no lanza).
//   - JSON corrupto (parse falla) → {} (no lanza).
//   - state.json SIN clave `tasks` (o tasks null / no-objeto) → {} (no lanza).
//
// DI de HOME (kodoDir / readFileFn / homedirFn) aísla el ~/.kodo real: el test
// NUNCA lee el state.json del operador (mismo patrón que dashboard-plan.test.js).
//
// Estado RED: ROJO hasta el Task 1 (tasks.js no existe → ERR_MODULE_NOT_FOUND).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readTasks } from '../src/cli/dashboard/tasks.js';

// ── Fake de filesystem inyectable ────────────────────────────────────────────
/**
 * Construye una `readFileFn` que sirve un contenido fijo para el path esperado,
 * o lanza ENOENT para cualquier otro (modela un ~/.kodo aislado).
 * @param {string|null} content — contenido a servir, o null para forzar siempre ENOENT.
 */
function makeReadFile(content) {
  return (/** @type {string} */ _p) => {
    if (content == null) {
      const err = new Error(`ENOENT: ${_p}`);
      // @ts-expect-error code es propiedad de NodeJS.ErrnoException
      err.code = 'ENOENT';
      throw err;
    }
    return content;
  };
}

const KODO_DIR = '/fake/.kodo';

describe('readTasks — lectura never-throws de state.tasks (LIVE-05)', () => {
  it('state.json con clave `tasks` → devuelve exactamente ese objeto tasks', () => {
    const tasks = {
      'task-abc': { plan_path: '~/.kodo/plans/task-abc.md', next: 'Escribir el test RED', updated_at: '2026-07-17T10:00:00Z' },
      'task-def': { plan_path: '~/.kodo/plans/task-def.md', next: null, updated_at: '2026-07-17T09:00:00Z' },
    };
    const state = { schema_version: 4, sessions: {}, tasks };
    const out = readTasks({ kodoDir: KODO_DIR, readFileFn: makeReadFile(JSON.stringify(state)) });
    assert.deepEqual(out, tasks);
  });

  it('state.json inexistente (ENOENT) → {} (no lanza)', () => {
    const out = readTasks({ kodoDir: KODO_DIR, readFileFn: makeReadFile(null) });
    assert.deepEqual(out, {});
  });

  it('JSON corrupto (parse falla) → {} (no lanza)', () => {
    const out = readTasks({ kodoDir: KODO_DIR, readFileFn: makeReadFile('{ esto no es json }') });
    assert.deepEqual(out, {});
  });

  it('state.json SIN clave `tasks` → {} (no lanza)', () => {
    const state = { schema_version: 4, sessions: {} };
    const out = readTasks({ kodoDir: KODO_DIR, readFileFn: makeReadFile(JSON.stringify(state)) });
    assert.deepEqual(out, {});
  });

  it('state.json con `tasks: null` → {} (no lanza)', () => {
    const state = { schema_version: 4, sessions: {}, tasks: null };
    const out = readTasks({ kodoDir: KODO_DIR, readFileFn: makeReadFile(JSON.stringify(state)) });
    assert.deepEqual(out, {});
  });

  it('state.json con `tasks` no-objeto (array/string) → {} (no lanza)', () => {
    const stateArr = { schema_version: 4, sessions: {}, tasks: ['x'] };
    // Un array es typeof 'object'; el guard lo acepta como objeto (mismo comportamiento
    // que state.js:61). Modelamos aquí el caso escalar, que sí colapsa a {}.
    const stateStr = { schema_version: 4, sessions: {}, tasks: 'nope' };
    assert.deepEqual(
      readTasks({ kodoDir: KODO_DIR, readFileFn: makeReadFile(JSON.stringify(stateStr)) }),
      {},
    );
    // El array pasa el guard typeof===object (paridad con state.js); no es un caso de error.
    assert.deepEqual(
      readTasks({ kodoDir: KODO_DIR, readFileFn: makeReadFile(JSON.stringify(stateArr)) }),
      ['x'],
    );
  });

  it('DI: homedirFn aísla el HOME real (construye kodoDir por defecto)', () => {
    const state = { schema_version: 4, sessions: {}, tasks: { t: { plan_path: 'p', next: 'n', updated_at: 'u' } } };
    let seenPath = '';
    const out = readTasks({
      homedirFn: () => '/home/tester',
      readFileFn: (/** @type {string} */ p) => {
        seenPath = p;
        return JSON.stringify(state);
      },
    });
    assert.deepEqual(out, state.tasks);
    // La ruta se construye bajo el HOME inyectado, jamás bajo el ~ del operador.
    assert.ok(seenPath.startsWith('/home/tester'), `esperaba ruta bajo HOME inyectado, vi: ${seenPath}`);
    assert.ok(seenPath.endsWith('state.json'), `esperaba .../state.json, vi: ${seenPath}`);
  });
});
