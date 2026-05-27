// @ts-check
//
// test/dashboard-filter.test.js — Phase 36 Plan 01 Wave 0 (TUI-12; D-14, Security V5).
//
// Tests PUROS (sin React, sin ink) del parse/match del filtro modal: `parseFilter` separa los
// prefijos `r:`/`s:` del texto global; `applyFilter` hace AND de los criterios vía
// `String.includes` — NUNCA `new RegExp` (anti-ReDoS / anti-inyección de regex desde la query
// tecleada por el operador, T-36-01). El test de chars regex-especiales prueba que un patrón
// como `.*` se matchea LITERALMENTE como substring y jamás se compila.
//
// Estado Wave 0: ROJO hasta el Task 2 (select.js no existe → ERR_MODULE_NOT_FOUND).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseFilter, applyFilter } from '../src/cli/dashboard/select.js';
import { deriveRepo } from '../src/cli/dashboard/format.js';

/** Fixture mínima de sesión para el match. */
function s(over = {}) {
  return {
    task_id: 'tid',
    task_ref: 'KL-1',
    status: 'running',
    project_name: 'kodo',
    project_path: '/x/kodo',
    summary: 'build the thing',
    ...over,
  };
}

describe('TUI-12 (D-14): parseFilter separa r:/s: del texto global', () => {
  it('r:kodo s:running build → { repo:kodo, status:running, text:build }', () => {
    const p = parseFilter('r:kodo s:running build');
    assert.deepEqual(
      p,
      { repo: 'kodo', status: 'running', text: 'build' },
      `parse esperado, fue ${JSON.stringify(p)}`,
    );
  });
  it('query vacía → { repo:null, status:null, text:"" }', () => {
    const p = parseFilter('');
    assert.deepEqual(
      p,
      { repo: null, status: null, text: '' },
      `query vacía debe dar criterios nulos, fue ${JSON.stringify(p)}`,
    );
  });
  it('case folding: R:KODO baja a kodo', () => {
    const p = parseFilter('R:KODO');
    assert.equal(p.repo, 'kodo', `el valor del prefijo debe bajar a 'kodo', fue ${p.repo}`);
  });
});

describe('TUI-12 (D-14): applyFilter hace AND de criterios', () => {
  it('r:kodo + s:running deja solo deriveRepo incluye kodo Y status === running', () => {
    const rows = [
      s({ task_id: '1', project_name: 'kodo', status: 'running' }), // pasa
      s({ task_id: '2', project_name: 'kodo', status: 'done' }), // falla status
      s({ task_id: '3', project_name: 'otro', status: 'running' }), // falla repo
    ];
    const out = applyFilter(rows, parseFilter('r:kodo s:running'), deriveRepo);
    assert.deepEqual(
      out.map((r) => r.task_id),
      ['1'],
      `AND de repo+status debe dejar solo '1', fue ${out.map((r) => r.task_id)}`,
    );
  });

  it('texto global hace substring sobre task_ref/repo/phase_id/gsd_mode/summary, case-insensitive', () => {
    const rows = [
      s({ task_id: '1', summary: 'Build The Thing' }),
      s({ task_id: '2', summary: 'unrelated' }),
      s({ task_id: '3', task_ref: 'BUILD-9', summary: 'x' }),
    ];
    const out = applyFilter(rows, parseFilter('build'), deriveRepo);
    assert.deepEqual(
      out.map((r) => r.task_id).sort(),
      ['1', '3'],
      `'build' debe matchear summary y task_ref case-insensitive, fue ${out.map((r) => r.task_id)}`,
    );
  });
});

describe('TUI-12 (Security V5 / T-36-01): applyFilter NUNCA compila regex', () => {
  it("una query con chars regex-especiales ('.*') se matchea literalmente y no lanza", () => {
    const rows = [
      s({ task_id: '1', summary: 'literal .* inside' }),
      s({ task_id: '2', summary: 'nothing special' }),
    ];
    let out;
    assert.doesNotThrow(() => {
      out = applyFilter(rows, parseFilter('.*'), deriveRepo);
    }, 'applyFilter no debe lanzar ante chars regex-especiales');
    assert.deepEqual(
      out.map((r) => r.task_id),
      ['1'],
      `'.*' debe matchear LITERALMENTE el summary que contiene '.*', fue ${out.map((r) => r.task_id)}`,
    );
  });
});
