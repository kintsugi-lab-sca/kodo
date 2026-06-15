---
phase: 48-open-in-manager-core
plan: 03
subsystem: verification
tags: [human-uat, open-in-manager, checkpoint]
requires:
  - "48-01 (Plane browse-URL fix) merged to main"
  - "48-02 (open-in-manager TUI launcher) merged to main"
provides:
  - "HUMAN-UAT verdict for open-in-manager (OPEN-01..04)"
affects:
  - "Phase 48 closes by human-verified browser side effect (mirror of Phase 37)"
tech-stack:
  added: []
  patterns:
    - "HUMAN-UAT checkpoint for non-auto-verifiable browser side effect"
---

## Plan 48-03: HUMAN-UAT close of open-in-manager

**Tasks:** 2/2
**Verdict:** APPROVED

### Task 1 — Pre-UAT automated gate (auto)
Full suite run post-merge of Wave 1 (48-01 + 48-02 integrated on `main`):

- **1280 tests, 1279 pass, 1 skip (pre-existing startup-budget skip), 0 fail.**
- Above the v0.11 baseline (1263 pass + 1 skip); the new `open.js` / `app-open` /
  `normalize` cases add to the pass count as expected.
- Required test files present and passing in the run: `test/dashboard/open.test.js`,
  `test/dashboard/app-open.test.js`, `test/normalize.test.js`,
  `test/format-isolation.test.js`.

Gate green — feature ready for operator dogfooding.

### Task 2 — Human-verify checkpoint (blocking) — APPROVED
Operator confirmed all 5 UAT checks on a real macOS machine with `kodo dashboard` running:

1. **Happy path (OPEN-01):** `o` on a task row opens a tab on the live web UI; green
   transient `opening <ref>…` footer; panel stays mounted (no flicker, no header
   stacking, cursor preserved).
2. **Alt-screen survival (OPEN-02):** next keypress clears the footer and restores the
   hints line; terminal not garbled; scrollback restored cleanly on `q`.
3. **Legacy no-op (OPEN-02):** a row with no `task_url` opens nothing and shows the bare
   `no task URL for this session` footer; any key clears it.
4. **Adversarial refusal (OPEN-03):** non-http(s) `task_url` opens no tab / no app; footer
   shows `[!] refused non-http(s) URL — press any key`.
5. **Split-deploy Plane URL (OPEN-04):** with `providers.plane.web_url` set distinct from
   `base_url`, the opened tab uses the web host (not the API host); an `UNKNOWN-…`
   identifier shows the no-URL footer instead of opening a dead link.

### Outcome
All 5 ROADMAP Success Criteria observably confirmed on real macOS. The browser side
effect (T-48-08) and alt-screen survival (T-48-09) threat-model verifications hold
against the real `open` binary, not just fakes. Phase 48 closes by HUMAN-UAT as budgeted.

## Self-Check: PASSED
