// @ts-check
//
// test/dashboard-inbox-count.test.js — Phase 84 Plan 03 (CAPT-07; D-16..D-24).
//
// Este fichero es LA MITAD DE D-17 QUE IMPIDE LA DERIVA. D-17 aísla el contador del
// dashboard del store del inbox (importar `src/inbox/store.js` metería picocolors en el
// grafo del TUI por vía transitiva — `store.js:46` → `../cli/format.js` → picocolors — y
// `test/format-isolation.test.js` NO lo detectaría porque solo mira imports DIRECTOS).
// Ese aislamiento cuesta una duplicación de la gramática de la línea; D-18 es la
// contrapartida obligatoria: sobre el MISMO fixture, el conteo del leaf debe ser
// EXACTAMENTE igual al de `listCaptures(...).captures.filter(c => c.open).length`.
//
// Sin este fichero, D-17 sería duplicación con riesgo de deriva silenciosa. Con él, la
// deriva es un fallo de suite.
//
// `listCaptures` se importa AQUÍ y SOLO aquí: es el ORÁCULO del test, jamás la dependencia
// del leaf.
//
// Disciplina de HOME (RESEARCH §Pitfall 8): todos los fixtures viven en un `mkdtempSync` y
// se inyectan por DI (`kodoDir` / `homedirFn` / `readFileFn`). NUNCA se toca `process.env`
// y NUNCA se lee el `~/.kodo/inbox.md` real del operador — ni siquiera de rebote, porque
// todos los tests de render inyectan `inboxCountFn`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { listCaptures } from '../src/inbox/store.js'; // el ORÁCULO, no la dependencia del leaf
import { readOpenCaptureCount } from '../src/cli/dashboard/inbox-count.js';

/** @type {string[]} */
const tmpDirs = [];

/**
 * Siembra un inbox en un directorio temporal propio y devuelve el path del fichero.
 *
 * El directorio es el `kodoDir` que se le inyecta al leaf (`dirname(p)`), y el fichero es
 * el `inboxPath` que se le pasa al oráculo: los dos lectores ven EXACTAMENTE los mismos
 * bytes, que es la premisa entera de D-18.
 *
 * @param {string} content — contenido literal del inbox (los tests controlan el newline final)
 * @returns {string} path absoluto del `inbox.md` sembrado
 */
function seed(content) {
  const dir = mkdtempSync(join(tmpdir(), 'kodo-inbox-count-'));
  tmpDirs.push(dir);
  const p = join(dir, 'inbox.md');
  writeFileSync(p, content);
  return p;
}

/** Limpia todos los directorios temporales sembrados. */
function cleanup() {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Conteo del ORÁCULO sobre el mismo fichero. `listCaptures` solo cuenta lo que casa
 * `LINE_RE` ENTERA; una línea sin los campos estructurados no es una captura.
 *
 * @param {string} inboxPath
 * @returns {number}
 */
function oracleOpenCount(inboxPath) {
  return listCaptures({ inboxPath }).captures.filter((c) => c.open).length;
}

/**
 * Fixture ADVERSARIAL de D-18: capturas reales + los hand-edits que el fichero recibe de
 * verdad. `~/.kodo/inbox.md` es human-editable POR DISEÑO (83 D-04/D-19: sin cabecera,
 * lista pura de checklist markdown), así que `- [ ] comprar leche` no es un vector
 * artificial — es lo que un humano escribe en una checklist markdown.
 *
 * Conteo esperado: 2 abiertas (la primera y la de sufijo incoherente).
 */
const ADVERSARIAL_FIXTURE = [
  '- [ ] a3f9k2 · idea buena · kodo · 2026-07-25 · cli', // abierta bien formada  → CUENTA
  '- [x] b7c1m0 · ya enrutada · kodo · 2026-07-25 · cli · enrutada → .planning/todos/T-1.md',
  '- [x] c4d8n5 · descartada · kodo · 2026-07-25 · cli · descartada',
  '- [ ] comprar leche', // hand-edit: checklist ajena
  '- [ ] TODO: revisar esto mañana', // hand-edit: checklist ajena
  '- [ ] zz1 · fecha mala · kodo · 26-07-25 · cli', // fecha fuera de gramática
  '- [ ] zz2 · sep en tag · ta·g · 2026-07-25 · cli', // separador dentro del tag
  '- [ ]  d1e2f3 · doble espacio · kodo · 2026-07-25 · cli', // doble espacio tras el checkbox
  '  - [ ] e1f2g3 · indentada · kodo · 2026-07-25 · cli', // indentada con espacios por delante
  '- [ ] f1a2b3 · abierta con sufijo · kodo · 2026-07-25 · cli · enrutada', // hand-edit incoherente → CUENTA
  '',
  '# Cabecera escrita a mano',
];

/** Conteo absoluto esperado sobre `ADVERSARIAL_FIXTURE` (medido en 84-RESEARCH §Pitfall 6). */
const ADVERSARIAL_EXPECTED_OPEN = 2;

describe('CAPT-07 · D-18: anti-drift leaf ↔ listCaptures', () => {
  it('coinciden EXACTAMENTE sobre el fixture adversarial, y el valor absoluto es 2', (t) => {
    t.after(cleanup);
    const p = seed(ADVERSARIAL_FIXTURE.join('\n') + '\n');

    const leaf = readOpenCaptureCount({ kodoDir: dirname(p) });
    const oracle = oracleOpenCount(p);

    // La igualdad es D-18. El valor absoluto es el guard contra la igualdad TRIVIAL: si
    // ambos lectores se rompieran a la vez (p. ej. contando 0), la igualdad sola quedaría
    // verde. La regex de PREFIJO `/^- \[ \] /` daría 7 aquí (84-RESEARCH §Pitfall 6).
    assert.equal(
      leaf,
      oracle,
      `DRIFT: el leaf cuenta ${leaf} y listCaptures cuenta ${oracle} sobre el mismo fixture`,
    );
    assert.equal(leaf, ADVERSARIAL_EXPECTED_OPEN, 'el fixture adversarial tiene 2 capturas abiertas');
    assert.equal(oracle, ADVERSARIAL_EXPECTED_OPEN, 'el oráculo también debe ver 2');
  });

  it('coinciden sobre el fixture de regresión de 1 500 capturas (83-05)', (t) => {
    t.after(cleanup);
    // Molde de `seedLargeInbox` (test/inbox-cli.test.js): identificadores derivados del
    // índice, texto determinista, cola de líneas cerradas. Regenerado INLINE a propósito —
    // el repo no usa helpers cross-test.
    const N = 1500;
    const CLOSED_TAIL = 300;
    const openCount = N - CLOSED_TAIL;
    /** @type {string[]} */
    const lines = [];
    for (let i = 0; i < N; i++) {
      const id = i.toString(36).padStart(6, '0');
      const text = `captura sembrada numero ${i} — texto largo y determinista para el fixture de volumen`;
      const head = `${id} · ${text} · kodo · 2026-07-25 · cli`;
      lines.push(
        i < openCount ? `- [ ] ${head}` : `- [x] ${head} · enrutada → .planning/todos/TODO-${id}.md`,
      );
    }
    const p = seed(lines.join('\n') + '\n');

    const leaf = readOpenCaptureCount({ kodoDir: dirname(p) });
    assert.equal(leaf, oracleOpenCount(p), 'DRIFT sobre el fixture de volumen');
    assert.equal(leaf, openCount, 'el fixture de volumen tiene 1 200 capturas abiertas');
  });
});

describe('CAPT-07 · D-20: never-throws de cuerpo entero', () => {
  it('fichero ausente / EACCES / directorio / binario → 0, y ninguno lanza', (t) => {
    t.after(cleanup);

    // (1) directorio inexistente → ENOENT
    assert.equal(readOpenCaptureCount({ kodoDir: '/no/existe/en/ningun/sitio' }), 0);

    // (2) lector que lanza EACCES (permisos)
    assert.equal(
      readOpenCaptureCount({
        kodoDir: '/tmp',
        readFileFn: () => {
          throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
        },
      }),
      0,
    );

    // (3) `inbox.md` es un DIRECTORIO en vez de un fichero → EISDIR
    const dir = mkdtempSync(join(tmpdir(), 'kodo-inbox-count-eisdir-'));
    tmpDirs.push(dir);
    mkdirSync(join(dir, 'inbox.md'));
    assert.equal(readOpenCaptureCount({ kodoDir: dir }), 0);

    // (4) contenido BINARIO con bytes nulos → sin match, sin throw.
    // Los bytes de control van como ESCAPES, jamás literales: un NUL literal haría que git
    // tratase este fichero de test como binario y lo volvería indiffable (misma disciplina
    // que el `﻿` escapado de `progress.js:33`). En disco sí se escriben los bytes reales.
    const bin = seed('\u0000\u0001\u0002- [ ] \u0000\u0000 basura binaria \u0000\uFFFD');
    assert.equal(readOpenCaptureCount({ kodoDir: dirname(bin) }), 0);
  });
});

describe('CAPT-07 · D-19: resolución perezosa del path', () => {
  it('dos kodoDir distintos dan conteos distintos EN EL MISMO PROCESO', (t) => {
    t.after(cleanup);
    // Si el path quedara fijado en el cuerpo del módulo (la fuga de `config.js:11` que
    // 83-01 documentó), la segunda invocación devolvería el conteo de la primera.
    const a = seed('- [ ] a00001 · una · kodo · 2026-07-25 · cli\n');
    const b = seed(
      '- [ ] b00001 · una · kodo · 2026-07-25 · cli\n' +
        '- [ ] b00002 · dos · kodo · 2026-07-25 · cli\n' +
        '- [ ] b00003 · tres · kodo · 2026-07-25 · cli\n',
    );

    assert.equal(readOpenCaptureCount({ kodoDir: dirname(a) }), 1);
    assert.equal(readOpenCaptureCount({ kodoDir: dirname(b) }), 3);
    assert.equal(readOpenCaptureCount({ kodoDir: dirname(a) }), 1, 'la 1ª invocación no fijó el path');
  });

  it('con `homedirFn` inyectado resuelve bajo ese HOME simulado', (t) => {
    t.after(cleanup);
    const home = mkdtempSync(join(tmpdir(), 'kodo-inbox-count-home-'));
    tmpDirs.push(home);
    mkdirSync(join(home, '.kodo'), { recursive: true });
    writeFileSync(
      join(home, '.kodo', 'inbox.md'),
      '- [ ] h00001 · una · kodo · 2026-07-25 · cli\n' +
        '- [x] h00002 · dos · kodo · 2026-07-25 · cli · descartada\n',
    );

    // Sin tocar `process.env.HOME`: la DI es lo que hace hermético el test.
    assert.equal(readOpenCaptureCount({ homedirFn: () => home }), 1);
  });
});

describe('CAPT-07 · concurrencia y solo-lectura', () => {
  it('una lectura que cruza un O_APPEND observa una línea parcial que NO se cuenta', (t) => {
    t.after(cleanup);
    // El leaf compite con `kodo capture` (append en `O_APPEND`) y con el `renameSync` del
    // marcado. Una lectura que cruza el rename observa el fichero anterior O el posterior
    // —el rename es atómico—, jamás uno a medias. Una lectura que cruza un append puede
    // observar una última línea PARCIAL: no casa la regex de línea abierta y simplemente
    // no se cuenta. Garantía: nunca incorrecto por corrupción; como mucho corto en uno
    // durante menos de un ciclo de render.
    const p = seed(
      '- [ ] p00001 · captura completa · kodo · 2026-07-25 · cli\n' +
        '- [ ] p00002 · segunda completa · kodo · 2026-07-25 · cli\n' +
        '- [ ] p00003 · truncada a med', // sin newline final, cortada en mitad de un campo
    );

    const leaf = readOpenCaptureCount({ kodoDir: dirname(p) });
    assert.equal(leaf, 2, 'la línea parcial no se cuenta');
    assert.equal(leaf, oracleOpenCount(p), 'y el oráculo ve exactamente lo mismo');
  });

  it('el único acceso al filesystem es de LECTURA: contenido y mtime intactos', (t) => {
    t.after(cleanup);
    const content = '- [ ] r00001 · una · kodo · 2026-07-25 · cli\n';
    const p = seed(content);
    const before = statSync(p);

    /** @type {string[]} */
    const reads = [];
    const n = readOpenCaptureCount({
      kodoDir: dirname(p),
      readFileFn: (path) => {
        reads.push(path);
        return readFileSync(path, 'utf-8');
      },
    });

    assert.equal(n, 1);
    assert.deepEqual(reads, [p], 'exactamente una lectura, del inbox y de nada más');
    const after = statSync(p);
    assert.equal(readFileSync(p, 'utf-8'), content, 'el fichero conserva su contenido byte a byte');
    assert.equal(after.mtimeMs, before.mtimeMs, 'el fichero conserva su mtime');
    assert.equal(after.size, before.size, 'el fichero conserva su tamaño');
  });
});
