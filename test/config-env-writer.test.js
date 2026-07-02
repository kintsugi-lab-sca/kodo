// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, statSync, existsSync, readdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeEnvVar, validateEnvKey, validateEnvValue } from '../src/config.js';

// DI puro (obs. 21811/22683): writeEnvVar recibe `envPath` por parámetro, así el
// test lo ejercita contra un tmpdir SIN depender de KODO_DIR/HOME (cacheados al
// import) ni TOCAR el ~/.kodo/.env real del dev (dogfooding: daemon live corriendo).
function makeWorkdir() {
  return mkdtempSync(join(tmpdir(), 'kodo-env-'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 2 — Input validation (Pitfall 14: validar+rechazar, nunca escapar)
// ─────────────────────────────────────────────────────────────────────────────

describe('SETUP-03 — validateEnvKey (Pitfall 14)', () => {
  it('acepta claves de provider reales (Plane, GitHub)', () => {
    assert.equal(validateEnvKey('PLANE_API_KEY'), true);
    assert.equal(validateEnvKey('GITHUB_TOKEN'), true);
    assert.equal(validateEnvKey('PLANE_WEBHOOK_SECRET'), true);
  });

  it('rechaza clave vacía', () => {
    assert.equal(validateEnvKey(''), false);
  });

  it("rechaza clave con '#' (el parser saltaría la línea entera)", () => {
    assert.equal(validateEnvKey('KEY#X'), false);
  });

  it("rechaza clave con '=' (el parser partiría por el primer '=')", () => {
    assert.equal(validateEnvKey('KEY=X'), false);
  });

  it('rechaza clave con espacios (leading/interno/trailing)', () => {
    assert.equal(validateEnvKey(' KEY'), false);
    assert.equal(validateEnvKey('MY KEY'), false);
    assert.equal(validateEnvKey('KEY '), false);
  });

  it('rechaza clave con newline/CR (vector de inyección de líneas)', () => {
    assert.equal(validateEnvKey('KEY\nEVIL'), false);
    assert.equal(validateEnvKey('KEY\rX'), false);
  });

  it('rechaza no-strings (defensivo)', () => {
    // @ts-expect-error prueba de robustez ante input no-string
    assert.equal(validateEnvKey(null), false);
    // @ts-expect-error prueba de robustez ante input no-string
    assert.equal(validateEnvKey(123), false);
  });
});

describe('SETUP-03 — validateEnvValue (Pitfall 14)', () => {
  it('acepta valores de API key reales (sin caracteres especiales)', () => {
    assert.equal(validateEnvValue('plane_api_abc123def456'), true);
    assert.equal(validateEnvValue('ghp_XXXXXXXXXXXXXXXXXXXX'), true);
  });

  it('rechaza valor vacío (SETUP-04: no cuenta como "configurado")', () => {
    assert.equal(validateEnvValue(''), false);
  });

  it("rechaza valor con '#', '=' o whitespace", () => {
    assert.equal(validateEnvValue('secret#1'), false);
    assert.equal(validateEnvValue('a=b'), false);
    assert.equal(validateEnvValue('has space'), false);
  });

  it('rechaza valor multilínea (clobber de otras keys — boundary PERSIST-04)', () => {
    assert.equal(validateEnvValue('good\nGITHUB_TOKEN=stolen'), false);
  });
});

describe('SETUP-03 — writeEnvVar rechaza input inválido (throw TypeError)', () => {
  it('throws TypeError ante clave inválida', () => {
    const dir = makeWorkdir();
    try {
      assert.throws(() => writeEnvVar('BAD=KEY', 'v', join(dir, '.env')), TypeError);
      // El fichero NO debe haberse creado ante input inválido.
      assert.equal(existsSync(join(dir, '.env')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws TypeError ante valor inválido (incl. vacío)', () => {
    const dir = makeWorkdir();
    try {
      assert.throws(() => writeEnvVar('GOOD_KEY', 'bad value', join(dir, '.env')), TypeError);
      assert.throws(() => writeEnvVar('GOOD_KEY', '', join(dir, '.env')), TypeError);
      assert.equal(existsSync(join(dir, '.env')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws TypeError ante valor multilínea (no puede inyectar líneas)', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      writeEnvVar('PLANE_API_KEY', 'legit', p);
      assert.throws(() => writeEnvVar('GITHUB_TOKEN', 'x\nPLANE_API_KEY=hijacked', p), TypeError);
      // La key legítima previa sigue intacta; nada fue clobbeado.
      assert.equal(readFileSync(p, 'utf-8'), 'PLANE_API_KEY=legit\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
