# Milestones

## v0.2 Provider Abstraction (Shipped: 2026-04-13)

**Phases completed:** 5 phases, 10 plans, 0 tasks

**Key accomplishments:**
- TaskProvider interface (9 methods) with canonical TaskItem/TriggerEvent shapes — any adapter just implements the contract
- PlaneProvider adapter with normalizer, HMAC-SHA256 verification, and label resolution behind the interface
- Provider registry with factory functions, lazy init, and singleton caching
- All 4 internal consumers (check, stop, manager, session-start) rewired to TaskProvider — zero PlaneClient imports outside adapter
- Central dispatchTrigger + pure handleWebhookRequest extracted from server.js — server is now a slim HTTP shell
- Provider-agnostic config wizard, ensureConfig guard, and orchestrator prompt with {{provider}} placeholders
- 122 tests, 4,650 LOC JavaScript (1,868 LOC tests), 28/28 requirements satisfied

---

