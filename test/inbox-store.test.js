// @ts-check
//
// test/inbox-store.test.js — Phase 83 Plan 01 (CAPT-01/03/06; D-02..D-08, D-15..D-20).
//
// Unit de `src/inbox/store.js`:
//   - Codec + parser: la tabla de 15 vectores de `83-RESEARCH.md` §Code Examples, incluidos los
//     DOS forgeries (T-83-01), más el saneo de los tres carriles y la identidad de una captura.
//   - `listCaptures`: reader leaf never-throws (D-18) que jamás escribe.
//   - `appendCapture`: `O_APPEND` de una sola llamada con fail-open ante lock-timeout (D-02/D-03).
//
// AISLAMIENTO (T-83-05, Pitfall 5): **todos** los paths van por DI (`{inboxPath, lockPath}`
// apuntando a un sandbox de `mkdtempSync`). Este fichero NO toca `HOME` en ningún punto y por
// tanto no puede contaminar el `~/.kodo/inbox.md` real del operador. El único test que roza el
// home es el de resolución perezosa de `defaultInboxPaths()`, que solo compara STRINGS de path
// sin tocar el filesystem.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
  statSync, lstatSync, existsSync, readdirSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireLock, releaseLock } from '../src/session/state-lock.js';
import {
  encodeLine, parseLine, newCaptureId, todayLocal, deriveTag, defaultInboxPaths,
  listCaptures, appendCapture,
  INBOX_FILENAME, INBOX_LOCK_FILENAME, MAX_TEXT_LEN, MAX_DEST_LEN,
} from '../src/inbox/store.js';

/** @type {string} */ let dir;
/** @type {string} */ let inboxPath;
/** @type {string} */ let lockPath;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kodo-inbox-'));
  inboxPath = join(dir, INBOX_FILENAME);
  lockPath = join(dir, INBOX_LOCK_FILENAME);
});

afterEach(() => {
  // Restaurar permisos antes de borrar: el test de EACCES deja un fichero a 0o000 y `rmSync`
  // no podría enlazarlo. Los DIRECTORIOS necesitan el bit de ejecución para ser recorridos, así
  // que se discriminan por `lstatSync` (0o700 vs 0o600).
  const restore = (/** @type {string} */ p) => {
    try {
      const st = lstatSync(p);
      chmodSync(p, st.isDirectory() ? 0o700 : 0o600);
      if (st.isDirectory()) for (const e of readdirSync(p)) restore(join(p, e));
    } catch { /* best-effort */ }
  };
  restore(dir);
  rmSync(dir, { recursive: true, force: true });
});

/** Base reutilizable de una captura abierta. @type {any} */
const BASE = {
  id: 'a3f9k2', text: 'el texto de la idea', tag: 'kodo',
  date: '2026-07-25', origin: 'cli', open: true, estado: null, dest: null,
};

// ---------------------------------------------------------------------------
// Codec + parser
// ---------------------------------------------------------------------------

describe('parseLine — tabla de 15 vectores (83-RESEARCH §Code Examples)', () => {
  /**
   * @type {ReadonlyArray<{ n: string, line: string, expect: any }>}
   * `expect === null` significa NO-MATCH (línea preservada en disco, excluida del listado).
   */
  const VECTORS = Object.freeze([
    {
      n: 'V01 abierta canónica',
      line: '- [ ] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli',
      expect: { id: 'a3f9k2', text: 'el texto de la idea', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: true, estado: null, dest: null },
    },
    {
      n: 'V02 cerrada enrutada con dest',
      line: '- [x] a3f9k2 · el texto · kodo · 2026-07-25 · cli · enrutada → .planning/todos/TODO-012.md',
      expect: { id: 'a3f9k2', text: 'el texto', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: false, estado: 'enrutada', dest: '.planning/todos/TODO-012.md' },
    },
    {
      n: 'V03 cerrada enrutada SIN dest (CAPT-06 best-effort)',
      line: '- [x] b7c1m0 · otra idea · ROMAN · 2026-07-25 · cli · enrutada',
      expect: { id: 'b7c1m0', text: 'otra idea', tag: 'ROMAN', date: '2026-07-25', origin: 'cli', open: false, estado: 'enrutada', dest: null },
    },
    {
      n: 'V04 cerrada descartada',
      line: '- [x] c4d8n5 · idea que no va · kodo · 2026-07-25 · cli · descartada',
      expect: { id: 'c4d8n5', text: 'idea que no va', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: false, estado: 'descartada', dest: null },
    },
    {
      n: 'V05 texto CON separadores embebidos — verbatim',
      line: '- [ ] a3f9k2 · idea · con · separadores · kodo · 2026-07-25 · cli',
      expect: { id: 'a3f9k2', text: 'idea · con · separadores', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: true, estado: null, dest: null },
    },
    {
      n: 'V06 FORGERY 1 — el texto imita la cola (T-83-01)',
      line: '- [ ] a3f9k2 · idea falsa · kodo · 2026-07-25 · cli · descartada · real · 2026-07-26 · skill',
      expect: { id: 'a3f9k2', text: 'idea falsa · kodo · 2026-07-25 · cli · descartada', tag: 'real', date: '2026-07-26', origin: 'skill', open: true, estado: null, dest: null },
    },
    {
      n: 'V07 FORGERY 2 — fecha falsa embebida en el texto (T-83-01)',
      line: '- [ ] a3f9k2 · nota del 2026-01-01 · x · y · kodo · 2026-07-25 · cli',
      expect: { id: 'a3f9k2', text: 'nota del 2026-01-01 · x · y', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: true, estado: null, dest: null },
    },
    {
      n: 'V08 texto que TERMINA en «descartada» — no se confunde con el sufijo',
      line: '- [ ] a3f9k2 · esto es descartada · kodo · 2026-07-25 · cli',
      expect: { id: 'a3f9k2', text: 'esto es descartada', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: true, estado: null, dest: null },
    },
    {
      n: 'V09 dest CON separadores dentro — se recupera completo',
      line: '- [x] a3f9k2 · el texto · kodo · 2026-07-25 · cli · enrutada → a · b · c',
      expect: { id: 'a3f9k2', text: 'el texto', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: false, estado: 'enrutada', dest: 'a · b · c' },
    },
    {
      n: 'V10 hand-edit `- [x]` SIN sufijo → cerrada, cierre desconocido (contrato 2)',
      line: '- [x] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli',
      expect: { id: 'a3f9k2', text: 'el texto de la idea', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: false, estado: null, dest: null },
    },
    { n: 'V11 NO-MATCH línea hand-written', line: 'esto lo escribi a mano', expect: null },
    { n: 'V12 NO-MATCH heading markdown', line: '## Notas', expect: null },
    { n: 'V13 NO-MATCH fecha inválida', line: '- [ ] a3f9k2 · x · kodo · ayer · cli', expect: null },
    { n: 'V14 NO-MATCH línea vacía', line: '', expect: null },
    { n: 'V15 NO-MATCH tag que contiene el separador (Pitfall 4)', line: '- [ ] a3f9k2 · x · ko·do · 2026-07-25 · cli', expect: null },
  ]);

  it('la tabla tiene exactamente 15 vectores (2 de ellos forgeries)', () => {
    assert.equal(VECTORS.length, 15);
    assert.equal(VECTORS.filter((v) => v.n.includes('FORGERY')).length, 2);
  });

  for (const v of VECTORS) {
    it(v.n, () => {
      assert.deepEqual(parseLine(v.line), v.expect);
    });
  }

  it('parseLine never-throws sobre input no-string', () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      assert.equal(parseLine(/** @type {any} */ (bad)), null);
    }
  });
});

describe('encodeLine — saneo del carril de escritura (CAPT-01)', () => {
  it('colapsa `\\n`/`\\r`/`\\t` REALES y sus escapes LITERALES — cero saltos interiores', () => {
    const line = encodeLine({ ...BASE, text: 'a\nb\tc\rd\\ne\\tf' });
    assert.equal(/[\n\r\t]/.test(line), false);
    assert.equal(parseLine(line) !== null, true, 'la línea saneada sigue parseando');
  });

  it('neutraliza U+2028 y U+2029 (Pitfall 10)', () => {
    const line = encodeLine({ ...BASE, text: 'a\u2028b\u2029c' });
    assert.equal(/[\u2028\u2029]/.test(line), false);
    assert.equal(parseLine(line)?.text, 'a b c');
  });

  it('trunca el texto a MAX_TEXT_LEN caracteres (Pitfall 1)', () => {
    const parsed = parseLine(encodeLine({ ...BASE, text: 'x'.repeat(MAX_TEXT_LEN + 500) }));
    assert.equal(parsed?.text.length, MAX_TEXT_LEN);
  });

  it('trunca el dest a MAX_DEST_LEN caracteres', () => {
    const parsed = parseLine(encodeLine({
      ...BASE, open: false, estado: 'enrutada', dest: 'd'.repeat(MAX_DEST_LEN + 300),
    }));
    assert.equal(parsed?.dest?.length, MAX_DEST_LEN);
  });

  it('recorta los bordes del texto pero PRESERVA el whitespace interior (verbatim, CAPT-01)', () => {
    assert.equal(parseLine(encodeLine({ ...BASE, text: '   dos  espacios   ' }))?.text, 'dos  espacios');
  });

  it('tag/origen con el separador o whitespace múltiple salen normalizados y la línea parsea (Pitfall 4, T-83-04)', () => {
    const line = encodeLine({ ...BASE, tag: 'ko · do', origin: 'c   li' });
    const parsed = parseLine(line);
    assert.notEqual(parsed, null, 'un tag con U+00B7 no puede romper el parseo');
    assert.equal(parsed?.tag.includes('·'), false, 'el campo estructurado nunca contiene el separador');
    assert.equal(parsed?.tag, 'ko - do');
    assert.equal(parsed?.origin, 'c li');
  });

  it('una captura cerrada conserva id, texto, tag, fecha y origen (CAPT-03: cerrar no borra)', () => {
    const abierta = parseLine(encodeLine(BASE));
    const cerrada = parseLine(encodeLine({ ...BASE, open: false, estado: 'descartada' }));
    assert.equal(cerrada?.id, abierta?.id);
    assert.equal(cerrada?.text, abierta?.text);
    assert.equal(cerrada?.tag, abierta?.tag);
    assert.equal(cerrada?.date, abierta?.date);
    assert.equal(cerrada?.origin, abierta?.origin);
  });

  it('`enrutada` con dest vacío o solo whitespace no emite trace pointer (CAPT-06)', () => {
    for (const dest of ['', '   ', null]) {
      const line = encodeLine({ ...BASE, open: false, estado: 'enrutada', dest });
      assert.equal(line.includes('→'), false, `dest=${JSON.stringify(dest)}`);
      assert.equal(parseLine(line)?.estado, 'enrutada');
    }
  });

  it('`descartada` nunca emite trace pointer aunque llegue un dest', () => {
    const line = encodeLine({ ...BASE, open: false, estado: 'descartada', dest: 'algo' });
    assert.equal(line.includes('→'), false);
  });
});

describe('Identidad de una captura (D-06, D-07, D-15) + paths perezosos', () => {
  it('newCaptureId devuelve 6 chars de [0-9a-z] y 1000 llamadas dan >= 999 valores distintos', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      const id = newCaptureId();
      assert.match(id, /^[0-9a-z]{6}$/);
      ids.add(id);
    }
    assert.ok(ids.size >= 999, `esperado >= 999 ids únicos, obtenidos ${ids.size}`);
  });

  it('todayLocal usa la fecha LOCAL, no UTC (D-07)', () => {
    // 23:30 local del 25 — con `toISOString()` en un huso al este de UTC saldría el 26.
    assert.equal(todayLocal(new Date(2026, 6, 25, 23, 30)), '2026-07-25');
    assert.equal(todayLocal(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
  });

  it('deriveTag: match → projectId; sin match → basename(cwd) (D-15)', () => {
    assert.equal(deriveTag('/x/y/kodo', { kodo: '/x/y/kodo' }), 'kodo');
    assert.equal(deriveTag('/x/y/otro', { kodo: '/x/y/kodo' }), 'otro');
  });

  it('deriveTag: shape `ambiguous` cae a basename(cwd) — el SEGUNDO modo de fallo (Pitfall 3)', () => {
    // Dos projectIds con paths de IGUAL longitud → `{error:'ambiguous'}`. Los ids (`alpha`/`beta`)
    // difieren del basename (`zzz`) justo para que el fallback sea distinguible del match.
    assert.equal(deriveTag('/x/y/zzz', { alpha: '/x/y/zzz', beta: '/x/y/zzz' }), 'zzz');
  });

  it('deriveTag never-throws con `projects` corrupto (null, número, array, undefined)', () => {
    for (const corrupt of [null, 42, [1, 2], undefined, { a: null }, { b: { default: 7 } }]) {
      assert.equal(deriveTag('/x/y/zzz', /** @type {any} */ (corrupt)), 'zzz');
    }
  });

  it('defaultInboxPaths se resuelve PEREZOSAMENTE (contrato 7 — sin fuga de HOME al module-load)', () => {
    const prev = process.env.HOME;
    try {
      process.env.HOME = '/tmp/kodo-probe-h1';
      const a = defaultInboxPaths();
      process.env.HOME = '/tmp/kodo-probe-h2';
      const b = defaultInboxPaths();
      assert.notEqual(a.inboxPath, b.inboxPath);
      assert.equal(a.inboxPath.endsWith(join('.kodo', INBOX_FILENAME)), true);
      assert.equal(a.lockPath.endsWith(join('.kodo', INBOX_LOCK_FILENAME)), true);
    } finally {
      if (prev === undefined) delete process.env.HOME;
      else process.env.HOME = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// listCaptures — reader leaf never-throws (D-18)
// ---------------------------------------------------------------------------

describe('listCaptures — never-throws (D-18)', () => {
  it('path inexistente → { captures: [], unparsed: 0 } sin lanzar', () => {
    assert.deepEqual(listCaptures({ inboxPath }), { captures: [], unparsed: 0 });
  });

  it('el path es un DIRECTORIO (EISDIR) → listado vacío sin lanzar', () => {
    mkdirSync(inboxPath, { recursive: true });
    assert.deepEqual(listCaptures({ inboxPath }), { captures: [], unparsed: 0 });
  });

  it('fichero sin permiso de lectura (EACCES) → listado vacío sin lanzar', (t) => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      t.skip('root ignora los bits de permiso');
      return;
    }
    writeFileSync(inboxPath, encodeLine(BASE) + '\n');
    chmodSync(inboxPath, 0o000);
    assert.deepEqual(listCaptures({ inboxPath }), { captures: [], unparsed: 0 });
  });

  it('2 válidas + heading + línea a mano + línea vacía → 2 capturas y unparsed: 2', () => {
    writeFileSync(inboxPath, [
      '## Notas',
      encodeLine(BASE),
      '',
      'esto lo escribi a mano',
      encodeLine({ ...BASE, id: 'b7c1m0', text: 'otra idea' }),
    ].join('\n') + '\n');

    const r = listCaptures({ inboxPath });
    assert.equal(r.captures.length, 2);
    assert.deepEqual(r.captures.map((c) => c.id), ['a3f9k2', 'b7c1m0']);
    assert.equal(r.unparsed, 2, 'la línea vacía NO cuenta como no-parseable');
  });

  it('NO escribe: bytes y mtime idénticos antes y después (D-18)', () => {
    const raw = '## Notas\n' + encodeLine(BASE) + '\nbasura\n';
    writeFileSync(inboxPath, raw);
    const before = statSync(inboxPath);
    listCaptures({ inboxPath });
    listCaptures({ inboxPath });
    const after = statSync(inboxPath);
    assert.equal(readFileSync(inboxPath, 'utf-8'), raw);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.size, before.size);
  });

  it('una captura cerrada sigue listada (la traza permanente es consultable — CAPT-03)', () => {
    writeFileSync(inboxPath, encodeLine({ ...BASE, open: false, estado: 'descartada' }) + '\n');
    const r = listCaptures({ inboxPath });
    assert.equal(r.captures.length, 1);
    assert.equal(r.captures[0].open, false);
    assert.equal(r.captures[0].estado, 'descartada');
    assert.equal(r.captures[0].text, BASE.text);
  });
});

// ---------------------------------------------------------------------------
// appendCapture — O_APPEND + fail-open (D-02, D-03, D-19)
// ---------------------------------------------------------------------------

describe('appendCapture — O_APPEND y creación on-demand (D-02, D-19)', () => {
  it('crea el directorio inexistente y escribe la línea SIN cabecera (D-19)', () => {
    const nested = join(dir, 'sub', 'dir', INBOX_FILENAME);
    const nestedLock = join(dir, 'sub', 'dir', INBOX_LOCK_FILENAME);
    const r = appendCapture(encodeLine(BASE) + '\n', { inboxPath: nested, lockPath: nestedLock });
    assert.deepEqual(r, { ok: true, coordinated: true });

    const raw = readFileSync(nested, 'utf-8');
    assert.equal(raw[0], '-', 'el primer byte es el `-` de la línea: sin cabecera ni preámbulo');
    assert.equal(raw, encodeLine(BASE) + '\n');
  });

  it('dos llamadas seguidas producen exactamente 2 líneas, en orden', () => {
    const a = encodeLine(BASE) + '\n';
    const b = encodeLine({ ...BASE, id: 'b7c1m0', text: 'segunda' }) + '\n';
    appendCapture(a, { inboxPath, lockPath });
    appendCapture(b, { inboxPath, lockPath });

    const raw = readFileSync(inboxPath, 'utf-8');
    assert.equal(raw, a + b);
    assert.equal(raw.split('\n').filter((l) => l !== '').length, 2);
    assert.deepEqual(listCaptures({ inboxPath }).captures.map((c) => c.id), ['a3f9k2', 'b7c1m0']);
  });

  it('sobre un fichero SIN newline final antepone un newline — jamás concatena sobre la línea previa', () => {
    const handEdited = '- [ ] zzz999 · linea hand-editada sin newline · kodo · 2026-07-24 · cli';
    writeFileSync(inboxPath, handEdited); // sin '\n' final, deliberadamente
    appendCapture(encodeLine(BASE) + '\n', { inboxPath, lockPath });

    const lines = readFileSync(inboxPath, 'utf-8').split('\n');
    assert.equal(lines[0], handEdited, 'la línea hand-editada conserva sus bytes originales');
    assert.equal(lines[1], encodeLine(BASE));
    assert.equal(listCaptures({ inboxPath }).captures.length, 2);
  });

  it('sobre un fichero CON newline final no antepone nada (cero líneas vacías espurias)', () => {
    writeFileSync(inboxPath, encodeLine(BASE) + '\n');
    appendCapture(encodeLine({ ...BASE, id: 'b7c1m0' }) + '\n', { inboxPath, lockPath });
    assert.equal(readFileSync(inboxPath, 'utf-8').includes('\n\n'), false);
  });

  it('lock libre → { ok:true, coordinated:true } y warnFn NO se invoca', () => {
    /** @type {string[]} */ const warns = [];
    const r = appendCapture(encodeLine(BASE) + '\n', {
      inboxPath, lockPath, warnFn: (s) => warns.push(s),
    });
    assert.deepEqual(r, { ok: true, coordinated: true });
    assert.deepEqual(warns, []);
  });
});

describe('appendCapture — fail-open ante lock-timeout (D-03, contrato 6)', () => {
  it('lock ocupado → la línea SÍ se escribe, coordinated:false y EXACTAMENTE un warn accionable', () => {
    const got = acquireLock(lockPath);
    assert.notEqual(got, null, 'el test debe poder tomar el lock primero');

    /** @type {string[]} */ const warns = [];
    let consoleWarns = 0;
    const realConsoleWarn = console.warn;
    console.warn = () => { consoleWarns++; };
    let r;
    try {
      r = appendCapture(encodeLine(BASE) + '\n', {
        inboxPath, lockPath, warnFn: (s) => warns.push(s),
      });
    } finally {
      console.warn = realConsoleWarn;
      releaseLock(lockPath, /** @type {{token:string}} */ (got).token);
    }

    assert.deepEqual(r, { ok: true, coordinated: false });
    assert.equal(readFileSync(inboxPath, 'utf-8'), encodeLine(BASE) + '\n', 'D-03: la idea NO se pierde');
    assert.equal(warns.length, 1, 'exactamente UN mensaje accionable (contrato 6)');
    assert.match(warns[0], /^\[kodo:inbox\] lock-timeout/);
    assert.equal(warns[0].endsWith('\n'), true);
    assert.equal(consoleWarns, 0, 'el console.warn por defecto de withFileLock queda silenciado');
  });

  it('un fallo de escritura del filesystem devuelve { ok:false, reason:"fs" } sin lanzar', () => {
    // `inboxPath` es un DIRECTORIO: el lock se toma bien, pero el append falla con EISDIR.
    mkdirSync(inboxPath, { recursive: true });
    const r = appendCapture(encodeLine(BASE) + '\n', { inboxPath, lockPath });
    assert.deepEqual(r, { ok: false, reason: 'fs' });
  });

  it('no deja ningún fichero temporal residual en el directorio', () => {
    appendCapture(encodeLine(BASE) + '\n', { inboxPath, lockPath });
    assert.equal(readdirSync(dir).some((f) => f.includes('.tmp.')), false);
    assert.equal(existsSync(inboxPath), true);
  });
});
