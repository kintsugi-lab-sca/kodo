// @ts-check
//
// test/dashboard-question.test.js — KODO-108: la pregunta de `kodo ask` en la fila del dashboard.
//
// Congela dos cosas: con pregunta, su texto aparece (en una línea, truncado) bajo la fila; sin
// pregunta, el frame es IDÉNTICO al de una sesión que nunca tuvo el campo. Además, el enrich de
// filas sanea el texto (es contenido LLM), igual que el NEXT:.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import SessionTable from '../src/cli/dashboard/SessionTable.js';
import { questionCell } from '../src/cli/dashboard/format.js';
import { deriveRows } from '../src/cli/dashboard/rows.js';
import { render } from './helpers/ink-frame.js';

const COUNTS = { running: 0, review: 0, done: 0, error: 0, zombie: 0 };

/** @param {any[]} rows */
function frameOf(rows) {
  const { lastFrame, unmount } = render(
    createElement(SessionTable, {
      rows,
      selectedIndex: 0,
      counts: COUNTS,
      connected: true,
      lastGoodCount: 0,
      lastGoodAt: 1,
      lastAttemptAt: 1,
      mode: 'list',
    }),
  );
  try {
    return lastFrame() ?? '';
  } finally {
    unmount();
  }
}

const BASE = { task_id: 'a', task_ref: 'KODO-108', status: 'idle', state: 'idle', alive: true, elapsed_min: 3 };

describe('KODO-108: pregunta pendiente en la fila', () => {
  it('con pregunta: el texto aparece bajo la fila', () => {
    const frame = frameOf([{ ...BASE, pending_question: { text: '¿Borro la rama vieja?', at: 'x' } }]);
    assert.match(frame, /¿Borro la rama vieja\?/, frame);
    const lines = frame.split('\n');
    const rowIdx = lines.findIndex((l) => l.includes('KODO-108'));
    assert.ok(lines[rowIdx + 1]?.includes('¿Borro la rama vieja?'), `la pregunta va en la línea siguiente a la fila\n${frame}`);
  });

  it('sin pregunta: el frame es idéntico al de hoy (campo ausente, null o con forma rara)', () => {
    const today = frameOf([BASE]);
    assert.equal(frameOf([{ ...BASE, pending_question: undefined }]), today);
    assert.equal(frameOf([{ ...BASE, pending_question: null }]), today);
    assert.equal(frameOf([{ ...BASE, pending_question: { text: 42 } }]), today);
  });

  it('una pregunta larga se trunca a una sola línea', () => {
    const frame = frameOf([{ ...BASE, pending_question: { text: `${'palabra '.repeat(60)}FIN`, at: 'x' } }]);
    assert.ok(!frame.includes('FIN'), `debe truncarse\n${frame}`);
    const today = frameOf([BASE]);
    assert.equal(frame.split('\n').length, today.split('\n').length + 1, 'exactamente una línea más');
  });

  it('questionCell colapsa whitespace y degrada a "" ante formas inesperadas', () => {
    assert.equal(questionCell({ pending_question: { text: ' a\n b ', at: 'x' } }), 'a b');
    assert.equal(questionCell({}), '');
    assert.equal(questionCell(/** @type {any} */ ({ pending_question: 'q' })), '');
  });

  it('deriveRows sanea el texto de la pregunta (contenido LLM)', () => {
    const { enriched } = deriveRows({
      sessions: [{ ...BASE, started_at: '2026-10-28T09:00:00Z', pending_question: { text: 'a\x1b[2Jb\x07?', at: 'x' } }],
      query: '',
      selectedTaskId: null,
      prevIndex: 0,
      tasks: {},
      lastGood: new Map(),
    });
    assert.equal(enriched[0].pending_question.text, 'ab?');
  });
});
