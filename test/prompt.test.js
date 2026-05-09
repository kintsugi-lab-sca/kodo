// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '..', 'src', 'orchestrator', 'prompt.md');

describe('orchestrator prompt template', () => {
  const raw = readFileSync(PROMPT_PATH, 'utf-8');

  it('contains no literal "Plane" references in raw template', () => {
    // Match standalone "Plane" but not inside {{ }} placeholders
    const withoutPlaceholders = raw.replace(/\{\{[^}]+\}\}/g, '');
    assert.ok(
      !/\bPlane\b/.test(withoutPlaceholders),
      `prompt.md should not contain literal "Plane" — found in: ${withoutPlaceholders.match(/.*\bPlane\b.*/)?.[0]}`,
    );
  });

  it('contains {{provider}} placeholder', () => {
    assert.ok(raw.includes('{{provider}}'), 'should contain {{provider}}');
  });

  it('contains {{provider_name}} placeholder', () => {
    assert.ok(raw.includes('{{provider_name}}'), 'should contain {{provider_name}}');
  });

  it('contains {{mcp_tool}} placeholder', () => {
    assert.ok(raw.includes('{{mcp_tool}}'), 'should contain {{mcp_tool}}');
  });
});

describe('resolvePromptTemplate', () => {
  /** @type {typeof import('../src/orchestrator/launch.js').resolvePromptTemplate} */
  let resolvePromptTemplate;

  it('is exported from launch.js', async () => {
    const mod = await import('../src/orchestrator/launch.js');
    assert.ok(typeof mod.resolvePromptTemplate === 'function', 'resolvePromptTemplate must be exported');
    resolvePromptTemplate = mod.resolvePromptTemplate;
  });

  it('replaces all placeholders for provider "plane"', async () => {
    const { resolvePromptTemplate: fn } = await import('../src/orchestrator/launch.js');
    const raw = readFileSync(PROMPT_PATH, 'utf-8');
    const resolved = fn(raw, { provider: 'plane' });

    assert.ok(!resolved.includes('{{'), `should have no remaining {{ placeholders — found: ${resolved.match(/\{\{[^}]+\}\}/)?.[0]}`);
  });

  it('resolved prompt for provider "plane" contains "Plane"', async () => {
    const { resolvePromptTemplate: fn } = await import('../src/orchestrator/launch.js');
    const raw = readFileSync(PROMPT_PATH, 'utf-8');
    const resolved = fn(raw, { provider: 'plane' });

    assert.ok(resolved.includes('Plane'), 'resolved prompt for plane should contain "Plane"');
  });

  it('resolved prompt for provider "github" contains "Github"', async () => {
    const { resolvePromptTemplate: fn } = await import('../src/orchestrator/launch.js');
    const raw = readFileSync(PROMPT_PATH, 'utf-8');
    const resolved = fn(raw, { provider: 'github' });

    assert.ok(resolved.includes('Github'), 'resolved prompt for github should contain "Github"');
    assert.ok(!resolved.includes('Plane'), 'resolved prompt for github should NOT contain "Plane"');
  });
});

describe('REPORT-03 — Sub-issue reporting section gating', () => {
  const raw = readFileSync(PROMPT_PATH, 'utf-8');

  it('SR1: raw prompt.md contains <!-- BEGIN reporting --> and <!-- END reporting --> markers exactly once each', () => {
    const beginMatches = raw.match(/<!-- BEGIN reporting -->/g) ?? [];
    const endMatches = raw.match(/<!-- END reporting -->/g) ?? [];
    assert.equal(beginMatches.length, 1, 'exactly one BEGIN marker expected');
    assert.equal(endMatches.length, 1, 'exactly one END marker expected');
  });

  it('SR2: reporting block appears AFTER "## Sesiones GSD" section (D-03 slot topológico)', () => {
    const sessionsIdx = raw.indexOf('## Sesiones GSD');
    const reportingIdx = raw.indexOf('<!-- BEGIN reporting -->');
    assert.ok(sessionsIdx >= 0, 'sanity: ## Sesiones GSD must exist');
    assert.ok(reportingIdx >= 0, 'sanity: BEGIN marker must exist');
    assert.ok(reportingIdx > sessionsIdx,
      `reporting block must come after ## Sesiones GSD (sessions at ${sessionsIdx}, reporting at ${reportingIdx})`);
  });

  it('SR3: raw prompt.md contains heading "## Sub-issue reporting" inside markers', () => {
    const beginIdx = raw.indexOf('<!-- BEGIN reporting -->');
    const endIdx = raw.indexOf('<!-- END reporting -->');
    const between = raw.substring(beginIdx, endIdx);
    assert.ok(between.includes('## Sub-issue reporting'),
      'heading must live INSIDE the markers');
  });

  it('SR4: applyReportingGate(raw, true) preserves the block; (raw, false) strips it entirely', async () => {
    const { applyReportingGate } = await import('../src/orchestrator/launch.js');
    const kept = applyReportingGate(raw, true);
    const stripped = applyReportingGate(raw, false);

    assert.ok(kept.includes('## Sub-issue reporting'), 'flag=true must keep the heading');
    assert.ok(kept.includes('<!-- BEGIN reporting -->'), 'flag=true must keep the BEGIN marker');

    assert.ok(!stripped.includes('Sub-issue reporting'), 'flag=false must remove the heading and any prose mentioning it');
    assert.ok(!stripped.includes('<!-- BEGIN reporting -->'), 'flag=false must remove the BEGIN marker');
    assert.ok(!stripped.includes('<!-- END reporting -->'), 'flag=false must remove the END marker');
  });

  it('SR5: applyReportingGate(raw, false) preserves the "## Sesiones GSD" section (only the gated block disappears)', async () => {
    const { applyReportingGate } = await import('../src/orchestrator/launch.js');
    const stripped = applyReportingGate(raw, false);
    assert.ok(stripped.includes('## Sesiones GSD'),
      'pre-existing GSD section must survive the gate');
    assert.ok(stripped.includes('kodo gsd verify <session-id>'),
      'pre-existing GSD command snippet must survive');
  });

  it('SR6: PM7 invariant — block content (when flag=true) contains no English prompt phrases', () => {
    // Re-checking PM7 against the WHOLE file (which includes the new block).
    // PM7 in the existing describe checks `prompt`; this is the same scan.
    // Locks regression: if Plan 15-02 wording later drifts to "you must"
    // or "please", this test fails.
    for (const phrase of [/\byou must\b/i, /\bplease\b/i, /\bexecute your\b/i]) {
      assert.ok(!phrase.test(raw),
        `forbidden English phrase found in prompt.md (including reporting block): ${phrase}`);
    }
  });
});
