// @ts-check
//
// test/cli/config-set-raw.test.js — WR-05 (72-review).
//
// `kodo config --set` debe leer/mutar/guardar el config CRUDO de disco (loadRawConfig),
// NO el config MERGED que devuelve loadConfig() tras B7. Persistir el merge congelaría
// todos los defaults de DEFAULT_CONFIG en ~/.kodo/config.json (pinning): los cambios
// futuros de los defaults dejarían de aplicar, y amplificaría CR-01 persistiendo el host
// hardcodeado como si fuera una elección explícita del operador.
//
// E2E por subproceso con HOME aislado (bin/kodo lee ~/.kodo). Se afirma que el fichero
// persistido contiene SOLO la clave puesta, sin el bloque providers.plane ni cmux.binary.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin/kodo', import.meta.url));
const REPO = fileURLToPath(new URL('../..', import.meta.url));

function runSet(home, arg) {
  return execFileSync(process.execPath, [BIN, 'config', '--set', arg], {
    cwd: REPO,
    env: { ...process.env, HOME: home },
    encoding: 'utf-8',
  });
}

describe('WR-05 — kodo config --set no persiste el config MERGED (sin pinning de defaults)', () => {
  it('config ausente + --set: persiste SOLO la clave puesta (no los defaults)', () => {
    const home = mkdtempSync(join(tmpdir(), 'kodo-wr05-'));
    try {
      runSet(home, 'claude.default_model=sonnet');
      const onDisk = JSON.parse(readFileSync(join(home, '.kodo', 'config.json'), 'utf-8'));
      assert.deepEqual(onDisk, { claude: { default_model: 'sonnet' } }, 'solo la clave puesta se persiste');
      // Ningún default pinneado: sin bloque providers.plane (host hardcodeado) ni cmux.binary.
      assert.equal(onDisk.providers, undefined, 'no se pinnea providers.plane (evita persistir el host hardcodeado, CR-01)');
      assert.equal(onDisk.cmux, undefined, 'no se pinnea cmux.binary');
      assert.equal(onDisk.server, undefined, 'no se pinnean los puertos default');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('config parcial preexistente + --set: preserva lo del usuario y añade la clave, sin inyectar defaults', () => {
    const home = mkdtempSync(join(tmpdir(), 'kodo-wr05-'));
    try {
      mkdirSync(join(home, '.kodo'), { recursive: true });
      writeFileSync(
        join(home, '.kodo', 'config.json'),
        JSON.stringify({ provider: 'plane', providers: { plane: { api_key_env: 'PLANE_API_KEY' } } }, null, 2) + '\n',
      );
      runSet(home, 'claude.max_parallel=5');
      const onDisk = JSON.parse(readFileSync(join(home, '.kodo', 'config.json'), 'utf-8'));
      // La clave nueva se añade…
      assert.equal(onDisk.claude.max_parallel, '5');
      // …y lo del usuario se preserva verbatim (sin rellenar base_url/workspace_slug con defaults).
      assert.deepEqual(onDisk.providers.plane, { api_key_env: 'PLANE_API_KEY' }, 'no se materializan base_url/workspace_slug default');
      assert.equal(onDisk.cmux, undefined, 'no se pinnea cmux.binary');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
