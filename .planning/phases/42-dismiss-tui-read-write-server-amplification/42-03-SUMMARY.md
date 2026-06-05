---
phase: 42-dismiss-tui-read-write-server-amplification
plan: 03
subsystem: server-tui-seam
tags: [dismiss, e2e-seam, drift-canary, destructive-mutation, human-uat, invariant-break, read-write]
requires:
  - "createDismissHandler + translateToActions (Plan 01) — the actions[] emitter"
  - "mapDismissResult (Plan 02) — the actions[] consumer in select.js"
provides:
  - "test/server-dismiss-e2e.test.js — end-to-end wiring seam proving emitter↔consumer agree on the actions[] vocabulary"
  - "STATE.md invariant-break record: v0.9 'TUI read-only' → read-write (observability → management), zero new endpoints"
affects:
  - ".planning/STATE.md (Critical Invariants + Accumulated Context Decisions 42-01/42-02)"
tech-stack:
  added: []
  patterns:
    - "drift-canary seam test: feed the real server body through the real client consumer, no live HTTP boot"
    - "faithful body→client-discriminant adapter mirroring dismissSession()'s 200/non-2xx handling"
    - "exhaustive vocabulary guard: every translator-emittable result must be a consumer-handled value (and vice-versa)"
key-files:
  created:
    - "test/server-dismiss-e2e.test.js"
  modified:
    - ".planning/STATE.md"
decisions:
  - "Seam test drives createDismissHandler directly with fake loadState + fake executeFn (no flaky HTTP boot), then bridges the server body into the client discriminant exactly as dismissSession() does — proving REAL wiring, not a contrived shape"
  - "Vocabulary guard asserts the maximal translateToActions output set == the documented D-06 vocabulary {removed,moved-dirty,pruned,kept,error}, and that mapDismissResult returns a defined {kind,color} for each — bidirectional drift canary (T-42-11)"
  - "STATE.md invariant bullet reframed as SHIPPED break (not future), recording the observability→management identity change; zero new endpoints preserved"
metrics:
  duration_min: 12
  tasks: 3
  files_changed: 2
  commits: 2
  completed: 2026-06-05
---

# Phase 42 Plan 03: Dismiss e2e Seam + Human UAT + Invariant-Break Record Summary

Closed Phase 42 with a deterministic end-to-end seam test proving the server's `actions[]` emitter (Plan 01) and the TUI's `mapDismissResult` consumer (Plan 02) agree across clean/dirty/warn/409 plus a bidirectional vocabulary drift canary, a signed human UAT of the destructive double-`d` against a real dead session, and a STATE.md record of the conscious v0.9 "TUI read-only" → read-write invariant break.

## What Was Built

**Task 1 — end-to-end wiring seam (`test/server-dismiss-e2e.test.js`):**
The only Phase 42 test that imports BOTH halves. It drives the real `createDismissHandler` with a fake `loadState` (a dead session keyed by `task_id`) and a fake `executeFn` returning representative `DoctorResult` counters, then bridges the server body into the never-throws client discriminant — exactly as `dismissSession()` (client.js) does with a real HTTP response (200 → `{ok:true, data:{removed,actions}}`; non-2xx → `{ok:false, error: body.error}`) — and feeds it through the real `mapDismissResult`:
- **(a) clean removal** → server emits `{worktree:removed}` + `{state:removed}`, `status===200`; consumer → `{kind:'ok', color:'green'}`. Also asserts `executeFn` received `{taskId, fix:true}` (DRIFT #2 wiring).
- **(b) dirty worktree** (`worktrees.moved:1`) → server emits `moved-dirty`; consumer → `{kind:'dirty', color:'yellow'}`.
- **(c) fail-open sub-error** (`errors:[{category:'lock',...}]`, also dirty) → server emits `result:'error'`; consumer → `{kind:'warn', color:'yellow'}` (error wins over dirty).
- **(d) live session** (fake `loadState` `alive:true`) → `status===409`, `{ok:false, error:'alive'}`, `executeFn` NEVER called (SC#3); consumer → `{kind:'error', color:'red', reason:'alive'}`.
- **vocabulary guard (drift canary):** drives `translateToActions` across every non-zero counter + an error, asserts the emitted `result` set equals the documented D-06 vocabulary `{removed, moved-dirty, pruned, kept, error}` (`skipped` emits no action), and that `mapDismissResult` returns a defined `{kind,color}` for each. If Plan 01 ever emits a `result` Plan 02 doesn't branch on (or the vocabulary drifts from D-06), this fails (T-42-11 mitigation).

**Task 2 — human UAT (checkpoint:human-verify, signed):**
The operator exercised the destructive double-`d` against a real dead session and typed "approved". Confirmed end-to-end: the arm/confirm/Esc/any-key state machine, real worktree+lock+state removal, and the live-row guard rejection (red footer). Mirrors how v0.9 closed Phases 37/38 by manual UAT for destructive mutations.

**Task 3 — STATE.md invariant-break record:**
- "Critical Invariants" bullet reframed from a *future* break to a *SHIPPED* one: the dashboard is now read-WRITE for the dismiss-of-dead-sessions case, identity change observability → management, still zero new endpoints (`DELETE /sessions/{id}` amplified, not created), `alive` still single-writer (`reconcileTick`).
- New "Decisions (Plan 42-01/42-02)" entry under Accumulated Context: the 409 server-side TOCTOU guard, the `dismiss.js` pure-DI extraction (mirroring Phase 40 provider-state), `fix:true` locked, the `actions[]` synthesis from counters, the `mode:'confirm'` double-`d` machine, never-throws `dismissSession`/pure `mapDismissResult`, and the signed UAT.

## How to Verify

```
node --test test/server-dismiss-e2e.test.js   # 5/5 — clean/dirty/warn/409 + vocabulary drift canary
npm test                                       # full suite green across both halves
grep -c "read-write\|read-WRITE" .planning/STATE.md   # 5 (≥1)
```

Results: seam test 5/5 pass; full suite 1182 pass, 0 fail, 1 pre-existing skip; grep gate 5.

## Deviations from Plan

None — plan executed exactly as written. The three autonomous-task acceptance criteria (imports both halves + feeds server body to consumer; clean/dirty/warn/409 produce expected kind+color; vocabulary assertion catches an unhandled emitter value) and the human-verify gate were all satisfied as specified. No Rule 1-4 deviations occurred.

### Note on the body→client adapter (a faithfulness decision, not a deviation)

The plan asks to "feed `body` to `mapDismissResult`". `mapDismissResult` consumes the never-throws CLIENT discriminant `{ok:true, data:{actions}}` | `{ok:false, error}`, while the server emits `{status, body:{ok, removed, actions}}`. A `serverBodyToClientResult()` adapter performs exactly the same 200/non-2xx → discriminant translation that `dismissSession()` does in production. This keeps the seam a proof of the REAL wiring (emitter → the client's own adaptation → consumer) rather than a hand-shaped object, which is the point of a drift canary.

## Authentication Gates

None — no auth flows in this plan.

## Known Stubs

None. The seam test exercises the real `createDismissHandler` and the real `mapDismissResult` with no placeholder/mock consumer; the only fakes are the injected `loadState`/`executeFn` (the documented DI seams), driven with representative `DoctorResult` shapes.

## Threat Flags

None. No new security surface beyond the plan's `<threat_model>`. The plan's mitigations are honored: T-42-11 (body↔consumer drift) is the seam test's vocabulary guard; T-42-12 (dirty worktree silently deleted) was confirmed by the human UAT's `.dirty` preservation check; T-42-13 (undocumented invariant break) is the STATE.md record (Task 3); T-42-SC (package installs) — none this plan.

## Self-Check: PASSED

- FOUND: test/server-dismiss-e2e.test.js
- FOUND: .planning/STATE.md (modified — invariant bullet + Decisions 42-01/42-02)
- FOUND: commit feefeb0 (Task 1 seam test)
- FOUND: commit 7f8e3c9 (Task 3 STATE.md invariant-break record)
