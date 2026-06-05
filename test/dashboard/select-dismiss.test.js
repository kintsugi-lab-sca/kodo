// @ts-check
//
// test/dashboard/select-dismiss.test.js — Phase 42 Plan 02 (DISMISS-03, D-09).
//
// Cubre el mapper PURO `mapDismissResult(res, taskRef)`: deriva el discriminante
// estructurado {kind, color} del resultado de `dismissSession` + el contenido de
// `actions[]`. Es byte-determinista y unit-testeable sin host React (RESEARCH Open
// Question 2): App.js (Task 2) traduce el `kind` al literal DISMISS_* copy.
//
// Precedencia load-bearing (UI-SPEC §Result-to-footer mapping, D-09):
//   - !res.ok                          → kind:'error'  / red   (incl. 'alive', 'HTTP 500', red)
//   - actions contiene result:'error'  → kind:'warn'   / yellow (error GANA sobre dirty)
//   - actions contiene 'moved-dirty'   → kind:'dirty'  / yellow
//   - todo lo demás                    → kind:'ok'     / green
//
// El color es un nombre de ink (string) — NO un picocolors. El mapper NO importa de
// App.js (sin import circular): grep "App.js" select.js == 0.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mapDismissResult } from '../../src/cli/dashboard/select.js';

describe('mapDismissResult: discriminante puro actions[]→{kind,color} (D-09)', () => {
  it('ok total (removed/pruned/kept) → kind:"ok" / green', () => {
    const res = {
      ok: true,
      data: {
        removed: 'T-1',
        actions: [
          { type: 'worktree', result: 'removed' },
          { type: 'lock', result: 'kept' },
          { type: 'state', result: 'removed' },
        ],
      },
    };
    const m = mapDismissResult(res, 'ROMAN-22');
    assert.equal(m.kind, 'ok');
    assert.equal(m.color, 'green');
  });

  it('moved-dirty presente → kind:"dirty" / yellow', () => {
    const res = {
      ok: true,
      data: { removed: 'T-1', actions: [{ type: 'worktree', result: 'moved-dirty' }] },
    };
    const m = mapDismissResult(res, 'ROMAN-22');
    assert.equal(m.kind, 'dirty');
    assert.equal(m.color, 'yellow');
  });

  it('error presente (aun con moved-dirty también) → kind:"warn" / yellow (error>dirty)', () => {
    const res = {
      ok: true,
      data: {
        removed: 'T-1',
        actions: [
          { type: 'worktree', result: 'moved-dirty' },
          { type: 'lock', result: 'error' },
        ],
      },
    };
    const m = mapDismissResult(res, 'ROMAN-22');
    assert.equal(m.kind, 'warn');
    assert.equal(m.color, 'yellow');
  });

  it('{ok:false, error:"alive"} (409) → kind:"error" / red con reason "alive"', () => {
    const res = { ok: false, error: 'alive' };
    const m = mapDismissResult(res, 'ROMAN-22');
    assert.equal(m.kind, 'error');
    assert.equal(m.color, 'red');
    assert.equal(m.reason, 'alive');
  });

  it('{ok:false, error:"HTTP 500"} → kind:"error" / red con reason "HTTP 500"', () => {
    const res = { ok: false, error: 'HTTP 500' };
    const m = mapDismissResult(res, 'ROMAN-22');
    assert.equal(m.kind, 'error');
    assert.equal(m.color, 'red');
    assert.equal(m.reason, 'HTTP 500');
  });

  it('actions ausente/no-array en ok → trata como ok total (defensivo, no crashea)', () => {
    const res = { ok: true, data: { removed: 'T-1' } };
    const m = mapDismissResult(res, 'ROMAN-22');
    assert.equal(m.kind, 'ok');
    assert.equal(m.color, 'green');
  });
});
