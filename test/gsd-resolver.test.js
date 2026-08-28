// @ts-check
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvePhase } from '../src/gsd/resolver.js';

/**
 * Write a minimal .planning/ tree inside `projectPath`.
 * @param {string} projectPath
 * @param {Record<string, string>} files - filename -> content (relative to .planning/)
 */
function writePlanning(projectPath, files) {
  const planning = join(projectPath, '.planning');
  mkdirSync(planning, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(planning, name), content);
  }
}

describe('resolvePhase — bootstrap vs error vs phase', () => {
  /** @type {string} */ let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kodo-resolver-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns bootstrap when .planning/PROJECT.md is missing (GSD-02 strict guard)', () => {
    // Empty project dir: no .planning/
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'anything' } });
    assert.equal(r.action, 'bootstrap');
    assert.equal(r.reason, 'no-planning-dir');
  });

  it('returns bootstrap when .planning/ exists but PROJECT.md is missing (half-init)', () => {
    // Create .planning/ROADMAP.md but NOT PROJECT.md — still considered bootstrap.
    writePlanning(tmpDir, { 'ROADMAP.md': '## Phase 1: Foo\n' });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Foo' } });
    assert.equal(r.action, 'bootstrap');
    assert.equal(r.reason, 'no-planning-dir');
  });

  it('returns error roadmap-missing when PROJECT.md present but ROADMAP.md absent', () => {
    writePlanning(tmpDir, { 'PROJECT.md': '# project\n' });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Foo' } });
    assert.equal(r.action, 'error');
    assert.equal(r.code, 'roadmap-missing');
    assert.ok(r.detail && r.detail.endsWith('ROADMAP.md'), 'detail should include roadmap path');
  });

  it('returns phase on exact title match (GSD-03)', () => {
    writePlanning(tmpDir, {
      'PROJECT.md': '# p\n',
      'ROADMAP.md': '## Phase 3: Consumer Rewiring\n## Phase 4: Server + Trigger\n',
    });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Consumer Rewiring' } });
    assert.equal(r.action, 'phase');
    assert.equal(r.phase_id, '3');
    assert.equal(r.match_heading, '## Phase 3: Consumer Rewiring');
    assert.ok(r.match_reason.includes('exact'));
  });

  it('matches case-insensitively and tolerates whitespace (D-07)', () => {
    writePlanning(tmpDir, {
      'PROJECT.md': '# p\n',
      'ROADMAP.md': '## Phase 9: Phase Resolver + Bootstrap\n',
    });
    const r = resolvePhase({
      projectPath: tmpDir,
      task: { title: '  phase resolver + bootstrap  ' },
    });
    assert.equal(r.action, 'phase');
    assert.equal(r.phase_id, '9');
  });

  it('does NOT match when punctuation differs (strict 1:1, D-07)', () => {
    writePlanning(tmpDir, {
      'PROJECT.md': '# p\n',
      'ROADMAP.md': '## Phase 1: Foo: Bar\n', // colon inside title
    });
    // Task title without the colon — should NOT match.
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Foo Bar' } });
    assert.equal(r.action, 'error');
    assert.equal(r.code, 'no-match');
  });

  it('matches against title only, not full "Phase N: ..." heading (D-06)', () => {
    writePlanning(tmpDir, {
      'PROJECT.md': '# p\n',
      'ROADMAP.md': '## Phase 7: Foo\n',
    });
    // Task title is the clean title, NOT "Phase 7: Foo"
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Foo' } });
    assert.equal(r.action, 'phase');
    assert.equal(r.phase_id, '7');

    // And the full heading form does NOT match
    const r2 = resolvePhase({ projectPath: tmpDir, task: { title: 'Phase 7: Foo' } });
    assert.equal(r2.action, 'error');
    assert.equal(r2.code, 'no-match');
  });

  it('returns error no-match when title differs', () => {
    writePlanning(tmpDir, {
      'PROJECT.md': '# p\n',
      'ROADMAP.md': '## Phase 1: Foo\n',
    });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Bar' } });
    assert.equal(r.action, 'error');
    assert.equal(r.code, 'no-match');
  });

  it('returns error multi-match with list when two phases share a title', () => {
    writePlanning(tmpDir, {
      'PROJECT.md': '# p\n',
      'ROADMAP.md': '## Phase 1: Foo\n## Phase 2: Foo\n',
    });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Foo' } });
    assert.equal(r.action, 'error');
    assert.equal(r.code, 'multi-match');
    assert.equal(r.matches.length, 2);
    assert.ok(r.matches.includes('Phase 1: Foo'));
    assert.ok(r.matches.includes('Phase 2: Foo'));
  });

  it('returns no-match for empty ROADMAP.md', () => {
    writePlanning(tmpDir, {
      'PROJECT.md': '# p\n',
      'ROADMAP.md': '',
    });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Anything' } });
    assert.equal(r.code, 'no-match');
  });

  it('ignores non-phase headings in ROADMAP (# and ####)', () => {
    writePlanning(tmpDir, {
      'PROJECT.md': '# p\n',
      'ROADMAP.md': '# Phase 1: Skipped\n#### Phase 2: Also skipped\n## Phase 3: Real\n',
    });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Real' } });
    assert.equal(r.phase_id, '3');
  });

  // KODO-49: el ROADMAP y el titulo de la task vienen de fuentes distintas (fichero
  // en disco vs tracker), y cada una puede emitir una forma Unicode distinta para el
  // MISMO acento. Antes del NFC en normalizeTitle esto daba un `no-match` opaco:
  // los dos strings se imprimen identicos en el log del error.
  it('matchea titulo NFD (task) contra ROADMAP NFC (KODO-49)', () => {
    writePlanning(tmpDir, {
      'PROJECT.md': '# p\n',
      'ROADMAP.md': '## Phase 7: Configuraci\u00f3n del d\u00e6mon\n',
    });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Configuracio\u0301n del d\u00e6mon' } });
    assert.equal(r.action, 'phase');
    assert.equal(r.phase_id, '7');
  });

  it('matchea titulo NFC (task) contra ROADMAP NFD (KODO-49, direccion inversa)', () => {
    writePlanning(tmpDir, {
      'PROJECT.md': '# p\n',
      'ROADMAP.md': '## Phase 8: Migracio\u0301n de estado\n',
    });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Migraci\u00f3n de estado' } });
    assert.equal(r.action, 'phase');
    assert.equal(r.phase_id, '8');
  });

  it('multi-match sigue detectandose entre formas Unicode equivalentes (fail-closed D-13)', () => {
    // Dos fases que solo difieren en la forma Unicode: tras NFC son el MISMO titulo,
    // asi que el resolver debe rechazar por ambiguo en vez de elegir una al azar.
    writePlanning(tmpDir, {
      'PROJECT.md': '# p\n',
      'ROADMAP.md': '## Phase 1: Sesio\u0301n\n## Phase 2: Sesi\u00f3n\n',
    });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Sesi\u00f3n' } });
    assert.equal(r.action, 'error');
    assert.equal(r.code, 'multi-match');
    assert.equal(r.matches?.length, 2);
  });
});
