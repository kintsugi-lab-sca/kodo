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
 * TODOS los hijos se spawnean ANTES de la primera liberación: así el `spawn` queda
 * fuera de la ventana de aparcamiento y dentro solo queda el trabajo real (un
 * `unlink` y un `O_EXCL` create). Cada etapa tiene su PROPIO go-file, nunca uno
 * compartido, y cada transición espera sobre ESTADO DE DISCO con `waitUntil`, nunca
 * sobre una duración fija. Al vencer un margen se continúa igualmente: dejar hijos
 * colgados enmascararía el fallo (misma disciplina que `raceChildren:159-160`).
 *
 * @param {number} extraStealers — contendientes adicionales SIN seam (el caso N=5)
 */
async function raceGsdStealLiveHolder(extraStealers) {
  mkdirSync(repoDir, { recursive: true });
  const go = (name) => join(sandbox, name);
  const goStealer = go('go-stealer');
  const goExtras = go('go-extras');
  const goRelease = go('go-release');
  const goCreator = go('go-creator');
  const goResume = go('go-resume');
  const goTeardown = go('go-teardown');

  // El holder NO recibe `--barrier`: siembra nada más bootear.
  const argvs = [
    ['--kind', 'gsd-holder', '--repo', repoDir, '--sandbox', sandbox, '--release', goRelease],
    // EXACTAMENTE UNO lleva el seam (D-14/A1): que varios se aparquen a la vez es
    // imposible por construcción —el steal-guard los serializa— y multiplicaría el
    // riesgo de acercar el aparcamiento al umbral de edad del guard.
    ['--kind', 'gsd-seam', '--repo', repoDir, '--sandbox', sandbox, '--barrier', goStealer,
      '--resume', goResume],
    // El creador es el kind `gsd` EXISTENTE, sin modificar. Su `session_id` es
    // `sess-<pid>`, así que el padre lo identifica por el pid del hijo que spawneó.
    ['--kind', 'gsd', '--repo', repoDir, '--barrier', goCreator, '--hold-until', goTeardown],
  ];
  for (let i = 0; i < extraStealers; i++) {
    argvs.push(['--kind', 'gsd', '--repo', repoDir, '--barrier', goExtras,
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

  // t1 — el holder siembra el lock stale-pero-VIVO.
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
  // Sin assert aquí: el assert de cobertura es `assertCasExercised`.
  stages.reasons = await waitUntil(() => existsSync(join(sandbox, 'steal-reasons.log')), 5000);

  // t7 — cierre: los ganadores con `--hold-until` salen.
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
    parkedMs,
    stages,
  };
}

describe('gsd lock steal race — holder stale-pero-VIVO que libera (CR-01, 2º orden)', () => {
  it('N=3 (holder vivo + creador Case-1 + stealer aparcado) → exactamente uno adquiere', async () => {
    const r = await raceGsdStealLiveHolder(0);
    const ctx =
      `verdicts=[${r.verdicts.join(',')}] reasons=[${r.reasons.join(',')}] ` +
      `finalSession=${r.finalSession} parkedMs=${r.parkedMs} stages=${JSON.stringify(r.stages)}`;

    // El escenario NO OCURRIÓ si el holder no llegó a sembrar o el stealer no llegó a
    // aparcarse: sin eso, todo lo que venga después mide otra cosa.
    assert.ok(r.stages.seeded, `el holder stale-pero-VIVO no llegó a sembrar. ${ctx}`);
    assert.ok(
      r.stages.parked,
      `el stealer no llegó a aparcarse dentro de la sección crítica. ${ctx}`,
    );
    // El holder demuestra que LIBERÓ de verdad. Su vocabulario es `written`/`failed`
    // y nunca `acquired`, de modo que el conteo de cardinalidad de abajo sobre el
    // agregado de TODOS los hijos sigue siendo seguro.
    assert.equal(r.holderVerdict, 'written', `el holder no completó su release. ${ctx}`);

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
});
