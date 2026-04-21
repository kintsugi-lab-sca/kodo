// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap, normalizeTitle } from '../src/gsd/roadmap.js';

describe('parseRoadmap', () => {
  it('returns empty phases when markdown is empty', () => {
    assert.deepEqual(parseRoadmap(''), { phases: [] });
  });

  it('returns empty phases for non-string input', () => {
    // @ts-expect-error — deliberate invalid input for defense check
    assert.deepEqual(parseRoadmap(null), { phases: [] });
    // @ts-expect-error
    assert.deepEqual(parseRoadmap(undefined), { phases: [] });
    // @ts-expect-error
    assert.deepEqual(parseRoadmap(42), { phases: [] });
  });

  it('parses ## Phase headings (spec form)', () => {
    const md = '## Phase 1: Foundation\nbody\n## Phase 2: Rollout\n';
    const { phases } = parseRoadmap(md);
    assert.equal(phases.length, 2);
    assert.equal(phases[0].n, '1');
    assert.equal(phases[0].title, 'Foundation');
    assert.equal(phases[0].heading, '## Phase 1: Foundation');
    assert.equal(phases[0].line, 1);
    assert.equal(phases[1].n, '2');
    assert.equal(phases[1].line, 3);
  });

  it('parses ### Phase headings (real ROADMAP form, D-05)', () => {
    const md = '### Phase 9: Phase Resolver + Bootstrap\n';
    const { phases } = parseRoadmap(md);
    assert.equal(phases.length, 1);
    assert.equal(phases[0].n, '9');
    assert.equal(phases[0].title, 'Phase Resolver + Bootstrap');
  });

  it('rejects # (level 1) and #### (level 4) headings', () => {
    const md = '# Phase 1: Hashed\n#### Phase 2: Too deep\n';
    assert.deepEqual(parseRoadmap(md), { phases: [] });
  });

  it('accepts decimal phase numbers (D-08, forward-compat with gsd-insert-phase)', () => {
    const { phases } = parseRoadmap('## Phase 72.1: Inserted\n');
    assert.equal(phases.length, 1);
    assert.equal(phases[0].n, '72.1');
    assert.equal(phases[0].title, 'Inserted');
  });

  it('ignores range headings like Phase 1-5', () => {
    const { phases } = parseRoadmap('## Phase 1-5: Overview\n');
    assert.equal(phases.length, 0);
  });

  it('accepts dash separator (## Phase 1 - Title)', () => {
    const { phases } = parseRoadmap('## Phase 1 - Foo\n');
    assert.equal(phases.length, 1);
    assert.equal(phases[0].title, 'Foo');
  });

  it('captures line numbers as 1-indexed', () => {
    const md = 'prelude\n\n## Phase 3: Third\n';
    const { phases } = parseRoadmap(md);
    assert.equal(phases[0].line, 3);
  });
});

describe('normalizeTitle', () => {
  it('lowercases and trims', () => {
    assert.equal(normalizeTitle('  Hello World  '), 'hello world');
  });

  it('collapses internal whitespace runs (D-07)', () => {
    assert.equal(normalizeTitle('A   B\t\tC'), 'a b c');
  });

  it('preserves punctuation and backticks (D-07 strict)', () => {
    assert.equal(normalizeTitle('Foo: `bar`'), 'foo: `bar`');
    assert.equal(normalizeTitle('A, B. C!'), 'a, b. c!');
  });

  it('coerces non-strings via String()', () => {
    // @ts-expect-error
    assert.equal(normalizeTitle(42), '42');
  });
});
