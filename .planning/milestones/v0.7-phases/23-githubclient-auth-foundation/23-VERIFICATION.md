---
phase: 23-githubclient-auth-foundation
verified: 2026-05-21T13:00:00Z  # fecha de backfill — bookkeeping retro-audit
status: passed
score: 4/4 success_criteria + 1/1 requirement (GH-01) + 4/4 invariants verified
overrides_applied: 0
goal: "GitHubClient REST wrapper sobre api.github.com con auth PAT, rate-limit awareness, ETag/304 condicional, y error-code canónico — desacoplado del TaskProvider contract, consumible por Phase 24+25."
test_suite:
  baseline_pre_phase_23: 614
  post_wave_1: 617
  post_wave_2: 632
  skipped: 1
  failed: 0
  delta_phase_23: +18
re_verification: false
backfill: true  # bookkeeping doc-only retro-audit per v0.7-MILESTONE-AUDIT.md §Bookkeeping Drift item #2
---

# Phase 23: GitHubClient + Auth Foundation — Verification Report

**Phase Goal (verbatim from v0.7-ROADMAP.md §Phase 23):**
> Existe un cliente REST aislado capaz de hablar con `api.github.com` con auth PAT, conciencia de rate limits y soporte de fetch condicional via etag/304 — sin acoplarse a `TaskProvider`.

**Verified:** 2026-05-21 13:00 GMT+2 (retro-structural backfill — bookkeeping doc-only)
**Status:** PASSED
**Re-verification:** No — initial verification (backfill).
**Backfill justification:** `v0.7-MILESTONE-AUDIT.md` §Bookkeeping Drift item #2 — Phase 23 era la única phase v0.7 sin VERIFICATION.md (4/5 phases tenían el archivo; 23-01-SUMMARY + 23-02-SUMMARY cubrían self-check funcional pero faltaba la pieza estructural uniforme). Backfill por uniformidad documental cross-phase v0.7.
**Methodology:** Evidence-by-SUMMARY (per Plan 32-02 D-04 — no re-execution). Citamos `23-01-SUMMARY.md` + `23-02-SUMMARY.md` como source-of-truth, sin re-correr `npm test`. Formato mirror de `24-VERIFICATION.md` (template más cercano por fecha y estructura).

---

## 1. Goal Achievement — Per Success Criteria

| # | SC                                                                                                | Status   | Evidence                                                                                                                                                                                                                                                                                                                                                              |
| - | ------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | PAT auth via `Authorization: token <GITHUB_TOKEN>` (request centralizado)                         | VERIFIED | `23-02-SUMMARY.md` §Accomplishments: clase `GitHubClient` con constructor + `request()` privado centralizando fetch+auth+timeout+rate-limit+NDJSON+error-mapping. Token recibido vía `getProviderApiKey` (`config.js`); never concatenado a Error.message ni emitido en NDJSON (`Threat Mitigation Coverage` T-23-04).                                                |
| 2 | Rate-limit awareness — `X-RateLimit-Remaining` warn `< 100` + 429 canonical `rate_limit_exceeded` | VERIFIED | `23-01-SUMMARY.md` §Accomplishments: `githubApiCall` switch info→warn cuando `rate_limit_remaining < 100` (D-16 threshold) + `typeof === 'number'` guard defensivo (Pitfall #8). `23-02-SUMMARY.md` §Decisions Made: 403 disambiguation (`X-RateLimit-Remaining:0` OR `Retry-After` presente → `rate_limit_exceeded`). Fixture `rate-limit-exceeded.json` 429 cubierto. |
| 3 | ETag/304 envelope `{status, items, etag, rate_limit_remaining}` en `listIssues`                   | VERIFIED | `23-02-SUMMARY.md` §Decisions Made: "Envelope `{status, items, etag, rate_limit_remaining}` only on `listIssues` 200/304 paths (D-19). Other 4 methods return raw GitHub payloads." Tests cubren 200 path + 304 path + If-None-Match header pass-through (filas 04-06 del verification map 23-02).                                                                     |
| 4 | ≥ 8 tests offline cubriendo verification map rows                                                 | VERIFIED | `23-02-SUMMARY.md` §Accomplishments: **15 tests offline** en `test/providers/github/client.test.js` cubriendo verification map rows 01-10 + 2 extras (info-level NDJSON path, listLabels detail). Runtime fetch-leak guard instalado (D-37 análogo). 15 ≥ 8 — satisfecho con margen.                                                                                   |

---

## 2. Required Artifacts — Three-Level Verification

| Artifact                                            | Exists                                          | Substantive                                                                                              | Wired                                                                                                | Status   |
| --------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------- |
| `src/logger-events.js` (modified Wave 1)            | ✓ +61 lines (per 23-01-SUMMARY key-files)       | ✓ 2 EVENTS entries (`GITHUB_API_CALL` + `GITHUB_API_CALL_FAILED`) + 2 helpers (`githubApiCall` + `githubApiCallFailed`) + JSDoc + header comment | ✓ consumido por `client.js` via `await import('../../logger-events.js')` (LOG-12-safe dynamic) | VERIFIED |
| `src/providers/github/client.js` (created Wave 2)   | ✓ 333 LOC (per 23-02-SUMMARY key-files)         | ✓ class `GitHubClient` + constructor + `request()` privado + 2 helpers (`parseRetryAfter`, `mapErrorCode`) + 5 métodos públicos async + JSDoc | ✓ ready para Phase 24 `createGitHubProvider({token, logger})` (downstream consumer)                  | VERIFIED |
| `test/logger-events.test.js` (modified Wave 1)      | ✓ +62 lines (per 23-01-SUMMARY key-files)       | ✓ destructured import + 15-entry array contract (alphabetical sort) + 3 nuevos `it()` (info/warn/failed) | ✓ canary del taxonomy contract                                                                       | VERIFIED |
| `test/providers/github/client.test.js` (created)    | ✓ 379 lines / 15 `it()` (per 23-02-SUMMARY)     | ✓ 15 tests cubren verification map rows 01-10 + 2 extras + 3 helpers inline (makeFetch/makeSpyFetch/makeSpyLogger) + runtime leak guard | ✓ dynamic import de `client.js`; `opts.fetch` injection en cada `it()`                               | VERIFIED |
| 10 GitHub fixtures en `test/fixtures/github/*.json` | ✓ 10 archivos creados (per 23-02-SUMMARY)       | ✓ issue, issues-list, 304 placeholder, rate-limit-low, rate-limit-exceeded (429), unauthorized (401), forbidden (403), not-found (404), comment-created (201), labels-list — total ~4.5 KB, zero PATs | ✓ importados via ESM JSON desde `client.test.js`                                                     | VERIFIED |

---

## 3. Key Link Verification

| From                                       | To                                          | Via                                                                       | Status                       |
| ------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------- |
| `src/providers/github/client.js`           | `src/logger-events.js`                      | `await import('../../logger-events.js')` (dynamic, LOG-12 pattern)        | WIRED (dynamic)              |
| `src/providers/github/client.js`           | `src/config.js`                             | `import { getProviderApiKey }` (static, no `check.js` impact)             | WIRED                        |
| `src/providers/github/client.js`           | `globalThis.fetch`                          | `opts.fetch ?? globalThis.fetch` constructor DI (D-06)                    | WIRED (injectable)           |
| Wave 1 helpers (23-01)                     | Wave 2 client consumer (23-02)              | `githubApiCall` + `githubApiCallFailed` invocadas dentro de `request()`   | WIRED (intra-phase handoff)  |
| Phase 23 client                            | Phase 24 `createGitHubProvider`             | downstream consumer — verificado por `24-VERIFICATION.md` §Key Link Verification ("`provider.js` → `client.js` via `import { GitHubClient }`") | WIRED (cross-phase verified) |
| `test/providers/github/client.test.js`     | `src/providers/github/client.js`            | dynamic import + per-test `opts.fetch` injection + runtime leak guard      | WIRED                        |

---

## 4. Per-Requirement Coverage Matrix

| Requirement | Source Plan      | Description (resumen)                                                                | Status    | Evidence                                                                                                                |
| ----------- | ---------------- | ------------------------------------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| GH-01       | 23-01 + 23-02    | GitHubClient REST wrapper + PAT auth + rate limit awareness + ETag/304 condicional   | SATISFIED | 15 client tests + 3 logger-events tests + 632 suite total (baseline 614 → +18 Phase 23 delta). Threat mitigations T-23-04/05/07 verified. |

**Per-Requirement Coverage Matrix scope:** SOLO REQ-IDs assignados a Phase 23 per `v0.7-REQUIREMENTS.md` línea 90 (`| GH-01 | 23 | Complete |`). **TEST-01** (línea 103: `| TEST-01 | 24 | Complete |`) está owned por **Phase 24** — su documentación formal vive en `24-VERIFICATION.md`, no aquí. Los 15 client tests offline mencionados en `23-02-SUMMARY` son evidencia contextual de la GH-01 foundation (transport layer), NO una row formal de TEST-01 en esta matriz. Phase 23 owns ÚNICAMENTE GH-01 — esta tabla es de UNA fila por diseño documental v0.7.

**Orphan check:** `v0.7-REQUIREMENTS.md` traceability table asigna GH-01 a Phase 23 con status `Complete` — cubierto por al menos un plan (de hecho dos: 23-01 + 23-02). No ORPHANED requirements para Phase 23.

---

## 5. Invariant Compliance

| Invariant                                                                                          | Status   | Evidence                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LOG-12** — `kodo check` does NOT transitively import `client.js` (stdlib-only logger-events)     | VERIFIED | `23-01-SUMMARY.md` §LOG-12 Invariant Evidence: `node --test test/check-isolation.test.js` 4/4 pass; `src/logger-events.js` importa solo `node:os` + `node:path`. `23-02-SUMMARY.md` §LOG-12 Invariant Evidence: `client.js` usa `await import('../../logger-events.js')` dinámico — `src/check.js` no carga `client.js` transitivamente. |
| **Color isolation** — no `picocolors` imports en provider tree                                     | VERIFIED | `23-02-SUMMARY.md` §Color Isolation Evidence: `grep -rnE "from\s+['\"]picocolors" src/providers/github/ test/providers/github/ test/fixtures/github/` returns 0 lines.            |
| **Zero new deps** — built on Node 20+ `globalThis.fetch` + `AbortSignal` natives                   | VERIFIED | `23-CONTEXT.md` D-04 (globalThis.fetch nativo Node 20+, sin librería HTTP adicional) + `23-02-SUMMARY.md` frontmatter `tech-stack.added: []` + `23-01-SUMMARY.md` frontmatter `tech-stack.added: []`. |
| **TaskProvider contract NOT touched** — Phase 23 es transport-only, no toca `src/interface.js`     | VERIFIED | `23-CONTEXT.md` §Out of scope: Phase 23 NO toca `src/interface.js`; el `TASK_PROVIDER_METHODS` contract es owned por Phase 24 (D-42 — `24-CONTEXT.md`). 23-02-SUMMARY `key-files.modified: []` confirma cero modificaciones a interface.js. |

---

## 6. Behavioral Spot-Checks

Spot-checks derivados de los Self-Check blocks de los 2 SUMMARYs Phase 23 — NO se re-ejecutan (per Plan 32-02 D-04, citamos SUMMARY como evidencia).

| Behavior                                                              | Expected (per SUMMARY)                                                       | Source                                            | Status |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- | ------ |
| `ls src/providers/github/client.js`                                   | exists, 333 lines                                                            | `23-02-SUMMARY.md` §Self-Check                    | PASS   |
| `ls test/providers/github/client.test.js`                             | exists, 379 lines, 15 `it()` tests                                           | `23-02-SUMMARY.md` §Self-Check                    | PASS   |
| `ls test/fixtures/github/*.json \| wc -l`                             | 10 (all JSON-parseable)                                                      | `23-02-SUMMARY.md` §Self-Check                    | PASS   |
| `node --test test/providers/github/client.test.js`                    | 15 pass / 0 fail                                                             | `23-02-SUMMARY.md` §Self-Check                    | PASS   |
| `node --test test/check-isolation.test.js`                            | 4 pass / 0 fail (LOG-12 canary green)                                        | `23-01-SUMMARY.md` + `23-02-SUMMARY.md` Self-Check | PASS   |
| `grep "^import" src/providers/github/client.js`                       | only `getProviderApiKey` static; dynamic-only logger-events                  | `23-02-SUMMARY.md` §LOG-12 Invariant Evidence     | PASS   |
| `grep -E "^import.*from\s+['\"]\.\./\.\./logger\.js" src/providers/github/client.js` | (no output — static logger.js import absent)                       | `23-02-SUMMARY.md` §LOG-12 Invariant Evidence     | PASS   |
| `npm test` post-Phase-23                                              | 631 pass / 1 skipped / 0 fail / 632 total                                    | `23-02-SUMMARY.md` §Full Suite Numbers            | PASS   |

---

## 7. Test Suite Delta

| Wave             | Tests added (Phase 23)        | Files                                       |
| ---------------- | ----------------------------- | ------------------------------------------- |
| Wave 1 (23-01)   | +3 tests (info/warn/failed paths) | `test/logger-events.test.js` (modified)     |
| Wave 2 (23-02)   | +15 tests (verification map rows 01-10 + 2 extras) | `test/providers/github/client.test.js` (new) |
| **Total Phase 23** | **+18 tests on disk**       | —                                           |
| Suite global delta | **+18** (614 → 632)         | Baseline pre-Phase-23 = 614 (per 23-01-SUMMARY); intermedio post-W1 = 617; post-W2 = 632. |

**Skip count:** 1 (preserved — pre-existing skip in unrelated test file). **Fail count:** 0 (steady-state across both waves).

---

## 8. Procedural Deviation Review

### 8a. Plan 23-02 — 3 Rule-1 spec inconsistencies (auto-fixed)

**Reported in:** `23-02-SUMMARY.md` §Deviations from Plan.

**Verification of recovery:**

1. **14 tests claimed → 15 implemented.** Plan `<behavior>` enumerated 15 distinct scenarios (1 constructor + 6 listIssues variants + 4 error mapping + 2 NDJSON level + 3 mutator methods). Implementer chose 15 (covers SC#4 `≥ 8` with margin). Acceptance grep `=== 14` interpreted as `≥ 14`. **Defensible** — internal spec contradiction resolved by following the enumerated list.
2. **`globalThis.fetch` leak guard exception.** Plan acceptance criteria `grep -c "globalThis.fetch" === 0` contradicted plan-level `<critical_reminders>` #4 requiring runtime leak guard install. Implementer followed plan-level explicit reconciliation ("the leak-guard line is ALLOWED"). 5 file occurrences total: 3 comments/docstring, 2 install+restore. **Defensible** — implements the macro requirement.
3. **`kodo-test` fixture count interpretation.** Acceptance criterion `grep -l "kodo-test" >= 7` was inconsistent with the real fixture taxonomy (only 5 fixtures legitimately carry owner/repo data; 5 are pure error bodies). Implementer kept the 5 legitimate references + verbatim error bodies (PII redaction intent satisfied — `grep -l "ghp_\|github_pat_"` returns 0). **Defensible** — preserves real GitHub error response shapes.

**Aggregate verdict:** All 3 deviations resolve internal contradictions in plan text, NOT external scope changes. Zero scope creep. SC#1-4 satisfied per `23-02-SUMMARY.md §Self-Check: PASSED`.

### 8b. Plan 23-01 — Zero deviations

**Reported in:** `23-01-SUMMARY.md` §Deviations from Plan — "None — plan executed exactly as written." The Task 2 acceptance criterion `grep -c "rate_limit_remaining < 100" === 1` was interpreted as satisfied (predicate once in code + once in JSDoc, both plan-mandated). Defensible.

### 8c. Plan 23-03 — Optional, skipped

`23-03-PLAN.md` (capture-github-fixtures.js refresh script) is documented as **optional** in `v0.7-ROADMAP.md` §Phase 23 ("3 plans (23-03 optional, skipped)") and confirmed in `v0.7-MILESTONE-AUDIT.md` §Phase Completion ("2/3 plans, 23-03 optional/skipped"). NOT a gap — explicit out-of-scope decision.

---

## 9. Anti-Pattern Scan (Phase 23-touched src/ files)

| File                                | Pattern checked                                                                  | Match count (per SUMMARY evidence) | Status |
| ----------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------- | ------ |
| `src/providers/github/client.js`    | PAT leakage (Authorization header value into Error.message/NDJSON) — T-23-04     | 0 — `23-02-SUMMARY.md` §Threat Mitigation Coverage row T-23-04 | CLEAN |
| `src/providers/github/client.js`    | SSRF via owner/repo path injection — T-23-05                                     | 10 `encodeURIComponent` calls (5 methods × 2 args) — `23-02-SUMMARY.md` §Threat Mitigation Coverage row T-23-05 | CLEAN |
| `src/providers/github/client.js`    | DoS via fetch hang — T-23-07 — `AbortSignal.timeout(10_000)` present             | 1 occurrence — `23-02-SUMMARY.md` §Threat Mitigation Coverage row T-23-07 | CLEAN |
| `src/providers/github/client.js`    | Retry logic in client (D-11 — must be 0; Phase 25 owns backoff)                  | 0 — `23-02-SUMMARY.md` §key-decisions "Zero retry in client (D-11)" | CLEAN |
| `src/providers/github/client.js`    | Static `from '../../logger.js'` import (LOG-12 forbidden)                        | 0 — `23-02-SUMMARY.md` §LOG-12 Invariant Evidence | CLEAN |
| `src/providers/github/client.js`    | Custom Error subclass (D-12 YAGNI — plain Error + .code/.status/.retryAfter)     | 0 custom subclasses — `23-02-SUMMARY.md` §tech-stack.patterns "Plain Error with .code/.status/.retryAfter properties — no custom Error subclass (D-12 YAGNI)" | CLEAN |
| `src/logger-events.js` (Wave 1)     | Non-stdlib imports (LOG-12 invariant — must remain `node:os` + `node:path` only) | 0 new imports — `23-01-SUMMARY.md` §LOG-12 Invariant Evidence | CLEAN |
| `test/providers/github/client.test.js` | Live network calls (no `opts.fetch` injection)                                | 0 — runtime leak guard installed; `23-02-SUMMARY.md` §Decisions Made "Runtime fetch-leak guard installed" | CLEAN |

No blockers, no warnings, no info-level concerns. Intentional no-ops (zero retry in client, no proactive throttle) are explicit contract decisions (D-11) — NOT stubs.

---

## 10. Human Verification Needs

None. Phase 23 es **pure transport HTTP** — verificable programáticamente por:

- **15 tests offline** con `opts.fetch` injection cubren auth header, rate-limit, ETag/304, error mapping canónico.
- **Runtime fetch-leak guard** detecta cualquier llamada accidental a `globalThis.fetch` (D-37 análogo a Phase 24).
- **LOG-12 canary** (`test/check-isolation.test.js`) verifica que `src/check.js` no carga `client.js` transitivamente.
- **Color isolation grep** (deterministic) verifica zero `picocolors` leak en el árbol provider/github.

No visual UI, no live API en tests, no error-message-clarity UX involved. Suite offline-only.

---

## 11. Outstanding Gaps

**None.** GH-01 — el único requirement de Phase 23 per `v0.7-REQUIREMENTS.md` línea 90 — está SATISFIED. Plan `23-03-PLAN.md` (capture-github-fixtures.js refresh script) documentado como **optional/skipped** en `v0.7-ROADMAP.md` §Phase 23 y `v0.7-MILESTONE-AUDIT.md` §Phase Completion (2/3 plans, 23-03 optional/skipped). NO gap — explicit scope decision.

**Backfill structural note:** Este `23-VERIFICATION.md` cierra el bookkeeping drift item #2 del audit doc — antes de este backfill, Phase 23 era la única phase v0.7 sin VERIFICATION.md (4/5 phases tenían el archivo). Post-backfill: **5/5 phases v0.7 con VERIFICATION.md** — uniformidad documental cross-phase v0.7 conseguida.

---

## 12. Gaps Summary

No gaps. Phase 23 goal "Existe un cliente REST aislado capaz de hablar con `api.github.com` con auth PAT, conciencia de rate limits y soporte de fetch condicional via etag/304 — sin acoplarse a `TaskProvider`" achieved con evidencia verificable en cada nivel (per `23-01-SUMMARY.md` + `23-02-SUMMARY.md`):

1. **Goal-level:** `GitHubClient` class 333 LOC con 5 métodos async + `request()` privado centralizando auth+rate-limit+timeout+NDJSON+error-mapping. Cero acoplamiento al `TaskProvider` contract (`src/interface.js` no tocado — Phase 24 owns ese contract).
2. **Sub-goal A (PAT auth):** `Authorization: token <token>` en cada request via `request()`; token NUNCA concatenado en Error.message ni emitido en NDJSON (T-23-04 mitigated).
3. **Sub-goal B (rate-limit awareness):** `githubApiCall` switch info→warn cuando `rate_limit_remaining < 100` (D-16) + 429 → canonical `rate_limit_exceeded` + 403 disambiguation (`X-RateLimit-Remaining:0` OR `Retry-After` → `rate_limit_exceeded`).
4. **Sub-goal C (ETag/304):** Envelope `{status, items, etag, rate_limit_remaining}` en `listIssues` 200/304 paths (D-19). Phase 25 polling consume el envelope para persistir cursor en `polling-state.json` (downstream contract locked).

**Backfill retroactivo doc-only** per `v0.7-MILESTONE-AUDIT.md` §Bookkeeping Drift item #2 — closing structural uniformity gap (Phase 23 era la única phase v0.7 sin VERIFICATION.md). Post-backfill: 5/5 phases v0.7 con VERIFICATION.md.

---

_Verified: 2026-05-21T13:00:00Z (backfill — bookkeeping retro-audit)_
_Verifier: Claude (gsd-planner Phase 32-02 BOOK-02, evidence-by-SUMMARY per D-04 — no re-execution)_
_Source-of-truth: 23-01-SUMMARY.md + 23-02-SUMMARY.md + v0.7-MILESTONE-AUDIT.md_
_Path canonical: `23-VERIFICATION.md` (prefijado) — alineado con archive pattern v0.7 (24/25/26/27). ROADMAP SC#2 wording suelto sin prefijo no constituye mismatch real._
