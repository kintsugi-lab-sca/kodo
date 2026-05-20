# Roadmap: kodo

## Milestones

- ✅ **v0.2 Provider Abstraction** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v0.3 GSD Integration + Structured Logging** — Phases 6-10 (shipped 2026-04-22)
- ✅ **v0.4 GSD Quick Mode** — Phases 11-13 (shipped 2026-04-30)
- ✅ **v0.5 CLI Polish & v0.3 Debt Cleanup** — Phases 14-17 + 999.1 (shipped 2026-05-11)
- ✅ **v0.6 Session Isolation & Skill Sync** — Phases 18-22 (shipped 2026-05-13)
- ✅ **v0.7 GitHub Issues Adapter** — Phases 23-27 (shipped 2026-05-14)
- 🟢 **v0.8 Consolidación + GSD Provider Reporting** — Phases 28-32 (planning, started 2026-05-15)

## Phases

- [ ] **Phase 28: Polling/Daemon Hardening** — Cierra v0.7 tech debt (POLL provider-only path + DAEMON `--verbose` + log file con rotación).
- [ ] **Phase 29: GSD Provider Reporting Integration** — Cherry-pick selectivo de rama paralela `gsd-provider-reporting` + 38 tests heredados + planning regen.
- [ ] **Phase 30: SessionRecord Lifecycle** — `findSession` escanea `state.history` (CR-01) + `markSessionStatus` early-return refactor (WR-07). Driver real ROMAN-132.
- [ ] **Phase 31: Phase 21/22 Advisory Cleanup** — Pureza `syncSkill` + async cleanup `runSkillSyncCli` + test `launchOrchestrator` real.
- [ ] **Phase 32: v0.7 Bookkeeping (Doc-Only)** — Reconciliación traceability v0.7 + Phase 23 VERIFICATION backfill + nyquist toggle 23/25/26/27.

## Phase Details

### Phase 28: Polling/Daemon Hardening
**Goal**: Cerrar el tech debt operacional v0.7 que dejó al daemon de polling sin observabilidad cuando algo va mal — el operador puede diagnosticar crashes, ver decisiones por tick, y confiar en que el provider-only path no descarta timestamps.
**Depends on**: Nothing (heredado state v0.7 verde, baseline 777 tests).
**Requirements**: POLL-FIX-01, DAEMON-01, DAEMON-02
**Success Criteria** (what must be TRUE):
  1. Operador ejecuta `kodo polling start --verbose` (foreground) y ve en stdout una línea estructurada por tick con `timestamp ISO`, `repos_polled`, `dispatch_decisions[]`, `rate_limit_remaining` (formato consistente con `kodo logs`).
  2. Cuando el daemon crashea (SIGSEGV simulado, throw no capturado, etc.), el operador encuentra stack trace inspectable via `cat ~/.kodo/logs/polling-YYYY-MM-DD.log` — el archivo existe con permisos 0o600 y contiene el error completo.
  3. Cualquier consumer que llame `getProvider('github').listPendingTasks()` y luego `shouldDispatch(task)` evalúa contra `task.updated_at` y `task.created_at` reales (ISO strings), nunca `undefined`. `test/providers/github/normalize.test.js` lo asserta directo y `test/triggers/polling.test.js` añade caso provider-only path GREEN.
  4. Suite global ≥780 pass + 0 fail (777 baseline + ≥3 nuevos: 1 normalize + 1 polling provider-only + 1 daemon `--verbose` integration). 1 skip pre-existente preservado.
**Plans**: 3 plans
- [x] 28-01-PLAN.md — POLL-FIX-01: TaskItem 11→13 fields canónicos + normalizers GitHub/Plane simétricos + contract matrix +2 type asserts × 2 providers + test polling provider-only GREEN
- [x] 28-02-PLAN.md — DAEMON-01: evento polling.tick.summary (closed taxonomy 18→19) + emisión cross-repo al final del tick + flag Commander --verbose + foreground subscriber via createFormatter + test integration spawn
- [x] 28-03-PLAN.md — DAEMON-02: módulo polling-logfile.js (resolveLogfilePath + ensureLogsDir + sweepRetention) + fd redirect en daemon spawn (stdio: [ignore, logFd, logFd]) + test unit logfile HOME-isolated + test integration daemon crash
**UI hint**: no

### Phase 29: GSD Provider Reporting Integration
**Goal**: Cerrar la cadena de visibilidad GSD → proveedor reutilizando los 9 commits de código y 38 tests heredados de la rama paralela `gsd-provider-reporting`. El operador activa `workflow.report_to_provider: true` y el agente Claude crea sub-issues `kodo:gsd-child` por phase con comentarios plan-by-plan, sin que kodo cree/lea/borre issues directamente. Anti-recursión blindada en dispatcher.
**Depends on**: Phase 28 (suite verde como baseline antes del cherry-pick masivo).
**Requirements**: REPORT-01, REPORT-02, REPORT-03, REPORT-04, REPORT-05, REPORT-06
**Success Criteria** (what must be TRUE):
  1. Operador crea/etiqueta una tarea con label `kodo:gsd-child` y al disparar webhook/polling/CLI manual (incluso con `--force`), `kodo` log emite `dispatcher.skip reason=gsd-child` SIN llegar a `parseKodoLabels` / lock acquire / resolver / launch — ni una sub-issue creada por el agente puede recursar y arrancar otra sesión.
  2. Operador con `workflow.report_to_provider: true` en `~/.kodo/config.json` lanza una sesión GSD y verifica que `src/orchestrator/prompt.md` renderizado contiene la sección "Sub-issue reporting" entre marcadores `<!-- BEGIN reporting -->` / `<!-- END reporting -->` con prosa ES provider-agnostic (vía `{{provider_name}}`); el mismo operador con la flag `false`, `undefined` o ausente recibe el prompt SIN esa sección.
  3. Cualquier consumer importa `KODO_LABEL_GSD_CHILD` desde `src/labels.js` (NUNCA inline string `'kodo:gsd-child'`) y usa `isGsdChild(labels)` helper — source-hygiene test grep en `src/` retorna 0 matches inline fuera de `labels.js`.
  4. Cherry-pick aplicado de los 9 SHAs documentados en `PENDING-INTEGRATIONS.md` (`5a41d8f`, `cbd8f9c`, `e1f82c9`, `7c28c06`, `5feb578`, `38c7a2e`, `d030547`, `4d67312`, `81c848c`); planning artifacts (PLAN/SUMMARY/VERIFICATION/VALIDATION) regenerados con numeración v0.8 (Phase 29) — NO Phase 14-15 que colisionaba con v0.5 main.
  5. Suite global ≥818 pass (≥780 post-Phase-28 + 38 tests heredados de la rama: SR1..SR6 gating + RC1..RC15 + RA1..RA6 content + 4 dispatcher anti-recursión + matriz config 5 estados + source-hygiene). 0 regresiones, 0 nuevos skips.
**Plans**: 4 plans
- [x] 29-01-PLAN.md — Anti-recursion foundation (REPORT-01 + REPORT-05): cherry-pick 5a41d8f + cbd8f9c + new test/labels-hygiene.test.js walker. 15 tests heredados + 2-3 hygiene net-new. Wave 1.
- [x] 29-02-PLAN.md — Opt-in config helper (REPORT-02): cherry-pick e1f82c9 con manual reapply ANTES de getDefaultGithubProviderConfig (Phase 26 drift). 10 tests heredados (5-state matrix + anti-mutation + source-hygiene). Wave 2.
- [x] 29-03-PLAN.md — Reporting gate infrastructure (REPORT-03): manual reapply 7c28c06 (markers + placeholder en prompt.md, severa por Phase 999.1 rewrite) + cherry-pick 5feb578 + 38c7a2e + 4d67312. 17 tests heredados (LG1..LG8 + LH1..LH3 + SR1..SR6). Wave 3.
- [x] 29-04-PLAN.md — Sub-issue reporting prose (REPORT-04 + REPORT-06): manual reapply d030547 (prosa ES de ~65 líneas reemplaza placeholder) + cherry-pick 81c848c + VERIFICATION.md phase-level. 21 tests heredados (RC1..RC15 + RA1..RA6). Wave 4.
**UI hint**: no

### Phase 30: SessionRecord Lifecycle
**Goal**: Resolver el desync state.json ↔ realidad cmux que ROMAN-132 confirmó empíricamente el 2026-05-15: una sesión seguía viva en cmux mientras `state.sessions = {}`. `findSession` debe ver TODO el ciclo (activas + history) y `markSessionStatus` debe emitir warn observable cuando el caller le pasa task_id falsy en vez de bail-out silencioso.
**Depends on**: Phase 29 (consolidar suite tras el cherry-pick antes de tocar state lifecycle).
**Requirements**: LIFE-01, LIFE-02
**Success Criteria** (what must be TRUE):
  1. Operador ejecuta `kodo gsd verify <session-id>` para una sesión que YA terminó (presente en `state.history`, ausente en `state.sessions`) y obtiene el `SessionRecord` histórico — NO el error "session not found". Idéntico comportamiento para `kodo logs --session-of <task-id>` cuando la sesión cerró.
  2. Cuando `markSessionStatus(taskId, status, reason, log)` recibe `taskId` falsy (`null`, `undefined`, `''`), emite `log.warn('markSessionStatus: missing task_id', {session_id, status, reason})` y retorna `{ok: false, reason: 'missing-task-id'}`. Los callers existentes (`verify.js#finalize`, `stop.js`) preservan su semántica externa (try/catch silencioso intacto).
  3. `test/session/mark-status.test.js` cubre 4 escenarios (task_id presente OK, null → warn, undefined → warn, empty string → warn); `test/session/find-session.test.js` cubre 3 escenarios (en sessions, en history, en ambos = priority sessions, en ninguno = not found).
  4. Suite global ≥825 pass + 0 fail. CR-01 Phase 19 deferred y WR-07 Phase 22 deferred CERRADOS en `STATE.md` v0.7 deferred section.
**Plans**: 2 plans
- [x] 30-01-PLAN.md — LIFE-01: findSession extendido (scan sessions + history, tagged return shape `{id, session, source}`) + test/session/find-session.test.js (4 escenarios HOME-isolated) + verificación empírica pitfall #1 (session-lookup.js step-2 cubre archived NDJSON). Wave 1.
- [x] 30-02-PLAN.md — LIFE-02: markSessionStatus refactor (falsy guard observable + discriminated union return + 5º param sessionId opcional) + 2 callsites actualizados (verify.js#267 + stop.js#188) + test/session/mark-status.test.js (4 escenarios fakeLogger memSink). Wave 1.
**UI hint**: no

### Phase 31: Phase 21/22 Advisory Cleanup
**Goal**: Limpiar las 3 advisory observations de las phases 21 y 22 v0.6 que quedaron como tech debt no-bloqueante. Pureza de `syncSkill` (warn callback inyectable), `runSkillSyncCli` con await correcto del cleanup async, y test `launchOrchestrator` real (no mockSpawn-only) que valida observable post-launch.
**Depends on**: Phase 30 (state lifecycle estable).
**Requirements**: ADVISORY-01, ADVISORY-02, ADVISORY-03
**Success Criteria** (what must be TRUE):
  1. `syncSkill({onConsoleWarn})` acepta callback opcional y usa `console.warn` por default cuando no se inyecta — back-compat preservada para `runSkillSyncCli`. Tests capturan warnings sin spy global ni monkey-patch de `console.warn`.
  2. `runSkillSyncCli` ejecuta `await cleanupFn()` ANTES de `process.exit(N)` — verificable con test que asserta exit ordering (cleanup callback completa observablemente antes del exit code retornado al shell).
  3. Test `test/orchestrator/launch.test.js` (o equivalente) ejecuta `launchOrchestrator` con spawn real (NO mockSpawn) + stdin canónico y asserta observables post-launch: `state.json` contiene la nueva session record + NDJSON contiene evento `session.start` con `transcript_path` populated.
  4. Suite global ≥830 pass + 0 fail. Phase 21 WR-04/WR-05/WR-06 entries CERRADAS en `v0.6-MILESTONE-AUDIT.md` (o equivalente tracker); STATE.md v0.6 deferred section reduce a 0 items.
**Plans**: TBD
**UI hint**: no

### Phase 32: v0.7 Bookkeeping (Doc-Only)
**Goal**: Cerrar los 3 items de bookkeeping drift identificados en `v0.7-MILESTONE-AUDIT.md` — pure doc-only, cero código tocado. Reconciliación REQUIREMENTS traceability, backfill VERIFICATION.md Phase 23 por uniformidad documental, y toggle `nyquist_compliant: true` en VALIDATION.md de las 4 phases v0.7 que quedaron en `false`.
**Depends on**: Phase 31 (último gate antes del milestone audit v0.8).
**Requirements**: BOOK-01, BOOK-02, BOOK-03
**Success Criteria** (what must be TRUE):
  1. `.planning/milestones/v0.7-REQUIREMENTS.md` traceability table tiene 16/16 IDs marcados `Complete` — `grep -c "Complete"` retorna 16 y `grep -c "pending"` retorna 0 (en la tabla, no en prosa adyacente). Reconciliados: GH-01..05, CFG-01, CFG-02, TEST-01.
  2. `.planning/milestones/v0.7-phases/23-githubclient-auth-foundation/VERIFICATION.md` existe con contenido coherente con los 2 SUMMARYs de Phase 23 (placeholder estructural OK; ya hay cobertura funcional empírica documentada en SUMMARYs).
  3. VALIDATION.md de phases 23/25/26/27 contiene `nyquist_compliant: true` en su YAML frontmatter — `grep -l "nyquist_compliant: true" .planning/milestones/v0.7-phases/*/VALIDATION.md` lista las 5 phases (24 ya tenía, ahora 23/25/26/27 también).
  4. Phase es 100% commits doc-only — `git diff <phase-base>..<phase-head> -- src/ test/ bin/` retorna vacío (cero líneas tocadas en código). Suite global ≥830 pass (sin cambio numérico vs Phase 31).
**Plans**: TBD
**UI hint**: no

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 28. Polling/Daemon Hardening | 3/3 | Complete   | 2026-05-18 |
| 29. GSD Provider Reporting Integration | 4/4 | Complete    | 2026-05-20 |
| 30. SessionRecord Lifecycle | 3/3 | Complete   | 2026-05-20 |
| 31. Phase 21/22 Advisory Cleanup | 0/TBD | Not started | - |
| 32. v0.7 Bookkeeping (Doc-Only) | 0/TBD | Not started | - |

## Archived Milestones

<details>
<summary>✅ v0.7 GitHub Issues Adapter (Phases 23-27) — SHIPPED 2026-05-14</summary>

- [x] Phase 23: GitHubClient + Auth Foundation (2/3 plans, 23-03 optional/skipped) — completed 2026-05-14
- [x] Phase 24: GitHubProvider + Normalizer + Registry (3/3 plans) — completed 2026-05-14
- [x] Phase 25: Polling Trigger Channel (2/2 plans) — completed 2026-05-14
- [x] Phase 26: Config Wizard + CLI Integration (3/3 plans) — completed 2026-05-14
- [x] Phase 27: Cross-Provider Contract Matrix (1/1 plan) — completed 2026-05-14

Full details: `.planning/milestones/v0.7-ROADMAP.md`
Milestone audit: `.planning/v0.7-MILESTONE-AUDIT.md`
Requirements archive: `.planning/milestones/v0.7-REQUIREMENTS.md`

</details>

<details>
<summary>✅ v0.6 Session Isolation & Skill Sync (Phases 18-22) — SHIPPED 2026-05-13</summary>

- [x] Phase 18: Worktree Runtime Wiring (3/3 plans) — completed 2026-05-12
- [x] Phase 19: Worktree Cleanup & Integration (2/2 plans) — completed 2026-05-12
- [x] Phase 20: HOOK-01 Universal Anti-Push-Fantasma (2/2 plans) — completed 2026-05-12
- [x] Phase 21: Skill Sync CLI + Auto-Sync (2/2 plans) — completed 2026-05-12
- [x] Phase 22: Tech Debt v0.5 Closure (3/3 plans) — completed 2026-05-13 (WR-07 deferred)

Full details: `.planning/milestones/v0.6-ROADMAP.md`
Milestone audit: `.planning/v0.6-MILESTONE-AUDIT.md`
Requirements archive: `.planning/milestones/v0.6-REQUIREMENTS.md`

</details>

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

## Historical Progress (shipped phases)

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
| 18. Worktree Runtime Wiring | v0.6 | 3/3 | Complete | 2026-05-12 |
| 19. Worktree Cleanup & Integration | v0.6 | 3/3 | Complete | 2026-05-12 |
| 20. HOOK-01 Universal Anti-Push-Fantasma | v0.6 | 2/2 | Complete | 2026-05-12 |
| 21. Skill Sync CLI + Auto-Sync | v0.6 | 2/2 | Complete | 2026-05-12 |
| 22. Tech Debt v0.5 Closure | v0.6 | 3/3 | Complete | 2026-05-13 |
| 23. GitHubClient + Auth Foundation | v0.7 | 2/3 (23-03 skipped) | Complete | 2026-05-14 |
| 24. GitHubProvider + Normalizer + Registry | v0.7 | 3/3 | Complete | 2026-05-14 |
| 25. Polling Trigger Channel | v0.7 | 2/2 | Complete | 2026-05-14 |
| 26. Config Wizard + CLI Integration | v0.7 | 3/3 | Complete | 2026-05-14 |
| 27. Cross-Provider Contract Matrix | v0.7 | 1/1 | Complete | 2026-05-14 |

---
*Last updated: 2026-05-20 — Phase 30 planning complete. 2 plans created (30-01 LIFE-01 findSession + history scan, 30-02 LIFE-02 markSessionStatus observability refactor). Both Wave 1 (independent files: state.js vs manager.js+verify.js+stop.js). Phase 30 cierra CR-01 Phase 19 deferred + WR-07 Phase 22 deferred. Driver: ROMAN-132 (2026-05-15) state.json desync.*
