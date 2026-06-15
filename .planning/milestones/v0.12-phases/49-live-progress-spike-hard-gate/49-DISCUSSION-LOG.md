# Phase 49: Live-progress spike (HARD GATE) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-12
**Phase:** 49-live-progress-spike-hard-gate
**Mode:** --auto (recommended option auto-selected per area)
**Areas discussed:** Spike modality, Surface evaluation order & stop rule, Verdict artifact, Evidence bar, kodo artifact & correlation

---

## Spike modality

| Option | Description | Selected |
|--------|-------------|----------|
| Real instrumented `claude --worktree` session | Empirical probe of the installed build (2.1.174), throwaway harness | ✓ |
| Doc/changelog inference | Read Claude Code docs/release notes to infer surfaces | |

**Auto-selected:** Real instrumented session — the roadmap mandates empirical evidence from the installed version; docs are explicitly insufficient (mirror of v0.11 Phase 45).

---

## Surface evaluation order & stop rule

| Option | Description | Selected |
|--------|-------------|----------|
| Preference order, stop at first VIABLE | hooks → transcript JSONL → ~/.claude/tasks/; descend only on failure; record all attempts | ✓ |
| Evaluate all 3 surfaces exhaustively | Probe every surface regardless of early success | |

**Auto-selected:** Preference order + stop-at-first-VIABLE — matches SC#2 ("en orden de preferencia"); failures still recorded for an auditable verdict.

---

## Verdict artifact

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated `49-SPIKE.md` (4-condition matrix + raw evidence + verdict) | Structured verdict doc as the sole deliverable | ✓ |
| Inline in VERIFICATION.md | Fold the verdict into the standard verification artifact | |

**Auto-selected:** Dedicated `49-SPIKE.md` — the verdict + evidence IS the deliverable; deserves a first-class structured doc.

---

## Evidence bar (default-INVIABLE bias)

| Option | Description | Selected |
|--------|-------------|----------|
| All-4-or-INVIABLE, no partial credit | INVIABLE default; VIABLE only if all 4 conditions proven | ✓ |
| Lenient (majority of conditions) | Declare VIABLE on partial satisfaction | |

**Auto-selected:** All-4-or-INVIABLE — the roadmap is explicit; partial credit would rubber-stamp a fragile capture.

---

## kodo artifact & correlation

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror v0.11 light-plan seam (~/.kodo/ via HOOK-02), correlate via state.json | kodo-owned artifact; Claude Code internals only the READ surface | ✓ |
| Depend on Claude Code internal paths directly | Read/consume ~/.claude/... as the source of truth | |

**Auto-selected:** Mirror the light-plan seam — preserves the "kodo-controlled artifact" condition and the zero-new-endpoints invariant; undocumented internals are never the persisted source of truth.

---

## Claude's Discretion

- Exact harness scripting, number of sessions probed for payload stability, precise filename of the kodo progress artifact (`~/.kodo/progress/<task_id>.*` vs alternative).

## Deferred Ideas

- PROG-02 (capture + persist) and PROG-03 (dashboard `N/M` display) — Phase 50, conditional on VIABLE.
- "kodo bidireccional" (sesión cmux → tarea) — backlog Phase 999.1; informed by this spike's surface findings.
