// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isReportToProviderEnabled, migrateConfig, DEFAULT_CONFIG } from '../src/config.js';

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
