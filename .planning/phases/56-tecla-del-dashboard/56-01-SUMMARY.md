---
phase: 56-tecla-del-dashboard
plan: 01
subsystem: cli/dashboard
tags: [adopt, execFile, never-throws, pure-derive, color-isolation, tdd]
requires:
  - "Phase 55: listAgentSurfaces() seam (AgentSurface shape)"
  - "Phase 54: kodo adopt CLI (--workspace/--cwd/--session-id/--project)"
  - "runOpen/runFocus molds (open.js/focus.js)"
provides:
  - "runAdopt: never-throws execFile orchestrator for `kodo adopt`"
  - "computeAdoptable: pure set-difference (surfaces vs /status by sessionId)"
  - "resolveProjectId: pure nearest-ancestor reverse-lookup cwd→projectId"
affects:
  - "Plan 02 (App.js wiring) consumes these three exports"
tech-stack:
  added: []
  patterns:
    - "execFile via process.execPath + kodoBin argv[0] (shebang-script binary, polling.js mold)"
    - "leak guard structural (exec no default → TypeError)"
    - "pure derive helpers in select.js (React-free, node:*-only)"
key-files:
  created:
    - src/cli/dashboard/adopt.js
    - test/dashboard/adopt.test.js
    - test/dashboard/select-adopt.test.js
  modified:
    - src/cli/dashboard/select.js
decisions:
  - "D-06: binary is process.execPath, kodoBin is argv[0] (bin/kodo is a #!/usr/bin/env node script — Pitfall 4)"
  - "D-05: ancestor-match semantics for resolveProjectId (not exact-match) with none/ambiguous guards"
  - "resolveProjectId kept pure with a local trailing-slash `norm` (no path.normalize/realpathSync) — preserves zero-import color isolation"
metrics:
  duration: ~12m
  completed: 2026-06-17
  tasks: 3
  files: 4
---

# Phase 56 Plan 01: Adopt Flow Foundation (runAdopt + pure derives) Summary

Built the React-free, independently-unit-testable foundation of the Phase 56 adopt flow: the `runAdopt` never-throws `execFile` orchestrator for `kodo adopt`, plus the two pure derives `computeAdoptable` (set-difference keyed by sessionId) and `resolveProjectId` (nearest-ancestor cwd→projectId reverse-lookup). No React/App.js/server code touched — these are the finished contracts Plan 02 wires into the TUI.

## What Was Built

- **`src/cli/dashboard/adopt.js` (new)** — `runAdopt({ exec, execPath, kodoBin, workspaceRef, cwd, sessionId, projectId, timeoutMs })`. Clone of `runOpen` minus the BAD_PROTOCOL allowlist. The binary is `process.execPath` (node) and `kodoBin` is argv[0], because `bin/kodo` is a `#!/usr/bin/env node` script, not a native executable (Pitfall 4 / polling.js mold). argv is the literal 10-element array `[kodoBin, 'adopt', '--workspace', ref, '--cwd', cwd, '--session-id', sid, '--project', pid]`. Structural leak guard (no `exec` default → TypeError before `new Promise`). Never-throws: ENOENT / numeric exit code (1=config, 2=transient) / sync-throw all collapse to a resolved `{ok:false}`.
- **`src/cli/dashboard/select.js` (modified — appended 2 exports)** — `computeAdoptable(surfaces, statusSessions)` filters `kind==='claude'` AND truthy `sessionId` AND `sessionId ∉ Set(statusSessions[].session_id)` (diff keyed by sessionId, never workspaceRef; null inputs → `[]`). `resolveProjectId(cwd, projects)` does a trailing-slash-normalized, separator-boundary-safe nearest-ancestor match, returning `{projectId}` | `{error:'none'}` | `{error:'ambiguous'}`. Existing exports (sortSessions, resolveSelection, parseFilter, grepLogs, mapDismissResult) untouched.
- **`test/dashboard/adopt.test.js` (new)** — 5 never-throws scenarios (clone of open.test.js, BAD_PROTOCOL dropped): ok-path + cmd===execPath + args[0]===kodoBin + literal argv ordering; ENOENT; NON_ZERO_EXIT with detail=1 and detail=2; sync-throw → SPAWN_ERROR (asserts no reject); leak guard → TypeError.
- **`test/dashboard/select-adopt.test.js` (new)** — 15 cases covering computeAdoptable (kind filter, sessionId diff, workspaceRef-ignored, falsy-sessionId/null inputs) and resolveProjectId (exact, ancestor, nearest-wins, none, sibling-boundary, ambiguous, trailing-slash, empty projects).

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Scaffold failing unit tests (RED) | 3ffb02d | test/dashboard/adopt.test.js, test/dashboard/select-adopt.test.js |
| 2 | Implement runAdopt (GREEN) | 804bf73 | src/cli/dashboard/adopt.js |
| 3 | Implement computeAdoptable + resolveProjectId (GREEN) | 68e8491 | src/cli/dashboard/select.js |

## TDD Gate Compliance

- Task 1 established RED (`test(56-01)` commit) — both new test files run and fail because the production exports do not yet exist.
- Tasks 2 and 3 are the GREEN gate (`feat(56-01)` commits) — implementations make their respective tests pass with no test changes.
- No REFACTOR commit was needed (implementations were minimal and clean on first pass).

## Verification

- `node --test test/dashboard/adopt.test.js test/dashboard/select-adopt.test.js` → 20/20 pass.
- `node --test 'test/dashboard/*.test.js'` → 55/55 pass (no regression to focus/open/select-dismiss/app-*).
- `node --test test/format-isolation.test.js` → 8/8 pass (walker confirms adopt.js + new select.js exports import zero picocolors/format.js — D-08).
- `git diff --stat <base> -- src/server.js` → EMPTY (zero-endpoints invariant preserved).
- `grep -nE '^\s*import .*(picocolors|cli/format)' src/cli/dashboard/adopt.js` → no matches (only prose comments mention the names).

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Coverage

- **T-56-01 (argv tampering/EoP):** mitigated — execFile (no shell) with a literal argv array; each value preceded by its explicit `--flag`. Asserted by the argv-ordering test.
- **T-56-02 (binary resolution EoP):** mitigated — binary is `process.execPath` with `kodoBin` as argv[0]; zero PATH lookup. Asserted by `cmd===EXEC_PATH` and `args[0]===KODO_BIN`.
- **T-56-03 (path traversal in reverse-lookup):** accepted — `cwd` is only string-compared against the operator's projects map; never used for FS access. Normalization is trailing-slash strip only (no realpathSync), keeping the helper pure.
- **T-56-04 (never-throws DoS):** mitigated — all failure modes collapse to a resolved `{ok:false}`; the sync-throw test asserts the promise does not reject.

## Known Stubs

None — all three exports are fully implemented and wired to real inputs; the only consumer (App.js) is Plan 02 scope by design.

## Self-Check: PASSED

- FOUND: src/cli/dashboard/adopt.js
- FOUND: src/cli/dashboard/select.js (computeAdoptable + resolveProjectId)
- FOUND: test/dashboard/adopt.test.js
- FOUND: test/dashboard/select-adopt.test.js
- FOUND commit: 3ffb02d (test)
- FOUND commit: 804bf73 (feat runAdopt)
- FOUND commit: 68e8491 (feat derives)
