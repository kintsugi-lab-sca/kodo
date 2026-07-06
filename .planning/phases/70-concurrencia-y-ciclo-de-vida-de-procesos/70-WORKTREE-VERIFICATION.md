# CONC-09 / M13 — Worktree Location Verification (Phase 70, D-15)

**Requirement:** CONC-09 — verify empirically where a live GSD session's worktree
lands, reconcile the `.bg-shell` vs `.claude/worktrees` discrepancy, and either
correct the wrong consumer or document a deferral. Closes audit M13 (obs. 23450
"Worktree Path Discrepancy in computeWorktreePath", carried from v0.12).

**Decision taken:** DOCUMENTED + DEFERRED. Code analysis delivered below; the
in-code discrepancy is annotated at both sites; the scan path is **not** changed
by inference (D-15 prohibition). The empirical human sign-off on a live GSD
session is deferred, exactly as the Phase 50.1 progress display was.

**Date:** 2026-07-06

---

## 1. The two path helpers

Both are pure `path.join` functions in `src/session/state.js`:

| Helper | Line | Returns | Origin |
|--------|------|---------|--------|
| `computeWorktreePath(projectPath, sessionId)` | `state.js:165` | `<projectPath>/.bg-shell/<sessionId>` | Phase 18 (D-01/D-02) — the LEGACY assumption |
| `computeRealWorktreePath(projectPath, sessionId)` | `state.js:187` | `<projectPath>/.claude/worktrees/<sessionId>` | Phase 50.1 (DG-04) — "the REAL path, confirmed empirically" |

`computeRealWorktreePath`'s own docstring (`state.js:176-178`) records the
empirical basis: *"confirmada empíricamente (TENDERIO-9 + `git worktree list`):
es ahí donde Claude Code crea el worktree de la sesión y, por tanto, donde GSD
mantiene el STATE.md con el bloque progress:."* It was added as an **additive,
separate** helper precisely because `computeWorktreePath` had 5 coupled
consumers and could not be safely repointed at the time (minimal blast radius).

## 2. How the worktree is actually created

`src/session/manager.js` builds the Claude command (`buildClaudeCommand`,
`manager.js:353`):

```
claude --model <M> --session-id <sid> --worktree <sid> [--dangerously-skip-permissions] <prompt-ref>
```

The `--worktree <sessionId>` positional tells **Claude Code** where to create the
worktree. Kodo does **not** create the directory itself (`manager.js:262`:
*"El path NO se crea aquí — `claude --worktree <sessionId>` lo materializa"*).
So the real on-disk location is decided by the installed Claude Code version, not
by kodo — which is exactly why it must be confirmed empirically, not inferred.

The comment block at `manager.js:342-345` still **claims** `--worktree <sessionId>`
"garantiza el path determinístico `<projectPath>/.bg-shell/<sessionId>`". That
claim contradicts Phase 50.1's empirical finding and is a stale/false comment
(same species as audit A2's "único escritor" lie). It is flagged here as a
follow-up; it was left untouched in this task to keep the change surgical and
within Task 3's file scope (see §6).

## 3. Consumer map (every reader of each helper)

### Consumers of `computeWorktreePath` — `.bg-shell/<sid>` (legacy)

| Consumer | Line | What it does with the path |
|----------|------|----------------------------|
| `src/session/manager.js` | `manager.js:265` | Computes `worktreePath` and persists it as `Session.worktree_path` (record metadata) |
| `src/triggers/dispatcher.js` | `dispatcher.js:212` | Pre-launch **collision-check**: `existsSync(worktreePath)` → `worktree_collision` |
| `src/gsd/doctor.js` | `doctor.js:164` (via `defaultListWorktreeDirs`) | **Orphan scan**: `readdirSync(<projectPath>/.bg-shell)`, crosses each `<sid>` against live sessions, `--fix` **removes** orphans |

### Consumers of `computeRealWorktreePath` — `.claude/worktrees/<sid>` (real)

| Consumer | Line | What it does with the path |
|----------|------|----------------------------|
| `src/cli/dashboard/App.js` | `App.js:718` | Locates the session's `.planning/STATE.md` to render the progress block |
| `src/gsd/verify.js` | `verify.js:146` | Reads the isolated worktree's `STATE.md` for phase verification |

## 4. The concrete discrepancy

- The **write/consume of session STATE.md** (dashboard, verify.js) already uses
  the **real** path `.claude/worktrees/<sid>`. These are the consumers that were
  fixed empirically in Phase 50.1.
- The **orphan-cleanup scan** (`doctor.js` `detectOrphanWorktrees` →
  `defaultListWorktreeDirs`) still enumerates `.bg-shell/<sid>`. If the live
  Claude Code version creates worktrees under `.claude/worktrees/`, then:
  - `.bg-shell/` is empty/absent for real sessions → the scan finds **nothing**,
  - real orphan worktrees accumulate under `.claude/worktrees/` **undetected**,
  - `kodo gsd doctor --fix` never reclaims them. **This is the M13 bug.**
- The **dispatcher collision-check** (`dispatcher.js:212`) also probes
  `.bg-shell/<sid>`. Its practical risk is ~0 (UUID-v4 sessionId collisions are
  astronomically unlikely, and it fails safe — `existsSync` false-negative just
  proceeds to launch), so it is a correctness-of-intent nit, not an active bug.

## 5. Why the correction is DEFERRED (not applied)

D-15 is explicit: *"CONC-09 MUST NOT silently 'fix' the worktree path by
inference — the correction requires empirical confirmation (live GSD session) or
is documented as deferred with the code analysis delivered."*

Two reasons the flip is not applied in this task:

1. **Blast radius.** `doctor --fix` **deletes directories**. Repointing the scan
   to `.claude/worktrees` without a live-session confirmation of the current
   Claude Code version risks either (a) deleting live worktrees if the crossing
   logic differs, or (b) a no-op if the version still uses `.bg-shell`. The path
   is version-dependent (decided by `claude --worktree`, §2), so static analysis
   alone cannot be conclusive for the **current** installed version.
2. **Executor context has no live GSD session.** This phase runs under `--auto`;
   a real kodo GSD session (a `kodo:gsd`-labeled task materializing a worktree)
   cannot be mounted from here to observe `git worktree list`. Per D-15 and the
   Phase 50.1 precedent, the human empirical sign-off is deferred and the code
   analysis is delivered instead.

**Most likely real location, from the code:** `<projectPath>/.claude/worktrees/<sid>`.
The evidence — `computeRealWorktreePath`'s empirically-sourced docstring, and two
STATE.md consumers already depending on it — makes `.bg-shell` the near-certain
dead path. The deferral is about *confirming the current Claude Code version on a
live session before a destructive `doctor --fix` behavior change*, not about
doubt over the analysis.

### What WAS changed (minimal, non-behavioral)

- `src/gsd/doctor.js` (`defaultListWorktreeDirs`, at the `.bg-shell` scan site):
  added a CONC-09/M13 comment documenting the discrepancy, the real path, and the
  deferral. **Scan path unchanged.**
- `src/session/state.js` (`computeWorktreePath` docstring): added the same
  cross-reference to `computeRealWorktreePath` and this document. **Return value
  unchanged.**

## 6. Human verification steps (deferred sign-off)

To confirm on a live GSD session and either approve or drive the doctor.js
correction:

1. Start a real kodo GSD session against a repo — a task labeled `kodo:gsd` —
   and let it create its worktree (`claude --worktree <sid>` runs on launch).
2. In that repo run:
   ```
   git worktree list
   ```
3. Compare the listed worktree path for `<sid>` against the two helpers:
   - `computeWorktreePath(projectPath, sid)` → `<repo>/.bg-shell/<sid>`
   - `computeRealWorktreePath(projectPath, sid)` → `<repo>/.claude/worktrees/<sid>`
4. Confirm which directory is real for the **current** Claude Code version.
5. If `.claude/worktrees` is confirmed (expected):
   - Repoint `defaultListWorktreeDirs` (`doctor.js`) to scan
     `<projectPath>/.claude/worktrees` (use `computeRealWorktreePath`), keeping
     the `.dirty` preservation and the live-session crossing logic intact.
   - Repoint the dispatcher collision-check (`dispatcher.js:212`) to
     `computeRealWorktreePath` for intent-correctness.
   - Correct/remove the false `.bg-shell` "garantiza" claim at `manager.js:342-345`.
   - Add/extend a doctor test asserting the scan targets the real path.
6. If `.bg-shell` is somehow still real for the installed version: record that
   finding here and close CONC-09 as "no change needed", noting the Claude Code
   version observed.

## 7. Follow-up items surfaced (not fixed here — out of Task 3 scope)

- **False comment** at `src/session/manager.js:342-345` claiming `--worktree`
  guarantees the `.bg-shell` path — should be corrected alongside the doctor flip.
- **Dispatcher collision-check** at `dispatcher.js:212` still probes `.bg-shell`.

---

**Status:** Analysis delivered; discrepancy annotated in code; correction DEFERRED
pending the live-session sign-off in §6 (Phase 50.1 precedent, D-15).
