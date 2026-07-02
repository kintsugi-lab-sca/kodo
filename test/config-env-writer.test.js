// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, statSync, existsSync, readdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { writeEnvVar, validateEnvKey, validateEnvValue, ENV_PATH } from '../src/config.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 — writeEnvVar behavior: merge, permisos, atomicidad, idempotencia
// ─────────────────────────────────────────────────────────────────────────────

describe('SETUP-03 — writeEnvVar: write / upsert / merge', () => {
  it('(SC1) crea .env nuevo con la key si no existía', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      assert.equal(writeEnvVar('PLANE_API_KEY', 'key123', p), true);
      assert.equal(readFileSync(p, 'utf-8'), 'PLANE_API_KEY=key123\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('upsert: reemplaza el valor de una key existente in-place', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      writeEnvVar('PLANE_API_KEY', 'old', p);
      writeEnvVar('PLANE_API_KEY', 'new', p);
      assert.equal(readFileSync(p, 'utf-8'), 'PLANE_API_KEY=new\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(SC2) preserva OTRAS keys al hacer upsert (merge safety — no clobber)', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      // Simula un .env real con múltiples secretos (dogfooding: 2 keys presentes).
      writeFileSync(p, 'PLANE_API_KEY=plane_v1\nPLANE_WEBHOOK_SECRET=whsec_abc\n');
      writeEnvVar('GITHUB_TOKEN', 'ghp_new', p);
      const content = readFileSync(p, 'utf-8');
      assert.equal(content, 'PLANE_API_KEY=plane_v1\nPLANE_WEBHOOK_SECRET=whsec_abc\nGITHUB_TOKEN=ghp_new\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('upsert de una key en medio preserva las de alrededor verbatim', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      writeFileSync(p, 'A=1\nPLANE_API_KEY=old\nB=2\n');
      writeEnvVar('PLANE_API_KEY', 'fresh', p);
      assert.equal(readFileSync(p, 'utf-8'), 'A=1\nPLANE_API_KEY=fresh\nB=2\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserva comentarios y líneas en blanco verbatim (parser naive)', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      writeFileSync(p, '# secrets file\n\nPLANE_API_KEY=old\n# tail comment\n');
      writeEnvVar('PLANE_API_KEY', 'new', p);
      assert.equal(
        readFileSync(p, 'utf-8'),
        '# secrets file\n\nPLANE_API_KEY=new\n# tail comment\n',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('append cuando la key no existe pero sí hay otras', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      writeFileSync(p, 'PLANE_API_KEY=plane\n');
      writeEnvVar('GITHUB_TOKEN', 'ghp', p);
      assert.equal(readFileSync(p, 'utf-8'), 'PLANE_API_KEY=plane\nGITHUB_TOKEN=ghp\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SETUP-03 — writeEnvVar: permisos 0600 (Pitfall 13, LOAD-BEARING)', () => {
  it('(SC4) el .env final es 0600 (-rw-------) inmediatamente tras el write', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      writeEnvVar('PLANE_API_KEY', 'secret', p);
      const mode = statSync(p).mode & 0o777;
      assert.equal(mode, 0o600, `esperado 0600, obtenido 0${mode.toString(8)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('0600 se mantiene tras un upsert (segundo write)', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      writeEnvVar('PLANE_API_KEY', 'v1', p);
      writeEnvVar('PLANE_API_KEY', 'v2', p);
      assert.equal(statSync(p).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SETUP-03 — writeEnvVar: atomicidad (Pitfall 13 rename)', () => {
  it('(SC3) no deja .env.tmp residual tras un write exitoso', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      writeEnvVar('PLANE_API_KEY', 'k', p);
      assert.equal(existsSync(p + '.tmp'), false);
      // El .env es el único fichero generado en el dir.
      assert.deepEqual(readdirSync(dir), ['.env']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('crea el dir padre con recursive si no existe (never-throws path feliz)', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, 'nested', 'deep', '.env');
      assert.equal(writeEnvVar('PLANE_API_KEY', 'k', p), true);
      assert.equal(readFileSync(p, 'utf-8'), 'PLANE_API_KEY=k\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never-throws: devuelve false ante fallo de I/O (destino es un directorio)', () => {
    const dir = makeWorkdir();
    try {
      // El destino ES un directorio existente y NO vacío → renameSync(tmp, envPath)
      // lanza (ENOTEMPTY/EISDIR); writeEnvVar lo captura y devuelve false SIN throw.
      const envAsDir = mkdtempSync(join(dir, 'as-dir-'));
      writeFileSync(join(envAsDir, 'child'), 'x'); // lo hace no-vacío
      let result;
      assert.doesNotThrow(() => { result = writeEnvVar('PLANE_API_KEY', 'v', envAsDir); });
      assert.equal(result, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SETUP-03 — writeEnvVar: idempotencia', () => {
  it('escribir la misma key+valor dos veces produce contenido idéntico', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      writeEnvVar('PLANE_API_KEY', 'same', p);
      const first = readFileSync(p, 'utf-8');
      writeEnvVar('PLANE_API_KEY', 'same', p);
      const second = readFileSync(p, 'utf-8');
      assert.equal(second, first);
      assert.equal(second, 'PLANE_API_KEY=same\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no acumula líneas en blanco a través de escrituras sucesivas', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      writeEnvVar('A', 'a', p);
      writeEnvVar('B', 'b', p);
      writeEnvVar('A', 'a2', p);
      assert.equal(readFileSync(p, 'utf-8'), 'A=a2\nB=b\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4 — Integración / invariantes: DI (Pitfall 21811) + boundary (Pitfall 11)
// ─────────────────────────────────────────────────────────────────────────────

describe('SETUP-03 — invariante DI (Pitfall 21811: KODO_DIR cacheado al import)', () => {
  it('el default ENV_PATH apunta a ~/.kodo/.env (contrato de producción)', () => {
    assert.equal(ENV_PATH, join(homedir(), '.kodo', '.env'));
  });

  it('con envPath inyectado, NO se toca el ~/.kodo/.env real (aislamiento)', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      writeEnvVar('KODO_TEST_SENTINEL', 'sentinel', p);
      // El write cayó en el tmpdir, no en el ENV_PATH cacheado.
      assert.equal(readFileSync(p, 'utf-8'), 'KODO_TEST_SENTINEL=sentinel\n');
      assert.equal(existsSync(join(dir, '.env')), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SETUP-04 — boundary de fuga (Pitfall 11): writeEnvVar es in-proceso', () => {
  // Blindaje source-level (molde del anti-inline de config.test.js): el writer del
  // secreto NUNCA puede shell-out. El vector de mayor riesgo (P11) es el argv de un
  // subprocess: `execFile('kodo', ['config','--api-key', SECRET])`. La escritura es
  // SIEMPRE en-proceso (writeFileSync/renameSync), jamás vía child_process.
  const source = readFileSync(new URL('../src/config.js', import.meta.url), 'utf-8');
  const body = source.slice(
    source.indexOf('export function writeEnvVar'),
    source.indexOf('export {', source.indexOf('export function writeEnvVar')),
  );

  it('config.js no importa child_process (ningún vector de shell-out del secreto)', () => {
    assert.doesNotMatch(source, /child_process/);
  });

  it('el cuerpo de writeEnvVar no usa execFile/spawn/exec (escritura in-proceso)', () => {
    assert.doesNotMatch(body, /\b(execFile|spawn|execSync|exec)\s*\(/);
  });

  it('el cuerpo de writeEnvVar no loguea el valor (console.*)', () => {
    assert.doesNotMatch(body, /console\./);
  });
});
