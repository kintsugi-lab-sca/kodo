---
phase: 70
slug: concurrencia-y-ciclo-de-vida-de-procesos
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-06
---

# Phase 70 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Filled from the 4 committed PLAN.md files (task IDs, waves, requirements, threat refs, automated verify commands).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in `node --test`) |
| **Config file** | none — `package.json` `test` script |
| **Quick run command** | `node --test <the task's own test file>` (see Per-Task map) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick ~2–8 s per file · full suite ~45–90 s (baseline 1843 pass + 1 skip after Phase 69) |

---

## Sampling Rate

- **After every task commit:** Run that task's `node --test <file>` (the `<automated>` command in the task).
- **After every plan wave:** Run `npm test` (full suite).
- **Before `/gsd-verify-work`:** Full suite must be green + non-flaky over 3 runs for the concurrency race tests.
- **Max feedback latency:** ~8 s (single file) / ~90 s (full suite).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 70-01-01 | 01 | 1 | CONC-01, CONC-02 | — | RED gate: lock tests fail before the primitive exists | unit (RED) | `node --test test/state/state-lock.test.js test/state/state-lock-concurrency.test.js test/gsd-lock-race.test.js 2>&1 \| grep -Eq 'fail\|not ok\|Cannot find module' && echo RED-OK` | ❌ W0 | ⬜ pending |
| 70-01-02 | 01 | 1 | CONC-01 | T-70-02 | `withFileLock` O_EXCL create; steal only on dead-PID/TTL; fail-safe on retry exhaustion | unit + concurrency | `node --test test/state/state-lock.test.js test/state/state-lock-concurrency.test.js` | ❌ W0 | ⬜ pending |
| 70-01-03 | 01 | 1 | CONC-02 | T-70-01, T-70-03 | `acquireGsdLock` atomic `flag:'wx'`; `stealLock` tmp+rename; `decideLock` mirror consistent | real 2-proc race | `node --test test/gsd-lock-race.test.js test/gsd-lock.test.js` | ❌ W0 | ⬜ pending |
| 70-02-01 | 02 | 2 | CONC-01 | — | RED gate: writer-concurrency test fails before `withStateLock` | unit (RED) | `node --test test/state/state-writers-concurrency.test.js 2>&1 \| grep -Eq 'fail\|not ok' && echo RED-OK` | ❌ W0 | ⬜ pending |
| 70-02-02 | 02 | 2 | CONC-01 | T-70-04 | 3 mutators wrapped in `withStateLock` (re-read→mutate→save); false "sole writer" comment fixed | real N-proc race | `node --test test/state/state-writers-concurrency.test.js && grep -c 'withStateLock' src/server.js \| grep -qv '^0$' && echo COMMENT-OK` | ❌ W0 | ⬜ pending |
| 70-02-03 | 02 | 2 | CONC-01 | T-70-05 | reconcile: host snapshot OUTSIDE lock, pure apply INSIDE (Pitfall 1) | unit | `node --test test/session/reconcile-lock.test.js test/session/reconcile.test.js` | ❌ W0 | ⬜ pending |
| 70-03-01 | 03 | 1 | CONC-04 | T-70-07 | teardown removes `kodo.pid` only if `payload.pid === process.pid`; pre-bind write KEPT (66-07) | unit | `node --test test/daemon/run.test.js` | ❌ W0 | ⬜ pending |
| 70-03-02 | 03 | 1 | CONC-05 | T-70-06 | SIGKILL aborts on `ps -o lstart=` (LC_ALL=C) mismatch; degrade-safe when unverifiable | unit | `node --test test/daemon/lifecycle.test.js` | ❌ W0 | ⬜ pending |
| 70-03-03 | 03 | 1 | CONC-03, CONC-07 | T-70-09, T-70-08 | gate filters `alive !== false` (zombie frees slot); `migrateConfigIfNeeded` via `writeFileAtomic` | unit (zombie via TAB death fixture) | `node --test test/session/max-parallel-alive.test.js test/config-migration-atomic.test.js` | ❌ W0 | ⬜ pending |
| 70-04-01 | 04 | 2 | CONC-06 | T-70-10 | `polling start` O_EXCL start-lock → exactly one daemon under a 2-proc race | real 2-proc race | `node --test test/daemon/polling-start-race.test.js test/daemon/lifecycle.test.js` | ❌ W0 | ⬜ pending |
| 70-04-02 | 04 | 2 | CONC-08 | T-70-11 | per-`task_id` cross-process dedup on non-GSD lane → one launch; GSD lane untouched | real 2-proc race | `node --test test/dispatcher-dedup-crossproc.test.js` | ❌ W0 | ⬜ pending |
| 70-04-03 | 04 | 2 | CONC-09 | T-70-12 | worktree location empirically verified + documented (`.bg-shell` vs `.claude/worktrees`) | manual checkpoint | `test -f .planning/phases/70-concurrencia-y-ciclo-de-vida-de-procesos/70-WORKTREE-VERIFICATION.md && grep -Eq 'claude/worktrees\|bg-shell' .planning/phases/70-concurrencia-y-ciclo-de-vida-de-procesos/70-WORKTREE-VERIFICATION.md && echo DOC-OK` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

The RED-gate tasks (70-01-01, 70-02-01) author the initial failing test files; the remaining test files are created by their implementing tasks (TDD `type:auto tdd="true"`). New test artifacts:

- [ ] `test/state/state-lock.test.js` + `test/state/state-lock-concurrency.test.js` — primitive unit + concurrency (CONC-01)
- [ ] `test/gsd-lock-race.test.js` + `test/helpers/lock-race-child.mjs` — real 2/5-process race, exactly one `{acquired:true}` (CONC-02)
- [ ] `test/state/state-writers-concurrency.test.js` — N-process no-lost-write race (CONC-01)
- [ ] `test/session/reconcile-lock.test.js` — snapshot-outside/apply-inside (CONC-01)
- [ ] `test/daemon/run.test.js` + `test/daemon/lifecycle.test.js` — PID ownership, pre-bind, anti-reuse SIGKILL (CONC-04/05)
- [ ] `test/session/max-parallel-alive.test.js` — zombie frees slot via TAB-death fixture (CONC-03)
- [ ] `test/config-migration-atomic.test.js` — HOME-isolated atomic migration (CONC-07)
- [ ] `test/daemon/polling-start-race.test.js` + `test/dispatcher-dedup-crossproc.test.js` — cross-process dedup races (CONC-06/08)

*node:test is already the project framework — no install needed (milestone invariant: zero new npm deps).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real on-disk worktree location of a LIVE GSD session (`.claude/worktrees` vs doctor's `.bg-shell`) | CONC-09 | Requires a live GSD session running through cmux to observe where Claude Code actually places the worktree — cannot be asserted from static code alone (D-15: no "fix by inference") | Launch a real GSD kodo session, inspect the worktree path on disk, record it in `70-WORKTREE-VERIFICATION.md`; correct `doctor.js` if it scans a dead dir, or document the discrepancy as deferred. If no live session can be mounted at closeout, defer the human sign-off (pattern 50.1) but deliver the code analysis. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (CONC-09 is legitimately manual — documented above)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (RED-gate tasks author the failing tests first)
- [x] No watch-mode flags (all `node --test` are single-shot)
- [x] Feedback latency < 90s (full suite) / < 8s (single file)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-06
