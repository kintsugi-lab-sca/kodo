// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync, readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileAtomic, DEFAULT_CONFIG } from '../src/config.js';

// DI puro (research §Validation, obs. 21811/22683): el helper recibe `path` por
// parámetro, así el test lo ejercita contra un tmpdir SIN depender de KODO_DIR
// (que config.js cachea al import) ni tocar el HOME real del dev.
function makeWorkdir() {
  return mkdtempSync(join(tmpdir(), 'kodo-atomic-'));
}

describe('PERSIST-05/D-08 — writeFileAtomic (temp+rename, DI puro)', () => {
  it('(a) escribe el contenido exacto al destino', () => {
    const dir = makeWorkdir();
    try {
      const dest = join(dir, 'out.json');
      writeFileAtomic(dest, 'hola\n');
      assert.equal(readFileSync(dest, 'utf-8'), 'hola\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(b) preserva el formato byte-exacto de saveConfig: JSON.stringify(cfg,null,2)+"\\n" (PERSIST-01)', () => {
    const dir = makeWorkdir();
    try {
      const dest = join(dir, 'config.json');
      const expected = JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n';
      writeFileAtomic(dest, expected);
      assert.equal(readFileSync(dest, 'utf-8'), expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(c) ante fallo de escritura, el fichero previo queda INTACTO (PERSIST-05)', () => {
    const dir = makeWorkdir();
    try {
      const dest = join(dir, 'config.json');
      const previo = '{"version":"previo"}\n';
      writeFileSync(dest, previo);
      // Forzamos el fallo: creamos un DIRECTORIO en la ruta `.tmp` para que
      // writeFileSync(dest+'.tmp', ...) lance EISDIR antes del rename.
      mkdirSync(dest + '.tmp');
      assert.throws(() => writeFileAtomic(dest, '{"version":"nuevo"}\n'));
      // El destino previo NO fue tocado (rename nunca llegó a ejecutarse).
      assert.equal(readFileSync(dest, 'utf-8'), previo);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(d) el .tmp se crea junto al destino (mismo dir) y desaparece tras el rename', () => {
    const dir = makeWorkdir();
    try {
      const dest = join(dir, 'config.json');
      writeFileAtomic(dest, 'x\n');
      // Tras un write exitoso el .tmp ya fue renombrado → no queda rastro.
      assert.equal(existsSync(dest + '.tmp'), false);
      // El destino vive en el dir esperado y es el único fichero generado.
      assert.equal(dirname(dest), dir);
      assert.deepEqual(readdirSync(dir), ['config.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never-throws-on-success: un destino válido nunca lanza', () => {
    const dir = makeWorkdir();
    try {
      assert.doesNotThrow(() => writeFileAtomic(join(dir, 'a.json'), 'a\n'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('PERSIST-05 — saveConfig/saveProjects usan la escritura atómica (estructura)', () => {
  const source = readFileSync(new URL('../src/config.js', import.meta.url), 'utf-8');

  it('saveConfig escribe vía writeFileAtomic(CONFIG_PATH, ...)', () => {
    assert.match(source, /writeFileAtomic\(CONFIG_PATH/);
  });

  it('saveProjects escribe vía writeFileAtomic(PROJECTS_PATH, ...)', () => {
    assert.match(source, /writeFileAtomic\(PROJECTS_PATH/);
  });

  it('saveConfig/saveProjects ya NO usan writeFileSync(CONFIG_PATH/PROJECTS_PATH) directo', () => {
    // La migración (migrateConfigIfNeeded) SÍ puede seguir usando writeFileSync(CONFIG_PATH...)
    // — no se toca. Verificamos que saveConfig/saveProjects no lo hagan extrayendo sus cuerpos.
    const saveConfigBody = source.slice(source.indexOf('export function saveConfig'), source.indexOf('export function loadProjects'));
    const saveProjectsBody = source.slice(source.indexOf('export function saveProjects'), source.indexOf('export function getProviderApiKey'));
    assert.doesNotMatch(saveConfigBody, /writeFileSync\(CONFIG_PATH/);
    assert.doesNotMatch(saveProjectsBody, /writeFileSync\(PROJECTS_PATH/);
  });
});
