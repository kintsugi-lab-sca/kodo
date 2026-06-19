// @ts-check
//
// test/server-xss-allowlist.test.js — Regresión del hardening XSS WR-01 (DEBT-01, Phase 58).
//
// El dashboard HTML (src/server.js) renderiza `task_url` como `<a href>` clickable.
// `escapeHtml` NO neutraliza esquemas hostiles (`javascript:`/`data:` no contienen
// & < > " '), así que un task_url malicioso ejecutaría script al click. La mitigación
// (commit 77a5c0c, T-48-10) es la allowlist `safeHref` (new URL() → solo http(s)),
// aplicada vía `refAnchor` a TODOS los renders de task_url.
//
// Las funciones de render viven como JS client-side embebido (string en el template
// HTML servido) — no son importables. Este test estático sobre el SOURCE bloquea la
// eliminación accidental de la allowlist (mismo patrón que los static-wiring tests del
// CLI). Es un guard anti-regresión, no un test de comportamiento runtime.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

describe('server.js — XSS task_url allowlist (DEBT-01 / WR-01 regression)', () => {
  const src = readFileSync('src/server.js', 'utf-8');

  it('XSS1: safeHref restringe a esquema http(s) vía new URL()', () => {
    assert.ok(src.includes('function safeHref'), 'expected safeHref function');
    assert.ok(src.includes('new URL(url)'), 'expected new URL() parse in safeHref');
    assert.ok(
      src.includes("p.protocol === 'http:'") && src.includes("p.protocol === 'https:'"),
      'expected http(s) protocol allowlist',
    );
  });

  it('XSS2: refAnchor pasa la url por safeHref antes del <a href>', () => {
    assert.ok(src.includes('function refAnchor'), 'expected refAnchor function');
    assert.ok(/refAnchor[\s\S]{0,200}safeHref\(url\)/.test(src), 'expected refAnchor to call safeHref');
  });

  it('XSS3: todos los renders de task_url van por refAnchor (no <a href> crudo)', () => {
    // Cada uso de s.task_url en un anchor debe ir vía refAnchor; un href que
    // concatene task_url directamente sería el vector latente WR-01.
    const taskUrlAnchors = src.match(/href=['"]['" ]*\+\s*[^;]*task_url/g) || [];
    assert.equal(taskUrlAnchors.length, 0, 'task_url must never be concatenated raw into an href');
    assert.ok(src.includes('refAnchor(s.task_url'), 'expected task_url rendered via refAnchor');
  });

  it('XSS4: el anchor seguro lleva rel="noopener noreferrer" (anti reverse-tabnabbing)', () => {
    assert.ok(src.includes('rel="noopener noreferrer"'), 'expected rel guard on target=_blank anchor');
  });
});
