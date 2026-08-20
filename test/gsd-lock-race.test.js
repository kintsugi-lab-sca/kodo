// @ts-check
//
// test/gsd-lock-race.test.js — Phase 70 Plan 01, THE Criterion 1 headline.
//
// INTEGRATION: two (and five) real child processes race acquireGsdLock against
// the SAME repo with a shared `go` barrier. Exactly one must print `acquired` —
// the audit's literal success criterion for the atomic (flag:'wx') create path.
// Asserts on the AGGREGATE, never on which child wins. Sandbox per test.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD = join(__dirname, 'helpers', 'lock-race-child.mjs');

let sandbox;
let repoDir;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'kodo-gsd-race-'));
  repoDir = join(sandbox, 'repo');
  // A bare repo dir is enough — acquireGsdLock creates .planning/ itself.
  writeFileSync(join(sandbox, '.keep'), '');
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Spawn N children racing acquireGsdLock for `repoDir`, release via `go`,
 * resolve with stdout verdicts.
 * @param {number} count
 * @returns {Promise<string[]>}
 */
function raceGsdChildren(count) {
  mkdirSync(repoDir, { recursive: true });
  const goFile = join(sandbox, 'go');
  const children = [];
  const outputs = new Array(count).fill('');

  for (let i = 0; i < count; i++) {
    const child = spawn(
      process.execPath,
      [CHILD, '--kind', 'gsd', '--repo', repoDir, '--barrier', goFile, '--hold', '500'],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    child.stdout.on('data', (d) => {
      outputs[i] += d.toString();
    });
    children.push(child);
  }

  const done = Promise.all(
    children.map((c) => new Promise((resolve) => c.on('close', resolve))),
  );
  writeFileSync(goFile, '1');
  return done.then(() => outputs.map((o) => o.trim()));
}

/**
 * Seed a provably-STALE lock (dead holder PID) at `<repoDir>/.planning/.kodo.lock`,
 * then race N children racing acquireGsdLock. Every contender hits EEXIST and
 * observes the SAME dead-PID stale lock simultaneously → all take the steal path.
 * With `--hold`, the ONE steal-winner stays alive so losers see it live and reject.
 * @param {number} count
 * @returns {Promise<string[]>}
 */
function raceGsdStealDeadHolder(count) {
  mkdirSync(repoDir, { recursive: true });
  // Pre-seed a stale lock owned by a dead PID (99999999 — implausibly high,
  // matching the dead-PID convention in test/gsd-lock.test.js). acquireGsdLock
  // resolves the repo via realpathSync, so seed at the realpath'd location.
  const planning = join(realpathSync(repoDir), '.planning');
  mkdirSync(planning, { recursive: true });
  writeFileSync(
    join(planning, '.kodo.lock'),
    JSON.stringify(
      {
        session_id: 'crashed',
        task_id: 'crashed',
        task_ref: 'KL-crashed',
        pid: 99999999,
        acquired_at: new Date().toISOString(),
        ttl_hours: 4,
      },
      null,
      2,
    ) + '\n',
  );

  const goFile = join(sandbox, 'go');
  const children = [];
  const outputs = new Array(count).fill('');

  for (let i = 0; i < count; i++) {
    const child = spawn(
      process.execPath,
      [CHILD, '--kind', 'gsd', '--repo', repoDir, '--barrier', goFile, '--hold', '500'],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    child.stdout.on('data', (d) => {
      outputs[i] += d.toString();
    });
    children.push(child);
  }

  const done = Promise.all(
    children.map((c) => new Promise((resolve) => c.on('close', resolve))),
  );
  writeFileSync(goFile, '1');
  return done.then(() => outputs.map((o) => o.trim()));
}

describe('gsd lock race — real processes (Criterion 1)', () => {
  it('2 concurrent processes → exactly one acquired', async () => {
    const verdicts = await raceGsdChildren(2);
    const acquired = verdicts.filter((v) => v === 'acquired').length;
    assert.equal(
      acquired,
      1,
      `exactly one process must acquire; got: ${verdicts.join(',')}`,
    );
  });

  it('5 concurrent processes → exactly one acquired', async () => {
    const verdicts = await raceGsdChildren(5);
    const acquired = verdicts.filter((v) => v === 'acquired').length;
    assert.equal(
      acquired,
      1,
      `exactly one process must acquire; got: ${verdicts.join(',')}`,
    );
  });
});

describe('gsd lock steal race — concurrent dead-holder steal (CR-01)', () => {
  it('2 processes observing the SAME dead-PID stale lock → exactly one steals', async () => {
    const verdicts = await raceGsdStealDeadHolder(2);
    const acquired = verdicts.filter((v) => v === 'acquired').length;
    assert.equal(
      acquired,
      1,
      `exactly one process must steal a shared dead-PID lock; got: ${verdicts.join(',')}`,
    );
  });

  it('5 processes observing the SAME dead-PID stale lock → exactly one steals', async () => {
    const verdicts = await raceGsdStealDeadHolder(5);
    const acquired = verdicts.filter((v) => v === 'acquired').length;
    assert.equal(
      acquired,
      1,
      `exactly one process must steal a shared dead-PID lock; got: ${verdicts.join(',')}`,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Phase 86 Plan 02 (LOCK-05) — holder stale-pero-VIVO que LIBERA en plena sección
// crítica del steal. La carrera de SEGUNDO orden de `82-REVIEW.md` §CR-01, con
// procesos reales.
//
// Por qué el sesgo dead-PID de arriba no basta: un holder muerto no puede llamar a
// `releaseGsdLock`. Y sin ese `unlink` no se abre el hueco donde un creador Case-1
// —que salta el steal-guard por diseño— aterriza su `O_EXCL` create bajo los pies
// del stealer. Ésa es exactamente la ventana que el CAS de 86-01 vigila, y con un
// holder muerto es INVISIBLE.
//
// El `session_id` que el kind `gsd-holder` del harness siembra. Literal PAREADO con
// `test/helpers/lock-race-child.mjs`: el harness es un script que ejecuta `main()`
// al importarse, así que la constante no se puede importar sin lanzar un hijo.
const HOLDER_SESSION_ID = 'sess-live-holder';

/**
 * Espera acotada, no bloqueante, hasta que `pred()` sea cierto. Devuelve si llegó a
 * serlo. Copiado de `test/inbox-concurrency.test.js:133-140`.
 */
async function waitUntil(pred, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 2));
  }
  return pred();
}

/** El `session_id` del lock que hay AHORA en disco, o `null` si no hay lock legible. */
function readLockSession() {
  try {
    const raw = readFileSync(join(realpathSync(repoDir), '.planning', '.kodo.lock'), 'utf-8');
    return JSON.parse(raw).session_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Los `reason` que los stealers dejaron en el marcador lateral del sandbox
 * (`steal-reasons.log`, una línea por stealer con seam).
 *
 * NEVER-THROWS: si el fichero falta devuelve `[]`, y entonces el guard de cobertura
 * falla con su mensaje — que es la reacción correcta, porque un marcador ausente
 * significa que el escenario dejó de medir la rama. Molde de `readBranchCounts`
 * (`test/inbox-concurrency.test.js:210-224`).
 */
function readStealReasons(dir) {
  let raw = '';
  try {
    raw = readFileSync(join(dir, 'steal-reasons.log'), 'utf-8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Las barreras que VENCIERON en algún hijo (`barrier-timeouts.log`, una línea por
 * expiración). Mismo molde NEVER-THROWS que `readStealReasons`: fichero ausente =
 * ninguna venció, que es el caso sano.
 *
 * Existe porque una barrera vencida y una barrera cumplida eran indistinguibles
 * desde fuera: el hijo continuaba igual en los dos casos, así que una
 * desincronización de la orquestación producía el MISMO rojo que un fallo del
 * invariante del lock — con arreglos opuestos.
 */
function readBarrierTimeouts(dir) {
  let raw = '';
  try {
    raw = readFileSync(join(dir, 'barrier-timeouts.log'), 'utf-8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * GUARD DE COBERTURA DE LA RAMA DEL CAS (LOCK-05 c) — molde literal de
 * `assertFailopenExercised` (`test/inbox-concurrency.test.js:226-253`), con el
 * precedente MEDIDO de 83-06: sin un guard así, una edición futura de la
 * secuenciación deja el escenario verde mientras deja de recorrer el código que
 * produce el defecto. Perder la cobertura pasa a ser un fallo, no un silencio.
 */
function assertCasExercised(dir, ctx) {
  const reasons = readStealReasons(dir);
  const hits = reasons.filter((r) => r === 'lock-replaced-mid-steal').length;
  assert.ok(
    hits >= 1,
    'COBERTURA PERDIDA: ningún stealer de esta iteración recorrió la rama del ' +
      `compare-and-swap (reasons=[${reasons.join(',')}]). ` +
      'Este escenario existe para ejercitar el camino donde el rename destructivo ' +
      'clobbeaba a un creador Case-1 legítimo: si el stealer nunca entra ahí, sigue ' +
      'verde sin probar nada. La reacción CORRECTA es revisar la SECUENCIACIÓN de los ' +
      'tres tiempos (holder sembrado → stealer aparcado → extras → release → creador → ' +
      'resume), JAMÁS borrar ni relajar esta aserción, ni subir ningún umbral.\n' +
      ctx,
  );
}

/**
 * LAS CINCO SEÑALES QUE LA ORQUESTACIÓN MIDE, ASERTADAS (86-REVIEW §WR-05).
 *
 * El harness calculaba `parkedMs` y las etapas `released` / `creatorLanded` /
 * `reasons` y las TIRABA, asertando solo `seeded` y `parked`. Se aserta lo que ya
 * se mide: no relaja ningún umbral ni añade ninguno nuevo (D-16 / DEBT-04), solo
 * convierte en rojo explícito lo que antes era un escenario degradado en silencio.
 *
 * Cada aserción responde a un modo de fallo distinto:
 *  - `released`: el ÚNICO indicio de que el `unlink` del holder ocurrió de verdad.
 *    `holderVerdict === 'written'` NO lo prueba: `releaseGsdLock` es idempotente y
 *    NO-OP cuando el `session_id` en disco no casa (`src/gsd/lock.js:203-206`), así
 *    que `written` significa «la llamada no lanzó». Sin ese `unlink` no hay hueco,
 *    y sin hueco el escenario mide otra cosa.
 *  - `creatorLanded`: sin el `O_EXCL` del creador Case-1 no hay nada contra lo que
 *    el CAS pueda morder.
 *  - `reasons`: el marcador lateral llegó a escribirse; si no, `assertCasExercised`
 *    fallaría por marcador AUSENTE y no por rama no recorrida — dos causas muy
 *    distintas con el mismo rojo.
 *  - `parkedMs`: §Pitfall 8 y el supuesto A1 lo declaran restricción DURA. El techo
 *    real no lo pone el padre sino el `waitForBarrier(args.resume, 3000)` del hijo
 *    (`test/helpers/lock-race-child.mjs:406`); si esa espera VENCE, el stealer
 *    reanuda por su cuenta antes del release y el rojo resultante se leería como
 *    «el CAS no muerde» en vez de «la barrera venció». Y por encima de
 *    `STEAL_GUARD_STALE_MS = 5_000` el guard del aparcado sería rompible por edad,
 *    con lo que el escenario degradaría a medir la carrera de PRIMER orden que la
 *    Phase 82 ya cerró.
 *
 * @param {{ stages: Record<string, boolean>, holderVerdict: string, parkedMs: number,
 *   barrierTimeouts: string[] }} r
 * @param {string} ctx
 */
function assertScenarioStaged(r, ctx) {
  // El escenario NO OCURRIÓ si algún hijo no estaba listo antes de la primera
  // liberación: los que llegan tarde contienden fuera de la ventana y lo que midan
  // ya no es esta carrera.
  assert.ok(
    r.stages.ready,
    `no todos los hijos llegaron a estar arrancados y con el módulo cargado antes ` +
      `de la primera etapa. ${ctx}`,
  );
  // El escenario NO OCURRIÓ si el holder no llegó a sembrar o el stealer no llegó a
  // aparcarse: sin eso, todo lo que venga después mide otra cosa.
  assert.ok(r.stages.seeded, `el holder stale-pero-VIVO no llegó a sembrar. ${ctx}`);
  assert.ok(
    r.stages.parked,
    `el stealer no llegó a aparcarse dentro de la sección crítica. ${ctx}`,
  );
  // El vocabulario del holder es `written`/`failed` y nunca `acquired`, de modo que
  // el conteo de cardinalidad sobre el agregado de TODOS los hijos sigue siendo
  // seguro. Ojo con lo que prueba: solo que la llamada no lanzó.
  assert.equal(
    r.holderVerdict,
    'written',
    `la llamada a releaseGsdLock del holder no completó (verdicto ≠ written). ${ctx}`,
  );
  assert.ok(
    r.stages.released,
    `el holder no llegó a soltar el lock DE VERDAD: su session_id seguía en disco, ` +
      `así que el unlink que abre el hueco no ocurrió. ${ctx}`,
  );
  assert.ok(
    r.stages.creatorLanded,
    `el creador Case-1 no llegó a aterrizar en el hueco. ${ctx}`,
  );
  assert.ok(
    r.stages.reasons,
    `el marcador lateral steal-reasons.log no llegó a escribirse. ${ctx}`,
  );
  assert.ok(
    r.stages.settled,
    `algún contendiente seguía dentro de acquireGsdLock cuando el escenario cerró: ` +
      `el ganador se marcharía dejando un lock de PID muerto y robarlo sería CORRECTO, ` +
      `así que el conteo de cardinalidad dejaría de medir esta carrera. ${ctx}`,
  );
  // Una barrera vencida NO es un fallo del invariante: es la orquestación
  // desincronizada. Se separa aquí para que el rojo apunte a la causa correcta en vez
  // de mezclarse con la cardinalidad. JAMÁS se arregla subiendo el techo que venció:
  // se arregla añadiendo el handshake que falta (t0 / t7a son precisamente eso).
  assert.deepEqual(
    r.barrierTimeouts,
    [],
    `alguna barrera del harness venció en vez de cumplirse, así que a partir de ahí ` +
      `los hijos avanzaron por su cuenta. ${ctx}`,
  );
  assert.ok(
    r.parkedMs < 3000,
    `el aparcamiento venció la barrera del seam (${r.parkedMs} ms ≥ 3000 ms): el ` +
      `stealer reanudó por su cuenta y lo que viene después ya no mide el CAS. ` +
      `La reacción correcta es revisar la SECUENCIACIÓN, JAMÁS subir el techo. ${ctx}`,
  );
}

/**
 * Orquestación de TRES TIEMPOS del interleaving de segundo orden.
 *
 * Dos tiempos no bastan (a diferencia del precedente del inbox,
 * `test/inbox-concurrency.test.js:142-192`): el creador Case-1 NO puede arrancar
 * antes de que el holder haya liberado. Si lo hiciera encontraría el lock presente,
 * vería un holder con TTL vencido y entraría ÉL MISMO en `stealLock`, donde perdería
 * el guard contra el stealer aparcado, agotaría su presupuesto y saldría `blocked`.
 * `acquired === 1` seguiría cumpliéndose —nadie adquiere— el test seguiría verde y
 * el CAS no se habría ejercitado jamás. Es el mismo modo de fallo silencioso que
 * 83-06 destapó, y por eso `assertCasExercised` existe.
 *
 * TODOS los hijos se spawnean ANTES de la primera liberación, y además el padre
 * espera a que TODOS publiquen su `ready-<pid>` (t0): así quedan fuera de la ventana
 * de aparcamiento no solo el `spawn` sino el ARRANQUE del proceso y el import ESM en
 * frío, que es donde estaba el coste de verdad (KODO-24). Dentro solo queda el
 * trabajo real (un `unlink` y un `O_EXCL` create). Simétricamente, el escenario no
 * cierra hasta que todos los contendientes publican su `settled-<pid>` (t7a): el
 * ganador no puede marcharse —dejando su lock con un PID muerto— mientras alguien
 * sigue dentro de `acquireGsdLock`.
 *
 * Cada etapa tiene su PROPIO go-file, nunca uno compartido, y cada transición espera
 * sobre ESTADO DE DISCO con `waitUntil`, nunca sobre una duración fija. Al vencer un
 * margen se continúa igualmente: dejar hijos colgados enmascararía el fallo (misma
 * disciplina que `raceChildren:159-160`). Lo que sí cambia es que ahora una barrera
 * vencida DEJA CONSTANCIA (`barrier-timeouts.log`) en vez de ser indistinguible de
 * una cumplida.
 *
 * @param {number} extraStealers — contendientes adicionales SIN seam (el caso N=5)
 */
async function raceGsdStealLiveHolder(extraStealers) {
  mkdirSync(repoDir, { recursive: true });
  const go = (name) => join(sandbox, name);
  const goHolder = go('go-holder');
  const goStealer = go('go-stealer');
  const goExtras = go('go-extras');
  const goRelease = go('go-release');
  const goCreator = go('go-creator');
  const goResume = go('go-resume');
  const goTeardown = go('go-teardown');

  // El holder siembra en cuanto pasa su barrera, que el padre escribe justo después
  // del handshake de preparado (t0) — no nada más bootear, como antes: así el techo
  // de su espera `--release` cubre la orquestación y no el arranque de sus hermanos.
  const argvs = [
    ['--kind', 'gsd-holder', '--repo', repoDir, '--sandbox', sandbox, '--barrier', goHolder,
      '--release', goRelease],
    // EXACTAMENTE UNO lleva el seam (D-14/A1): que varios se aparquen a la vez es
    // imposible por construcción —el steal-guard los serializa— y multiplicaría el
    // riesgo de acercar el aparcamiento al umbral de edad del guard.
    ['--kind', 'gsd-seam', '--repo', repoDir, '--sandbox', sandbox, '--barrier', goStealer,
      '--resume', goResume],
    // El creador es el kind `gsd` EXISTENTE, sin modificar. Su `session_id` es
    // `sess-<pid>`, así que el padre lo identifica por el pid del hijo que spawneó.
    ['--kind', 'gsd', '--repo', repoDir, '--sandbox', sandbox, '--barrier', goCreator,
      '--hold-until', goTeardown],
  ];
  for (let i = 0; i < extraStealers; i++) {
    argvs.push(['--kind', 'gsd', '--repo', repoDir, '--sandbox', sandbox, '--barrier', goExtras,
      '--hold-until', goTeardown]);
  }

  const outputs = new Array(argvs.length).fill('');
  const children = argvs.map((argv, i) => {
    const child = spawn(process.execPath, [CHILD, ...argv], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.on('data', (d) => {
      outputs[i] += d.toString();
    });
    return child;
  });
  const done = Promise.all(children.map((c) => new Promise((resolve) => c.on('close', resolve))));

  const stages = {};

  // t0 — HANDSHAKE DE PREPARADO. Ninguna etapa empieza hasta que TODOS los hijos han
  // arrancado y tienen `src/gsd/lock.js` ya cargado (marcador `ready-<pid>`).
  //
  // Spawnearlos antes de la primera liberación NO basta, y suponerlo era el defecto
  // que hacía flaky este escenario (KODO-24): el coste real no es el `spawn` del
  // padre sino el ARRANQUE del proceso hijo más su import ESM en frío. Medido bajo
  // carga (20 procesos quemando CPU en 12 cores), un hijo llegó a bootear 245 ms
  // después del primero, o sea DESPUÉS de que la secuencia entera hubiera cerrado.
  // Escribir su go-file no lo ponía a contender: lo ponía a contender más tarde,
  // contra un lock ya abandonado por un ganador que había salido en el teardown, y
  // robarlo era el comportamiento CORRECTO ante un PID muerto. El agregado sumaba
  // dos `acquired` sin que ningún invariante de `stealLock` se hubiera roto.
  //
  // Con el marcador, cada transición espera ESTADO DE DISCO también aquí: el padre
  // sabe que el hijo está dentro de su barrera, no que le ha escrito el fichero.
  stages.ready = await waitUntil(
    () => children.every((c) => existsSync(join(sandbox, `ready-${c.pid}`))),
    10_000,
  );

  // t1 — el holder siembra el lock stale-pero-VIVO. Su barrera se escribe SOLO tras
  // el handshake para que el techo de su espera `--release` (3000 ms) cubra la
  // orquestación y nada más — nunca el arranque de sus hermanos.
  writeFileSync(goHolder, '1');
  stages.seeded = await waitUntil(() => existsSync(join(sandbox, 'holder-seeded')), 5000);

  // t2 — soltar el stealer con seam, y esperar a que esté DENTRO de la sección
  // crítica. El marcador se escribe desde dentro del propio seam.
  writeFileSync(goStealer, '1');
  stages.parked = await waitUntil(() => existsSync(join(sandbox, 'stealer-parked')), 5000);
  const parkedAt = Date.now();

  // t3 — SOLO AHORA los stealers extra, y nunca antes. Soltados junto al stealer con
  // seam, uno de ellos podría ganar el steal-guard en su primer intento y robar
  // legítimamente el lock del holder; entonces el stealer con seam no entraría en la
  // sección crítica en su intento 0 y el seam NO SE DISPARARÍA JAMÁS.
  if (extraStealers > 0) writeFileSync(goExtras, '1');

  // t4 — release del holder: el `unlink` que abre el hueco. El predicado es
  // deliberadamente más laxo que «el fichero no existe»: con stealers extra sueltos,
  // uno podría ocupar el hueco antes de que el padre llegue a observarlo.
  writeFileSync(goRelease, '1');
  stages.released = await waitUntil(() => readLockSession() !== HOLDER_SESSION_ID, 5000);

  // t5 — el creador Case-1 aterriza en el hueco con un `O_EXCL` create.
  writeFileSync(goCreator, '1');
  stages.creatorLanded = await waitUntil(() => {
    const s = readLockSession();
    return s !== null && s !== HOLDER_SESSION_ID;
  }, 5000);

  // t6 — sacar al stealer del seam: escribe su tmp, sonda fresca, CAS, aborta.
  writeFileSync(goResume, '1');
  const parkedMs = Date.now() - parkedAt;
  stages.reasons = await waitUntil(() => existsSync(join(sandbox, 'steal-reasons.log')), 5000);

  // t7a — HANDSHAKE DE ASENTADO, pareado con el de preparado: nadie sigue dentro de
  // `acquireGsdLock` cuando el escenario cierra. Es la otra mitad del defecto de
  // KODO-24: el ganador retiene el lock hasta el teardown, así que en cuanto sale, su
  // lock queda con un PID MUERTO. Un contendiente que siguiera dentro de su
  // presupuesto —`sleepShort` es `Atomics.wait`, y bajo carga sobrepasa su nominal—
  // lo encontraría muerto y lo robaría con toda la razón, sumando un segundo
  // `acquired` al agregado sin que ningún invariante se hubiera roto. Se espera a los
  // hijos `gsd` (creador + extras), que son los únicos que contienden aquí; el seam
  // ya quedó cubierto por `steal-reasons.log` y el holder no adquiere nada.
  const gsdChildren = children.slice(2);
  stages.settled = await waitUntil(
    () => gsdChildren.every((c) => existsSync(join(sandbox, `settled-${c.pid}`))),
    10_000,
  );

  // t7b — cierre: los ganadores con `--hold-until` salen.
  writeFileSync(goTeardown, '1');

  await done;
  const verdicts = outputs.map((o) => o.trim());
  return {
    verdicts,
    holderVerdict: verdicts[0],
    seamVerdict: verdicts[1],
    creatorSession: 'sess-' + children[2].pid,
    finalSession: readLockSession(),
    reasons: readStealReasons(sandbox),
    barrierTimeouts: readBarrierTimeouts(sandbox),
    parkedMs,
    stages,
  };
}

describe('gsd lock steal race — holder stale-pero-VIVO que libera (CR-01, 2º orden)', () => {
  it('N=3 (holder vivo + creador Case-1 + stealer aparcado) → exactamente uno adquiere', async () => {
    const r = await raceGsdStealLiveHolder(0);
    const ctx =
      `verdicts=[${r.verdicts.join(',')}] reasons=[${r.reasons.join(',')}] ` +
      `barrierTimeouts=[${r.barrierTimeouts.join(',')}] ` +
      `finalSession=${r.finalSession} parkedMs=${r.parkedMs} stages=${JSON.stringify(r.stages)}`;

    assertScenarioStaged(r, ctx);

    // LA ASERCIÓN CANÓNICA (D-14): cardinalidad sobre el AGREGADO, jamás sobre quién
    // gana. Con el CAS revertido esto vale 2 — el stealer clobbea al creador y ambos
    // se creen dueños.
    const acquired = r.verdicts.filter((v) => v === 'acquired').length;
    assert.equal(acquired, 1, `exactamente un proceso debe adquirir; ${ctx}`);

    assertCasExercised(sandbox, ctx);

    // Identidad en disco. Esto NO viola D-14 («no asertar sobre quién gana») porque
    // aquí los roles son asimétricos POR CONSTRUCCIÓN, no por suerte del scheduler:
    // el stealer está aparcado en una barrera que controla el padre, y con N=3 no hay
    // ningún otro contendiente suelto que pueda ocupar el hueco entre el `unlink` del
    // holder y el create del creador. El superviviente es determinista. (En el caso
    // N=5 de abajo deja de serlo, y por eso allí esta aserción NO se replica.)
    assert.equal(
      r.finalSession,
      r.creatorSession,
      `el lock que sobrevive debe ser el del creador Case-1, no el del stealer; ${ctx}`,
    );
  });

  it('N=5 (dos stealers extra en presión real) → exactamente uno adquiere', async () => {
    const r = await raceGsdStealLiveHolder(2);
    const ctx =
      `verdicts=[${r.verdicts.join(',')}] reasons=[${r.reasons.join(',')}] ` +
      `barrierTimeouts=[${r.barrierTimeouts.join(',')}] ` +
      `finalSession=${r.finalSession} parkedMs=${r.parkedMs} stages=${JSON.stringify(r.stages)}`;

    assertScenarioStaged(r, ctx);

    // Los dos extra son el kind `gsd` SIN seam. Entran por Case-3, pierden el
    // steal-guard contra el aparcado —vivo y en ventana, así que `guardIsStale` es
    // falso—, agotan su presupuesto acotado (`sleepShort(2·(attempt+1))` × 8 ≈ 72 ms,
    // `src/gsd/lock.js:498-513`) y llegan al epílogo, donde o rechazan contra el
    // holder que encuentren o hacen un `O_EXCL` create legítimo si el hueco sigue
    // abierto. En AMBOS desenlaces la cardinalidad se mantiene en uno: si un extra
    // ocupa el hueco, el creador encuentra EEXIST sobre un holder vivo y fresco —el
    // extra espera el teardown por `--hold-until`— y sale `blocked`.
    const acquired = r.verdicts.filter((v) => v === 'acquired').length;
    assert.equal(acquired, 1, `exactamente un proceso debe adquirir; ${ctx}`);

    assertCasExercised(sandbox, ctx);

    // NO se asevera la identidad del superviviente en disco, a diferencia del caso
    // N=3. Con contendientes extra sueltos, QUIÉN ocupa el hueco entre el `unlink`
    // del holder y el create del creador SÍ depende del scheduler, y afirmar la
    // identidad del superviviente sería exactamente asertar sobre quién gana la
    // carrera — lo que D-14 prohíbe. Que un extra gane ese hueco no es un defecto:
    // es el comportamiento correcto del `O_EXCL` sobre un path ausente, y el CAS
    // sigue mordiendo igual porque el nuevo holder es vivo y fresco en los dos casos.
  });
});

// ⚠ REGLA DE REACCIÓN ANTE UN ROJO de los dos casos de arriba (DEBT-04, D-16). Si
// alguno se pone rojo, la causa a investigar es la SECUENCIACIÓN de las etapas o el
// propio invariante en producción (`src/gsd/lock.js`, el compare-and-swap de la rama
// PRESENT de `stealLock`). Subir `STEAL_GUARD_STALE_MS` para que el escenario quepa,
// o ampliar `MAX_STEAL_ATTEMPTS` para que los extra lleguen a otro sitio, están
// PROHIBIDOS: es literalmente «subir un timeout para que el test pase», el
// enmascaramiento que DEBT-04 cierra por nombre y por el que este repo ya revirtió
// una vez en la Phase 83. Relajar la cardinalidad, borrar `assertCasExercised` o
// reducir el número de hijos son la misma jugada con otro nombre.
