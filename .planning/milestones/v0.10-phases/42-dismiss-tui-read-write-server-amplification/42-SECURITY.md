---
phase: 42
slug: dismiss-tui-read-write-server-amplification
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-05
---

# Phase 42 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Dismiss — TUI read-write + server amplification. First TUI read→write rupture:
> dismissing dead sessions via a modal `d`-key confirm plus server-side amplification
> (`DELETE /sessions/{id}` → 409 liveness guard → `doctor.execute({taskId})`).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| operator keystroke → TUI dismiss handler | A stray or repeated keystroke must never trigger an unintended destructive DELETE. | keypress intent |
| TUI/web client → `DELETE /sessions/{id}` | Untrusted client request crosses into a destructive server mutation. The server must NOT trust the client's claim that the target is dead. | taskId, destructive intent |
| server → `doctor.execute` (filesystem + git worktree + state.json) | The mutation deletes/relocates worktrees, steals locks, removes state entries. | worktree paths, locks, state entries |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-42-01 | Tampering | DELETE handler dismissing a LIVE session | mitigate | `src/server/dismiss.js:115-121` — fresh `loadState().sessions[taskId]`; `alive===true` → HTTP 409, `executeFn` never reached. Test: dismiss.test.js "executeFn NEVER called". | closed |
| T-42-02 | Tampering/TOCTOU | session revives between client snapshot and DELETE arriving | mitigate | `src/server/dismiss.js:115` — state re-read at DELETE-receive time, not from a client snapshot. Deterministic alive-flip test green. | closed |
| T-42-03 | Repudiation | dismiss reports `{ok:true}` while sanitizing nothing (fix falsy → silent no-op) | mitigate | `src/server/dismiss.js:125` `fix:true` locked; `src/logger-events.js:88,337` `SESSION_DISMISSED` NDJSON event makes the mutation auditable. | closed |
| T-42-04 | Tampering (path traversal) | path traversal via `task_id` in `/sessions/<id>` | mitigate | `src/server.js:513` `decodeURIComponent` retained; `src/gsd/doctor.js:490-491,525,546` scope to single taskId, zero `rmSync`/recursive delete. | closed |
| T-42-05 | Tampering (data loss) | worktree with uncommitted work deleted | mitigate | `src/hooks/worktree-cleanup.js:126-174` dirty→`.dirty` `renameSync` (branch preserved); `src/gsd/doctor.js:505-507`; `src/server/dismiss.js:75` `moved-dirty`. | closed |
| T-42-06 | Tampering (stray keystroke) | accidental dismiss via stray keystroke confirms | mitigate | `src/cli/dashboard/App.js:465-481` arm; `323-348` confirm; `350-354` Esc/any-key cancel → zero DELETE. Tests: arm→'x' / arm→Esc dispatch none. | closed |
| T-42-07 | Tampering (live, UX layer) | dismissing a LIVE session from the TUI (first defense layer) | mitigate | `src/cli/dashboard/App.js:470-474` inverse `alive===true` guard; authoritative layer is server-side T-42-01. | closed |
| T-42-08 | Denial of Service | network/HTTP/JSON failure throws and unmounts the React tree | mitigate | `src/cli/dashboard/client.js:178-204` `dismissSession` never-throws (collapses to `{ok:false,error}`); `src/cli/dashboard/App.js:334` awaited, no bare throwing await reaches React. | closed |
| T-42-09 | Tampering (path traversal, client) | path traversal via `task_id` in the DELETE path | mitigate | `src/cli/dashboard/client.js:182` `encodeURIComponent(taskId)`; server does `decodeURIComponent` symmetrically. | closed |
| T-42-10 | Repudiation | operator unaware a `.dirty` worktree was preserved | mitigate | `src/cli/dashboard/select.js:242` + `src/cli/dashboard/App.js:340` `DISMISS_PARTIAL_DIRTY` derived from actions[] `moved-dirty`, not buried in logs. | closed |
| T-42-11 | Tampering (contract drift) | server body shape drifts from TUI consumption | mitigate | `test/server-dismiss-e2e.test.js:162-179` vocabulary drift canary: every server-emittable `result` must be a value `mapDismissResult` branches on. 5/5 pass. | closed |
| T-42-12 | Tampering (data loss) | a real dirty worktree silently deleted instead of preserved | mitigate | Human UAT signed "approved" (`42-03-SUMMARY.md` Task 2, step 6/7): dirty→`.dirty` preservation + yellow footer confirmed against a real dead session. | closed |
| T-42-13 | Repudiation | the conscious invariant break goes undocumented | mitigate | `.planning/STATE.md:20,45` records the TUI read-only → read-write surface-identity change; zero new endpoints. | closed |
| T-42-SC | Tampering (supply chain) | npm/pip/cargo installs | mitigate | `tech-stack.added: []` in all three SUMMARY frontmatters; no package installs this phase. No [ASSUMED]/[SUS]/[SLOP] packages. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

### Informational (non-blocking)

- **WR-02 empty-taskId 400 guard** (`src/server.js:514-520`, commit `9599f18`): post-review hardening rejecting `DELETE /sessions/` with an empty segment via HTTP 400 before the handler. Defense-in-depth atop already-CLOSED traversal threats (T-42-04 / T-42-09); changes no disposition.
- **Dead import** (`src/server.js:7` `removeSession`): imported-but-unused after the handler stopped calling it; left per plan. Inert, no security impact.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|

No accepted risks. No threats were dispositioned `accept` or `transfer`. (T-42-12's human-UAT gate is a `mitigate` disposition realized through a manual verification step — the gate was executed and signed, not an accepted risk.)

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-05 | 14 | 14 | 0 | gsd-security-auditor (opus) |

Register origin: `register_authored_at_plan_time: true` — all three PLAN files carried parseable `<threat_model>` blocks. Audit mode: verify mitigations exist (no new-threat scan). Every `mitigate` threat confirmed by locating the actual guard/call at the cited `file:line`, corroborated by 57/57 dismiss-related tests green. Implementation files were not modified during the audit.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-05
