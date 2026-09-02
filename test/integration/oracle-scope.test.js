// @ts-check
//
// test/integration/oracle-scope.test.js — KODO-69: el check de ALCANCE del oráculo mecánico.
//
// `scope.js` es una hoja pura de cero imports, así que no hay nada que aislar: import estático
// y a comparar. Lo que este fichero congela es el CONTRATO —los marcadores del bloque, el
// dialecto de globs y los cuatro estados—, no la implementación.
//
// Los marcadores (`<!-- kodo:scope v=1 -->` / `<!-- /kodo:scope -->`) se pinean a propósito y
// se importan como CONSTANTE: son contrato de parsing (test/CONVENTIONS.md), y quien escriba el
// bloque en un plan tiene que poder confiar en que kodo busca exactamente eso.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCOPE_OPEN,
  SCOPE_CLOSE,
  MAX_SCOPE_PATTERNS,
  MAX_REPORTED,
  parseScopeBlock,
  compileScope,
  inScope,
  checkScope,
} from '../../src/integration/scope.js';

/**
 * Compone un plan con un bloque de alcance. Helper local: los tests hablan de patrones, no de
 * markdown.
 * @param {string[]} patterns
 * @param {string} [prefix]
 * @returns {string}
 */
function planWith(patterns, prefix = '# Plan\n\nProsa cualquiera.\n\n') {
  return `${prefix}${SCOPE_OPEN}\n${patterns.map((p) => `- ${p}`).join('\n')}\n${SCOPE_CLOSE}\n\nMás prosa.\n`;
}

describe('parseScopeBlock — la fuente del alcance es DECLARADA, nunca inferida', () => {
  it('extrae los patrones de un bloque bien formado', () => {
    assert.deepEqual(parseScopeBlock(planWith(['src/integration/**', 'test/oracle-*.test.js'])), [
      'src/integration/**',
      'test/oracle-*.test.js',
    ]);
  });

  it('acepta viñeta `-`, viñeta `*`, patrón desnudo y backticks envolventes', () => {
    const md = `${SCOPE_OPEN}\n- src/a.js\n* src/b.js\nsrc/c.js\n\`src/d.js\`\n${SCOPE_CLOSE}`;
    assert.deepEqual(parseScopeBlock(md), ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js']);
  });

  it('sin bloque → null (y el check caerá a skip, no a una heurística inventada)', () => {
    assert.equal(parseScopeBlock('# Plan\n\nNada declarado.\n'), null);
    assert.equal(parseScopeBlock(''), null);
    assert.equal(parseScopeBlock(undefined), null);
    assert.equal(parseScopeBlock(42), null);
  });

  it('bloque ABIERTO y sin cerrar → null: no se traga el resto del fichero como patrones', () => {
    const md = `${SCOPE_OPEN}\n- src/**\n\n## Handoff\n\n**NEXT:** algo\n`;
    assert.equal(parseScopeBlock(md), null);
  });

  it('bloque vacío (marcadores sin patrones) → null: no es un alcance, es un bloque a medias', () => {
    assert.equal(parseScopeBlock(`${SCOPE_OPEN}\n\n${SCOPE_CLOSE}`), null);
    assert.equal(parseScopeBlock(`${SCOPE_OPEN}\n# solo un comentario\n${SCOPE_CLOSE}`), null);
  });

  it('GANA EL ÚLTIMO bloque: el plan es append-only y el alcance vigente es el de la última sesión', () => {
    const md = `${planWith(['src/viejo/**'])}\n${planWith(['src/nuevo/**'], '## Segunda sesión\n\n')}`;
    assert.deepEqual(parseScopeBlock(md), ['src/nuevo/**']);
  });

  it('acota el número de patrones (un plan es texto arbitrario de un LLM)', () => {
    const many = Array.from({ length: MAX_SCOPE_PATTERNS + 50 }, (_, i) => `src/f${i}.js`);
    assert.equal(parseScopeBlock(planWith(many)).length, MAX_SCOPE_PATTERNS);
  });
});

describe('compileScope / inScope — el dialecto de globs, deliberadamente pequeño', () => {
  it('`*` no cruza separadores; `**` sí', () => {
    const star = compileScope(['src/*.js']);
    assert.equal(inScope('src/a.js', star), true);
    assert.equal(inScope('src/sub/a.js', star), false);

    const globstar = compileScope(['src/**']);
    assert.equal(inScope('src/a.js', globstar), true);
    assert.equal(inScope('src/sub/hondo/a.js', globstar), true);
  });

  it('`**/x` cubre también la raíz (el grupo es opcional, no `.*/`)', () => {
    const re = compileScope(['**/notas.md']);
    assert.equal(inScope('notas.md', re), true);
    assert.equal(inScope('docs/notas.md', re), true);
    assert.equal(inScope('a/b/c/notas.md', re), true);
  });

  it('la barra final es el prefijo de directorio (`src/` ≡ `src/**`)', () => {
    const re = compileScope(['src/']);
    assert.equal(inScope('src/a.js', re), true);
    assert.equal(inScope('src/sub/a.js', re), true);
    assert.equal(inScope('srcx/a.js', re), false);
  });

  it('`?` es exactamente un carácter que no es separador', () => {
    const re = compileScope(['src/a?.js']);
    assert.equal(inScope('src/ab.js', re), true);
    assert.equal(inScope('src/abc.js', re), false);
    assert.equal(inScope('src/a/.js', re), false);
  });

  it('ANCLADO en los dos extremos: un alcance no matchea por subcadena', () => {
    const re = compileScope(['src/a.js']);
    assert.equal(inScope('src/a.js', re), true);
    assert.equal(inScope('otro/src/a.js', re), false);
    assert.equal(inScope('src/a.js.bak', re), false);
  });

  it('los metacaracteres de regex del literal se escapan (no matchean de más)', () => {
    const re = compileScope(['src/a+b(c).js']);
    assert.equal(inScope('src/a+b(c).js', re), true);
    assert.equal(inScope('src/aab(c).js', re), false);
  });

  it('normaliza `./` y las barras iniciales — git diff nunca las emite', () => {
    assert.equal(inScope('src/a.js', compileScope(['./src/a.js'])), true);
    assert.equal(inScope('src/a.js', compileScope(['/src/a.js'])), true);
  });

  it('entrada degenerada → lista vacía, nunca una excepción', () => {
    assert.deepEqual(compileScope(null), []);
    assert.deepEqual(compileScope('src/**'), []);
    assert.deepEqual(compileScope([null, 42, '']), []);
    assert.equal(inScope('', compileScope(['**'])), false);
    assert.equal(inScope(null, compileScope(['**'])), false);
  });
});

describe('checkScope — los cuatro estados, y por qué cada uno es el que es', () => {
  it('SIN alcance declarado → skip (no `unknown`: un unknown arrastraría todo el veredicto)', () => {
    const r = checkScope({ files: ['src/a.js'], patterns: null });
    assert.equal(r.status, 'skip');
    assert.deepEqual(r.out_of_scope, []);
  });

  it('CON alcance y diff no inspeccionable → unknown (había pregunta y sigue sin respuesta)', () => {
    assert.equal(checkScope({ files: null, patterns: ['src/**'] }).status, 'unknown');
  });

  it('todo dentro del alcance → pass', () => {
    const r = checkScope({ files: ['src/a.js', 'src/sub/b.js'], patterns: ['src/**'] });
    assert.equal(r.status, 'pass');
    assert.deepEqual(r.out_of_scope, []);
  });

  it('algo fuera → fail, y los infractores se NOMBRAN', () => {
    const r = checkScope({
      files: ['src/a.js', 'db/migrate/0001.rb', 'app/auth/token.rb'],
      patterns: ['src/**'],
    });
    assert.equal(r.status, 'fail');
    assert.deepEqual(r.out_of_scope, ['db/migrate/0001.rb', 'app/auth/token.rb']);
    assert.match(r.detail, /db\/migrate\/0001\.rb/);
  });

  it('la lista de infractores está ACOTADA (el detalle viaja a state.json)', () => {
    const files = Array.from({ length: MAX_REPORTED + 7 }, (_, i) => `fuera/f${i}.js`);
    const r = checkScope({ files, patterns: ['src/**'] });
    assert.equal(r.status, 'fail');
    assert.equal(r.out_of_scope.length, MAX_REPORTED);
    assert.match(r.detail, /\+7 más/);
  });

  it('diff VACÍO con alcance declarado → pass: no salirse de nada sin tocar nada es cierto', () => {
    assert.equal(checkScope({ files: [], patterns: ['src/**'] }).status, 'pass');
  });

  it('bloque con patrones que no compilan ninguno → unknown, no fail ni skip', () => {
    const r = checkScope({ files: ['src/a.js'], patterns: ['', '   '] });
    assert.equal(r.status, 'unknown');
  });

  it('TOTAL: cualquier entrada degenerada devuelve uno de los cuatro literales', () => {
    for (const input of [undefined, null, {}, { files: 'x', patterns: 'y' }, { files: [1, 2] }]) {
      const r = checkScope(/** @type {any} */ (input));
      assert.ok(['pass', 'fail', 'unknown', 'skip'].includes(r.status), `status inesperado con ${JSON.stringify(input)}`);
      assert.ok(Array.isArray(r.out_of_scope));
    }
  });
});
