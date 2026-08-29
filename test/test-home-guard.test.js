// @ts-check
//
// test/test-home-guard.test.js — KODO-57.
//
// Tests del comparador de la guarda de fuga de HOME (scripts/test-home-guard.mjs).
// La guarda envuelve a `npm test` y falla si la suite toca el `~/.kodo/config.json`
// REAL del operador. Su parte con lógica es `describeChange`, que es pura: se
// ejercita aquí con fotos sintéticas, sin tocar ningún HOME.
//
// El caso end-to-end (`snapshot` contra un fichero de verdad) se monta en un tmpdir,
// nunca contra `homedir()` — sería precisamente la fuga que la guarda persigue.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { snapshot, describeChange } from '../scripts/test-home-guard.mjs';

describe('test-home-guard — describeChange (puro)', () => {
  it('ausente antes y después → sin cambio (máquina limpia, contenedor de CI)', () => {
    assert.equal(describeChange({ exists: false }, { exists: false }), null);
  });

  it('misma foto → sin cambio', () => {
    const s = { exists: true, mtimeMs: 1_000_000, size: 2400 };
    assert.equal(describeChange(s, { ...s }), null);
  });

  it('creado donde no había → fuga', () => {
    const v = describeChange({ exists: false }, { exists: true, mtimeMs: 1, size: 10 });
    assert.match(String(v), /CREÓ/);
  });

  it('borrado → fuga', () => {
    const v = describeChange({ exists: true, mtimeMs: 1, size: 10 }, { exists: false });
    assert.match(String(v), /BORRÓ/);
  });

  it('mtime distinto con el MISMO tamaño → fuga (el caso silencioso que motiva la guarda)', () => {
    const v = describeChange(
      { exists: true, mtimeMs: 1_000_000, size: 2400 },
      { exists: true, mtimeMs: 2_000_000, size: 2400 },
    );
    assert.match(String(v), /mtime/);
    assert.match(String(v), /mismo tamaño/);
  });

  it('mismo mtime pero distinto tamaño → fuga (escritura dentro del mismo tick)', () => {
    const v = describeChange(
      { exists: true, mtimeMs: 1_000_000, size: 2400 },
      { exists: true, mtimeMs: 1_000_000, size: 2500 },
    );
    assert.match(String(v), /tamaño/);
  });
});

describe('test-home-guard — snapshot (contra un tmpdir, NUNCA contra homedir)', () => {
  it('fichero ausente → { exists: false } sin lanzar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kodo-home-guard-'));
    try {
      assert.deepEqual(snapshot(join(dir, 'no-existe.json')), { exists: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('una reescritura con el MISMO contenido se detecta igualmente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kodo-home-guard-'));
    const f = join(dir, 'config.json');
    try {
      writeFileSync(f, '{"a":1}\n');
      const before = snapshot(f);
      // Reescritura idempotente: mismos bytes, mtime nuevo. utimesSync fuerza el salto
      // sin depender de la resolución del reloj del filesystem.
      writeFileSync(f, '{"a":1}\n');
      utimesSync(f, new Date(), new Date(Date.now() + 60_000));
      const after = snapshot(f);
      assert.equal(after.size, before.size, 'el tamaño no cambia — el contenido es idéntico');
      assert.match(String(describeChange(before, after)), /mtime/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
