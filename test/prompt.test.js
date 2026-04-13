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
