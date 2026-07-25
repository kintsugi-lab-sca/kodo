// @ts-check
//
// test/inbox-format-golden.test.js — Phase 83 Plan 01 (D-22).
//
// ⚠ CONTRATO INTER-FASE — LEER ANTES DE TOCAR NADA DE ESTE FICHERO ⚠
//
// Este golden fija BYTE A BYTE las cinco formas de la línea de `~/.kodo/inbox.md`.
// **Phase 84 (CAPT-02) comparará contra estas cadenas byte a byte**: el skill
// `/kodo-capture` shellea a `kodo capture` precisamente para que exista UN SOLO
// writer y la línea del skill sea indistinguible de la del CLI. Cambiar cualquiera
// de estas cadenas —incluido un espacio, el separador U+00B7 o la flecha U+2192—
// rompe Phase 84 y el reader del conteo ambient (CAPT-07).
//
// Determinismo (D-22): el id, el tag, la fecha y el origen van INYECTADOS. Este
// fichero NO invoca `newCaptureId()` ni `todayLocal()` con el reloj real: un golden
// con entropía no es un golden.
//
// Gramática fijada (D-05, D-08):
//   - [ ] <id> · <texto> · <tag> · <YYYY-MM-DD> · <origen>
//   - [x] <id> · <texto> · <tag> · <YYYY-MM-DD> · <origen> · enrutada[ → <dest>]
//   - [x] <id> · <texto> · <tag> · <YYYY-MM-DD> · <origen> · descartada
//   - [x] <id> · <texto> · <tag> · <YYYY-MM-DD> · <origen>          (hand-edit, cierre desconocido)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeLine, parseLine } from '../src/inbox/store.js';

/** Identidad inyectada, común a las cinco formas (D-22: cero entropía). */
const ID = 'a3f9k2';
const TEXT = 'el texto de la idea';
const TAG = 'kodo';
const DATE = '2026-07-25';
const ORIGIN = 'cli';

/**
 * Las CINCO formas canónicas: `{ name, capture, line }`.
 * `line` es la cadena EXACTA que `encodeLine` debe producir (sin newline final).
 * @type {ReadonlyArray<{ name: string, capture: any, line: string }>}
 */
const GOLDEN = Object.freeze([
  {
    name: '1. abierta',
    capture: {
      id: ID, text: TEXT, tag: TAG, date: DATE, origin: ORIGIN,
      open: true, estado: null, dest: null,
    },
    line: '- [ ] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli',
  },
  {
    name: '2. cerrada — enrutada CON trace pointer (CAPT-06)',
    capture: {
      id: ID, text: TEXT, tag: TAG, date: DATE, origin: ORIGIN,
      open: false, estado: 'enrutada', dest: '.planning/todos/TODO-012.md',
    },
    line: '- [x] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli · enrutada → .planning/todos/TODO-012.md',
  },
  {
    name: '3. cerrada — enrutada SIN destino (best-effort, D-10)',
    capture: {
      id: ID, text: TEXT, tag: TAG, date: DATE, origin: ORIGIN,
      open: false, estado: 'enrutada', dest: null,
    },
    line: '- [x] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli · enrutada',
  },
  {
    name: '4. cerrada — descartada',
    capture: {
      id: ID, text: TEXT, tag: TAG, date: DATE, origin: ORIGIN,
      open: false, estado: 'descartada', dest: null,
    },
    line: '- [x] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli · descartada',
  },
  {
    name: '5. cerrada — hand-edit `- [x]` SIN sufijo (decisión de contrato 2)',
    capture: {
      id: ID, text: TEXT, tag: TAG, date: DATE, origin: ORIGIN,
      open: false, estado: null, dest: null,
    },
    line: '- [x] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli',
  },
]);

describe('D-22 golden — las cinco formas de la línea del inbox (contrato Phase 84)', () => {
  for (const g of GOLDEN) {
    it(`encodeLine produce la línea byte-exacta — ${g.name}`, () => {
      assert.equal(encodeLine(g.capture), g.line);
    });

    it(`round-trip parseLine(encodeLine(c)) === c — ${g.name}`, () => {
      assert.deepEqual(parseLine(encodeLine(g.capture)), g.capture);
    });

    it(`la línea NO contiene ningún salto de línea interior — ${g.name}`, () => {
      // Escapes, nunca literales: un source con invisibles embebidos es ilegible en diff.
      assert.equal(/[\n\r\u2028\u2029]/.test(g.line), false);
    });
  }

  it('el separador es exactamente espacio + U+00B7 + espacio (nada de U+2027 ni U+0387)', () => {
    const line = GOLDEN[0].line;
    assert.equal(line.includes(' · '), true, 'separador U+00B7 con espacios');
    assert.equal(line.split(' · ').length, 5, 'id · texto · tag · fecha · origen');
  });

  it('el trace pointer es exactamente espacio + U+2192 + espacio', () => {
    assert.equal(GOLDEN[1].line.includes(' → '), true);
  });

  it('las cinco formas son las únicas: abierta, enrutada+dest, enrutada, descartada, hand-edit', () => {
    assert.equal(GOLDEN.length, 5);
  });
});

describe('D-05 — los ejemplos literales de 83-CONTEXT.md parsean tal cual', () => {
  /** @type {ReadonlyArray<[string, any]>} */
  const D05 = Object.freeze([
    [
      '- [ ] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli',
      { id: 'a3f9k2', text: 'el texto de la idea', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: true, estado: null, dest: null },
    ],
    [
      '- [x] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli · enrutada → .planning/todos/TODO-012.md',
      { id: 'a3f9k2', text: 'el texto de la idea', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: false, estado: 'enrutada', dest: '.planning/todos/TODO-012.md' },
    ],
    [
      '- [x] b7c1m0 · otra idea · ROMAN · 2026-07-25 · cli · enrutada',
      { id: 'b7c1m0', text: 'otra idea', tag: 'ROMAN', date: '2026-07-25', origin: 'cli', open: false, estado: 'enrutada', dest: null },
    ],
    [
      '- [x] c4d8n5 · idea que no va · kodo · 2026-07-25 · cli · descartada',
      { id: 'c4d8n5', text: 'idea que no va', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: false, estado: 'descartada', dest: null },
    ],
  ]);

  for (const [line, expected] of D05) {
    it(`parseLine round-trip byte-exacto — ${line.slice(0, 34)}…`, () => {
      const parsed = parseLine(line);
      assert.deepEqual(parsed, expected);
      assert.equal(encodeLine(/** @type {any} */ (parsed)), line);
    });
  }
});
