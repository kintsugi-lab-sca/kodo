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
**Status:** In progress (2026-07-02 11:43 UTC+2)

Will create detailed plans:
- Wave 1: `writeEnvVar` module (atomic + merge logic)
- Wave 2: Masked input component (Ink + TUI)
- Wave 3: Hygiene grep + tests + "configurado" indicator

### Step 2: Implementation (pending)
Execute 3-4 sub-plans with atomic commits per wave

### Step 3: Verification (pending)
- UAT: grep hygiene check (5 vector sweep)
- Phase 68 readiness: setup mode integration test

## Blocked By
- None — ready to proceed
