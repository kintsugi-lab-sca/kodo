// @ts-check
//
// Tests de los helpers PUROS de forma dual de projects.json (PROJ-03/PROJ-04, D-05/D-06).
//
// 100% puro — sin filesystem, sin ink. Espejo del molde de `config-validate.test.js`.
// Garantiza que la forma `string | { default, modules }` que consumen `manager.js:88`
// (resolveProjectPath) y `adopt.js:126` NUNCA se rompe (Anti-pattern RESEARCH), y que
// ninguna función muta su mapa de entrada (pureza verificada por referencia).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  setProjectPath,
  removeProjectMapping,
  setModulePath,
  getProjectPath,
  getModuleMap,
} from '../src/projects-shape.js';

describe('getProjectPath — lectura de la ruta default de la forma dual', () => {
  it('entrada-string devuelve el propio string', () => {
    assert.equal(getProjectPath('/x'), '/x');
  });

  it('entrada-objeto devuelve su default', () => {
    assert.equal(getProjectPath({ default: '/x', modules: {} }), '/x');
  });

  it('sin mapear (undefined) devuelve string vacío', () => {
    assert.equal(getProjectPath(undefined), '');
  });

  it('objeto sin default devuelve string vacío', () => {
    assert.equal(getProjectPath({ modules: { a: '/m' } }), '');
  });
});

describe('getModuleMap — lectura del mapa de módulos de la forma dual', () => {
  it('entrada-objeto devuelve sus modules', () => {
    assert.deepEqual(getModuleMap({ default: '/x', modules: { a: '/m' } }), { a: '/m' });
  });

  it('entrada-string devuelve mapa vacío', () => {
    assert.deepEqual(getModuleMap('/x'), {});
  });

  it('sin mapear (undefined) devuelve mapa vacío', () => {
    assert.deepEqual(getModuleMap(undefined), {});
  });

  it('objeto sin modules devuelve mapa vacío', () => {
    assert.deepEqual(getModuleMap({ default: '/x' }), {});
  });
});

describe('PROJ-02/D-06 — setProjectPath (preserva la forma dual)', () => {
  it('entrada-objeto: cambia default preservando modules INTACTO', () => {
    const map = { p1: { default: '/old', modules: { m: '/mm' } } };
    const next = setProjectPath(map, 'p1', '/new');
    assert.deepEqual(next, { p1: { default: '/new', modules: { m: '/mm' } } });
  });

  it('entrada-string: sigue siendo string plano (legacy)', () => {
    const next = setProjectPath({ p1: '/old' }, 'p1', '/new');
    assert.deepEqual(next, { p1: '/new' });
  });

  it('sin mapear: crea una entrada-string', () => {
    const next = setProjectPath({}, 'p1', '/new');
    assert.deepEqual(next, { p1: '/new' });
  });

  it('no muta el mapa de entrada (pureza)', () => {
    const map = { p1: { default: '/old', modules: { m: '/mm' } } };
    const next = setProjectPath(map, 'p1', '/new');
    assert.notEqual(next, map);
    assert.deepEqual(map, { p1: { default: '/old', modules: { m: '/mm' } } });
  });
});

describe('PROJ-03/D-06 — removeProjectMapping (delete key)', () => {
  it('elimina SOLO la key indicada, deja las demás intactas', () => {
    const next = removeProjectMapping({ p1: '/x', p2: '/y' }, 'p1');
    assert.deepEqual(next, { p2: '/y' });
  });

  it('quitar una key inexistente devuelve un mapa equivalente', () => {
    const next = removeProjectMapping({ p1: '/x' }, 'p2');
    assert.deepEqual(next, { p1: '/x' });
  });

  it('no muta el mapa de entrada (pureza)', () => {
    const map = { p1: '/x', p2: '/y' };
    const next = removeProjectMapping(map, 'p1');
    assert.notEqual(next, map);
    assert.deepEqual(map, { p1: '/x', p2: '/y' });
  });
});

describe('PROJ-04/D-05 — setModulePath (materializa forma objeto)', () => {
  it('entrada-string: pasa a {default, modules:{mod:ruta}} preservando el default', () => {
    const next = setModulePath({ p1: '/d' }, 'p1', 'core', '/c');
    assert.deepEqual(next, { p1: { default: '/d', modules: { core: '/c' } } });
  });

  it('preserva otros módulos existentes y el default', () => {
    const map = { p1: { default: '/d', modules: { core: '/c' } } };
    const next = setModulePath(map, 'p1', 'web', '/w');
    assert.deepEqual(next, { p1: { default: '/d', modules: { core: '/c', web: '/w' } } });
  });

  it('sin mapear: default vacío + el módulo seteado', () => {
    const next = setModulePath({}, 'p1', 'core', '/c');
    assert.deepEqual(next, { p1: { default: '', modules: { core: '/c' } } });
  });

  it('no muta el mapa de entrada (pureza)', () => {
    const map = { p1: { default: '/d', modules: { core: '/c' } } };
    const next = setModulePath(map, 'p1', 'web', '/w');
    assert.notEqual(next, map);
    assert.deepEqual(map, { p1: { default: '/d', modules: { core: '/c' } } });
  });
});
