// @ts-check
//
// test/logs-head-line.test.js — cobertura del reader bounded `readFirstLine`.
//
// Fundamenta la cabecera del scan `--session-of` (LOG-11): leer solo la primera
// línea NDJSON sin instanciar readline ni consumir el archivo entero.
//

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readFirstLine, MAX_HEADLINE_BYTES } from '../src/logs/head-line.js';

/** @type {string} */
let dir;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'kodo-headline-'));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('LOG-11: readFirstLine (bounded head-line reader)', () => {
  it('returns the first line (sin "\\n") de un archivo con múltiples líneas', () => {
    const p = join(dir, 'multi.ndjson');
    writeFileSync(p, '{"a":1}\n{"b":2}\n');
    assert.equal(readFirstLine(p), '{"a":1}');
  });

  it('returns null para archivo vacío (EOF inmediato)', () => {
    const p = join(dir, 'empty.ndjson');
    writeFileSync(p, '');
    assert.equal(readFirstLine(p), null);
  });

  it('returns null si el archivo no contiene "\\n" (1KB sin newline)', () => {
    const p = join(dir, 'no-newline-1kb.ndjson');
    writeFileSync(p, 'x'.repeat(1024));
    assert.equal(readFirstLine(p), null);
  });

  it('returns la línea truncada a 50KB cuando hay "\\n" dentro del cap', () => {
    const p = join(dir, 'big-with-newline.ndjson');
    const big = 'y'.repeat(50 * 1024);
    writeFileSync(p, `${big}\n${'z'.repeat(10 * 1024)}\n`);
    const first = readFirstLine(p);
    assert.equal(first, big);
    assert.equal(first.length, 50 * 1024);
  });

  it('returns null cuando se alcanza MAX_HEADLINE_BYTES sin encontrar "\\n"', () => {
    const p = join(dir, 'over-cap.ndjson');
    // 100KB sin newline — excede MAX_HEADLINE_BYTES (64KB).
    writeFileSync(p, 'q'.repeat(100 * 1024));
    assert.equal(readFirstLine(p), null);
  });

  it('exporta MAX_HEADLINE_BYTES = 65536', () => {
    assert.equal(MAX_HEADLINE_BYTES, 65536);
  });
});
