// @ts-check
//
// test/gsd-lock-guard.test.js — Phase 82 Plan 01.
//
// Targeted unit tests for the steal-guard states of `stealLock`, exercised
// SOLELY through the public API (`acquireGsdLock`) + on-disk seeding. No private
// helpers are imported or exported (D-08): the guard is observed by seeding the
// sibling guard file (`.kodo.lock.steal-guard`) and a stale lock, then asserting
// on the API result and the final on-disk state.
//
// These four cases are DETERMINISTIC by design (single in-process caller against
// seeded files). The concurrent property "two breakers of the SAME orphan guard →
// exactly one ends up owning" (Assumption A1) is NOT covered here — an in-process
// unit test cannot exercise real concurrency without flakiness. That property is
// covered by the real-process race harness (`test/gsd-lock-race.test.js`, CR-01,
// N=5) plus the stress loop of Plan 82-02.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  unlinkSync,
  utimesSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { acquireGsdLock, LOCK_FILE, DEFAULT_TTL_HOURS } from '../src/gsd/lock.js';

const LOCK_BASENAME = '.kodo.lock';
const GUARD_BASENAME = '.kodo.lock.steal-guard';

// Implausibly high PID, matching the dead-PID convention in gsd-lock.test.js:99.
const DEAD_PID = 99999999;

/**
 * @param {Partial<{ session_id: string, task_id: string, task_ref: string }>} [overrides]
 */
function makeSessionInfo(overrides = {}) {
  return {
    session_id: 'sess-guard',
    task_id: 'uuid-guard',
    task_ref: 'KL-82',
    ...overrides,
  };
}

/**
 * Seed a lock file directly on disk (bypassing acquire), mirroring
 * `writeLockDirect` from test/gsd-lock.test.js.
 *
 * @param {string} projectPath
 * @param {object} content
 */
function writeLockDirect(projectPath, content) {
  const planning = join(projectPath, '.planning');
  mkdirSync(planning, { recursive: true });
  writeFileSync(join(planning, LOCK_BASENAME), JSON.stringify(content, null, 2) + '\n');
}

/**
 * Seed the sibling steal-guard file directly on disk with a chosen owner.
 * Analogous to `writeLockDirect`, targeting `.kodo.lock.steal-guard`.
 *
 * @param {string} projectPath
 * @param {{ pid: number, ts: number }} guard
 */
function writeGuardDirect(projectPath, guard) {
  const planning = join(projectPath, '.planning');
  mkdirSync(planning, { recursive: true });
  writeFileSync(join(planning, GUARD_BASENAME), JSON.stringify(guard));
}

/** Seed a provably-stale lock owned by a dead PID. */
function writeStaleDeadLock(projectPath) {
  writeLockDirect(projectPath, {
    session_id: 'crashed',
    task_id: 'uuid-crashed',
    task_ref: 'KL-crashed',
    pid: DEAD_PID,
    acquired_at: new Date().toISOString(),
    ttl_hours: DEFAULT_TTL_HOURS,
  });
}

/** List the basenames present in `<projectPath>/.planning`. */
function planningEntries(projectPath) {
  const planning = join(projectPath, '.planning');
  return existsSync(planning) ? readdirSync(planning) : [];
}

describe('gsd lock — steal-guard states (via public API + seeding)', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kodo-lock-guard-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('(a) orphan guard (dead PID) + stale lock → steals; no guard/tmp residue', () => {
    writeGuardDirect(tmpDir, { pid: DEAD_PID, ts: Date.now() });
    writeStaleDeadLock(tmpDir);

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-a' }));

    assert.equal(result.acquired, true);

    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-a');
    assert.equal(lock.pid, process.pid);

    // Orphan guard broken and cleaned; no tmp/steal residue left behind.
    const entries = planningEntries(tmpDir);
    assert.ok(!entries.includes(GUARD_BASENAME), `guard should be gone; got: ${entries}`);
    assert.ok(
      !entries.some((e) => e.includes('.tmp.') || e.includes('.steal.')),
      `no tmp/steal residue; got: ${entries}`,
    );
    // Exactly one lock file.
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
  });

  it('(b) live+fresh guard + stale lock → does not steal past a valid guard', () => {
    // process.pid is guaranteed alive; a fresh ts keeps the guard within any
    // seconds-order threshold → deterministically NOT breakable.
    writeGuardDirect(tmpDir, { pid: process.pid, ts: Date.now() });
    writeStaleDeadLock(tmpDir);

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-b' }));

    assert.equal(result.acquired, false);

    // The valid guard is left intact (never broken).
    assert.ok(existsSync(join(tmpDir, '.planning', GUARD_BASENAME)));

    // Lock state stays consistent: exactly one lock file, unchanged owner.
    const entries = planningEntries(tmpDir);
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'crashed');
  });

  it('(c) live but very old guard + stale lock → broken by age, steals', () => {
    // pid alive, but ts one hour in the past → well past any seconds-order
    // threshold, agnostic to the exact value the implementer chooses.
    writeGuardDirect(tmpDir, { pid: process.pid, ts: Date.now() - 3600_000 });
    writeStaleDeadLock(tmpDir);

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-c' }));

    assert.equal(result.acquired, true);

    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-c');
    assert.equal(lock.pid, process.pid);

    // Exactly one lock file of the caller; stale guard cleaned up.
    const entries = planningEntries(tmpDir);
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
    assert.ok(!entries.includes(GUARD_BASENAME), `stale guard should be gone; got: ${entries}`);
  });

  it('(d) simulated crash mid-steal (orphan guard + stale lock + residual tmp) → consistent', () => {
    writeGuardDirect(tmpDir, { pid: DEAD_PID, ts: Date.now() });
    writeStaleDeadLock(tmpDir);
    // A residual tmp left by a crashed stealer.
    writeFileSync(
      join(tmpDir, '.planning', `${LOCK_BASENAME}.tmp.${DEAD_PID}.orphan`),
      '{"partial":true}',
    );

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-d' }));

    assert.equal(result.acquired, true);

    // Recovered to a consistent state: exactly one lock file, owned by the caller.
    const entries = planningEntries(tmpDir);
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-d');
    assert.equal(lock.pid, process.pid);
  });

  it('(e) present but empty/unparseable RECENT guard + stale lock → NOT broken', () => {
    // Regression for the guard-level briefly-empty window: a guard that fails to
    // parse must NOT be treated as stale merely for being unparseable — a fresh
    // writer mid-publish would be broken, re-opening the double-acquire. A recent
    // unparseable guard (fresh mtime) is respected; it is broken only once it ages.
    const guardPath = join(tmpDir, '.planning', GUARD_BASENAME);
    mkdirSync(join(tmpDir, '.planning'), { recursive: true });
    writeFileSync(guardPath, ''); // empty → unparseable; mtime = now (recent)
    writeStaleDeadLock(tmpDir);

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-e' }));

    assert.equal(result.acquired, false);

    // The recent unparseable guard is left intact (never broken).
    assert.ok(existsSync(guardPath), 'recent unparseable guard must not be broken');

    // Lock state stays consistent: exactly one lock file, unchanged stale owner.
    const entries = planningEntries(tmpDir);
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'crashed');
  });

  it('(f) present but unparseable AGED guard + stale lock → broken by mtime, steals', () => {
    const guardPath = join(tmpDir, '.planning', GUARD_BASENAME);
    mkdirSync(join(tmpDir, '.planning'), { recursive: true });
    writeFileSync(guardPath, '{partial'); // unparseable
    // Backdate mtime one hour → well past any seconds-order threshold.
    const past = new Date(Date.now() - 3600_000);
    utimesSync(guardPath, past, past);
    writeStaleDeadLock(tmpDir);

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-f' }));

    assert.equal(result.acquired, true);

    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-f');
    assert.equal(lock.pid, process.pid);

    // Aged unparseable guard cleaned up; exactly one lock file of the caller.
    const entries = planningEntries(tmpDir);
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
    assert.ok(!entries.includes(GUARD_BASENAME), `aged guard should be gone; got: ${entries}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 86 Plan 01 — CAS simétrico de la rama PRESENT de `stealLock` (LOCK-04).
//
// El interleaving que se cierra (82-REVIEW.md §CR-01), los 5 pasos:
//   1. El stealer entra en la sección crítica guardada y lee un holder STALE pero
//      VIVO (TTL expirado, PID vivo) → no rechaza.
//   2. `existsSync(lockPath)` → true → rama PRESENT.
//   3. El holder vivo hace `releaseGsdLock` → `unlinkSync(lockPath)`. Path ausente.
//   4. Un `acquireGsdLock` Case-1 fresco y legítimo crea el lock con `O_EXCL` —
//      NO pasa por el steal-guard, por diseño.
//   5. El stealer, ciego, renombra encima → clobbea al creador. DOS OWNERS.
//
// Los pasos 3 y 4 se disparan desde `deps._afterCriticalReadFn`, el seam de test
// de D-10/D-11: el escenario es DETERMINISTA in-process, sin sleeps ni N
// iteraciones a ver si cae la carrera. El carril de procesos reales (LOCK-05) vive
// en `test/gsd-lock-race.test.js` y llega en el plan 86-02.
//
// La siembra es TTL vencido con PID VIVO (molde literal de
// test/gsd-lock.test.js:117-127), NUNCA el `DEAD_PID` de arriba: ese sesgo es
// precisamente lo que hace la carrera invisible al harness actual y lo que esta
// fase corrige.
// ─────────────────────────────────────────────────────────────────────────────
describe('gsd lock — CAS simétrico de la rama PRESENT (holder VIVO, LOCK-04)', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kodo-lock-cas-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Seed a lock that is STALE (TTL exceeded) but whose holder PID is ALIVE —
   * Case 3 of `acquireGsdLock`. Mold of test/gsd-lock.test.js:117-127.
   *
   * @param {string} projectPath
   * @param {string} sessionId
   */
  function writeStaleLiveLock(projectPath, sessionId) {
    writeLockDirect(projectPath, {
      session_id: sessionId,
      task_id: 'uuid-live',
      task_ref: 'KL-LIVE',
      pid: process.pid, // alive
      acquired_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
      ttl_hours: 4, // → 5h > 4h: stale by TTL, holder still alive
    });
  }

  /**
   * Steps 3+4 of the interleaving, executed from inside the stealer's critical
   * section: the live holder releases and a legitimate fresh Case-1 creator lands
   * in the gap with an `O_EXCL` create.
   *
   * @param {string} projectPath
   */
  function releaseThenFreshCreator(projectPath) {
    const lockPath = join(projectPath, LOCK_FILE);
    unlinkSync(lockPath); // paso 3: releaseGsdLock del holder vivo
    writeFileSync(
      lockPath,
      JSON.stringify(
        {
          session_id: 'sess-creator',
          task_id: 'uuid-creator',
          task_ref: 'KL-CREATOR',
          pid: process.pid, // alive
          acquired_at: new Date().toISOString(), // fresh → NOT stale
          ttl_hours: DEFAULT_TTL_HOURS,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' }, // paso 4: Case-1 O_EXCL, igual que `writeLockFile`
    );
  }

  it('(g) el steal ABORTA cuando el lock es reemplazado por un creador VIVO en plena sección crítica', () => {
    writeStaleLiveLock(tmpDir, 'sess-live-holder');

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-stealer' }), {
      _afterCriticalReadFn: () => releaseThenFreshCreator(tmpDir),
    });

    assert.equal(
      result.acquired,
      false,
      'el stealer NO puede adquirir un lock que un creador Case-1 vivo publicó ' +
        'bajo sus pies: renombrar encima produce DOS OWNERS (82-REVIEW §CR-01)',
    );
    if (result.acquired === false) {
      assert.equal(result.reason, 'lock-replaced-mid-steal');
      assert.equal(result.holder.session_id, 'sess-creator');
    }
  });

  it('(h) tras el abort, el lock del creador sobrevive en disco y no queda residuo', () => {
    writeStaleLiveLock(tmpDir, 'sess-live-holder');

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-stealer' }), {
      _afterCriticalReadFn: () => releaseThenFreshCreator(tmpDir),
    });

    assert.equal(result.acquired, false);

    // El `renameSync` destructivo NO se ejecutó: el creador conserva su lock.
    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-creator', 'el renameSync destructivo no debe ejecutarse');

    // Higiene del camino de abort: un único lock, sin tmp perdido y con el guard
    // liberado por el `finally` de la sección crítica.
    const entries = planningEntries(tmpDir);
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
    assert.ok(!entries.some((e) => e.includes('.tmp.')), `sin residuo de tmp; got: ${entries}`);
    assert.ok(!entries.includes(GUARD_BASENAME), `guard liberado; got: ${entries}`);
  });

  it('(i) un lock corrupto sigue siendo robable con el CAS puesto (seam no-op)', () => {
    // IN-01 no empeora: `content: null` NO puede convertirse en un bloqueo. El CAS
    // decide sobre BYTES; el parse solo sirve para evaluar D-06 (holder vivo).
    mkdirSync(join(tmpDir, '.planning'), { recursive: true });
    writeFileSync(join(tmpDir, '.planning', LOCK_BASENAME), '{not valid json');

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-corrupt-ok' }), {
      _afterCriticalReadFn: () => {},
    });

    assert.equal(result.acquired, true);

    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-corrupt-ok');
    assert.equal(lock.pid, process.pid);
  });

  it('(i2) corrupto SUSTITUIDO por otro corrupto en la ventana → re-contiende y roba, sin reason', () => {
    // LOCK-04 (d), la mitad que (i) no cubre: aquí el CAS SÍ detecta cambio
    // (`changed === true`), pero el contenido nuevo tampoco parsea. Debe tomar el
    // `continue` de D-05, no el corte de D-06: un contenido corrupto NO puede
    // producir `reason`, porque D-06 exige un `content` parseado Y no-stale.
    // La rama se asevera por su EFECTO OBSERVABLE (adquiere, sin reason), nunca
    // inspeccionando estado interno.
    const lockPath = join(tmpDir, LOCK_FILE);
    mkdirSync(join(tmpDir, '.planning'), { recursive: true });
    writeFileSync(lockPath, '{not valid json');

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-corrupt-swap' }), {
      _afterCriticalReadFn: () => {
        // Otros bytes, igualmente incapaces de parsear. El seam solo dispara en el
        // primer intento, así que la segunda vuelta converge.
        unlinkSync(lockPath);
        writeFileSync(lockPath, '{another invalid payload', { flag: 'wx' });
      },
    });

    assert.equal(result.acquired, true, 'un lock corrupto sigue siendo robable con el CAS puesto');
    assert.ok(
      !('reason' in result),
      `un contenido corrupto nunca puede producir reason; got: ${JSON.stringify(result)}`,
    );

    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    assert.equal(lock.session_id, 'sess-corrupt-swap');

    const entries = planningEntries(tmpDir);
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
    assert.ok(!entries.some((e) => e.includes('.tmp.')), `sin residuo de tmp; got: ${entries}`);
    assert.ok(!entries.includes(GUARD_BASENAME), `guard liberado; got: ${entries}`);
  });

  it('(j) sin seam, cero cambio de comportamiento: el holder stale-pero-VIVO se roba como siempre', () => {
    // El tercer parámetro es OPCIONAL y ADITIVO (D-11): la llamada de dos
    // argumentos —la que usan los 23 call sites existentes— no cambia de conducta.
    writeStaleLiveLock(tmpDir, 'sess-live-holder');

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-nodeps' }));

    assert.equal(result.acquired, true);

    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-nodeps');
    assert.equal(lock.pid, process.pid);

    const entries = planningEntries(tmpDir);
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
    assert.ok(!entries.includes(GUARD_BASENAME), `guard liberado; got: ${entries}`);
  });
});
