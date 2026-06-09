---
phase: 40
slug: provider-state-contrato-providers-enrichment
status: verified
threats_open: 0
asvs_level: 2
created: 2026-06-04
---

# Phase 40 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register source: PLAN.md `<threat_model>` blocks (40-01, 40-02). `register_authored_at_plan_time: true` — mitigations verified against implementation, no blind rescan.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| provider API → adapter | Plane `state_detail.name`/`group` and GitHub label `name` are untrusted, provider-controlled strings crossing into kodo's normalization layer | provider-controlled strings (state names, label names) |
| session state → provider client | `task_id`/`task_ref`/`project_id` from the session record address an outbound HTTP fetch (`getWorkItem`/`getIssue`) | session identifiers (low sensitivity) |
| resolver failure → NDJSON log | a `getTaskState` rejection produces a `provider.state.fetch.failed` event whose `error` field could carry provider response text | error message string |
| /status response → dashboard clients | `provider_state` / `provider_state_reason` are new additive fields consumed downstream (Phase 43) | normalized state literal (closed vocabulary) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-40-01 | Denial of Service (ReDoS) | mapPlaneState / mapGithubLabels over provider strings | mitigate | `String.includes` case-insensitive only; zero `RegExp`/`.match`/`.test` over provider input — `src/providers/plane/provider.js:71-73`, `src/providers/github/provider.js:108-111` (D-10/D-11) | closed |
| T-40-02 | Information disclosure | normalized return value of getTaskState | mitigate | Returns only the 5-literal vocab (`in_progress|in_review|blocked|done|unknown`), never the raw name/label — `plane/provider.js:70-86`, `github/provider.js:107-112`; contract matrix asserts `PROVIDER_STATE_VOCAB` membership — `test/providers/contract.test.js:384-389, 498-505` | closed |
| T-40-03 | Tampering / SSRF | getWorkItem outbound fetch | accept | ids derive from the session record, same client boundary as `getTask` — `plane/provider.js:237`. No new URL surface. See Accepted Risks. | closed |
| T-40-04 | Information disclosure | provider.state.fetch.failed `error` field | mitigate | Explicit whitelist `{task_id, provider, error}`, no `...fields` — `src/logger-events.js:642-649`; resolver passes `err.message` only, never the full error/response object — `src/server/provider-state.js:106-110` (D-15) | closed |
| T-40-05 | Denial of Service (N+1 fan-out) | per-poll getTaskState fan-out | mitigate | task_id-keyed `Map` cache (TTL = injected `PENDING_CACHE_TTL_MS`) + in-flight `Map<task_id, Promise>` dedup — `src/server/provider-state.js:64-67, 84-93`; exactly-once tests — `test/server/provider-state.test.js:90-100, 114-130` (D-02/D-03/D-04) | closed |
| T-40-06 | Tampering (lifecycle coupling) | provider_state coupling to lifecycle | mitigate | Resolver's sole import is `../logger-events.js`, no `saveState`/`state.js` — `src/server/provider-state.js:21`; `/status` wiring spread-additive, does not touch `alive`/`elapsed_min` — `src/server.js:409-429` | closed |
| T-40-07 | Denial of Service (one error 500s /status) | /status enrichment fan-out | mitigate | `Promise.allSettled` (zero bare `Promise.all(`) — `src/server.js:409`; rejected rows collapse to `provider_state_reason:'fetch-failed'`, response stays 200 — `src/server.js:420-429` | closed |
| T-40-08 | Tampering / SSRF | getIssue outbound fetch | accept | GitHub `getTaskState({ref})` reuses the existing `getTask(ref)→getIssue` single fetch — `src/providers/github/provider.js:177-180`. Inherited boundary. See Accepted Risks. | closed |
| T-40-SC | Tampering (supply chain) | npm/pip/cargo installs | accept | Phase diff (`8619ea5..4f34608`) touches no `package.json`; `tech-stack.added: []` in both SUMMARYs. Zero dependencies added. See Accepted Risks. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

### Defense-in-depth verifications (declared invariants)

- `TASK_PROVIDER_METHODS` FROZEN at 9 — `getTaskState` absent from the array (`src/interface.js:52-62`). Optional method detected via `typeof === 'function'` capability gate at both the resolver (`provider-state.js:78`) and the contract matrix (`contract.test.js:499`).
- `EVENTS.PROVIDER_STATE_FETCH_FAILED` registered in BOTH the `@type` JSDoc (`logger-events.js:50`) and the `Object.freeze` registry (`logger-events.js:76`).
- Resolver `unsupported` (permanent) vs `fetch-failed` (transient) distinction present; unsupported path emits zero events (`provider-state.test.js:54-64`).

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-40-01 | T-40-03, T-40-08 | `getTaskState` issues outbound HTTP via the SAME provider client (`getWorkItem`/`getIssue`) already used by `getTask`/`listComments`. Task ids/refs derive from the existing session record — no new URL surface, no new attacker-controllable id source. Risk inherited from the pre-existing provider-client boundary; no new mitigation in scope. | Alex Núñez | 2026-06-04 |
| AR-40-02 | T-40-SC | Phase adds zero dependencies; no install step. No package-legitimacy gate required. | Alex Núñez | 2026-06-04 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-04 | 9 | 9 | 0 | gsd-security-auditor (ASVS 2, verify-mitigations mode) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-04
