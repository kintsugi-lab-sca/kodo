---
phase: 79-sidebar-doctor
reviewed: 2026-07-23T08:31:29Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/cli.js
  - src/cli/sidebar-doctor.js
  - src/cmux/client.js
  - src/cmux/sidebar-doctor.js
  - src/logger-events.js
  - test/cli/sidebar-doctor-cli.test.js
  - test/cmux/sidebar-doctor.test.js
  - test/logger-events.test.js
  - test/sidebar-doctor-hygiene.test.js
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 79: Code Review Report

**Reviewed:** 2026-07-23
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Re-review of the full `kodo sidebar doctor` phase including the 79-04 gap closure
(G-79-1). The core invariant of the gap closure — `execute()` NEVER calls
`createWorkspaceGroup`/`setGroupAnchor`, `missing_group` is report-only/advisory,
`hasActions` excludes `missing_group`, and the loose→add / empty→ungroup paths
stay intact (SDR-05) — is **correctly implemented and well covered by tests**.
`execute()` only invokes `addToWorkspaceGroup` and `ungroupWorkspaceGroup`; the
create/set-anchor verbs are never reached; the source-hygiene guard blocks the
destructive `delete/remove/rename` family; and all 34 phase tests pass. Command
injection surface is clean: every cmux ref travels as a plain `execFile` array
element (no shell), and the logger helpers use explicit field whitelists.

No BLOCKER-class defects were found. The gap closure achieved its stated goal.
However, the closure left behind residue that undermines its own invariant surface
(dead create/anchor wiring), an unfulfilled observability contract (the `mode:'fix'`
distinction is never emitted), and a latent dual-source-of-truth in emptiness
detection that can dissolve a group holding a live grouped session under contradictory
cmux output. These are the three WARNINGs below.

## Warnings

### WR-01: Dead `createWorkspaceGroup`/`setGroupAnchor` wiring contradicts the G-79-1 invariant

**File:** `src/cmux/sidebar-doctor.js:44-51, 78-81, 99-102`
**Issue:** After G-79-1 made `missing_group` report-only, `execute()` no longer
calls `createWorkspaceGroup` or `setGroupAnchor` — the only invocations left are
`addToWorkspaceGroup` and `ungroupWorkspaceGroup` (lines 378, 388). Yet both verbs
are still imported (44-51), typed in `SidebarDeps` (78-81), and wired into
`resolveDeps` (99, 101). This is dead code, but it is worse than ordinary dead
code: the whole point of the gap closure is that the doctor must NEVER be able to
create or anchor a group on a live session. Keeping the create/anchor verbs
plumbed into the engine's dependency container keeps that capability one line away
from being re-enabled, and it directly contradicts the module's own header comment
("Allowlist NO-destructivo... solo lo consume execute; jamás delete/remove/rename")
by wiring verbs that `execute` demonstrably no longer consumes. A reader auditing
the invariant cannot confirm it from the imports alone.
**Fix:** Remove `createWorkspaceGroup` and `setGroupAnchor` from the import (44-51),
from the `SidebarDeps` typedef (78-81), and from `resolveDeps` (99, 101). The
client.js exports may remain (they are guarded by the hygiene test's allowlist),
but the doctor engine should only depend on the two verbs it actually calls, so the
"doctor never creates/anchors" invariant is provable at the dependency boundary:
```js
import {
  listWorkspaceGroups,
  listWorkspacesJson,
  addToWorkspaceGroup,
  ungroupWorkspaceGroup,
} from './client.js';
```

### WR-02: `sidebar.doctor.scan` always emits `mode:'dry-run'` — the `fix` re-scan is indistinguishable

**File:** `src/cmux/sidebar-doctor.js:306-311` (and `src/logger-events.js:813-834`)
**Issue:** `scan()` hardcodes `mode: 'dry-run'` in every `sidebarDoctorScan` emission
(line 307). `execute()` re-invokes `scan(deps)` internally for the D-06 TOCTOU
re-detection (line 367), which emits a **second** `sidebar.doctor.scan` record —
also tagged `mode:'dry-run'`. So under `--fix` the NDJSON contains two identical
`mode:'dry-run'` scan events, and the `mode:'fix'` value is never emitted anywhere
in the codebase. This breaks the documented contract in `logger-events.js:821-822`
("`mode` distingue el pase dry-run del re-scan interno de `execute` (D-06 TOCTOU)"):
the field exists to distinguish the two passes, but the code makes them
indistinguishable. An operator reading the log sees two dry-runs and cannot tell
that the second was the mutating re-scan.
**Fix:** Thread the mode into `scan` so the internal re-scan is labeled correctly, e.g.:
```js
export async function scan(deps = {}, { mode = 'dry-run' } = {}) {
  ...
  sidebarDoctorScan(d.logger, { mode, missing: ..., loose: ..., empty: ... });
}
// in execute():
const report = await scan(deps, { mode: 'fix' });
```
Alternatively, drop the `mode` field from the helper if the distinction is not
wanted — but do not ship a documented field that is never populated.

### WR-03: Emptiness derived from `member_count` while membership derives from `member_workspace_refs` — a protected group can be ungrouped

**File:** `src/cmux/sidebar-doctor.js:188-200, 289-295`
**Issue:** `buildMemberIndex` (188) and the loose/protected classification derive
group membership from `g.member_workspace_refs`, but the `empty_group` filter (293)
derives emptiness from a **different** field, `g.member_count === 0`. The WR-01
dedup (289) only excludes groups that are targets of a loose `add` (`looseGroupRefs`);
it does NOT exclude groups that hold a **protected** (already-member) live session.
If cmux ever reports a group with `member_count: 0` while `member_workspace_refs`
still lists a live kodo workspace (a contradictory-but-observed transient the code
itself calls "estado transitorio raro"), that session is classified `protected`
(it is in the member index), the group is NOT in `looseGroupRefs`, and so the group
lands in `empty_group` → `execute()` issues `ungroup` on a group that contains a
live, correctly-grouped session. `ungroup` is non-destructive (workspaces survive),
so this is not data loss, but it dissolves a group the doctor is supposed to protect
and reintroduces the very drift the doctor exists to remove.
**Fix:** Use a single source of truth for emptiness, and exclude every resolved
group ref (protected + loose), not only loose targets:
```js
const resolvedGroupRefs = new Set([
  ...loose_workspace.map((l) => l.group),
  ...protectedSessions.map((p) => p.group),
]);
const empty_group = (groupsJson.groups || [])
  .filter((g) => g && typeof g.ref === 'string'
    && g.member_count === 0
    && (!Array.isArray(g.member_workspace_refs) || g.member_workspace_refs.length === 0)
    && !resolvedGroupRefs.has(g.ref))
  .map((g) => ({ ref: g.ref, name: typeof g.name === 'string' ? g.name : '' }));
```

## Info

### IN-01: `now` dependency is resolved but never used

**File:** `src/cmux/sidebar-doctor.js:103` (declared), no consumer in the module
**Issue:** `resolveDeps` wires `now: deps.now || (() => Date.now())` (103), but
neither `scan` nor `execute` ever calls `d.now()` — ordering uses `started_at`
strings via `sortByOldest` (170). The dep is inert. It is mirrored from
`gsd/doctor.js`, but here it carries no behavior and invites the false assumption
that timing is injectable/tested.
**Fix:** Remove `now` from `resolveDeps` and from the `SidebarDeps` typedef (line 83),
or wire it into `sortByOldest`/logging if a deterministic clock is actually intended.

### IN-02: `empty_group.ref` bypasses the `workspace_group:N` shape validation applied everywhere else

**File:** `src/cmux/sidebar-doctor.js:291-295`
**Issue:** `resolveWorkspaceGroup` (manager.js:199-204) deliberately validates group
refs against `/^workspace_group:\d+$/` before returning them ("defensa contra forja
de líneas de log"), so `loose_workspace[].group` is always shape-clean. The
`empty_group` filter (292) only checks `typeof g.ref === 'string'`, then feeds that
unvalidated ref to a real mutation (`ungroupWorkspaceGroup`, 388), to `pushError`
targets (391), to `--json`, and to the human renderer. Injection is not possible
(`execFile` array element, no shell) and NDJSON line-forging is neutralized by
`JSON.stringify` escaping, so real-world risk is low — but the defensive posture is
inconsistent with the codebase's own stated invariant for the identical value type.
**Fix:** Apply the same shape guard in the `empty_group` filter:
```js
.filter((g) => g && typeof g.ref === 'string'
  && /^workspace_group:\d+$/.test(g.ref)
  && g.member_count === 0
  && !resolvedGroupRefs.has(g.ref))
```

---

_Reviewed: 2026-07-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
