---
phase: 05-config-cleanup
plan: 01
subsystem: config
tags: [cli, wizard, provider-agnostic, api-key, interface]

requires:
  - phase: 02-consolidation
    provides: Provider registry and TaskProvider interface
  - phase: 04-server-trigger
    provides: Provider-agnostic dispatch and server abstraction
provides:
  - listProjects method in TaskProvider interface (9 methods total)
  - getProviderApiKey(name) generic API key resolution
  - Provider-agnostic config wizard with connection validation
  - ensureConfig() first-run guard for CLI commands
affects: [05-config-cleanup]

tech-stack:
  added: []
  patterns: [provider-first wizard flow, ensureConfig guard pattern]

key-files:
  created: []
  modified:
    - src/interface.js
    - src/config.js
    - src/cli.js
    - src/providers/plane/provider.js
    - test/interface.test.js
    - test/migration.test.js

key-decisions:
  - "Provider selection as first wizard step — extensible to future providers"
  - "getProviderApiKey reads api_key_env from config.providers[name] — no hardcoded env var names"
  - "ensureConfig guards check/launch/start/status but not help/version/config"
  - "Deprecated getPlaneApiKey as thin wrapper for backward compat"

patterns-established:
  - "ensureConfig guard: commands requiring provider config auto-launch wizard on first run"
  - "Provider-first wizard: select provider, then ask provider-specific questions, validate, list projects"

requirements-completed: [CONF-01, CONF-02, CONF-03]

duration: 3min
completed: 2026-04-13
---

# Phase 05 Plan 01: Config Wizard & API Key Summary

**Provider-agnostic config wizard with listProjects interface method and generic getProviderApiKey resolution**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-13T11:19:16Z
- **Completed:** 2026-04-13T11:22:30Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Extended TaskProvider interface with listProjects (9 methods), implemented in PlaneProvider
- Added getProviderApiKey(name) to config.js replacing hardcoded getPlaneApiKey
- Rewrote CLI wizard to be provider-agnostic: selects provider first, validates connection, lists remote projects
- Added ensureConfig() guard to check/launch/start/status commands for first-run experience

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend TaskProvider interface + generic getProviderApiKey** - `763d055` (feat, TDD)
2. **Task 2: Rewrite config wizard + first-run auto-wizard guard** - `dcc01a5` (feat)

## Files Created/Modified
- `src/interface.js` - Added listProjects to TaskProvider typedef and TASK_PROVIDER_METHODS
- `src/config.js` - Added getProviderApiKey(name), deprecated getPlaneApiKey
- `src/cli.js` - Provider-agnostic wizard, ensureConfig guard, removed PlaneClient import
- `src/providers/plane/provider.js` - Implemented listProjects() delegating to PlaneClient
- `test/interface.test.js` - Updated to expect 9 methods
- `test/migration.test.js` - Added getProviderApiKey tests

## Decisions Made
- Provider selection as first wizard step for extensibility
- getProviderApiKey reads api_key_env from provider config section (no hardcoded names)
- ensureConfig guards provider-dependent commands; help/version/config work without config
- Kept getPlaneApiKey as deprecated wrapper for backward compatibility

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Config layer is now provider-agnostic
- Ready for plan 05-02 (remaining Plane-specific cleanup)

---
*Phase: 05-config-cleanup*
*Completed: 2026-04-13*
