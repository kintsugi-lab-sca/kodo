// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

describe('prompt.md — sección GSD renderizada', () => {
  const prompt = readFileSync('src/orchestrator/prompt.md', 'utf-8');

  it('PM1: contiene heading literal "## Sesiones GSD"', () => {
    assert.ok(prompt.includes('## Sesiones GSD'),
      'heading "## Sesiones GSD" debe estar presente');
  });

  it('PM2: contiene comando literal "kodo gsd verify <session-id>"', () => {
    assert.ok(prompt.includes('kodo gsd verify <session-id>'));
  });

  it('PM3: menciona los 4 verdicts como palabras literales', () => {
    for (const v of ['pass', 'fail', 'missing', 'malformed']) {
      assert.ok(new RegExp(`\\b${v}\\b`).test(prompt),
        `verdict "${v}" ausente en prompt.md`);
    }
  });

  it('PM4: referencia los 4 artefactos GSD', () => {
    for (const artifact of ['PROJECT.md', 'ROADMAP.md', 'PLAN.md', 'VERIFICATION.md']) {
      assert.ok(prompt.includes(artifact), `artifact "${artifact}" ausente`);
    }
  });

  it('PM5: conserva el placeholder {{provider_name}}', () => {
    assert.ok(prompt.includes('{{provider_name}}'));
  });

  it('PM6: menciona kodo gsd inspect para debugging', () => {
    assert.ok(prompt.includes('kodo gsd inspect <task-id>'));
  });

  it('PM7: sin frases inglesas típicas de prompts', () => {
    for (const phrase of [/\byou must\b/i, /\bplease\b/i, /\bexecute your\b/i]) {
      assert.ok(!phrase.test(prompt), `frase inglesa prohibida encontrada: ${phrase}`);
    }
  });
});
