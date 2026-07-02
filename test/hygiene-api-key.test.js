// @ts-check
//
// Phase 67-03 (SETUP-03/04, D-08, Pitfall 11 — LOAD-BEARING UAT).
//
// Grep de higiene source-level: la prueba de que el VALOR de la API key jamás
// alcanza ninguno de los 5 sinks de fuga. Es el UAT load-bearing de toda la fase
// (P11): si este test pasa, Phase 68 puede usar el masked input + writeEnvVar sin
// filtrar el secreto a ningún vector de render/log/argv.
//
// Los 5 sinks (67-CONTEXT D-08):
//   1. argv de execFile/spawn/child_process (el más peligroso: shell-out)
//   2. console.* (fuga a stdout)
//   3. logger.*/NDJSON (fuga al fichero de logs)
//   4. saveConfig/config.json (fuga al fichero de config, viola PERSIST-04)
//   5. snapshot del overlay TUI (fuga a scrollback / cross-overlay)
//
// DISEÑO (anti falso-positivo Y anti falso-negativo, ver critical_safety_guardrail):
//   - Se busca el VALOR del secreto llegando a un sink, NO la mención legítima del
//     NOMBRE de la key. Identificadores como `PLANE_API_KEY`, `api_key_env`,
//     `isApiKeyConfigured` en fuente son esperados y NO deben marcarse.
//   - Un "carrier" del valor resuelto es: `process.env[...]` (acceso dinámico que
//     resuelve el secreto), `process.env.*_API_KEY|*_TOKEN|*_SECRET`, o un flag CLI
//     `--api-key`/`--token` (el valor pasaría como argv). En el carril del dashboard
//     el carrier es el `buffer` enmascarado (valor real en memoria).
//   - Un "leak" = un carrier DENTRO de la lista de argumentos de un sink (`[^)]*`
//     hasta el primer `)`), no la mera co-ocurrencia en el fichero.
//   - Debe PASAR ahora (tras 67-01/67-02 no hay fugas) y FALLAR si un cambio futuro
//     enchufa el valor a un sink. El bloque "detector no es trivial" lo demuestra
//     ejercitando fixtures sintéticos con fuga (debe marcar) y limpios (no marca).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { writeEnvVar } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SRC = join(REPO, 'src');

/**
 * Elimina comentarios de bloque + de línea + continuaciones JSDoc, para que las
 * MENCIONES del secreto en comentarios no cuenten como fuga.
 * Mirror canónico de test/labels-hygiene.test.js:18-24 y dispatcher-isolation.test.js.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

/** Lista recursiva de todos los .js bajo `dir`. */
function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJsFiles(full));
    else if (st.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}

// ── Carrier del VALOR resuelto del secreto (nunca el NOMBRE de la key) ──────────
// `process.env[...]` (acceso dinámico → resuelve el valor), env vars nombradas que
// terminan en API_KEY/TOKEN/SECRET, o un flag CLI que llevaría el valor por argv.
const SECRET = String.raw`(?:process\.env\s*\[|process\.env\.\w*(?:API_KEY|TOKEN|SECRET)\b|--?(?:api[-_]?key|token)\b)`;

// ── Los 5 sinks. `[^)]*` exige que el carrier esté DENTRO de los args del sink ──
const SINKS = {
  'argv (execFile/spawn/child_process)': String.raw`\b(?:execFile|execFileSync|exec|execSync|spawn|spawnSync|fork)\s*\([^)]*` + SECRET,
  'console.*': String.raw`\bconsole\.\w+\s*\([^)]*` + SECRET,
  'logger.*/NDJSON': String.raw`\b(?:logger\.\w+|logEvent|appendFileSync|appendFile)\s*\([^)]*` + SECRET,
  'saveConfig/config.json': String.raw`\bsaveConfig\s*\([^)]*` + SECRET,
  'overlay snapshot': String.raw`\bsetOverlaySnapshot\s*\([^)]*` + SECRET,
};

/**
 * Escanea texto (ya sin comentarios) buscando fugas del valor resuelto a los 5 sinks.
 * @returns {{sink: string, line: number, snippet: string}[]}
 */
function scanResolvedSecretLeaks(text) {
  const violations = [];
  for (const [sink, pattern] of Object.entries(SINKS)) {
    const re = new RegExp(pattern, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      violations.push({ sink, line, snippet: m[0].slice(0, 80).replace(/\n/g, ' ') });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return violations;
}

describe('SETUP-03/04 — grep de higiene: el valor resuelto del secreto no alcanza los 5 sinks (D-08, P11)', () => {
  it('ningún src/**/*.js filtra process.env[secret]/--api-key a argv/console/logger/config.json/overlay', () => {
    const files = listJsFiles(SRC);
    const violations = [];
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, 'utf-8'));
      for (const v of scanResolvedSecretLeaks(stripped)) {
        violations.push(`${relative(REPO, file)}:${v.line} [${v.sink}] → ${v.snippet}`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      'El VALOR del secreto llega a un sink de fuga:\n  ' + violations.join('\n  ') +
        '\nEl secreto debe escribirse SOLO en-proceso vía writeEnvVar; jamás log/argv/config.json/snapshot.',
    );
  });
});

describe('SETUP-03 — grep de higiene: el buffer enmascarado del dashboard no fluye a ningún sink (P11/P16)', () => {
  // En el carril del masked input el carrier del secreto es el `buffer` (valor real
  // en memoria). Su única salida legítima es `onSaveApiKey(apiKeyEnv, buffer)` → writeEnvVar.
  // NUNCA debe entrar a console/logger/exec/saveConfig/overlay snapshot.
  const BUFFER_SINK = String.raw`\b(?:console\.\w+|logger\.\w+|logEvent|execFile\w*|spawn\w*|exec\w*|fork|saveConfig|setOverlaySnapshot)\s*\([^)]*\bbuffer\b`;
  const dashboardFiles = [
    join(SRC, 'cli', 'dashboard', 'App.js'),
    join(SRC, 'cli', 'dashboard', 'SessionTable.js'),
  ];

  it('ni App.js ni SessionTable.js pasan `buffer` a un sink de fuga', () => {
    const violations = [];
    for (const file of dashboardFiles) {
      const stripped = stripComments(readFileSync(file, 'utf-8'));
      const re = new RegExp(BUFFER_SINK, 'gi');
      let m;
      while ((m = re.exec(stripped)) !== null) {
        const line = stripped.slice(0, m.index).split('\n').length;
        violations.push(`${relative(REPO, file)}:${line} → ${m[0].slice(0, 80).replace(/\n/g, ' ')}`);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
    assert.deepEqual(
      violations,
      [],
      'El buffer enmascarado (secreto en memoria) llega a un sink:\n  ' + violations.join('\n  ') +
        '\nEl buffer solo debe salir por onSaveApiKey → writeEnvVar.',
    );
  });
});

describe('SETUP-04 — grep de higiene: sin shell-out del secreto (P11, el vector de mayor riesgo)', () => {
  it('ningún src/**/*.js construye un argv `--api-key`/`--token` (shell-out del secreto)', () => {
    // El vector de mayor riesgo: `execFile('kodo', ['config','--api-key', SECRET])`.
    // Escritura SIEMPRE en-proceso (writeEnvVar), jamás vía flag CLI.
    const files = listJsFiles(SRC);
    const FLAG = /['"]--?(?:api[-_]?key|token)['"]/i;
    const violations = [];
    for (const file of files) {
      const lines = stripComments(readFileSync(file, 'utf-8')).split('\n');
      lines.forEach((line, i) => {
        if (FLAG.test(line)) violations.push(`${relative(REPO, file)}:${i + 1} → ${line.trim().slice(0, 80)}`);
      });
    }
    assert.deepEqual(violations, [], 'Flag CLI de secreto encontrado (shell-out prohibido):\n  ' + violations.join('\n  '));
  });

  it('config.js NO importa child_process (regresión del boundary in-proceso de 67-01)', () => {
    const source = readFileSync(join(SRC, 'config.js'), 'utf-8');
    assert.doesNotMatch(source, /child_process/, 'config.js debe escribir el secreto solo en-proceso');
  });
});

describe('SETUP-03/04 — el detector de fugas NO es trivial (prueba positiva y negativa)', () => {
  // Guardrail: "Do not write a test that trivially always passes." Ejercitamos el
  // detector contra fixtures sintéticos para probar que realmente marca fugas.
  it('marca un fixture CON fuga en los 5 sinks', () => {
    const leaky = [
      `execFile('kodo', ['config', '--api-key', process.env.PLANE_API_KEY]);`,
      `console.log('key=' + process.env[apiKeyEnv]);`,
      `logger.info(process.env.GITHUB_TOKEN);`,
      `saveConfig({ apiKey: process.env[apiKeyEnv] });`,
      `setOverlaySnapshot({ secret: process.env.PLANE_WEBHOOK_SECRET });`,
    ].join('\n');
    const sinksHit = new Set(scanResolvedSecretLeaks(leaky).map((v) => v.sink));
    assert.equal(sinksHit.size, 5, `esperado marcar los 5 sinks, marcó: ${[...sinksHit].join(', ')}`);
  });

  it('NO marca menciones legítimas del NOMBRE de la key ni el uso in-proceso', () => {
    const clean = [
      `const apiKeyEnv = configSnapshot?.providers?.[provider]?.api_key_env;`,
      `const client = new PlaneClient({ apiKey: process.env[apiKeyEnv] });`, // construir cliente in-proceso: OK
      `if (isApiKeyConfigured('plane')) console.log('API key configurada');`, // NOMBRE, no VALOR
      `const ok = writeEnvVar(apiKeyEnv, buffer);`,
    ].join('\n');
    assert.deepEqual(scanResolvedSecretLeaks(clean), [], 'falso positivo: marcó uso legítimo del nombre de la key');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2 — Permisos 0600 (mode & 0o177 === 0) vía DI temp path (Pitfall 13)
// ─────────────────────────────────────────────────────────────────────────────

/** DOGFOODING: SIEMPRE DI a un tmpdir; jamás el ~/.kodo/.env real (daemon live). */
function makeWorkdir() {
  return mkdtempSync(join(tmpdir(), 'kodo-hygiene-'));
}

describe('SETUP-03 — permisos del .env: sin bits de grupo/otros ni ejecución (mode & 0o177 === 0)', () => {
  it('tras writeEnvVar el .env es 0600: mode & 0o177 === 0', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      // Guardrail: asertar que escribimos al temp path, NUNCA al real.
      assert.notEqual(p, resolve(process.env.HOME || '', '.kodo', '.env'));
      writeEnvVar('PLANE_API_KEY', 'test_value', p);
      const mode = statSync(p).mode;
      assert.equal(mode & 0o177, 0, `esperado sin bits grupo/otros/exec, obtenido 0${(mode & 0o777).toString(8)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 — Seguridad atómica: 100 escrituras rápidas, sin .env.tmp residual
// ─────────────────────────────────────────────────────────────────────────────

describe('SETUP-03 — seguridad atómica: 100 escrituras rápidas no dejan .env.tmp (Pitfall 13)', () => {
  it('100 writeEnvVar sucesivos → sin residual .env.tmp, .env final parseable y 0600', () => {
    const dir = makeWorkdir();
    try {
      const p = join(dir, '.env');
      // Guardrail: DI a temp path; un loop de 100 writes contra el .env real sería catastrófico.
      assert.notEqual(p, resolve(process.env.HOME || '', '.kodo', '.env'));
      for (let i = 0; i < 100; i++) {
        assert.equal(writeEnvVar('PLANE_API_KEY', `secret_${i}`, p), true, `write #${i} falló`);
      }
      // Sin .env.tmp residual y el .env es el ÚNICO fichero del dir.
      assert.equal(existsSync(p + '.tmp'), false, '.env.tmp residual tras 100 writes');
      assert.deepEqual(readdirSync(dir), ['.env'], 'artefactos inesperados en el dir');
      // Final parseable: exactamente la última key=value, upsert (no acumulación).
      assert.equal(readFileSync(p, 'utf-8'), 'PLANE_API_KEY=secret_99\n');
      // Perms 0600 se mantienen tras el bombardeo.
      assert.equal(statSync(p).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
