// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isReportToProviderEnabled, migrateConfig, needsSetup, DEFAULT_CONFIG } from '../src/config.js';

describe('REPORT-02 — isReportToProviderEnabled', () => {
  // Factory: returns a fake loadConfig that overrides DEFAULT_CONFIG.
  // Avoids fixture filesystem (Pitfall 3 — would touch ~/.kodo/config.json real).
  const fakeLoad = (overrides = {}) => () => ({ ...DEFAULT_CONFIG, ...overrides });

  it('REPORT-02: returns false when config has no workflow section (DEFAULT_CONFIG baseline — archivo no existe)', () => {
    assert.equal(isReportToProviderEnabled(fakeLoad()), false);
  });

  it('REPORT-02: returns false when loadConfig falls back to DEFAULT_CONFIG (JSON corrupto, parse-fail path L126-128)', () => {
    // Simula el fallback de loadConfig: catch → return { ...DEFAULT_CONFIG }
    const corruptFallback = () => ({ ...DEFAULT_CONFIG });
    assert.equal(isReportToProviderEnabled(corruptFallback), false);
  });

  it('REPORT-02: returns false when config exists fully but lacks `workflow` section', () => {
    const configSinWorkflow = () => ({
      ...DEFAULT_CONFIG,
      provider: 'plane',
      providers: { plane: { base_url: 'x', api_key_env: 'X', workspace_slug: 'x', projects: [], states: {} } },
    });
    assert.equal(isReportToProviderEnabled(configSinWorkflow), false);
  });

  it('REPORT-02: returns false for workflow:{} (sección presente pero vacía)', () => {
    assert.equal(isReportToProviderEnabled(fakeLoad({ workflow: {} })), false);
  });

  it('REPORT-02: returns false for workflow.report_to_provider: false (explícito)', () => {
    assert.equal(isReportToProviderEnabled(fakeLoad({ workflow: { report_to_provider: false } })), false);
  });

  it('REPORT-02: returns false for workflow.report_to_provider: "true" (string — fail-closed, strict equality)', () => {
    assert.equal(isReportToProviderEnabled(fakeLoad({ workflow: { report_to_provider: 'true' } })), false);
  });

  it('REPORT-02: returns false for workflow.report_to_provider: 1 (number — fail-closed)', () => {
    assert.equal(isReportToProviderEnabled(fakeLoad({ workflow: { report_to_provider: 1 } })), false);
  });

  it('REPORT-02: returns true ONLY for boolean true', () => {
    assert.equal(isReportToProviderEnabled(fakeLoad({ workflow: { report_to_provider: true } })), true);
  });
});

describe('REPORT-02 — DEFAULT_CONFIG anti-mutation (D-03)', () => {
  it('REPORT-02: DEFAULT_CONFIG must NOT contain `workflow` key (config no auto-migra)', () => {
    assert.equal(
      Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, 'workflow'),
      false,
      'D-03: configs existentes no se reescriben para añadir workflow.{}; helper depende de optional chaining',
    );
  });
});

describe('REPORT-02 — source hygiene (D-05): .report_to_provider only inside src/config.js', () => {
  const SRC_DIR = 'src';
  const HELPER_FILE = join('src', 'config.js');

  /**
   * Recursively list all .js files under src/, excluding src/config.js
   * (the only allowed direct accessor of .report_to_provider).
   */
  function listSrcJsFiles(dir = SRC_DIR) {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...listSrcJsFiles(full));
      } else if (entry.endsWith('.js')) {
        if (full === HELPER_FILE) continue;
        out.push(full);
      }
    }
    return out;
  }

  it('REPORT-02: no other src/**/*.js accesses .report_to_provider directly (anti-inline invariant)', () => {
    const files = listSrcJsFiles();
    const violations = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      // Strip block comments + line comments + JSDoc lines (canonical pattern, stop.test.js L63-67)
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n');
      if (/\.report_to_provider\b/.test(stripped)) {
        violations.push(file);
      }
    }
    assert.deepEqual(
      violations,
      [],
      `Direct access to .report_to_provider found in: ${violations.join(', ')}.\nUse isReportToProviderEnabled() from src/config.js. Direct access to .report_to_provider is allowed only inside the helper.`,
    );
  });
});

describe('SETUP-01 — needsSetup (detección de first-run)', () => {
  // Todos los casos inyectan seams DI (_loadConfig, _configExists, _isApiKeyConfigured)
  // → CERO contacto con el `~/.kodo/` real del operador (dogfooding: config.json/.env
  // reales con secretos vivos). Molde DI de `isReportToProviderEnabled`.
  const planeComplete = () => ({
    provider: 'plane',
    providers: { plane: { base_url: 'https://x', api_key_env: 'PLANE_API_KEY', workspace_slug: 'k-lab' } },
  });

  it('SETUP-01: config.json ausente → true (existsSync-first, sin leer valores)', () => {
    // _loadConfig incompleto por si acaso; el existsSync=false debe cortar antes.
    const result = needsSetup('plane', () => ({ provider: 'plane', providers: {} }), () => false, () => false);
    assert.equal(result, true);
  });

  it('SETUP-01: config existe pero falta la API key del provider activo → true', () => {
    const result = needsSetup('plane', planeComplete, () => true, () => false);
    assert.equal(result, true);
  });

  it('SETUP-01: config existe + key presente pero Plane sin base_url → true (estructural D-03)', () => {
    const cfg = () => ({ provider: 'plane', providers: { plane: { workspace_slug: 'k-lab' } } });
    const result = needsSetup('plane', cfg, () => true, () => true);
    assert.equal(result, true);
  });

  it('SETUP-01: config existe + key presente pero Plane sin workspace_slug → true (estructural D-03)', () => {
    const cfg = () => ({ provider: 'plane', providers: { plane: { base_url: 'https://x' } } });
    const result = needsSetup('plane', cfg, () => true, () => true);
    assert.equal(result, true);
  });

  it('SETUP-01: config completo + key presente + estructurales válidos → false', () => {
    const result = needsSetup('plane', planeComplete, () => true, () => true);
    assert.equal(result, false);
  });

  it('SETUP-01: resuelve el provider activo desde config.provider cuando providerName se omite', () => {
    // Sin providerName → usa config.provider ('plane') para el gate estructural.
    const cfg = () => ({ provider: 'plane', providers: { plane: { base_url: 'https://x', workspace_slug: 'k-lab' } } });
    assert.equal(needsSetup(undefined, cfg, () => true, () => true), false);
  });

  it('SETUP-01 (D-06): provider github con key presente → false (el gate estructural es Plane-only)', () => {
    // github queda fuera del guiado; needsSetup no aplica base_url/workspace_slug a github.
    const cfg = () => ({ provider: 'github', providers: { github: { api_key_env: 'GITHUB_TOKEN' } } });
    assert.equal(needsSetup('github', cfg, () => true, () => true), false);
  });

  it('SETUP-01 HELD-OUT (Pitfall 12): config.json ausente → true AUNQUE loadConfig devuelva DEFAULT_CONFIG válido y la key parezca presente', () => {
    // Prueba anti-falso-negativo: DEFAULT_CONFIG trae un Plane completo (base_url +
    // workspace_slug) y isApiKeyConfigured diría true. Si needsSetup se apoyara en
    // loadConfig() devolvería false (falso negativo en máquina limpia). El existsSync=false
    // DEBE ganar → true.
    const result = needsSetup('plane', () => ({ ...DEFAULT_CONFIG }), () => false, () => true);
    assert.equal(result, true, 'existsSync-first: config.json ausente es first-run pese a DEFAULT_CONFIG válido');
  });
});

describe('SETUP-01 — needsSetup source hygiene (D-12: sin webhook secret; PERSIST-04: sin valor de key)', () => {
  it('SETUP-01 (D-12): el cuerpo de needsSetup NO menciona ninguna env var de webhook secret', () => {
    const source = readFileSync(join('src', 'config.js'), 'utf-8');
    const start = source.indexOf('export function needsSetup');
    assert.ok(start !== -1, 'needsSetup debe existir en src/config.js');
    // Aísla el cuerpo hasta el siguiente `export function`/`export {` para no capturar otros helpers.
    const rest = source.slice(start + 'export function needsSetup'.length);
    const nextExport = rest.search(/\nexport (function|\{)/);
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport);
    assert.ok(!/WEBHOOK/i.test(body), 'D-12: needsSetup no debe referenciar el webhook secret (KODO_WEBHOOK_SECRET_PLANE)');
  });

  it('SETUP-01 (existsSync-first): existsSync(CONFIG_PATH) aparece antes de cualquier lectura de campos estructurales', () => {
    const source = readFileSync(join('src', 'config.js'), 'utf-8');
    const start = source.indexOf('export function needsSetup');
    const rest = source.slice(start);
    const nextExport = rest.slice(1).search(/\nexport (function|\{)/);
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport + 1);
    const existsIdx = body.indexOf('existsSync(CONFIG_PATH)');
    const structuralIdx = body.indexOf('base_url');
    assert.ok(existsIdx !== -1, 'needsSetup debe referenciar existsSync(CONFIG_PATH)');
    assert.ok(structuralIdx === -1 || existsIdx < structuralIdx, 'existsSync(CONFIG_PATH) debe preceder al gate estructural');
  });
});

describe('OPEN-04 — migrateConfig web_url (D-06 resolve-on-read)', () => {
  it('v1→v2 migration carries web_url defaulted to base_url (safe pre-fix behavior)', () => {
    const result = migrateConfig({
      plane: {
        base_url: 'https://api.example.com',
        api_key_env: 'X',
        workspace_slug: 's',
        projects: [],
        trigger_state: 'In Progress',
      },
    });
    assert.equal(result.providers.plane.web_url, 'https://api.example.com');
  });

  it('migrateConfig is idempotent: a v2 config (has providers) is returned unchanged (no web_url injected)', () => {
    const input = { providers: { plane: {} } };
    const result = migrateConfig(input);
    assert.equal(result, input);
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.providers.plane, 'web_url'),
      false,
      'idempotent path must not inject web_url',
    );
  });

  it('DEFAULT_CONFIG.providers.plane has NO web_url key (resolve-on-read default lives at the consumer)', () => {
    assert.equal(
      Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG.providers.plane, 'web_url'),
      false,
      'D-06: web_url is NOT injected into DEFAULT_CONFIG (zero-breaking-change precedent)',
    );
  });
});
