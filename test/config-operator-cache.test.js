// @ts-check
//
// KODO-58 — `saveOperatorCache`: el escritor de la identidad cacheada.
//
// Lo que importa demostrar aquí no es que escriba, sino que escriba SOLO la clave que
// le toca: el fichero de config del operador tiene que salir del proceso igual que
// entró salvo por `providers.<p>.operator`.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'kodo-operator-cache-'));
process.env.HOME = HOME;
mkdirSync(join(HOME, '.kodo'), { recursive: true });

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// `import` DINÁMICO y no estático: los imports estáticos se evalúan ANTES del cuerpo del
// módulo, así que `config.js` habría cacheado su KODO_DIR con el HOME real del operador
// y este test escribiría en su `~/.kodo/config.json`. Con top-level await el módulo se
// carga con el HOME temporal ya puesto.
const { saveOperatorCache, loadConfig } = await import('../src/config.js');

const CONFIG_PATH = join(HOME, '.kodo', 'config.json');
const ME = 'da60ae01-2464-40da-857d-5aeb558bd881';

/** Config de disco «de un operador real»: parcial, con claves que NO deben tocarse. */
const ON_DISK = {
  provider: 'plane',
  providers: {
    plane: {
      base_url: 'https://tasks.example.com',
      workspace_slug: 'k-lab',
      projects: [{ id: 'p1', identifier: 'KODO', name: 'kodo' }],
    },
  },
  claude: { max_parallel: 2 },
};

function writeOnDisk(obj = ON_DISK) {
  writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2) + '\n');
}
function readOnDisk() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

describe('KODO-58: saveOperatorCache', () => {
  beforeEach(() => writeOnDisk());

  it('escribe providers.plane.operator y NO toca nada más del fichero', () => {
    assert.equal(saveOperatorCache('plane', { id: ME, display_name: 'alex' }), true);

    const after = readOnDisk();
    assert.deepEqual(after.providers.plane.operator, { id: ME, display_name: 'alex' });
    // Todo lo demás, byte a byte igual: nada de congelar defaults en disco.
    delete after.providers.plane.operator;
    assert.deepEqual(after, ON_DISK);
  });

  it('NO persiste el merge con DEFAULT_CONFIG (el fichero no engorda con defaults vivos)', () => {
    saveOperatorCache('plane', { id: ME });
    const after = readOnDisk();
    assert.equal(after.host, undefined, 'un default como `host` no debe aterrizar en disco');
    assert.equal(after.dispatch, undefined);
    assert.equal(after.agents, undefined);
  });

  it('es idempotente: reescribir la MISMA identidad devuelve false y no toca el disco', () => {
    assert.equal(saveOperatorCache('plane', { id: ME, display_name: 'alex' }), true);
    const first = readFileSync(CONFIG_PATH, 'utf-8');
    assert.equal(saveOperatorCache('plane', { id: ME, display_name: 'alex' }), false);
    assert.equal(readFileSync(CONFIG_PATH, 'utf-8'), first);
  });

  it('una identidad DISTINTA sí se reescribe (key rotada, otra cuenta)', () => {
    saveOperatorCache('plane', { id: ME, display_name: 'alex' });
    assert.equal(saveOperatorCache('plane', { id: 'otro-uuid', display_name: 'jj' }), true);
    assert.deepEqual(readOnDisk().providers.plane.operator, {
      id: 'otro-uuid',
      display_name: 'jj',
    });
  });

  it('sin display_name cae al id — la caché nunca queda a medias', () => {
    saveOperatorCache('plane', { id: ME });
    assert.deepEqual(readOnDisk().providers.plane.operator, { id: ME, display_name: ME });
  });

  it('crea el bloque del provider si no existe (config mínimo)', () => {
    writeOnDisk({ provider: 'github' });
    assert.equal(saveOperatorCache('github', { id: 'alex' }), true);
    assert.deepEqual(readOnDisk().providers.github.operator, {
      id: 'alex',
      display_name: 'alex',
    });
  });

  it('input inválido → false, sin escribir', () => {
    const before = readFileSync(CONFIG_PATH, 'utf-8');
    assert.equal(saveOperatorCache('plane', /** @type {any} */ (null)), false);
    assert.equal(saveOperatorCache('plane', /** @type {any} */ ({})), false);
    assert.equal(saveOperatorCache('', { id: ME }), false);
    assert.equal(readFileSync(CONFIG_PATH, 'utf-8'), before);
  });

  it('NEVER-THROWS ante un config.json de solo lectura: degrada a false', () => {
    saveOperatorCache('plane', { id: ME });
    chmodSync(join(HOME, '.kodo'), 0o500); // sin permiso de escritura en el directorio
    try {
      assert.equal(saveOperatorCache('plane', { id: 'otro-uuid' }), false);
    } finally {
      chmodSync(join(HOME, '.kodo'), 0o700);
    }
  });

  it('lo escrito lo lee loadConfig() en `providers.plane.operator`', () => {
    saveOperatorCache('plane', { id: ME, display_name: 'alex' });
    assert.deepEqual(loadConfig().providers.plane.operator, { id: ME, display_name: 'alex' });
  });
});
