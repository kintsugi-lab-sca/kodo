// @ts-check
//
// KODO-58 — la regla pura de elegibilidad por operador.
//
// Este fichero NO toca disco, ni red, ni HOME: `src/operator.js` es una hoja sin
// imports a propósito (vive en el grafo de `kodo check`, blindado por LOG-12).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  assigneeVerdict,
  filterByOperator,
  SKIP_UNASSIGNED,
  SKIP_ASSIGNED_TO_OTHER,
} from '../src/operator.js';

const ME = 'da60ae01-2464-40da-857d-5aeb558bd881';
const OTHER = '78469dc1-bab7-4d26-8b55-a67002e3edb8';

describe('assigneeVerdict', () => {
  it('asignada a mí → elegible', () => {
    assert.deepEqual(assigneeVerdict({ assignees: [ME], operatorId: ME }), { eligible: true });
  });

  it('asignada a mí ENTRE VARIOS → elegible (el reparto no es exclusivo)', () => {
    assert.deepEqual(assigneeVerdict({ assignees: [OTHER, ME], operatorId: ME }), {
      eligible: true,
    });
  });

  it('asignada solo a otro → NO elegible, code=assigned_to_other', () => {
    assert.deepEqual(assigneeVerdict({ assignees: [OTHER], operatorId: ME }), {
      eligible: false,
      code: SKIP_ASSIGNED_TO_OTHER,
    });
  });

  it('sin asignado → NO elegible, code=unassigned (es lo que evita el doble lanzamiento)', () => {
    assert.deepEqual(assigneeVerdict({ assignees: [], operatorId: ME }), {
      eligible: false,
      code: SKIP_UNASSIGNED,
    });
  });

  it('assignees ausente/null/no-array → se trata como sin asignado, nunca lanza', () => {
    for (const assignees of [undefined, null, 'nope', 42, {}]) {
      const v = assigneeVerdict({ assignees, operatorId: ME });
      assert.equal(v.eligible, false, `assignees=${JSON.stringify(assignees)}`);
      assert.equal(v.code, SKIP_UNASSIGNED);
    }
  });

  it('array con basura no-string → esas entradas se descartan, no cuentan como asignado', () => {
    assert.deepEqual(assigneeVerdict({ assignees: [null, '', 0, {}], operatorId: ME }), {
      eligible: false,
      code: SKIP_UNASSIGNED,
    });
  });

  it('FAIL-OPEN: sin identidad conocida deja pasar TODO (un /users/me caído no puede parar el daemon)', () => {
    for (const operatorId of [null, undefined, '', 123]) {
      assert.deepEqual(
        assigneeVerdict({ assignees: [OTHER], operatorId: /** @type {any} */ (operatorId) }),
        { eligible: true },
        `operatorId=${JSON.stringify(operatorId)}`,
      );
      assert.deepEqual(
        assigneeVerdict({ assignees: [], operatorId: /** @type {any} */ (operatorId) }),
        { eligible: true },
      );
    }
  });

  it('require_assignee:false restaura el comportamiento previo, exacto', () => {
    assert.deepEqual(
      assigneeVerdict({ assignees: [OTHER], operatorId: ME, requireAssignee: false }),
      { eligible: true },
    );
    assert.deepEqual(
      assigneeVerdict({ assignees: [], operatorId: ME, requireAssignee: false }),
      { eligible: true },
    );
  });

  it('la comparación es igualdad EXACTA — un prefijo del id de otro NO me hace dueño', () => {
    const v = assigneeVerdict({ assignees: [ME + '-suffix'], operatorId: ME });
    assert.equal(v.eligible, false);
    assert.equal(v.code, SKIP_ASSIGNED_TO_OTHER);
  });
});

describe('filterByOperator', () => {
  const tasks = [
    { ref: 'KL-1', assignees: [ME] },
    { ref: 'KL-2', assignees: [OTHER] },
    { ref: 'KL-3', assignees: [] },
    { ref: 'KL-4', assignees: [OTHER, ME] },
  ];

  it('deja solo las mías (asignada a mí, sola o compartida)', () => {
    assert.deepEqual(
      filterByOperator(tasks, { operatorId: ME }).map((t) => t.ref),
      ['KL-1', 'KL-4'],
    );
  });

  it('sin identidad conocida → lista intacta (misma referencia, cero coste)', () => {
    assert.equal(filterByOperator(tasks, { operatorId: null }), tasks);
  });

  it('require_assignee:false → lista intacta', () => {
    assert.equal(filterByOperator(tasks, { operatorId: ME, requireAssignee: false }), tasks);
  });

  it('never-throws con lista nula o entradas basura', () => {
    assert.deepEqual(filterByOperator(/** @type {any} */ (null), { operatorId: ME }), []);
    assert.deepEqual(
      filterByOperator(/** @type {any} */ ([null, undefined, {}]), { operatorId: ME }),
      [],
    );
  });

  it('aplica la MISMA regla que assigneeVerdict (una sola definición de «esta tarea es mía»)', () => {
    for (const t of tasks) {
      const kept = filterByOperator([t], { operatorId: ME }).length === 1;
      assert.equal(kept, assigneeVerdict({ assignees: t.assignees, operatorId: ME }).eligible, t.ref);
    }
  });
});
