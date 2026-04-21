// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBriefFromTask, isBriefEmpty } from '../src/gsd/brief.js';

describe('buildBriefFromTask', () => {
  it('renders full brief with title, url and description', () => {
    const out = buildBriefFromTask({
      ref: 'KL-42',
      title: 'Build phase resolver',
      url: 'https://plane.example.com/tasks/KL-42',
      description: 'Implements GSD-03.',
    });
    assert.equal(out, [
      '## Project Brief',
      '',
      '**Task:** KL-42 — Build phase resolver',
      '**Source:** https://plane.example.com/tasks/KL-42',
      '',
      'Implements GSD-03.',
    ].join('\n'));
  });

  it('omits **Source:** line when url is missing', () => {
    const out = buildBriefFromTask({
      ref: 'KL-1',
      title: 'No URL',
      description: 'Body text',
    });
    assert.ok(!out.includes('**Source:**'), 'Source line should be absent');
    // And the blank-line separator before body is still present once
    assert.equal(out, [
      '## Project Brief',
      '',
      '**Task:** KL-1 — No URL',
      '',
      'Body text',
    ].join('\n'));
  });

  it('uses "(no description provided)" when description is null (D-12)', () => {
    const out = buildBriefFromTask({
      ref: 'KL-2',
      title: 'Null desc',
      url: 'https://x/2',
      description: null,
    });
    assert.ok(out.endsWith('(no description provided)'));
  });

  it('uses "(no description provided)" when description is whitespace-only (D-12)', () => {
    const out = buildBriefFromTask({
      ref: 'KL-3',
      title: 'Blank desc',
      description: '   \n\t ',
    });
    assert.ok(out.endsWith('(no description provided)'));
  });

  it('uses "(no description provided)" when description is missing', () => {
    const out = buildBriefFromTask({ ref: 'KL-4', title: 'No desc' });
    assert.ok(out.endsWith('(no description provided)'));
  });

  it('starts with the H2 heading', () => {
    const out = buildBriefFromTask({ ref: 'R', title: 'T' });
    assert.ok(out.startsWith('## Project Brief\n'));
  });
});

describe('isBriefEmpty', () => {
  it('returns true for null/undefined/empty/whitespace description', () => {
    assert.equal(isBriefEmpty({ description: null }), true);
    assert.equal(isBriefEmpty({ description: undefined }), true);
    assert.equal(isBriefEmpty({ description: '' }), true);
    assert.equal(isBriefEmpty({ description: '   \n\t' }), true);
    assert.equal(isBriefEmpty({}), true);
  });

  it('returns false for non-empty description', () => {
    assert.equal(isBriefEmpty({ description: 'hello' }), false);
    assert.equal(isBriefEmpty({ description: ' x ' }), false);
  });
});
