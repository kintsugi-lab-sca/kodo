// @ts-check
//
// test/state/migration-concurrency.test.js — KODO-37.
//
// La migración v2 → v3 era la ÚNICA escritura de `state.json` fuera del patrón
// atómico WR-02 y fuera del lock global: un `writeFileSync(STATE_PATH)` directo.
// Los mutadores nunca la ejercitaban desnuda (`withStateLock` →
// `runUnderStateLock` → `loadState` → migración, ya bajo lock), pero un LECTOR
// PURO sí — cualquier `loadState()` suelto (server, hooks, dashboard). Sobre un
// state.json v2, un lector recién arrancado publicaba su propia migración
// ENCIMA del `saveState` de un escritor concurrente, y podía además dejar bytes
// a medio escribir para otro lector.
//
// Tres garantías:
//
//   (1) CARRERA REAL — N escritores (addSession) y N lectores puros (loadState)
//       arrancan a la vez, con una barrera `go`, contra UN state.json v2. El
//       estado final debe ser JSON válido en v3 con TODAS las sesiones: las
//       legacy que venían en el v2 y las N que cada escritor añadió. Cero
//       pérdidas, cero corrupción, cero residuo `.tmp`.
//
//   (2) FAIL-SAFE DETERMINISTA — con el lock global sostenido por otro proceso,
//       un lector NO escribe: obtiene su v3 en memoria (nunca un v2 crudo, que
//       reabriría la pérdida silenciosa de claves aditivas de KODO-26) y deja el
//       disco intacto — ni state.json migrado, ni backup, ni tmp.
//
//   (3) EL APLAZAMIENTO NO ES PÉRDIDA — liberado el lock, el siguiente lector sí
//       persiste la migración: v3 en disco y exactamente un `.bak.<ts>`.
//
// HOME-isolation: state.js calcula KODO_DIR (vía config.js) desde homedir() al
// module-load. TODO el ejercicio corre en procesos hijo con HOME aislado por
// env; el padre solo inspecciona el disco del sandbox. NINGÚN import de state.js
// en este fichero — ni estático ni dinámico (filtraría al ~/.kodo real).
// Scaffold espejo de state-writers-concurrency.test.js.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD = join(__dirname, '..', 'helpers', 'lock-race-child.mjs');

const STATE_REL = ['.kodo', 'state.json'];
const LOCK_REL = ['.kodo', 'state.json.lock'];

/** Sesión legacy con el shape v2 (sin los 5 campos del ciclo de vida v3). */
function legacySession(id) {
  return {
    workspace_ref: 'workspace:' + id,
    session_id: 'sess-' + id,
    task_id: 'legacy-' + id,
    task_ref: 'KL-' + id,
    provider: 'plane',
    project_id: 'p1',
    summary: 'legacy session ' + id,
    status: 'running',
    started_at: '2026-05-30T10:00:00.000Z',
    project_path: '/dev/kodo',
  };
}

/** state.json v2 con `count` sesiones legacy — el punto de partida a migrar. */
function seedV2(count) {
  const sessions = {};
  for (let i = 0; i < count; i++) sessions['legacy-' + i] = legacySession(i);
  return { schema_version: 2, sessions, history: [] };
}

/** Espera (acotada) a que `path` aparezca en disco. */
function waitForFile(path, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const sab = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(path) && Date.now() < deadline) Atomics.wait(sab, 0, 0, 1);
  return existsSync(path);
}

describe('state.json migration concurrency (KODO-37)', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'kodo-mig-race-'));
    mkdirSync(join(sandbox, '.kodo'), { recursive: true });
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  /** Lanza un hijo del harness con el HOME del sandbox. Resuelve con su stdout. */
  function spawnChild(argv) {
    const child = spawn(process.execPath, [CHILD, ...argv], {
      stdio: ['ignore', 'pipe', 'inherit'],
      // HOME aislado: el KODO_DIR del hijo resuelve al sandbox, NUNCA al ~/.kodo real.
      env: { ...process.env, HOME: sandbox },
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    // El veredicto es la ÚLTIMA línea: el hijo que gana la carrera de la
    // migración emite antes por stdout el aviso `[kodo] State migrado ...` (el
    // fallback sin logger de `migrateStateIfNeeded`, preexistente). Ese aviso es
    // parte de lo que se ejercita, no ruido a silenciar.
    const done = new Promise((resolve) =>
      child.on('close', () => resolve(out.trim().split('\n').pop().trim())),
    );
    return { child, done };
  }

  /** Ficheros del `.kodo` del sandbox que casan con un prefijo dado. */
  function kodoFiles(prefix) {
    return readdirSync(join(sandbox, '.kodo')).filter((f) => f.startsWith(prefix));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // (1) CARRERA REAL — escritores y lectores migradores sobre un v2.
  // ─────────────────────────────────────────────────────────────────────────
  it('N escritores + N lectores migradores sobre un v2 → cero pérdidas', async () => {
    const N = 6;
    const LEGACY = 2;
    writeFileSync(
      join(sandbox, ...STATE_REL),
      JSON.stringify(seedV2(LEGACY), null, 2) + '\n',
    );

    const goFile = join(sandbox, 'go');
    const pending = [];
    // Todos spawneados ANTES de liberar la barrera: el arranque del proceso y el
    // import ESM en frío quedan fuera de la ventana de contención.
    for (let i = 0; i < N; i++) {
      pending.push(
        spawnChild(['--kind', 'writer', '--idx', String(i), '--barrier', goFile]),
      );
      pending.push(spawnChild(['--kind', 'migrator', '--barrier', goFile]));
    }

    const all = Promise.all(pending.map((p) => p.done));
    writeFileSync(goFile, '1');
    const verdicts = await all;

    const writerVerdicts = verdicts.filter((_, i) => i % 2 === 0);
    const readerVerdicts = verdicts.filter((_, i) => i % 2 === 1);

    assert.equal(
      writerVerdicts.filter((v) => v === 'written').length,
      N,
      `los ${N} escritores deben reportar written; got: ${writerVerdicts.join(',')}`,
    );
    // Todo lector obtiene un v3 — nunca el v2 crudo, ni un parse fallido sobre
    // bytes a medio escribir.
    for (const v of readerVerdicts) {
      assert.match(
        v,
        /^v3:\d+$/,
        `todo lector debe recibir un state v3 legible; got: ${readerVerdicts.join(',')}`,
      );
    }

    // El estado final: v3, con las legacy Y las N de los escritores.
    const finalRaw = readFileSync(join(sandbox, ...STATE_REL), 'utf-8');
    const finalState = JSON.parse(finalRaw); // lanza si quedó corrupto
    assert.equal(finalState.schema_version, 3, 'el estado final debe estar en v3');

    const keys = Object.keys(finalState.sessions);
    for (let i = 0; i < N; i++) {
      assert.ok(
        keys.includes('task-' + i),
        `task-${i} se perdió: la migración de un lector pisó un saveState. keys=${keys.join(',')}`,
      );
    }
    for (let i = 0; i < LEGACY; i++) {
      assert.ok(
        keys.includes('legacy-' + i),
        `legacy-${i} se perdió en la migración. keys=${keys.join(',')}`,
      );
    }
    assert.equal(keys.length, N + LEGACY, `sobran o faltan sesiones: ${keys.join(',')}`);

    // Publicación atómica: ningún `.tmp.*` huérfano tras la carrera.
    assert.deepEqual(kodoFiles('state.json.tmp.'), [], 'no debe quedar residuo .tmp');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (2) FAIL-SAFE — con el lock tomado por otro proceso, el lector NO escribe.
  // ─────────────────────────────────────────────────────────────────────────
  it('con el lock sostenido por otro proceso, el lector migra en memoria y no toca el disco', async () => {
    const seeded = JSON.stringify(seedV2(1), null, 2) + '\n';
    writeFileSync(join(sandbox, ...STATE_REL), seeded);

    // Un hijo toma el lock global de state.json y lo sostiene hasta la barrera.
    const releaseFile = join(sandbox, 'release');
    const holder = spawnChild([
      '--kind', 'state',
      '--lock', join(sandbox, ...LOCK_REL),
      '--hold-until', releaseFile,
    ]);
    assert.ok(
      waitForFile(join(sandbox, ...LOCK_REL)),
      'el holder debe haber creado el lockfile antes de que el lector arranque',
    );

    // El lector puro corre CON el lock ajeno tomado: agota los retries y cae al
    // fail-safe. Debe devolver un v3 igualmente.
    const readerVerdict = await spawnChild(['--kind', 'migrator']).done;
    assert.match(
      readerVerdict,
      /^v3:1$/,
      `el lector debe recibir el v3 migrado en memoria; got: ${readerVerdict}`,
    );

    // Y el disco debe estar INTACTO: ni migrado, ni backup, ni tmp.
    assert.equal(
      readFileSync(join(sandbox, ...STATE_REL), 'utf-8'),
      seeded,
      'el lector escribió state.json sin sostener el lock',
    );
    assert.deepEqual(kodoFiles('state.json.bak.'), [], 'no debe haber backup sin persistir');
    assert.deepEqual(kodoFiles('state.json.tmp.'), [], 'no debe quedar residuo .tmp');

    writeFileSync(releaseFile, '1');
    assert.equal(await holder.done, 'acquired');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (3) EL APLAZAMIENTO NO ES PÉRDIDA — liberado el lock, el lector sí persiste.
  // ─────────────────────────────────────────────────────────────────────────
  it('liberado el lock, el siguiente lector persiste la migración con su backup', async () => {
    writeFileSync(join(sandbox, ...STATE_REL), JSON.stringify(seedV2(1), null, 2) + '\n');

    const verdict = await spawnChild(['--kind', 'migrator']).done;
    assert.match(verdict, /^v3:1$/, `got: ${verdict}`);

    const persisted = JSON.parse(readFileSync(join(sandbox, ...STATE_REL), 'utf-8'));
    assert.equal(persisted.schema_version, 3, 'la migración debe haberse persistido');
    assert.equal(Object.keys(persisted.sessions).length, 1);
    assert.equal(kodoFiles('state.json.bak.').length, 1, 'exactamente un backup timestamped');
    assert.deepEqual(kodoFiles('state.json.tmp.'), [], 'no debe quedar residuo .tmp');
    // El lock se libera al salir de la sección crítica.
    assert.equal(existsSync(join(sandbox, ...LOCK_REL)), false, 'el lock debe quedar liberado');
  });
});
