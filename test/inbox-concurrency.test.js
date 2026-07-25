// @ts-check
//
// test/inbox-concurrency.test.js — Phase 83 Plan 03 (D-21) + Plan 06 (GAP-1), el headline de
// CAPT-01 y de CAPT-03 criterio 3. Molde: test/gsd-lock-race.test.js.
//
// INTEGRATION con PROCESOS REALES + barrier file. Tres escenarios:
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
//   Escenario 3 (CAPT-03 crit 3, GAP-1 — Plan 06) — «captura concurrente con la ventana POR
//   ENCIMA de cualquier presupuesto»: hermano del escenario 2, con el hold subido a
//   OVER_BUDGET_WINDOW_MS. Ése es exactamente el hold con el que el verificador de la fase
//   destruyó 6 de 6 capturas —con exit 0 en los 7 procesos— ANTES del guard compare-and-swap
//   del Plan 83-04. Es el caso que el escenario 2 dejó de cubrir cuando 83-03 subió el
//   presupuesto de reintentos, y el que decide si el invariante está cerrado DE VERDAD: con el
//   guard sobreviven 6 de 6; sin él, 0 de 6.
//
// GUARD DE COBERTURA DE LA RAMA FAIL-OPEN (Plan 06, WR-03). Los DOS escenarios mixtos leen
// `capture-branches.log` del sandbox —el marcador que cada hijo de captura escribe con la rama
// que tomó— y assertan que AL MENOS UNO entró por la rama fail-open en cada iteración. Sin este
// guard, subir el presupuesto del lock (o estrechar el hold) apaga la cobertura EN SILENCIO: el
// escenario sigue verde mientras deja de recorrer el código que perdía datos. No es hipotético
// — con la recalibración de 83-03 pasó: 18 de 18 hijos entraron por la rama coordinada.
//
// LIBERACIÓN EN DOS TIEMPOS de los escenarios mixtos (ver el JSDoc de `raceChildren`). El guard
// de cobertura destapó, en cuanto se añadió, un segundo agujero: con un único barrier los 6 hijos
// de captura podían tomar el lock ANTES que el marcado y terminar antes de que la ventana se
// abriera, con lo que el escenario no medía la colisión que dice medir (`coordinated=6,
// failopen=0`, en un subconjunto variable de iteraciones). Por eso el marcado se suelta primero y
// el resto espera a que el lock esté tomado. Es lo contrario de enmascarar: hace SEGURA la
// carrera que antes dependía del scheduler. No se toca ni el hold, ni el número de hijos, ni
// ninguna aserción.
//
// DISCIPLINA DE ASERCIÓN (heredada de test/gsd-lock-race.test.js:8): se asserta sobre el
// AGREGADO —cuántas líneas hay, cuáles sobreviven—, JAMÁS sobre qué proceso gana la carrera. Un
// test que dependa del orden de los ganadores es un test de scheduling, no de corrección.
//
// ⚠ PROHIBIDO ENMASCARAR (D-03, precedente DEBT-04 de Phase 82). Si un escenario mixto se pone
// rojo, el ÚNICO arreglo admitido es corregir el invariante en producción (`src/inbox/store.js`,
// el RMW de `markCapture` y su guard compare-and-swap).
// Subir el presupuesto de reintentos del lock de `appendCapture` FUE una respuesta admitida
// hasta el Plan 83-06 y queda ELIMINADA de esta lista: no cierra nada —con un hold de 1500 ms la
// pérdida vuelve a ser total, medida— y es literalmente el enmascaramiento que
// `83-VERIFICATION.md` señala y que DEBT-04 prohíbe por nombre.
// NUNCA: relajar la aserción, reducir el número de hijos, bajar el hold de la ventana, subir el
// timeout hasta que pase, omitir el caso ni envolverlo en reintentos. Y borrar el guard de
// cobertura es esa misma jugada con otro nombre. Una carrera que se pone verde enmascarándola
// deja de ser evidencia de nada.
//
// ⚠ AISLAMIENTO (RESEARCH §Pitfall 5): todo hijo se lanza con `HOME` apuntando al sandbox del
// test y el harness importa `src/inbox/store.js` DINÁMICAMENTE y DESPUÉS de esa fijación. Un
// import estático en el hijo escribiría en el `~/.kodo/inbox.md` REAL del operador. Los paths
// del fixture se construyen aquí con `join(sandbox, '.kodo', …)`: ninguna aserción depende de
// `defaultInboxPaths()` resuelto en el padre.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

/**
 * Ancho de la ventana lectura→rename del ESCENARIO 3, en ms.
 *
 * 1500 ms no es un número redondo elegido al azar: es el hold con el que el verificador de la
 * fase reprodujo la destrucción de 6 de 6 capturas (`83-VERIFICATION.md`, truth 3) usando este
 * mismo harness, y con el que el Plan 83-04 midió el antes/después de su guard (0 de 6 → 6 de 6).
 *
 * Está deliberadamente POR ENCIMA de CUALQUIER presupuesto de reintentos del lock: del default
 * de la primitiva (8 × 20 ms ≈ 160 ms) y también del presupuesto elevado que 83-03 introdujo
 * (~1000 ms) y que 83-04 revirtió. Ésa es la propiedad que hace al escenario válido: ningún
 * ajuste temporal del lock puede sacar a las capturas de la ventana.
 *
 * ⚠ ESTE VALOR NO SE BAJA. Bajarlo devuelve el escenario al terreno donde el arreglo antiguo —el
 * que NO cerraba el lost-update— ya pasaba, y entonces el caso deja de probar lo que dice probar.
 */
const OVER_BUDGET_WINDOW_MS = 1500;

/**
 * Iteraciones del escenario 3. Tres, no cinco: el hold domina el tiempo de pared (1,5 s por
 * iteración solo de ventana), y tres repeticiones ya descartan una coincidencia de scheduling
 * — que es el estándar heredado de Phase 82: una carrera que pasa UNA vez no prueba nada.
 */
const OVER_BUDGET_ITERATIONS = 3;

let sandbox;

/** Crea un sandbox nuevo y devuelve sus paths. Nunca se usa `defaultInboxPaths()` aquí. */
function newSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'kodo-inbox-race-'));
  return {
    dir,
    kodoDir: join(dir, '.kodo'),
    inboxPath: join(dir, '.kodo', 'inbox.md'),
    // `INBOX_LOCK_FILENAME` del store. Se construye aquí, como el resto de paths del fixture, en
    // vez de resolverlo con `defaultInboxPaths()` en el padre (misma disciplina de aislamiento).
    lockPath: join(dir, '.kodo', 'inbox.lock'),
  };
}

/** Espera acotada, no bloqueante, hasta que `pred()` sea cierto. Devuelve si llegó a serlo. */
async function waitUntil(pred, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 2));
  }
  return pred();
}

/**
 * Lanza N hijos del harness compartido con un barrier común y resuelve con sus verdicts.
 *
 * **Liberación en DOS TIEMPOS (`gate`) — por qué existe.** Con un único barrier, los 7 hijos de
 * un escenario mixto compiten por el lock a la vez y la carrera la decide el scheduler: si los 6
 * hijos de captura lo toman antes que el marcado, terminan ANTES de que la ventana
 * lectura→rename llegue a abrirse y el escenario que dice medir «captura DURANTE el marcado» no
 * mide nada — todas se coordinan y el fail-open no se ejercita. Está MEDIDO, no supuesto: el
 * guard de cobertura de este plan lo puso rojo en el acto (`coordinated=6, failopen=0`) en un
 * subconjunto variable de iteraciones.
 *
 * Con `gate`, el hijo de cabeza (índice 0, el marcado) se suelta primero y el resto NO se suelta
 * hasta que `gate.ready()` confirma que el lock del inbox está tomado, es decir hasta que el
 * marcado está DENTRO de su sección crítica. La colisión pasa de accidental a segura. Esto
 * ENDURECE el escenario: no relaja ninguna aserción, no toca el hold ni el número de hijos — solo
 * garantiza que la carrera que el test dice ejecutar se ejecuta de verdad.
 *
 * `gate.fired` queda a `true` si la confirmación llegó dentro del margen; el llamante lo assertá.
 * Pasado el margen se suelta igualmente al resto: dejar hijos colgados enmascararía el fallo.
 *
 * @param {string[][]} argvs — un array de argv por hijo (sin el path del harness)
 * @param {string} home — el sandbox que cada hijo verá como `HOME`
 * @param {string} goFile — el barrier compartido
 * @param {{ leadGoFile: string, ready: () => boolean, fired?: boolean }} [gate]
 * @returns {Promise<string[]>}
 */
async function raceChildren(argvs, home, goFile, gate) {
  const outputs = new Array(argvs.length).fill('');
  const children = argvs.map((argv, i) => {
    const barrier = gate && i === 0 ? gate.leadGoFile : goFile;
    const child = spawn(process.execPath, [CHILD, ...argv, '--barrier', barrier], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, HOME: home },
    });
    child.stdout.on('data', (d) => {
      outputs[i] += d.toString();
    });
    return child;
  });

  const done = Promise.all(children.map((c) => new Promise((resolve) => c.on('close', resolve))));
  if (gate) {
    writeFileSync(gate.leadGoFile, '1');
    // Margen holgado y acotado: solo cubre el arranque del hijo de cabeza (spawn + import
    // dinámico + acquire), nunca el hold, que empieza después.
    gate.fired = await waitUntil(gate.ready, 4000);
  }
  // El resto ya está vivo y spinning sobre el barrier: soltarlos a la vez maximiza la contención.
  writeFileSync(goFile, '1');
  return done.then(() => outputs.map((o) => o.trim()));
}

/** El id determinista que el harness escribe para el hijo de índice `idx` (`--kind capture`). */
function captureId(idx) {
  return 'cap' + String(idx).padStart(3, '0');
}

/**
 * Recuento por rama del marcador cross-proceso que los hijos `capture` dejan en el sandbox
 * (`capture-branches.log`, una línea por hijo: `coordinated` o `failopen`).
 *
 * NEVER-THROWS: si el fichero no existe devuelve ceros, y entonces el guard de cobertura falla
 * con su mensaje — que es la reacción correcta, porque un marcador ausente significa que el
 * escenario dejó de medir la rama.
 *
 * @param {string} dir — la raíz del sandbox (la misma que se pasa a los hijos como `--sandbox`)
 * @returns {{ coordinated: number, failopen: number }}
 */
function readBranchCounts(dir) {
  const counts = { coordinated: 0, failopen: 0 };
  let raw = '';
  try {
    raw = readFileSync(join(dir, 'capture-branches.log'), 'utf-8');
  } catch {
    return counts;
  }
  for (const line of raw.split('\n')) {
    const v = line.trim();
    if (v === 'coordinated') counts.coordinated++;
    else if (v === 'failopen') counts.failopen++;
  }
  return counts;
}

/**
 * GUARD DE COBERTURA (Plan 06, WR-03) — se aplica a los DOS escenarios mixtos.
 *
 * Es determinista y NO depende del scheduling, por DOS propiedades que van juntas:
 *   1. la liberación en dos tiempos de `raceChildren` no suelta a los hijos de captura hasta que
 *      el marcado tiene el lock tomado, así que todos arrancan DENTRO de la ventana; y
 *   2. el hold de ambos escenarios mixtos (300 ms y 1500 ms) está por encima del presupuesto por
 *      defecto de la primitiva (8 × 20 ms ≈ 160 ms), así que un hijo que arranca dentro de la
 *      ventana agota su presupuesto sí o sí y cae al fail-open.
 * Si alguna de las dos dejara de ser cierta, ése es EXACTAMENTE el cambio que este guard existe
 * para detectar.
 *
 * @param {string} dir — la raíz del sandbox de esta iteración
 * @param {string} ctx — el contexto de fallo de la iteración (verdicts + inbox íntegro)
 */
function assertFailopenExercised(dir, ctx) {
  const branches = readBranchCounts(dir);
  assert.ok(
    branches.failopen >= 1,
    'COBERTURA PERDIDA: ninguna de las capturas de esta iteración entró por la rama fail-open ' +
      `(coordinated=${branches.coordinated}, failopen=${branches.failopen}). ` +
      'Este escenario existe para ejercitar el camino que PERDÍA datos: si todas las capturas ' +
      'se coordinan, sigue verde sin probar nada — que es lo que pasó con la recalibración de ' +
      '83-03 (18/18 coordinadas). El arreglo es revisar el presupuesto de reintentos del lock o ' +
      'el ancho del hold, JAMÁS borrar ni relajar esta aserción.\n' +
      ctx,
  );
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
        // `--sandbox` es lo que hace que cada hijo registre su rama en `capture-branches.log`:
        // sin él el guard de cobertura de abajo no tendría nada que leer.
        for (let i = 0; i < N; i++)
          argvs.push(['--kind', 'capture', '--idx', String(i), '--sandbox', s.dir]);

        // Liberación en dos tiempos: las capturas no salen hasta que el marcado tiene el lock.
        const gate = { leadGoFile: join(s.dir, 'go-mark'), ready: () => existsSync(s.lockPath) };
        const verdicts = await raceChildren(argvs, s.dir, join(s.dir, 'go'), gate);
        const raw = readFileSync(s.inboxPath, 'utf-8');
        const ctx = `iteración ${iter}/${MIXED_ITERATIONS}\nverdicts: ${JSON.stringify(verdicts)}\n--- inbox ---\n${raw}`;

        assert.ok(
          gate.fired,
          `el marcado no llegó a tomar el lock dentro del margen: la carrera NO se produjo, así que esta iteración no es evidencia de nada.\n${ctx}`,
        );

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

        // 5. La rama fail-open se ejercitó de verdad (guard de cobertura, WR-03).
        assertFailopenExercised(s.dir, ctx);

        // 6. Cero residuo de temporales del marcado.
        const residues = readdirSync(s.kodoDir).filter((f) => f.includes('.tmp.'));
        assert.deepEqual(residues, [], `residuo de ficheros temporales.\n${ctx}`);

        rmSync(s.dir, { recursive: true, force: true });
        sandbox = undefined;
      }
    },
  );

  it(
    `escenario 3 — captura concurrente con la ventana POR ENCIMA de cualquier presupuesto (${OVER_BUDGET_WINDOW_MS} ms), ×${OVER_BUDGET_ITERATIONS} (CAPT-03 crit 3, GAP-1)`,
    { timeout: 180_000 },
    async () => {
      const N = 6;

      // Mismo molde de fixture BYTE-EXACTO que el escenario 2: la captura a marcar, una captura
      // que debe quedar intacta, un heading que no parsea y una nota a mano que tampoco parsea.
      const LINE_TO_MARK = '- [ ] seed01 · captura semilla a marcar · kodo-race · 2026-01-15 · cli';
      const LINE_INTACT = '- [ ] seed02 · captura semilla intacta · kodo-race · 2026-01-15 · cli';
      const LINE_HEADING = '## Notas sueltas del operador';
      const LINE_HANDWRITTEN = '  - recordar: esto lo escribí a mano y NO es una captura';
      const FOREIGN = [LINE_INTACT, LINE_HEADING, LINE_HANDWRITTEN];
      const FIXTURE =
        [LINE_TO_MARK, LINE_INTACT, LINE_HEADING, LINE_HANDWRITTEN].join('\n') + '\n';

      for (let iter = 1; iter <= OVER_BUDGET_ITERATIONS; iter++) {
        const s = newSandbox();
        sandbox = s.dir;
        mkdirSync(s.kodoDir, { recursive: true });
        writeFileSync(s.inboxPath, FIXTURE);

        const argvs = [
          // El hold desborda TODO presupuesto de reintentos: las 6 capturas caen al fail-open y
          // aterrizan dentro de la ventana lectura→rename del marcado.
          [
            '--kind',
            'mark',
            '--id',
            'seed01',
            '--hold',
            String(OVER_BUDGET_WINDOW_MS),
            '--dest',
            '999.4',
          ],
        ];
        for (let i = 0; i < N; i++)
          argvs.push(['--kind', 'capture', '--idx', String(i), '--sandbox', s.dir]);

        // Liberación en dos tiempos: las 6 capturas salen SOLO cuando el marcado ya tiene el
        // lock, así que aterrizan dentro de la ventana con certeza, no por suerte del scheduler.
        const gate = { leadGoFile: join(s.dir, 'go-mark'), ready: () => existsSync(s.lockPath) };
        const verdicts = await raceChildren(argvs, s.dir, join(s.dir, 'go'), gate);
        const raw = readFileSync(s.inboxPath, 'utf-8');
        const ctx = `iteración ${iter}/${OVER_BUDGET_ITERATIONS} · hold ${OVER_BUDGET_WINDOW_MS} ms\nverdicts: ${JSON.stringify(verdicts)}\n--- inbox ---\n${raw}`;

        assert.ok(
          gate.fired,
          `el marcado no llegó a tomar el lock dentro del margen: la carrera NO se produjo, así que esta iteración no es evidencia de nada.\n${ctx}`,
        );

        assert.equal(verdicts[0], 'written', `el marcado debe completar.\n${ctx}`);
        assert.deepEqual(
          verdicts.slice(1),
          new Array(N).fill('written'),
          `toda captura debe reportar \`written\`.\n${ctx}`,
        );

        const lines = raw.split('\n');
        const { captures } = listCaptures({ inboxPath: s.inboxPath });
        const byId = new Map(captures.map((c) => [c.id, c]));

        // 1. LA ASERCIÓN QUE DECIDE EL GAP. Sin el guard compare-and-swap del Plan 83-04 aquí
        //    sobreviven 0 de 6: los 7 procesos reportan éxito y el rename del marcado borra las
        //    seis capturas. Medido, no supuesto (`83-VERIFICATION.md`, truth 3).
        for (let i = 0; i < N; i++) {
          const c = byId.get(captureId(i));
          assert.ok(
            c,
            `captura ${captureId(i)} PERDIDA por el RMW del marcado con la ventana por encima del presupuesto.\n${ctx}`,
          );
          assert.equal(c.open, true, `la captura ${captureId(i)} debe seguir abierta.\n${ctx}`);
          assert.equal(c.text, 'captura concurrente ' + i, `texto alterado.\n${ctx}`);
        }

        // 2. El marcado completó y conserva su identidad completa.
        const marked = byId.get('seed01');
        assert.ok(marked, `la captura marcada desapareció del fichero.\n${ctx}`);
        assert.equal(marked.open, false, `seed01 debe quedar cerrada.\n${ctx}`);
        assert.equal(marked.estado, 'enrutada', `seed01 debe quedar enrutada.\n${ctx}`);
        assert.equal(marked.dest, '999.4', `seed01 debe conservar su trace pointer.\n${ctx}`);
        assert.equal(marked.text, 'captura semilla a marcar', `texto alterado.\n${ctx}`);
        assert.equal(marked.tag, 'kodo-race', `tag alterado.\n${ctx}`);
        assert.equal(marked.date, '2026-01-15', `fecha alterada.\n${ctx}`);
        assert.equal(marked.origin, 'cli', `origen alterado.\n${ctx}`);

        // 3. Toda línea ajena sobrevive BYTE A BYTE (D-04) AUNQUE el RMW se haya rehecho.
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

        // 4. Total de líneas de captura: la marcada + la semilla intacta + las N nuevas. Las
        //    líneas vacías intercaladas (degradación benigna de D-02) están permitidas.
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

        // 5. La rama fail-open se ejercitó de verdad (guard de cobertura, WR-03).
        assertFailopenExercised(s.dir, ctx);

        // 6. Cero residuo de temporales, incluso habiendo rehecho el RMW: cada intento
        //    descartado tiene que haber borrado el suyo.
        const residues = readdirSync(s.kodoDir).filter((f) => f.includes('.tmp.'));
        assert.deepEqual(residues, [], `residuo de ficheros temporales.\n${ctx}`);

        rmSync(s.dir, { recursive: true, force: true });
        sandbox = undefined;
      }
    },
  );
});
