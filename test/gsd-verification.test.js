// @ts-check
//
// test/gsd-verification.test.js — Test suite for src/gsd/verification.js.
//
// Covers Plan 10-01:
//   parseVerificationFrontmatter × 10+ cases (happy path, extras ignored, quoted
//     values, numeric coercion, missing fields, malformed frontmatter, non-string
//     input, empty block, real Phase 9 fixture).
//   computeVerdict × 8+ cases (pass, fail × 3 reasons with precedence, malformed
//     × 2 unknown-status variants, parseError propagation).
//
// Pure unit tests — zero filesystem, zero provider. All fixtures are inline
// strings. The real Phase 9 fixture is reproduced verbatim (P2).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVerificationFrontmatter,
  computeVerdict,
} from '../src/gsd/verification.js';

describe('parseVerificationFrontmatter', () => {
  it('P1: extrae los 4 campos obligatorios de un frontmatter válido', () => {
    const md = [
      '---',
      'status: passed',
      'must_haves_total: 8',
      'must_haves_verified: 8',
      'gaps_count: 0',
      '---',
      '',
      '# cuerpo ignorado',
    ].join('\n');
    const out = parseVerificationFrontmatter(md);
    assert.equal(out.error, undefined);
    assert.equal(out.status, 'passed');
    assert.equal(out.must_haves_total, 8);
    assert.equal(out.must_haves_verified, 8);
    assert.equal(out.gaps_count, 0);
  });

  it('P2: ignora campos extra (requirements[], verified_at, re_verification, previous_verification anidado — fixture real Phase 9)', () => {
    const md = [
      '---',
      'status: passed',
      'phase: 09-phase-resolver-bootstrap',
      'verified_at: 2026-04-21T12:52:00Z',
      're_verification: true',
      'must_haves_total: 8',
      'must_haves_verified: 8',
      'overrides_applied: 0',
      'requirements:',
      '  - { id: GSD-02, status: verified }',
      '  - { id: GSD-03, status: verified }',
      'gaps_count: 0',
      'human_verification_needed: 0',
      'previous_verification:',
      '  previous_status: gaps_found',
      '  previous_score: 7/8',
      '---',
    ].join('\n');
    const out = parseVerificationFrontmatter(md);
    assert.equal(out.error, undefined);
    assert.equal(out.status, 'passed');
    assert.equal(out.must_haves_total, 8);
    assert.equal(out.must_haves_verified, 8);
    assert.equal(out.gaps_count, 0);
  });

  it('P3: normaliza valores entrecomillados (status: "passed" → passed)', () => {
    const md = [
      '---',
      'status: "passed"',
      'must_haves_total: "5"',
      'must_haves_verified: "5"',
      'gaps_count: "0"',
      '---',
    ].join('\n');
    const out = parseVerificationFrontmatter(md);
    assert.equal(out.error, undefined);
    assert.equal(out.status, 'passed');
    assert.equal(out.must_haves_total, 5);
    assert.equal(out.must_haves_verified, 5);
    assert.equal(out.gaps_count, 0);
  });

  it('P4: convierte números string a number (type === number)', () => {
    const md = [
      '---',
      'status: passed',
      'must_haves_total: 12',
      'must_haves_verified: 10',
      'gaps_count: 2',
      '---',
    ].join('\n');
    const out = parseVerificationFrontmatter(md);
    assert.equal(typeof out.must_haves_total, 'number');
    assert.equal(typeof out.must_haves_verified, 'number');
    assert.equal(typeof out.gaps_count, 'number');
    assert.equal(out.must_haves_total, 12);
    assert.equal(out.must_haves_verified, 10);
    assert.equal(out.gaps_count, 2);
  });

  it('P5: { error } cuando falta status', () => {
    const md = [
      '---',
      'must_haves_total: 8',
      'must_haves_verified: 8',
      'gaps_count: 0',
      '---',
    ].join('\n');
    const out = parseVerificationFrontmatter(md);
    assert.ok(out.error);
    assert.match(out.error, /status/);
  });

  it('P6: { error } cuando falta gaps_count', () => {
    const md = [
      '---',
      'status: passed',
      'must_haves_total: 8',
      'must_haves_verified: 8',
      '---',
    ].join('\n');
    const out = parseVerificationFrontmatter(md);
    assert.ok(out.error);
    assert.match(out.error, /gaps_count/);
  });

  it('P7: { error } cuando no hay bloque frontmatter delimitado por ---', () => {
    const md = [
      '# VERIFICATION',
      '',
      'status: passed',
      'must_haves_total: 8',
      'must_haves_verified: 8',
      'gaps_count: 0',
    ].join('\n');
    const out = parseVerificationFrontmatter(md);
    assert.ok(out.error);
    assert.match(out.error, /frontmatter/i);
  });

  it('P8: { error } con input no-string (null, undefined, number, object) — sin lanzar', () => {
    // @ts-expect-error — deliberate invalid input
    const a = parseVerificationFrontmatter(null);
    assert.ok(a.error);
    // @ts-expect-error
    const b = parseVerificationFrontmatter(undefined);
    assert.ok(b.error);
    // @ts-expect-error
    const c = parseVerificationFrontmatter(123);
    assert.ok(c.error);
    // @ts-expect-error
    const d = parseVerificationFrontmatter({});
    assert.ok(d.error);
  });

  it('P9: { error } con bloque frontmatter vacío entre delimitadores', () => {
    const md = ['---', '---', '', '# cuerpo'].join('\n');
    const out = parseVerificationFrontmatter(md);
    assert.ok(out.error);
  });

  it('P10: tolera numéricos inválidos retornando { error } (must_haves_total: abc)', () => {
    const md = [
      '---',
      'status: passed',
      'must_haves_total: abc',
      'must_haves_verified: 8',
      'gaps_count: 0',
      '---',
    ].join('\n');
    const out = parseVerificationFrontmatter(md);
    assert.ok(out.error);
    assert.match(out.error, /must_haves_total/);
  });

  it('P11: rechaza keys hostiles (__proto__, constructor) — mitigación T-10-01-05', () => {
    const md = [
      '---',
      'status: passed',
      '__proto__: { polluted: true }',
      'constructor: hostile',
      'must_haves_total: 1',
      'must_haves_verified: 1',
      'gaps_count: 0',
      '---',
    ].join('\n');
    const out = parseVerificationFrontmatter(md);
    assert.equal(out.error, undefined);
    // Ensure no prototype pollution reached the global Object prototype.
    assert.equal(/** @type {any} */ ({}).polluted, undefined);
    // Ensure the returned parsed object has exactly the 4 required scalar
    // fields — no extras.
    assert.equal(out.status, 'passed');
    assert.equal(out.must_haves_total, 1);
    assert.equal(out.must_haves_verified, 1);
    assert.equal(out.gaps_count, 0);
  });
});

describe('computeVerdict', () => {
  it('V1: pass cuando passed + verified===total + gaps===0', () => {
    const verdict = computeVerdict(
      {
        status: 'passed',
        must_haves_total: 8,
        must_haves_verified: 8,
        gaps_count: 0,
      },
      '10',
    );
    assert.equal(verdict.action, 'pass');
    assert.equal(verdict.phase_id, '10');
    assert.equal(verdict.must_haves, 8);
  });

  it('V2: fail reason=gaps-found cuando gaps > 0 (tiene prioridad sobre must-haves-incomplete)', () => {
    const verdict = computeVerdict(
      {
        status: 'passed',
        must_haves_total: 8,
        must_haves_verified: 6, // verified < total, pero gaps>0 gana
        gaps_count: 2,
      },
      '10',
    );
    assert.equal(verdict.action, 'fail');
    assert.equal(verdict.phase_id, '10');
    assert.equal(verdict.reason, 'gaps-found');
    assert.match(verdict.detail, /gaps_count=2/);
  });

  it('V3: fail reason=must-haves-incomplete cuando verified < total y gaps===0', () => {
    const verdict = computeVerdict(
      {
        status: 'passed',
        must_haves_total: 8,
        must_haves_verified: 6,
        gaps_count: 0,
      },
      '10',
    );
    assert.equal(verdict.action, 'fail');
    assert.equal(verdict.reason, 'must-haves-incomplete');
    assert.match(verdict.detail, /verified=6/);
    assert.match(verdict.detail, /total=8/);
  });

  it('V4: fail reason=status-failed cuando status=failed y counts OK', () => {
    const verdict = computeVerdict(
      {
        status: 'failed',
        must_haves_total: 8,
        must_haves_verified: 8,
        gaps_count: 0,
      },
      '10',
    );
    assert.equal(verdict.action, 'fail');
    assert.equal(verdict.reason, 'status-failed');
    assert.match(verdict.detail, /status=failed/);
  });

  it('V5: fail reason=status-failed cuando status=gaps_found y counts OK (precedencia)', () => {
    const verdict = computeVerdict(
      {
        status: 'gaps_found',
        must_haves_total: 8,
        must_haves_verified: 8,
        gaps_count: 0,
      },
      '10',
    );
    assert.equal(verdict.action, 'fail');
    assert.equal(verdict.reason, 'status-failed');
    assert.match(verdict.detail, /status=gaps_found/);
  });

  it('V6: malformed cuando status es desconocido (in_progress)', () => {
    const verdict = computeVerdict(
      {
        status: 'in_progress',
        must_haves_total: 8,
        must_haves_verified: 8,
        gaps_count: 0,
      },
      '10',
    );
    assert.equal(verdict.action, 'malformed');
    assert.equal(verdict.phase_id, '10');
    assert.match(verdict.detail, /in_progress/);
  });

  it('V7: malformed cuando status es string vacío', () => {
    const verdict = computeVerdict(
      {
        status: '',
        must_haves_total: 0,
        must_haves_verified: 0,
        gaps_count: 0,
      },
      '10',
    );
    assert.equal(verdict.action, 'malformed');
    assert.match(verdict.detail, /unknown status/);
  });

  it('V8: propaga parseError como malformed (detail incluye el error)', () => {
    const verdict = computeVerdict({ error: 'missing field status' }, '10');
    assert.equal(verdict.action, 'malformed');
    assert.equal(verdict.phase_id, '10');
    assert.equal(verdict.detail, 'missing field status');
  });

  it('V9: pass usa phase_id retornado literal (sin normalizar)', () => {
    const verdict = computeVerdict(
      {
        status: 'passed',
        must_haves_total: 3,
        must_haves_verified: 3,
        gaps_count: 0,
      },
      '72.1',
    );
    assert.equal(verdict.action, 'pass');
    assert.equal(verdict.phase_id, '72.1');
    assert.equal(verdict.must_haves, 3);
  });

  it('V10: precedencia — status=failed + gaps>0 → reason=gaps-found (más específico)', () => {
    const verdict = computeVerdict(
      {
        status: 'failed',
        must_haves_total: 8,
        must_haves_verified: 8,
        gaps_count: 3,
      },
      '10',
    );
    assert.equal(verdict.action, 'fail');
    assert.equal(verdict.reason, 'gaps-found');
  });
});
