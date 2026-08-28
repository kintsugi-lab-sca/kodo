// @ts-check
//
// src/integration/suggest.js — KODO-26 (integration queue): tier heuristic.
//
// PURE leaf with ZERO imports: a branch's diff summary goes in, ONE suggestion of how to
// integrate it comes out. It does no I/O, does not call git, does not read state.json and never throws.
// The diff is computed by `capture.js`; the one who really decides is the operator — this is
// a visible, explainable SUGGESTION, not a decision (invariant of the statement).
//
// The mapping is the operator's 3-tier merge policy (blast radius):
//   docs/tests-only            → 'ff'      (Tier 1: low risk, local fast-forward)
//   src with nothing sensitive → 'merge'   (Tier 2: feature/refactor)
//   migrations/auth/billing    → 'pr'      (Tier 3: high risk, PR + review)
//   large diff (> THRESHOLD)   → 'pr'      (size is its own blast radius)
//   no inspectable data        → 'review'  (kodo does NOT guess: let a human look)
//
// DEGRADATION ON A STALE BASE (hard rule, not a heuristic): an `ff` is only suggested if the
// branch contains the whole base (`baseOk === true`). If the base moved underneath, or if it could
// not be verified (`null`), `ff` is NOT applicable — `git merge --ff-only` would fail — and the
// suggestion drops to 'merge'. It is the only rule that can override the rest, and it only goes in that
// direction: it never raises a tier, it never turns a 'pr' into something cheaper.

/**
 * Threshold of touched lines (insertions + deletions) beyond which size alone decides:
 * a diff that big is no longer reviewed at a glance in a local fast-forward. A deliberate, round
 * value — it is not calibrated against any measurement, it is the line the operator can move
 * in one place. Compared with `>` (exactly 400 does not force a PR yet).
 */
export const BIG_DIFF_LINES = 400;

/**
 * High blast-radius paths (Tier 3). MODULE CONSTANT, never compiled from external
 * input (anti-ReDoS). Flat alternation with no nested quantifiers: no catastrophic
 * backtracking is possible.
 *
 * It covers the three families the operator names explicitly — schema migrations,
 * authentication and payments — plus credential files, which belong to the same class
 * ("if this goes wrong, a revert does not fix it"). The match is per path SEGMENT
 * (`(^|/)…(/|$)`), not per substring: `src/authors/index.js` is NOT `auth`, and `db/migrate/…` is.
 */
const RISKY_PATH_RE =
  /(^|\/)(db\/migrate|migrations?|migrate|auth|authentication|authorization|billing|payments?|stripe|subscriptions?|credentials|secrets)(\/|$)|(^|\/)(schema\.rb|structure\.sql|\.env|\.env\.[A-Za-z0-9_.-]+|master\.key)$/i;

/**
 * Documentation and tests (Tier 1). Same discipline as `RISKY_PATH_RE`: constant, flat
 * alternation, per-segment match except for the extensions.
 *
 * It includes `.planning/` and `.compound/` because in this repo they are process documentation, not
 * code — a change there cannot break the suite. It includes the suffixes `*.test.js`,
 * `*.spec.ts`, `*_test.go` and the directories `test/`, `spec/`, `__tests__/`.
 */
const DOCS_TESTS_PATH_RE =
  /(^|\/)(docs?|documentation|\.planning|\.compound|test|tests|spec|specs|__tests__)(\/|$)|\.(md|mdx|txt|rst|adoc)$|(^|\/)[^/]+[._-](test|spec)\.[A-Za-z0-9]+$/i;

/**
 * Derives a branch's integration suggestion.
 *
 * PURE and TOTAL: any input — degenerate ones included (`files` non-array, `lines`
 * NaN, empty object, `undefined`) — returns one of the four literals. It never throws.
 *
 * @param {{
 *   files?: string[] | null,
 *   lines?: number | null,
 *   baseOk?: boolean | null,
 * }} [input]
 *   `files`: relative paths touched by the branch with respect to its base. `null` (or non-array) =
 *   the diff could NOT be inspected — different from `[]`, which means "it was inspected and there are no
 *   files" (typical of a branch with merge commits only). Both fall to 'review', but for
 *   different and equally legitimate reasons: with no files there is no blast radius to estimate.
 *   `lines`: insertions + deletions. `null` = unknown → does not trigger the size cut-off.
 *   `baseOk`: does the branch contain the whole base? Only `true` enables 'ff'.
 * @returns {'ff'|'merge'|'pr'|'review'}
 */
export function suggestTier(input) {
  const files = input && Array.isArray(input.files) ? input.files : null;
  const lines = input && typeof input.lines === 'number' && Number.isFinite(input.lines)
    ? input.lines
    : null;
  const baseOk = input ? input.baseOk : undefined;

  // With no inspectable diff there is no honest heuristic to apply. 'review' is NOT a convenience
  // fallback: it is the fourth tier of the contract, and it means exactly "kodo does not know".
  if (files === null || files.length === 0) return 'review';

  if (files.some((f) => typeof f === 'string' && RISKY_PATH_RE.test(f))) return 'pr';
  if (lines !== null && lines > BIG_DIFF_LINES) return 'pr';

  const docsTestsOnly = files.every((f) => typeof f === 'string' && DOCS_TESTS_PATH_RE.test(f));
  // The degradation goes here, in the only lane that can produce 'ff' — not as a
  // post-process over the result, so that degrading a 'pr' by mistake is impossible.
  if (docsTestsOnly) return baseOk === true ? 'ff' : 'merge';

  return 'merge';
}
