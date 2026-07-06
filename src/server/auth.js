// @ts-check
//
// src/server/auth.js — Phase 69 Plan 01 (NET-02).
//
// Pure, dependency-injected auth primitives for the network-hardening phase,
// extracted into a dedicated module (mirroring src/server/dismiss.js and
// src/server/provider-state.js) so the crypto/decision logic is fully
// unit-testable OFFLINE — no real HTTP, no ~/.kodo/ writes, no HOME juggling.
//
// This module produces NO wiring into the running server: Plan 02 consumes
// these helpers in the request pipeline. Here we only deliver the tested
// building blocks:
//   - parseBearer            — RFC 6750 bearer extraction from an Authorization header
//   - timingSafeTokenEqual   — constant-time token compare (mirrors the Plane HMAC
//                              compare, D-03), with a length guard so timingSafeEqual
//                              never throws on unequal-length input
//   - isOpenRoute            — default-deny allowlist of the only two OPEN routes (D-04)
//   - getOrCreateApiToken    — CSPRNG bearer token: generate-once, 0600-persist via the
//                              single secret writer (writeEnvVar), never leak the value
//   - MAX_BODY_BYTES         — the 1 MB pre-auth body cap constant (NET-03, Plan 02)
//
// Boundary PERSIST-04: the bearer secret is a distinct secret from the API key,
// held to the same care — never rendered, never logged, never in /status/argv.

import { randomBytes, timingSafeEqual } from 'node:crypto';

import { writeEnvVar } from '../config.js';

/**
 * Pre-auth request body cap consumed by Plan 02's readBody (NET-03). A body
 * larger than this is rejected with 413 BEFORE any auth/parse work.
 */
export const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

/**
 * Extract the bearer token from an `Authorization` header value (RFC 6750).
 *
 * Accepts a case-insensitive `Bearer ` scheme prefix; the remainder is trimmed.
 * Non-string input, an empty value, a non-Bearer scheme, or a prefix with no
 * token all return null.
 *
 * @param {unknown} headerValue - raw `Authorization` header value.
 * @returns {string|null} the token, or null if none is present.
 */
export function parseBearer(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = /^bearer\s+(.+)$/i.exec(headerValue.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length ? token : null;
}

/**
 * Constant-time equality of two token strings.
 *
 * Exact shape of the Plane HMAC compare (provider.js verifySignature, D-03):
 * build Buffers of both sides and require equal length BEFORE calling
 * `timingSafeEqual` (which throws on unequal-length inputs) — the length guard
 * plus a try/catch means the function never throws and never leaks byte-position
 * timing (T-69-04). Returns false if either side is falsy.
 *
 * @param {unknown} provided - attacker-controlled token (may be null/undefined).
 * @param {unknown} expected - the real token.
 * @returns {boolean} true only if both are non-empty and byte-equal.
 */
export function timingSafeTokenEqual(provided, expected) {
  if (!provided || !expected) return false;
  try {
    const a = Buffer.from(String(provided));
    const b = Buffer.from(String(expected));
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Classify a request as an OPEN (unauthenticated) route.
 *
 * Default-deny allowlist (D-04): returns true ONLY for `GET /health` (the health
 * probe) and `POST /webhook` (which keeps its own HMAC verification). Everything
 * else is closed and requires the bearer token. Closed routes are NOT enumerated.
 *
 * @param {string} method - HTTP method (e.g. 'GET', 'POST').
 * @param {string} pathname - request pathname (e.g. '/health').
 * @returns {boolean} true if the route is open, false otherwise.
 */
export function isOpenRoute(method, pathname) {
  return (
    (method === 'GET' && pathname === '/health') ||
    (method === 'POST' && pathname === '/webhook')
  );
}

/**
 * Return the bearer token, generating and persisting one on first run.
 *
 * Idempotent: if `env.KODO_API_TOKEN` already holds a non-empty string, it is
 * returned unchanged and NO write happens. Otherwise a fresh CSPRNG token is
 * generated as `randomBytes(32).toString('hex')` — 64 lowercase-hex chars, which
 * is parser-safe for the naive `.env` writer (NEVER base64, whose `+`/`/`/`=`
 * would make writeEnvVar throw — Pitfall 1). The token is persisted 0600 via the
 * single secret writer (`writeEnvVar`, PERSIST-04); if that write fails the
 * function throws an Error carrying `code: 'KODO_TOKEN_WRITE_FAILED'` rather than
 * starting with auth silently disabled (D-02). On success the token is cached in
 * `env` (loadEnvFile is load-no-override, so the just-written value must be
 * seeded in-process) and a single `ENABLED` line is logged — never the value.
 *
 * @param {object} [opts]
 * @param {Record<string, string|undefined>} [opts.env] - env object (default process.env).
 * @param {(key: string, value: string) => boolean} [opts.writeEnvVarFn] - secret writer (DI).
 * @returns {string} the bearer token.
 * @throws {Error & {code: string}} with code 'KODO_TOKEN_WRITE_FAILED' if persist fails.
 */
export function getOrCreateApiToken({ env = process.env, writeEnvVarFn = writeEnvVar } = {}) {
  const existing = env.KODO_API_TOKEN;
  if (typeof existing === 'string' && existing.length > 0) return existing;

  const token = randomBytes(32).toString('hex'); // 64 hex chars, parser-safe

  if (!writeEnvVarFn('KODO_API_TOKEN', token)) {
    const err = /** @type {Error & {code: string}} */ (
      new Error('No se pudo persistir KODO_API_TOKEN en ~/.kodo/.env')
    );
    err.code = 'KODO_TOKEN_WRITE_FAILED';
    throw err;
  }

  // loadEnvFile is load-no-override → seed the in-process cache so the current
  // run sees the token it just generated.
  env.KODO_API_TOKEN = token;
  // PERSIST-04: log only the word ENABLED, NEVER the token value.
  console.log('[kodo] auth token: ENABLED');
  return token;
}
