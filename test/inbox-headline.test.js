// @ts-check
//
// test/inbox-headline.test.js — KODO-76.
//
// Unit de `src/inbox/headline.js`. La tabla de vectores no es sintética: sale de las capturas
// REALES del inbox del operador el 3-sep-2026, que son la evidencia de que «los titulares no se
// entienden» y por tanto el oráculo de que ahora sí.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveHeadline, hasMore, HEADLINE_MAX } from '../src/inbox/headline.js';

describe('deriveHeadline — corte por separador fuerte', () => {
  it('corta en el primer `: ` de la ventana útil, SIN elipsis', () => {
    assert.equal(
      deriveHeadline('Inconsistencia pending vs dispatch: el conteo pending del check cuenta tareas'),
      'Inconsistencia pending vs dispatch',
    );
    assert.equal(
      deriveHeadline('Fuga de la suite al log real: cada npm test escribe entradas dispatch.decision'),
      'Fuga de la suite al log real',
    );
  });

  it('corta en `. ` cuando no hay `: ` antes', () => {
    assert.equal(
      deriveHeadline('Launch con --group degrada en silencio. Persistir el motivo de group_skipped'),
      'Launch con --group degrada en silencio',
    );
  });

  it('un separador ANTES del mínimo no descalifica a uno posterior', () => {
    // `: ` en el índice 10 («Bug daemon») queda por debajo del mínimo, así que el titular no se
    // corta ahí: se recorta por longitud, que informa más que una etiqueta de dos palabras.
    const h = deriveHeadline(
      'Bug daemon: provider.state.fetch.failed con project_id vacio en CADA launch del daemon',
    );
    assert.ok(h.startsWith('Bug daemon: provider.state'), `titular inesperado: ${h}`);
    assert.ok(h.endsWith('…'), 'el recorte por longitud SÍ lleva elipsis');
  });

  it('un separador FUERA de la ventana no se usa', () => {
    // El `: ` real está pasado el char 100 → recorte por longitud, no corte por separador.
    const text =
      'state.json guarda worktree_path .bg-shell/<sid> que no existe (el worktree real es ' +
      '.claude/worktrees/<sid>): el hook Stop loopea worktree.cleanup.error';
    const h = deriveHeadline(text);
    assert.ok(h.length <= HEADLINE_MAX, `desborda el ancho: ${h.length}`);
    assert.ok(h.endsWith('…'));
  });
});

describe('deriveHeadline — recorte por longitud', () => {
  it('un texto que ya cabe se devuelve verbatim, SIN elipsis', () => {
    assert.equal(deriveHeadline('una idea corta'), 'una idea corta');
  });

  it('recorta al límite de PALABRA y respeta el ancho, elipsis incluida', () => {
    const h = deriveHeadline('alfa bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike');
    assert.ok(h.length <= HEADLINE_MAX, `desborda: ${h.length}`);
    assert.ok(h.endsWith('…'));
    assert.ok(!h.includes(' …'), 'la elipsis va pegada, sin espacio previo');
    // Ninguna palabra queda partida: cada token del titular (menos la elipsis) es un token entero.
    for (const w of h.slice(0, -1).trim().split(' ')) {
      assert.ok(
        'alfa bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike'.split(' ').includes(w),
        `palabra partida: ${w}`,
      );
    }
  });

  it('un token único más largo que el ancho se corta duro (no puede desbordar la columna)', () => {
    const h = deriveHeadline('x'.repeat(200));
    assert.ok(h.length <= HEADLINE_MAX, `desborda: ${h.length}`);
    assert.ok(h.endsWith('…'));
  });

  it('respeta un `max` explícito', () => {
    const h = deriveHeadline('alfa bravo charlie delta echo foxtrot golf hotel', { max: 20 });
    assert.ok(h.length <= 20, `desborda el max inyectado: ${h.length}`);
  });

  it('un `max` absurdo cae al default en vez de romper', () => {
    for (const max of [0, -5, 1.5, NaN, /** @type {any} */ ('20')]) {
      const h = deriveHeadline('alfa bravo charlie delta echo foxtrot golf hotel india juliett kilo', { max });
      assert.ok(h.length <= HEADLINE_MAX, `max=${max} produjo ${h.length}`);
    }
  });
});

describe('deriveHeadline — never-throws', () => {
  it('cualquier entrada que no sea string colapsa a cadena vacía', () => {
    for (const v of [undefined, null, 42, {}, [], true]) {
      assert.equal(deriveHeadline(/** @type {any} */ (v)), '');
    }
  });

  it('el texto se trimea antes de cortar', () => {
    assert.equal(deriveHeadline('   una idea corta   '), 'una idea corta');
  });
});

describe('hasMore — ¿el detalle esconde algo?', () => {
  it('false cuando el titular ES el texto entero', () => {
    assert.equal(hasMore('una idea corta'), false);
    assert.equal(hasMore(''), false);
    assert.equal(hasMore(/** @type {any} */ (null)), false);
  });

  it('true cuando el corte fue por SEPARADOR, aunque el titular no lleve elipsis', () => {
    // El caso que un `endsWith("…")` habría dado por false: el titular es una frase completa y
    // aun así se está escondiendo todo el desarrollo.
    const text = 'Fuga de la suite al log real: cada npm test escribe entradas';
    assert.equal(deriveHeadline(text).endsWith('…'), false);
    assert.equal(hasMore(text), true);
  });

  it('true cuando el corte fue por longitud', () => {
    assert.equal(
      hasMore('alfa bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike'),
      true,
    );
  });
});
