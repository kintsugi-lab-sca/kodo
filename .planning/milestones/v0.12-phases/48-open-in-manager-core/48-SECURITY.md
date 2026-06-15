---
phase: 48-open-in-manager-core
audited: 2026-06-12
auditor: gsd-security-auditor
register_authored_at_plan_time: true
status: secured
threats_total: 10
threats_closed: 10
threats_open: 0
accepted_risks: 1
unregistered_flags: 3
---

# Security Audit — Phase 48: open-in-manager-core

**Audited:** 2026-06-12
**Auditor:** gsd-security-auditor (adversarial / verification stance)
**Register origin:** authored at plan time (`register_authored_at_plan_time: true`)
**Verdict:** SECURED — 10/10 closed (`threats_open: 0`)

The plan-time register (T-48-01..T-48-09) is fully verified in code. One post-planning
candidate threat (T-48-10, from 48-REVIEW.md WR-01, on `src/server.js` which this phase
modified) was adjudicated as a **real OPEN threat in scope** (severity High) and **was
remediated in this same session** — see the resolution under T-48-10 below. Re-audit closed it.

---

## Threat Verification (plan-time register)

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-48-01 | Information Disclosure / Tampering | mitigate | CLOSED | `src/providers/plane/normalize.js:72-73` `identifierUnresolved = !context.projectIdentifier \|\| === 'UNKNOWN'`; `:89-91` `url: identifierUnresolved ? undefined : ...`. `ref` (`:66`) keeps `${projectIdentifier}-${sequence_id}` (human slug + seq, never UUID). |
| T-48-02 | Spoofing | accept | CLOSED | See "Accepted Risks" below. `web_url` operator-controlled local config; defense-in-depth allowlist verified in open.js. |
| T-48-03 | Tampering (downstream) | mitigate | CLOSED | Any URL produced by normalize is re-validated by the http(s) allowlist in `src/cli/dashboard/open.js:90-99` before `execFile`. normalize itself launches nothing. |
| T-48-04 | EoP / Tampering | mitigate | CLOSED | `src/cli/dashboard/open.js:104` `exec(binary, [url], ...)` — single literal argv element; no shell, no `shell:true`, no `exec()` string. |
| T-48-05 | Tampering (flag injection) | mitigate | CLOSED | `open.js:90-95` `new URL(url)` inside try; `:96-99` `protocol !== 'http:' && !== 'https:'` → `BAD_PROTOCOL` returned WITHOUT calling exec. Rejects `-a`, `file://`, `javascript:`, empty, garbage. Verified by `test/dashboard/open.test.js` adversarial matrix (exec call-count 0). |
| T-48-06 | DoS (never-throws) | mitigate | CLOSED | `open.js:84-128` every failure (parse throw, ENOENT, NON_ZERO_EXIT, sync throw) resolves `{ok:false}`; only the structural leak-guard TypeError (`:78-83`) throws, deliberately before the Promise. 5s `timeoutMs` (`:74`). No throw reaches React. |
| T-48-07 | Information Disclosure | mitigate | CLOSED | `src/cli/dashboard/App.js:586-590` `if (!row.task_url)` short-circuits to bare footer; `onOpen` never invoked with falsy arg (`:591` runs only past the guard). |
| T-48-08 | Tampering / EoP (real binary) | mitigate (verify) | CLOSED | HUMAN-UAT step 4 APPROVED (`48-03-SUMMARY.md:46-47`): non-http(s) `task_url` opens no tab/app against the real `open` binary. Backed by code at open.js:90-99. |
| T-48-09 | DoS (real launch) | mitigate (verify) | CLOSED | HUMAN-UAT steps 1-2 APPROVED (`48-03-SUMMARY.md:41-45`): never-throws / alt-screen survival against real fire-and-forget launch; panel stays mounted, scrollback restored. |
| T-48-SC | Tampering (installs) | n/a | CLOSED | No package installs in any plan; `tech-stack.added: []` in all three SUMMARYs. Node built-ins + existing deps only. |

End-to-end webUrl threading verified (T-48-01 chain integrity):
`config.providers.plane.web_url` → `registry.js:41` `webUrl: plane.web_url ?? plane.base_url`
→ `provider.js:9` typedef + `:172-173` (getTask) + `:274-275` (listPendingTasks)
→ `normalize.js:78` `browseHost = context.webUrl ?? context.baseUrl`. The one-line fix is not inert.

---

## T-48-10 — Dashboard HTML renders `task_url` as `<a href>` without the http(s) allowlist

| Field | Value |
|-------|-------|
| Category | Tampering / XSS (DOM, javascript:-scheme) |
| Component | `src/server.js` renderSession / renderPending / renderHistory |
| Disposition | mitigate |
| Status | **CLOSED — remediated 2026-06-12** |
| Severity | **High** (stored-config / provider-data → script execution in dashboard origin) |
| Source | 48-REVIEW.md WR-01 (post-planning, on code this phase modified) |

**RESOLUTION (2026-06-12):** Implemented the auditor-specified mitigation in `src/server.js`:
- `safeHref(url)` helper (`src/server.js`, next to `escapeHtml`) — http(s) allowlist via
  `new URL()` inside try, returns the url only for `http:`/`https:` else `null`. Exact mirror of
  the TUI rail's allowlist (`open.js:90-99`).
- `refAnchor(url, ref)` shared helper applied at all three render sites (renderSession,
  renderPending, renderHistory): renders `<a … rel="noopener noreferrer">` only when `safeHref`
  passes, else the plain-text `<span class="ref">` branch. A `javascript:`/`data:` `task_url` now
  falls back to the span — no clickable script vector. `rel="noopener noreferrer"` also closes the
  secondary reverse-tabnabbing flag on the `target="_blank"` anchors.
- Full suite green post-fix (1279 pass + 1 skip + 0 fail); no test relied on the old anchor markup.

The asymmetry that defined the threat (TUI rail guarded, HTML rail not) is now eliminated — both
rails gate the same `task_url` through an identical http(s) allowlist.

**Adjudication — IN SCOPE and REAL:**

This phase added an http(s) protocol allowlist to the TUI rail (`open.js:90-99`, T-48-05)
for the `task_url` data flow, and this phase **modified `src/server.js`** (48-01 auto-fix to
`renderPending`, recorded in `48-01-SUMMARY.md:99-104`). The symmetric HTML rail renders the
**same** `task_url` / `t.url` as a clickable anchor with **no protocol validation**:

- `src/server.js:206-207` (renderSession): `'<a class="ref" href="' + escapeHtml(s.task_url) + '" target="_blank">...'`
- `src/server.js:261-263` (renderPending): `'<a class="ref" href="' + escapeHtml(t.url) + '" target="_blank">...'`
- `src/server.js:277-278` (renderHistory): `'<a class="ref" href="' + escapeHtml(s.task_url) + '" target="_blank">...'`

`escapeHtml` (`src/server.js:159-161`) only replaces `& < > " '`. A `javascript:alert(document.cookie)`
URL contains none of those, so it survives intact inside the `href` attribute:
`<a class="ref" href="javascript:alert(document.cookie)" target="_blank">`. A click executes
script in the dashboard origin.

The source of `task_url` is `web_url`/`base_url` (operator config) plus Plane work-item data —
the exact "mostly trusted" surface the TUI rail (open.js header comment) chose to guard. The
phase added the guard on one rail and left the symmetric one uncovered. This is not a
pre-existing-and-untouched surface: 48-01 edited the renderPending anchor branch, so the rail
is within this phase's blast radius.

**Severity rationale (High):** the protocol-injection vector requires `task_url` to carry a
non-http(s) scheme. The TUI rail treated that same scenario as worth a hard guard (T-48-05),
and WR-03 (review) documents a concrete data-path (`migrateConfig` with missing `base_url`)
that yields a broken/attacker-influenceable `task_url`. Disposition asymmetry on the same datum
is the defining gap. Not Critical only because exploitation needs a tainted config/provider
field plus an operator click, not a remote unauthenticated request.

**Required mitigation (do NOT patch implementation here — escalate to plan-gap closure):**

1. Apply the same http(s) allowlist before emitting the anchor in all three render sites. A
   shared `safeHref(url)` helper that returns the URL only for `http:`/`https:` (else falls
   back to the `<span class="ref">` plain-text branch already used for the no-url case):
   ```js
   function safeHref(url) {
     try { const p = new URL(url); return (p.protocol === 'http:' || p.protocol === 'https:') ? url : null; }
     catch { return null; }
   }
   ```
   Gate each anchor on `safeHref(s.task_url)` / `safeHref(t.url)`; on null, render the existing
   `<span class="ref">` branch.
2. Add `rel="noopener noreferrer"` to every `target="_blank"` anchor (reverse-tabnabbing —
   secondary, same fix).

Tracking note: 48-REVIEW.md WR-03 (`migrateConfig` propagating `web_url: undefined` →
`"undefined/.../browse/..."`) is the concrete upstream that feeds a malformed `task_url` into
this anchor; closing T-48-10 should be coordinated with WR-03 hardening.

---

## Accepted Risks

| Threat ID | Risk | Rationale | Defense in depth |
|-----------|------|-----------|------------------|
| T-48-02 | Malicious `plane.web_url` in local config could spoof the browse host | `web_url` is operator-controlled local config in `~/.kodo/config.json`, same trust level as the existing `base_url`. A hostile local config is out of the threat scope for this milestone. | The TUI launcher still enforces the http(s) allowlist on whatever URL is produced (`open.js:90-99`); a non-http(s) `web_url` is rejected at launch time. NOTE: this defense-in-depth does NOT extend to the HTML rail — see T-48-10. |

---

## Unregistered Flags (new attack surface, not a blocker)

`## Threat Flags` sections were not present in the SUMMARY files; new surface was instead
detected by the phase code review (48-REVIEW.md). Mapping:

| Review finding | Maps to | Classification |
|----------------|---------|----------------|
| WR-01 | T-48-10 (this audit) | Promoted to OPEN threat — BLOCKER (above) |
| WR-02 (`config.providers.plane` no optional-chaining → TypeError in factory) | none | unregistered_flag — robustness, not a declared mitigation gap. Factory `registry.js:32` lacks the `?.` its github twin (`:66`) uses. Informational. |
| WR-03 (`migrateConfig` propagates `web_url: undefined` → `"undefined/.../browse"`) | feeds T-48-10 | unregistered_flag — data-integrity defect that produces a malformed `task_url`; coordinate with T-48-10 fix. |
| WR-04 (`migrateConfigIfNeeded` non-atomic disk write → silent config loss) | none | unregistered_flag — availability/integrity of operator config; not a Phase-48 declared mitigation. Informational. |
| IN-01..IN-04 | none | Informational (logging channel, style, label heuristic, comment density). No security disposition. |

None of WR-02/WR-03/WR-04 are declared plan-time mitigations, so they are logged as
unregistered flags, not blockers — except WR-03 which is called out as the upstream of the
BLOCKER T-48-10.

---

## Disposition Summary

- Closed: 10/10 (T-48-01..09 + T-48-SC verified in code; T-48-10 remediated this session)
- Open (BLOCKER): 0
- Accepted risks logged: 1 (T-48-02)
- Unregistered flags: 3 (WR-02, WR-03, WR-04) + 4 informational (IN-01..04)

**Both rails secured.** The TUI rail (open-in-manager `o` key) and the dashboard HTML rail now
gate `task_url` through an identical http(s) allowlist. `threats_open: 0`.

## Audit Trail

| Date | Event |
|------|-------|
| 2026-06-12 | Initial audit (State B, from artifacts). Plan-time register T-48-01..09 + T-48-SC verified CLOSED in code. T-48-10 (from review WR-01) adjudicated OPEN/High, in scope. |
| 2026-06-12 | T-48-10 remediated: `safeHref`/`refAnchor` http(s) allowlist + `rel="noopener noreferrer"` added to all 3 `src/server.js` render sites. Suite green. Re-audit → SECURED, `threats_open: 0`. |

## Follow-up (non-blocking, tracked)

- **WR-03** (`migrateConfig` propagates `web_url: undefined` → malformed `task_url`) — the concrete
  upstream that can taint the anchor; the allowlist now neutralizes the XSS regardless, but
  hardening `migrateConfig` removes the malformed-url source. Candidate for a future polish/gap.
- **WR-02** (`registry.js` missing optional chaining → TypeError) and **WR-04** (non-atomic config
  write) — robustness flags from the review, no security disposition. Logged in 48-REVIEW.md.
