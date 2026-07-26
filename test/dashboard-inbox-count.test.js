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
import { EventEmitter } from 'node:events';
import { render } from 'ink-testing-library';
import { render as inkRender } from 'ink';
import { createElement } from 'react';

import { listCaptures } from '../src/inbox/store.js'; // el ORÁCULO, no la dependencia del leaf
import { readOpenCaptureCount } from '../src/cli/dashboard/inbox-count.js';
import App from '../src/cli/dashboard/App.js';
import SessionTable from '../src/cli/dashboard/SessionTable.js';

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

  // 84-REVIEW WR-01. La resolución del path vivía FUERA del `try`, así que un fallo al
  // resolverlo escapaba del never-throws y tumbaba el árbol de ink entero — precisamente el
  // fallo que D-20 existe para impedir, en el único punto donde el JSDoc prometía cubrirlo.
  it('WR-01: un fallo al RESOLVER el path también degrada a 0, no lanza', () => {
    assert.equal(
      readOpenCaptureCount({
        homedirFn: () => {
          throw new Error('homedir() no disponible en este entorno');
        },
      }),
      0,
      'un `homedirFn` que lanza debe degradar a 0: está dentro del never-throws, no fuera',
    );

    assert.equal(
      // `join` lanza `TypeError` ante un argumento que no sea string. Llega por DI, así que
      // es alcanzable sin tocar el entorno.
      readOpenCaptureCount({ kodoDir: /** @type {any} */ (42) }),
      0,
      'un `kodoDir` no-string hace estallar a `join`: también debe degradar a 0',
    );
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

// ---------------------------------------------------------------------------
// RENDER (D-22 / D-23) — el conteo pintado en la cabecera de SessionTable.
//
// TODOS los tests de render inyectan `inboxCountFn` SIEMPRE. Sin esa inyección, `App` caería
// al default real y leería el `~/.kodo/inbox.md` del desarrollador que ejecute la suite
// (RESEARCH §Pitfall 8) — el test dejaría de ser hermético.
//
// Los siete ficheros de test de dashboard existentes NO se tocan (cambio quirúrgico): siguen
// verdes porque sus asserts son de COINCIDENCIA PARCIAL (`assert.match`) y el default de la
// prop `inboxOpen` en SessionTable es 0. Consecuencia conocida y aceptada: esos siete SÍ leen
// el inbox real del desarrollador, sin efecto sobre sus asserts.
// ---------------------------------------------------------------------------

/**
 * Fake clock determinista para el re-arme del tick de `usePoll` (molde de
 * test/dashboard-status-line.test.js:39-80 — el repo no usa helpers cross-test).
 */
function makeFakeClock(startMs = 1_000_000) {
  /** @type {Array<{ handle: number, fn: Function }>} */
  let pending = [];
  let nextHandle = 1;
  let nowMs = startMs;
  const schedule = (fn) => {
    const handle = nextHandle++;
    pending.push({ handle, fn });
    return handle;
  };
  const cancel = (handle) => {
    pending = pending.filter((p) => p.handle !== handle);
  };
  let nextTimeoutHandle = 10000;
  return {
    schedule,
    cancel,
    scheduleTimeout: () => nextTimeoutHandle++,
    cancelTimeout: () => {},
    flushTick: async () => {
      const entry = pending.pop();
      if (!entry) return false;
      await entry.fn();
      return true;
    },
    now: () => nowMs,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

/** Response-like mínimo (forma del fetch que consume client.js). */
function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

/** Drena la cola de microtasks (kick-off + setState/re-render que ink agenda). */
async function drain() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * Props de inyección de `App`. `inboxCountFn` va SIEMPRE, con el conteo fijado por el test.
 *
 * @param {ReturnType<makeFakeClock>} clock
 * @param {number} inboxOpen — lo que devuelve el leaf inyectado
 */
function injectProps(clock, inboxOpen) {
  return {
    baseUrl: 'http://localhost:9090',
    fetchFn: async () => okResponse({ sessions: [{}, {}, {}], count: 3 }),
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    scheduleTimeout: clock.scheduleTimeout,
    cancelTimeout: clock.cancelTimeout,
    inboxCountFn: () => inboxOpen,
  };
}

/**
 * Renderiza `App` con el conteo inyectado y devuelve el último frame ya drenado.
 *
 * @param {number} inboxOpen
 * @returns {Promise<string>}
 */
async function frameWithCount(inboxOpen) {
  const clock = makeFakeClock();
  const { lastFrame, unmount } = render(createElement(App, injectProps(clock, inboxOpen)));
  try {
    await drain();
    return lastFrame() ?? '';
  } finally {
    unmount();
  }
}

/** Props mínimas de un render DIRECTO de SessionTable (molde de dashboard-table.test.js:926-939). */
const TABLE_BASE = {
  rows: [],
  selectedIndex: -1,
  counts: { running: 3, review: 1, done: 0, error: 0, zombie: 0 },
  connected: true,
  lastGoodCount: 0,
  lastGoodAt: 1,
  lastAttemptAt: 1,
  mode: 'list',
};

/**
 * Primera línea (la cabecera) de un render DIRECTO de SessionTable.
 *
 * @param {Record<string, unknown>} extra
 * @returns {string}
 */
function tableHeaderLine(extra) {
  const { lastFrame, unmount } = render(createElement(SessionTable, { ...TABLE_BASE, ...extra }));
  try {
    return (lastFrame() ?? '').split('\n')[0];
  } finally {
    unmount();
  }
}

describe('CAPT-07 · D-22: el conteo se pinta en la cabecera', () => {
  it('poblado: con 4, el frame trae la copy Y el indicador sigue ANTES en la misma línea', async () => {
    const frame = await frameWithCount(4);

    assert.match(frame, /4 sin enrutar/, `debe pintarse el conteo\n${frame}`);
    const headerLine = frame.split('\n').find((l) => l.includes('sin enrutar')) ?? '';
    assert.ok(headerLine.includes('● live'), `el indicador debe ir en la misma línea\n${frame}`);
    assert.ok(
      headerLine.indexOf('● live') < headerLine.indexOf('sin enrutar'),
      `el conteo va SIEMPRE el último, nunca antes del indicador\n${headerLine}`,
    );
  });

  it('zero-one-many: con 1 la copy es la misma, sin ninguna rama de plural', async () => {
    const frame = await frameWithCount(1);
    assert.match(frame, /1 sin enrutar/, `\`sin enrutar\` es invariante en español\n${frame}`);
    assert.doesNotMatch(frame, /1 sin enrutars|1 captura|1 pendiente/, 'cero variación de plural');
  });

  it('long-text: con 1500 el entero va CRUDO, sin separador de millares ni abreviación', async () => {
    const frame = await frameWithCount(1500);
    assert.match(frame, /1500 sin enrutar/, `entero decimal crudo\n${frame}`);
    assert.doesNotMatch(frame, /1\.500|1,500|1,5k|1\.5k/, 'cero formateo dependiente de locale');
  });
});

describe('CAPT-07 · D-23: con 0 no se emite nada', () => {
  it('el frame de App no contiene la copy ni un 0 en esa posición', async () => {
    const frame = await frameWithCount(0);
    assert.ok(!frame.includes('sin enrutar'), `prohibido \`0 sin enrutar\`\n${frame}`);
    assert.doesNotMatch(frame, /inbox vacío|inbox 0/, 'prohibido cualquier placeholder de vacío');
  });

  it('la cabecera con inboxOpen=0 es BYTE-IDÉNTICA a la cabecera sin la prop', () => {
    // La ausencia se comprueba contra la CABECERA DE REFERENCIA, no solo por ausencia de
    // subcadena: sin la prop, SessionTable cae a su default `inboxOpen = 0`, que es exactamente
    // la cabecera de antes de esta fase. Si el ternario emitiera algo en 0 —un `<Text>` vacío,
    // un espacio, un placeholder— estas dos líneas dejarían de coincidir byte a byte.
    const referencia = tableHeaderLine({});
    const conCero = tableHeaderLine({ inboxOpen: 0 });
    assert.equal(conCero, referencia, 'la cabecera en 0 debe quedar sin un byte de más');
    assert.ok(!referencia.includes('sin enrutar'), 'la cabecera de referencia no lleva la copy');

    // Y con N > 0 la cabecera SÍ cambia — el guard contra una igualdad trivial por render vacío.
    assert.notEqual(tableHeaderLine({ inboxOpen: 7 }), referencia);
  });
});

describe('CAPT-07 · backstop de overflow (84-UI-SPEC §UI Considerations)', () => {
  it('en terminal estrecho el indicador degradado conserva su posición y el conteo es lo que envuelve', () => {
    // `ink-testing-library` fija `columns` en un getter de 100 y no admite override, así que el
    // ancho se fija con un stdout propio pasado al `render` de ink (mismo contrato público).
    // Rama DEGRADADA del indicador (`⚠ server caído …`, la más larga) + countsLabel + conteo, a
    // 40 columnas: es el peor caso de la fila.
    class NarrowStdout extends EventEmitter {
      /** @param {number} cols */
      constructor(cols) {
        super();
        this.cols = cols;
        /** @type {string[]} */
        this.frames = [];
        this.write = (/** @type {string} */ frame) => {
          this.frames.push(frame);
        };
      }
      get columns() {
        return this.cols;
      }
    }

    const stdout = new NarrowStdout(40);
    const instance = inkRender(
      createElement(SessionTable, {
        ...TABLE_BASE,
        connected: false,
        lastGoodCount: 12,
        lastGoodAt: 1000,
        lastAttemptAt: 46000,
        inboxOpen: 4,
      }),
      // @ts-ignore — stdout de test, misma superficie que el WriteStream que ink consume
      { stdout, debug: true, exitOnCtrlC: false, patchConsole: false },
    );
    instance.unmount();

    const frame = stdout.frames[stdout.frames.length - 1] ?? '';
    const lines = frame.split('\n');
    assert.ok(
      lines[0].startsWith('⚠ server caído'),
      `el indicador conserva su posición al INICIO de la cabecera\n${frame}`,
    );
    // El conteo es el último hijo del <Box> de fila → es lo PRIMERO que ink ENVUELVE (word
    // wrap: `4 sin` en la 1ª línea, `enrutar` en la 2ª, con las columnas hermanas intercaladas
    // en medio). Envolver no es recortar: los dos fragmentos siguen enteros en el frame y no
    // aparece ninguna elipsis de truncado del conteo. Cero aritmética de anchos en producción.
    assert.ok(frame.includes('4 sin'), `el conteo no se recorta (1er fragmento)\n${frame}`);
    assert.ok(frame.includes('enrutar'), `el conteo no se recorta (2º fragmento)\n${frame}`);
    assert.ok(!frame.includes('4 sin…'), `el conteo nunca se trunca con elipsis\n${frame}`);
    // Y el indicador degradado tampoco se recorta: su texto sobrevive entero al envolverse.
    for (const fragmento of ['server caído', '12', 'sessions', 'retrying…']) {
      assert.ok(frame.includes(fragmento), `el indicador no se recorta: falta '${fragmento}'\n${frame}`);
    }
  });
});
