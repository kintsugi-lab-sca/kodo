---
phase: 55-contrato-hostprovider-describesurface-cmux
verified: 2026-06-16T18:30:00Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
---

# Phase 55: Contrato `listAgentSurfaces()` (cmux) — Verification Report

**Phase Goal:** Añadir al contrato `HostProvider`/`WorkspaceHost` (`src/host/interface.js`) un método opcional typeof-detected (`listAgentSurfaces()`) implementado en `src/host/cmux.js` sobre cmux, que descubre las sesiones `claude` ad-hoc devolviendo `{ workspaceRef, cwd, sessionId, kind }` por surface. Fixture-lockeado (cmux 0.64.16) + fail-open. Es el seam del host consumido por Phase 56/54/57.
**Verified:** 2026-06-16T18:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `listAgentSurfaces()` exists in `src/host/cmux.js`, typeof-detected (NOT in HOST_METHODS), degrades fail-open | ✓ VERIFIED | `src/host/cmux.js:230` defines `async function listAgentSurfaces()`; `HOST_METHODS` is `Object.freeze(['listWorkspaces','selectWorkspace','isAlive','needsInput'])` (4 entries, no change); returned at line 315 |
| 2 | Returns `{ workspaceRef, cwd, sessionId (= resume_binding.checkpoint_id), kind }` per surface | ✓ VERIFIED | `normalizeSurface` at line 61-66: `workspaceRef: raw.workspace_ref`, `cwd: b.cwd`, `sessionId: b.checkpoint_id`, `kind: b.kind`; field mapping is exact D-02 |
| 3 | Real cmux 0.64.16 output is fixture-locked and asserted via the `run` DI | ✓ VERIFIED | `surface-resume-show.json` annotated `0.64.16 (96) [5321becb6]`; contract test asserts `sessionId === 'c1c3ed6d-fa07-43af-add7-44274b1e0a64'`, `cwd === '/Users/alex/dev/klab/kodo'`, `kind === 'claude'`, `workspaceRef === 'workspace:1'` field-by-field |
| 4 | Fail-open modes handled: cleared / missing resume_binding / source!=agent-hook / socket down → never-throws | ✓ VERIFIED | `normalizeSurface`: `raw.cleared` truthy → null (WR-02 hardened); `!b` → null; `b.source !== 'agent-hook'` → null; tree exec failure → `return []`; fan-out catch INSIDE loop → `continue`; 4 dedicated tests pass |
| 5 | 2-step enumeration: `cmux tree --all --json` → fan-out `surface resume show --json --surface <ref>` (no `surface resume list`) | ✓ VERIFIED | `listAgentSurfaces` line 234: `run(['tree','--all','--json','--id-format','both'])` then loop `run(['surface','resume','show','--json','--surface',ref])` per ref |
| 6 | `normalizeSurface` is a pure module-scope helper outside `createCmuxHost` | ✓ VERIFIED | `src/host/cmux.js:46` — defined at module scope before `createCmuxHost` factory |
| 7 | `@typedef AgentSurface` added to `interface.js`; `HOST_METHODS` frozen at 4 unchanged | ✓ VERIFIED | `interface.js:27-42` contains full typedef with 4 camelCase string props; `HOST_METHODS` lines 52-57 unchanged at 4 entries; `grep -c 'AgentSurface' src/host/interface.js` = 3 |
| 8 | All 4 AgentSurface string fields validated in `normalizeSurface` (WR-01 hardened post-review) | ✓ VERIFIED | `cmux.js:53-58` guards `typeof raw.workspace_ref !== 'string'`, `typeof b.cwd !== 'string'`, `typeof b.checkpoint_id !== 'string'`, `typeof b.kind !== 'string'`; commit 701a772 added this hardening |
| 9 | Cross-cutting rule: adopt.js/reconcile.js host-agnostic; cmux-isolation walker green | ✓ VERIFIED | No `import`/`require` of cmux or `listAgentSurfaces` in adopt.js/reconcile.js; walker `test/host/cmux-isolation.test.js` 4 pass / 0 fail |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `test/fixtures/cmux/surface-resume-show.json` | cmux 0.64.16 fixture map with 4 D-05 cases | ✓ VERIFIED | 1 adoptable (source=agent-hook, cleared=false), 1 cleared:true, 1 resume_binding:null, 1 source=environment; annotated "0.64.16 (96)" |
| `test/fixtures/cmux/surface-tree.json` | paso-1 tree output with ≥2 surface_refs | ✓ VERIFIED | 4 surface_refs (surface:1..surface:4) in `windows[0].workspaces[0].panes[0].surface_refs`; annotated "0.64.16 (96)" |
| `src/host/interface.js` | `@typedef AgentSurface` (camelCase); HOST_METHODS unchanged | ✓ VERIFIED | typedef at lines 27-42 with 4 string properties; HOST_METHODS frozen at exactly 4 |
| `src/host/cmux.js` | `listAgentSurfaces()` + pure `normalizeSurface()` + `extractSurfaceRefs()` | ✓ VERIFIED | All 3 functions present; `grep -c 'listAgentSurfaces'` = 3 (definition, JSDoc, return); module-scope helpers |
| `test/host/contract.test.js` | Golden asserts + fail-open cases + typeof-degradation test | ✓ VERIFIED | `describe('CmuxHost — listAgentSurfaces (DETECT-01)')` with 7 tests including field-by-field, D-05 omission, tree→[], row-by-row skip, WR-01/WR-02 regression tests, null-host typeof test |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/host/cmux.js listAgentSurfaces()` | `run` DI (tree step) | `run(['tree','--all','--json','--id-format','both'])` | ✓ WIRED | Line 234; return [] on exec fail (line 241) and parse fail (line 253) |
| `src/host/cmux.js listAgentSurfaces()` | `run` DI (fan-out step) | `run(['surface','resume','show','--json','--surface',ref])` | ✓ WIRED | Line 262 inside for-loop; catch → `continue` (line 264) |
| `src/host/cmux.js normalizeSurface()` | `AgentSurface` shape | `resume_binding.checkpoint_id → sessionId`, `resume_binding.cwd → cwd`, `resume_binding.kind → kind`, `workspace_ref → workspaceRef` | ✓ WIRED | Lines 61-66; all 4 field mappings confirmed |
| `test/host/contract.test.js` fakeExecFromFixtures + run | `test/fixtures/cmux/surface-resume-show.json` | argv routing `argv.includes('surface resume show')` → `surfaceShowFor(argv)` | ✓ WIRED | Lines 56, 97; `surfaceShowFor` parses `--surface <ref>` and looks up in SURFACE_MAP |
| `test/host/contract.test.js` run | `test/fixtures/cmux/surface-tree.json` | `argv.includes('tree')` → TREE_FIXTURE | ✓ WIRED | Lines 57, 98 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `listAgentSurfaces()` | `out` (AgentSurface[]) | `run(['tree'…])` → `extractSurfaceRefs` → `run(['surface','resume','show'…])` → `normalizeSurface` | Yes — fixtures contain real cmux 0.64.16 capture; test asserts exact UUID from actual binary capture | ✓ FLOWING |
| `normalizeSurface(raw)` | return value | `raw.workspace_ref`, `raw.resume_binding.*` fields | Yes — validated against live fixture data; null-returns are design-correct fail-open paths, not stubs | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `listAgentSurfaces()` returns only adoptable surface | `node --test test/host/contract.test.js` | 24 pass / 0 fail | ✓ PASS |
| fail-open: tree failure → `[]` | test case "tree falla → [] (fail-open D-05)" | passes | ✓ PASS |
| fail-open: row-by-row skip | test case "un resume show individual falla" | passes | ✓ PASS |
| null host typeof-detection | `typeof getHost('null').listAgentSurfaces !== 'function'` asserted in test | passes | ✓ PASS |
| Full suite regression | `node --test $(find test -name '*.test.js')` | 1384 pass / 0 fail / 1 skip | ✓ PASS |
| cmux isolation walker | `node --test test/host/cmux-isolation.test.js` | 4 pass / 0 fail | ✓ PASS |

---

### Probe Execution

Step 7c: SKIPPED — no probe scripts declared in PLAN; this is a contract/library phase with no runnable CLI entry points to probe.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DETECT-01 | 55-01-PLAN.md | Método opcional typeof-detected en HostProvider; fixture-lock 0.64.16; fail-open modes; adopt.js/reconcile.js host-agnostic | ✓ SATISFIED | All 3 sub-requirements met: (a) fixture-locked via run DI + field-by-field asserts; (b) 4 fail-open modes handled + never-throws; (c) cmux-isolation walker green; adopt.js/reconcile.js unmodified |

**Note on REQUIREMENTS.md traceability row:** DETECT-01 still shows "Pending" in the traceability table — this is a documentation update deferred to phase completion bookkeeping, not an implementation gap. The implementation is fully delivered.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No debt markers (TBD/FIXME/XXX), no unresolved placeholders, no hardcoded empty returns in rendering paths. The `return null` in `normalizeSurface` and `return []` in `listAgentSurfaces` are correct fail-open design, not stubs — each has a corresponding test asserting the specific trigger condition.

One cosmetic issue from code review (IN-03): misleading inline comment in `contract.test.js:243` ("sirve surface:1 OK pero throws para surface:1... no:") — leftover self-correction text. Severity: Info only, no behavioral impact, test logic is correct.

---

### Human Verification Required

None. All success criteria are mechanically verifiable and confirmed:
- `listAgentSurfaces()` is a pure-data, non-UI method
- All behavior paths are covered by the contract test suite
- No visual, real-time, or external-service-dependent behavior to verify in this phase

---

### Gaps Summary

No gaps. All 9 must-have truths verified. All required artifacts exist and are substantive. All key links are wired. Test suite is 1384/1384 pass with 0 failures.

**Post-review hardening note:** The code review (55-REVIEW.md) identified WR-01 and WR-02 as warnings. Both were resolved in commit 701a772 before verification ran:
- WR-01: `normalizeSurface` now validates all 4 AgentSurface string fields (not just 2)
- WR-02: `cleared` check now uses truthy test (`raw.cleared`) instead of strict `=== true`

WR-03 (caller self-inclusion in tree enumeration) was left as-is by design — the consumer (Phase 56) handles dedup via D-06 keyed by `sessionId`/`cwd`.

---

_Verified: 2026-06-16T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
