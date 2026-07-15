# Phase 67: Secrets Writer + Masked Input — Plan & Execution

**Status:** Planning phase starting  
**Date:** 2026-07-02  
**Milestone:** v0.15 «kodo up» (Phases 65-68)  
**Session:** KODO-8 (claude-mem work item)

## Overview

**Goal:** Enable dashboard-driven secrets configuration for Phase 68's setup mode.

**Deliverables:**
- `writeEnvVar()` module: atomic file write (`~/.kodo/.env`) with chmod 0600 pre-rename + merge semantics
- Masked input field: extends Phase 63's text-input to hide API keys (shows `•` per character)
- Hygiene grep: verify value doesn't leak to 5 vectors (render/log/argv/config.json/status)
- Indicator "configurado": presence-only display (no value reveal)

**Security Boundary:** PERSIST-04 LOCKED — API key value **NEVER** crosses from `~/.kodo/.env` to dashboard/logs/config/status/argv.

## Requirements
- SETUP-03: `writeEnvVar` atomic + chmod 0600 + merge
- SETUP-04: Masked input + hygiene grep + "configurado" indicator

## Dependencies
- Phase 65 ✅ (atomic write patterns from PID module)
- Phase 66 ✅ (`kodo up` / lifecycle stable)

## Execution Plan

### Step 1: Planning (`/gsd-plan-phase 67`)
**Status:** ✅ COMPLETE (2026-07-02 11:45 UTC+2)

**Deliverables:**
- ✅ `67-CONTEXT.md` — research-based decision log (8 decisions, 4 pitfalls, reference architecture)
- ✅ `67-01-PLAN.md` — Wave 1: `writeEnvVar` module (atomic + chmod 0600 + merge)
- ✅ `67-02-PLAN.md` — Wave 2: masked input component (dashboard TUI + `onSaveApiKey` callback)
- ✅ `67-03-PLAN.md` — Wave 3: hygiene grep (5-sink static test + runtime UAT)

**Status:** Planning phase complete. Ready for implementation.

### Step 2: Implementation
**Status:** Pending

Execute 3 waves with atomic commits:
1. Wave 1 (67-01): `writeEnvVar` module + tests
2. Wave 2 (67-02): masked input + `[configurado]` indicator + degradation
3. Wave 3 (67-03): hygiene grep suite + UAT checklist

### Step 3: Verification (pending)
- Grep test suite passes (5 sinks clean)
- File perms = 0600
- Runtime UAT: `ps`, logs, `/status` checks

## Next Action

Execute `/gsd-execute-phase 67` to begin Wave 1 implementation, or manually start with the tasks in `67-01-PLAN.md`.

## Blocked By
- None — ready to proceed
