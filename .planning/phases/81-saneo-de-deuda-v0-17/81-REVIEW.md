---
phase: 81-saneo-de-deuda-v0-17
reviewed: 2026-07-24T08:14:14Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/cli/dashboard/App.js
  - src/cli/dashboard/format.js
  - src/cli/dashboard/SessionTable.js
  - src/hooks/session-end.js
  - src/session/state.js
  - test/dashboard-format.test.js
  - test/hooks/session-end-handoff.test.js
  - test/state/handoff-state.test.js
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 81: Code Review Report

**Reviewed:** 2026-07-24T08:14:14Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 81 ("saneo de deuda v0.17") landed three surgical implementation commits:
`b8869c2` (DEBT-01, three-state `next` merge in `upsertTaskHandoff` / `state.js`),
`31d2bfe` (DEBT-01, authorship mapping in `writeHandoff` / `session-end.js`), and
`f564d67` (DEBT-03, whitespace collapse in `nextCell` / `format.js`). DEBT-02 was
declared "doc-only". I reviewed the exact diffs against the surrounding code and
traced the full data path `writeHandoff → upsertTaskHandoff → effectiveNext → nudge`
and `App.js enrich → deriveAnyNext → nextCell → render`.

**The core logic is correct.** The three-state contract (absent→preserve, `null`→clear,
string→overwrite) is implemented cleanly and discriminated by field *presence*, not
truthiness; `prev` is read from the mutator's own locked `state` (no lost update); the
authorship mapping omits `next` for mechanical closes and includes it (even `null`) for
LLM closes; `effectiveNext` threads the post-merge value. All phase invariants hold:
`next` content is never logged (only `{task_id}`), writes go through `withStateLock`,
`nextCell` is `typeof`-guarded (never throws), `stripControlChars` remains in the App.js
enrich, and zero npm deps were added. The three test files exercise the contract
thoroughly (CLEAR/PRESERVE/OVERWRITE, asymmetry, effective-next threading, lock-timeout).

No blockers. Two warnings concern documentation/consistency debt that this "saneo de
deuda" phase was itself chartered to clear but left partially open, plus two low-impact
robustness notes.

## Warnings

### WR-01: DEBT-01 redefined `next` semantics but the read-side `TaskHandoff` typedef still documents the OLD (pre-DEBT-01) contract

**File:** `src/session/state.js:53`
**Issue:** Commit `b8869c2` changed the write semantics of `next`: an explicit `null`
now **clears** the stored pointer (it no longer preserves). The `upsertTaskHandoff`
docstring (lines 403–422) was updated to the three-state table, but the canonical
`TaskHandoff` typedef — the read-side contract every consumer reads — was missed. It
still asserts the superseded WR-02 rule:

> `// ... OJO al leerlo (WR-02): un `next` ausente/null NO borra el previo ... null aquí significa «ninguna sesión de esta tarea ha dejado nunca un NEXT:», no «el último cierre no lo traía».`

Every clause now contradicts the shipped behavior: `null` **does** erase the previous
value (deliberate LLM clear), and a persisted `null` can now mean "the LLM closed
without a NEXT:" — exactly the reading the comment tells maintainers to rule out. This
is the single most load-bearing typedef DEBT-01 touched, and DEBT-02's stated purpose
was "doc-only comment/typedef fixes"; the drift landed in the one field the phase
redefined. A grep confirms this is the *only* lingering pre-DEBT-01 asymmetry comment in
the changed modules — the other WR-02 mentions are unrelated (temp-file naming).
**Fix:** Replace the `next` field comment with the three-state contract, e.g.:
```js
 *   next: string|null,      // Handoff NEXT: (≤200, D-02). THREE-STATE write contract
 *                           // (DEBT-01, discriminado por PRESENCIA en upsertTaskHandoff):
 *                           // string→overwrite · `null` explícito→clear (cierre LLM sin
 *                           // NEXT:) · campo AUSENTE→preserve (backstop mecánico). Un `null`
 *                           // persistido significa "el último cierre LLM lo borró", NO
 *                           // "nunca hubo NEXT:". El NEXT: real vive byte-a-byte en el plan.
```

### WR-02: `deriveAnyNext` (column visibility) diverges from `nextCell` (cell render) after the DEBT-03 collapse — a whitespace-only `next` shows the column with a blank cell

**File:** `src/cli/dashboard/format.js:264-267` vs `src/cli/dashboard/select.js:258-260`
**Issue:** DEBT-03 made `nextCell` collapse+`trim` whitespace, so a whitespace-only
`next` (e.g. a hand-edited `"\n"` or `"   "`) now renders as `''`. But the column-visibility
predicate `deriveAnyNext` still counts presence by raw length:
`rows.some(r => typeof r.next === 'string' && r.next.length > 0)`. In the App.js enrich
(`App.js:756`) `stripControlChars` **preserves** `\n`/`\t`, so a `"\n"` survives as a
non-empty `row.next`. Result: `deriveAnyNext → true` (column emitted) while `nextCell → ''`
(blank cell). Before DEBT-03, `nextCell` returned the raw string, so the two predicates
agreed. The divergence is *within DEBT-03's own stated threat model* — the docstring
names "un `next` hand-editado en state.json" as the case it defends — so the fix is
incomplete on the visibility side. Impact is cosmetic (a `next` header appears above an
all-blank column), not a crash or data loss, hence WARNING not BLOCKER.
**Fix:** Make the visibility predicate agree with the renderer, e.g. have `deriveAnyNext`
test the collapsed form (`nextCell(r).length > 0`) or apply the same `.replace(/\s+/g,' ').trim()`
so a whitespace-only `next` no longer triggers the column.

## Info

### IN-01: three-state merge can persist a dropped `next` key when a prior `tasks` entry lacks `next`

**File:** `src/session/state.js:458-459`
**Issue:** In the PRESERVE lane, `nextValue = prev ? prev.next : null`. If `prev` exists
but has no `next` property (a legacy or hand-edited `state.tasks` row), `prev.next` is
`undefined`, so `persisted.next = undefined` and `JSON.stringify` drops the key entirely —
producing a `TaskHandoff` that violates its own `next: string|null` shape. Unreachable
from the real hook (every `upsert`-written entry always carries `next`), and downstream
readers (`deriveAnyNext`, `nextCell`) are `typeof`-guarded, so no crash. Robustness only.
**Fix:** Coalesce to `null`: `nextValue = prev && prev.next != null ? prev.next : null;` (or
`prev?.next ?? null`), so the field is always `string|null`.

### IN-02: OVERWRITE branch accepts an empty string although the contract table says "non-empty string"

**File:** `src/session/state.js:462-463`
**Issue:** The `else` branch (`nextValue = entry.next`) fires for any value that is not
`undefined`/absent and not `null` — including `''`. The DEBT-01 contract table labels this
lane "non-empty string → OVERWRITE". Current callers never pass `''` (`extractNext` returns
`null` for an empty NEXT, and the mechanical branch omits the field), so this is latent, but
`upsertTaskHandoff` is exported and a future caller passing `''` would persist an empty
string rather than being routed to clear/preserve. Self-consistent with the renderer
(`nextCell('') → ''`, `deriveAnyNext` treats length-0 as absent), so no visible defect today.
**Fix:** Either document that `''` is a legal overwrite that renders as an empty cell, or
guard the branch (`else if (entry.next !== '')`) to match the "non-empty" wording.

---

_Reviewed: 2026-07-24T08:14:14Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
