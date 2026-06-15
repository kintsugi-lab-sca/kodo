---
phase: 45
slug: inyecci-n-de-plan-ligero-universal
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-10
---

# Phase 45 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Reconstructed retroactively (citation-based) from the existing 45-VERIFICATION.md (passed 7/7) during Phase 51 backfill (NYQ-03). No suite re-run — coverage is cited from the empirical evidence already on disk.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (builtins) |
| **Config file** | none — `package.json` test script |
| **Quick run command** | `node --test test/session-start.test.js test/gsd-context.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~2 seconds (quick) |

**Baseline verificado:** `node --test test/session-start.test.js test/gsd-context.test.js` → 48 tests, 48 pass, 0 fail (2026-06-10).

---

## Sampling Rate

- **After every task commit:** Run `node --test test/session-start.test.js test/gsd-context.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~2 seconds

---

## Per-Task Verification Map

> Requirement→behavior map locked from RESEARCH.md; estados poblados retroactivamente desde `45-VERIFICATION.md` (passed 7/7, NYQ-03).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 45-01-* | 01 | 1 | PLAN-03 | — | `buildSessionContext` inyecta instrucción ES con ruta resuelta `~/.kodo/plans/<task_id>.md` | unit | `node --test test/session-start.test.js` | ✅ | ✅ green — `45-VERIFICATION.md` (passed 7/7): Truth #1 VERIFIED (L85); target suite 58 pass / 0 fail |
| 45-01-* | 01 | 1 | PLAN-03 | — | Rama quick de `buildGsdContext` inyecta instrucción EN con ruta resuelta | unit | `node --test test/gsd-context.test.js` | ✅ | ✅ green — `45-VERIFICATION.md` (passed 7/7): Truth #2 VERIFIED (L145); target suite 58 pass / 0 fail |
| 45-01-* | 01 | 1 | PLAN-03 (HOOK-02) | — | Ramas phase/bootstrap byte-idénticas (incl. bloque común "## No automatic push") | unit | `node --test test/gsd-context.test.js` | ✅ | ✅ green — `45-VERIFICATION.md` (passed 7/7): Truths #3/#4 VERIFIED (golden-bytes HOOK-02; runtime `phase has instruction: false`, `boot has instruction: false`) |
| 45-01-* | 01 | 1 | PLAN-03 | — | Ruta inyectada absoluta/resuelta, no el literal `<task_id>` | unit | `node --test test/session-start.test.js` | ✅ | ✅ green — `45-VERIFICATION.md` (passed 7/7): Truth #5 VERIFIED (sin I/O, ruta `join(KODO_DIR,'plans',...)` resuelta) |
| 45-01-* | 01 | 1 | PLAN-03 (latest-wins) | — | Idempotencia / latest-wins: re-dispatch sobrescribe `~/.kodo/plans/<task_id>.md` | unit | `node --test test/session-start.test.js` | ✅ | ✅ green — `45-VERIFICATION.md` (passed 7/7): Truths #6/#7 VERIFIED (wording "sobrescribe si ya existe" / "overwrite if it exists") |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **Citation note (Phase 51 / NYQ-03):** estados ✅ green citados de `45-VERIFICATION.md` (status: passed, score 7/7, verified 2026-06-10), no de una re-ejecución. Target suite en ese verify: `node --test test/session-start.test.js test/gsd-context.test.js` → 58 pass / 0 fail; full suite `npm test` → 1252 pass / 1 skip / 0 fail. No hay `45-HUMAN-UAT.md` — el VERIFICATION declara que ningún comportamiento del objetivo requiere verificación humana (string-builders puros 100% testeables). Ninguna dimensión marcada N/A.

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* La infra de test existe (`test/session-start.test.js`, `test/gsd-context.test.js`) con fixtures `makeSession`/`makeConfig` reusables y patrones de assert de golden-bytes ya establecidos. Solo hay que **añadir casos** — no crear Wave 0.

---

## Manual-Only Verifications

*All phase behaviors have automated verification.* El artefacto `~/.kodo/plans/<task_id>.md` lo escribe la sesión de Claude (D-03), fuera del alcance del unit test del builder; el contrato del builder (texto inyectado + ruta resuelta) sí es 100% testeable porque las funciones son puras.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (Phase 51 / NYQ-03 backfill, 2026-06-15)

---

## Reconstruction Audit 2026-06-15 (Phase 51 / NYQ-03)

| Metric | Count |
|--------|-------|
| Requirements audited | 1 (PLAN-03) |
| COVERED (automated unit) | 1 |
| PARTIAL | 0 |
| MISSING | 0 |
| Manual-only (by design) | 0 (string-builders puros, 100% testeables) |
| Evidence cited | `45-VERIFICATION.md` (passed, score 7/7, 2026-06-10) |

**Nota Nyquist:** cobertura reconstruida citando `45-VERIFICATION.md` (status: passed, 7/7) con sus Behavioral Spot-Checks reales (target suite `session-start.test.js` + `gsd-context.test.js` 58 pass / 0 fail; full suite `npm test` 1252 pass / 1 skip / 0 fail; golden-bytes HOOK-02 verificados; sin I/O confirmado por grep). **No se re-ejecutó la suite.** No hay `45-HUMAN-UAT.md`; el VERIFICATION declara explícitamente que ningún comportamiento requiere verificación humana. Ninguna dimensión N/A. Fase declarada **nyquist-compliant**.
