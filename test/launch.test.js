// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyReportingGate } from '../src/orchestrator/launch.js';

describe('REPORT-03 — applyReportingGate helper (gating infrastructure)', () => {
  const SAMPLE = [
    '# Header',
    '',
    'Some prose before the block.',
    '',
    '<!-- BEGIN reporting -->',
    '## Sub-issue reporting',
    '',
    'Reporting body.',
    '<!-- END reporting -->',
    '',
    'Some prose after the block.',
  ].join('\n');

  it('LG1: enabled=true preserves the block (markers + body intact)', () => {
    const out = applyReportingGate(SAMPLE, true);
    assert.equal(out, SAMPLE, 'enabled=true must return the prompt unchanged');
  });

  it('LG2: enabled=false strips the block AND its markers', () => {
    const out = applyReportingGate(SAMPLE, false);
    assert.ok(!out.includes('<!-- BEGIN reporting -->'),
      'BEGIN marker must be removed');
    assert.ok(!out.includes('<!-- END reporting -->'),
      'END marker must be removed');
    assert.ok(!out.includes('## Sub-issue reporting'),
      'block heading must be removed');
    assert.ok(!out.includes('Reporting body.'),
      'block body must be removed');
  });

  it('LG3: enabled=false preserves prose outside the block', () => {
    const out = applyReportingGate(SAMPLE, false);
    assert.ok(out.includes('Some prose before the block.'),
      'pre-block prose must be preserved');
    assert.ok(out.includes('Some prose after the block.'),
      'post-block prose must be preserved');
    assert.ok(out.includes('# Header'),
      'header must be preserved');
  });

  it('LG4: idempotent — applying with enabled=false twice yields identical output', () => {
    const once = applyReportingGate(SAMPLE, false);
    const twice = applyReportingGate(once, false);
    assert.equal(twice, once,
      'second application must be a no-op (no markers left to match)');
  });

  it('LG5: prompt without markers + enabled=false is a no-op', () => {
    const noMarkers = '# Header\n\nNo block here.\n';
    const out = applyReportingGate(noMarkers, false);
    assert.equal(out, noMarkers, 'absence of markers means no change');
  });

  it('LG6: pure function — same input + same flag produces same output', () => {
    const a = applyReportingGate(SAMPLE, false);
    const b = applyReportingGate(SAMPLE, false);
    assert.equal(a, b, 'same args must always produce same result');
  });

  it('LG7: applies to the real prompt.md — flag=false strips the section completely', () => {
    const real = readFileSync('src/orchestrator/prompt.md', 'utf-8');
    const stripped = applyReportingGate(real, false);
    assert.ok(!stripped.includes('Sub-issue reporting'),
      'real prompt with flag=false must not mention "Sub-issue reporting"');
    assert.ok(!stripped.includes('<!-- BEGIN reporting -->'),
      'BEGIN marker must be absent from stripped real prompt');
    assert.ok(!stripped.includes('<!-- END reporting -->'),
      'END marker must be absent from stripped real prompt');
  });

  it('LG8: applies to the real prompt.md — flag=true preserves the markers', () => {
    const real = readFileSync('src/orchestrator/prompt.md', 'utf-8');
    const kept = applyReportingGate(real, true);
    assert.equal(kept, real, 'flag=true must be byte-identical to source');
    assert.ok(kept.includes('<!-- BEGIN reporting -->'),
      'BEGIN marker must remain when flag=true');
    assert.ok(kept.includes('<!-- END reporting -->'),
      'END marker must remain when flag=true');
  });
});

describe('REPORT-03 — launch.js source hygiene (Phase 14 D-05 forward-looking)', () => {
  const LAUNCH_SOURCE_PATH = 'src/orchestrator/launch.js';

  it('LH1: launch.js consumes isReportToProviderEnabled (helper, not inline access)', () => {
    const source = readFileSync(LAUNCH_SOURCE_PATH, 'utf-8');
    assert.match(
      source,
      /import\s*\{[^}]*isReportToProviderEnabled[^}]*\}\s*from\s*['"]\.\.\/config\.js['"]/,
      'launch.js must import isReportToProviderEnabled from ../config.js',
    );
  });

  it('LH2: launch.js does NOT access .report_to_provider directly (Phase 14 D-05 invariant)', () => {
    const source = readFileSync(LAUNCH_SOURCE_PATH, 'utf-8');
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    assert.ok(
      !/\.report_to_provider\b/.test(stripped),
      'src/orchestrator/launch.js must not access .report_to_provider directly. Use isReportToProviderEnabled() from src/config.js. Direct access is allowed only inside the helper itself (src/config.js).',
    );
  });

  it('LH3: launch.js invokes isReportToProviderEnabled() at the call site (composed with applyReportingGate)', () => {
    const source = readFileSync(LAUNCH_SOURCE_PATH, 'utf-8');
    // The invocation must be wrapped by applyReportingGate. We grep for the
    // specific composition pattern to lock in the wiring.
    assert.match(
      source,
      /applyReportingGate\([\s\S]*?isReportToProviderEnabled\(\)/,
      'launchOrchestrator must compose applyReportingGate(..., isReportToProviderEnabled())',
    );
  });
});
