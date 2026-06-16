import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseKodoLabels, getGsdMode, getSessionMode, isGsdChild, KODO_LABEL_GSD_CHILD, isAdopted, KODO_LABEL_ADOPTED } from '../src/labels.js';

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

describe('QUICK-08 — getSessionMode 4-state matrix', () => {
  it('QUICK-08: returns null for non-GSD session (gsd:false)', () => {
    assert.equal(getSessionMode({ gsd: false }), null);
  });

  it('QUICK-08: returns null when gsd field is missing', () => {
    assert.equal(getSessionMode({}), null);
  });

  it('QUICK-08: returns null defensively for null/undefined session', () => {
    assert.equal(getSessionMode(null), null);
    assert.equal(getSessionMode(undefined), null);
  });

  it('QUICK-08: legacy session (gsd:true, no gsd_mode) reads as "full" — Phase 11 D-08 invariant', () => {
    // CRITICAL: pre-v0.4 sessions persistidas con gsd:true SIEMPRE eran full.
    // Esta regla "ausente == full" se aplica internamente en getSessionMode
    // para que sesiones legacy en state.json se sigan leyendo sin migración
    // programática (REQUIREMENTS Out of Scope). Si esta regla cambia
    // silenciosamente, sesiones v0.3 viejas leen como null y rompen los
    // hooks (que asumen full|quick cuando gsd:true).
    assert.equal(getSessionMode({ gsd: true }), 'full');
  });

  it('QUICK-08: returns "full" for gsd:true + gsd_mode:"full" (post-v0.4 full)', () => {
    assert.equal(getSessionMode({ gsd: true, gsd_mode: 'full' }), 'full');
  });

  it('QUICK-08: returns "quick" for gsd:true + gsd_mode:"quick" (post-v0.4 quick)', () => {
    assert.equal(getSessionMode({ gsd: true, gsd_mode: 'quick' }), 'quick');
  });
});

// GH-05 invariant: src/labels.js es provider-agnostic; dispatcher.js:65,74 hace
// .map(name => ({name})) — Phase 24 valida que el flow funciona sin tocar labels.js.
// Shape REAL (verificado en src/labels.js:12-37): { isKodo, model, flags }
// GSD mode se deriva via getGsdMode(flags) → 'full' | 'quick' | null.
describe('GH-05 — GitHub TaskItem cross-provider (parseKodoLabels invariant)', () => {
  it('recognizes kodo label from GitHub-style string labels mapped via dispatcher pattern', () => {
    const labelObjs = ['kodo'].map((name) => ({ name }));
    const result = parseKodoLabels(labelObjs);
    assert.deepEqual(result, { isKodo: true, model: null, flags: [] });
  });

  it('extracts model from kodo:sonnet label (GitHub provenance)', () => {
    const result = parseKodoLabels(['kodo:sonnet'].map((name) => ({ name })));
    assert.equal(result.isKodo, true);
    assert.equal(result.model, 'sonnet');
    assert.deepEqual(result.flags, []);
  });

  it('detects kodo:gsd-quick → flags has gsd-quick → getGsdMode returns quick', () => {
    const result = parseKodoLabels(['kodo:gsd-quick'].map((name) => ({ name })));
    assert.equal(result.isKodo, true);
    assert.deepEqual(result.flags, ['gsd-quick']);
    assert.equal(getGsdMode(result.flags), 'quick');
  });

  it('detects kodo:gsd → flags has gsd → getGsdMode returns full', () => {
    const result = parseKodoLabels(['kodo:gsd'].map((name) => ({ name })));
    assert.equal(result.isKodo, true);
    assert.deepEqual(result.flags, ['gsd']);
    assert.equal(getGsdMode(result.flags), 'full');
  });

  it('returns isKodo:false for GitHub labels without kodo presence', () => {
    const result = parseKodoLabels(['bug', 'priority:high'].map((name) => ({ name })));
    assert.deepEqual(result, { isKodo: false, model: null, flags: [] });
  });

  it('handles empty labels array (defensive)', () => {
    const result = parseKodoLabels([]);
    assert.deepEqual(result, { isKodo: false, model: null, flags: [] });
  });
});

describe('REPORT-01 — isGsdChild + KODO_LABEL_GSD_CHILD', () => {
  it('REPORT-01: KODO_LABEL_GSD_CHILD const value is "kodo:gsd-child"', () => {
    assert.equal(KODO_LABEL_GSD_CHILD, 'kodo:gsd-child');
  });

  it('REPORT-01: isGsdChild([]) returns false (empty array)', () => {
    assert.equal(isGsdChild([]), false);
  });

  it('REPORT-01: isGsdChild defensive — null/undefined/non-array returns false', () => {
    assert.equal(isGsdChild(null), false);
    assert.equal(isGsdChild(undefined), false);
    assert.equal(isGsdChild('kodo:gsd-child'), false, 'plain string is not an array');
    assert.equal(isGsdChild(42), false);
  });

  it('REPORT-01: isGsdChild(["kodo:gsd-child"]) returns true (string form)', () => {
    assert.equal(isGsdChild(['kodo:gsd-child']), true);
  });

  it('REPORT-01: isGsdChild([{name: "kodo:gsd-child"}]) returns true (object form)', () => {
    assert.equal(isGsdChild([{ name: 'kodo:gsd-child' }]), true);
  });

  it('REPORT-01: isGsdChild case-insensitive (string and object forms)', () => {
    assert.equal(isGsdChild(['KODO:GSD-CHILD']), true);
    assert.equal(isGsdChild([{ name: 'Kodo:Gsd-Child' }]), true);
  });

  it('REPORT-01: isGsdChild(["kodo:gsd", "kodo:gsd-child"]) returns true (child wins, D-07 structural)', () => {
    assert.equal(isGsdChild(['kodo:gsd', 'kodo:gsd-child']), true);
    assert.equal(isGsdChild(['kodo:gsd-child', 'kodo:gsd']), true, 'order-independent');
  });

  it('REPORT-01: isGsdChild rejects similar-but-different labels', () => {
    assert.equal(isGsdChild(['kodo:gsd-children']), false, 'plural is not the marker');
    assert.equal(isGsdChild(['kodo:gsd-quick-child']), false, 'compound is not the marker');
    assert.equal(isGsdChild(['gsd-child']), false, 'missing kodo: prefix');
  });

  it('REPORT-01: isGsdChild tolerates mixed garbage in array', () => {
    assert.equal(isGsdChild([null, undefined, 42, true, 'kodo:gsd-child']), true);
    assert.equal(isGsdChild([null, undefined, 42, true, {}, { name: null }]), false);
  });
});

describe('BIDIR-06 — isAdopted + KODO_LABEL_ADOPTED', () => {
  it('BIDIR-06: KODO_LABEL_ADOPTED const value is "kodo:adopted"', () => {
    assert.equal(KODO_LABEL_ADOPTED, 'kodo:adopted');
  });

  it('BIDIR-06: isAdopted([]) returns false (empty array)', () => {
    assert.equal(isAdopted([]), false);
  });

  it('BIDIR-06: isAdopted defensive — null/undefined/non-array returns false', () => {
    assert.equal(isAdopted(null), false);
    assert.equal(isAdopted(undefined), false);
    assert.equal(isAdopted('kodo:adopted'), false, 'plain string is not an array');
    assert.equal(isAdopted(42), false);
  });

  it('BIDIR-06: isAdopted(["kodo:adopted"]) returns true (string form)', () => {
    assert.equal(isAdopted(['kodo:adopted']), true);
  });

  it('BIDIR-06: isAdopted([{name: "kodo:adopted"}]) returns true (object form)', () => {
    assert.equal(isAdopted([{ name: 'kodo:adopted' }]), true);
  });

  it('BIDIR-06: isAdopted case-insensitive (string and object forms)', () => {
    assert.equal(isAdopted(['KODO:ADOPTED']), true);
    assert.equal(isAdopted([{ name: 'Kodo:Adopted' }]), true);
  });

  it('BIDIR-06: isAdopted rejects similar-but-different labels', () => {
    assert.equal(isAdopted(['kodo:adopted-x']), false, 'suffix is not the marker');
    assert.equal(isAdopted(['kodo:adopt']), false, 'prefix-truncated is not the marker');
    assert.equal(isAdopted(['adopted']), false, 'missing kodo: prefix');
  });

  it('BIDIR-06: isAdopted tolerates mixed garbage in array', () => {
    assert.equal(isAdopted(['kodo:gsd', { name: 'kodo:adopted' }]), true);
    assert.equal(isAdopted([null, undefined, 42, true, 'kodo:adopted']), true);
    assert.equal(isAdopted([null, undefined, 42, true, {}, { name: null }]), false);
  });
});
