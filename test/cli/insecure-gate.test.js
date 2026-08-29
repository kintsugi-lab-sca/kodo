// @ts-check
//
// test/cli/insecure-gate.test.js — KODO-52.
//
// Cubre el gate ambiental de `kodo start --insecure` en dos niveles:
//   (A) unit PURO sobre checkInsecureGate (sin process.env, sin spawn),
//   (B) integración out-of-process sobre `bin/kodo start --insecure` — que es donde
//       vive el criterio de éxito real (exit 1 sin la env var / warning con ella).
//
// HOME isolation: mismo patrón que test/cli/kodo-start-regression.test.js — el HOME
// va por env al proceso hijo, nunca se toca el del runner.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkInsecureGate, ALLOW_INSECURE_ENV } from '../../src/cli/insecure-gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

// Config mínima válida: provider plane con projects:[] → provider.init() queda
// OFFLINE (espejo de kodo-start-regression.test.js:38-52).
const MINIMAL_CONFIG = {
  provider: 'plane',
  providers: {
    plane: {
      base_url: 'http://127.0.0.1:1',
      web_url: 'http://127.0.0.1:1',
      api_key_env: 'PLANE_API_KEY',
      workspace_slug: 'test',
      projects: [],
      states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
    },
  },
  server: { port: 0, idle_threshold_min: 5, stuck_threshold_min: 30 },
};

function writeConfig(home) {
  mkdirSync(join(home, '.kodo'), { recursive: true });
  writeFileSync(join(home, '.kodo', 'config.json'), JSON.stringify(MINIMAL_CONFIG, null, 2));
}

/**
 * Env sin ningún bypass heredado del runner (secret, KODO_DEV, la propia env var)
 * y CON la API key del provider inyectada.
 *
 * KODO-57: `startServer` resuelve el provider (src/server.js:315) y el constructor de
 * `PlaneClient` muere con «Plane API key not found» si `PLANE_API_KEY` no está en el
 * env del hijo. Antes la key llegaba por herencia del `~/.kodo/.env` del operador —
 * en cualquier máquina limpia (CI, contenedor Linux) el test moría por un motivo
 * ajeno a lo que mide. La key es sintética y NUNCA sale a red: `projects: []` deja
 * `provider.init()` OFFLINE.
 */
function scrubbedEnv(extra = {}) {
  const env = { ...process.env };
  delete env.KODO_DEV;
  delete env.PLANE_WEBHOOK_SECRET;
  delete env[ALLOW_INSECURE_ENV];
  for (const k of Object.keys(env)) {
    if (k.startsWith('KODO_WEBHOOK_SECRET_')) delete env[k];
  }
  // Sobrescribe la key REAL del operador si la hubiera: el test no debe usarla.
  env[MINIMAL_CONFIG.providers.plane.api_key_env] = 'kodo-test-plane-api-key';
  return { ...env, ...extra };
}

describe('insecure gate — checkInsecureGate (puro)', () => {
  it('sin flag: deja pasar y no dice nada (arranque normal intacto)', () => {
    for (const insecure of [false, undefined]) {
      const v = checkInsecureGate({ insecure, env: {} });
      assert.deepEqual(v, { allowed: true, blocked: false, message: null });
    }
  });

  it('sin flag: la env var por sí sola NO cambia nada', () => {
    const v = checkInsecureGate({ insecure: false, env: { [ALLOW_INSECURE_ENV]: '1' } });
    assert.equal(v.allowed, true);
    assert.equal(v.message, null);
  });

  it('flag sin la env var: bloquea con mensaje accionable', () => {
    const v = checkInsecureGate({ insecure: true, env: {} });
    assert.equal(v.allowed, false);
    assert.equal(v.blocked, true);
    assert.match(String(v.message), new RegExp(`${ALLOW_INSECURE_ENV}=1`));
    // El mensaje debe nombrar la alternativa correcta, no solo el bypass.
    assert.match(String(v.message), /KODO_WEBHOOK_SECRET_/);
  });

  it('flag + KODO_ALLOW_INSECURE=1: permite y devuelve warning visible', () => {
    const v = checkInsecureGate({ insecure: true, env: { [ALLOW_INSECURE_ENV]: '1' } });
    assert.equal(v.allowed, true);
    assert.equal(v.blocked, false);
    assert.match(String(v.message), /MODO INSEGURO/);
  });

  it('flag + KODO_ALLOW_INSECURE=" 1 ": el trim autoriza (espacios de shell)', () => {
    const v = checkInsecureGate({ insecure: true, env: { [ALLOW_INSECURE_ENV]: ' 1 ' } });
    assert.equal(v.allowed, true);
  });

  it('flag + valores que NO son exactamente "1": siguen bloqueados', () => {
    for (const raw of ['', '0', 'true', 'yes', 'on', '11', 'sí']) {
      const v = checkInsecureGate({ insecure: true, env: { [ALLOW_INSECURE_ENV]: raw } });
      assert.equal(v.blocked, true, `"${raw}" no debe autorizar el modo inseguro`);
    }
  });
});

describe('insecure gate — `kodo start --insecure` (integración)', () => {
  it('sin KODO_ALLOW_INSECURE: exit 1 y mensaje accionable en stderr', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-insecure-gate-'));
    try {
      writeConfig(tmpHome);
      const res = spawnSync(process.execPath, [KODO_BIN, 'start', '--insecure'], {
        env: scrubbedEnv({ HOME: tmpHome, NO_COLOR: '1' }),
        encoding: 'utf-8',
        timeout: 15000,
      });
      assert.equal(res.status, 1, `esperado exit 1, obtenido ${res.status}. stderr: ${res.stderr}`);
      assert.match(res.stderr, new RegExp(`${ALLOW_INSECURE_ENV}=1`));
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('con KODO_ALLOW_INSECURE=1: imprime el warning y arranca (no muere en el gate)', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-insecure-ok-'));
    writeConfig(tmpHome);
    const child = spawn(process.execPath, [KODO_BIN, 'start', '--insecure', '-p', '0'], {
      env: scrubbedEnv({ HOME: tmpHome, NO_COLOR: '1', [ALLOW_INSECURE_ENV]: '1' }),
    });
    try {
      let stderr = '';
      /** @type {number|null} */ let exitCode = null;
      child.stderr.on('data', (b) => { stderr += String(b); });
      child.stdout.on('data', () => {});
      child.on('exit', (code) => { exitCode = code; });

      // Espera al warning (o a que el proceso muera, lo que ocurra antes).
      const start = Date.now();
      while (!/MODO INSEGURO/.test(stderr) && exitCode === null && Date.now() - start < 15000) {
        await new Promise((r) => setTimeout(r, 50));
      }

      assert.notEqual(exitCode, 1, `el gate no debe bloquear con la env var puesta. stderr: ${stderr}`);
      assert.match(stderr, /MODO INSEGURO/, `esperado warning de modo inseguro. stderr: ${stderr}`);
    } finally {
      try { child.kill('SIGKILL'); } catch {}
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
