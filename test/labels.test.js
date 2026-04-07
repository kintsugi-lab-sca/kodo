import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseKodoLabels } from '../src/labels.js';

describe('parseKodoLabels', () => {
  it('returns isKodo=false when no labels', () => {
    const result = parseKodoLabels([]);
    assert.equal(result.isKodo, false);
    assert.equal(result.model, null);
  });

  it('returns isKodo=false when no kodo label', () => {
    const result = parseKodoLabels([{ name: 'bug' }, { name: 'DEV' }]);
    assert.equal(result.isKodo, false);
  });

  it('detects kodo label', () => {
    const result = parseKodoLabels([{ name: 'kodo' }, { name: 'bug' }]);
    assert.equal(result.isKodo, true);
    assert.equal(result.model, null);
  });

  it('detects kodo label case-insensitive', () => {
    const result = parseKodoLabels([{ name: 'Kodo' }]);
    assert.equal(result.isKodo, true);
  });

  it('detects kodo:sonnet model override', () => {
    const result = parseKodoLabels([{ name: 'kodo:sonnet' }]);
    assert.equal(result.isKodo, true);
    assert.equal(result.model, 'sonnet');
  });

  it('detects kodo:haiku model override', () => {
    const result = parseKodoLabels([{ name: 'kodo:haiku' }]);
    assert.equal(result.isKodo, true);
    assert.equal(result.model, 'haiku');
  });

  it('puts unknown kodo: tags into flags', () => {
    const result = parseKodoLabels([{ name: 'kodo' }, { name: 'kodo:review' }]);
    assert.equal(result.isKodo, true);
    assert.deepEqual(result.flags, ['review']);
  });

  it('handles mixed labels', () => {
    const result = parseKodoLabels([
      { name: 'bug' },
      { name: 'kodo' },
      { name: 'kodo:haiku' },
      { name: 'kodo:review' },
    ]);
    assert.equal(result.isKodo, true);
    assert.equal(result.model, 'haiku');
    assert.deepEqual(result.flags, ['review']);
  });

  it('ignores non-object labels', () => {
    const result = parseKodoLabels(['uuid-string', 'another-uuid']);
    assert.equal(result.isKodo, false);
  });

  it('handles null/undefined input', () => {
    assert.equal(parseKodoLabels(null).isKodo, false);
    assert.equal(parseKodoLabels(undefined).isKodo, false);
  });
});
