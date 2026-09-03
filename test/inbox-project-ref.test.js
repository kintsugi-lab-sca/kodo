// @ts-check
//
// test/inbox-project-ref.test.js — KODO-76.
//
// Unit de `src/inbox/project-ref.js`: la proyección `projectId → tag` y su INVERSA.
//
// El fixture reproduce la forma REAL de `~/.kodo/projects.json` del operador: claves que son
// UUIDs del proveedor, valores que son o una cadena de ruta o un objeto `{default, modules}`, y
// al menos un basename repetido —que es de donde sale la única ambigüedad que la resolución tiene
// que rechazar en vez de resolver a ciegas.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectTag, listProjectRefs, resolveProjectRef } from '../src/inbox/project-ref.js';
import { deriveTag } from '../src/inbox/store.js';

const UUID_A = 'add88b2b-5b48-4b33-92d0-802871a4e488';
const UUID_B = '98538548-4302-45c7-b71b-f1cc942499bf';
const UUID_DUP1 = '612583ec-8ac9-4c49-b411-c1019c719ee0';
const UUID_DUP2 = 'd24bcfa4-6eb3-425a-8c9c-9f8357ea8e67';

const PROJECTS = Object.freeze({
  [UUID_A]: { default: '/Users/alex/dev/roman', modules: { WAG: '/Users/alex/dev/roman/wag' } },
  [UUID_B]: '/Users/alex/dev/klab/tenderio',
  // Dos proyectos DISTINTOS cuyo último segmento coincide: la ambigüedad real.
  [UUID_DUP1]: { default: '/Users/alex/dev/klab/dev' },
  [UUID_DUP2]: { default: '/Users/alex/otro/dev' },
  // Clave ya legible: no se proyecta, se devuelve tal cual.
  kodo: '/Users/alex/dev/klab/kodo',
  // UUID sin ruta utilizable: sin tag derivable, pero NO invisible.
  'ffffffff-1111-2222-3333-444444444444': { default: 42 },
});

describe('projectTag — proyección projectId → tag', () => {
  it('un identificador YA legible se devuelve tal cual', () => {
    assert.equal(projectTag(PROJECTS, 'kodo'), 'kodo');
  });

  it('un UUID se proyecta al último segmento de su ruta mapeada', () => {
    assert.equal(projectTag(PROJECTS, UUID_A), 'roman');
    assert.equal(projectTag(PROJECTS, UUID_B), 'tenderio', 'acepta el valor en forma de cadena');
  });

  it('NO recorre la tabla de módulos: el tag identifica el proyecto, no el módulo', () => {
    assert.equal(projectTag(PROJECTS, UUID_A), 'roman');
  });

  it('never-throws: sin ruta utilizable, sin mapa o sin id → cadena vacía', () => {
    assert.equal(projectTag(PROJECTS, 'ffffffff-1111-2222-3333-444444444444'), '');
    assert.equal(projectTag(undefined, UUID_A), '');
    assert.equal(projectTag(PROJECTS, undefined), '');
    assert.equal(projectTag(/** @type {any} */ (null), /** @type {any} */ (null)), '');
  });

  it('las barras finales no producen un tag vacío', () => {
    assert.equal(projectTag({ [UUID_A]: { default: '/Users/alex/dev/klab/' } }, UUID_A), 'klab');
  });
});

describe('deriveTag sigue usando ESTA proyección (una sola definición, KODO-76)', () => {
  it('un cwd dentro de un proyecto mapeado por UUID da el tag proyectado, no el UUID', () => {
    assert.equal(deriveTag('/Users/alex/dev/roman/wag/app', PROJECTS), 'roman');
  });

  it('un cwd fuera del mapa cae a basename(cwd) — el fallback vive en store.js, no aquí', () => {
    assert.equal(deriveTag('/tmp/algun-sitio', PROJECTS), 'algun-sitio');
  });
});

describe('listProjectRefs — catálogo para el picker', () => {
  it('incluye TODOS los proyectos, también los que no tienen tag derivable', () => {
    const refs = listProjectRefs(PROJECTS);
    assert.equal(refs.length, Object.keys(PROJECTS).length);
    const sinTag = refs.find((r) => r.projectId === 'ffffffff-1111-2222-3333-444444444444');
    assert.ok(sinTag, 'un proyecto sin tag derivable NO puede quedar invisible');
    assert.equal(sinTag?.tag, '');
  });

  it('el orden es estable: por tag y, a igualdad, por id', () => {
    const a = listProjectRefs(PROJECTS).map((r) => r.projectId);
    const b = listProjectRefs(PROJECTS).map((r) => r.projectId);
    assert.deepEqual(a, b);
    const dup = listProjectRefs(PROJECTS).filter((r) => r.tag === 'dev').map((r) => r.projectId);
    assert.deepEqual(dup, [UUID_DUP1, UUID_DUP2].sort());
  });

  it('never-throws con un mapa ausente', () => {
    assert.deepEqual(listProjectRefs(undefined), []);
  });
});

describe('resolveProjectRef — inversa tag → projectId', () => {
  it('un id literal gana siempre (inequívoco por construcción)', () => {
    assert.deepEqual(resolveProjectRef(UUID_A, PROJECTS), { projectId: UUID_A, tag: 'roman' });
  });

  it('resuelve por tag, case-insensitive', () => {
    assert.deepEqual(resolveProjectRef('roman', PROJECTS), { projectId: UUID_A, tag: 'roman' });
    assert.deepEqual(resolveProjectRef('ROMAN', PROJECTS), { projectId: UUID_A, tag: 'roman' });
    assert.deepEqual(resolveProjectRef('  tenderio  ', PROJECTS), { projectId: UUID_B, tag: 'tenderio' });
  });

  it('un tag ambiguo NO elige por el operador: devuelve los candidatos', () => {
    const r = resolveProjectRef('dev', PROJECTS);
    assert.ok('error' in r && r.error === 'ambiguous', `esperaba ambiguous, dio ${JSON.stringify(r)}`);
    assert.deepEqual(
      /** @type {any} */ (r).matches.slice().sort(),
      [UUID_DUP1, UUID_DUP2].sort(),
      'los candidatos viajan para que el caller pueda enseñarlos',
    );
  });

  it('sin coincidencia → none', () => {
    assert.deepEqual(resolveProjectRef('no-existe', PROJECTS), { error: 'none' });
  });

  it('una ref vacía o no-string → none, sin tocar el mapa', () => {
    for (const v of ['', '   ', undefined, null, 42, {}]) {
      assert.deepEqual(resolveProjectRef(/** @type {any} */ (v), PROJECTS), { error: 'none' });
    }
  });

  it('una clave heredada de Object.prototype no falsifica un id literal', () => {
    // `hasOwnProperty` y no `in`: sin él, `resolveProjectRef('toString', …)` habría devuelto
    // `{projectId:'toString'}` y el promote habría posteado contra un proyecto inexistente.
    assert.deepEqual(resolveProjectRef('toString', PROJECTS), { error: 'none' });
    assert.deepEqual(resolveProjectRef('constructor', PROJECTS), { error: 'none' });
  });
});
