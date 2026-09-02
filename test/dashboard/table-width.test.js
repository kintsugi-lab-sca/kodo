// @ts-check
//
// test/dashboard/table-width.test.js — KODO-77 (filas fantasma tras lanzamientos casi simultáneos).
//
// El síntoma reportado eran ~10 "filas extra" en el dashboard sin state/repo/status/prog, solo con
// task_ref y el rabo de las últimas columnas, mientras `GET /status` devolvía exactamente 7 filas
// correctas y `state.json` no tenía duplicados. No había duplicación de estado: la tabla pedía 143
// celdas con las tres columnas condicionales encendidas (`phase/mode` + `prog` + `next`) y, en una
// terminal más estrecha, Yoga encogía cada `<Box width>` (flexShrink por defecto = 1) hasta pegar
// las columnas entre sí y WRAPEAR el sobrante a una segunda línea — esa era la "fila fantasma".
// El multi-lanzamiento solo era el disparador: llenaba el `next` de varias tareas en state.json y
// encendía `anyNext`, que suma 40 celdas de golpe.
//
// Estas pruebas fijan la invariante que cierra el defecto: **la fila nunca es más ancha que el
// espacio disponible**. Se testea `budgetColumns` como unidad pura (mismo patrón que format.js /
// select.js: presentación derivable sin montar el árbol ink) más un render de SessionTable que
// verifica la caída de la columna elástica.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import SessionTable, { budgetColumns } from '../../src/cli/dashboard/SessionTable.js';
import { render } from '../helpers/ink-frame.js';

/** Suma de los anchos presupuestados de las columnas visibles = ancho real de la fila. */
function rowWidth({ widths, visible }) {
  return [...visible].reduce((sum, key) => sum + widths[key], 0);
}

describe('KODO-77: presupuesto de ancho de la tabla (budgetColumns)', () => {
  it('sin tableWidth (montaje suelto en tests): anchos nominales y ninguna columna caída', () => {
    const budget = budgetColumns(null, true, true, true);
    assert.equal(budget.widths.next, 40, 'la columna next conserva su ancho nominal');
    assert.equal(rowWidth(budget), 143, 'la fila mide lo que siempre midió (2+18+10+18+11+18+7+12+7+40)');
    for (const key of ['repo', 'phasemode', 'prog', 'task', 'next']) {
      assert.ok(budget.visible.has(key), `sin presupuesto no se cae ninguna columna (falta ${key})`);
    }
  });

  it('con espacio de sobra: todas las columnas encendidas y `next` a su ancho nominal', () => {
    const budget = budgetColumns(200, true, true, true);
    assert.equal(budget.widths.next, 40, 'next no crece por encima de su nominal');
    assert.equal(rowWidth(budget), 143);
  });

  it('`next` es ELÁSTICA: se queda con el sobrante en vez de desbordar la fila', () => {
    // 103 = todas las fijas con phase/mode y prog encendidos. +25 de holgura para next.
    const budget = budgetColumns(128, true, true, true);
    assert.ok(budget.visible.has('next'), 'con 25 celdas libres next sigue en pie');
    assert.equal(budget.widths.next, 25, 'next toma exactamente el sobrante');
    assert.equal(rowWidth(budget), 128, 'la fila llena el ancho disponible sin pasarse');
  });

  it('`next` se CAE entera cuando el sobrante no llega al mínimo utilizable', () => {
    // 103 fijas + 8 libres: por debajo de NEXT_MIN (12) la celda no informa.
    const budget = budgetColumns(111, true, true, true);
    assert.ok(!budget.visible.has('next'), 'next se omite en vez de rendirse a un muñón');
    assert.equal(rowWidth(budget), 103, 'el ancho recuperado se queda sin usar, no lo absorbe otra columna');
  });

  it('sueltan columnas por prioridad cuando ni las fijas caben (next → prog → phase/mode → repo → task)', () => {
    const at = (width) => budgetColumns(width, true, true, true);

    // 96 = 103 fijas − prog(7).
    assert.deepEqual(
      [...at(96).visible],
      ['gutter', 'state', 'task_ref', 'repo', 'phasemode', 'status', 'task', 'age'],
      'la primera fija en caer es prog',
    );
    // 85 = 96 − phasemode(11).
    assert.ok(!at(85).visible.has('phasemode'), 'después cae phase/mode');
    // 67 = 85 − repo(18).
    assert.ok(!at(67).visible.has('repo'), 'después cae repo');
    // 55 = 67 − task(12): quedan solo las irrenunciables.
    assert.deepEqual(
      [...at(55).visible],
      ['gutter', 'state', 'task_ref', 'status', 'age'],
      'gutter/state/task_ref/status/age son irrenunciables',
    );
  });

  it('INVARIANTE: la fila jamás supera el ancho disponible, en ningún ancho ni combinación de flags', () => {
    for (let width = 20; width <= 200; width++) {
      for (const anyGsd of [false, true]) {
        for (const anyProgress of [false, true]) {
          for (const anyNext of [false, true]) {
            const budget = budgetColumns(width, anyGsd, anyProgress, anyNext);
            const actual = rowWidth(budget);
            assert.ok(
              actual <= width,
              `fila de ${actual} celdas en ${width} disponibles (gsd:${anyGsd} prog:${anyProgress} next:${anyNext})`,
            );
            for (const [key, value] of Object.entries(budget.widths)) {
              assert.ok(value >= 0, `la columna ${key} no puede tener ancho negativo (${value})`);
            }
          }
        }
      }
    }
  });

  it('una columna apagada por su flag estructural no reaparece por tener espacio', () => {
    const budget = budgetColumns(200, false, false, false);
    assert.ok(!budget.visible.has('phasemode'), 'anyGsd false manda sobre el presupuesto');
    assert.ok(!budget.visible.has('prog'), 'anyProgress false manda sobre el presupuesto');
    assert.ok(!budget.visible.has('next'), 'anyNext false manda sobre el presupuesto');
  });
});

describe('KODO-77: SessionTable respeta el presupuesto en el render', () => {
  const ROWS = [
    {
      task_id: 'a',
      task_ref: 'KODO-75',
      status: 'running',
      state: 'running',
      alive: true,
      project_name: 'kodo',
      elapsed_min: 5,
      provider_state: 'in_progress',
      progress: { status: 'ok', n: 1, m: 3, completed: false },
      next: 'Ejecutar el plan y verificar los tests',
    },
  ];

  /** @param {number|null} tableWidth */
  const frameAt = (tableWidth) =>
    render(
      createElement(SessionTable, {
        rows: ROWS,
        selectedIndex: 0,
        counts: { running: 1 },
        connected: true,
        lastGoodCount: 1,
        lastGoodAt: 1,
        lastAttemptAt: 1,
        anyGsd: true,
        anyProgress: true,
        anyNext: true,
        tableWidth,
      }),
    ).lastFrame() ?? '';

  it('con presupuesto holgado pinta la columna next', () => {
    const frame = frameAt(140);
    assert.match(frame, /next/, `la cabecera next debe estar\n${frame}`);
    assert.match(frame, /Ejecutar el plan/, `el NEXT: debe pintarse\n${frame}`);
  });

  it('con presupuesto estrecho la columna next desaparece entera (cabecera incluida)', () => {
    const frame = frameAt(94);
    assert.doesNotMatch(frame, /Ejecutar el plan/, `el NEXT: no cabe y no se pinta\n${frame}`);
    assert.match(frame, /task_ref/, `el resto de la tabla sigue en pie\n${frame}`);
    assert.match(frame, /KODO-75/, `la fila sigue identificándose\n${frame}`);
  });

  it('ninguna línea de la tabla desborda el presupuesto', () => {
    // La invariante que cerraba el defecto: una línea más ancha que la terminal la wrapea el
    // emulador por su cuenta, fuera del modelo de borrado de ink, y el sobrante queda en pantalla.
    for (const width of [94, 100, 60]) {
      const lines = frameAt(width).split('\n');
      for (const line of lines) {
        assert.ok(
          [...line].length <= width,
          `línea de ${[...line].length} celdas con presupuesto ${width}: ${JSON.stringify(line)}`,
        );
      }
    }
  });
});
