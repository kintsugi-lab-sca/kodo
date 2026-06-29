---
phase: 61
slug: progreso-vivo-para-sesiones-adoptadas
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-24
audited: 2026-06-24
reconstructed: true
---

# Phase 61 — Validation Strategy

> Per-phase validation contract. **Reconstruido retroactivamente** (State B) durante
> `/gsd:validate-phase 61` el 2026-06-24. Phase 61 entrega PROG-04: una sesión GSD
> adoptada muestra su progreso `N/M` en el dashboard igual que una lanzada (gate
> dinámico D-1 + fallback de path D-2 + detección GSD at-adopt D-3).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) + ink-testing-library (componentes dashboard) |
| **Config file** | none — `package.json` test script |
| **Quick run command** | `node --test test/dashboard/app-progress-adopted.test.js test/adopt.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~1s (targeted) / full suite |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/dashboard/app-progress-adopted.test.js test/adopt.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 segundos

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 61-01-01 | 01 | 1 | PROG-04 / MH1 (D-1 gate + D-2 fallback) | — | Sesión adoptada SIN worktree y SIN flag `gsd` muestra `N/M` desde `<project_path>/.planning/STATE.md` (gate dinámico reemplaza el corte `if(row.gsd!==true)`) | component (ink) | `node --test test/dashboard/app-progress-adopted.test.js` | ✅ | ✅ green (caso 1) |
| 61-01-02 | 01 | 1 | PROG-04 / MH2 (no regresión) | T-traversal | Sesión LANZADA con worktree lee del worktree, NO del project_path (Pitfall 1 intacto); guard anti-traversal del session_id preservado | component (ink) | `node --test test/dashboard/app-progress-adopted.test.js` | ✅ | ✅ green (caso 2: 5/9 worktree vs trampa 1/9) |
| 61-01-03 | 01 | 1 | PROG-04 / MH4 (sin STATE → —) | — | Sin STATE.md GSD en el path resuelto → `readGsdProgress` 'no-progress' → columna no muestra `N/M` | component (ink) | `node --test test/dashboard/app-progress-adopted.test.js` | ✅ | ✅ green (caso 3) |
| 61-01-04 | 01 | 1 | PROG-04 / MH3 (read-path intacto) | — | `readGsdProgress` + keep-last-good NO tocados; ante fallo transitorio la columna MANTIENE `N/M` | component (ink) | `node --test test/dashboard/app-progress-keeplast.test.js` | ✅ | ✅ green |
| 61-01-05 | 01 | 1 | PROG-04 / MH5 (D-3 detección GSD) | — | `isGsdProject(projectPath, existsSyncFn)` puro never-throws DI; `buildSessionFromAdoption` setea `gsd:true`/`gsd_mode:'full'` cuando `.planning/PROJECT.md`\|`STATE.md` existe; omitidos si no-GSD; `phase_id` NO derivado | unit | `node --test test/adopt.test.js` | ✅ | ✅ green (positivo/negativo + isGsdProject true/false/vacío/never-throws) |
| 61-01-06 | 01 | 1 | invariantes transversales | — | adopt.js solo fs read de `.planning/` (no cmux); App.js no leakea color | unit | `node --test test/format-isolation.test.js test/cmux-isolation.test.js` | ✅ | ✅ green (8 walkers) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/dashboard/app-progress-adopted.test.js` — net-new; 3 casos (MH1/MH2/MH4) vía ink-testing-library
- [x] `test/adopt.test.js` — extendido con detección GSD D-3 (MH5): positivo/negativo + `isGsdProject` con DI `existsSyncFn`
- [x] `test/dashboard/app-progress-keeplast.test.js` — pre-existente (Phase 50.1/58), confirma MH3 (read-path intacto)

*Existing infrastructure covers the rest — no framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | Ninguna. Los 5 must_haves son verificables vía component tests (ink-testing-library) + unit tests. El render del dashboard se ejercita deterministamente con STATE.md sembrados; no requiere TTY live. |

> **Nota DI (del v0.13-MILESTONE-AUDIT):** `adoptSession` (src/adopt.js) no reenvía
> `existsSyncFn` a `buildSessionFromAdoption` en su llamada interna — usa el `existsSync`
> real (correcto en producción). La lógica de detección GSD SÍ está testeada
> directamente sobre `buildSessionFromAdoption` con `existsSyncFn` inyectado (casos
> positivo/negativo). El gap es solo de inyección en el orquestador `adoptSession`, no
> de cobertura de la detección — MH5 está cubierto. Hardening opcional (no bloqueante):
> enhebrar `deps.existsSyncFn` a través de `adoptSession`.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-24

---

## Validation Audit 2026-06-24

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 (reconstrucción State B — cobertura pre-existente) |
| Escalated to manual-only | 0 (los 5 must_haves son automatizables vía component + unit tests) |
| Requirements covered | 5/5 must_haves (PROG-04 D-1/D-2/D-3) |
| Tests run | 39 pass / 0 fail (app-progress-adopted 3 + adopt.test.js 20 + app-progress-keeplast + isolation 8) |
