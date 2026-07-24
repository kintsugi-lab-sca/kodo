# Phase 81: Saneo de deuda v0.17 - Research

**Researched:** 2026-07-24
**Domain:** Brownfield technical-debt cleanup — Node.js state merge semantics, TUI render projection (Ink), JSDoc doc-drift, cross-process lock-race diagnosis
**Confidence:** HIGH (all findings verified against the actual codebase this session; zero external dependencies)

## Summary

Phase 81 closes four minor debt items the v0.17 audit routed to backlog. All four are **inside the existing codebase** — there is nothing to install, no external service, no new dependency (the "cero nuevas dependencias npm" invariant holds trivially). Research is therefore codebase verification, not ecosystem discovery: confirm the exact code sites the discuss-phase already identified, surface the load-bearing subtleties an executor would miss, and codify the invariants that must survive.

The single highest-risk item is **DEBT-01** (clearable `next`). It is *not* a one-line change: the current `upsertTaskHandoff` merge (`entry.next ?? (prev ? prev.next : null) ?? null`, `state.js:448`) conflates `null` and `undefined`, and the sole caller (`session-end.js:389`) currently funnels **both** the LLM-authored branch and the mechanical-backstop branch through the *same* upsert call with the *same* `next: null` value. Implementing the three-state contract (overwrite / clear / preserve) requires touching **both** files *and* rewriting two existing tests whose current assertions encode the old "null = preserve" semantics. Getting this wrong silently regresses either the Phase 74 asymmetry invariant (mechanical close resurrecting/erasing a real `NEXT:`) or the Phase 75 LIVE-07 nudge contract.

The other three are genuinely small: **DEBT-03** is a pure `/\s+/g`→`' '`+`trim` render collapse in `nextCell` (`format.js:258`); **DEBT-02** is two doc-only edits (a comment and a typedef) with zero behavior change; **DEBT-04** is a *diagnosis deliverable* (a `/gsd-debug` artifact), explicitly **not** a fix — `src/gsd/lock.js` is READ-ONLY unless a root cause is confirmed that does not alter v0.16 lock semantics.

**Primary recommendation:** Split into two lanes exactly as the discretion note suggests — a surgical-code lane (DEBT-01 + DEBT-02 + DEBT-03) and an isolated diagnostic lane (DEBT-04). Treat DEBT-01 as the only item needing careful multi-file coordination + test rewrites; the rest are near-mechanical. Do not touch `lock.js`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DEBT-01 clear/stale `next` semantics | State/persistence (`src/session/state.js`, under `withStateLock`) | Hook caller (`src/hooks/session-end.js`) | The merge contract lives in the writer; the authorship→contract mapping (LLM-clear vs mechanical-preserve) lives in the single caller |
| DEBT-02 doc-drift (comment + typedef) | TUI/dashboard (`App.js`, `SessionTable.js`) | — | Documentation of render-tier components; zero runtime surface |
| DEBT-03 whitespace collapse | TUI render projection (`src/cli/dashboard/format.js`, `nextCell`) | — | The collapse is a layout transformation at the render projection point; persisted datum stays verbatim |
| DEBT-04 flaky lock-race diagnosis | Test/infra (`test/gsd-lock-race.test.js`) | Lock primitive (`src/gsd/lock.js`, READ-ONLY) | Diagnosis of a cross-process timing flaky; the product primitive is protected (v0.16 invariant, LOCKED) |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**DEBT-01 — clear semantics:**
- **D-01:** `upsertTaskHandoff` moves from the current binary asymmetry (`entry.next ?? prev.next` — any absence preserves) to **three-state discrimination**: `next: string` non-empty → overwrites; `next: null` explicit → **deliberate clear** (erases prev, persists `null`); field `next` **absent** (`undefined`) → preserves prev. The current `??` conflates `null` and `undefined`; discrimination requires `entry.next !== undefined` (or `'next' in entry`).
- **D-02:** The caller (`src/hooks/session-end.js`) maps authorship to the contract: **LLM-authored handoff with no `NEXT:` line** → pass `next: null` (LLM actively asserted no next step → clear); **mechanical backstop** (LLM wrote no block; hook appends the minimum without `NEXT:` per Phase 74 D-03) → **omit** the `next` field (that session "said nothing" → preserve). This keeps intact the original asymmetry rationale (74/WR-02: a mechanical close must neither resurrect nor erase a real `NEXT:`) and closes the stale case: the LLM that closes with no next clears the pointer.
- **D-03:** Rejected alternatives: (a) timestamp staleness + TUI dimming — more machinery, touches render and poll, YAGNI for a minor item; (b) always-clear-on-absence — regresses Phase 74 D-03 (the mechanical backstop would erase a valid `NEXT:` from an earlier session of the same task).
- **D-04:** No schema bump: `null` is already a legal value (`next: string|null`). JSDoc of `upsertTaskHandoff` and `session-end.js` updated with the three-state table; `test/state/handoff-state.test.js` gains the `null`-clear and `undefined`-preserve cases. Telemetry invariant: `next` is still never logged (T-71-18).

**DEBT-03 — whitespace collapse in render:**
- **D-05:** The collapse lives in `nextCell` (`src/cli/dashboard/format.js:258`) — the render projection point, matching the item wording ("in the ROW render"). Policy: replace any whitespace sequence (`/\s+/g`, covers `\n`, `\t`, `\r`, multiple spaces) with a single space + `trim`; if the result is empty → `''` (empty cell, no placeholder — SC5 intact).
- **D-06:** The persisted datum in `state.json` stays **verbatim** — not sanitized on write (`upsertTaskHandoff` does not touch content) nor on merge in the App.js enrich (which still applies only `stripControlChars`, Phase 78 lane intact). Pure render fix: a rare hand-edited source does not justify mutating the origin datum.
- **D-07:** `nextCell` stays pure, no own color (color-isolation D-12 of Phase 75) and never-throws (non-string input → `''` as today).

**DEBT-04 — flaky `gsd-lock-race` diagnosis:**
- **D-08:** The deliverable is the **documented diagnosis**, not the fix: run `/gsd-debug` against "concurrent dead-holder steal (CR-01)" (`test/gsd-lock-race.test.js:142`) with a reproduction attempt under load (N repetitions / suite in parallel — the flaky manifests "under load", and there is precedent of 12 consecutive green cold runs 2026-07-06). The debug artifact + a resolution note in the phase directory satisfy DEBT-04.
- **D-09:** Fix gate (LOCKED constraint, do not re-discuss): a change is applied **only** if the root cause is understood AND the change does not alter v0.16 lock semantics (`src/gsd/lock.js`: atomic `acquireGsdLock`, steal CAS tmp+rename, ABA guard). If the cause is in the test harness (process-startup timing, not the product), the legitimate fix is to the test. Forbidden blind: retries, `skip`, raising timeouts, or touching `lock.js` without a cause.
- **D-10:** If after an honest attempt it does not reproduce, the valid outcome is to document the non-repro (conditions attempted, open hypotheses) and, if cheap, leave low-cost instrumentation in the test itself (e.g. dump the verdicts on failure) for the next manifestation. The item closes as "diagnosed: not reproducible cold; instrumented", without touching production.

**DEBT-02 — doc-drift of Phase 75:**
- **D-11:** Surgical doc-only changes, zero behavior: (a) the comment at `src/cli/dashboard/App.js:735` ("reads the tasks block … ONCE per tick") is corrected to describe the render reality that 75/WR-02 flagged — the executor reads the exact finding in `75-REVIEW.md` before rewording; (b) the typedef of the `overlaySnapshot` prop in `src/cli/dashboard/SessionTable.js:817` gains `render?: 'markdown'|'plain'` — a mirror of the `PlanResult` at `src/cli/dashboard/plan.js:48` that already declares it.
- **D-12:** Tier 1 (low risk): no new tests — the existing suite must stay green unmodified, proof there was no behavior change.

### Claude's Discretion
Exact wording of the corrected comments/JSDoc, structure and naming of the new DEBT-01/DEBT-03 tests, grouping of items into plans (natural candidate: DEBT-01+02+03 as a surgical-code lane, DEBT-04 as a separate diagnostic lane — the planner decides), and the format of the DEBT-04 diagnostic artifact within `/gsd-debug` conventions.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. (FUT-01 markdown fidelity, FUT-02 doctor config↔projects, and FUT-03 LLM gate already traced in REQUIREMENTS §Future.) Out of the phase: overlay markdown fidelity (FUT-01), assisted `kodo doctor --fix` config↔projects (FUT-02), any change to v0.16 lock semantics without a confirmed root cause, changes to the sidebar doctor (Phases 79-80, closed), new endpoints, new npm deps.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEBT-01 | A session close with no `NEXT:` no longer leaves a stale `next` in `state.tasks` — clear/stale semantics decided and applied in `upsertTaskHandoff` (`src/session/state.js`) | Verified merge site (`state.js:448`), single caller (`session-end.js:389`), existing test suite structure, and `extractNext` null-contract (`handoff.js:287`). See "Deep Finding: DEBT-01" and Pitfalls 1-3. |
| DEBT-02 | Phase 75 doc-drift corrected — App.js "reads tasks once per tick" comment (75/WR-02) and `overlaySnapshot` typedef missing `render` (75/WR-04) | Verified exact sites: `App.js:735-739`, `SessionTable.js:817`, mirror typedef `plan.js:48`. WR text quoted from `75-REVIEW.md`. |
| DEBT-03 | `nextCell` collapses `\n`/`\t` in row render — a hand-edited `next` in `state.json` does not skew the table (75/WR-03) | Verified `nextCell` (`format.js:258`), `rowCells` consumer (`:271`), enrich stays `stripControlChars`-only (`App.js:753`). Pattern precedent: `SessionTable.js` adopt picker `.replace(/\s+/g, ' ')`. |
| DEBT-04 | The `gsd-lock-race` flaky ("concurrent dead-holder steal", CR-01) has a documented root-cause diagnosis via `/gsd-debug`; touched only with the cause understood (protects the v0.16 locks invariant) | Verified test harness (`raceGsdStealDeadHolder`, `:74-118`), the CAS steal path (`lock.js:283-351`), the `/gsd-debug` artifact convention (`.planning/debug/`). See "Deep Finding: DEBT-04". |
</phase_requirements>

## Deep Finding: DEBT-01 (the only non-trivial item)

**This is the section the planner and executor must not skim.** The three-state contract is a multi-file, test-breaking change.

### Current behavior (verified)

`src/session/state.js:448` — the merge line:
```js
next: entry.next ?? (prev ? prev.next : null) ?? null,
```
`??` treats `null` and `undefined` identically → **both** preserve `prev.next`. There is no way today for a caller to *clear*.

`src/hooks/session-end.js` — the **single production caller** (`stateWriterFn`, `:389`):
```js
const upsertResult = stateWriterFn(
  taskId,
  { plan_path: r.value.planPath, next: r.value.next, updated_at: now().toISOString() },
  log,
);
```
Both branches inside `withFileLock` produce `r.value.next`, and **both currently yield `null` for a no-NEXT close**:
- LLM branch (`:347`): `return { planPath, next: extractNext(existing) }` — `extractNext` returns `null` when the block has no `**NEXT:**` line (`handoff.js:293,296`, verified).
- Mechanical backstop (`:376`): `return { planPath, next: null }` — "El bloque mecánico no lleva NEXT por diseño".

So today, at the upsert call, the two authorship cases are **indistinguishable** — both pass `next: null`, and the old `??` preserves in both. That is exactly the asymmetry Phase 74 wanted.

### Required change (D-01 + D-02)

1. **`upsertTaskHandoff` (writer):** discriminate on presence, not truthiness. Replace the `??` merge with a three-way decision:
   - `entry.next !== undefined` (or `'next' in entry`) **and** it is a non-empty string → overwrite.
   - `entry.next === null` (explicitly present) → **clear**: persist `null` regardless of `prev`.
   - `entry.next === undefined` / key absent → preserve `prev ? prev.next : null`.
   - Keep the no-prev default of `null` (so a first-ever write with the field absent still lands `null`, matching existing test `:312`).

2. **`session-end.js` (caller):** the two branches must now pass **different shapes**:
   - LLM-authored branch → pass `next: extractNext(existing)` (may be `null` → **clear**; the LLM said "no next step").
   - Mechanical backstop branch → **omit** `next` entirely (→ preserve prev).

   The branch identity is only known *inside* `withFileLock` (`findSessionBlock` hit vs miss). The `r.value` object returned from the lock must carry a discriminator (e.g. an `authored: 'llm' | 'auto'` flag, or return `next: undefined` for the mechanical branch and build the entry conditionally) so the code at `:389` can decide whether to include or omit `next`. **Do not** just pass `r.value.next` unconditionally — that would make every close either always-clear or always-preserve.

3. **LIVE-07 nudge coupling (Pitfall 5, carried from Phase 75):** the effective `next` returned by the upsert (`upsertResult.value.next`, `session-end.js:401-403`) threads the orchestrator nudge. After the change:
   - Mechanical close after a real `NEXT:` → field omitted → preserve → `value.next` = the real prior NEXT → **contextual** nudge (unchanged from today ✓).
   - LLM close with no NEXT → `next: null` → clear → `value.next` = `null` → **generic** nudge.
   Both must stay byte-consistent with the Phase 75 contract. The return object at `:404` and the effective-next computation must reflect the persisted (post-merge) value, not the incoming one.

### Test impact (verified against `test/state/handoff-state.test.js`)

The existing suite encodes the **old** semantics and will need edits — this is expected, not a regression:
- `:147` "un NEXT: real sobrevive a un cierre mecánico posterior" passes `next: null` (`:160`) to represent the mechanical close and asserts preservation. Under the new contract `next: null` **clears**. The mechanical close must be re-expressed as **field-absent** (omit `next`) for this test's intent to hold.
- `:224` "el value devuelto honra la ASIMETRÍA … cierre mecánico tras un NEXT: previo devuelve el previo" — same: the "mechanical close" is `next: null` (`:234`) and must become field-absent.
- `:300` "persists next: null as null" — stays true (null still persists as null) but its *meaning* is now "clear"; keep the assertion, optionally reword the comment.
- `:312` "defaults next to null when the field is omitted entirely" — with **no prev**, omit → preserve → `null`, so it still passes; keep it and add the **with-prev** counterpart.

**New cases to add (D-04):**
- `next: null` with a pre-existing `prev.next` → persists `null` (explicit clear).
- `next` field omitted with a pre-existing `prev.next` → preserves `prev.next` (the mechanical-close preserve path).
- Optionally: the LIVE-07 return value for both (clear → `value.next === null`; preserve → `value.next === prev.next`).

## Standard Stack

No external stack. This phase uses only what the repo already depends on:

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| `node:test` (built-in test runner) | Node ≥ (repo's engines) | Run/extend the suites | `package.json` script: `node --test $(find test -name '*.test.js' -type f)` [VERIFIED: package.json:10] |
| `node:assert/strict` | built-in | Assertions in new tests | Used throughout existing suites [VERIFIED: test/*.test.js] |
| `node:fs` | built-in | Locks / state I/O (already in place) | "locks vía `node:fs` built-in", "cero nuevas dependencias npm" invariant [VERIFIED: STATE.md:119] |
| `/gsd-debug` (GSD skill) | — | DEBT-04 diagnosis with persistent state | Internal GSD command, not an npm dep; artifacts land in `.planning/debug/` [VERIFIED: .planning/debug/resolved/] |

**Installation:** none. `npm install` adds nothing for this phase.

## Package Legitimacy Audit

**N/A — this phase installs no external packages.** The "cero nuevas dependencias npm" invariant (STATE.md §Critical Invariants) is explicitly in force. No registry lookups performed; none needed.

## Architecture Patterns

### Data-flow of the touched paths

```
DEBT-01 (write path):
  SessionEnd hook ─► writeHandoff() ──[withFileLock on <task>.md.lock]──►
      ├─ LLM block present  → next = extractNext(block)  (null if no NEXT: line)
      └─ mechanical backstop → (omit next)   ◄── D-02 change point
                        │
                        ▼
      upsertTaskHandoff(taskId, entry) ──[withStateLock on state.json]──►
          three-state merge (D-01):  string→overwrite / null→clear / absent→preserve
                        │
                        ├─► state.tasks[taskId].next  (persisted, verbatim)
                        └─► return value.next (effective) ─► buildStopNudgeText (LIVE-07)

DEBT-03 (read/render path):
  state.json ─► App.js enrich (stripControlChars only, verbatim otherwise)
             ─► rowCells() ─► nextCell()  ◄── D-05 collapse /\s+/g→' ' + trim
             ─► Ink <Box width:40 wrap:'truncate-end'> row
```

### Pattern 1: Collapse-at-projection (DEBT-03)
**What:** Sanitize/normalize untrusted content at the point it is projected to the render, not at persistence.
**When to use:** DEBT-03 — the datum stays verbatim in `state.json`; only `nextCell` collapses whitespace.
**Precedent in repo:** the adopt picker already does `.replace(/\s+/g, ' ')` via `truncateEllipsis` (`SessionTable.js`, cited in 75/WR-03). `nextCell` gets the mirror.
```js
// Source: src/cli/dashboard/format.js — nextCell (current, to be modified)
export function nextCell(session) {
  return typeof session.next === 'string' && session.next.length > 0 ? session.next : '';
}
// D-05 shape: collapse then trim, empty → ''
//   const s = typeof session.next === 'string' ? session.next.replace(/\s+/g, ' ').trim() : '';
//   return s;   // '' when empty — no placeholder (SC5), never-throws (D-07)
```

### Pattern 2: Layered sanitization (Phase 78 lane intact)
`stripControlChars` (App.js enrich) neutralizes control chars (OSC-52/CSI/C1); the whitespace collapse in `nextCell` is the **layout** layer that was missing. They are **complementary, not redundant** — do not move the collapse into the enrich (D-06 keeps the persisted/merged datum verbatim except for the existing `stripControlChars`).

### Anti-Patterns to Avoid
- **Passing `r.value.next` unconditionally in DEBT-01** — collapses the LLM-clear and mechanical-preserve branches into one behavior. The branch discriminator must survive out of `withFileLock`.
- **Sanitizing `next` on write for DEBT-03** — violates D-06; the fix is render-only.
- **Touching `src/gsd/lock.js` for DEBT-04 without a confirmed root cause** — violates the LOCKED v0.16 invariant (D-09).
- **Blind flaky remedies** — retries, `it.skip`, raising timeouts (D-09, explicitly forbidden).
- **Adding tests for DEBT-02** — it is doc-only; the unmodified green suite *is* the evidence (D-12).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Whitespace collapse (DEBT-03) | A custom char-by-char scanner | `str.replace(/\s+/g, ' ').trim()` | `\s` covers `\n \t \r` + spaces; mirrors the existing adopt-picker precedent |
| Three-state presence check (DEBT-01) | A truthiness heuristic | `entry.next !== undefined` / `'next' in entry` | Truthiness (`??`) is exactly the bug — it conflates `null` and `undefined` |
| Cross-process lock (DEBT-04) | Anything new | The existing `acquireGsdLock` CAS (READ-ONLY) | v0.16 invariant is LOCKED; this item is diagnosis, not construction |
| Reproducing a timing flaky | A bespoke stress rig | `node --test` looped + full-suite parallel load | The flaky is a real-child-process race; the existing harness already spawns children |

**Key insight:** Every "fix" in this phase is either a *removal* of complexity (replace a `??` with explicit presence checks; add one `.replace`) or a *non-change* (doc, diagnosis). No new machinery belongs here — YAGNI is a stated D-03 rationale.

## Common Pitfalls

### Pitfall 1: Treating DEBT-01 as a one-line writer change
**What goes wrong:** Editing only `state.js:448` and leaving `session-end.js` passing `next: null` for both branches. Result: either the mechanical backstop now *clears* a real `NEXT:` (regresses Phase 74 D-03), or nothing clears at all (DEBT-01 unmet).
**Why it happens:** The two authorship branches are invisible at the upsert call site — they already collapsed to `next: null` upstream.
**How to avoid:** Thread an authorship discriminator out of `withFileLock`; omit the field for the mechanical branch, pass `null` for the LLM-no-NEXT branch.
**Warning signs:** A close of a task with a prior `NEXT:` blanks its dashboard cell after a mechanical close.

### Pitfall 2: Breaking the existing handoff tests without understanding they encode old semantics
**What goes wrong:** The executor sees `:147`/`:224` fail after the writer change and "fixes" them by reverting the writer.
**Why it happens:** Those tests pass `next: null` as a stand-in for "mechanical close" — a meaning that D-02 moves to field-absent.
**How to avoid:** Update those two tests to express the mechanical close as **field-absent**; add explicit `null`-clear cases. Document the semantic move in the test comments.
**Warning signs:** Test names mentioning "asimetría" / "cierre mecánico" failing.

### Pitfall 3: Breaking the LIVE-07 nudge contract
**What goes wrong:** The nudge starts using the *incoming* `next` instead of the *persisted* one, so a mechanical close after a real NEXT sends a generic nudge (or vice versa).
**Why it happens:** `effectiveNext` (`session-end.js:401`) must read the post-merge `upsertResult.value.next`, not `r.value.next`.
**How to avoid:** Keep the return of the merged value from `upsertTaskHandoff` and keep the `effectiveNext` derivation reading it.
**Warning signs:** Phase 75 nudge tests (if any assert nudge text) or the LIVE-07 return-value tests (`:207`, `:224`, `:247`) failing.

### Pitfall 4: DEBT-03 collapsing away a legitimately-empty result into a placeholder
**What goes wrong:** After collapse+trim, a whitespace-only `next` becomes `''`; if the code then substitutes a placeholder (`—`), SC5 ("no noisy placeholder") is violated.
**How to avoid:** Return `''` for empty (matches current no-value branch). Keep `nextCell` pure and never-throws for non-string (D-07).

### Pitfall 5: DEBT-04 — "fixing" the flaky blind
**What goes wrong:** Adding retries / `skip` / higher timeouts, or editing `lock.js`, without a confirmed root cause.
**Why it happens:** Pressure to make CI green.
**How to avoid:** The deliverable is the **diagnosis artifact**, not a green test. If no repro, document non-repro + cheap instrumentation (D-10). `lock.js` is READ-ONLY (D-09).
**Warning signs:** A diff to `src/gsd/lock.js`, or a `t.skip`/retry in the test, with no accompanying root-cause note.

## DEBT-04 Diagnostic Guidance

### The flaky under investigation
`test/gsd-lock-race.test.js:142` — `describe('gsd lock steal race — concurrent dead-holder steal (CR-01)')`, cases at `:143` (2 processes) and `:153` (5 processes). Harness `raceGsdStealDeadHolder` (`:74-118`): pre-seeds a dead-PID (`99999999`) stale lock at `<repo>/.planning/.kodo.lock`, spawns N children that all hit `EEXIST`, observe the same stale lock, and take the steal path; the assertion is **exactly one `acquired`**. `--hold 500` keeps the steal-winner alive so losers see a live owner and reject.

### The CAS path being stressed (`src/gsd/lock.js:283-351`, READ-ONLY)
`stealLock` loops up to `MAX_STEAL_ATTEMPTS = 8`:
1. **Move-aside** `renameSync(lockPath, aside)` — only one stealer wins a given inode; losers get `ENOENT`.
2. **ABA guard** — if the moved-aside bytes are now a fresh live lock, restore + reject.
3. **O_EXCL create** `writeFileSync(lockPath, …, {flag:'wx'})` — lose with `EEXIST` → reject.

### Hypotheses worth testing (record which were attempted, per D-08/D-10)
- **Briefly-empty window:** between step 1 (move-aside) and step 3 (O_EXCL create) the lock path is momentarily absent. A losing stealer's `renameSync` gets `ENOENT`, then `readLockContent(lockPath)` returns `null` (empty window) → `holder && !isStale` is false → `continue` and re-contend → could O_EXCL-create and *also* win → **2 acquired**. Worth confirming whether the loop/ABA fully closes this or leaves a timing gap under load.
- **Harness timing / hold expiry:** if child spawn jitter is large relative to `--hold 500`, the steal-winner may exit (lock becomes dead again) before a "loser" evaluates → the loser legitimately steals a now-dead lock → **2 acquired**. This would be a *test-harness* cause (D-09: fix the test, e.g. longer/coordinated hold), not a product bug.
- **Cold vs load:** precedent is 12 consecutive green cold runs (2026-07-06); repro likely needs real load — run the **full** suite in parallel repeatedly, or loop the file many times while the machine is busy.

### Suggested repro commands (cold + load)
```bash
# Cold loop of just the flaky file
for i in $(seq 1 50); do node --test test/gsd-lock-race.test.js || { echo "FAILED run $i"; break; }; done

# Under load: the whole suite (spawns many concurrent child-process races), looped
for i in $(seq 1 20); do node --test $(find test -name '*.test.js' -type f) || { echo "FAILED run $i"; break; }; done
```

### Cheap instrumentation option (D-10, if no repro)
On assertion failure, the test currently prints `verdicts.join(',')` in the message — already low-cost. Consider additionally logging each child's exit path (which CAS branch it took) via the child helper's stdout so the *next* CI manifestation carries evidence. Keep it in the **test/helper**, never in `lock.js`.

### Artifact convention (verified)
`/gsd-debug` artifacts live in `.planning/debug/` and move to `.planning/debug/resolved/` when closed. Existing examples (`.planning/debug/resolved/state-tasks-missing-live04.md`) follow: `# Debug: <title>` → **Fecha / Gap / Metodología** → **## Síntoma** → **## Evidencia (verificada, no inferida)** → **## Root Cause** → **## Files Involved** → **## Suggested Fix Direction**. The DEBT-04 deliverable = this artifact + a resolution note in the phase directory (CONTEXT D-08).

## Runtime State Inventory

Not a rename/refactor/migration phase — no stored keys, service configs, OS registrations, secrets, or build artifacts are renamed. **None applicable — verified:** the four items are (1) in-code merge logic, (2) doc comments, (3) render projection, (4) a test diagnosis. The one datum touched (`state.tasks[taskId].next`) is *cleared* by new semantics but its key/schema is unchanged (D-04: no schema bump, `null` already legal). No data migration required — the clear applies to future closes; existing stale values are naturally overwritten on the next close of each task.

## Code Examples

### DEBT-01 — three-state merge (shape, executor to finalize)
```js
// Source: derived from src/session/state.js:448 (current) + CONTEXT D-01
// Current (conflates null/undefined):
//   next: entry.next ?? (prev ? prev.next : null) ?? null,
// Target three-state:
let nextValue;
if (!('next' in entry) || entry.next === undefined) {
  nextValue = prev ? prev.next : null;          // absent → preserve
} else if (entry.next === null) {
  nextValue = null;                             // explicit → clear
} else {
  nextValue = entry.next;                       // non-empty string → overwrite
}
// persisted = { plan_path: entry.plan_path, next: nextValue, updated_at: ... }
```

### DEBT-02 — the typedef mirror (verified target)
```js
// Source: src/cli/dashboard/plan.js:48 (already declares render)
//   @typedef {{ status: ..., lines: string[], render?: 'markdown'|'plain' }} PlanResult
// SessionTable.js:817 (current — missing render):
//   @param {{ kind:..., taskRef:string, status:string, lines:string[] }|null} [props.overlaySnapshot]
// Target: add render?: 'markdown'|'plain' to match renderOverlay's own JSDoc (:176)
```

## State of the Art

Not applicable — no evolving external technology in scope. The only "state of the art" concern is internal: the Phase 74 asymmetry (documented as *design*, JSDoc `state.js:403-409`) is being **refined**, not reverted. The executor must rewrite that JSDoc block with the three-state table (D-04) rather than delete the asymmetry rationale.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The briefly-empty-window hypothesis is a *plausible* CR-01 cause | DEBT-04 Diagnostic | Low — it is offered as a hypothesis to test, not a conclusion; D-08 requires actual repro before any fix |
| A2 | Threading an `authored` discriminator out of `withFileLock` is the cleanest way to distinguish DEBT-01 branches | Deep Finding DEBT-01 | Low — the executor may instead have the mechanical branch return `next: undefined` and build the entry conditionally; either satisfies D-02 |

**All other findings were verified this session against the live codebase.** No external/registry claims were made.

## Open Questions

1. **Does the CR-01 flaky reproduce at all on the current machine?**
   - What we know: 12 green cold runs on 2026-07-06; the assertion is exact-one-acquired.
   - What's unclear: whether it manifests under the current Node version / hardware without heavy load.
   - Recommendation: run the cold + load loops (above) first; if no repro, the valid outcome is D-10 (document non-repro + cheap instrumentation), not a forced fix.

2. **Exact re-wording of the App.js:735 comment (DEBT-02a).**
   - What we know: WR-02 says the read happens on *every render*, not "once per tick"; the minimal fix is to reword to "one synchronous read per render".
   - What's unclear: whether the executor also wants the robust option (memoize to `onResult`) — but D-11/D-12 scope this to **doc-only**, so the reword is the intended action.
   - Recommendation: reword only; do not change render behavior (that would break D-12's "unmodified green suite" evidence).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js + `node --test` | All test work + DEBT-04 repro | ✓ (repo runs its suite in CI) | repo `engines` | — |
| `/gsd-debug` skill | DEBT-04 diagnosis | ✓ (GSD installed; `.planning/debug/` exists) | — | Inline orchestrator diagnosis (precedent: `state-tasks-missing-live04.md` was done inline when debugger agents aborted) |
| git | Commit artifacts (`commit_docs: true`) | ✓ | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `/gsd-debug` has a documented inline fallback if the debugger subagent aborts (worktree base mismatch precedent).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + `node:assert/strict` |
| Config file | none — discovered via `find test -name '*.test.js'` [VERIFIED: package.json:10] |
| Quick run command | `node --test test/state/handoff-state.test.js` (DEBT-01) · `node --test test/dashboard/format*.test.js` (DEBT-03, if present) |
| Full suite command | `node --test $(find test -name '*.test.js' -type f)` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEBT-01 | `next: null` (explicit) clears a prior `NEXT:`; field-absent preserves it | unit | `node --test test/state/handoff-state.test.js` | ✅ (extend: add clear + preserve cases; rewrite `:147`,`:224`) |
| DEBT-01 | LIVE-07 return `value.next` reflects post-merge (clear→null, preserve→prev) | unit | `node --test test/state/handoff-state.test.js` | ✅ (extend) |
| DEBT-01 | Caller maps LLM-no-NEXT→clear, mechanical→preserve | unit | `node --test test/hooks/session-end*.test.js` (verify path) | ❓ Wave 0: confirm a session-end hook test exists; add caller-mapping case |
| DEBT-02 | Doc-only; behavior unchanged | regression | `node --test $(find test -name '*.test.js' -type f)` (must stay green, unmodified) | ✅ (no new test — D-12) |
| DEBT-03 | `nextCell` collapses `\n`/`\t`/multi-space to single space + trim; empty→`''`; non-string→`''` | unit | `node --test <format test file>` | ❓ Wave 0: locate the `format.js` test file; add `nextCell` whitespace cases |
| DEBT-04 | Diagnosis documented; no blind fix | manual/artifact | `/gsd-debug` artifact in `.planning/debug/` + repro loops | N/A (diagnosis deliverable, not an automated assertion) |

### Sampling Rate
- **Per task commit:** the quick run for the touched suite (`handoff-state.test.js` for DEBT-01; the format test for DEBT-03).
- **Per wave merge:** full suite (`node --test $(find test -name '*.test.js' -type f)`).
- **Phase gate:** full suite green before `/gsd-verify-work`. For DEBT-02 specifically, the full suite must pass **without modification** as proof of zero behavior change (D-12).

### Wave 0 Gaps
- [ ] Confirm the `nextCell`/`format.js` test file path (e.g. `test/dashboard/format.test.js`) — DEBT-03 cases land there; create if absent.
- [ ] Confirm a `session-end` hook test exists to assert the DEBT-01 caller mapping (LLM-clear vs mechanical-preserve); if absent, the writer-level tests plus a focused caller test cover it.
- [ ] No framework install needed — `node --test` is built-in.

## Security Domain

Security enforcement is not disabled in config, so treated as enabled. This phase is low-surface but has one genuine input-validation angle.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation / Output Encoding | yes (DEBT-03) | `state.json` `next` is operator-editable untrusted content projected to a terminal; `stripControlChars` (Phase 78, neutralizes OSC-52/CSI/C1) + the new `nextCell` whitespace collapse are the layered controls. DEBT-03 closes the layout half. |
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V6 Cryptography | no | — |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Terminal-injection via hand-edited `state.json` `next` (OSC-52/CSI) | Tampering | `stripControlChars` at enrich (existing, Phase 78) — **unchanged** by DEBT-03 |
| Table-layout corruption via `\n`/`\t` in `next` | Tampering (DoS-of-display) | DEBT-03 `nextCell` collapse `/\s+/g`→`' '` at render projection |
| Lock double-acquire (two GSD agents on one repo) | Tampering | The v0.16 CAS steal (`lock.js`) — **protected, READ-ONLY**; DEBT-04 only diagnoses the *test* flakiness, not a product weakening |

**Note:** DEBT-03 is a *defensive layout* fix, not a new security boundary — the keystroke lane was already closed in Phase 78; this path is reachable only via hand-edited/corrupt `state.json` (acknowledged low severity, 75/WR-03).

## Sources

### Primary (HIGH confidence — verified against live codebase this session)
- `src/session/state.js:385-465` — `upsertTaskHandoff`, the `??` merge (`:448`), asymmetry JSDoc (`:403-409`)
- `src/hooks/session-end.js:299-405` — `writeHandoff`, single upsert call (`:389`), branch returns (`:347`,`:376`), LIVE-07 effective-next (`:401-404`)
- `src/session/handoff.js:287-297` — `extractNext` null contract
- `src/cli/dashboard/format.js:248-282` — `nextCell` (`:258`), `rowCells` (`:271`)
- `src/cli/dashboard/App.js:734-759` — the WR-02 comment (`:735`) and enrich `stripControlChars` (`:753`)
- `src/cli/dashboard/SessionTable.js:817` — `overlaySnapshot` typedef (missing `render`) · `src/cli/dashboard/plan.js:48` — mirror `PlanResult`
- `src/gsd/lock.js:283-351` — `stealLock` CAS + ABA guard (READ-ONLY reference)
- `test/gsd-lock-race.test.js:74-162` — harness `raceGsdStealDeadHolder` + CR-01 cases · `test/helpers/lock-race-child.mjs` — child contract
- `test/state/handoff-state.test.js` — existing writer suite (structure, asymmetry cases `:147`,`:224`, null cases `:300`,`:312`)
- `.planning/milestones/v0.17-phases/75-…/75-REVIEW.md:66-98` — WR-02/WR-03/WR-04 exact text
- `.planning/REQUIREMENTS.md:26-29` · `.planning/STATE.md:59-119` — DEBT-01..04, invariants, LOCKED constraints
- `.planning/debug/resolved/state-tasks-missing-live04.md` — `/gsd-debug` artifact format
- `package.json:10` — test command

### Secondary / Tertiary
None — no web or registry sources were needed or used.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero external deps; all built-ins verified in-repo.
- Architecture / code sites: HIGH — every site read and line-verified this session.
- DEBT-01 semantics: HIGH — merge, caller, and test impact traced end-to-end.
- DEBT-04 root cause: MEDIUM — hypotheses are grounded in the verified CAS code but the actual cause is undetermined by design (diagnosis is the deliverable, D-08).

**Research date:** 2026-07-24
**Valid until:** 2026-08-23 (stable — internal codebase, no fast-moving external dependency)
