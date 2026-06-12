---
phase: 49
slug: live-progress-spike-hard-gate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-12
---

# Phase 49 — Validation Strategy

> Per-phase validation contract. **This phase is a spike** — its deliverable is an empirical
> VIABLE/INVIABLE verdict (`49-SPIKE.md`), not production code. The "validation" is therefore the
> **evidence captured firsthand on the installed build (2.1.175)**, operationalized as the
> 4-condition Evidence Map per candidate surface. Most verification is manual/empirical by nature.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node --test (existing kodo suite) |
| **Config file** | none — `package.json` `test` script |
| **Quick run command** | `node --test $(find test -name '*.test.js' -type f)` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~21 seconds |

*Only relevant if the spike lands a kodo-side correlation helper (e.g. `session_id → task_id`).
The verdict itself ships no production code, so automated tests are NOT the primary evidence.*

---

## Sampling Rate

- **Empirical probe:** evidence captured live on build 2.1.175 against a real
  `claude --worktree` session (and, per research, a real `/gsd-execute-phase` agent-wave session
  — the only session type expected to trigger `TaskCreate`).
- **After any kodo-side helper commit (if VIABLE):** Run the quick suite.
- **Before `/gsd:verify-work`:** `49-SPIKE.md` exists with an explicit verdict + the 4-condition
  Evidence Map filled per surface attempted.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 49-01-* | 01 | 1 | PROG-01 | — | Spike reads ~/.claude/* read-only; never mutates Claude Code internals | manual | empirical evidence in 49-SPIKE.md | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Re-verify the installed build version firsthand (`which claude` → `claude --version`); pin the
      **actual** version in `49-SPIKE.md` (research found 2.1.175 via the cmux bundle, not 2.1.174).

*Existing infrastructure covers any kodo-side helper; the spike's core evidence is manual.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Surface fires/reads in an interactive `claude --worktree` session (cond a) | PROG-01 | Live behavior of installed Claude Code — not observable from code/docs | Launch a real session (incl. a `/gsd-execute-phase` agent-wave run); observe whether the surface (hook event / transcript / `~/.claude/tasks/<uuid>/`) materializes |
| Payload yields stable N/M (cond b) | PROG-01 | Undocumented payloads must be sampled live | Capture surface output across ≥2 sessions; confirm N/M derivable consistently |
| Deterministic `session_id → task_id` correlation (cond c) | PROG-01 | Round-trip through live `state.json` | Map a real session_id to its kodo task_id via `findSession` (state.js); confirm 1:1 |
| Zero session latency/breakage + kodo-owned `~/.kodo` artifact (cond d) | PROG-01 | Side-effect observation on a real session | Confirm the probe never stalls/breaks the session and writes only to `~/.kodo/…` |

---

## Validation Sign-Off

- [ ] `49-SPIKE.md` exists with an explicit VIABLE/INVIABLE verdict
- [ ] 4-condition Evidence Map filled for every surface attempted (incl. failures), in preference order
- [ ] Installed build version re-verified firsthand and pinned
- [ ] Gate decision recorded (INVIABLE → Phase 50 cut, PROG-02/03 deferred via PROG-F1; VIABLE → proceed)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
