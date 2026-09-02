// @ts-check
//
// KODO-73 — la regla pura de bloqueo. Sin red, sin disco, sin HOME temporal: el módulo
// no importa nada (restricción estructural, igual que src/operator.js), así que el test
// tampoco necesita montar nada.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SKIP_BLOCKED,
  blockerVerdict,
  blockerSignature,
  formatBlockedComment,
  shouldAnnounceBlock,
  forgetAnnouncedBlock,
} from '../src/blockers.js';

describe('KODO-73: blockerVerdict', () => {
  it('sin bloqueadores → no bloqueada', () => {
    assert.deepEqual(blockerVerdict({ blockers: [] }), { blocked: false });
  });

  it('todos los bloqueadores cerrados → no bloqueada', () => {
    const verdict = blockerVerdict({
      blockers: [
        { id: 'a', ref: 'KL-1', state: 'done' },
        { id: 'b', ref: 'KL-2', state: 'done' },
      ],
    });
    assert.deepEqual(verdict, { blocked: false });
  });

  it('un bloqueador abierto → bloqueada, con el motivo y solo los abiertos', () => {
    const verdict = blockerVerdict({
      blockers: [
        { id: 'a', ref: 'KL-1', state: 'done' },
        { id: 'b', ref: 'KL-2', state: 'in_progress' },
      ],
    });
    assert.equal(verdict.blocked, true);
    assert.equal(verdict.code, SKIP_BLOCKED);
    assert.deepEqual(verdict.open, [{ id: 'b', ref: 'KL-2', state: 'in_progress' }]);
  });

  // El caso que motiva que `unknown` NO sea terminal: en Plane el grupo `backlog` mapea
  // a `unknown`, y un bloqueador aún sin empezar es lo MÁS bloqueante que hay.
  for (const state of ['in_progress', 'in_review', 'blocked', 'unknown', undefined]) {
    it(`estado "${state}" cuenta como bloqueador ABIERTO`, () => {
      const verdict = blockerVerdict({ blockers: [{ id: 'a', ref: 'KL-1', state }] });
      assert.equal(verdict.blocked, true, `"${state}" debería contar como no terminal`);
    });
  }

  it('"done" es el ÚNICO estado terminal', () => {
    assert.equal(blockerVerdict({ blockers: [{ id: 'a', state: 'done' }] }).blocked, false);
  });

  it('comparación exacta: un estado que CONTIENE "done" no cuenta como cerrado', () => {
    assert.equal(blockerVerdict({ blockers: [{ id: 'a', state: 'not-done' }] }).blocked, true);
  });

  // FAIL-OPEN: sin señal (provider sin capacidad, o llamada que falló) se deja pasar.
  for (const blockers of [null, undefined, 'nope', 42, {}]) {
    it(`fail-open ante blockers=${JSON.stringify(blockers)} → no bloqueada`, () => {
      assert.deepEqual(blockerVerdict({ blockers }), { blocked: false });
    });
  }

  it('descarta entradas basura dentro del array sin romper', () => {
    const verdict = blockerVerdict({ blockers: [null, 'x', { id: 'a', state: 'done' }] });
    assert.deepEqual(verdict, { blocked: false });
  });
});

describe('KODO-73: blockerSignature', () => {
  it('es estable ante el orden en que llegan las relaciones', () => {
    const a = blockerSignature([{ ref: 'KL-9' }, { ref: 'KL-2' }]);
    const b = blockerSignature([{ ref: 'KL-2' }, { ref: 'KL-9' }]);
    assert.equal(a, b);
    assert.equal(a, 'KL-2, KL-9');
  });

  it('deduplica', () => {
    assert.equal(blockerSignature([{ ref: 'KL-2' }, { ref: 'KL-2' }]), 'KL-2');
  });

  it('cae al id cuando no hay ref', () => {
    assert.equal(blockerSignature([{ id: 'uuid-1' }]), 'uuid-1');
  });

  it('lista vacía o basura → cadena vacía', () => {
    assert.equal(blockerSignature([]), '');
    assert.equal(blockerSignature(/** @type {any} */ (null)), '');
  });
});

describe('KODO-73: formatBlockedComment', () => {
  it('nombra los bloqueadores, dice que no hay que hacer nada y cómo forzar', () => {
    const text = formatBlockedComment('KL-42', [
      { ref: 'KL-1', state: 'in_progress' },
      { ref: 'KL-2', state: 'unknown' },
    ]);
    assert.match(text, /KL-1 — in_progress/);
    assert.match(text, /KL-2 — unknown/);
    assert.match(text, /vuelve a ser elegible por el camino normal/);
    assert.match(text, /kodo launch KL-42 --force/);
  });

  it('NO emite HTML — el envoltorio lo pone addComment de cada provider', () => {
    const text = formatBlockedComment('KL-42', [{ ref: 'KL-1', state: 'blocked' }]);
    assert.ok(!/<[a-z]/i.test(text), `no debería contener tags: ${text}`);
  });
});

describe('KODO-73: dedup del aviso', () => {
  beforeEach(() => forgetAnnouncedBlock());

  it('avisa una vez por firma, no una por tick', () => {
    assert.equal(shouldAnnounceBlock('task-1', 'KL-1'), true);
    assert.equal(shouldAnnounceBlock('task-1', 'KL-1'), false);
    assert.equal(shouldAnnounceBlock('task-1', 'KL-1'), false);
  });

  it('un CONJUNTO distinto de bloqueadores sí vuelve a avisar', () => {
    assert.equal(shouldAnnounceBlock('task-1', 'KL-1, KL-2'), true);
    assert.equal(shouldAnnounceBlock('task-1', 'KL-1'), true);
    assert.equal(shouldAnnounceBlock('task-1', 'KL-1'), false);
  });

  it('el registro es por tarea', () => {
    assert.equal(shouldAnnounceBlock('task-1', 'KL-1'), true);
    assert.equal(shouldAnnounceBlock('task-2', 'KL-1'), true);
  });

  it('olvidar una tarea hace que el mismo bloqueo se vuelva a anunciar', () => {
    assert.equal(shouldAnnounceBlock('task-1', 'KL-1'), true);
    forgetAnnouncedBlock('task-1');
    assert.equal(shouldAnnounceBlock('task-1', 'KL-1'), true);
  });

  it('sin task_id no anuncia (no hay clave con la que deduplicar)', () => {
    assert.equal(shouldAnnounceBlock('', 'KL-1'), false);
  });

  it('el registro no crece sin techo', () => {
    for (let i = 0; i < 600; i++) shouldAnnounceBlock(`task-${i}`, 'KL-1');
    // Las primeras entradas se podaron: `task-0` vuelve a anunciar como si fuera nueva.
    assert.equal(shouldAnnounceBlock('task-0', 'KL-1'), true);
    // La última sigue registrada.
    assert.equal(shouldAnnounceBlock('task-599', 'KL-1'), false);
  });
});
