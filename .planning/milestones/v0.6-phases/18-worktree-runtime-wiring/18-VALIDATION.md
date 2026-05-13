---
phase: 18
slug: worktree-runtime-wiring
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-12
reconstructed_from: [18-01-SUMMARY.md, 18-02-SUMMARY.md, 18-03-SUMMARY.md, 18-VERIFICATION.md]
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for Phase 18 (Worktree Runtime Wiring).
> Reconstructed retroactively from SUMMARY/VERIFICATION artifacts after phase completion.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node.js built-in) + `node:assert/strict` |
| **Config file** | none — discovered via `package.json#scripts.test` glob |
| **Quick run command** | `node --test test/<file>.test.js` (per-file) |
| **Full suite command** | `npm test` (resolves to `node --test test/**/*.test.js`) |
| **Estimated runtime** | ~1.7 seconds (547 tests across 124 suites) |

---

## Sampling Rate

- **After every task commit:** Run per-file `node --test test/<file>.test.js`
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | WT-02 | T-18-01 (Tampering — sessionId malicioso) | `computeWorktreePath` pure path-builder, sin `realpathSync`, output preserva literal projectPath + defense-in-depth `!out.includes('..')` | unit | `node --test test/state.test.js` | ✅ | ✅ green |
| 18-02-01 | 02 | 2 | WT-01, WT-02 | T-18-03 (Tampering — shell injection vía sessionId), T-18-05 (Repudiation — addSession fail silente) | `--worktree ${sessionId}` interpolación con UUID v4 (no shell metachars); `addSession` PRE-`cmux.send` para garantizar trace forensic | unit + source-hygiene | `node --test test/manager.test.js` | ✅ | ✅ green |
| 18-03-01 | 03 | 3 | WT-01, WT-03 | T-18-05 (Tampering — lock con worktreePath), T-18-07 (TOCTOU existsSync → cmux.send), T-18-10 (existsSync EACCES) | Fail-fast `worktree_collision` canonical antes de launch; lock release on collision (no leak); `acquireGsdLockFn`/`releaseGsdLockFn` JAMÁS reciben worktreePath | integration + source-hygiene | `node --test test/dispatcher.test.js` | ✅ | ✅ green |
| 18-03-02 | 03 | 3 | WT-01 (exclusión orchestrator) | T-18-06 (Bypass — `--worktree` añadido al orchestrator) | `launchOrchestrator` NUNCA emite `--worktree` (cwd=repo para auto-load skill Phase 999.1 D-05) | source-hygiene | `node --test test/orchestrator-launch-isolation.test.js` | ✅ | ✅ green |
| 18-03-03 | 03 | 3 | WT-03 | T-18-05 (lock invariant cross-callsite) | Lock vive en `<projectPath>/.planning/.kodo.lock`; coalescencia 2-dispatches-1-repo preservada; no-GSD paralelo D-06b | integration + source-hygiene | `node --test test/gsd-concurrency.test.js` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*None — existing `node:test` infrastructure cubre todos los requirements de la phase.*

Notas:
- `test/state.test.js` ya existía (Phase 11 — extendido con 4 asserts de `computeWorktreePath`).
- `test/manager.test.js` ya existía (extendido con 12 asserts: 4 en `buildSessionFromTask` + 5 en `buildClaudeCommand` + 6 en source-hygiene).
- `test/dispatcher.test.js` ya existía (extendido con 8 asserts en `describe('dispatchTrigger — Phase 18 worktree_collision')`).
- `test/gsd-concurrency.test.js` ya existía (extendido con 4 asserts en `describe('Phase 18 — coalesce con worktree cableado')`).
- `test/orchestrator-launch-isolation.test.js` **creado nuevo** (Plan 03 Task 2 — 3 asserts source-hygiene clonando patrón Phase 16 `dispatcher-isolation.test.js`).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Smoke E2E live: `kodo launch <task>` arranca claude en worktree real; `git -C <projectPath>/.bg-shell/<sessionId> rev-parse --show-toplevel` retorna el worktree | WT-01, WT-02 | Requiere setup local de cmux + provider live (Plane/GitHub) + claude CLI funcionando; out-of-scope automatización Phase 18 | Lanzar sesión GSD/quick/no-GSD reales; verificar `cat ~/.kodo/state.json \| jq '.sessions[].worktree_path'`; verificar que `--worktree <uuid>` aparece en el cmd cmux visible |
| Smoke E2E orchestrator NO arranca en worktree | WT-01 (exclusión D-06) | Mismo motivo — necesita claude CLI live + skill `kodo-orchestrate` instalada | Ejecutar `kodo orchestrator` desde `~/dev/klab/kodo`; verificar que la sesión NO arranca en `.bg-shell/<uuid>/` (skill `kodo-orchestrate` se auto-carga desde repo) |
| Smoke 2 GSD concurrentes sobre mismo repo | WT-03 | Requiere 2 procesos kodo simultáneos contra provider live | Disparar 2 webhooks GSD sobre la misma task; verificar que la 2ª devuelve `gsd_locked` y el lock file vive en `<repo>/.planning/.kodo.lock` con `session_id` de la 1ª |

Justificación: el goal de Phase 18 está **automáticamente verificado a nivel de invariantes de código** (shape del cmd, persistencia del path, lock invariant cross-callsite, exclusión orchestrator) — la única manera de salir del scope es introduciendo un fallo a nivel de claude CLI o cmux runtime, lo cual queda fuera del control de kodo. El smoke manual existe para confianza operacional pre-Phase 19, no como gate de cierre de Phase 18.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (5/5 tasks tienen comando automatizado)
- [x] Wave 0 covers all MISSING references (Wave 0 vacío — infraestructura existente suficiente)
- [x] No watch-mode flags (`node --test` corre one-shot)
- [x] Feedback latency < 30s (suite global ~1.7s; per-file <0.5s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-12 (retroactive reconstruction; VERIFICATION.md pasó 8/8 must-haves, suite global 546/547 + 1 skip pre-existente — LOG-12 Decisión B startup-budget)

---

## Audit Trail

### Reconstruction 2026-05-12

VALIDATION.md no fue producido durante la ejecución de Phase 18 (skip del paso `/gsd-validate-phase` post-execute). Este archivo se reconstruye retroactivamente del estado real:

| Metric | Count |
|--------|-------|
| Plans audited | 3 (18-01, 18-02, 18-03) |
| Tasks mapped | 5 (1 + 1 + 3) |
| Requirements covered | 3/3 (WT-01, WT-02, WT-03) |
| Automated tests added during phase | 31 (4 + 16 + 11) |
| Manual-only items | 3 (smoke E2E — operational confidence pre-Phase 19) |
| Gaps found | 0 |
| Gaps resolved | 0 |
| Gaps escalated | 0 |

Cross-reference matrices (requirements ↔ tests ↔ truths) validadas contra `18-VERIFICATION.md` (status: passed, 8/8 must-haves verificados, score 8/8 truths). Coherencia confirmada.
