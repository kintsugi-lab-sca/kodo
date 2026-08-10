// @ts-check
//
// test/state/orchestrator-registration.test.js — KODO-16.
//
// Prueba de persistencia de la clave aditiva top-level `state.orchestrator`, el sitio
// donde la identidad del orquestador sobrevive a un reinicio del daemon. Antes de esto
// la única «prueba» de que había un orquestador era el título de una tab de cmux, y el
// arranque del daemon lo renombraba: `jq .orchestrator ~/.kodo/state.json` devolvía
// vacío y `kodo check` lanzaba un duplicado.
//
// HOME-isolation OBLIGATORIA con la misma trampa que handoff-state.test.js: `config.js`
// evalúa `join(homedir(), '.kodo')` en MODULE-LOAD y `state.js` deriva STATE_PATH de
// ahí. Un import estático de state.js en la cabecera escribiría en el `~/.kodo` REAL del
// operador. De ahí el `process.env.HOME = tmpHome` ANTES del import dinámico.
//
// Seed v3 igual de obligatorio: sin state.json en disco, `loadState()` devuelve la shape
// v2 y la siguiente carga dispararía `migrateStateV2toV3`, cuyo rebuild exhaustivo
// descarta toda clave desconocida — `orchestrator` incluida (mismo trade-off ya
// documentado para `tasks`).

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
let getOrchestrator;
let setOrchestrator;
let clearOrchestrator;
let statePath;

const REG = {
  workspace_ref: 'workspace:32',
  workspace_id: '0AE8A07E-B73A-40EB-B168-2270EEE03683',
  session_id: 'sess-abc',
  started_at: '2026-08-10T08:00:00.000Z',
};

function writeSeed(extra = {}) {
  writeFileSync(
    statePath,
    JSON.stringify({ schema_version: 3, sessions: {}, history: [], ...extra }, null, 2) + '\n',
  );
}

function readRaw() {
  return JSON.parse(readFileSync(statePath, 'utf-8'));
}

/** Logger colector — captura eventos sin importar logger.js. */
function spyLogger() {
  const calls = { info: [], warn: [] };
  return {
    calls,
    debug() {},
    info: (event, meta) => calls.info.push({ event, meta }),
    warn: (event, meta) => calls.warn.push({ event, meta }),
    error() {},
    child() { return this; },
  };
}

describe('state.orchestrator — registro persistido del orquestador (KODO-16)', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-orch-reg-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    statePath = join(tmpHome, '.kodo', 'state.json');
    // Import dinámico POST-HOME: el STATE_PATH cacheado del módulo apunta al tmpdir.
    const mod = await import('../../src/session/state.js');
    getOrchestrator = mod.getOrchestrator;
    setOrchestrator = mod.setOrchestrator;
    clearOrchestrator = mod.clearOrchestrator;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => writeSeed());

  it('sin registro → null', () => {
    assert.equal(getOrchestrator(), null);
  });

  it('roundtrip: set escribe los 4 campos y get los devuelve', () => {
    const r = setOrchestrator(REG);
    assert.equal(r.ok, true);
    assert.deepEqual(getOrchestrator(), REG);
  });

  it('la clave vive en el top level de state.json (jq .orchestrator la ve)', () => {
    // Literal del criterio de éxito: `jq .orchestrator` devolvía vacío.
    setOrchestrator(REG);
    assert.deepEqual(readRaw().orchestrator, REG);
  });

  it('el registro sobrevive a una relectura desde disco (no es estado en memoria)', async () => {
    setOrchestrator(REG);
    // Import fresco = otro «proceso» a efectos de caché de módulo: si la identidad
    // viviera en memoria, aquí se perdería — que es exactamente lo que pasaba al
    // reiniciar el daemon.
    const fresh = await import(`../../src/session/state.js?orch-reload-${Date.now()}`);
    assert.deepEqual(fresh.getOrchestrator(), REG);
  });

  it('set sobrescribe entero el registro previo (sin merge)', () => {
    setOrchestrator(REG);
    const next = {
      workspace_ref: 'workspace:41',
      workspace_id: 'FFFFFFFF-0000-0000-0000-000000000000',
      session_id: 'sess-xyz',
      started_at: '2026-08-10T09:00:00.000Z',
    };
    setOrchestrator(next);
    assert.deepEqual(getOrchestrator(), next);
  });

  it('clear borra la clave → get vuelve a null y la cola puede tener supervisor nuevo', () => {
    setOrchestrator(REG);
    const r = clearOrchestrator();
    assert.equal(r.ok, true);
    assert.equal(getOrchestrator(), null);
    assert.equal('orchestrator' in readRaw(), false);
  });

  it('clear sobre un state sin registro es no-op (idempotente)', () => {
    assert.equal(clearOrchestrator().ok, true);
    assert.equal(getOrchestrator(), null);
  });

  it('workspace_id ausente/no-string se normaliza a null (un solo caso degradado)', () => {
    writeSeed({ orchestrator: { workspace_ref: 'workspace:5', session_id: 's', started_at: 't' } });
    assert.equal(getOrchestrator()?.workspace_id, null);
    writeSeed({ orchestrator: { ...REG, workspace_id: 42 } });
    assert.equal(getOrchestrator()?.workspace_id, null);
  });

  it('registro sin workspace_ref usable → null (nunca bloquea el launch)', () => {
    // Un registro corrupto NO puede dejar la cola sin supervisor: se ignora.
    for (const bad of [null, 'texto', 42, {}, { workspace_ref: '' }, { workspace_ref: 7 }]) {
      writeSeed({ orchestrator: bad });
      assert.equal(getOrchestrator(), null, `shape inválida no ignorada: ${JSON.stringify(bad)}`);
    }
  });

  it('no toca sessions, history ni tasks', () => {
    writeSeed({
      sessions: { t1: /** @type {any} */ ({ task_ref: 'K-1' }) },
      history: [/** @type {any} */ ({ task_ref: 'K-0' })],
      tasks: { t1: { plan_path: '/p.md', next: 'algo', updated_at: 'x' } },
    });
    setOrchestrator(REG);
    const raw = readRaw();
    assert.equal(raw.sessions.t1.task_ref, 'K-1');
    assert.equal(raw.history[0].task_ref, 'K-0');
    assert.equal(raw.tasks.t1.next, 'algo');
    clearOrchestrator();
    assert.equal(readRaw().sessions.t1.task_ref, 'K-1');
  });

  it('emite telemetría de registro y de borrado', () => {
    const log = spyLogger();
    setOrchestrator(REG, /** @type {any} */ (log));
    clearOrchestrator(/** @type {any} */ (log));
    assert.deepEqual(
      log.calls.info.map((c) => c.event),
      ['state.orchestrator.registered', 'state.orchestrator.cleared'],
    );
    // El workspace_ref es un dato de topología, no contenido de LLM: puede loguearse.
    assert.equal(log.calls.info[0].meta.workspace_ref, 'workspace:32');
  });
});
