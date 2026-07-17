// @ts-check
//
// test/dashboard-markdown.test.js — Phase 75 Plan 03 (Wave 0, TDD RED).
//
// Tests del mini-renderer line-based `renderMarkdownLines` (src/cli/dashboard/markdown.js).
// Inspeccionan el ÁRBOL de ReactElement devuelto (props de cada <Text>): NO renderizan a
// terminal (sin ink-testing-library) — el contrato es "línea → <Text> con estos props".
//
// Cubre: heading bold+cyan con el marcador handoff STRIPPEADO (D-06); **Label:** bold;
// bullet plano; toggle de code fence (dimColor, delimitador incluido); saneo de control
// chars (T-75-02); longitud del array == nº de líneas; color SOLO por props ink.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdownLines } from '../src/cli/dashboard/markdown.js';

/**
 * Helper: props de un elemento <Text> del array devuelto.
 * @param {import('react').ReactElement} el
 */
function props(el) {
  return el.props;
}

describe('renderMarkdownLines — mini-renderer line-based (D-05 best-effort, NO CommonMark)', () => {
  it('devuelve un ReactElement por línea, en el mismo orden y con la misma longitud', () => {
    const lines = ['uno', 'dos', 'tres'];
    const els = renderMarkdownLines(lines);
    assert.equal(els.length, 3, 'un elemento por línea');
    assert.equal(props(els[0]).children, 'uno');
    assert.equal(props(els[1]).children, 'dos');
    assert.equal(props(els[2]).children, 'tres');
  });

  it('keys estables por índice absoluto', () => {
    const els = renderMarkdownLines(['a', 'b']);
    assert.equal(els[0].key, els[0].key, 'la key existe');
    assert.notEqual(els[0].key, els[1].key, 'las keys difieren por índice');
  });

  it("heading '# '/'## ' → bold + color cyan", () => {
    const els = renderMarkdownLines(['# Titulo', '## Subtitulo']);
    assert.equal(props(els[0]).bold, true);
    assert.equal(props(els[0]).color, 'cyan');
    assert.equal(props(els[1]).bold, true);
    assert.equal(props(els[1]).color, 'cyan');
  });

  it('heading de handoff → el marcador kodo:handoff es INVISIBLE (strippeado, D-06)', () => {
    const line =
      '## Handoff 2026-07-17 <!-- kodo:handoff v=1 session=abc author=auto at=2026-07-17T10:00:00.000Z -->';
    const els = renderMarkdownLines([line]);
    const text = props(els[0]).children;
    assert.ok(!text.includes('<!-- kodo:handoff'), `el marcador no debe aparecer en el render\n${text}`);
    assert.equal(text, '## Handoff 2026-07-17', 'queda solo el texto legible del heading');
    assert.equal(props(els[0]).bold, true);
    assert.equal(props(els[0]).color, 'cyan');
  });

  it("línea '**Label:**' → bold (best-effort, sin cyan)", () => {
    const els = renderMarkdownLines(['**Hecho:** algo']);
    assert.equal(props(els[0]).bold, true);
    assert.ok(!props(els[0]).color, 'un label no lleva color, solo bold');
  });

  it("bullet '- '/'* ' → plano (sin bold, sin color)", () => {
    const els = renderMarkdownLines(['- item uno', '* item dos']);
    for (const el of els) {
      assert.ok(!props(el).bold, 'un bullet no es bold');
      assert.ok(!props(el).color, 'un bullet no lleva color');
      assert.ok(!props(el).dimColor, 'un bullet fuera de fence no es dim');
    }
  });

  it('code fence: delimitador + contenido → dimColor, con el toggle correcto', () => {
    const lines = [
      'antes',        // 0 plano
      '```js',        // 1 delimitador de apertura → dim
      'const x = 1;', // 2 dentro → dim
      '```',          // 3 delimitador de cierre → dim
      'despues',      // 4 plano (fuera del fence)
    ];
    const els = renderMarkdownLines(lines);
    assert.ok(!props(els[0]).dimColor, 'antes del fence: plano');
    assert.equal(props(els[1]).dimColor, true, 'delimitador de apertura: dim');
    assert.equal(props(els[2]).dimColor, true, 'contenido del fence: dim');
    assert.equal(props(els[3]).dimColor, true, 'delimitador de cierre: dim');
    assert.ok(!props(els[4]).dimColor, 'tras cerrar el fence: plano');
  });

  it('T-75-02: cada línea pasa por stripControlChars (OSC/CSI/C1 neutralizados)', () => {
    // \x1b[31m (CSI) + \x07 (BEL) deben desaparecer del texto proyectado.
    const els = renderMarkdownLines(['hola\x1b[31mmundo\x07']);
    assert.equal(props(els[0]).children, 'holamundo', 'los escapes de terminal quedan inertes');
  });

  it('never-throws sobre líneas arbitrarias / entrada vacía (SC5)', () => {
    assert.doesNotThrow(() => renderMarkdownLines([]));
    assert.equal(renderMarkdownLines([]).length, 0);
    assert.doesNotThrow(() => renderMarkdownLines(['', '   ', '###', '```', '```']));
  });
});
