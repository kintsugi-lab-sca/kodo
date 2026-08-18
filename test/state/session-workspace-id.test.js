// @ts-check
//
// test/state/session-workspace-id.test.js — KODO-22.
//
// El DoD de la tarea es un observable de DISCO: «una sesión recién lanzada tiene
// workspace_id no nulo en state.json». Los tests de manager.test.js congelan la
// función pura y los de orchestrator-identity.test.js la cadena hasta el guard;
// aquí se cierra el último tramo — que el campo SOBREVIVE al addSession y aparece
// en el fichero, no solo en el objeto en memoria.
//
// Importa: `state.js` reconstruye la fila al persistir en más de un punto (migración
// v2→v3, reconcile), y esos rebuilds descartan claves desconocidas. Un campo nuevo
// que no se lea en disco es un campo que no existe para el guard del daemon.
//
// HOME-isolation OBLIGATORIA (misma trampa que orchestrator-registration.test.js):
// `config.js` evalúa `join(homedir(), '.kodo')` en MODULE-LOAD y `state.js` deriva
// STATE_PATH de ahí. De ahí el `process.env.HOME = tmpHome` ANTES del import dinámico.
// Seed v3 igual de obligatorio: sin state.json en disco la siguiente carga dispararía
// `migrateStateV2toV3`, cuyo rebuild exhaustivo descartaría la fila sembrada.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WS_UUID = '6D6350FB-2F60-4C2A-8C4F-90F87D15BC78';

let tmpHome;
let origHome;
let statePath;
let addSession;
let listSessions;
let buildSessionFromTask;

/** @returns {any} TaskItem mínimo — buildSessionFromTask no valida más que estos campos. */
function makeTask() {
  return {
    id: 'uuid-task',
    ref: 'KODO-22',
    title: 'Persistir workspace_id',
    description: '',
    labels: [],
    projectId: 'proj-uuid',
    projectName: 'kodo',
    groups: [],
    url: '',
    priority: 'medium',
  };
}

function writeSeed() {
  writeFileSync(
    statePath,
    JSON.stringify({ schema_version: 3, sessions: {}, history: [] }, null, 2) + '\n',
  );
}

function readRaw() {
  return JSON.parse(readFileSync(statePath, 'utf-8'));
}

describe('SessionRecord.workspace_id — persistencia en state.json (KODO-22)', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-ws-id-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    statePath = join(tmpHome, '.kodo', 'state.json');
    // Imports dinámicos POST-HOME: el STATE_PATH cacheado apunta al tmpdir.
    const state = await import('../../src/session/state.js');
    addSession = state.addSession;
    listSessions = state.listSessions;
    ({ buildSessionFromTask } = await import('../../src/session/manager.js'));
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => writeSeed());

  it('el UUID llega al fichero (jq .sessions[].workspace_id lo ve)', () => {
    const session = buildSessionFromTask({
      task: makeTask(),
      providerName: 'plane',
      projectPath: '/tmp/proj',
      workspaceRef: 'workspace:17',
      sessionId: 'sess-1',
      workspaceId: WS_UUID,
    });
    addSession('uuid-task', session);

    assert.equal(readRaw().sessions['uuid-task'].workspace_id, WS_UUID);
  });

  it('los lectores de state.json lo devuelven en la fila (es lo que consume el guard)', () => {
    addSession('uuid-task', buildSessionFromTask({
      task: makeTask(),
      providerName: 'plane',
      projectPath: '/tmp/proj',
      workspaceRef: 'workspace:17',
      sessionId: 'sess-1',
      workspaceId: WS_UUID,
    }));

    const rows = listSessions();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].workspace_id, WS_UUID);
    // El ref sigue ahí: identidad (id) y conveniencia (ref) conviven.
    assert.equal(rows[0].workspace_ref, 'workspace:17');
  });

  it('sobrevive a una relectura desde disco (no es estado en memoria)', async () => {
    addSession('uuid-task', buildSessionFromTask({
      task: makeTask(),
      providerName: 'plane',
      projectPath: '/tmp/proj',
      workspaceRef: 'workspace:17',
      sessionId: 'sess-1',
      workspaceId: WS_UUID,
    }));

    const fresh = await import(`../../src/session/state.js?ws-id-reload-${Date.now()}`);
    assert.equal(fresh.listSessions()[0].workspace_id, WS_UUID);
  });

  it('el null del fail-open también se persiste, y no se confunde con el campo ausente', () => {
    addSession('uuid-task', buildSessionFromTask({
      task: makeTask(),
      providerName: 'plane',
      projectPath: '/tmp/proj',
      workspaceRef: 'workspace:17',
      sessionId: 'sess-1',
      workspaceId: null,
    }));

    const row = readRaw().sessions['uuid-task'];
    assert.equal('workspace_id' in row, true, 'la clave debe existir en disco');
    assert.equal(row.workspace_id, null);
  });

  it('una fila LEGACY sin el campo se sigue leyendo (compat — sin bump de schema_version)', () => {
    const legacy = buildSessionFromTask({
      task: makeTask(),
      providerName: 'plane',
      projectPath: '/tmp/proj',
      workspaceRef: 'workspace:17',
      sessionId: 'sess-legacy',
      workspaceId: WS_UUID,
    });
    delete legacy.workspace_id; // simula una sesión escrita antes de KODO-22
    addSession('uuid-task', legacy);

    assert.equal(readRaw().schema_version, 3, 'el campo es aditivo: NO bumpea el schema');
    const rows = listSessions();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].workspace_id, undefined);
    assert.equal(rows[0].session_id, 'sess-legacy', 'la fila legacy se lee entera');
  });
});
