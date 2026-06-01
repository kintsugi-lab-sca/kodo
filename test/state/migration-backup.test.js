// @ts-check
//
// test/state/migration-backup.test.js — Phase 38 Plan 02 (TUI-18 / SC#2, D-05).
//
// Backup I/O de la migración v2 → v3. Vive en archivo separado de migration.test.js
// porque requiere HOME-isolation: state.js calcula KODO_DIR (vía config.js) desde
// homedir() al module-load. El import DEBE ser dinámico y POST-HOME — un import
// estático de state.js cachearía KODO_DIR con el HOME real. Scaffold copiado de
// test/session/find-session.test.js:76-94.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
let loadState;

/** v2 con 1 session running (mismo shape que migration.test.js F2). */
function stateV2WithRunning() {
  return {
    schema_version: 2,
    sessions: {
      'task-run': {
        workspace_ref: 'workspace:5',
        session_id: 'sess-run',
        task_id: 'task-run',
        task_ref: 'KL-5',
        provider: 'plane',
        project_id: 'p1',
        summary: 'running session',
        status: 'running',
        started_at: '2026-05-30T10:00:00.000Z',
        project_path: '/dev/kodo',
      },
    },
    history: [],
  };
}

describe('state migration v2 → v3 — backup I/O (D-05)', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-migv3-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Dynamic import POST-HOME: KODO_DIR del módulo cacheado resuelve al tmpdir
    // aislado. NINGÚN import estático de state.js en este archivo (rompería el
    // aislamiento al cachear KODO_DIR con el HOME real).
    const mod = await import('../../src/session/state.js');
    loadState = mod.loadState;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it('migra v2→v3 escribiendo backup timestamped y deja state.json en v3', () => {
    const statePath = join(tmpHome, '.kodo', 'state.json');
    writeFileSync(statePath, JSON.stringify(stateV2WithRunning(), null, 2) + '\n');

    // loadState() dispara migrateStateIfNeeded() lazy.
    const state = loadState();
    assert.equal(state.schema_version, 3, 'state migrado a v3 tras loadState');

    // Backup timestamped: state.json.bak.YYYYMMDDTHHMMSS
    const files = readdirSync(join(tmpHome, '.kodo'));
    const backups = files.filter((f) => /^state\.json\.bak\.\d{8}T\d{6}$/.test(f));
    assert.equal(backups.length, 1, `esperaba 1 backup timestamped; encontré: ${files.join(', ')}`);

    // El backup conserva el v2 original
    const backup = JSON.parse(readFileSync(join(tmpHome, '.kodo', backups[0]), 'utf-8'));
    assert.equal(backup.schema_version, 2, 'backup conserva el v2 original');

    // state.json en disco ya es v3
    const onDisk = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(onDisk.schema_version, 3);
  });

  it('re-invocar migrate NO crea un segundo backup (idempotencia I/O)', () => {
    // El test anterior dejó state.json en v3. Segunda loadState detecta v3 y retorna.
    loadState();
    const files = readdirSync(join(tmpHome, '.kodo'));
    const backups = files.filter((f) => /^state\.json\.bak\.\d{8}T\d{6}$/.test(f));
    assert.equal(backups.length, 1, 'no se crea un segundo backup en la re-invocación');
  });
});
