---
phase: 14
slug: cli-format-foundation
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-06
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> **Reconstructed from artifacts** (post-execution audit) — Phase 14 already
> shipped green; this document closes the Nyquist loop by mapping every
> requirement / SC to its automated verification.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (Node.js built-in test runner) |
| **Config file** | none — `package.json#scripts.test` only |
| **Quick run command** | `node --test test/format.test.js test/format-isolation.test.js test/version-smoke.test.js` |
| **Full suite command** | `npm test` (= `node --test test/**/*.test.js`) |
| **Estimated runtime** | ~0.3 s (Phase 14 subset, 46 tests) · ~6 s (full suite, 458 tests) |

---

## Sampling Rate

- **After every task commit:** Run focused subset (e.g. `node --test test/format.test.js`).
- **After every plan wave:** Run `npm test` (full suite).
- **Before `/gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** ~6 s (full suite).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 14-01-T1 | 01 | 1 | DX-07 | T-14-03 | `picocolors@^1.1.1` añadido a `dependencies` (alphabetical sibling de commander) + lockfile regenerado; `import('picocolors')` devuelve `createColors` function; `npm install` sin warnings | unit (smoke) | `node -e "const p=require('./package.json'); process.exit(p.dependencies.picocolors ? 0 : 1)"` + `grep -c '"picocolors":' package.json` | ✅ | ✅ green |
| 14-01-T2 | 01 | 1 | DX-06 | T-14-01, T-14-02 | `src/cli/format.js` (178 LOC) factory pure con eager `useColor` (precedencia NO_COLOR > FORCE_COLOR > stream.isTTY per D-02/D-04); helpers de nivel/sintácticos/genéricos/tabular; `useColor=false` produce ZERO ANSI escapes (golden bytes invariante DX-06) | unit | `node --test test/format.test.js` | ✅ | ✅ green |
| 14-01-T3 | 01 | 1 | DX-06 | T-14-01 | 7-case useColor matrix (D-02) + golden bytes per helper (DX-06) + colored output con relaxed close-code regex + visibleWidth strip + formatRow padding (D-09/D-10/D-11) + formatTable auto-widths | unit (TDD-style guard) | `node --test test/format.test.js` | ✅ | ✅ green (39/39) |
| 14-02-T1 | 02 | 2 | DX-06 (LOG-12 ext) | T-14-06, T-14-07 | LOG-12 extension: `src/cli/format.js` no importa `src/logger.js` transitivamente (walker copiado verbatim de check-isolation.test.js); D-07/D-08 single-source: `picocolors` solo aparece como specifier en `src/cli/format.js` (recursive grep `listJsFiles(src/)`) | source-hygiene | `node --test test/format-isolation.test.js` | ✅ | ✅ green (4/4) |
| 14-03-T1 | 03 | 2 | DX-07 | T-14-10 | `.planning/PROJECT.md` §Constraints gana 7º bullet "Color isolation" — invariante de single-source anclado a `test/format-isolation.test.js` por path; § Current Milestone block + footer intactos | doc-source-hygiene | `grep -c "Color isolation" .planning/PROJECT.md` (== 1) + `grep -c "test/format-isolation.test.js" .planning/PROJECT.md` (== 1) | ✅ | ✅ green |
| 14-03-T2 | 03 | 2 | DX-07 | T-14-11, T-14-13 | `node bin/kodo --version` (vía `spawnSync(process.execPath, ...)`) sale exit 0, stdout = `PKG_VERSION` leído de `package.json`, stderr vacío (sin deprecation/install warning post picocolors install) | integration (spawn) | `node --test test/version-smoke.test.js` | ✅ | ✅ green (1/1) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Aggregate:** 6/6 tasks → all green. Phase 14 subset corre en ~0.3s con 46 tests (39 format + 4 format-isolation + 1 version-smoke + 2 sanity en isolation). Suite global en wave-2 close: 455 pass + 1 skip pre-existente (Phase 6 LOG-12 startup-budget Decisión B) / 0 fail.

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* `node --test` ya en place desde Phase 1, no requirió bootstrap de framework. La única dependencia nueva (`picocolors@^1.1.1`) es producto del task 14-01-T1 — su instalación es el primer commit de Phase 14, dejando lista la dependency tree para los tests posteriores.

Ningún MISSING reference detectado.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Negative-control LOG-12 (Plan 14-02) | DX-06 | Inyectar `import {} from '../logger.js';` en `src/cli/format.js` debe romper `format-isolation.test.js` con diagnostic listando `src/logger.js` como violator + grafo completo. Confirmado durante ejecución (SUMMARY 14-02 §Negative-control). No fixture permanente — guard inverso ejecutable bajo demanda. | 1) `cp src/cli/format.js /tmp/format.js.bak`. 2) Inyectar el import. 3) `node --test test/format-isolation.test.js` → fail esperado. 4) `mv /tmp/format.js.bak src/cli/format.js`. 5) Re-run → green. |
| Visual smoke `kodo --version` clean stderr | DX-07 | El spawn-based test asserta stderr-trim vacío, pero un visual sanity en terminal real captura warnings de Node experimental que el spawn pueda no reportar (raro pero defensivo). | `node bin/kodo --version 2>&1 1>/dev/null` debe imprimir nada. |
| Visual inspection helper colored output | DX-06 | `format.test.js` valida byte-shape de `\x1b[36m...\x1b[0m`/`\x1b[39m`, pero el rendering real en distintos terminals (iTerm, Terminal.app, tmux) requiere ojo humano para confirmar legibilidad de los chips por nivel. **NOTA:** este check se cubrió ya en Phase 15 manual checks (Phase 14 boundary = no callsite, así que sin TTY visual real bajo Phase 14). | n/a — diferido a Phase 15 callsite wiring. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (cada task tiene su propio comando)
- [x] Wave 0 covers all MISSING references (none — `node --test` ya disponible)
- [x] No watch-mode flags (suite one-shot)
- [x] Feedback latency < 1 s (Phase 14 subset ~0.3 s; full suite ~6 s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-06 (retroactive reconstruction)

---

## Validation Audit 2026-05-06

| Metric          | Count |
|-----------------|-------|
| Gaps found      | 0     |
| Resolved        | 0     |
| Escalated       | 0     |
| Tests verified  | 46/46 pass (Phase 14 subset) |
| Full suite      | 458 tests, 457 pass, 1 skip (pre-existing Decisión B Phase 6 startup-budget), 0 fail |

State B reconstruction from `14-01-PLAN.md`/`14-02-PLAN.md`/`14-03-PLAN.md` + corresponding SUMMARY.md + `14-VERIFICATION.md`. Cada requirement (DX-06 + DX-07) mapea 1:1 a un comando automatizado verde. No auditor spawn required — Nyquist coverage already complete at execution time; este documento sólo cierra el loop documental.

---

## Cross-references

- **Code review:** `14-REVIEW.md` (status `issues_found` — 0 critical, 1 warning, 2 info; advisory)
- **Verification:** `14-VERIFICATION.md` (status `passed` — 5/5 must-haves, DX-06/DX-07 satisfied)
- **Security:** (none — Phase 14 es presentation-only / boundary "no callsite"; threats T-14-01..13 disposicionados accept/mitigate en plan threat models, single supply-chain dep mitigada por lockfile + grep guard)
