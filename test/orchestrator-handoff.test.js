// @ts-check
//
// test/orchestrator-handoff.test.js — KODO-67, mitad DURABLE del reciclado.
//
// El módulo bajo prueba (`src/orchestrator/handoff.js`) no toca `state.json` ni el host:
// su I/O son tres syscalls sobre un fichero cuya ruta se puede inyectar. Eso permite
// probarlo con un tmpdir normal, SIN el aislamiento por subproceso que necesitan las
// suites de la bandeja — la única llamada que resuelve el HOME (`handoffPath`) se prueba
// aparte, y solo por su forma.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HANDOFF_HEADING,
  MAX_HANDOFF_BYTES,
  MAX_CONSUMED_KEPT,
  appendHandoff,
  consumeHandoff,
  consumedName,
  handoffPath,
  readHandoff,
} from '../src/orchestrator/handoff.js';

/** @type {string} */
let dir;
/** @type {string} */
let file;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kodo-handoff-'));
  file = join(dir, 'handoff.md');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ── appendHandoff: la mitad PURA, y la que protege los goldens ────────────────

describe('appendHandoff — sin handoff el prompt NO se mueve (goldens intactos)', () => {
  const BASE = '# kodo:orchestrate\n\nCuerpo del prompt.\n\n## Situación actual\n\nNada.';

  it('con null devuelve el prompt IDÉNTICO, byte a byte', () => {
    assert.equal(appendHandoff(BASE, null), BASE);
  });

  it('con undefined, cadena vacía o solo espacios, también', () => {
    assert.equal(appendHandoff(BASE, undefined), BASE);
    assert.equal(appendHandoff(BASE, ''), BASE);
    assert.equal(appendHandoff(BASE, '   \n\n  '), BASE);
  });

  it('un no-string NO revienta ni contamina el prompt', () => {
    assert.equal(appendHandoff(BASE, /** @type {any} */ (42)), BASE);
    assert.equal(appendHandoff(BASE, /** @type {any} */ ({})), BASE);
  });
});

describe('appendHandoff — con handoff, va AL FINAL y bajo su propio encabezado', () => {
  const BASE = 'PROMPT\n\n## Situación actual\n\ndos sesiones vivas';

  it('el handoff queda DESPUÉS de «Situación actual» (lo más fresco, último)', () => {
    const out = appendHandoff(BASE, 'ITCLIP-125 espera decisión del operador');
    assert.ok(out.startsWith(BASE), 'el prompt original se conserva como prefijo');
    assert.ok(
      out.indexOf(HANDOFF_HEADING) > out.indexOf('## Situación actual'),
      'el handoff va después de la situación actual',
    );
  });

  it('el contenido aparece íntegro y bajo el encabezado', () => {
    const text = '**Sesiones vivas:** ninguna\n**Pendiente:** revisar PR #55';
    const out = appendHandoff(BASE, text);
    assert.ok(out.includes(`${HANDOFF_HEADING}\n\n${text}\n`));
  });

  it('preserva la estructura multilínea: un handoff NO se aplana', () => {
    const text = '## A\n\n- uno\n- dos\n\n## B\n\n- tres';
    assert.ok(appendHandoff(BASE, text).includes('- uno\n- dos'));
  });
});

// ── readHandoff: I/O acotada y never-throws ───────────────────────────────────

describe('readHandoff — las cuatro formas de «no hay handoff» devuelven null', () => {
  it('fichero ausente (el caso NORMAL, no un error)', () => {
    assert.equal(readHandoff({ path: file }), null);
  });

  it('fichero vacío', () => {
    writeFileSync(file, '');
    assert.equal(readHandoff({ path: file }), null);
  });

  it('fichero de solo espacios en blanco', () => {
    writeFileSync(file, '\n\n   \t\n');
    assert.equal(readHandoff({ path: file }), null);
  });

  it('un directorio en la ruta esperada no se lee como handoff', () => {
    assert.equal(readHandoff({ path: dir }), null);
  });
});

describe('readHandoff — cota de tamaño: se IGNORA, no se trunca', () => {
  it('por encima del cap devuelve null (un handoff a medias es peor que ninguno)', () => {
    writeFileSync(file, 'x'.repeat(64));
    assert.equal(readHandoff({ path: file, maxBytes: 32 }), null);
  });

  it('el fichero descartado SIGUE en disco, para que el operador lo vea', () => {
    writeFileSync(file, 'x'.repeat(64));
    readHandoff({ path: file, maxBytes: 32 });
    assert.ok(existsSync(file));
  });

  it('justo en el cap SÍ se lee (la comparación es estricta `>`)', () => {
    writeFileSync(file, 'x'.repeat(32));
    assert.equal(readHandoff({ path: file, maxBytes: 32 })?.text, 'x'.repeat(32));
  });

  it('el default es 32 KB', () => {
    assert.equal(MAX_HANDOFF_BYTES, 32 * 1024);
  });

  it('avisa por el logger cuando descarta por tamaño', () => {
    writeFileSync(file, 'x'.repeat(64));
    /** @type {any[]} */
    const warns = [];
    readHandoff({
      path: file,
      maxBytes: 32,
      logger: /** @type {any} */ ({ warn: (e, d) => warns.push([e, d]) }),
    });
    assert.equal(warns.length, 1);
    assert.equal(warns[0][0], 'orchestrator.handoff.too_large');
  });
});

describe('readHandoff — saneo: control chars fuera, estructura Markdown dentro', () => {
  it('neutraliza CSI/OSC/ESC pero conserva `\\n` y `\\t` (NO es stripForPrompt)', () => {
    writeFileSync(file, '## A\n\n\x1b[31mrojo\x1b[0m\n\t- tabulado\n');
    const r = readHandoff({ path: file });
    assert.equal(r?.text, '## A\n\nrojo\n\t- tabulado');
  });

  it('un handoff largo NO se trunca a 120 chars (el carril de campos no aplica aquí)', () => {
    const long = 'a'.repeat(500);
    writeFileSync(file, long);
    assert.equal(readHandoff({ path: file })?.text.length, 500);
  });

  it('devuelve también la ruta y el tamaño observados', () => {
    writeFileSync(file, 'hola');
    const r = readHandoff({ path: file });
    assert.equal(r?.path, file);
    assert.equal(r?.bytes, 4);
  });
});

// ── consumeHandoff: la no-reinyección ─────────────────────────────────────────

describe('consumedName — nombre del fichero consumido', () => {
  it('lleva el prefijo y la extensión esperados', () => {
    const n = consumedName(new Date('2026-09-01T09:48:15.123Z'));
    assert.ok(n.startsWith('handoff-consumed-'));
    assert.ok(n.endsWith('.md'));
  });

  it('NO contiene `:` — el Finder de macOS los presenta como `/`', () => {
    assert.ok(!consumedName(new Date('2026-09-01T09:48:15.123Z')).includes(':'));
  });

  it('dos instantes distintos dan nombres distintos', () => {
    assert.notEqual(
      consumedName(new Date('2026-09-01T09:48:15.123Z')),
      consumedName(new Date('2026-09-01T09:48:16.123Z')),
    );
  });
});

describe('consumeHandoff — renombra (no borra) y deja el original inaccesible', () => {
  it('el original desaparece y el consumido conserva el contenido', () => {
    writeFileSync(file, 'estado del saliente');
    const r = consumeHandoff(file, { now: () => new Date('2026-09-01T09:48:15.123Z') });
    assert.equal(r.ok, true);
    assert.ok(!existsSync(file), 'el handoff ya no está donde el launch lo busca');
    assert.equal(readFileSync(/** @type {any} */ (r).to, 'utf-8'), 'estado del saliente');
  });

  it('el renombrado aterriza JUNTO al original, no en otro directorio', () => {
    writeFileSync(file, 'x');
    consumeHandoff(file);
    const left = readdirSync(dir);
    assert.equal(left.length, 1);
    assert.ok(left[0].startsWith('handoff-consumed-'));
  });

  it('tras consumir, un segundo readHandoff ya no ve nada (no-reinyección)', () => {
    writeFileSync(file, 'x');
    consumeHandoff(file);
    assert.equal(readHandoff({ path: file }), null);
  });

  it('never-throws: un fichero inexistente devuelve el discriminado, no una excepción', () => {
    const r = consumeHandoff(join(dir, 'no-existe.md'));
    assert.equal(r.ok, false);
  });

  it('rotación: consumir con consumidos previos conserva solo los MAX_CONSUMED_KEPT más recientes', () => {
    for (let i = 0; i < 7; i++) {
      writeFileSync(join(dir, `handoff-consumed-2026-01-0${i + 1}T00-00-00.000Z.md`), 'viejo');
    }
    writeFileSync(file, 'x');
    consumeHandoff(file);
    const left = readdirSync(dir).filter((f) => f.startsWith('handoff-consumed-')).sort();
    assert.equal(left.length, MAX_CONSUMED_KEPT);
    // Sobreviven los más recientes: los dos más antiguos (01 y 02) y el 03 caen.
    assert.ok(!left.some((f) => f.includes('2026-01-01') || f.includes('2026-01-02') || f.includes('2026-01-03')));
  });
});

describe('handoffPath — ruta canónica', () => {
  it('resuelve a `.kodo/handoff.md`', () => {
    assert.ok(handoffPath().endsWith('/.kodo/handoff.md'));
  });
});
