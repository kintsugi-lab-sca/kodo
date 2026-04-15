import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTmpHome } from './helpers/logger-fixtures.js';

const fixture = makeTmpHome({ sessionId: 'sess-redact-1', label: 'redact' });
after(() => fixture.cleanup());

const { createLogger } = await import('../src/logger.js');

describe('LOG-08: logger redaction (grep assertion)', () => {
  it('never persists PLANE_API_KEY, headers, JWT-like values', () => {
    const log = createLogger({ sessionId: 'sess-redact-1', minLevel: 'debug' });
    const SECRETS = {
      apiKey: 'plane_abcdef0123456789deadbeefcafe1234',
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.abc123signaturepart',
      sig: 'sha256=0123456789abcdef0123456789abcdef',
    };
    log.info('creds top-level', { plane_api_key: SECRETS.apiKey });
    log.info('nested headers', { request: { headers: { authorization: `Bearer ${SECRETS.apiKey}` } } });
    log.info('webhook', { headers: { 'x-plane-signature': SECRETS.sig } });
    log.info('raw JWT', { payload: SECRETS.jwt });
    const raw = readFileSync(fixture.logPath, 'utf-8');
    for (const [name, secret] of Object.entries(SECRETS)) {
      assert.equal(raw.includes(secret), false, `secret leaked (${name}): ${secret.slice(0, 12)}…`);
    }
    assert.equal(raw.includes('[REDACTED]'), true);
  });

  it('deep-walk respects depth limit (depth > 4 becomes [REDACTED:depth-exceeded])', () => {
    const log = createLogger({ sessionId: 'sess-redact-1', minLevel: 'debug' });
    // depth 6 estructura: a.b.c.d.e.f = 'leaf'
    log.info('deep', { a: { b: { c: { d: { e: { f: 'leaf' } } } } } });
    const raw = readFileSync(fixture.logPath, 'utf-8');
    assert.ok(raw.includes('[REDACTED:depth-exceeded]'), 'depth limit must trigger sentinel');
  });

  it('redacts stderr mirror too (secrets never appear in pretty output)', (t) => {
    const captured = [];
    t.mock.method(process.stderr, 'write', (c) => { captured.push(c.toString()); return true; });
    const log = createLogger({ sessionId: 'sess-redact-1', minLevel: 'debug' });
    log.error('leak test', { authorization: 'Bearer plane_abcdef0123456789deadbeefcafe1234' });
    const out = captured.join('');
    assert.equal(out.includes('plane_abcdef0123456789deadbeefcafe1234'), false);
    assert.equal(out.includes('[REDACTED]'), true);
  });
});
