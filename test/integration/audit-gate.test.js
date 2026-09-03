// @ts-check
//
// test/integration/audit-gate.test.js — KODO-74: el store de retos sobre state.json.
//
// AISLAMIENTO DEL HOME OBLIGATORIO, con la misma trampa que documenta
// `test/integration/queue.test.js:5-13`: `config.js` evalúa `join(homedir(), '.kodo')` en
// MODULE-LOAD y `state.js` deriva STATE_PATH de ahí. Un import ESTÁTICO escribiría en el
// `~/.kodo` REAL del operador en cada `npm test`. De ahí el `process.env.HOME = tmpHome` ANTES
// del `await import(...)` dentro de `before()`.
//
// SEMBRADO v3 igual de obligatorio: sin fichero en disco, `loadState` devuelve la forma v2 y la
// siguiente carga dispararía `migrateStateV2toV3`, cuya reconstrucción exhaustiva DESCARTA toda
// clave desconocida — `audit_gates` incluida.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
/** @type {typeof import('../../src/integration/audit.js').openAuditChallenge} */
let openAuditChallenge;
/** @type {typeof import('../../src/integration/audit.js').closeAuditChallenge} */
let closeAuditChallenge;
/** @type {typeof import('../../src/integration/audit.js').readAuditGate} */
let readAuditGate;
/** @type {typeof import('../../src/integration/audit.js').clearAuditGate} */
let clearAuditGate;
/** @type {typeof import('../../src/integration/audit.js').gateKey} */
let gateKey;
let GATE_CAP;

const STATE_REL = ['.kodo', 'state.json'];
const TARGET = { project_path: '/repo/kodo', branch: 'feat/audit' };
const FP = 'a'.repeat(64);
const HEAD = 'b'.repeat(40);

function writeSeed(extra = {}) {
  writeFileSync(
    join(tmpHome, ...STATE_REL),
    JSON.stringify({ schema_version: 3, sessions: {}, history: [], ...extra }, null, 2) + '\n',
  );
}

function readRawState() {
  return JSON.parse(readFileSync(join(tmpHome, ...STATE_REL), 'utf-8'));
}

/** @param {object} [o] */
function open(o = {}) {
  return openAuditChallenge({ ...TARGET, fingerprint: FP, challenge_commit: HEAD, ...o }, undefined, {
    now: () => new Date('2026-09-03T08:00:00.000Z'),
  });
}

describe('audit gate — store sobre state.json', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-audit-gate-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    writeSeed();
    const mod = await import('../../src/integration/audit.js');
    openAuditChallenge = mod.openAuditChallenge;
    closeAuditChallenge = mod.closeAuditChallenge;
    readAuditGate = mod.readAuditGate;
    clearAuditGate = mod.clearAuditGate;
    gateKey = mod.gateKey;
    GATE_CAP = mod.GATE_CAP;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => writeSeed());

  it('abre un reto con las 10 claves en ORDEN FIJO (byte-determinismo del --json)', () => {
    const r = open();
    assert.equal(r.ok, true);
    const gate = readRawState().audit_gates[gateKey(TARGET)];
    assert.deepEqual(Object.keys(gate), [
      'status',
      'count',
      'fingerprint',
      'evidence',
      'findings',
      'commit',
      'challenge_commit',
      'base_commit',
      'opened_at',
      'audited_at',
    ]);
    assert.equal(gate.status, 'pending');
    assert.equal(gate.count, 1);
    assert.equal(gate.evidence, null);
    assert.equal(gate.findings, null);
    assert.equal(gate.commit, null);
    assert.equal(gate.opened_at, '2026-09-03T08:00:00.000Z');
    assert.equal(gate.audited_at, null);
  });

  it('la clave es la MISMA identidad que la de la cola: (project_path, branch) con NUL', () => {
    assert.equal(gateKey(TARGET), '/repo/kodo\u0000feat/audit');
  });

  it('el contador es ACUMULATIVO — «esta rama necesitó 3 retos» es la señal', () => {
    open();
    open();
    const r = open();
    assert.equal(r.ok && r.value.count, 3);
    assert.equal(readAuditGate(TARGET)?.count, 3);
  });

  it('`opened_at` se conserva entre retos: mide la espera, no el último reto', () => {
    open();
    const r = open({});
    assert.equal(r.ok && r.value.opened_at, '2026-09-03T08:00:00.000Z');
  });

  it('cerrar marca `audited` con evidencia, hallazgos y ANCLA al commit', () => {
    open();
    const r = closeAuditChallenge(TARGET, { evidence: 'artifact', findings: 0, commit: HEAD }, undefined, {
      now: () => new Date('2026-09-03T09:00:00.000Z'),
    });
    assert.equal(r.ok, true);
    const gate = readAuditGate(TARGET);
    assert.equal(gate?.status, 'audited');
    assert.equal(gate?.evidence, 'artifact');
    assert.equal(gate?.findings, 0);
    assert.equal(gate?.commit, HEAD);
    assert.equal(gate?.audited_at, '2026-09-03T09:00:00.000Z');
  });

  it('`findings` negativo o no numérico se normaliza a `null`, nunca a un número inventado', () => {
    open();
    closeAuditChallenge(TARGET, { evidence: 'commit', findings: /** @type {any} */ ('tres'), commit: HEAD });
    assert.equal(readAuditGate(TARGET)?.findings, null);
    open();
    closeAuditChallenge(TARGET, { evidence: 'commit', findings: -1, commit: HEAD });
    assert.equal(readAuditGate(TARGET)?.findings, null);
  });

  it('cerrar un reto que no existe devuelve `not-found`, no crea nada', () => {
    const r = closeAuditChallenge(TARGET, { evidence: 'commit', commit: HEAD });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, 'not-found');
    assert.equal(readAuditGate(TARGET), null);
  });

  it('retirar el reto lo BORRA — su traza durable pasa a ser la entrada de la cola', () => {
    open();
    const r = clearAuditGate(TARGET);
    assert.equal(r.ok && r.value, true);
    assert.equal(readAuditGate(TARGET), null);
    // Idempotente: retirar dos veces no es un error.
    const again = clearAuditGate(TARGET);
    assert.equal(again.ok && again.value, false);
  });

  it('dos ramas del mismo repo son dos retos independientes', () => {
    open();
    openAuditChallenge({ project_path: '/repo/kodo', branch: 'otra', fingerprint: 'c'.repeat(64) });
    assert.equal(readAuditGate(TARGET)?.fingerprint, FP);
    assert.equal(readAuditGate({ project_path: '/repo/kodo', branch: 'otra' })?.fingerprint, 'c'.repeat(64));
  });

  it('un state.json SIN la clave se lee como «cero retos» (guard aditivo)', () => {
    writeSeed();
    assert.equal(readAuditGate(TARGET), null);
    assert.equal(readRawState().audit_gates, undefined, 'leer NO crea la clave');
  });

  it('una clave con forma equivocada no tumba la lectura ni el siguiente reto', () => {
    writeSeed({ audit_gates: 'no soy un objeto' });
    assert.equal(readAuditGate(TARGET), null);
    const r = open();
    assert.equal(r.ok, true);
    assert.equal(readAuditGate(TARGET)?.count, 1);
  });

  it('los retos huérfanos se evictan por edad al pasar de GATE_CAP', () => {
    const gates = {};
    for (let i = 0; i < GATE_CAP + 5; i++) {
      gates[`/repo/kodo\u0000rama-${String(i).padStart(3, '0')}`] = {
        status: 'pending',
        count: 1,
        fingerprint: FP,
        evidence: null,
        findings: null,
        commit: null,
        challenge_commit: null,
        base_commit: null,
        // El más antiguo primero: `rama-000` es el que debe irse.
        opened_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
        audited_at: null,
      };
    }
    writeSeed({ audit_gates: gates });
    open();
    const after = readRawState().audit_gates;
    assert.equal(Object.keys(after).length, GATE_CAP);
    assert.equal(after['/repo/kodo\u0000rama-000'], undefined, 'el más antiguo se fue');
    assert.ok(after[gateKey(TARGET)], 'el reto recién abierto se queda');
  });
});
