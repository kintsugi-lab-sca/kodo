// @ts-check
//
// test/state/migration.test.js — Phase 38 Plan 02 Wave 0 RED (TUI-18 / SC#2).
//
// Cubre la migración de schema v2 → v3: deriva los 5 campos nuevos del ciclo de
// vida (state, process_alive, tab_alive, needs_input, last_seen_alive) PRESERVANDO
// sessions + history (NO el destructive clear de v1→v2). Idempotente + backup
// timestamped (D-05).
//
// Estructura mirror de test/migration.test.js:16-86 (fixtures inline como objeto
// literal, NO archivos JSON externos). El backup test usa el scaffold HOME-isolation
// de test/session/find-session.test.js (mkdtempSync + HOME override + dynamic import
// POST-HOME, porque state.js calcula KODO_DIR al module-load).
//
// Decisiones load-bearing (38-CONTEXT.md):
//   - D-04: 5 estados + mapping legacy 'done'→'idle', 'error'→'dead',
//     'interrupted'→'dead', 'review' preservado.
//   - D-05: migración idempotente + backup timestamped YYYYMMDDTHHMMSS.
//   - D-11: dimensiones independientes del SessionRecord v3 (aditivas).
//   - RESEARCH §S1 punto 2: tab_alive=false en migrate puro (el rescate vive en
//     la reconciliación de Plan 04, NO en la migración).

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrateStateV2toV3 } from '../../src/session/state.js';

// ── Fixtures inline (D-05 + RESEARCH §S3) ───────────────────────────

/** F1 — v2 vacío: migra a v3 sin sessions a derivar. */
const STATE_V2_EMPTY = { schema_version: 2, sessions: {}, history: [] };

/** F2 — v2 con 1 running + 1 history reciente cuyo workspace_ref aparece. */
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
    history: [
      {
        workspace_ref: 'workspace:5',
        session_id: 'sess-old',
        task_id: 'task-old',
        task_ref: 'KL-old',
        provider: 'plane',
        project_id: 'p1',
        summary: 'old',
        status: 'done',
        started_at: '2026-05-29T10:00:00.000Z',
        project_path: '/dev/kodo',
        ended_at: '2026-05-29T11:00:00.000Z',
      },
    ],
  };
}

/** F3 — v2 con 1 session degenerate status:'done' (legacy que quedó en sessions). */
function stateV2DoneLegacy() {
  return {
    schema_version: 2,
    sessions: {
      'task-done': {
        workspace_ref: 'workspace:9',
        session_id: 'sess-done',
        task_id: 'task-done',
        task_ref: 'KL-9',
        provider: 'plane',
        project_id: 'p1',
        summary: 'legacy done',
        status: 'done',
        started_at: '2026-05-28T10:00:00.000Z',
        project_path: '/dev/kodo',
      },
    },
    history: [],
  };
}

/** F4 — v2 con 1 session status:'review' (ortogonal a Phase 38, preservado). */
function stateV2ReviewPreserved() {
  return {
    schema_version: 2,
    sessions: {
      'task-rev': {
        workspace_ref: 'workspace:7',
        session_id: 'sess-rev',
        task_id: 'task-rev',
        task_ref: 'KL-7',
        provider: 'plane',
        project_id: 'p1',
        summary: 'review session',
        status: 'review',
        started_at: '2026-05-30T09:00:00.000Z',
        project_path: '/dev/kodo',
      },
    },
    history: [],
  };
}

describe('state migration v2 → v3', () => {
  // F1 — empty
  it('F1: v2 vacío → v3 sin sessions a derivar', () => {
    const migrated = migrateStateV2toV3(STATE_V2_EMPTY);
    assert.equal(migrated.schema_version, 3);
    assert.deepEqual(migrated.sessions, {});
    assert.deepEqual(migrated.history, []);
  });

  // F2 — running preservado + campos derivados
  it('F2: session running preserva state + deriva los 5 campos nuevos', () => {
    const migrated = migrateStateV2toV3(stateV2WithRunning());
    const s = migrated.sessions['task-run'];
    assert.equal(migrated.schema_version, 3);
    assert.equal(s.state, 'running', 'state running preservado');
    assert.equal(s.process_alive, true, 'process_alive derivado de status running');
    assert.equal(s.tab_alive, false, 'tab_alive=false default (rescate vive en reconciliación)');
    assert.equal(s.needs_input, false, 'needs_input=false default');
    assert.equal(s.last_seen_alive, null, 'last_seen_alive=null default');
    // history preservado SIN modificar (rescate NO ocurre en migrate puro)
    assert.equal(migrated.history.length, 1);
    assert.equal(migrated.history[0].session_id, 'sess-old');
  });

  // F3 — done legacy → idle
  it('F3: session legacy status:done → state idle + process_alive false (D-04)', () => {
    const migrated = migrateStateV2toV3(stateV2DoneLegacy());
    const s = migrated.sessions['task-done'];
    assert.equal(s.state, 'idle', "mapping legacy 'done' → 'idle' (D-04 último párrafo)");
    assert.equal(s.process_alive, false);
  });

  // F4 — review preservado
  it('F4: session status:review → state review preservado (D-12 ortogonal)', () => {
    const migrated = migrateStateV2toV3(stateV2ReviewPreserved());
    const s = migrated.sessions['task-rev'];
    assert.equal(s.state, 'review', "'review' es ortogonal a Phase 38, queda pre-existente");
  });

  // F5 — idempotencia
  it('F5: migrar dos veces es estable (idempotente, deep-equal)', () => {
    const once = migrateStateV2toV3(stateV2WithRunning());
    const twice = migrateStateV2toV3(once);
    assert.equal(twice.schema_version, 3);
    assert.deepEqual(twice, once, 'segundo migrate no cambia nada');
  });

  // F6 — already v3 no-op (mismo reference)
  it('F6: input schema_version:3 → retorna mismo objeto referencialmente', () => {
    const v3 = { schema_version: 3, sessions: {}, history: [] };
    const result = migrateStateV2toV3(v3);
    assert.equal(result, v3, 'mismo reference — idempotencia trivial');
  });
});

// ── Backup I/O test (D-05) ──────────────────────────────────────────
//
// HOME-isolation scaffold: state.js calcula KODO_DIR al module-load desde
// homedir(). El dynamic import DEBE ocurrir DESPUÉS de fijar HOME. Como el
// módulo ya fue importado arriba (migrateStateV2toV3 puro), usamos un
// subproceso-libre approach: import dinámico con un cache-buster por query
// string para forzar re-evaluación del módulo bajo el HOME aislado.

describe('state migration v2 → v3 — backup I/O (D-05)', () => {
  let tmpHome;
  let origHome;
  let loadState;
  let STATE_PATH;

  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-migv3-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Dynamic import POST-HOME + cache-buster: state.js ya se importó arriba
    // (binding estático de migrateStateV2toV3), así que su KODO_DIR apunta al
    // HOME real. El query string fuerza una instancia nueva del módulo cuyo
    // KODO_DIR resuelve al tmpHome aislado.
    const mod = await import('../../src/session/state.js?backup-test');
    loadState = mod.loadState;
    STATE_PATH = mod.STATE_PATH;
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
