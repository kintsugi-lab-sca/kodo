# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v0.2 — Provider Abstraction

**Shipped:** 2026-04-13
**Phases:** 5 | **Plans:** 10 | **Tasks:** 20

### What Was Built
- TaskProvider interface (9 methods) as the universal contract for task management systems
- PlaneProvider as first validated adapter with normalizer, HMAC, and label resolution
- Provider registry with lazy init and singleton caching
- All 4 internal consumers rewired from PlaneClient to TaskProvider
- Central dispatchTrigger + pure handleWebhookRequest replacing monolithic server
- Provider-agnostic config wizard, ensureConfig guard, and orchestrator prompt templates

### What Worked
- **TDD with pure helper extraction:** Every consumer was testable without mock.module by extracting pure functions with DI parameters. This pattern was established in Phase 3 and carried through Phase 4-5 without friction.
- **Wave-based execution:** Sequential waves (2 plans per phase) kept dependencies clean. No plan ever failed due to missing prerequisites from a prior wave.
- **Small plans, fast execution:** Each plan had exactly 2 tasks, averaging 3 minutes of execution. The entire milestone's 10 plans executed in ~30 minutes of agent time.
- **Verification at every phase:** Phase-level verification caught the INTF-01 docs inconsistency and CONF-03 cosmetic issue early, preventing them from becoming milestone blockers.

### What Was Inefficient
- **Roadmap progress tracking drift:** The ROADMAP.md progress table and plan checkboxes didn't stay in sync — some phases showed "In Progress" or wrong plan counts at milestone completion. The execution agents updated STATE.md but ROADMAP.md checkboxes lagged.
- **Performance metrics in STATE.md:** The velocity/trend section remained empty placeholders despite plans completing. The gsd-tools `roadmap update-plan-progress` didn't populate these fields.

### Patterns Established
- **Pure helper + DI deps pattern:** `function doWork(input, deps = { getProvider, listSessions, ... })` — default production deps, test injects mocks
- **Provider-specific code lives in `src/providers/<name>/`:** Generic modules never import from a provider directory
- **Template placeholders for provider references:** `{{provider}}`, `{{provider_name}}`, `{{mcp_tool}}` in any user-facing text
- **ensureConfig guard on CLI commands:** Commands that need a provider call ensureConfig() first, auto-launching the wizard on first run

### Key Lessons
1. **2-task plans execute faster and more reliably than larger plans.** Every plan in v0.2 had exactly 2 tasks and none failed. The overhead of more plan files is negligible compared to the reliability of smaller atomic units.
2. **Phase verification is cheap and catches real issues.** The verifier agent runs in ~2 minutes and caught documentation inconsistencies that the audit later confirmed. Without it, these would have been discovered at audit time (more expensive to fix).
3. **State migration should clear incompatible data, not try to translate it.** The decision to wipe v1 sessions instead of migrating them per-field was validated — no corruption, no edge cases, clean break.

### Cost Observations
- Model mix: executor agents on inherit (opus), verifier on sonnet, integration checker on sonnet
- 10 executor sessions + 5 verifier sessions + 1 integration checker = 16 agent sessions
- Notable: Each executor averaged ~65k tokens and 67 tool uses — consistent across all 10 plans

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Plans | Phases | Key Change |
|-----------|-------|--------|------------|
| v0.2 | 10 | 5 | Established TDD + pure helper extraction pattern |

### Cumulative Quality

| Milestone | Tests | LOC (src) | LOC (test) |
|-----------|-------|-----------|------------|
| v0.2 | 122 | 2,782 | 1,868 |

### Top Lessons (Verified Across Milestones)

1. Small plans (2 tasks) execute reliably — zero failures across 10 plans
2. Pure helper extraction + DI > mock.module for Node.js test runner compatibility
