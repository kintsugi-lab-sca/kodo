# Roadmap: kodo

## Milestones

- ✅ **v0.2 Provider Abstraction** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v0.3 GSD Integration + Structured Logging** — Phases 6-10 (shipped 2026-04-22)
- ✅ **v0.4 GSD Quick Mode** — Phases 11-13 (shipped 2026-04-30)
- ✅ **v0.5 CLI Polish & v0.3 Debt Cleanup** — Phases 14-17 + 999.1 (shipped 2026-05-11)
- 🟡 **v0.6 Session Isolation & Skill Sync** — Phases 18-22 (in progress, initialized 2026-05-11)

## Phases

### v0.6 — Session Isolation & Skill Sync (active)

- [ ] **Phase 18: Worktree Runtime Wiring** — Toda sesión kodo se lanza con `claude --worktree`; path derivado del session-id se persiste en `SessionRecord`; lock per-repo invariante.
- [ ] **Phase 19: Worktree Cleanup & Integration** — Stop hook hace `git worktree remove` fail-open; `auto-commit` y `kodo gsd verify` operan dentro del worktree.
- [ ] **Phase 20: HOOK-01 Universal Anti-Push-Fantasma** — `buildSessionContext` añade recordatorio anti-push a TODAS las sesiones (GSD + no-GSD) preservando golden bytes.
- [ ] **Phase 21: Skill Sync CLI + Auto-Sync** — `kodo skill sync` manual + auto-sync en `kodo orchestrator` con drift detection, sin romper Constraint cwd=repo.
- [ ] **Phase 22: Tech Debt v0.5 Closure** — Cierra Phase 14 (SECURITY.md + WR-01/IN-01/IN-02), Phase 15 (retiro de `ANSI_*` exports) y Phase 16 (8 WR + 4 IN).

<details>
<summary>✅ v0.2 Provider Abstraction (Phases 1-5) — SHIPPED 2026-04-13</summary>

- [x] Phase 1: Interface + State Schema (2/2 plans) — completed 2026-04-07
- [x] Phase 2: Plane Adapter + Registry (2/2 plans) — completed 2026-04-08
- [x] Phase 3: Consumer Rewiring (2/2 plans) — completed 2026-04-10
- [x] Phase 4: Server + Trigger Abstraction (2/2 plans) — completed 2026-04-13
- [x] Phase 5: Config + Cleanup (2/2 plans) — completed 2026-04-13

Full details: `.planning/milestones/v0.2-ROADMAP.md`

</details>

<details>
<summary>✅ v0.3 GSD Integration + Structured Logging (Phases 6-10) — SHIPPED 2026-04-22</summary>

- [x] Phase 6: Structured Logger Foundation (4/4 plans) — completed 2026-04-15
- [x] Phase 7: `kodo logs` CLI + Event Taxonomy (6/6 plans) — completed 2026-04-16
- [x] Phase 8: GSD Label + Session Plumbing (5/5 plans) — completed 2026-04-20
- [x] Phase 9: Phase Resolver + Bootstrap (6/6 plans) — completed 2026-04-21
- [x] Phase 10: Orchestrator Verification Gate (4/4 plans) — completed 2026-04-22

Full details: `.planning/milestones/v0.3-ROADMAP.md`
Milestone audit: `.planning/milestones/v0.3-MILESTONE-AUDIT.md`
Requirements archive: `.planning/milestones/v0.3-REQUIREMENTS.md`

</details>

<details>
<summary>✅ v0.4 GSD Quick Mode (Phases 11-13) — SHIPPED 2026-04-30</summary>

- [x] Phase 11: Quick Mode Recognition & Persistence (3/3 plans) — completed 2026-04-28
- [x] Phase 12: Hook & Orchestrator Bifurcation (3/3 plans) — completed 2026-04-28
- [x] Phase 13: Test Coverage Matrix (5/5 plans) — completed 2026-04-29

Full details: `.planning/milestones/v0.4-ROADMAP.md`
Requirements archive: `.planning/milestones/v0.4-REQUIREMENTS.md`
Phase artifacts: `.planning/milestones/v0.4-phases/`

</details>

<details>
<summary>✅ v0.5 CLI Polish & v0.3 Debt Cleanup (Phases 14-17 + 999.1) — SHIPPED 2026-05-11</summary>

- [x] Phase 14: CLI Format Foundation (3/3 plans) — completed 2026-05-05
- [x] Phase 15: CLI Polish Wiring (5/5 plans) — completed 2026-05-05
- [x] Phase 16: LOG-09 Debt Cleanup (3/3 plans) — completed 2026-05-06
- [x] Phase 17: Phase 7 UAT Automation (5/5 plans) — completed 2026-05-10
- [x] Phase 999.1: Skill kodo-orchestrate al repo (5/5 plans) — completed 2026-05-11

Full details: `.planning/milestones/v0.5-ROADMAP.md`
Milestone audit: `.planning/milestones/v0.5-MILESTONE-AUDIT.md`
Requirements archive: `.planning/milestones/v0.5-REQUIREMENTS.md`

</details>

## Phase Details

### Phase 18: Worktree Runtime Wiring
**Goal**: Toda sesión kodo arranca en un worktree dedicado derivado determinísticamente del session-id, sin romper el lock per-repo.
**Depends on**: Nothing (foundational for v0.6)
**Requirements**: WT-01, WT-02, WT-03
**Success Criteria** (what must be TRUE):
  1. Cualquier sesión lanzada por kodo (full / quick / no-GSD) corre con `claude --worktree` activo — observable inspeccionando el subcomando construido en `launch.js` y verificable porque `git -C <cwd> rev-parse --show-toplevel` desde el agente devuelve un path distinto al repo principal.
  2. `SessionRecord.worktree_path` queda persistido en `state.json` con un path determinístico derivado del session-id (ej. `<repo>/.bg-shell/<session-id>/`), legible por `kodo logs --session-of` y demás consumidores.
  3. Dos tareas Plane sobre el mismo repo siguen coalesciendo: solo una sesión arranca, la segunda recibe el "lock held" canónico de Phase 8 GSD-10; el lock vive en el repo principal, NO en el worktree.
**Plans**: 3 plans
Plans:
**Wave 1**
- [x] 18-01-PLAN.md — Helper puro `computeWorktreePath` + extender typedef `Session.worktree_path?` (WT-02 base, sin tocar runtime)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 18-02-PLAN.md — Cablear `--worktree <sessionId>` en `launchWorkItem`/`buildClaudeCommand` + persistir `worktree_path` PRE-spawn (WT-01 + WT-02 wiring)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 18-03-PLAN.md — Canonical error `worktree_collision` en dispatcher + invariante lock per-repo (WT-03 SC#3) + exclusión `launchOrchestrator` D-06 + integration coalesce tests

### Phase 19: Worktree Cleanup & Integration
**Goal**: El ciclo de vida del worktree cierra limpio (fail-open en caso de dirty state) y el resto de subsistemas que tocan filesystem (`auto-commit` de la skill, `kodo gsd verify`) operan dentro del worktree correcto.
**Depends on**: Phase 18
**Requirements**: WT-04, WT-05, WT-06
**Success Criteria** (what must be TRUE):
  1. Tras stop hook, `git worktree list` ya no incluye el worktree de la sesión cerrada cuando el tree está limpio; si quedan cambios sin commitear, el worktree persiste y se emite un `log warn` (no se borra silenciosamente).
  2. `auto-commit` de `kodo-orchestrate` produce commits dentro del worktree de la sesión (no en el repo principal), y `KODO_ROOT` env override sigue permitiendo apuntar a un tmpdir aislado para tests (compat Phase 999.1 D-16).
  3. `kodo gsd verify <session-id>` localiza `VERIFICATION.md` en el worktree de la sesión y produce los mismos exit codes deterministas + bytes de comentario Plane (Pitfall #6 Opción A invariante).
**Plans**: 2 plans
Plans:
**Wave 1**
- [x] 19-01-PLAN.md — Extender `EVENTS` frozen object + 3 helpers NDJSON `worktreeCleanupOk/Dirty/Error` en `src/logger-events.js` (scaffolding D-10 para WT-04)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 19-02-PLAN.md — Cleanup fail-open en `stop.js` tras `releaseGsdLock` (D-01..D-04, D-07..D-09) + `verify.js` lee `worktree_path ?? project_path` (D-06) + 3 source-hygiene asserts D-05/D-07/D-08 (WT-04 + WT-05 satisfied-by-design + WT-06)

### Phase 20: HOOK-01 Universal Anti-Push-Fantasma
**Goal**: Toda sesión (GSD full, GSD quick, no-GSD) recibe el recordatorio explícito de que kodo NO hace push automático, sin alterar los golden bytes de las tags `[GSD quick]` / `[GSD phase N]` / `[GSD bootstrap]`.
**Depends on**: Nothing (cross-cutting, independiente de worktree)
**Requirements**: HOOK-01, HOOK-02, HOOK-03
**Success Criteria** (what must be TRUE):
  1. El prompt construido por `buildSessionContext` contiene la sección "Anti-push-fantasma" (con la instrucción de verificar `git push` real o redactar en condicional) para los 3 modos: full, quick y no-GSD; verificable por inspección del payload del hook.
  2. Los bytes del prompt fuera del bloque HOOK-01 permanecen idénticos: las tags `[GSD quick]`, `[GSD phase N]`, `[GSD bootstrap]` y los demás artefactos no cambian shape ni offset relativo (golden bytes test compara modo-por-modo).
  3. El bloque HOOK-01 se inserta en una posición determinista por modo — re-emitir el mismo contexto produce los mismos bytes (idempotencia + reproducibilidad de debugging).
**Plans**: 2 plans
Plans:
**Wave 1**
- [ ] 20-01-PLAN.md — Append inline bloque ES "Anti-push-fantasma" en `buildSessionContext` + bloque EN "No automatic push" común post-if/else en `buildGsdContext` (HOOK-01 + HOOK-02 satisfied-by-construction)

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 20-02-PLAN.md — Extender `test/session-start.test.js` + `test/gsd-context.test.js` con suite HOOK-01/02/03 coverage matrix 4 modos × presencia + golden bytes opción B + idempotencia + D-04 common-block invariance

### Phase 21: Skill Sync CLI + Auto-Sync
**Goal**: La skill canonical `kodo-orchestrate` se mantiene sincronizada entre `<repo>/.claude/skills/` y `~/.claude/skills/` sin acción humana recurrente, sin romper la Constraint cwd=repo de Phase 999.1.
**Depends on**: Nothing (puede ejecutar en paralelo con Phase 18-20)
**Requirements**: SKILL-01, SKILL-02, SKILL-03, SKILL-04
**Success Criteria** (what must be TRUE):
  1. Ejecutar `kodo skill sync` desde el repo copia archivos cambiados de `<repo>/.claude/skills/` → `~/.claude/skills/` (diff-aware: solo cambios; NO borra archivos foráneos en home salvo `--prune` explícito), reportable por stdout legible (no-TTY/JSON byte-deterministic) y exit codes 0 (ok / no-op) / 1 (filesystem error) / 2 (fuera de repo kodo).
  2. Lanzar `kodo orchestrator` detecta drift (hash o mtime) entre repo y home antes de invocar Claude Code; si hay drift, sincroniza automáticamente y emite un evento `skill.sync.auto` en el log NDJSON con `from`/`to`/`files_changed`.
  3. Lanzar `kodo orchestrator` desde el cwd=repo sigue ganando con la skill local (Constraint Phase 999.1 D-04/D-05/D-06 preservada): la skill auto-cargada es la del repo, NO la sincronizada en home; la sync solo asegura que invocaciones cross-cwd futuras no vean `~/.claude/skills/` stale.
  4. Los stderr canonical messages de `kodo skill sync` están documentados (mismo verdict → mismos bytes) y los exit codes están cubiertos por test (al menos los 4 estados: ok / no-op / filesystem error / fuera de repo).
**Plans**: TBD

### Phase 22: Tech Debt v0.5 Closure
**Goal**: Cerrar el Resolution Log acumulado en v0.5 (Phase 14 / 15 / 16) sin alterar comportamiento runtime ni golden bytes; transformar warnings y informational items en tests y código limpio.
**Depends on**: Nothing (paralelizable con resto de v0.6)
**Requirements**: DEBT-01, DEBT-02, DEBT-03, DEBT-04, DEBT-05, DEBT-06
**Success Criteria** (what must be TRUE):
  1. `SECURITY.md` para Phase 14 existe en el árbol con `threats_open: 0` auditado y razón explícita (low-risk presentation-only); `test/version-smoke.test.js` ejecuta `spawnSync` con `timeout` explícito (WR-01) y la regresión queda cubierta por `format-isolation.test.js`.
  2. La regex ANSI usada por `format.js` para detectar/strip color es defensiva (IN-01) y existe un test explícito que verifica `FORCE_COLOR=''` → `useColor=false` (IN-02); la matriz de 4 estados `NO_COLOR > FORCE_COLOR > stream.isTTY` sigue verde.
  3. Los `ANSI_*` exports retirados de `src/logger.js` (DEBT-04): un grep cross-repo confirma 0 consumers externos y `format-isolation.test.js` se ajusta a la nueva regla; `--json` byte-deterministic invariante intacto, LOG-12 guard verde.
  4. Los 8 WR del Resolution Log de Phase 16 quedan cerrados (doble logger en `stop.js`, eager EVENTS + dynamic helpers en `dispatcher.js`, etc.) — cada uno con commit que cita el WR-ID y test que evita regresión cuando aplica.
  5. Los 4 IN cosméticos/documentales de Phase 16 (nombres de variable, comentarios, ordenamiento de imports) resueltos, sin tocar runtime; la suite global sigue en verde y la deuda residual documentada en `MILESTONES.md` queda a 0.
**Plans**: TBD

## Backlog

(deferred to v0.7+ — adapters de GitHub Issues/ClickUp/local, polling trigger channel, file watcher para provider local; ver REQUIREMENTS.md "Future Requirements")

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Interface + State Schema | v0.2 | 2/2 | Complete | 2026-04-07 |
| 2. Plane Adapter + Registry | v0.2 | 2/2 | Complete | 2026-04-08 |
| 3. Consumer Rewiring | v0.2 | 2/2 | Complete | 2026-04-10 |
| 4. Server + Trigger Abstraction | v0.2 | 2/2 | Complete | 2026-04-13 |
| 5. Config + Cleanup | v0.2 | 2/2 | Complete | 2026-04-13 |
| 6. Structured Logger Foundation | v0.3 | 4/4 | Complete | 2026-04-15 |
| 7. `kodo logs` CLI + Event Taxonomy | v0.3 | 6/6 | Complete | 2026-04-16 |
| 8. GSD Label + Session Plumbing | v0.3 | 5/5 | Complete | 2026-04-20 |
| 9. Phase Resolver + Bootstrap | v0.3 | 6/6 | Complete | 2026-04-21 |
| 10. Orchestrator Verification Gate | v0.3 | 4/4 | Complete | 2026-04-22 |
| 11. Quick Mode Recognition & Persistence | v0.4 | 3/3 | Complete | 2026-04-28 |
| 12. Hook & Orchestrator Bifurcation | v0.4 | 3/3 | Complete | 2026-04-28 |
| 13. Test Coverage Matrix | v0.4 | 5/5 | Complete | 2026-04-29 |
| 14. CLI Format Foundation | v0.5 | 3/3 | Complete | 2026-05-05 |
| 15. CLI Polish Wiring | v0.5 | 5/5 | Complete | 2026-05-05 |
| 16. LOG-09 Debt Cleanup | v0.5 | 3/3 | Complete | 2026-05-06 |
| 17. Phase 7 UAT Automation | v0.5 | 5/5 | Complete | 2026-05-10 |
| 999.1. Skill kodo-orchestrate al repo | v0.5 | 5/5 | Complete | 2026-05-11 |
| 18. Worktree Runtime Wiring | v0.6 | 3/3 | Complete    | 2026-05-12 |
| 19. Worktree Cleanup & Integration | v0.6 | 3/3 | Complete    | 2026-05-12 |
| 20. HOOK-01 Universal Anti-Push-Fantasma | v0.6 | 0/2 | Planning complete | — |
| 21. Skill Sync CLI + Auto-Sync | v0.6 | 0/0 | Not started | — |
| 22. Tech Debt v0.5 Closure | v0.6 | 0/0 | Not started | — |

---
*Last updated: 2026-05-12 — Phase 20 planning complete (2 plans, waves 1-2, 100% requirement coverage HOOK-01/02/03; inline implementation per D-04b, append-at-end per D-03, orchestrator EXCLUDED per D-05). Phases 21-22 plans TBD.*
