import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseKodoLabels, getGsdMode, getSessionMode } from '../src/labels.js';

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

describe('QUICK-08 — getGsdMode 4-state matrix', () => {
  it('QUICK-08: returns null when no GSD flags present', () => {
    assert.equal(getGsdMode([]), null);
  });

  it('QUICK-08: returns "full" for ["gsd"] only', () => {
    assert.equal(getGsdMode(['gsd']), 'full');
  });

  it('QUICK-08: returns "quick" for ["gsd-quick"] only', () => {
    assert.equal(getGsdMode(['gsd-quick']), 'quick');
  });

  it('QUICK-08: gsd-quick wins over gsd when both present (precedence rule, Phase 13 D-03)', () => {
    // Precedencia centralizada en getGsdMode — más específico gana.
    // Phase 11 D-09/D-10: única fuente de la regla; consumers no replican.
    assert.equal(getGsdMode(['gsd', 'gsd-quick']), 'quick');
    assert.equal(getGsdMode(['gsd-quick', 'gsd']), 'quick', 'order-independent');
  });

  it('QUICK-08: returns null defensively for non-array input', () => {
    assert.equal(getGsdMode(null), null);
    assert.equal(getGsdMode(undefined), null);
  });
});
