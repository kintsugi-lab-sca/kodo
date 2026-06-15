# Phase 49: Live-progress spike (HARD GATE) - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning
**Mode:** --auto (recommended options auto-selected; review decisions below)

<domain>
## Phase Boundary

This phase **IS the research** — its single deliverable is a written empirical verdict
**VIABLE / INVIABLE** on whether the live task-state of an interactive `claude --worktree`
session can be captured in the **installed** Claude Code build (empirically measured:
`claude --version` = **2.1.174**) via a supported surface. Mirror of v0.11 Phase 45:
empirical, version-specific, NOT pre-researchable from docs.

**In scope:** running the empirical spike, evaluating the 3 candidate surfaces, and producing
the verdict document with evidence + an unambiguous gate decision for Phase 50.

**Out of scope (Phase 50, conditional on VIABLE):** the actual capture/persistence (PROG-02)
and the dashboard `N/M` display (PROG-03). No production code ships from this phase.

</domain>

<decisions>
## Implementation Decisions

### Spike modality
- **D-01:** Empirical instrumentation of a **real interactive `claude --worktree` session**
  against the installed build (`2.1.174`), not doc inference. The harness is **throwaway**
  (no production code is a deliverable). Evidence MUST come from the running installed version.

### Surface evaluation order & stop rule
- **D-02:** Evaluate the 3 candidate surfaces in **fixed preference order**, stopping at the
  first that satisfies ALL 4 VIABLE conditions; descend to the next only on a demonstrated
  failure. Record evidence for **every** surface attempted (including failures) so the verdict
  is auditable:
  1. **Hook events** `TaskCreated`/`TaskCompleted` (`~/.claude/hooks/`) — preferred.
  2. **JSONL transcript watcher** (`~/.claude/projects/<slug>/*.jsonl`).
  3. **`~/.claude/tasks/` reading** — last resort, fragile. *(Empirically: this dir EXISTS on
     the installed build with UUID-named entries — a real candidate to probe, not hypothetical.)*

### Verdict artifact
- **D-03:** The deliverable is a dedicated verdict doc **`49-SPIKE.md`** in the phase dir,
  structured: `claude --version` header → per-surface **4-condition matrix** → raw-evidence
  appendix (sample payloads, dir listings, transcript snippets) → explicit **VIABLE/INVIABLE**
  → gate decision for Phase 50. This is the ONLY deliverable.

### Evidence bar (default-INVIABLE bias)
- **D-04:** **INVIABLE is the expected default.** VIABLE requires ALL 4 conditions proven
  empirically, **no partial credit** — any single failure → INVIABLE:
  1. surface actually fires/reads in build 2.1.174 (in an interactive session),
  2. payload stable enough to derive `N/M`,
  3. deterministic `session_id → task_id` correlation (via the existing kodo `state.json`),
  4. zero session latency/breakage **and** the capture writes to a kodo-controlled `~/.kodo/…`
     artifact (Claude Code internals are only the READ surface, never the source of truth).

### kodo-controlled artifact & correlation proof
- **D-05:** The kodo artifact mirrors the v0.11 light-plan producer↔consumer seam
  (`~/.kodo/plans/<task_id>.md`): write/own it through the `session-start.js` HOOK-02 pattern
  (golden-bytes preserved), correlated by `task_id`, never depending on undocumented Claude Code
  paths as the source of truth. Demonstrate correlation with **one real `session_id → task_id`
  round-trip** through the existing kodo session record.

### Claude's Discretion
- Exact harness scripting, how many sessions to probe for stability, and the precise filename
  of the kodo progress artifact (`~/.kodo/progress/<task_id>.*` vs alternative) — researcher/
  planner decide. The spike must not over-build; a minimal instrumented session suffices.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & gate semantics
- `.planning/ROADMAP.md` — Phase 49 block (goal, Success Criteria, gate semantics: INVIABLE cuts Phase 50 cleanly).
- `.planning/REQUIREMENTS.md` — `PROG-01` (the spike), `PROG-F1` (INVIABLE fallback — defer to future milestone, no penalty), `PROG-02`/`PROG-03` (conditional, Phase 50).

### Mirror pattern — v0.11 light-plan seam (the explicit precedent)
- `src/hooks/session-start.js` — HOOK-02 golden-bytes injection point; where kodo writes/owns the artifact (append-at-end, never-throws).
- `src/cli/dashboard/plan.js` — `readLightPlan` filesystem-style consumer (byte-identical path to producer, anti-ReDoS `task_id` guard) — the pattern Phase 50's display would mirror.
- `src/config.js` — `KODO_DIR` (kodo-controlled artifact root, `~/.kodo/`).

### Empirical surfaces on the installed build (2.1.174)
- `~/.claude/hooks/` — surface 1 (hook events).
- `~/.claude/projects/<slug>/*.jsonl` — surface 2 (transcript watcher).
- `~/.claude/tasks/` — surface 3 (exists, UUID entries — last resort).

### Codebase orientation
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/INTEGRATIONS.md` — system shape, hook/kodo-dir integration points.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/hooks/session-start.js` — HOOK-02 hook; the place to write/own the kodo progress artifact, golden-bytes preserved (same discipline as the v0.11 light-plan injection).
- `KODO_DIR` (`src/config.js`) — the `~/.kodo/` root; existing artifacts: `~/.kodo/logs/<session>.ndjson`, `~/.kodo/polling-state.json`, `~/.kodo/plans/<task_id>.md`.
- kodo session record (`state.json`) — carries `session_id`/`task_id`; the correlation source for condition 3.
- `readLightPlan` (`src/cli/dashboard/plan.js`) — never-throws filesystem consumer pattern Phase 50 would reuse.

### Established Patterns
- v0.11 Phase 45/46 producer↔consumer seam — byte-identical path between writer and reader, never-throws, anti-ReDoS `task_id` containment guard.
- v0.10 Phase 43 non-color `provider_state` column — degraded-state honesty (`—` no data / `?` transient fail + keep-last-good) — the Phase-50 display pattern if VIABLE.
- Invariant: **zero new endpoints** — any capture/display reads the artifact filesystem-style, never via a new server route.

### Integration Points
- Capture writes to `~/.kodo/…` correlated by `task_id`; Claude Code internals (`~/.claude/...`) are the READ surface under evaluation, never the persisted source of truth.

</code_context>

<specifics>
## Specific Ideas

- This spike is the explicit mirror of **v0.11 Phase 45** (empirical, version-specific, not doc-researchable).
- Design the milestone so it closes cleanly on the expected **INVIABLE** default: OPEN-* (shipped) + NYQ-03 with no milestone penalty; PROG-02/03 defer to a future milestone (PROG-F1).

</specifics>

<deferred>
## Deferred Ideas

- **PROG-02 (capture + persist live progress)** — Phase 50, conditional on VIABLE. NOT this spike.
- **PROG-03 (dashboard `N/M` per-session display)** — Phase 50, conditional on VIABLE. NOT this spike.
- **"kodo bidireccional" (sesión cmux → tarea)** — backlog Phase 999.1; this spike's surface findings (what the installed Claude Code exposes) feed that future milestone, but building it is out of scope here.

</deferred>

---

*Phase: 49-live-progress-spike-hard-gate*
*Context gathered: 2026-06-12*
