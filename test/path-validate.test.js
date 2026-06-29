// @ts-check
//
// Tests del validador de ruta-directorio (PROJ-02 / D-04, Phase 64).
//
// A diferencia de `config-validate.test.js` (100% puro, hermético), este test SÍ toca
// el filesystem porque `validateExistingDir` es el ÚNICO validador con I/O del milestone.
// Usa `mkdtempSync(os.tmpdir())` para crear un directorio REAL + un archivo real dentro,
// sin tocar `process.env.HOME` ni `~/.kodo` (aislamiento — VALIDATION isolation note).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateExistingDir } from '../src/path-validate.js';

describe('PROJ-02/D-04 — validateExistingDir (ruta-directorio, never-throws con I/O)', () => {
  /** @type {string} */ let root;     // tmpdir raíz del test (se limpia en after)
  /** @type {string} */ let realDir;  // directorio existente válido
  /** @type {string} */ let realFile; // archivo existente (no es directorio)
  /** @type {string} */ let dangling; // symlink colgante (target borrado)

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'kodo-pathval-'));
    realDir = join(root, 'un-dir');
    mkdirSync(realDir);
    realFile = join(root, 'un-archivo.txt');
    writeFileSync(realFile, 'contenido');
    // symlink que apunta a un target inexistente → statSync LANZA al seguirlo (Pitfall 2)
    dangling = join(root, 'symlink-roto');
    symlinkSync(join(root, 'target-inexistente'), dangling);
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('acepta un directorio existente devolviendo {ok:true, value} con la ruta trim-eada', () => {
    assert.deepEqual(validateExistingDir(realDir), { ok: true, value: realDir });
  });

  it('recorta espacios alrededor de la ruta antes de validar', () => {
    assert.deepEqual(validateExistingDir(`  ${realDir}  `), { ok: true, value: realDir });
  });

  it('rechaza un archivo existente (no es un directorio)', () => {
    const res = validateExistingDir(realFile);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /no es un directorio/);
  });

  it('rechaza una ruta inexistente', () => {
    const res = validateExistingDir(join(root, 'no-existe'));
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /no existe/);
  });

  it('rechaza la ruta vacía', () => {
    const res = validateExistingDir('');
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /vac/i);
  });

  it('rechaza solo-espacios (vacía tras trim)', () => {
    const res = validateExistingDir('   ');
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /vac/i);
  });

  it('rechaza un symlink colgante SIN lanzar (statSync lanza → try/catch, Pitfall 2)', () => {
    let res;
    assert.doesNotThrow(() => { res = validateExistingDir(dangling); });
    assert.equal(res.ok, false);
  });

  it('never-throws ante input arbitrario (null/undefined/objeto/number)', () => {
    for (const v of [null, undefined, {}, [], 42, NaN, true]) {
      assert.doesNotThrow(() => validateExistingDir(/** @type {any} */ (v)));
      assert.equal(validateExistingDir(/** @type {any} */ (v)).ok, false);
    }
  });

  it('devuelve un mensaje de error en español al rechazar', () => {
    const res = validateExistingDir(join(root, 'no-existe'));
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(typeof res.error, 'string');
  });
});
