// @ts-check
//
// test/inbox-concurrency.test.js — Phase 83 Plan 03 (D-21), el headline de CAPT-01 y de
// CAPT-03 criterio 3. Molde: test/gsd-lock-race.test.js.
//
// INTEGRATION con PROCESOS REALES + barrier file. Dos escenarios:
//
//   Escenario 1 (CAPT-01, D-21.1) — «append atómico bajo concurrencia (N → N líneas, cero
//   pérdidas)»: 8 procesos `capture` liberados a la vez producen exactamente 8 líneas, ninguna
//   partida, los 8 ids presentes y distintos.
//
//   Escenario 2 (CAPT-03 crit 3, D-21.2 — EL que justifica D-01) — «una captura concurrente
//   durante el marcado nunca se pierde»: 1 proceso `mark` mantiene abierta la ventana
//   lectura→rename (seam `_afterReadFn` de 83-01) mientras 6 procesos `capture` appendean. El
//   fichero final contiene las 6 líneas nuevas MÁS la línea marcada con su estado, y toda línea
//   ajena sobrevive BYTE A BYTE (D-04) — incluidas las que no parsean.
//
// DISCIPLINA DE ASERCIÓN (heredada de test/gsd-lock-race.test.js:8): se asserta sobre el
// AGREGADO —cuántas líneas hay, cuáles sobreviven—, JAMÁS sobre qué proceso gana la carrera. Un
// test que dependa del orden de los ganadores es un test de scheduling, no de corrección.
//
// ⚠ PROHIBIDO ENMASCARAR (D-03, precedente DEBT-04 de Phase 82). Si el escenario 2 se pone rojo,
// el arreglo admitido es UNO de estos dos, ambos en producción:
//   (a) subir el presupuesto de reintentos del lock en `appendCapture` (`src/inbox/store.js`), o
//   (b) corregir el RMW de `markCapture`.
// NUNCA: relajar la aserción, reducir el número de hijos, bajar el hold de la ventana, subir el
// timeout hasta que pase, marcar el caso como `.skip` ni envolverlo en reintentos. Una carrera
// que se pone verde enmascarándola deja de ser evidencia de nada.
//
// ⚠ AISLAMIENTO (RESEARCH §Pitfall 5): todo hijo se lanza con `HOME` apuntando al sandbox del
// test y el harness importa `src/inbox/store.js` DINÁMICAMENTE y DESPUÉS de esa fijación. Un
// import estático en el hijo escribiría en el `~/.kodo/inbox.md` REAL del operador. Los paths
// del fixture se construyen aquí con `join(sandbox, '.kodo', …)`: ninguna aserción depende de
// `defaultInboxPaths()` resuelto en el padre.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listCaptures, parseLine } from '../src/inbox/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD = join(__dirname, 'helpers', 'lock-race-child.mjs');

/** Ancho de la ventana lectura→rename que el hijo `mark` mantiene abierta, en ms.
 *  Deliberadamente POR ENCIMA del presupuesto de reintentos por defecto de `acquireLock`
 *  (8 × 20 ms ≈ 160 ms): así los hijos de captura viven la contención de verdad. */
const WINDOW_MS = 300;

/** Iteraciones del escenario mixto. Una carrera que pasa UNA vez no prueba nada (Phase 82). */
const MIXED_ITERATIONS = 5;

let sandbox;

/** Crea un sandbox nuevo y devuelve sus paths. Nunca se usa `defaultInboxPaths()` aquí. */
function newSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'kodo-inbox-race-'));
  return { dir, kodoDir: join(dir, '.kodo'), inboxPath: join(dir, '.kodo', 'inbox.md') };
}

/**
 * Lanza N hijos del harness compartido con un barrier común y resuelve con sus verdicts.
 *
 * @param {string[][]} argvs — un array de argv por hijo (sin el path del harness)
 * @param {string} home — el sandbox que cada hijo verá como `HOME`
 * @param {string} goFile — el barrier compartido
 * @returns {Promise<string[]>}
 */
function raceChildren(argvs, home, goFile) {
  const outputs = new Array(argvs.length).fill('');
  const children = argvs.map((argv, i) => {
    const child = spawn(process.execPath, [CHILD, ...argv, '--barrier', goFile], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, HOME: home },
    });
    child.stdout.on('data', (d) => {
      outputs[i] += d.toString();
    });
    return child;
  });

  const done = Promise.all(children.map((c) => new Promise((resolve) => c.on('close', resolve))));
  // Todos los hijos ya están vivos y spinning sobre el barrier: soltarlos a la vez maximiza la
  // contención real.
  writeFileSync(goFile, '1');
  return done.then(() => outputs.map((o) => o.trim()));
}

/** El id determinista que el harness escribe para el hijo de índice `idx` (`--kind capture`). */
function captureId(idx) {
  return 'cap' + String(idx).padStart(3, '0');
}

describe('Phase 83 Plan 03: concurrencia real del inbox (D-21)', () => {
  afterEach(() => {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    sandbox = undefined;
  });

  it('escenario 1 — 8 capturas concurrentes producen 8 líneas, cero pérdidas (CAPT-01, D-21.1)', async () => {
    const s = newSandbox();
    sandbox = s.dir;
    mkdirSync(s.kodoDir, { recursive: true });

    const N = 8;
    const argvs = [];
    for (let i = 0; i < N; i++) argvs.push(['--kind', 'capture', '--idx', String(i)]);

    const verdicts = await raceChildren(argvs, s.dir, join(s.dir, 'go'));
    assert.deepEqual(
      verdicts,
      new Array(N).fill('written'),
      'todo hijo de captura debe reportar `written`: la captura hace fail-open, nunca se rinde',
    );

    const raw = readFileSync(s.inboxPath, 'utf-8');
    const lines = raw.split('\n');

    // Cero líneas partidas: toda línea NO vacía tiene que parsear. Una línea vacía intercalada es
    // la degradación benigna documentada (dos escritores anteponiendo newline a la vez).
    for (const line of lines) {
      if (line.trim() === '') continue;
      assert.notEqual(
        parseLine(line),
        null,
        `línea partida o corrupta en el inbox:\n${JSON.stringify(line)}\n--- fichero ---\n${raw}`,
      );
    }

    const { captures, unparsed } = listCaptures({ inboxPath: s.inboxPath });
    assert.equal(unparsed, 0, `ninguna línea debe quedar sin parsear:\n${raw}`);
    assert.equal(captures.length, N, `se esperaban ${N} capturas:\n${raw}`);
    assert.equal(
      captures.filter((c) => c.open).length,
      N,
      'las 8 capturas quedan ABIERTAS: nadie las cerró',
    );

    const ids = captures.map((c) => c.id).sort();
    const expected = [];
    for (let i = 0; i < N; i++) expected.push(captureId(i));
    assert.deepEqual(ids, expected.sort(), `los 8 ids deterministas deben estar presentes:\n${raw}`);
    assert.equal(new Set(ids).size, N, 'los 8 ids son distintos entre sí');
  });

  it(
    `escenario 2 — captura concurrente DURANTE el marcado: cero pérdidas y preservación byte a byte, ×${MIXED_ITERATIONS} (CAPT-03 crit 3, D-21.2)`,
    { timeout: 180_000 },
    async () => {
      const N = 6;

      // Fixture BYTE-EXACTO de 4 líneas: la captura a marcar, una captura que debe quedar
      // intacta, un heading que no parsea y una nota escrita a mano que tampoco parsea.
      const LINE_TO_MARK = '- [ ] seed01 · captura semilla a marcar · kodo-race · 2026-01-15 · cli';
      const LINE_INTACT = '- [ ] seed02 · captura semilla intacta · kodo-race · 2026-01-15 · cli';
      const LINE_HEADING = '## Notas sueltas del operador';
      const LINE_HANDWRITTEN = '  - recordar: esto lo escribí a mano y NO es una captura';
      const FOREIGN = [LINE_INTACT, LINE_HEADING, LINE_HANDWRITTEN];
      const FIXTURE =
        [LINE_TO_MARK, LINE_INTACT, LINE_HEADING, LINE_HANDWRITTEN].join('\n') + '\n';

      for (let iter = 1; iter <= MIXED_ITERATIONS; iter++) {
        const s = newSandbox();
        sandbox = s.dir;
        mkdirSync(s.kodoDir, { recursive: true });
        writeFileSync(s.inboxPath, FIXTURE);

        const argvs = [
          // El marcado primero: mantiene abierta la ventana lectura→rename durante WINDOW_MS.
          ['--kind', 'mark', '--id', 'seed01', '--hold', String(WINDOW_MS), '--dest', '999.4'],
        ];
        for (let i = 0; i < N; i++) argvs.push(['--kind', 'capture', '--idx', String(i)]);

        const verdicts = await raceChildren(argvs, s.dir, join(s.dir, 'go'));
        const raw = readFileSync(s.inboxPath, 'utf-8');
        const ctx = `iteración ${iter}/${MIXED_ITERATIONS}\nverdicts: ${JSON.stringify(verdicts)}\n--- inbox ---\n${raw}`;

        // El marcado NO hace fail-open (contrato 3): si reporta `failed` el escenario no llegó a
        // producirse, y eso NO se enmascara — se surfacea.
        assert.equal(verdicts[0], 'written', `el marcado debe completar.\n${ctx}`);
        assert.deepEqual(
          verdicts.slice(1),
          new Array(N).fill('written'),
          `toda captura debe reportar \`written\`.\n${ctx}`,
        );

        const lines = raw.split('\n');
        const { captures } = listCaptures({ inboxPath: s.inboxPath });
        const byId = new Map(captures.map((c) => [c.id, c]));

        // 1. Las N capturas nuevas están TODAS — el invariante literal del criterio 3.
        for (let i = 0; i < N; i++) {
          const c = byId.get(captureId(i));
          assert.ok(c, `captura ${captureId(i)} PERDIDA por el RMW del marcado.\n${ctx}`);
          assert.equal(c.open, true, `la captura ${captureId(i)} debe seguir abierta.\n${ctx}`);
          assert.equal(c.text, 'captura concurrente ' + i, `texto alterado.\n${ctx}`);
        }

        // 2. La línea marcada está cerrada y conserva su identidad completa.
        const marked = byId.get('seed01');
        assert.ok(marked, `la captura marcada desapareció del fichero.\n${ctx}`);
        assert.equal(marked.open, false, `seed01 debe quedar cerrada.\n${ctx}`);
        assert.equal(marked.estado, 'enrutada', `seed01 debe quedar enrutada.\n${ctx}`);
        assert.equal(marked.dest, '999.4', `seed01 debe conservar su trace pointer.\n${ctx}`);
        assert.equal(marked.text, 'captura semilla a marcar', `texto alterado.\n${ctx}`);
        assert.equal(marked.tag, 'kodo-race', `tag alterado.\n${ctx}`);
        assert.equal(marked.date, '2026-01-15', `fecha alterada.\n${ctx}`);
        assert.equal(marked.origin, 'cli', `origen alterado.\n${ctx}`);

        // 3. Toda línea ajena sobrevive BYTE A BYTE (D-04), incluidas las que no parsean.
        for (const foreign of FOREIGN) {
          assert.ok(
            lines.includes(foreign),
            `línea ajena reescrita o perdida:\n${JSON.stringify(foreign)}\n${ctx}`,
          );
        }
        assert.equal(
          lines.filter((l) => l === LINE_TO_MARK).length,
          0,
          `la línea marcada debe haberse sustituido, no duplicado.\n${ctx}`,
        );

        // 4. Total de líneas de captura: la marcada + las N nuevas + la semilla intacta.
        //    Las líneas vacías intercaladas (degradación benigna de D-02) están permitidas.
        assert.equal(
          captures.length,
          N + 2,
          `se esperaban ${N + 2} líneas de captura (seed01 + seed02 + ${N} nuevas).\n${ctx}`,
        );
        for (const line of lines) {
          if (line.trim() === '') continue;
          assert.ok(
            parseLine(line) !== null || FOREIGN.includes(line),
            `línea partida o corrupta:\n${JSON.stringify(line)}\n${ctx}`,
          );
        }

        // 5. Cero residuo de temporales del marcado.
        const residues = readdirSync(s.kodoDir).filter((f) => f.includes('.tmp.'));
        assert.deepEqual(residues, [], `residuo de ficheros temporales.\n${ctx}`);

        rmSync(s.dir, { recursive: true, force: true });
        sandbox = undefined;
      }
    },
  );
});
