---
phase: 19
slug: worktree-cleanup-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-12
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js `node:test` stdlib + `node:assert/strict` (per `.planning/codebase/TESTING.md`) |
| **Config file** | None — `package.json` `test` script invokes `node --test test/**/*.test.js` |
| **Quick run command** | `node --test test/stop-worktree-cleanup.test.js test/logger-events.test.js test/gsd-verify-integration.test.js test/stop.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~25s quick / ~90s full suite |

---

## Sampling Rate

- **After every task commit:** Run quick run command (≤30s).
- **After every plan wave:** Run `npm test` (full suite).
- **Before `/gsd-verify-work`:** Full suite must be green + manual E2E cleanup sobre repo throwaway.
- **Max feedback latency:** 30 seconds.

---

## Per-Task Verification Map

> Task IDs son placeholders — el planner los reemplaza por las IDs reales que produzca `gsd-planner` (`19-01-NN` para Plan 01 logger-events, `19-02-NN` para Plan 02 cleanup + verify).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | WT-04 | — | EVENTS frozen object incluye `WORKTREE_CLEANUP_OK/DIRTY/ERROR` strings | unit | `node --test test/logger-events.test.js` | ✅ extend | ⬜ pending |
| 19-01-02 | 01 | 1 | WT-04 | — | `worktreeCleanupOk({session_id, worktree_path, branch_deleted})` emite shape válido | unit | `node --test test/logger-events.test.js` | ✅ extend | ⬜ pending |
| 19-01-03 | 01 | 1 | WT-04 | — | `worktreeCleanupDirty({session_id, worktree_path, moved_to})` emite shape válido | unit | `node --test test/logger-events.test.js` | ✅ extend | ⬜ pending |
| 19-01-04 | 01 | 1 | WT-04 | — | `worktreeCleanupError({session_id, worktree_path, phase, reason})` emite shape válido | unit | `node --test test/logger-events.test.js` | ✅ extend | ⬜ pending |
| 19-02-01 | 02 | 2 | WT-04 | V5 input | Stop hook elimina worktree limpio + borra branch + emite `cleanup.ok` con `branch_deleted: true` | E2E (git real + tmpdir) | `node --test test/stop-worktree-cleanup.test.js` | ❌ W0 | ⬜ pending |
| 19-02-02 | 02 | 2 | WT-04 | V5 input | Worktree dirty (`git status --porcelain` no vacío) → move-aside a `.bg-shell/<sid>.dirty/` + emite `cleanup.dirty` con `moved_to` | E2E (dirty fixture) | `node --test test/stop-worktree-cleanup.test.js` | ❌ W0 | ⬜ pending |
| 19-02-03 | 02 | 2 | WT-04 | V7 errors | `git worktree remove` falla (FS error) → `console.error` + emite `cleanup.error` con `phase: 'remove'` + continúa fail-open | unit (gitFn stub) | `node --test test/stop-worktree-cleanup.test.js` | ❌ W0 | ⬜ pending |
| 19-02-04 | 02 | 2 | WT-04 | V5 input | Target `.dirty/` ya existe → suffixed path (`.dirty-<timestamp>` o equivalente) — Pitfall #1 mitigation | E2E (precondición existsSync) | `node --test test/stop-worktree-cleanup.test.js` | ❌ W0 | ⬜ pending |
| 19-02-05 | 02 | 2 | WT-04 | — | Legacy v0.5 (sin `worktree_path`) → cleanup skip silencioso (no warn) | unit (session sin worktree_path) | `node --test test/stop-worktree-cleanup.test.js` | ❌ W0 | ⬜ pending |
| 19-02-06 | 02 | 2 | WT-04 | — | `git branch -D` falla (race, no existe) → log warn fail-open, no crash | unit (gitFn stub returns exit 1) | `node --test test/stop-worktree-cleanup.test.js` | ❌ W0 | ⬜ pending |
| 19-02-07 | 02 | 2 | WT-04 | — | `git worktree prune` oportunista al final del cleanup (no-op si no zombies) | E2E + unit (assert llamada) | `node --test test/stop-worktree-cleanup.test.js` | ❌ W0 | ⬜ pending |
| 19-02-08 | 02 | 2 | WT-04 | — | Cleanup invocado DESPUÉS de `releaseGsdLock` (orden invariante D-07) | source-hygiene | `node --test test/stop.test.js` | ✅ extend | ⬜ pending |
| 19-02-09 | 02 | 2 | WT-05 | — | `handleOrchestratorStop` corre con `cwd: KODO_ROOT` (preservado funcionalmente) | E2E (existente) | `node --test test/skill-auto-commit.test.js` | ✅ preserve | ⬜ pending |
| 19-02-10 | 02 | 2 | WT-05 | — | `KODO_ROOT` env override sigue apuntando a tmpdir aislado en tests | E2E (existente) | `node --test test/skill-auto-commit.test.js` | ✅ preserve | ⬜ pending |
| 19-02-11 | 02 | 2 | WT-06 | V5 input | `verify.js:124` resuelve `phasesRoot` con `join(session.worktree_path ?? session.project_path, '.planning', 'phases')` | source-hygiene | `node --test test/gsd-verify-integration.test.js` | ✅ extend | ⬜ pending |
| 19-02-12 | 02 | 2 | WT-06 | — | verify lee VERIFICATION.md desde worktree_path cuando está presente | integration (fixture con worktree_path) | `node --test test/gsd-verify-integration.test.js` | ✅ extend | ⬜ pending |
| 19-02-13 | 02 | 2 | WT-06 | — | verify fallback silent a `project_path` para sesiones legacy v0.5 (sin worktree_path) | integration (fixture sin worktree_path) | `node --test test/gsd-verify-integration.test.js` | ✅ extend | ⬜ pending |
| 19-02-14 | 02 | 2 | WT-06 | — | Exit codes deterministas + bytes del comentario Plane preservados (Pitfall #6 Opción A invariante) | integration | `node --test test/gsd-verify-integration.test.js` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/stop-worktree-cleanup.test.js` — NEW file. Patrón mixto unit (gitFn stub) + E2E (git real con `makeIsolatedRepoWithWorktree` helper — synthesized de `skill-auto-commit.test.js` + `stop-state-transition.test.js`). Cubre WT-04 completo (8 escenarios).
- [ ] `test/logger-events.test.js` — EXTEND. Añade tests para `worktreeCleanupOk/Dirty/Error` helpers + EVENTS strings (~4 tests nuevos).
- [ ] `test/gsd-verify-integration.test.js` — EXTEND. Añade fixtures con/sin `worktree_path` + source-hygiene assert sobre línea 124 (~3 tests nuevos).
- [ ] `test/stop.test.js` — EXTEND. Source-hygiene: cleanup invocado tras `releaseGsdLock`, helpers logger-events referenciados, `handleOrchestratorStop` no modificada funcionalmente (~3 asserts nuevas).
- [ ] **Framework install:** NONE — `node:test` + `node:assert/strict` ya en uso.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cleanup E2E end-to-end con `claude --worktree` real, sesión terminada vía cmux stop | WT-04 | Test integra con CLI claude que no se invoca en CI | 1. `kodo run <task-real>` con worktree. 2. Trabajar en la sesión hasta dejar el tree limpio. 3. `cmux stop <sid>`. 4. Verificar `git worktree list` no incluye el path. 5. Verificar branch borrada. 6. Verificar `.bg-shell/<sid>/` no existe. |
| Cleanup E2E con dirty state realista (modificaciones no committed) | WT-04 | Mismo motivo + el dirty pattern viene del comportamiento del agente | 1. Sesión real. 2. Agente deja cambios sin commit. 3. `cmux stop`. 4. Verificar `.bg-shell/<sid>.dirty/` existe + contiene los cambios. 5. Verificar branch preservada. 6. Verificar log warn presente con `moved_to`. |
| `kodo gsd verify <sid>` corriendo MIENTRAS la sesión está viva | WT-06 | Requiere coordinar runtime real (no SessionRecord en history) | 1. Sesión real con VERIFICATION.md escrito en su worktree. 2. Durante la sesión, ejecutar `kodo gsd verify <sid>`. 3. Verificar lectura desde worktree path (no del repo principal). 4. Verificar exit code + bytes comment idénticos a v0.5. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`test/stop-worktree-cleanup.test.js` new + extensions)
- [ ] No watch-mode flags (`node --test` runs once-only by default — OK)
- [ ] Feedback latency < 30s (quick run command)
- [ ] `nyquist_compliant: true` set in frontmatter (al finalizar Wave 0)

**Approval:** pending
