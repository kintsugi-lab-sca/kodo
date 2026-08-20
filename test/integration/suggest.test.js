// @ts-check
//
// test/integration/suggest.test.js — KODO-26: heurística de tier de la cola de integración.
//
// `suggestTier` es una hoja pura de cero imports, así que no hay nada que aislar: import
// estático y a comparar. Lo que este fichero congela es el CONTRATO de la sugerencia, no su
// implementación — los cuatro literales, los umbrales y, sobre todo, la regla dura de que un
// `ff` jamás se sugiere sobre una base atrasada (criterio explícito del DoD de KODO-26).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { suggestTier, BIG_DIFF_LINES } from '../../src/integration/suggest.js';

describe('suggestTier — tiers por blast radius', () => {
  it('docs/tests-only con base al día → ff', () => {
    assert.equal(suggestTier({ files: ['README.md'], lines: 3, baseOk: true }), 'ff');
    assert.equal(suggestTier({ files: ['docs/guia.md', 'test/foo.test.js'], lines: 40, baseOk: true }), 'ff');
    assert.equal(suggestTier({ files: ['.planning/STATE.md'], lines: 5, baseOk: true }), 'ff');
  });

  it('src sin nada sensible → merge', () => {
    assert.equal(suggestTier({ files: ['src/cli.js'], lines: 20, baseOk: true }), 'merge');
    assert.equal(suggestTier({ files: ['src/a.js', 'test/a.test.js'], lines: 120, baseOk: true }), 'merge');
  });

  it('migraciones, auth, billing y credenciales → pr', () => {
    for (const f of [
      'db/migrate/20260101_add_users.rb',
      'migrations/0007_add_index.sql',
      'app/models/auth/token.rb',
      'src/billing/stripe.js',
      'app/services/payments/charge.rb',
      'config/master.key',
      '.env.production',
      'db/schema.rb',
    ]) {
      assert.equal(suggestTier({ files: [f], lines: 2, baseOk: true }), 'pr', `${f} debe forzar pr`);
    }
  });

  it('el match es por SEGMENTO de ruta, no por subcadena', () => {
    // `authors` contiene «auth» pero no es autenticación; `migrated_data.js` tampoco es una
    // migración. Un falso positivo aquí manda a PR trabajo trivial y erosiona la sugerencia.
    assert.equal(suggestTier({ files: ['src/authors/index.js'], lines: 4, baseOk: true }), 'merge');
    assert.equal(suggestTier({ files: ['src/migrated_data.js'], lines: 4, baseOk: true }), 'merge');
  });

  it('un diff grande manda por sí solo → pr', () => {
    assert.equal(suggestTier({ files: ['src/a.js'], lines: BIG_DIFF_LINES + 1, baseOk: true }), 'pr');
    // El umbral se compara con `>`: exactamente BIG_DIFF_LINES todavía NO fuerza pr.
    assert.equal(suggestTier({ files: ['src/a.js'], lines: BIG_DIFF_LINES, baseOk: true }), 'merge');
  });

  it('el tamaño gana también sobre docs-only', () => {
    assert.equal(suggestTier({ files: ['docs/enorme.md'], lines: BIG_DIFF_LINES + 500, baseOk: true }), 'pr');
  });

  it('sin diff inspeccionable → review (null y [] por razones distintas, mismo veredicto)', () => {
    assert.equal(suggestTier({ files: null, lines: null, baseOk: true }), 'review');
    assert.equal(suggestTier({ files: [], lines: 0, baseOk: true }), 'review');
  });
});

describe('suggestTier — base atrasada (regla dura del DoD)', () => {
  it('base_ok false degrada ff → merge, NUNCA sugiere ff', () => {
    assert.equal(suggestTier({ files: ['README.md'], lines: 3, baseOk: false }), 'merge');
  });

  it('base_ok null (no verificable) tampoco habilita ff', () => {
    assert.equal(suggestTier({ files: ['README.md'], lines: 3, baseOk: null }), 'merge');
    assert.equal(suggestTier({ files: ['README.md'], lines: 3 }), 'merge');
  });

  it('la degradación NUNCA abarata un pr ni un review', () => {
    assert.equal(suggestTier({ files: ['db/migrate/1.rb'], lines: 2, baseOk: false }), 'pr');
    assert.equal(suggestTier({ files: null, baseOk: false }), 'review');
  });

  it('ninguna combinación con base_ok !== true devuelve ff (barrido exhaustivo)', () => {
    const fileSets = [
      ['README.md'],
      ['docs/x.md', 'test/y.test.js'],
      ['src/a.js'],
      ['db/migrate/1.rb'],
      [],
      null,
    ];
    for (const files of fileSets) {
      for (const baseOk of [false, null, undefined]) {
        for (const lines of [0, 10, 5000, null]) {
          assert.notEqual(
            suggestTier({ files, lines, baseOk }),
            'ff',
            `ff filtrado con base_ok=${String(baseOk)} y files=${JSON.stringify(files)}`,
          );
        }
      }
    }
  });
});

describe('suggestTier — totalidad (nunca lanza, siempre uno de los 4 literales)', () => {
  it('entradas degeneradas caen a un literal válido', () => {
    const valid = new Set(['ff', 'merge', 'pr', 'review']);
    const inputs = [
      undefined,
      {},
      { files: 'no-es-un-array' },
      { files: [null, 42], lines: Number.NaN, baseOk: 'sí' },
      { files: ['src/a.js'], lines: Number.POSITIVE_INFINITY },
    ];
    for (const input of inputs) {
      // @ts-expect-error — entradas deliberadamente mal tipadas: el contrato es que TOTALIZA.
      const got = suggestTier(input);
      assert.ok(valid.has(got), `${JSON.stringify(input)} → ${got}`);
    }
  });
});
