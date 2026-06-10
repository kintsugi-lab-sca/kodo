---
phase: 46
slug: overlay-del-plan-ligero-para-sesiones-quick-non-gsd
status: secured
threats_open: 0
threats_closed: 5
asvs_level: 1
created: 2026-06-10
---

# SECURITY — Phase 46: Overlay del plan ligero para sesiones quick/non-GSD

**Audited:** 2026-06-10
**ASVS Level:** 1
**block_on:** high
**Status:** SECURED — 5/5 threats resolved (3 mitigated/CLOSED, 2 accepted/CLOSED)

Scope: read-only lightweight-plan fallback (`readLightPlan`) in the `p` overlay. Local
single-operator TUI, no network, no new endpoints. Verification is proportional to ASVS L1
and the "operator on their own machine" trust model (identical to the Phase 44 GSD overlay).

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-46-01 | Tampering / Information Disclosure | mitigate | CLOSED | `src/cli/dashboard/plan.js:117-124` containment guard at call-site BEFORE `readLightPlan`; path CONSTRUCTED at `plan.js:69-71` via `join(homedir(),'.kodo','plans')`. Test `test/dashboard-plan.test.js:320-336` asserts `readFileFn` never invoked for `'../../etc/passwd'`. |
| T-46-02 | Denial of Service (ReDoS) | mitigate | CLOSED | Zero `new RegExp` in `plan.js` (`git grep` empty). Structural test `test/dashboard-plan.test.js:354-360` asserts source contains no `new RegExp`. Path is built, not matched. |
| T-46-03 | Denial of Service (never-throws) | mitigate | CLOSED | `readFileFn` wrapped in own try/catch `src/cli/dashboard/plan.js:70-77`; ENOENT→no-light-plan, else→error. Tests `test/dashboard-plan.test.js:284-318` (EACCES, code-less Error) assert `doesNotThrow`. |
| T-46-04 | Information Disclosure (correlation) | accept | CLOSED | Accepted risk — see log below. |
| T-46-SC | Tampering (supply-chain) | accept | CLOSED | Accepted risk — see log below. |

## Mitigated threats — evidence detail

### T-46-01 — task_id → filesystem path containment (CLOSED)

The declared mitigation is present and exercised:

- **Guard before read** (`plan.js:120-121`): `taskId && !taskId.includes('/') && !taskId.includes('\\') && !taskId.includes('..')`. A non-usable `task_id` degrades to `no-phase` terminal (`plan.js:123`); `readLightPlan` is only invoked with a validated id.
- **Path constructed, not regex-derived** (`plan.js:69-71`): `join(plansDir, ${taskId}.md)` where `plansDir = join(homedir(),'.kodo','plans')` — byte-identical to the Phase 45 producer `session-start.js:85,145`.
- **Test proves the guard fires** (`dashboard-plan.test.js:320-336`): with `task_id: '../../etc/passwd'`, status is `no-phase` AND `readFileFn` is never called (`readPath === null`).

**On WR-01 (code review):** the review correctly notes the guard is a *denylist* (`!includes`)
rather than an *enforced* `resolve()+startsWith(root)` post-check. I assessed whether any
reachable input bypasses the denylist and escapes `~/.kodo/plans/`:

- **Input provenance:** `task_id` is the key of `state.sessions[taskId]` (`state.js:230`), a
  provider-issued UUID (`state.js:15`). It reaches the dashboard via the server `/status`
  spread of `SessionRecord`; it is NEVER typed by the operator at the overlay — the `p`
  handler reads `filtered[sel.index]` (`App.js:500-502`), not keyboard input.
- **Reachable escape under the denylist:** to escape `plansDir` via `join`, an input needs a
  path separator (`/`, `\`) or `..` — all three are denylisted. An absolute POSIX path is
  impossible without `/`; an absolute Windows path requires `\` or `/`. A separator-free,
  `..`-free string cannot traverse out of a single `join` segment. No reachable input escapes.

**Disposition: CLOSED, not escalated.** Under ASVS L1 and the actual trust model (UUID-shaped
provider data, local single-operator read-only TUI), the denylist is sufficient as a
mitigation. WR-01's `resolve()+startsWith` post-check is sound defense-in-depth and would make
the "fixed root" claim *enforced* rather than *asserted*, but its absence is not a BLOCKER: it
guards only against a future caller passing a differently-shaped id, which does not exist in
this phase. Logged below as a hardening note for `block_on: high` transparency — it does not
gate shipping.

### T-46-02 — ReDoS (CLOSED)

No `new RegExp` derived from input anywhere in `plan.js` (the only regex is the constant
literal `/^\d+$/` on the GSD branch, `plan.js:131`, not input-derived). The structural test at
`dashboard-plan.test.js:354-360` asserts the source has no `new RegExp` and is green.

### T-46-03 — never-throws (CLOSED)

`readLightPlan`'s read is in its own try/catch (`plan.js:70-77`); a throwing/unreadable file
degrades to `error` or `no-light-plan` and never propagates to React. Verified by
`dashboard-plan.test.js:284-297` (EACCES→error), `:305-318` (code-less Error→error +
`doesNotThrow`), `:269-282` (ENOENT→no-light-plan).

## Accepted Risks Log

### T-46-04 — task_id → artifact correlation (Information Disclosure) — ACCEPTED

One file per `task_id` (UUID), no amplification. The dashboard is local with no network
surface; the operator already holds local filesystem access to `~/.kodo/plans/`. No
cross-session PII exposure beyond what the operator can already read directly. Acceptance
rationale holds: no new read amplification path was introduced (overlay reads exactly one
constructed path per `p` press). Proportional to ASVS L1.

### T-46-SC — supply-chain (Tampering) — ACCEPTED

Zero new packages. `plan.js` imports only Node builtins: `node:fs`, `node:path`, `node:os`
(`plan.js:41-45`). No `src/config.js` import (leaf isolation preserved — `git grep` for
`./config.js`/`../../config.js` is empty). No supply-chain surface added. Acceptance rationale
holds.

## Read-only surface confirmation

`src/server.js` is unchanged across the Phase 46 commit range (`git diff 78eb4ca~5 78eb4ca --
src/server.js` empty; last touch is commit `9599f18`, Phase 42). Zero new endpoints — the
overlay stays a synchronous, read-only filesystem read (`App.js:502`).

## Hardening note (non-blocking, informational)

- **WR-01 defense-in-depth (optional):** add a `resolve(plansDir, ${taskId}.md)` +
  `startsWith(resolve(plansDir)+sep)` post-join check in `readLightPlan` to convert the
  "fixed root" claim from asserted to enforced, plus a test for a separator-free escaping id.
  Anti-ReDoS preserved (no regex). Not required for this phase's input shape; recommended if a
  future caller feeds `readLightPlan` non-UUID ids.

## Unregistered Flags

None. SUMMARY.md declares `tech-stack.added: []`; the code review found 0 critical / 4 warning
/ 4 info findings, all of which map to the existing threat register (WR-01 → T-46-01) or are
robustness/test-quality notes outside the security threat model. No new attack surface appeared
during implementation without a threat mapping.
