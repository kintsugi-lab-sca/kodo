// @ts-check
//
// test/dashboard-select.test.js — Phase 36 Plan 01 Wave 0 (TUI-08, TUI-09, TUI-11, TUI-12).
//
// Tests PUROS (sin React, sin ink) de la capa de derive del cursor/orden/contadores del
// dashboard: `sortSessions`, `resolveSelection`, `countByStatus`. El runner de Node carece
// de `mock.module` y `ink-testing-library@4` no expone `waitUntilExit()`, así que las DOS
// invariantes load-bearing de la fase se expresan como tests PUROS de `resolveSelection`:
//   - TUI-08: la selección sigue a `task_id` al reordenar y clampa al desaparecer la fila.
//   - TUI-12: el cursor se preserva al aplicar y luego limpiar el filtro (mismo task_id).
//
// Estado Wave 0: ROJO hasta el Task 2 (select.js no existe → ERR_MODULE_NOT_FOUND).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  sortSessions,
  resolveSelection,
  applyFilter,
  parseFilter,
  countByStatus,
} from '../src/cli/dashboard/select.js';

import { deriveRepo } from '../src/cli/dashboard/format.js';

/**
 * Fixture mínima de sesión (solo los campos que la capa de derive lee).
 * @param {object} over — overrides por campo.
 */
function s(over = {}) {
  return {
    task_id: 'tid',
    task_ref: 'KL-1',
    status: 'running',
    started_at: '2026-05-27T10:00:00.000Z',
    alive: true,
    project_name: 'kodo',
    project_path: '/x/kodo',
    summary: 'summary',
    ...over,
  };
}

describe('TUI-08 (D-05/D-06): resolveSelection sigue a task_id + clamp', () => {
  it('sigue la identidad: con la fila seleccionada reordenada, devuelve su nueva posición', () => {
    const after = [s({ task_id: 'a' }), s({ task_id: 'b' }), s({ task_id: 'c' })];
    const sel = resolveSelection(after, 'b', 0);
    assert.equal(sel.taskId, 'b', `taskId debe seguir siendo 'b', fue ${sel.taskId}`);
    assert.equal(sel.index, 1, `index debe ser la nueva pos de 'b' (1), fue ${sel.index}`);
  });

  it('clamp al desaparecer la fila seleccionada — nunca devuelve un task_id ausente', () => {
    // LOAD-BEARING (TUI-08 / D-06): 'b' desaparece del refresh; prevIndex 1.
    const after = [s({ task_id: 'a' }), s({ task_id: 'c' })]; // 'b' eliminado
    const sel = resolveSelection(after, 'b', 1);
    assert.notEqual(sel.taskId, 'b', `no debe apuntar al id ausente 'b', fue ${sel.taskId}`);
    assert.equal(
      after.some((r) => r.task_id === sel.taskId),
      true,
      `el taskId resuelto (${sel.taskId}) debe existir en la lista actual`,
    );
  });

  it('lista vacía → { index: -1, taskId: null }', () => {
    const sel = resolveSelection([], 'b', 3);
    assert.deepEqual(
      sel,
      { index: -1, taskId: null },
      `lista vacía debe dar {index:-1, taskId:null}, fue ${JSON.stringify(sel)}`,
    );
  });

  it('clamp de bounds: prevIndex pasado del final → len-1; negativo → 0', () => {
    const rows = [s({ task_id: 'a' }), s({ task_id: 'b' })];
    const past = resolveSelection(rows, 'gone', 99);
    assert.equal(past.index, 1, `prevIndex 99 debe clampar a len-1 (1), fue ${past.index}`);
    assert.equal(past.taskId, 'b', `debe devolver el task_id de la pos clampada, fue ${past.taskId}`);
    const neg = resolveSelection(rows, 'gone', -5);
    assert.equal(neg.index, 0, `prevIndex -5 debe clampar a 0, fue ${neg.index}`);
    assert.equal(neg.taskId, 'a', `debe devolver el task_id de la pos 0, fue ${neg.taskId}`);
  });
});

describe('TUI-12 (D-16): cursor preservado al aplicar→limpiar filtro', () => {
  it('aplicar un filtro que conserva la sesión seleccionada y luego limpiarlo mantiene el task_id', () => {
    // LOAD-BEARING (TUI-12 / D-16): sort → filtrar a un subconjunto que aún contiene 'b' →
    // resolveSelection lo conserva; al limpiar (lista completa) sigue siendo 'b'.
    const full = sortSessions([
      s({ task_id: 'a', status: 'done', started_at: '2026-05-27T09:00:00.000Z' }),
      s({ task_id: 'b', status: 'running', started_at: '2026-05-27T10:00:00.000Z' }),
      s({ task_id: 'c', status: 'review', started_at: '2026-05-27T11:00:00.000Z' }),
    ]);
    const selected = 'b';

    const parsed = parseFilter('s:running');
    const filtered = applyFilter(full, parsed, deriveRepo);
    const selInFilter = resolveSelection(filtered, selected, 0);
    assert.equal(
      selInFilter.taskId,
      'b',
      `dentro del filtro el cursor debe seguir en 'b', fue ${selInFilter.taskId}`,
    );

    // Limpiar el filtro → lista completa; el cursor vuelve/permanece en 'b'.
    const selCleared = resolveSelection(full, selInFilter.taskId, selInFilter.index);
    assert.equal(
      selCleared.taskId,
      'b',
      `al limpiar el filtro el cursor debe seguir en 'b', fue ${selCleared.taskId}`,
    );
  });
});

describe('TUI-09 (D-04): sortSessions DESC por started_at sobre una COPIA + tiebreak task_id', () => {
  it('no muta el array de entrada', () => {
    const input = [
      s({ task_id: 'a', started_at: '2026-05-27T09:00:00.000Z' }),
      s({ task_id: 'b', started_at: '2026-05-27T11:00:00.000Z' }),
    ];
    const before = input.map((r) => r.task_id);
    sortSessions(input);
    const after = input.map((r) => r.task_id);
    assert.deepEqual(after, before, `sortSessions no debe mutar la entrada, era ${before} ahora ${after}`);
  });

  it('newest started_at primero (DESC)', () => {
    const sorted = sortSessions([
      s({ task_id: 'old', started_at: '2026-05-27T08:00:00.000Z' }),
      s({ task_id: 'new', started_at: '2026-05-27T12:00:00.000Z' }),
      s({ task_id: 'mid', started_at: '2026-05-27T10:00:00.000Z' }),
    ]);
    assert.deepEqual(
      sorted.map((r) => r.task_id),
      ['new', 'mid', 'old'],
      `orden DESC esperado [new, mid, old], fue ${sorted.map((r) => r.task_id)}`,
    );
  });

  it('timestamps iguales: desempate determinista por task_id; nunca intercambian con input barajado', () => {
    const ts = '2026-05-27T10:00:00.000Z';
    const first = sortSessions([
      s({ task_id: 'z', started_at: ts }),
      s({ task_id: 'a', started_at: ts }),
      s({ task_id: 'm', started_at: ts }),
    ]).map((r) => r.task_id);
    const shuffled = sortSessions([
      s({ task_id: 'm', started_at: ts }),
      s({ task_id: 'z', started_at: ts }),
      s({ task_id: 'a', started_at: ts }),
    ]).map((r) => r.task_id);
    assert.deepEqual(
      first,
      shuffled,
      `igual timestamp debe ordenar determinista por task_id sin importar el input; ${first} vs ${shuffled}`,
    );
    assert.deepEqual(first, ['a', 'm', 'z'], `desempate lexicográfico por task_id, fue ${first}`);
  });
});

describe('TUI-11 (D-11): countByStatus cuenta zombie aparte de running', () => {
  it('una lista con running+alive, zombie, review, done, error', () => {
    const counts = countByStatus([
      s({ task_id: '1', status: 'running', alive: true }),
      s({ task_id: '2', status: 'running', alive: false }), // zombie
      s({ task_id: '3', status: 'review' }),
      s({ task_id: '4', status: 'done' }),
      s({ task_id: '5', status: 'error' }),
    ]);
    assert.deepEqual(
      counts,
      { running: 1, review: 1, done: 1, error: 1, zombie: 1 },
      `el zombie debe contarse aparte de running, fue ${JSON.stringify(counts)}`,
    );
  });
});
