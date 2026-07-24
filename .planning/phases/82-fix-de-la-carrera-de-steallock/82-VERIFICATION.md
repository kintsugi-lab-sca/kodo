---
phase: 82-fix-de-la-carrera-de-steallock
verified: 2026-07-25T00:00:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
notable_findings:
  - id: "82-REVIEW-CR-01"
    severity: warning
    scope: out-of-phase-scope
    summary: "82-REVIEW.md (post-execution code review) found a genuine second-order race in the PRESENT-lock branch of stealLock: an unconditional renameSync(tmp→lockPath) can clobber a fresh acquireGsdLock Case-1 creator when the pre-steal holder is a LIVE stale holder (TTL-expired or corrupt-but-alive) that releases mid-steal — because Case-1 creates bypass the steal-guard entirely. This is invisible to CR-01's harness and to the new guard unit tests, which only seed a DEAD-PID stale holder. Not tracked in STATE.md Deferred Items or the closed debug session. Recommend filing as a new debt item for a future phase."
---

# Phase 82: Fix de la carrera de `stealLock` Verification Report

**Phase Goal:** Con N≥2 procesos robando el mismo lock GSD muerto, exactamente uno adquiere — la ventana no-atómica move-aside→`O_EXCL` de `stealLock` queda cerrada con un fix real (no enmascarando) y el test lo prueba en verde de forma determinista.
**Verified:** 2026-07-25
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (roadmap Success Criteria + requirements) | Status | Evidence |
|---|---|---|---|
| 1 | N≥2 procesos robando el mismo lock GSD MUERTO → exactamente uno adquiere; la ventana move-aside→`O_EXCL` cerrada por construcción (LOCK-01, SC1) | ✓ VERIFIED | `stealLock` no more contains `renameSync(lockPath → aside)` — only `renameSync(tmp → lockPath)` remains (grep confirmed, `src/gsd/lock.js:461`). Ownership is now split: guard ownership via `linkSync` atomic-content publish, lock ownership solely via `renameSync(tmp→lockPath)` or `O_EXCL` create on an absent path. Behavioral evidence: `test/gsd-lock-race.test.js` re-run 12× fresh (0/12 failures) + SUMMARY-documented 100/100 (4× parallel load) and a prior 300-iteration rework validation (0 failures both), plus `test/gsd-lock-guard.test.js` cases (a)/(c)/(d)/(f) (dead-PID orphan, aged-live, crash-mid-steal, aged-unparseable) all pass. |
| 2 | El test `gsd-lock-race` pasa verde de forma determinista en ejecuciones repetidas, sin debilitar el assert ni enmascarar (LOCK-02, SC2) | ✓ VERIFIED | `git diff --quiet -- test/gsd-lock-race.test.js test/helpers/lock-race-child.mjs` → CLEAN (harness byte-identical, D-07). `assert.equal(...exactly one...)` intact at 4 call sites, no `.skip`, no retries, no raised timeouts (grep confirmed). Re-run 12/12 clean locally; SUMMARY documents 100/100 under 4× parallel load (repro baseline was ~48% failure). |
| 3 | La suite completa sigue verde tras el fix, sin regresiones (SC3) | ✓ VERIFIED | `npm test` run live: **2371 tests · 2370 pass · 0 fail · 1 skip · 0 todo** (21.5s) — matches SUMMARY's claimed 2370 pass. |
| 4 | R-81-01 y la debug session `gsd-lock-race-cr01` formalmente cerradas (STATE.md Deferred Items + debug session file) (LOCK-03, SC4) | ✓ VERIFIED | `.planning/debug/resolved/gsd-lock-race-cr01.md` exists; `.planning/debug/gsd-lock-race-cr01.md` no longer exists (moved). File contains a `### RESUELTO (2026-07-25, v0.19 Phase 82)` subsection with fix mechanism, commits, and stress evidence — original root-cause diagnosis preserved above it (not deleted). `.planning/STATE.md` §Deferred Items row "Carrera real confirmada en `stealLock`" reads "✅ **Cerrada**" with commit refs and evidence; other rows (WR-01/02, Nyquist) untouched. |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/gsd/lock.js` | `stealLock` rewritten (O_EXCL steal-guard + in-place atomic replace), docblock rewritten (D-11), no new exports | ✓ VERIFIED | Read in full. `stealLock` (lines 424-508) implements guard (`acquireStealGuard`/`guardIsStale`/`breakStaleGuard`/`readGuard`, all private/unexported), atomic `renameSync(tmp→lockPath)` present branch, `O_EXCL` absent branch (Pitfall 2 respected), bounded `MAX_STEAL_ATTEMPTS` loop, and a non-window-reopening exhaustion fallback. Docblock (lines 388-417) describes the guard+rename mechanism, no mention of move-aside/ABA. `grep -cE '^export ' src/gsd/lock.js` == 5. |
| `test/gsd-lock-guard.test.js` | Targeted unit tests of the guard via public API + seeding, 4+ cases | ✓ VERIFIED | File exists, imports only public API (`acquireGsdLock`, `LOCK_FILE`, `DEFAULT_TTL_HOURS`), no private helpers. 6 cases present (a)-(f) — 4 from the plan plus 2 added during the rework (e)/(f) covering the unparseable-guard regression. All 6 pass (`node --test`). |
| `.gitignore` | Guard/tmp artifact entries added | ✓ VERIFIED | Contains `.planning/.kodo.lock`, `.planning/.kodo.lock.steal-guard`, `.planning/.kodo.lock.tmp.*`, `.planning/.kodo.lock.steal-guard.tmp.*`. |
| `.planning/debug/resolved/gsd-lock-race-cr01.md` | Debug session moved to `resolved/` with resolved Outcome | ✓ VERIFIED | See truth 4 above. |
| `.planning/STATE.md` | Deferred Items row closed | ✓ VERIFIED | See truth 4 above. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `acquireGsdLock` (Cases 2/3/5) | `stealLock` | Same call signature `stealLock(lockPath, sessionInfo, reason)` | ✓ WIRED | Call sites unchanged at lines 137, 142, 154; `AcquireResult` shape and `test/gsd-lock.test.js` (15/15 Cases 1-5 pass) confirm contract D-08 intact. |
| Guard ownership | `O_EXCL`/`linkSync`-only | `acquireStealGuard` — ownership conferred solely by successful `linkSync(tmp→guardPath)`, never by breaking | ✓ WIRED | `breakStaleGuard` only `unlinkSync`s; the actual owner is always determined by the subsequent `acquireStealGuard` retry (line 431, `continue`). |
| `isStaleLock`/`isPidAlive` | Reused verbatim in guard staleness + ABA re-check | Same functions imported/called, no re-derivation | ✓ WIRED | `guardIsStale` calls `isPidAlive` (line 346); critical section re-check calls `isStaleLock` (lines 441, 451, 481, 498, 505). |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| LOCK-01 | 82-01 | Exactly-one acquisition on N≥2 dead-holder steal, window closed by construction | ✓ SATISFIED | Truths 1-2 above; REQUIREMENTS.md marked `[x]` and Traceability table `Complete` — consistent with code evidence, not just claim. |
| LOCK-02 | 82-01/82-02 | `gsd-lock-race` deterministic green, no assert weakening | ✓ SATISFIED | Truth 2; stress evidence reproduced live (12/12) and cross-checked against SUMMARY's 100/100 claim. |
| LOCK-03 | 82-02 | R-81-01 + debug session formally closed | ✓ SATISFIED | Truth 4; file move + STATE.md row verified directly on disk. |

No orphaned requirements — REQUIREMENTS.md Traceability table maps all 3 IDs to Phase 82 as `Complete`, consistent with both plans' `requirements:` frontmatter.

### Anti-Patterns Found

None blocking. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers in `src/gsd/lock.js` or `test/gsd-lock-guard.test.js`. No stub returns, no hardcoded empty data feeding rendering paths (this is a backend concurrency module, not applicable to data-flow trace).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Guard unit tests + contract tests + CR-01 race harness all pass together | `node --test test/gsd-lock.test.js test/gsd-lock-guard.test.js test/gsd-lock-race.test.js` | 25/25 pass, 0 fail | ✓ PASS |
| CR-01 harness deterministic under repeated fresh runs | `for i in 1..12: node --test test/gsd-lock-race.test.js` | 0/12 failures | ✓ PASS |
| Full workspace suite green, no regression | `npm test` (run once) | 2371 tests, 2370 pass, 0 fail, 1 skip | ✓ PASS |
| No move-aside reintroduced | `grep -n "renameSync(lockPath" src/gsd/lock.js` | Only `renameSync(tmp, lockPath)` present; no `renameSync(lockPath, ...)` | ✓ PASS |
| Zero new exports / zero new deps / byte-identical harness | `grep -cE '^export ' src/gsd/lock.js` == 5; `git diff --quiet` on `package.json`, `test/gsd-lock-race.test.js`, `test/helpers/lock-race-child.mjs` | 5 exports; both diffs clean | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` declared by this phase's PLANs or found under conventional paths. Skipped — not applicable (unit/integration test files ARE the phase's verification mechanism, not shell probes).

### Human Verification Required

None. All must-haves are verifiable by direct test execution and static inspection; no visual/UX/real-time/external-service surface in this phase.

## Notable Finding (Out of Phase Scope — Not a Gap)

**82-REVIEW.md (post-execution code review, `status: issues_found`, 1 critical — CR-01 in the review, distinct from the CR-01 *test harness* name) identified a genuine second-order race**, not covered by this phase's literal success criteria:

- The phase's stated goal and Success Criteria (roadmap + LOCK-01) are scoped to **N≥2 stealers racing the same DEAD-PID holder**. All 4 must-haves above are verified true for that scope.
- The review found that the PRESENT-lock branch of `stealLock` (`src/gsd/lock.js:453-471`) does an **unconditional** `renameSync(tmp→lockPath)`. If the pre-steal holder is instead a **LIVE** stale holder (TTL-expired, or corrupt-but-written-by-a-live-process — Cases 3/5) that releases the lock (`releaseGsdLock`) *while* a stealer is mid-replacement, a fresh `acquireGsdLock` Case-1 creator can win an `O_EXCL` create in that gap (Case-1 does not take the steal-guard) — and the stealer's subsequent `renameSync` then clobbers that fresh creator's lock. Both processes end up believing they hold the lock.
- This is **invisible** to both `test/gsd-lock-race.test.js` (CR-01 harness) and the new `test/gsd-lock-guard.test.js` cases, because all of them seed a `DEAD_PID` holder — a dead holder can never reach the "releases mid-steal" step that opens the window.
- I confirmed by reading the code that the asymmetry the review describes is real: the ABSENT branch (lines 473-483) re-validates via `O_EXCL`+`EEXIST`, but the PRESENT branch (lines 453-471) does not re-validate immediately before the destructive rename.
- **Disposition per verifier instructions:** this does not fail Phase 82 — the phase's must-haves and roadmap Success Criteria are explicitly about dead-holder steals (LOCK-01's literal wording), and every one of those is verified true. However it is **not currently tracked anywhere** — not in `STATE.md` §Deferred Items, not in the closed debug session's Outcome, not as a REQUIREMENTS.md item. Recommend the maintainer decide whether to open a new debt item (e.g. a `LOCK-04`/`DEBT-0x`) for a follow-up phase, since the fix pattern is already sketched in the review (re-check `readLockContent` immediately before `renameSync`, narrows but does not fully close the TOCTOU; full closure requires routing Case-1 creates through the same guard).

### Gaps Summary

No gaps. All 4 must-have truths, all listed artifacts, and all key links verified directly against the codebase (not from SUMMARY claims): code read in full, tests re-executed live (unit + integration + full suite), git diffs checked for byte-identical harness/zero-deps invariants, and file-move/doc-closure state checked directly on disk. The phase goal — closing the move-aside→`O_EXCL` window for dead-holder steals — is achieved by construction, not by probabilistic reduction, matching D-01's non-negotiable framing. The one finding above (82-REVIEW CR-01) is real but explicitly outside this phase's literal LOCK-01 scope and is surfaced as a recommendation, not a blocking gap.

---

_Verified: 2026-07-25_
_Verifier: Claude (gsd-verifier)_
