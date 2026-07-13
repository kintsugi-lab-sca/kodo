// @ts-check
//
// test/config-hardening.test.js — Plan 72-02 (HYG-05).
//
// Endurecimiento del pipeline de config (V5/V12/V14 ASVS), cubierto por hallazgo:
//   - M3 (T-72-04): setNestedValue RECHAZA prototype pollution (__proto__/…).
//   - M14 (T-72-07): parseSetArg/parseMapProjectArg preservan `=`/`:` internos.
//   - B5 (T-72-07): loadEnvFile hace strip de comillas emparejadas.
//   - B7 (T-72-06): loadConfig deep-mergea sobre DEFAULT_CONFIG + valida (never-throws).
//   - M5 (T-72-05): writeFileAtomic → 0600 si el contenido lleva una clave `*_secret`.
//
// Convención node:test describe/it + assert/strict (espejo de config-validate.test.js).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setNestedValue, parseSetArg, parseMapProjectArg } from '../src/cli/config-args.js';
import { loadEnvFile, mergeAndValidateConfig, writeFileAtomic, DEFAULT_CONFIG } from '../src/config.js';

describe('M3 (T-72-04) — setNestedValue rechaza prototype pollution', () => {
  it('lanza ante `__proto__` en el path y NO contamina Object.prototype', () => {
    const obj = {};
    assert.throws(() => setNestedValue(obj, '__proto__.polluted', 'x'), /prohibida/);
    // Sin prototype pollution: ningún objeto nuevo hereda `polluted`.
    assert.equal(/** @type {any} */ ({}).polluted, undefined);
    // El objeto destino no fue mutado.
    assert.deepEqual(obj, {});
  });

  it('lanza ante `constructor` y `prototype` en cualquier tramo del path', () => {
    assert.throws(() => setNestedValue({}, 'constructor.x', 'y'), /prohibida/);
    assert.throws(() => setNestedValue({}, 'a.prototype.x', 'y'), /prohibida/);
    assert.throws(() => setNestedValue({}, 'a.b.__proto__', 'y'), /prohibida/);
  });

  it('escribe con normalidad un path legítimo anidado', () => {
    const obj = {};
    setNestedValue(obj, 'plane.workspace_slug', 'klab');
    assert.deepEqual(obj, { plane: { workspace_slug: 'klab' } });
  });
});

describe('M14 (T-72-07) — parseSetArg/parseMapProjectArg preservan separadores internos', () => {
  it('--set token=a=b=c → key `token`, value `a=b=c` (no se trunca)', () => {
    assert.deepEqual(parseSetArg('token=a=b=c'), { key: 'token', value: 'a=b=c' });
  });

  it('--set sin `=` → value undefined (uso inválido para el caller)', () => {
    assert.deepEqual(parseSetArg('soloclave'), { key: 'soloclave', value: undefined });
  });

  it('--set con `=` inicial → key vacía (el caller lo rechaza)', () => {
    assert.deepEqual(parseSetArg('=valor'), { key: '', value: 'valor' });
  });

  it('--map-project id:/home/a:b:c → localPath `/home/a:b:c` (ruta con `:` preservada)', () => {
    assert.deepEqual(parseMapProjectArg('PROJ:/home/a:b:c'), {
      projectId: 'PROJ',
      localPath: '/home/a:b:c',
    });
  });

  it('--map-project sin `:` → localPath undefined (uso inválido para el caller)', () => {
    assert.deepEqual(parseMapProjectArg('soloid'), { projectId: 'soloid', localPath: undefined });
  });
});

describe('B5 (T-72-07) — loadEnvFile hace strip conservador de comillas emparejadas', () => {
  /** Escribe un .env temporal y lo carga con loadEnvFile(envPath) (DI puro). */
  const loadTmpEnv = (content) => {
    const dir = mkdtempSync(join(tmpdir(), 'kodo-hardening-env-'));
    const envPath = join(dir, '.env');
    writeFileSync(envPath, content);
    try {
      loadEnvFile(envPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('KEY="valor con espacios" carga el valor sin las comillas dobles', () => {
    const key = 'KODO_TEST_B5_DOBLE';
    delete process.env[key];
    loadTmpEnv(`${key}="valor con espacios"\n`);
    assert.equal(process.env[key], 'valor con espacios');
    delete process.env[key];
  });

  it("KEY='valor' carga el valor sin las comillas simples", () => {
    const key = 'KODO_TEST_B5_SIMPLE';
    delete process.env[key];
    loadTmpEnv(`${key}='valor'\n`);
    assert.equal(process.env[key], 'valor');
    delete process.env[key];
  });

  it('comilla suelta (solo al inicio) se PRESERVA — el strip es solo de pares emparejados', () => {
    const key = 'KODO_TEST_B5_SUELTA';
    delete process.env[key];
    loadTmpEnv(`${key}="sin-cierre\n`);
    assert.equal(process.env[key], '"sin-cierre');
    delete process.env[key];
  });

  it('comillas desparejadas ("...\'), y comillas internas, se preservan', () => {
    const key = 'KODO_TEST_B5_MIXTA';
    delete process.env[key];
    loadTmpEnv(`${key}="a'\n`);
    assert.equal(process.env[key], `"a'`);
    delete process.env[key];
  });
});

describe('B7 (T-72-06) — mergeAndValidateConfig: deep-merge + warn-and-fallback, nunca crash', () => {
  it('config parcial con max_parallel:-5 → cae al default y rellena TODAS las ramas ausentes', () => {
    const merged = mergeAndValidateConfig({
      providers: { plane: {} },
      claude: { max_parallel: -5 },
    });
    // El valor inválido cayó al default (warn-and-fallback, D-10).
    assert.equal(merged.claude.max_parallel, DEFAULT_CONFIG.claude.max_parallel);
    // Las ramas ausentes en el parcial están rellenas desde DEFAULT_CONFIG.
    assert.equal(merged.server.port, DEFAULT_CONFIG.server.port);
    assert.equal(merged.claude.default_model, DEFAULT_CONFIG.claude.default_model);
    assert.deepEqual(merged.cmux.colors, DEFAULT_CONFIG.cmux.colors);
  });

  it('preserva sub-objetos del usuario sin pisar ramas ausentes (deep-merge, no shallow)', () => {
    const merged = mergeAndValidateConfig({
      providers: { plane: { states: { trigger: 'Custom' } } },
      server: { port: 8080 },
    });
    // El override del usuario se respeta…
    assert.equal(merged.providers.plane.states.trigger, 'Custom');
    assert.equal(merged.server.port, 8080);
    // …sin pisar las hermanas ausentes del MISMO sub-objeto.
    assert.equal(merged.providers.plane.states.review, DEFAULT_CONFIG.providers.plane.states.review);
    assert.equal(merged.server.bind, DEFAULT_CONFIG.server.bind);
    assert.equal(merged.providers.plane.base_url, DEFAULT_CONFIG.providers.plane.base_url);
  });

  it('nunca lanza ante input arbitrario (null, undefined, tipos raros)', () => {
    assert.doesNotThrow(() => mergeAndValidateConfig(null));
    assert.doesNotThrow(() => mergeAndValidateConfig(undefined));
    assert.doesNotThrow(() => mergeAndValidateConfig({ claude: { max_parallel: 'abc' } }));
    assert.doesNotThrow(() => mergeAndValidateConfig({ claude: 42 }));
  });

  it('el resultado NO comparte referencias con DEFAULT_CONFIG (mutar el merge no contamina)', () => {
    const merged = mergeAndValidateConfig({});
    merged.cmux.colors.running = 'MUTADO';
    assert.equal(DEFAULT_CONFIG.cmux.colors.running, 'Amber');
  });

  it('loadConfig end-to-end (subproceso, HOME aislado): config inválida → default + warn NDJSON, exit 0', () => {
    const home = mkdtempSync(join(tmpdir(), 'kodo-hardening-home-'));
    try {
      mkdirSync(join(home, '.kodo'), { recursive: true });
      writeFileSync(
        join(home, '.kodo', 'config.json'),
        JSON.stringify({ providers: { plane: {} }, claude: { max_parallel: -5 } }, null, 2) + '\n',
      );
      const script = "import('./src/config.js').then(c => { const cfg = c.loadConfig(); console.log(JSON.stringify({ mp: cfg.claude.max_parallel, port: cfg.server.port })); });";
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: home },
        encoding: 'utf-8',
      });
      const parsed = JSON.parse(out.trim());
      assert.equal(parsed.mp, DEFAULT_CONFIG.claude.max_parallel, 'max_parallel inválido cae al default');
      assert.equal(parsed.port, DEFAULT_CONFIG.server.port, 'rama server ausente rellena desde DEFAULT_CONFIG');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('M5 (T-72-05) — writeFileAtomic: 0600 si el contenido lleva una clave *_secret', () => {
  it('contenido con "api_key_secret" → fichero final en modo 0600', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kodo-hardening-m5-'));
    try {
      const dest = join(dir, 'config.json');
      writeFileAtomic(dest, JSON.stringify({ api_key_secret: 'x' }) + '\n');
      assert.equal(statSync(dest).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('contenido sin *_secret → NO fuerza 0600 (permisos por umask, como hoy)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kodo-hardening-m5-'));
    try {
      const dest = join(dir, 'plain.json');
      writeFileAtomic(dest, JSON.stringify({ provider: 'plane' }) + '\n');
      // umask típica 022 → 0644. Lo que se asserta es que NO se degradó a 0600
      // (el modo conserva el bit de lectura de grupo, comportamiento previo intacto).
      assert.notEqual(statSync(dest).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('una clave que solo CONTIENE "secret" sin el sufijo `_secret` no dispara el chmod', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kodo-hardening-m5-'));
    try {
      const dest = join(dir, 'near-miss.json');
      writeFileAtomic(dest, JSON.stringify({ secretive_name: 'x', secret: 'y' }) + '\n');
      assert.notEqual(statSync(dest).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
