---
phase: 69
slug: red-y-autenticacion
status: draft
shadcn_initialized: false
preset: none
created: 2026-07-06
---

# Phase 69 — UI Design Contract

> Visual and interaction contract for a **backend/security hardening** phase. The UI surface is deliberately minimal: this phase adds exactly **one new visual state — the 401 "unauthorized" state — to two existing surfaces** (the Ink TUI dashboard and the embedded web dashboard), plus the token-passing interaction. No new screens, palettes, or component systems are introduced. All tables below **document existing tokens** (source of truth) so the executor reuses them verbatim.

---

## Scope Boundary (read first)

**In scope for this contract:**
1. **Ink TUI dashboard** (`src/cli/dashboard/`) — the 401 "unauthorized" state (copy + color + behavior), surfaced through the shared bearer helper on `client.js`, following the never-throws / visible-degradation pattern (D-07, D-08). Never a silent empty screen.
2. **Embedded web dashboard** (`GET /` and `/dashboard` in `src/server.js`) — the `?token=` passing interaction, the inline-JS bearer attachment on its 4 fetches, and the unauthenticated 401 behavior (D-05).

**Out of scope (do NOT touch):** the existing session table, overlays, config editor, badges, layout, palette, spacing, typography. This phase does not restyle anything. The auth changes are additive states on top of the v0.14/v0.15 dashboard.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (Node CLI + TUI; not a shadcn/React web app) |
| Preset | not applicable |
| Component library | **ink** (`<Box>`/`<Text>`) for the TUI dashboard · raw HTML template string for the embedded web dashboard (both pre-existing) |
| Icon library | Unicode glyphs only (`●` live, `⚠` degraded) — no icon font/library |
| Font | Terminal font for the TUI (inherited from user's terminal). Web dashboard: monospace stack `'SF Mono', 'Cascadia Code', 'Fira Code', monospace` (existing, `server.js` `<style>`) |

**Color-isolation invariant (D-12, LOCKED):** in the Ink dashboard, ALL color comes exclusively from ink `<Text color="…">` named colors. `client.js` and the data layer must NOT import `picocolors` or any color module. `test/format-isolation.test.js` enforces this via an automated walker. The 401 state MUST respect this — its color is an ink named color on a `<Text>`, nothing else.

---

## Spacing Scale

The two surfaces use different layout models. Neither uses an 8-point px scale for the TUI, so this documents the **existing** conventions; do not introduce new spacing.

**Ink TUI:** character-cell layout via ink `<Box>` (`marginTop`, `marginLeft`, `padding` in terminal cells, typically `1`). The 401 banner reuses the existing degradation-banner box (same `<Box>` row as `⚠ server caído`), so it inherits its spacing — **no new box geometry**.

**Web dashboard (existing px tokens, `server.js` `<style>`):**

| Token | Value | Usage |
|-------|-------|-------|
| card padding | 16px | `.card` interior |
| body padding | 24px | page gutter |
| section gaps | 12px / 20px | `.subtitle` / `h1` bottom margin |
| item padding | 10px | `.session` / `.pending-item` rows |
| small gaps | 4px / 6px / 8px | badge/label internal gaps |

Exceptions: none new. The 401 web response reuses no card geometry (it is a bare neutral 401, see Copywriting Contract).

---

## Typography

Documents existing values only; this phase adds no new type roles.

**Ink TUI:** monospace terminal cells; emphasis via ink `<Text>` props (`color`, `dimColor`, `bold`, `inverse`) — no font sizes. The 401 copy renders as a single `<Text>` line in the degradation banner register (same weight/size as `⚠ server caído`).

**Web dashboard (existing px, `server.js` `<style>`):**

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Stat value | 28px | 700 | default |
| H1 (title) | 14px | default | default |
| Title / body | 12px | default | default |
| Meta / card h2 / badges | 10–11px | 400 (600 for `.ref`/`.comment-actor`) | default |

---

## Color

Documents the **existing** palette. The 401 state introduces NO new color — it reuses colors already in the semantic set.

### Ink TUI — existing named-color semantics (ink `<Text color>`)

| Role | ink color | Reserved for |
|------|-----------|--------------|
| Neutral / transitional | `dimColor` | `waiting for server`, deriving spinner |
| Degraded (reachable, not OK) | `yellow` | `⚠ server caído` degradation banner, save/restart notices |
| Error / fatal-to-action | `red` | footer errors, `stuck`/`dead` states |
| Healthy | `green` | `● live`, `done` |
| Armed prompt (reserved) | `cyan` | armed-prompt only — do NOT use for the 401 state |

**401 state color decision:** render the unauthorized banner with **`yellow`** and the existing `⚠` glyph, joining the same "server reachable but not serving data" degradation family as `⚠ server caído` (the server IS up; it is rejecting the request — a keep-degraded-visible condition, not a transient network drop and not the `cyan` reserved lane). Using `red` is acceptable only if the executor finds the state reads as a hard error in context; **`yellow` is the recommended default** for family consistency. This is the one genuinely cosmetic choice → implementer discretion, bounded to `{yellow (recommended), red}`, never `cyan`/`green`.

### Web dashboard — existing palette (`server.js` `<style>`)

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#0a0a0a` | page background, logs box |
| Secondary (30%) | `#141414` surface + `#222`/`#1a1a1a` borders + `#e0e0e0` text | cards, rows, dividers |
| Accent (10%) | `#f59e0b` (amber) | see reserved list |
| Destructive / error | `#ef4444` (red) | `stuck`/`dead`/`gone` badges, `.log-line.error`, danger button hover |
| Info | `#60a5fa` (blue) | `review` badge |
| Success | `#22c55e` (green) | `done` badge, live `.dot` |

Accent reserved for: **work-item refs/links (`.ref`), the `running` badge, stat values (`.stat-val`), the `h1 span` keyword highlight, and the comment actor (`.comment-actor`)** — this is the existing reservation; do not extend amber to other elements, and do not introduce a new accent for the auth work.

---

## Copywriting Contract

The 401 copy is the **core deliverable** of this contract. Following the Phase 37 D-05 pattern, the Ink 401 message MUST be an **exported, literal-stable constant** in `App.js` (register: terse, lowercase, matching `⚠ server caído` / `waiting for server`).

| Element | Copy |
|---------|------|
| Primary CTA | none new — this phase adds no button/action. The user's "next action" on 401 is a remediation hint (see Error state), not a control. |
| Empty state (unchanged) | existing `waiting for server` (never had good data) / `⚠ server caído` + `N sessions (last update Ns ago, retrying…)` (keep-last-good). Do not alter. |
| **Error state — Ink 401 (NEW)** | `⚠ no autorizado — revisa KODO_API_TOKEN` — problem (unauthorized) + solution path (check the token). Lowercase to match the existing register; D-08 wrote it capitalized ("No autorizado — revisa KODO_API_TOKEN"), lowercase is preferred here for consistency with `⚠ server caído`. Export as a named constant (e.g. `UNAUTHORIZED_MESSAGE`). MUST render — never a silent empty screen (D-08). |
| **Error state — web dashboard 401 (NEW, in-card)** | when an inline fetch (`/status`, `/logs`, `/comments`, `/sessions`) returns 401 mid-session (e.g. token revoked), show a visible line in the affected card using `.log-line.error`/`#ef4444` styling, e.g. `no autorizado — revisa KODO_API_TOKEN`. Never a silent empty card. Exact wording = discretion; must be visible + name the token. |
| **Unauthenticated web request (NEW)** | `GET /` and `/dashboard` without a valid `?token=` return **HTTP 401 with the neutral body `{"error":"unauthorized"}`** — the same neutral response as the API rail. Do NOT leak the dashboard HTML shell, and do NOT echo any server internals. A friendlier styled HTML 401 hint page is explicitly **out of scope** (would add surface); the neutral JSON 401 is the contract. |
| Destructive confirmation (unchanged) | `DELETE /sessions/:id` (dismiss) keeps its existing confirm flow. New behavior: the request now carries the bearer; on 401 it degrades to the unauthorized state above, not a crash. No new confirmation copy. |

**500 neutral (server-wide, NET-04):** all `5xx` bodies are the fixed neutral `{"error":"internal error"}`; `err.message` goes to the log only. This is a response-body copy contract even though it is not a visual component — the UI must never surface raw `err.message`.

---

## Interaction Contract (auth-specific)

| Interaction | Contract |
|-------------|----------|
| Ink bearer attachment (D-07) | A single `makeAuthedFetch(token)` wrapper injects `Authorization: Bearer <token>` for ALL dashboard requests; `client.js` function signatures do NOT change (they receive a pre-authed `fetchFn`). One read of the token, no duplication. |
| Ink 401 surfacing (D-07/D-08) | `fetchStatus` (and siblings) must let the dashboard **distinguish a 401 from a generic failure** — surface a discriminant (mirror the existing `fetchComments` `code` discriminant, e.g. `code: 'unauthorized'`) rather than collapsing 401 into the generic `HTTP 401` string. App.js renders the dedicated `UNAUTHORIZED_MESSAGE`. Still never-throws. |
| Web token passing (D-05) | Initial navigation carries `/?token=<token>`; the guard validates the query param for `/` and `/dashboard` only. The inline JS reads the token once (`const TOKEN = …`) and an inline `authedFetch` adds `Authorization: Bearer` to all 4 fetches. Query-param tokens are used ONLY for these two HTML routes — never for the API rail. |
| Token never rendered (PERSIST-04) | The token value must NEVER appear in visible page text, TUI output, logs, or the `auth token: ENABLED` line. It exists only in the `?token=` URL, the `Authorization` header, and the inline `TOKEN` binding. (The `?token=` URL-bar exposure is the documented, accepted tradeoff.) |
| `/health` unchanged (D-08) | `/health` stays open (no bearer). `kodo up` readiness probes and `kodo status` (PID liveness) do not change and show no auth UI. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| none | none — no shadcn, no third-party registry, zero new npm dependencies (cross-milestone invariant) | not applicable |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
