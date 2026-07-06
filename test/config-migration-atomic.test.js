// @ts-check
//
// test/config-migration-atomic.test.js — Phase 70 Plan 03 Task 3 (CONC-07 / D-14).
//
// `migrateConfigIfNeeded` (src/config.js) persiste el config migrado v1→v2 vía
// `writeFileAtomic` (tmp+rename), NO un `writeFileSync` directo: un crash a mitad de
// la escritura no puede dejar un `config.json` truncado/corrupto (audit M16).
//
// HOME-isolation + import DINÁMICO POST-HOME: config.js cachea CONFIG_PATH desde
// homedir() al module-load. Un import estático filtraría al `~/.kodo` real del dev.
// Espejo de test/state/save-state-atomic.test.js.
//
// La atomicidad (tmp+rename, sin torn reader) se evidencia igual que en
// save-state-atomic: tras la migración el config.json es JSON válido y NO queda
// residuo `config.json.tmp` (el rename lo consumió).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
let loadConfig;

const KODO_REL = ['.kodo'];
const CONFIG_REL = ['.kodo', 'config.json'];

/** Config v1 (schema legacy, sin `providers`) → dispara migrateConfigIfNeeded. */
function configV1() {
  return {
    plane: {
      base_url: 'https://tasks.example.com',
      api_key_env: 'PLANE_API_KEY',
      workspace_slug: 'k-lab',
      projects: ['p1'],
      trigger_state: 'In Progress',
      review_state: 'In review',
      done_state: 'Done',
    },
  };
}

describe('migrateConfigIfNeeded atomic tmp+rename (CONC-07 / D-14)', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-cfgmig-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, ...KODO_REL), { recursive: true });
    // Escribe el config v1 ANTES del import dinámico.
    writeFileSync(join(tmpHome, ...CONFIG_REL), JSON.stringify(configV1(), null, 2) + '\n');
    // Import dinámico POST-HOME: CONFIG_PATH cacheado resuelve al tmpdir aislado.
    const mod = await import('../src/config.js');
    loadConfig = mod.loadConfig;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it('migra v1→v2, deja config.json válido (no truncado), .bak presente, sin residuo .tmp', () => {
    const migrated = loadConfig(); // dispara migrateConfigIfNeeded

    // (1) El resultado en memoria está migrado.
    assert.ok(migrated.providers, 'el config migrado tiene la clave `providers`');
    assert.equal(migrated.providers.plane.base_url, 'https://tasks.example.com');
    assert.equal(migrated.providers.plane.workspace_slug, 'k-lab');
    assert.equal(migrated.providers.plane.states.trigger, 'In Progress');

    // (2) config.json en disco es JSON VÁLIDO (no truncado por el swap atómico).
    const onDiskRaw = readFileSync(join(tmpHome, ...CONFIG_REL), 'utf-8');
    const onDisk = JSON.parse(onDiskRaw); // lanzaría si estuviera truncado
    assert.ok(onDisk.providers, 'config.json persistido contiene `providers` (migración escrita)');

    // (3) El backup .bak existe (contiene el v1 original).
    assert.ok(existsSync(join(tmpHome, '.kodo', 'config.json.bak')), 'backup config.json.bak creado');

    // (4) NO queda residuo `.tmp` — el renameSync de writeFileAtomic lo consumió.
    //     Ésta es la firma observable del patrón atómico tmp+rename (no torn reader).
    const files = readdirSync(join(tmpHome, '.kodo'));
    const tmpResidue = files.filter((f) => f.endsWith('.tmp'));
    assert.equal(tmpResidue.length, 0, `no debe quedar residuo .tmp; encontré: ${files.join(', ')}`);
  });

  it('segunda carga (ya migrado) es idempotente: no re-migra ni deja .tmp', () => {
    const again = loadConfig();
    assert.ok(again.providers, 'ya tiene providers → migrateConfigIfNeeded no hace nada');
    const files = readdirSync(join(tmpHome, '.kodo'));
    assert.equal(files.filter((f) => f.endsWith('.tmp')).length, 0, 'sin residuo .tmp en la segunda carga');
  });
});
