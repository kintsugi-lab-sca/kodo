// @ts-check
//
// test/server/auth.test.js — Phase 69 Plan 01 (NET-02).
//
// Unit tests for the pure, DI-driven auth primitives extracted into
// src/server/auth.js (mirroring the src/server/dismiss.js precedent). These are
// the crypto/decision building blocks the server pipeline (Plan 02) will consume:
// bearer parsing, constant-time token compare, open-route classification, the
// pre-auth body-size cap, and the auto-generated bearer token.
//
// Every unit here is offline: no real HTTP, no ~/.kodo/ writes, no HOME
// manipulation. getOrCreateApiToken is exercised with a fake `env` object and a
// fake `writeEnvVarFn` spy (captures key/value, returns true/false per case).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseBearer,
  timingSafeTokenEqual,
  isOpenRoute,
  getOrCreateApiToken,
  MAX_BODY_BYTES,
} from '../../src/server/auth.js';

describe('parseBearer', () => {
  it('extracts the token after a "Bearer " prefix', () => {
    assert.equal(parseBearer('Bearer abc123'), 'abc123');
  });

  it('is case-insensitive on the scheme and trims the token', () => {
    assert.equal(parseBearer('bearer  xToken '), 'xToken');
    assert.equal(parseBearer('BEARER tok'), 'tok');
  });

  it('returns null for undefined, empty, non-string, or a non-Bearer scheme', () => {
    assert.equal(parseBearer(undefined), null);
    assert.equal(parseBearer(''), null);
    assert.equal(parseBearer('Basic xyz'), null);
    assert.equal(parseBearer(/** @type {any} */ (42)), null);
    assert.equal(parseBearer('Bearer'), null); // prefix only, no token
    assert.equal(parseBearer('Bearer    '), null); // only whitespace after prefix
  });
});

describe('timingSafeTokenEqual', () => {
  it('returns true for identical strings', () => {
    assert.equal(timingSafeTokenEqual('a', 'a'), true);
    assert.equal(timingSafeTokenEqual('a-longer-token', 'a-longer-token'), true);
  });

  it('returns false for different equal-length strings', () => {
    assert.equal(timingSafeTokenEqual('a', 'b'), false);
  });

  it('returns false for unequal-length inputs WITHOUT throwing', () => {
    assert.doesNotThrow(() => timingSafeTokenEqual('short', 'longertoken'));
    assert.equal(timingSafeTokenEqual('short', 'longertoken'), false);
  });

  it('returns false when either side is falsy', () => {
    assert.equal(timingSafeTokenEqual(null, 'x'), false);
    assert.equal(timingSafeTokenEqual('x', undefined), false);
    assert.equal(timingSafeTokenEqual('', 'x'), false);
    assert.equal(timingSafeTokenEqual('x', ''), false);
  });
});

describe('isOpenRoute', () => {
  it('is true only for GET /health and POST /webhook', () => {
    assert.equal(isOpenRoute('GET', '/health'), true);
    assert.equal(isOpenRoute('POST', '/webhook'), true);
  });

  it('is false for every other method/path combination', () => {
    assert.equal(isOpenRoute('GET', '/status'), false);
    assert.equal(isOpenRoute('GET', '/webhook'), false); // right path, wrong method
    assert.equal(isOpenRoute('POST', '/health'), false); // right path, wrong method
    assert.equal(isOpenRoute('DELETE', '/sessions/abc'), false);
  });
});

describe('getOrCreateApiToken', () => {
  it('returns an existing token unchanged and does NOT call the writer', () => {
    const env = { KODO_API_TOKEN: 'existing' };
    let called = false;
    const writeEnvVarFn = () => {
      called = true;
      return true;
    };
    const token = getOrCreateApiToken({ env, writeEnvVarFn });
    assert.equal(token, 'existing');
    assert.equal(called, false);
    assert.equal(env.KODO_API_TOKEN, 'existing');
  });

  it('generates a 64-char lowercase-hex token, persists it, and caches it in env', () => {
    const env = /** @type {Record<string, string>} */ ({});
    const captured = { key: '', value: '' };
    const writeEnvVarFn = (key, value) => {
      captured.key = key;
      captured.value = value;
      return true;
    };
    const token = getOrCreateApiToken({ env, writeEnvVarFn });
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(captured.key, 'KODO_API_TOKEN');
    assert.equal(captured.value, token);
    assert.equal(env.KODO_API_TOKEN, token);
  });

  it('throws with code KODO_TOKEN_WRITE_FAILED when the writer returns false', () => {
    const env = /** @type {Record<string, string>} */ ({});
    const writeEnvVarFn = () => false;
    assert.throws(
      () => getOrCreateApiToken({ env, writeEnvVarFn }),
      (err) => {
        assert.equal(/** @type {any} */ (err).code, 'KODO_TOKEN_WRITE_FAILED');
        return true;
      },
    );
    // Persist failed → no token cached in env (do not run auth-disabled silently).
    assert.equal(env.KODO_API_TOKEN, undefined);
  });

  it('never lets the token value reach console output (logs only ENABLED)', () => {
    const env = /** @type {Record<string, string>} */ ({});
    const writeEnvVarFn = () => true;
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    let token;
    try {
      token = getOrCreateApiToken({ env, writeEnvVarFn });
    } finally {
      console.log = original;
    }
    const joined = lines.join('\n');
    assert.ok(joined.includes('ENABLED'), 'expected a log line containing ENABLED');
    assert.ok(
      !joined.includes(token),
      'the token value must NEVER appear in console output (PERSIST-04)',
    );
  });
});

describe('MAX_BODY_BYTES', () => {
  it('is the 1 MB pre-auth body cap', () => {
    assert.equal(MAX_BODY_BYTES, 1024 * 1024);
    assert.equal(MAX_BODY_BYTES, 1048576);
  });
});
