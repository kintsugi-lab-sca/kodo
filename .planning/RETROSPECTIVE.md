# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v0.2 — Provider Abstraction

**Shipped:** 2026-04-13
**Phases:** 5 | **Plans:** 10 | **Tasks:** 20

### What Was Built
- TaskProvider interface (9 methods) as the universal contract for task management systems
- PlaneProvider as first validated adapter with normalizer, HMAC, and label resolution
- Provider registry with lazy init and singleton caching
- All 4 internal consumers rewired from PlaneClient to TaskProvider
- Central dispatchTrigger + pure handleWebhookRequest replacing monolithic server
- Provider-agnostic config wizard, ensureConfig guard, and orchestrator prompt templates

### What Worked
- **TDD with pure helper extraction:** Every consumer was testable without mock.module by extracting pure functions with DI parameters. This pattern was established in Phase 3 and carried through Phase 4-5 without friction.
- **Wave-based execution:** Sequential waves (2 plans per phase) kept dependencies clean. No plan ever failed due to missing prerequisites from a prior wave.
- **Small plans, fast execution:** Each plan had exactly 2 tasks, averaging 3 minutes of execution. The entire milestone's 10 plans executed in ~30 minutes of agent time.
- **Verification at every phase:** Phase-level verification caught the INTF-01 docs inconsistency and CONF-03 cosmetic issue early, preventing them from becoming milestone blockers.

### What Was Inefficient
- **Roadmap progress tracking drift:** The ROADMAP.md progress table and plan checkboxes didn't stay in sync — some phases showed "In Progress" or wrong plan counts at milestone completion. The execution agents updated STATE.md but ROADMAP.md checkboxes lagged.
- **Performance metrics in STATE.md:** The velocity/trend section remained empty placeholders despite plans completing. The gsd-tools `roadmap update-plan-progress` didn't populate these fields.

### Patterns Established
- **Pure helper + DI deps pattern:** `function doWork(input, deps = { getProvider, listSessions, ... })` — default production deps, test injects mocks
- **Provider-specific code lives in `src/providers/<name>/`:** Generic modules never import from a provider directory
- **Template placeholders for provider references:** `{{provider}}`, `{{provider_name}}`, `{{mcp_tool}}` in any user-facing text
- **ensureConfig guard on CLI commands:** Commands that need a provider call ensureConfig() first, auto-launching the wizard on first run

### Key Lessons
1. **2-task plans execute faster and more reliably than larger plans.** Every plan in v0.2 had exactly 2 tasks and none failed. The overhead of more plan files is negligible compared to the reliability of smaller atomic units.
2. **Phase verification is cheap and catches real issues.** The verifier agent runs in ~2 minutes and caught documentation inconsistencies that the audit later confirmed. Without it, these would have been discovered at audit time (more expensive to fix).
3. **State migration should clear incompatible data, not try to translate it.** The decision to wipe v1 sessions instead of migrating them per-field was validated — no corruption, no edge cases, clean break.

### Cost Observations
- Model mix: executor agents on inherit (opus), verifier on sonnet, integration checker on sonnet
- 10 executor sessions + 5 verifier sessions + 1 integration checker = 16 agent sessions
- Notable: Each executor averaged ~65k tokens and 67 tool uses — consistent across all 10 plans

---

## Milestone: v0.3 — GSD Integration + Structured Logging

**Shipped:** 2026-04-22
**Phases:** 5 (6-10) | **Plans:** 25 | **Tasks:** ~50

### What Was Built
- NDJSON logger foundation con redactor de secretos y vigilante aislado (Phase 6 — LOG-01..04, LOG-08, LOG-12)
- `kodo logs` CLI con filtros, `--follow` tail, `--session-of` resolver, y taxonomía de 8 eventos tipados (Phase 7 — LOG-05..07, LOG-09..11)
- Label `kodo:gsd` propagada end-to-end, per-repo file lock con PID+TTL, inyección de contexto GSD en session-start (Phase 8 — GSD-01, GSD-04, GSD-10)
- Phase resolver con discriminated union + bootstrap condicional + `kodo gsd inspect` dry-run (Phase 9 — GSD-02, GSD-03, GSD-08, GSD-09)
- Orchestrator verification gate: parser puro + orquestación Plane comment/transition + CLI `kodo gsd verify` + integración prompt/launch/stop (Phase 10 — GSD-05, GSD-06, GSD-07)

### What Worked
- **Worktree-based parallel execution:** Wave 2 de Phase 10 lanzó 10-02 y 10-04 simultáneos en worktrees aislados. Ambos mergearon sin conflictos y sin overhead de context bleed en el orchestrator.
- **CONTEXT.md + PATTERNS.md + DISCUSSION-LOG per-phase:** facilitó onboarding del agente ejecutor. Phase 9 y 10 se beneficiaron de decisiones D-NN con rationale explícito antes de ejecutar.
- **TDD RED→GREEN commits atómicos:** obligaron a resolver la forma antes de implementar. Phase 10 tuvo 3 ciclos RED/GREEN limpios.
- **Discriminated union fail-closed pattern:** `PhaseVerdict | BootstrapVerdict | ErrorVerdict` en resolver (Phase 9) y `PassVerdict | FailVerdict | MissingVerdict | MalformedVerdict` en verify (Phase 10) dan exhaustive switch en callsites y detectan errores en compile (@ts-check).
- **Zero runtime deps en los parsers:** `parseRoadmap`, `parseVerificationFrontmatter`, `parseKodoLabels` — hand-rolled regex + parseInt. Evitó debate sobre YAML lib y rinde bien en tests.
- **Code-review agents sobre las fases grandes:** 10-REVIEW.md detectó 3 warnings reales (bootstrap comment vacío, EACCES silencioso, raw strings fuera del catálogo) que el milestone audit confirmó independientemente. Se arreglaron post-audit sin necesidad de plan formal.

### What Was Inefficient
- **Worktree cleanup frágil en paralelo:** los git locks de `.git/index.lock` y `.git/config.lock` provocaron merges fantasmas en Wave 2 de Phase 10 (commits huérfanos que hubo que re-mergear). Síntoma del orchestrator corriendo `cd` hacia worktrees ya eliminados.
- **REQUIREMENTS.md traceability stale:** 8 checkboxes quedaron `[ ]` aunque las fases se verificaron. El `gsd-tools phase complete` no actualiza los checkboxes individuales de REQUIREMENTS.md — se detectó sólo en el milestone audit y se corrigió manualmente al completar.
- **Event taxonomy no siempre usada consistentemente:** `verify.js` emitía `plane.api.call.failed` como string crudo, y `dispatcher.js` sigue usando literales para `gsd.phase.resolved`/`gsd.bootstrap`. El catálogo `EVENTS` existe pero no hay guard que impida saltárselo.
- **Nyquist validation quedó en draft:** Phases 6-8 tienen `VALIDATION.md` pero `nyquist_compliant: false`, Phases 9-10 ni siquiera lo tienen. No se integró en el flujo diario de ejecución y se perdió como artefacto vivo.
- **Phase 7 human UAT no se cerró:** `07-HUMAN-UAT.md status: partial` con 3 tests pendientes llegó hasta milestone close como tech debt aceptada. Requieren sesión real + humano, pero debieron haberse ejecutado antes de marcar Phase 7 como verified.

### Patterns Established
- **Fail-open side-effects, fail-closed parsing:** los módulos puros (verification.js, resolver.js, roadmap.js) fallan-closed con verdict estructurado; los orquestadores con side-effects (verify.js, dispatcher.js) atrapan cada llamada Plane en try/catch individual y degradan el legacy verdict cuando side-effects fallan.
- **Provider hoisted once per execution:** un solo `await getProviderFn()` al principio de un flujo de side-effects, reusado en todas las llamadas — evita double init y facilita spies en tests.
- **Deterministic comment rendering:** sin timestamp, mismo verdict → mismos bytes. Habilita dedup futuro por content-hash.
- **Exit codes deterministas en CLI handlers:** 0 para cualquier verdict (output-is-the-signal), 1 para errores internos, 2 para transient con regex-match sobre `error.message`. Pattern shared entre `gsd-inspect` y `gsd-verify`.
- **Catálogo `EVENTS` + helpers por tipo de evento:** un único punto de verdad para la taxonomía LOG-09; consumers importan helpers, no literales (aunque la adopción no es 100% todavía).
- **Code review + milestone audit independientes:** el code review agent produce `10-REVIEW.md` con findings de código; el milestone audit cruza eso con integración cross-phase y requirements coverage. Ambos detectaron la misma raw string (WR-03 / INT-HIGH-01) — señal de que el cross-check funciona.

### Key Lessons
1. **Planes grandes (2-6 tareas) también ejecutan limpio con los context files adecuados.** Phase 10 tuvo planes de 3-4 tareas cada uno y ejecutaron igual de bien que los de 2 en v0.2, porque CONTEXT/PATTERNS/DISCUSSION-LOG hacen el trabajo previo.
2. **Worktree parallelism amortiza desde 2 planes paralelos.** El overhead de `git worktree add`/`remove` se compensa con ahorro de context en el orchestrator, pero requiere manejo cuidadoso de los locks.
3. **El code review agent al final de fases grandes pescó bugs que los tests no veían.** Comentarios vacíos de "Phase " y EACCES silenciosos no aparecían en tests unitarios — los detectó el review porque lee el shape del comentario renderizado y el código de manejo de errores.
4. **"Tech debt aceptada" sólo funciona si se anota en sitios que sobreviven al close del milestone.** Los UATs pendientes de Phase 7 quedaron en `07-HUMAN-UAT.md` + milestone audit — si no se surface en el siguiente milestone via `/gsd-progress` o equivalente, se pierden.
5. **Updates de REQUIREMENTS.md deben ir en el commit de verificación de cada fase, no al final del milestone.** Dejarlos para el close rompe la traza durante el milestone.

### Cost Observations
- Model mix: executor agents opus (isolation=worktree), verifier sonnet, integration-checker sonnet, code-reviewer inherit
- Phase 10 ejecutó 4 planes en 3 waves con 4 sesiones executor (≈100-180k tokens cada una) + 1 sesión code-review + 1 verifier + 1 integration-checker = 7 agent sessions
- Milestone total: ~35-40 agent sessions across 5 phases
- Notable: las sesiones con worktree isolation consumieron ~30% más tokens que sequential por el overhead del `worktree_branch_check` inicial, pero devolvieron más rápido al orchestrator

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Plans | Phases | Key Change |
|-----------|-------|--------|------------|
| v0.2 | 10 | 5 | Established TDD + pure helper extraction pattern |
| v0.3 | 25 | 5 | Added CONTEXT/PATTERNS/DISCUSSION-LOG + worktree parallelism + code review gate |

### Cumulative Quality

| Milestone | Tests | LOC (src) | LOC (test) |
|-----------|-------|-----------|------------|
| v0.2 | 122 | 2,782 | 1,868 |
| v0.3 | 366+ | ~5,400 | ~6,280 |

### Top Lessons (Verified Across Milestones)

1. Small plans (2 tasks) execute reliably — zero failures across 10 plans
2. Pure helper extraction + DI > mock.module for Node.js test runner compatibility
