// @ts-check

/**
 * GSD VERIFICATION.md parser + verdict computer.
 *
 * Implements CONTEXT §D-05 .. §D-10 (Plan 10-01):
 *   - D-05: parses ONLY frontmatter YAML (ignores must-haves table prose).
 *   - D-06: required fields = status, must_haves_total, must_haves_verified,
 *           gaps_count. Anything else is silently ignored.
 *   - D-07: pass REQUIRES three conditions simultaneously — status==='passed'
 *           AND must_haves_verified===must_haves_total AND gaps_count===0.
 *   - D-09: status mapping — passed → pass, gaps_found|failed → fail, any
 *           other value → malformed.
 *   - D-10: computeVerdict returns a discriminated union over `action`
 *           ('pass' | 'fail' | 'malformed'). The 'missing' verdict lives in
 *           src/gsd/verify.js (Plan 10-02) because it is a filesystem concern.
 *
 * Pure module — zero I/O, no filesystem, no network, no dependencies other
 * than JS stdlib primitives (regex, parseInt). Zero runtime deps (NO js-yaml):
 * parser hand-rolled for the 4 scalar fields.
 *
 * Fail-closed contract: every malformed input returns a discriminated-union
 * error result; nothing ever throws.
 *
 * Prototype-pollution guard (T-10-01-05): we use `Object.create(null)` as the
 * backing object and explicitly drop hostile keys (`__proto__`, `constructor`,
 * `prototype`) even though the final result object is a plain literal — this
 * prevents accidental writes during parsing.
 *
 * Precedence of fail reasons (documented because two conditions can hold
 * simultaneously and we must pick the most specific one):
 *   1. gaps_count > 0                            → reason: 'gaps-found'
 *   2. must_haves_verified < must_haves_total    → reason: 'must-haves-incomplete'
 *   3. status maps to 'fail' (failed|gaps_found) → reason: 'status-failed'
 * If none of the above triggers AND status maps to 'pass' → action: 'pass'.
 *
 * @typedef {{ status: string, must_haves_total: number, must_haves_verified: number, gaps_count: number }} ParsedFrontmatter
 * @typedef {{ error: string }} ParseError
 * @typedef {{ action: 'pass', phase_id: string, must_haves: number }} PassVerdict
 * @typedef {{ action: 'fail', phase_id: string, reason: 'gaps-found'|'must-haves-incomplete'|'status-failed', detail: string }} FailVerdict
 * @typedef {{ action: 'malformed', phase_id: string, detail: string }} MalformedVerdict
 * @typedef {PassVerdict | FailVerdict | MalformedVerdict} Verdict
 */

/** @type {ReadonlyArray<'status'|'must_haves_total'|'must_haves_verified'|'gaps_count'>} */
const REQUIRED_FIELDS = /** @type {const} */ ([
  'status',
  'must_haves_total',
  'must_haves_verified',
  'gaps_count',
]);

/** @type {ReadonlyArray<'must_haves_total'|'must_haves_verified'|'gaps_count'>} */
const NUMERIC_FIELDS = /** @type {const} */ ([
  'must_haves_total',
  'must_haves_verified',
  'gaps_count',
]);

/** Hostile keys dropped to mitigate prototype-pollution (T-10-01-05). */
const HOSTILE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Closed set of known statuses → coarse disposition. */
const STATUS_MAP = /** @type {Readonly<Record<string, 'pass'|'fail'>>} */ (
  Object.freeze({
    passed: 'pass',
    gaps_found: 'fail',
    failed: 'fail',
  })
);

/**
 * Parse the YAML frontmatter of a VERIFICATION.md string.
 *
 * Only the 4 required fields are extracted; everything else (extra scalars,
 * nested objects, arrays, YAML anchors) is ignored silently by design.
 * Quoted scalars (`key: "value"`) are accepted and the quotes stripped.
 *
 * Never throws: all malformed inputs produce `{ error }` results.
 *
 * @param {string} md - Raw VERIFICATION.md content.
 * @returns {ParsedFrontmatter | ParseError}
 */
export function parseVerificationFrontmatter(md) {
  if (typeof md !== 'string') {
    return { error: 'input must be string' };
  }

  // Extract the frontmatter block. Anchored at the very start: the file must
  // begin with `---` followed by content, then a closing `---` on its own line.
  const fmMatch = md.match(/^---\s*\n([\s\S]*?)\n---(?:\s|$)/);
  if (!fmMatch) {
    return { error: 'no frontmatter block' };
  }

  const body = fmMatch[1];
  if (body.trim().length === 0) {
    return { error: 'empty frontmatter block' };
  }

  // Walk the block line-by-line. Only accept top-level scalar assignments
  // (`key: value`) where the key is `\w+` and starts at column 0 — this
  // naturally filters out YAML arrays (`  - ...`), nested object keys
  // (`  previous_status: ...`), and malformed lines.
  //
  // Regex breakdown:
  //   ^                 — anchored at start of line (no leading space)
  //   ([A-Za-z_]\w*)    — key: letters/underscore then word chars (no digit-
  //                       prefix; excludes `123:` but accepts `__proto__`,
  //                       which is then filtered by HOSTILE_KEYS).
  //   :\s*              — colon + optional whitespace
  //   "?(.*?)"?         — value, with optional surrounding double quotes
  //   \s*$              — trailing whitespace
  const re = /^([A-Za-z_]\w*):\s*"?(.*?)"?\s*$/;

  const parsed = Object.create(null);

  const lines = body.split('\n');
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const key = m[1];
    if (HOSTILE_KEYS.has(key)) continue; // T-10-01-05 defense in depth
    // Only keep keys we care about — extras are dropped at parse time.
    if (!REQUIRED_FIELDS.includes(/** @type {any} */ (key))) continue;
    // B12a (Phase 72): strip an inline YAML comment from the value. A `#` is a
    // comment when it begins the value region (comment-only, `key: # x`) or is
    // preceded by whitespace (`status: passed  # ok`); a `#` glued to non-space
    // text is literal (`pa#ss` stays). So `passed # comment` → `passed`,
    // `3 # three` → `3`, and `# only` → '' (treated as an absent value).
    let value = m[2];
    if (value.startsWith('#')) {
      value = '';
    } else {
      const hashIdx = value.search(/\s#/);
      if (hashIdx !== -1) value = value.slice(0, hashIdx).trimEnd();
    }
    // If the captured value is empty (`key:` or `key: # only-comment`) we skip so
    // the missing-field check below fires with an accurate error.
    if (value === '') continue;
    parsed[key] = value;
  }

  // Validate presence of every required field.
  for (const field of REQUIRED_FIELDS) {
    if (!(field in parsed)) {
      return { error: `missing field ${field}` };
    }
  }

  // Coerce numeric fields. `parseInt` with an explicit radix and a strict
  // check against the round-trip guards against values like `8abc` which
  // parseInt would otherwise accept as 8.
  for (const field of NUMERIC_FIELDS) {
    const raw = String(parsed[field]);
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || String(n) !== raw.trim()) {
      return { error: `field ${field} not numeric: ${raw}` };
    }
    parsed[field] = n;
  }

  // Status stays as a string (already unquoted by the regex).
  return {
    status: /** @type {string} */ (parsed.status),
    must_haves_total: /** @type {number} */ (parsed.must_haves_total),
    must_haves_verified: /** @type {number} */ (parsed.must_haves_verified),
    gaps_count: /** @type {number} */ (parsed.gaps_count),
  };
}

/**
 * Compute the verdict from a parsed frontmatter (or a parse error).
 *
 * Returns a discriminated union over `action`:
 *   - `pass`      — all three D-07 conditions satisfied simultaneously.
 *   - `fail`      — one of the documented fail reasons (see precedence above).
 *   - `malformed` — parser error OR unknown status value.
 *
 * The `missing` verdict (file absent) is emitted by src/gsd/verify.js (Plan
 * 10-02) and is NOT reachable from this function — the distinction matters
 * because `missing` is a filesystem condition; this module deals only with
 * in-memory content.
 *
 * Never throws.
 *
 * @param {ParsedFrontmatter | ParseError} parsed
 * @param {string} phaseId - The phase identifier (e.g. '10', '72.1').
 * @returns {Verdict}
 */
export function computeVerdict(parsed, phaseId) {
  // Parse-error short-circuit → malformed (the error detail is preserved so
  // the Plane comment / NDJSON log can explain WHY the frontmatter failed).
  if (parsed && /** @type {ParseError} */ (parsed).error !== undefined) {
    return {
      action: 'malformed',
      phase_id: phaseId,
      detail: /** @type {ParseError} */ (parsed).error,
    };
  }

  const p = /** @type {ParsedFrontmatter} */ (parsed);

  // Unknown status → malformed (D-09 closed set).
  const disposition = STATUS_MAP[p.status];
  if (disposition === undefined) {
    return {
      action: 'malformed',
      phase_id: phaseId,
      detail: `unknown status '${p.status}'`,
    };
  }

  // Precedence (most specific first):
  //   1. Any gaps → gaps-found (wins over verified<total and status=failed).
  if (p.gaps_count > 0) {
    return {
      action: 'fail',
      phase_id: phaseId,
      reason: 'gaps-found',
      detail: `gaps_count=${p.gaps_count}`,
    };
  }

  //   2. verified !== total → must-haves-incomplete. B3 (Phase 72): usar `!==`
  //      en vez de `<` para que un `verified > total` inconsistente (p.ej. 99/3)
  //      también se rechace en vez de colarse como pass.
  if (p.must_haves_verified !== p.must_haves_total) {
    return {
      action: 'fail',
      phase_id: phaseId,
      reason: 'must-haves-incomplete',
      detail: `verified=${p.must_haves_verified} total=${p.must_haves_total}`,
    };
  }

  //   3. status disposition=fail with counts OK → status-failed. This fires
  //      ONLY when the counts agree with pass but the status explicitly says
  //      failed/gaps_found (inconsistency) — otherwise the earlier clauses
  //      would have handled it.
  if (disposition === 'fail') {
    return {
      action: 'fail',
      phase_id: phaseId,
      reason: 'status-failed',
      detail: `status=${p.status}`,
    };
  }

  // All three D-07 conditions satisfied.
  return {
    action: 'pass',
    phase_id: phaseId,
    must_haves: p.must_haves_total,
  };
}
