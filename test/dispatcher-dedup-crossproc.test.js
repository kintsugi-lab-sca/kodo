// @ts-check
//
// test/dispatcher-dedup-crossproc.test.js — Phase 70 Plan 04 (CONC-08 / D-13).
//
// INTEGRATION: N real child processes call dispatchTrigger for the SAME non-GSD
// task_id against ONE isolated ~/.kodo (HOME=sandbox), released together via a
// `go` barrier. The per-task_id dedup lock (`~/.kodo/locks/dispatch-<id>.lock`,
// reused from the Plan-01 primitive) must let exactly ONE child reach
// launchWorkItem — the others return `already_active` without launching. This is
// the cross-process mirror of the in-process `inFlight` guard (audit M17).
//
// Each winner appends one line to `launches.log`; the aggregate assertion is
// "exactly one launch line" + "exactly one `launched` verdict" — never which
// child wins (non-deterministic).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD = join(__dirname, 'helpers', 'lock-race-child.mjs');

let sandbox;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'kodo-dispatch-race-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Spawn `count` children, each dispatching the SAME `taskId`, and release them
 * via the `go` barrier. Resolves with the trimmed stdout verdicts.
 * @param {number} count
 * @param {string} taskId
 * @returns {Promise<string[]>}
 */
function raceDispatch(count, taskId) {
  const goFile = join(sandbox, 'go');
  const children = [];
  const outputs = new Array(count).fill('');

  for (let i = 0; i < count; i++) {
    const child = spawn(
      process.execPath,
      [CHILD, '--kind', 'dispatch', '--sandbox', sandbox, '--task', taskId, '--hold', '500', '--barrier', goFile],
      { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, HOME: sandbox } },
    );
    child.stdout.on('data', (d) => {
      outputs[i] += d.toString();
    });
    children.push(child);
  }

  const done = Promise.all(
    children.map((c) => new Promise((resolve) => c.on('close', resolve))),
  );

  // All children are spawned and waiting on the barrier — release them together.
  writeFileSync(goFile, '1');

  return done.then(() => outputs.map((o) => o.trim()));
}

/** Count the real launches recorded by the stubbed launchWorkItemFn. */
function launchCount() {
  const log = join(sandbox, 'launches.log');
  if (!existsSync(log)) return 0;
  return readFileSync(log, 'utf-8').split('\n').filter(Boolean).length;
}

/**
 * Espera activa (acotada) a que `pred()` se cumpla. Devuelve `true` si se cumplió
 * y `false` si venció el techo — nunca lanza, para que el fallo se lea en la
 * aserción del escenario y no como un timeout opaco.
 * @param {() => boolean} pred
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitUntil(pred, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return pred();
}

/** Lee el `acquired_at` del dedup lock de `taskId`, o null si no existe/está ilegible. */
function readLockAcquiredAt(sandboxDir, taskId) {
  const lockPath = join(sandboxDir, '.kodo', 'locks', `dispatch-${taskId}.lock`);
  try {
    return JSON.parse(readFileSync(lockPath, 'utf-8')).acquired_at;
  } catch {
    return null;
  }
}

describe('dispatch dedup cross-process — same non-GSD task_id → one launch (CONC-08/D-13)', () => {
  it('2 processes, same task_id → exactly one launch', async () => {
    const verdicts = await raceDispatch(2, 'task-alpha');
    assert.equal(
      launchCount(),
      1,
      `exactly one launch expected; verdicts: ${verdicts.join(',')}`,
    );
    const launched = verdicts.filter((v) => v === 'launched').length;
    const alreadyActive = verdicts.filter((v) => v === 'already_active').length;
    assert.equal(launched, 1, `exactly one 'launched'; got: ${verdicts.join(',')}`);
    assert.equal(alreadyActive, 1, `the loser must be 'already_active'; got: ${verdicts.join(',')}`);
  });

  it('5 processes, same task_id → exactly one launch', async () => {
    const verdicts = await raceDispatch(5, 'task-beta');
    assert.equal(
      launchCount(),
      1,
      `exactly one launch expected; verdicts: ${verdicts.join(',')}`,
    );
    const launched = verdicts.filter((v) => v === 'launched').length;
    assert.equal(launched, 1, `exactly one 'launched'; got: ${verdicts.join(',')}`);
    for (const v of verdicts) {
      assert.ok(
        ['launched', 'already_active'].includes(v),
        `unexpected verdict '${v}'`,
      );
    }
  });
});

// KODO-48. El escenario que los dos de arriba NO cubren: los duplicados llegaban
// SIMULTÁNEOS, dentro del TTL, así que el perdedor siempre veía un lock fresco. La
// grieta era la contraria — un launch MÁS LARGO que el TTL: el lock caduca con su
// dueño todavía dentro de `launchWorkItem`, y el duplicado que llega después no es
// que pierda, es que lo ROBA legítimamente y lanza una segunda sesión para la misma
// tarea. Aquí el segundo webhook llega DELIBERADAMENTE pasado el TTL.
//
// El TTL se aprieta por env (`KODO_DISPATCH_LOCK_TTL_MS`) para no tener que esperar
// los 300s reales, y el hold del ganador va en modo `--hold-async`: con el
// `Atomics.wait` por defecto el event loop queda bloqueado y el heartbeat no podría
// latir — el escenario mediría el bloqueo del loop, no el lock.
describe('dispatch dedup cross-process — launch > TTL, duplicado tardío (KODO-48)', () => {
  const TTL_MS = 1000;
  const TASK = 'task-slow';

  /**
   * Lanza al ganador (hold `holdMs`, asíncrono) y, una vez confirmado que está
   * DENTRO del launch, espera `gapMs` —mayor que el TTL— antes de soltar el
   * duplicado. Devuelve los veredictos de ambos.
   * @param {number} holdMs
   * @param {number} gapMs
   */
  async function raceLateDuplicate(holdMs, gapMs) {
    const env = { ...process.env, HOME: sandbox, KODO_DISPATCH_LOCK_TTL_MS: String(TTL_MS) };
    /** @param {string[]} extra */
    const spawnChild = (extra) => {
      const child = spawn(
        process.execPath,
        [CHILD, '--kind', 'dispatch', '--sandbox', sandbox, '--task', TASK, ...extra],
        { stdio: ['ignore', 'pipe', 'inherit'], env },
      );
      let out = '';
      child.stdout.on('data', (d) => { out += d.toString(); });
      const done = new Promise((resolve) => child.on('close', () => resolve(out.trim())));
      return done;
    };

    const winner = spawnChild(['--hold', String(holdMs), '--hold-async', '1']);

    // El ganador está dentro del launch en cuanto aparece su línea en launches.log.
    // Anclar el reloj AQUÍ (y no al spawn) evita medir el arranque de node.
    const started = await waitUntil(() => launchCount() >= 1, 10_000);
    assert.ok(started, 'el ganador nunca entró en launchWorkItem');
    const acquiredAtStart = readLockAcquiredAt(sandbox, TASK);

    await new Promise((r) => setTimeout(r, gapMs));

    // Prueba DIRECTA de que el heartbeat late: el lock sigue puesto y su
    // `acquired_at` avanzó. Sin heartbeat seguiría clavado en el valor inicial y
    // ya sería stale por edad.
    const acquiredAtLater = readLockAcquiredAt(sandbox, TASK);

    const loser = await spawnChild([]);
    const winnerVerdict = await winner;

    return { winnerVerdict, loser, acquiredAtStart, acquiredAtLater };
  }

  it('un webhook duplicado pasado el TTL no roba el lock → un solo launch', async () => {
    // hold 4×TTL; el duplicado entra a 2×TTL — bien pasado el plazo y aún con el
    // ganador dentro del launch.
    const res = await raceLateDuplicate(TTL_MS * 4, TTL_MS * 2);

    assert.equal(
      launchCount(),
      1,
      `un solo launch esperado; ganador=${res.winnerVerdict} duplicado=${res.loser}`,
    );
    assert.equal(res.winnerVerdict, 'launched', `el primero debe lanzar; got: ${res.winnerVerdict}`);
    assert.equal(
      res.loser,
      'already_active',
      `el duplicado tardío debe rebotar, no robar el lock; got: ${res.loser}`,
    );
  });

  it('el heartbeat refresca acquired_at mientras dura el launch', async () => {
    const res = await raceLateDuplicate(TTL_MS * 4, TTL_MS * 2);

    assert.ok(res.acquiredAtStart, 'el lock del ganador debería existir al empezar el launch');
    assert.ok(res.acquiredAtLater, 'el lock debería seguir puesto pasado el TTL');
    assert.ok(
      res.acquiredAtLater > res.acquiredAtStart,
      `acquired_at debe avanzar (heartbeat); ${res.acquiredAtStart} → ${res.acquiredAtLater}`,
    );
    // Y avanzar lo bastante como para NO estar caducado en el instante en que el
    // duplicado contendió: eso es lo que le impide robarlo.
    assert.ok(
      res.acquiredAtLater - res.acquiredAtStart >= TTL_MS,
      `el refresco debe cubrir toda la ventana; delta=${res.acquiredAtLater - res.acquiredAtStart}ms`,
    );
  });
});
