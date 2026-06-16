// @ts-check
//
// test/state/save-state-atomic.test.js — Phase 53 Plan 01 (BIDIR-05 / D-05).
//
// Atomicity proof for saveState's tmp+rename upgrade. Vive en archivo separado
// con HOME-isolation porque state.js calcula KODO_DIR (vía config.js) desde
// homedir() al module-load. El import DEBE ser dinámico y POST-HOME — un import
// estático de state.js cachearía STATE_PATH con el HOME real y filtraría al
// `~/.kodo` real. Scaffold espejo de test/state/migration-backup.test.js +
// test/session/find-session.test.js:76-103.
//
// Tres garantías:
//   (1) Tras una escritura (addSession → saveState) no queda residuo `.tmp`.
//   (2) saveState + loadState round-trip durable (sin corrupción).
//   (3) El path del backup `.bak.<ts>` de la migración NO se ve perturbado por
//       el upgrade — sigue produciendo exactamente un snapshot timestamped.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
let saveState;
let loadState;
let addSession;

const STATE_REL = ['.kodo', 'state.json'];

/** v3-shaped clean state (afterEach reset target). */
function cleanV3() {
  return { schema_version: 3, sessions: {}, history: [] };
}

/** Minimal running SessionRecord (mismo shape que migration-backup.test.js). */
function sessionRecord(taskId) {
  return {
    workspace_ref: 'workspace:7',
    session_id: 'sess-' + taskId,
    task_id: taskId,
    task_ref: 'KL-7',
    provider: 'plane',
    project_id: 'p1',
    summary: 'atomic write session',
    status: 'running',
    started_at: '2026-06-16T10:00:00.000Z',
    project_path: '/dev/kodo',
  };
}

/** v2 con 1 session running — dispara migrateStateIfNeeded en loadState. */
function stateV2WithRunning() {
  return {
    schema_version: 2,
    sessions: {
      'task-mig': sessionRecord('task-mig'),
    },
    history: [],
  };
}

describe('saveState atomic tmp+rename (BIDIR-05 / D-05)', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-atomic-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Dynamic import POST-HOME: STATE_PATH del módulo cacheado resuelve al
    // tmpdir aislado. NINGÚN import estático de state.js (rompería el aislamiento).
    const mod = await import('../../src/session/state.js');
    saveState = mod.saveState;
    loadState = mod.loadState;
    addSession = mod.addSession;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  afterEach(() => {
    // Reset a v3 limpio entre casos. force evita ENOENT si el caso ya escribió.
    writeFileSync(join(tmpHome, ...STATE_REL), JSON.stringify(cleanV3(), null, 2) + '\n');
  });

  // -----------------------------------------------------------------------
  // Caso 1: no queda `.tmp` sibling tras la escritura (rename lo consume).
  // -----------------------------------------------------------------------
  it('leaves no .tmp sibling after a write', () => {
    addSession('task-tmp', sessionRecord('task-tmp'));

    const onDisk = loadState();
    assert.ok(onDisk.sessions['task-tmp'], 'la fila sembrada está en state.json');

    const files = readdirSync(join(tmpHome, '.kodo'));
    const tmpResidue = files.filter((f) => f.endsWith('.tmp'));
    assert.equal(
      tmpResidue.length,
      0,
      `no debe quedar residuo .tmp; encontré: ${files.join(', ')}`,
    );
  });

  // -----------------------------------------------------------------------
  // Caso 2: round-trip durable — saveState seguido de loadState es exacto.
  // -----------------------------------------------------------------------
  it('round-trips durably (saveState → loadState deep-equal)', () => {
    const state = cleanV3();
    state.sessions['task-rt'] = sessionRecord('task-rt');
    saveState(state);

    const loaded = loadState();
    assert.deepEqual(
      loaded.sessions,
      state.sessions,
      'sessions round-trip byte-fielmente tras tmp+rename',
    );
  });

  // -----------------------------------------------------------------------
  // Caso 3: el path `.bak.<ts>` de la migración NO se ve afectado por el upgrade.
  // -----------------------------------------------------------------------
  it('leaves the .bak migration snapshot path unaffected', () => {
    // Escribe un state.json v2 directamente, luego loadState dispara migrate.
    writeFileSync(
      join(tmpHome, ...STATE_REL),
      JSON.stringify(stateV2WithRunning(), null, 2) + '\n',
    );

    const migrated = loadState();
    assert.equal(migrated.schema_version, 3, 'state migrado a v3');

    const files = readdirSync(join(tmpHome, '.kodo'));
    const backups = files.filter((f) => /^state\.json\.bak\.\d{8}T\d{6}$/.test(f));
    assert.equal(
      backups.length,
      1,
      `esperaba exactamente 1 backup timestamped; encontré: ${files.join(', ')}`,
    );
  });
});
