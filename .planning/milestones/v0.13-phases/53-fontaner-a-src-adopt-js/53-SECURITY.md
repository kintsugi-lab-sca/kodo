---
phase: 53
slug: fontaner-a-src-adopt-js
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-16
---

# Phase 53 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| process crash → disk | A crash mid-write must not leave `~/.kodo/state.json` torn/partial — readers (reconcile, server, dashboard, hooks) depend on well-formed JSON. | serialized session state (JSON) |
| kodo local → external task manager (POST) | Title/description cross from the local machine into a third-party-hosted task manager. Untrusted-to-leak surface. | absolute paths, home-dir layout, (potentially) transcript bodies |
| createTask POST → local state write | Between a successful remote POST and the local seed-row write lies an orphan window: a task created with no local record. | task identity (task_id, task_url) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-53-01 | Tampering (integrity) | `saveState` → state.json | mitigate | tmp+rename atomic write with unique tmp name (`STATE_PATH + '.tmp.' + process.pid + '.' + randomUUID()`) then `renameSync` — POSIX-atomic same-FS; reader sees old-or-new, never torn (`state.js:249-252`, WR-02 hardened). | closed |
| T-53-02 | Tampering | `.bak` migration snapshot | accept | `migrateStateIfNeeded` uses its own inline `writeFileSync` (`state.js:203,209`), never `saveState`; independence guarded by `save-state-atomic.test.js` (one-`.bak` case) + `migration-backup.test.js`. | closed |
| T-53-03 | Information Disclosure | `sanitizeAdoptionData` → external createTask POST | mitigate | `redactPaths` (`adopt.js:39-68`) applied before POST (`:197` → `:217`): segment-boundary home→`~` with escaped metachars, abs-path strip incl. `//double-slash` and `key:/abs`; genuine URLs spared. CR-01 leak surfaces closed + regression-tested. | closed |
| T-53-04 | Information Disclosure | transcript exfiltration into provider | mitigate | Structural — `sanitizeAdoptionData` has NO `transcript` parameter; it cannot forward a transcript body (defense by construction, not a filter). Verified by test 19. | closed |
| T-53-05 | Tampering / Repudiation | provider orphan (task created, no local row) | mitigate | `PERSIST_FAILED` LOUD discriminant carrying `task_id` + `task_url` + hint (`adopt.js:237-247`); never thrown/swallowed (never-throws hardened by WR-03 guards); recoverable by idempotent re-run (kodo never deletes). | closed |
| T-53-06 | Elevation / DoS (session storm) | adopted task re-dispatched (recursion) | accept | Mitigated in Phase 52: `kodo:adopted` marker + dispatcher cut (pre-lock, `--force`-proof). `adopt.js` introduces no dispatch path and no new control. | closed |
| T-53-07 | Tampering | concurrent double-adopt (same operator/daemon) | accept | Idempotency guard `findSession({workspaceRef,cwd})` with fresh `loadState()` before POST → `ALREADY_ADOPTED`, no second POST (`adopt.js:203`, test asserts createTask count === 1). Residual concurrent window negligible, visible via `kodo:adopted` marker, recoverable by re-run; local state.json authoritative. | closed |
| T-53-SC | Tampering (supply chain) | npm installs | accept | Zero new runtime dependencies across the full Phase 53 commit range — `package.json` diff empty; only `node:fs`/`node:crypto`/`node:path`/`node:os` builtins + existing kodo exports. No registry interaction. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-53-02 | `.bak` snapshot path is structurally independent of `saveState` (own inline writeFileSync); regression-guarded. | Phase 53 plan + audit | 2026-06-16 |
| AR-02 | T-53-06 | Anti-recursion is owned by Phase 52 (`kodo:adopted` marker + dispatcher cut); `adopt.js` adds no dispatch surface. | Phase 52 carry-forward | 2026-06-16 |
| AR-03 | T-53-07 | True concurrent double-adopt (single operator/daemon) is negligible and recoverable by idempotent re-run; local state.json is the authoritative guard (no remote fuzzy search — out of scope). | Phase 53 D-04 | 2026-06-16 |
| AR-04 | T-53-SC | Zero new runtime dependencies — Node builtins + existing exports only; empty `package.json` diff. | Phase 53 plan + audit | 2026-06-16 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-16 | 9 | 9 | 0 | gsd-security-auditor (opus) |

**Cross-reference:** The code-review BLOCKER CR-01 (`53-REVIEW.md`) was the T-53-03 path-leak surface; it was fixed (commit `15cc384`) and the fix is verified effective by this audit (all four leak shapes redacted, URL-sparing preserved, regressions green). Code-review residuals WR-01 (fsync durability — out of scope per BIDIR-05 "atomicity, not power-loss durability") and WR-05/IN-01..03 are documented deferrals, not declared mitigations, and therefore outside this audit's CLOSED/OPEN scope.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-16
