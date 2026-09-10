// @ts-check
//
// test/dashboard/task-ref-width.test.js — KODO-85 (`ITCLIP-128` se pega a `clipping`).
//
// La columna `task_ref` tenía ancho fijo 10. Un ref de EXACTAMENTE 10 caracteres la llenaba entera
// y, como las celdas son `<Box width>` contiguos sin padding, el resultado en pantalla era
// `ITCLIP-128clipping`: dos identificadores distintos leídos como uno. Mismo defecto que ya se
// arregló en `state` (width 16 y no 14 para que `🔔 needs-input` no se pegara a su vecina).
//
// Lo que fijan estas pruebas:
//   1. el ancho de `task_ref` se DERIVA de los refs visibles, con suelo (nominal) y tope;
//   2. la separación de 2 celdas se cumple en el frame real, con refs de 6 y de 10 mezclados;
//   3. las celdas extra salen del aire de `status`, no de soltar una columna (KODO-77 intacto);
//   4. la invariante de KODO-77 sigue en pie: ninguna línea desborda ni wrapea (filas fantasma).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createElement } from 'react';
import { render as inkRender } from 'ink';
import SessionTable, { budgetColumns, taskRefWidth, fitTaskRef } from '../../src/cli/dashboard/SessionTable.js';

// Celdas que el marco de App (borde + los dos paddingX) le quita a la tabla: `CHROME_COLS` de
// App.js. Se replica aquí para que los anchos del test sean ANCHOS DE TERMINAL de verdad (120/90)
// y no el presupuesto ya descontado — es el número que el usuario ve en su emulador.
const CHROME_COLS = 6;

/**
 * Renderiza SessionTable en una terminal del ancho pedido. NO se reusa el `render` compartido de
 * `test/helpers/ink-frame.js`: el `Stdout` de ink-testing-library tiene `columns` como getter fijo
 * a 100, así que un frame pedido a 120 celdas sale recortado POR EL HARNESS y la aserción de
 * desbordamiento se vuelve vacua (pasaría igual con el defecto puesto). Con un stdout propio el
 * frame mide lo que mediría en pantalla.
 *
 * @param {number} columns - ancho de la terminal simulada.
 * @param {import('react').ReactElement} element
 * @returns {string} último frame pintado.
 */
function frameInTerminal(columns, element) {
  class Stdout extends EventEmitter {
    get columns() {
      return columns;
    }
    lastFrame = '';
    write = (/** @type {string} */ frame) => {
      this.lastFrame = frame;
    };
  }
  const stdout = new Stdout();
  const instance = inkRender(element, {
    stdout: /** @type {any} */ (stdout),
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  const frame = stdout.lastFrame;
  instance.unmount();
  instance.cleanup();
  return frame;
}

/** Filas con refs de 10 (`ITCLIP-128`) y de 6 (`KO-128`) mezclados: el caso del defecto. */
const ROWS = [
  {
    task_id: 'a',
    task_ref: 'ITCLIP-128',
    status: 'running',
    state: 'running',
    alive: true,
    project_name: 'clipping',
    elapsed_min: 5,
    provider_state: 'in_progress',
    progress: { status: 'ok', n: 1, m: 3, completed: false },
    next: 'Ejecutar el plan y verificar los tests',
  },
  {
    task_id: 'b',
    task_ref: 'KO-128',
    status: 'running',
    state: 'idle',
    alive: true,
    project_name: 'kodo',
    elapsed_min: 12,
    provider_state: 'in_progress',
    progress: { status: 'ok', n: 2, m: 4, completed: false },
    next: 'Revisar el presupuesto de columnas',
  },
];

describe('KODO-85: ancho derivado de task_ref (taskRefWidth)', () => {
  it('un ref que llena la columna la ENSANCHA hasta dejar el hueco de separación', () => {
    assert.equal(taskRefWidth([{ task_ref: 'ITCLIP-128' }]), 12, 'un ref de 10 pide 12 celdas');
  });

  it('refs cortos no encogen la columna por debajo del nominal', () => {
    assert.equal(taskRefWidth([{ task_ref: 'KO-1' }]), 12, 'el nominal es el SUELO, no un punto de partida');
    assert.equal(taskRefWidth([]), 12, 'la tabla vacía conserva el nominal (la cabecera `task_ref` mide 8)');
  });

  it('manda el ref MÁS LARGO de las filas visibles, no el primero', () => {
    assert.equal(taskRefWidth([{ task_ref: 'KO-1' }, { task_ref: 'ITCLIP-1284' }]), 13);
  });

  it('una fila sin ref cuenta como el placeholder `—`, sin romper', () => {
    assert.equal(taskRefWidth([{ task_ref: null }, {}]), 12);
    assert.equal(taskRefWidth(/** @type {any} */ (undefined)), 12, 'never-throws con la lista ausente');
  });

  it('el tope acota un ref absurdo: la columna no se come la tabla', () => {
    assert.equal(taskRefWidth([{ task_ref: 'X'.repeat(200) }]), 16);
  });
});

describe('KODO-85: fitTaskRef reserva el hueco incluso al truncar', () => {
  it('deja intacto el ref que cabe con su hueco', () => {
    assert.equal(fitTaskRef('ITCLIP-128', 12), 'ITCLIP-128');
  });

  it('un ref por encima del tope se trunca DEJANDO el hueco (el `…` no se pega a repo)', () => {
    const fitted = fitTaskRef('SUPERPROYECTO-4321', 16);
    assert.equal([...fitted].length, 14, 'el texto ocupa como mucho width − 2');
    assert.ok(fitted.endsWith('…'), 'el truncado se señala con el ellipsis');
  });

  it('en el recorte de emergencia (celda diminuta) cede al truncado nativo sin romper', () => {
    assert.equal(fitTaskRef('ITCLIP-128', 0), 'ITCLIP-128', 'ink trunca por su cuenta a 0 celdas');
    assert.equal(fitTaskRef('ITCLIP-128', 3), 'ITCLIP-128');
  });
});

describe('KODO-85: budgetColumns paga el ensanche con el aire de status', () => {
  it('el 5º parámetro ausente conserva el nominal (llamadas de KODO-77)', () => {
    assert.equal(budgetColumns(200, true, true, true).widths.task_ref, 12);
  });

  it('con espacio de sobra el ancho derivado entra tal cual y status no cede nada', () => {
    const budget = budgetColumns(200, true, true, true, 16);
    assert.equal(budget.widths.task_ref, 16);
    assert.equal(budget.widths.status, 18, 'sin presión, el render queda como estaba');
  });

  it('bajo presión status cede sus celdas de aire ANTES de que se suelte una columna', () => {
    // 103 fijas de KODO-77 + 2 del ensanche de task_ref = 105; +12 de NEXT_MIN = 117 > 110.
    const budget = budgetColumns(110, true, true, true, 12);
    assert.ok(budget.visible.has('prog'), 'prog sigue en pie: el déficit lo pagó el aire de status');
    assert.ok(budget.visible.has('phasemode'), 'phase/mode sigue en pie');
    assert.ok(budget.widths.status < 18, 'status cedió celdas');
    assert.ok(budget.widths.status >= 8, 'pero nunca por debajo de su suelo utilizable');
  });

  it('el ensanche NO cuesta columnas a 120 celdas', () => {
    const budget = budgetColumns(120, true, true, true, 12);
    for (const key of ['repo', 'phasemode', 'prog', 'task', 'next']) {
      assert.ok(budget.visible.has(key), `a 120 celdas no se cae ninguna columna (falta ${key})`);
    }
  });

  it('INVARIANTE KODO-77: la fila jamás supera el ancho disponible, con el ancho derivado al tope', () => {
    for (let width = 20; width <= 200; width++) {
      for (const anyGsd of [false, true]) {
        for (const anyProgress of [false, true]) {
          for (const anyNext of [false, true]) {
            for (const refW of [12, 16]) {
              const budget = budgetColumns(width, anyGsd, anyProgress, anyNext, refW);
              const actual = [...budget.visible].reduce((sum, key) => sum + budget.widths[key], 0);
              assert.ok(actual <= width, `fila de ${actual} celdas en ${width} disponibles (ref ${refW})`);
              for (const [key, value] of Object.entries(budget.widths)) {
                assert.ok(value >= 0, `la columna ${key} no puede tener ancho negativo (${value})`);
              }
            }
          }
        }
      }
    }
  });
});

describe('KODO-85: el frame separa task_ref de repo', () => {
  /** @param {number} terminalCols - ancho de terminal; la tabla recibe `− CHROME_COLS`, como en App. */
  const frameAt = (terminalCols) =>
    frameInTerminal(
      terminalCols,
      createElement(SessionTable, {
        rows: ROWS,
        selectedIndex: 0,
        counts: { running: 2 },
        connected: true,
        lastGoodCount: 2,
        lastGoodAt: 1,
        lastAttemptAt: 1,
        anyGsd: true,
        anyProgress: true,
        anyNext: true,
        tableWidth: terminalCols - CHROME_COLS,
      }),
    );

  for (const width of [120, 90]) {
    it(`en una terminal de ${width}: al menos 2 espacios entre el ref y el repo, en TODAS las filas`, () => {
      const frame = frameAt(width);
      for (const [ref, repo] of [['ITCLIP-128', 'clipping'], ['KO-128', 'kodo']]) {
        const line = frame.split('\n').find((l) => l.includes(ref));
        assert.ok(line, `la fila de ${ref} debe pintarse\n${frame}`);
        const gap = line.slice(line.indexOf(ref) + ref.length);
        assert.match(
          gap,
          new RegExp(`^ {2,}${repo}`),
          `${ref} debe quedar separado de ${repo} por 2+ espacios\n${JSON.stringify(line)}`,
        );
      }
    });

    it(`en una terminal de ${width}: ninguna línea desborda ni wrapea (sin filas fantasma)`, () => {
      const lines = frameAt(width).split('\n');
      for (const line of lines) {
        assert.ok(
          [...line].length <= width - CHROME_COLS,
          `línea de ${[...line].length} celdas con presupuesto ${width - CHROME_COLS}: ${JSON.stringify(line)}`,
        );
      }
      // Una fila fantasma sería una línea con el rabo de las últimas columnas y sin ref: la tabla
      // tiene header + cabecera de columnas + 2 filas, y ninguna línea de datos huérfana.
      const dataLines = lines.filter((l) => /ITCLIP-128|KO-128/.test(l));
      assert.equal(dataLines.length, 2, `exactamente 2 filas de datos\n${lines.join('\n')}`);
    });
  }

  it('el orden de las columnas no cambia', () => {
    const header = frameAt(120).split('\n').find((l) => l.includes('task_ref')) ?? '';
    const order = ['state', 'task_ref', 'repo', 'phase/mode', 'status', 'prog', 'task', 'age', 'next'];
    let cursor = -1;
    for (const label of order) {
      const at = header.indexOf(label, cursor + 1);
      assert.ok(at > cursor, `la cabecera ${label} debe ir tras la anterior\n${JSON.stringify(header)}`);
      cursor = at;
    }
  });
});
