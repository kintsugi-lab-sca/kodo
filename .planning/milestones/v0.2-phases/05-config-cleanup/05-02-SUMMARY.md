---
phase: 05-config-cleanup
plan: 02
subsystem: orchestrator
tags: [prompt-template, provider-agnostic, legacy-cleanup]

requires:
  - phase: 05-config-cleanup/01
    provides: Provider-agnostic config system with getProviderApiKey and ensureConfig
provides:
  - Provider-neutral orchestrator prompt with {{placeholder}} resolution
  - resolvePromptTemplate() function in launch.js
  - Clean generic modules with no Plane-specific naming
  - Plane-specific resolveLabels() isolated in src/providers/plane/labels.js
affects: []

tech-stack:
  added: []
  patterns: [prompt-template-resolution, provider-placeholder-pattern]

key-files:
  created:
    - src/providers/plane/labels.js
    - test/prompt.test.js
  modified:
    - src/orchestrator/prompt.md
    - src/orchestrator/launch.js
    - src/session/state.js
    - src/session/health.js
    - src/labels.js
    - test/state.test.js

key-decisions:
  - "resolvePromptTemplate uses replaceAll with {{provider}}, {{provider_name}}, {{mcp_tool}} — three placeholders cover all prompt variations"
  - "HealthReport field renamed from identifier to ref for consistency with session.task_ref naming"

patterns-established:
  - "Prompt template pattern: prompt.md uses {{placeholders}}, resolved at runtime via resolvePromptTemplate(raw, {provider})"

requirements-completed: [CONF-04]

duration: 4min
completed: 2026-04-13
---

# Phase 5 Plan 2: Prompt Neutralization & Legacy Cleanup Summary

**Provider-agnostic orchestrator prompt with {{placeholder}} resolution, planeId/plane_identifier renamed to taskId/task_ref across generic modules, legacy src/plane/ deleted**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-13T11:25:49Z
- **Completed:** 2026-04-13T11:29:23Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Orchestrator prompt.md has zero literal Plane references — all replaced with {{provider_name}}, {{provider}}, {{mcp_tool}} placeholders
- Added resolvePromptTemplate() to launch.js for runtime placeholder resolution (supports any provider)
- Renamed planeId→taskId in state.js function signatures and health.js report fields
- Moved Plane-specific resolveLabels() to src/providers/plane/labels.js, keeping generic parseKodoLabels in src/labels.js
- Deleted legacy src/plane/ directory — no remaining imports anywhere

## Task Commits

Each task was committed atomically:

1. **Task 1: Parametrize orchestrator prompt + template resolution** - `693e7a4` (feat, TDD)
2. **Task 2: Rename planeId params, move labels, delete legacy src/plane/** - `fa2979e` (refactor)

## Files Created/Modified
- `src/orchestrator/prompt.md` - Provider-neutral prompt with {{placeholders}}
- `src/orchestrator/launch.js` - Added resolvePromptTemplate(), fixed task_ref usage
- `src/session/state.js` - Renamed planeId→taskId in all function signatures
- `src/session/health.js` - Renamed planeId→taskId, identifier→ref, plane_identifier→task_ref
- `src/labels.js` - Removed Plane-coupled resolveLabels(), kept generic parseKodoLabels
- `src/providers/plane/labels.js` - New home for Plane-specific resolveLabels()
- `test/prompt.test.js` - 8 tests validating prompt neutrality and template resolution
- `test/state.test.js` - Updated plane_identifier references to task_ref

## Decisions Made
- resolvePromptTemplate uses three placeholders: {{provider}}, {{provider_name}}, {{mcp_tool}} — sufficient for all prompt variations
- HealthReport field renamed from `identifier` to `ref` for consistency with `session.task_ref` naming convention
- State schema documentation in prompt.md updated to reflect v2 schema (taskId, task_ref, provider field)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 5 phases complete — provider abstraction fully implemented
- No remaining Plane-specific naming in generic modules
- Zero references to src/plane/ or planeId outside src/providers/plane/

---
*Phase: 05-config-cleanup*
*Completed: 2026-04-13*
