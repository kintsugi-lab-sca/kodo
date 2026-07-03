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

## Milestone: v0.4 — GSD Quick Mode

**Shipped:** 2026-04-30
**Phases:** 3 (11-13) | **Plans:** 11 | **Tasks:** ~22

### What Was Built
- `getGsdMode(flags)` + `getSessionMode(session)` como ÚNICAS fuentes de derivación de modo, con precedencia `gsd-quick > gsd` y fallback legacy a `'full'` (Phase 11 — QUICK-01)
- `gsd_mode: 'full'|'quick'` persistido en `SessionRecord` desde `buildSessionFromTask` + skip-permissions parity para `kodo:gsd-quick` (Phase 11 — QUICK-03, QUICK-04)
- Resolver tolerance en quick: descarta `phase_id` con match (phase-agnostic), tolera `code:'no-match'` continuando al launch, mantiene `roadmap-missing` y `multi-match` fail-closed (Phase 11 — QUICK-02)
- SessionStart hook bifurca: `/gsd-quick "<title>"` para quick (one-shot), bloque `/gsd-plan-phase → /gsd-execute-phase → /gsd-verify-work` para full (Phase 12 — QUICK-05)
- Stop hook switch exhaustivo de 3 cases (`quick` sin verify, `full` con verify nudge, `default` no-GSD); lock release compartido entre full y quick (Phase 12 — QUICK-06)
- `buildContextSummary` del orchestrator emite 3 etiquetas (`[GSD quick]`, `[GSD phase N]`, `[GSD bootstrap]`); `prompt.md` § "Sesiones GSD" aclara que quick no se verifica (Phase 12 — QUICK-07)
- Test coverage matrix: 4 estados de label × 7 sitios de la cadena + invariants source-hygiene D-09/D-10/D-11 (Phase 13 — QUICK-08; 44 tests añadidos contra src grep en 6 archivos test)

### What Worked
- **Helper-as-single-source-of-truth + tests anti-inline:** `getGsdMode`/`getSessionMode` definidos una vez en `src/labels.js`; los tests `D-09/D-10/D-11 source-hygiene` en Phase 13 grepean el código productivo para detectar regresiones donde alguien lea `flags.includes('gsd-quick')` o `session.gsd_mode` inline. La mitad del test budget de Phase 13 (≈22 de 44 tests) son guardas estructurales, no behavior — y atrapan drift que los tests behavior no verían.
- **Phase 13 sequential executor mode (sin worktree):** 5 plans pequeños (1-2 tasks cada uno) ejecutados secuencialmente en 1-3 min cada uno, total ~10 min. Cero overhead de worktree merge, cero conflictos. Para fases test-only sin sobreposición de archivos, sequential venció a parallel-worktree en simplicidad.
- **CONTEXT.md con D-NN decisions traídas a Phase 13:** las decisiones D-09/D-10/D-11 anti-inline se redactaron en Phase 12 CONTEXT y se ejecutaron como tests en Phase 13 sin re-discutir. El CONTEXT funcionó como contrato cross-phase.
- **0 deviations across 11 plans:** todos los plans ejecutaron al pie de la letra. Plan-checker + research light + 1-2 task plans mantuvieron la varianza baja.
- **Gap-closure por "fail-open en helper" (Phase 11 D-08):** cuando se detectó que sesiones legacy v0.3 sin `gsd_mode` se romperían, la solución fue añadir el fallback en `getSessionMode` (un sitio) en lugar de cambiar el shape persistido. La compatibilidad backward salió gratis.

### What Was Inefficient
- **`requirements mark-complete` no se ejecutó tras Phase 11/12 verify:** QUICK-01..QUICK-07 quedaron `[ ]` en `REQUIREMENTS.md` durante todo Phase 13 aunque sus VERIFICATION.md estaban PASS. El gsd-tools no automatiza esto; el flujo de verify dejó el cierre como acción manual implícita. Se descubrió en milestone close, hubo que cerrar 7 reqs en bloque en un commit aparte.
- **execute-plan.md mark-complete demasiado eager:** Plan 13-01 marcó QUICK-08 como complete tras la primera de 5 plans porque el plan declara contribuir a QUICK-08 — el helper no entiende que QUICK-08 abarca 5 plans. Se revirtió manualmente; las 4 plans siguientes recibieron instrucción explícita de NO marcar complete. Faltaría señalización en el plan ("contributes_to" vs "closes") o un check en gsd-tools que verifique todos los plans del req antes de cerrar.
- **`gsd-tools audit-open` roto:** lanza `ReferenceError: output is not defined` en `gsd-tools.cjs:786`. El workflow de complete-milestone lo invoca como pre-flight check; no bloqueó pero perdimos la señal. Reportar en el upstream.
- **`gsd-tools state record-metric` / `state add-decision` silenciosos:** el ejecutor de Plan 13-01 reportó que estos comandos no encontraban las secciones esperadas en STATE.md (formato narrativo personalizado). Skip silencioso = ruido invisible si los plans los llamaban por costumbre y nadie miraba.
- **`gsd-tools milestone complete` advirtió "STATE.md field Last Activity Description not found":** mismo síntoma — la herramienta espera un schema y STATE.md ha derivado a freeform. Siguen funcionando los archives, pero la actualización de STATE quedó parcial (el orchestrator tuvo que reescribirla a mano).

### Patterns Established
- **Source-hygiene tests via grep contra src:** `assert(!fs.readFileSync(...).includes('flags.includes(\'gsd-quick\')'))`. Barato de añadir, atrapa drift que el behavior no ve. Bien para invariantes "DRY hard-enforced" donde un helper es la única fuente legítima.
- **Switch exhaustivo sobre `getSessionMode(session)`:** 3 cases (quick / full / default) con default que cae al comportamiento pre-quick. Reemplaza chains `if (session.gsd_mode === 'quick') ... else if (session.gsd) ...` que dispersan la lógica de modo.
- **"Aditivo y opcional" para campos nuevos en SessionRecord:** `gsd_mode` se añade sin migrar sesiones existentes; `falsy/missing → 'full'` por compat. Pattern reutilizable para v0.5+ si añadimos flags adicionales.
- **Verifier inline cuando el agente verifier hace stream timeout:** Phase 12 lo necesitó (gsd-verifier opus con stream idle); Phase 13 funcionó normal (sonnet). Útil tener el fallback manual como backup.

### Key Lessons
1. **`requirements mark-complete` debe ir en el commit de cada VERIFICATION.md, no al final.** Si las herramientas no lo automatizan, hay que añadirlo al script de verify o al template del verifier. Repetimos el mismo bug que en v0.3.
2. **Plans que contribuyen a un mismo requirement deben señalizar "contributes" vs "closes".** Phase 13 partió QUICK-08 en 5 plans, cada uno cerrando un subset de los 8 success criteria. El primer plan no debería poder cerrar el req entero sólo porque lo nombra en su frontmatter.
3. **Source-hygiene tests valen su peso si la regla "una sola fuente del helper" es non-negotiable.** Coste: ~3 tests por sitio. Beneficio: refactor agresivo sin miedo a re-introducir lógica inline. Recomendado para próximos helpers cross-cutting (pe. eventual `getProviderMode()` si añadimos provider-specific routing).
4. **Para fases test-only con archivos disjuntos, sequential vence a parallel-worktree.** El overhead de creación/merge/cleanup de worktrees pesa más que el ahorro de paralelismo cuando los plans son <3 min cada uno y no hay solapamiento.
5. **STATE.md freeform vs schema:** la herramienta `gsd-tools state record-*` espera secciones canónicas. Cuando STATE.md se personaliza (como en kodo), las llamadas son no-ops silenciosos. O alineamos el schema o documentamos que esos comandos no aplican.

### Cost Observations
- Model mix: executor agents opus (sequential, no worktree), verifier sonnet, code-reviewer no se invocó en Phase 13 (test-only)
- Phase 13 ejecutó 5 plans secuenciales en ~10 min de orchestrator-time + 1 verifier sonnet ~4 min = 6 agent sessions
- Milestone total: ~20-25 agent sessions across 3 phases
- Notable: cada executor de Phase 13 quedó <130k tokens (test-only, src no se tocó). Sequential mode mantuvo el orchestrator <15% context budget al final.

---

## Milestone: v0.5 — CLI Polish & v0.3 Debt Cleanup

**Shipped:** 2026-05-11
**Phases:** 5 (14-17 + 999.1) | **Plans:** 21 | **Tasks:** ~30

### What Was Built
- Helper `src/cli/format.js` con factory `createFormatter(stream, env?)` — única fuente de color/format con eager `useColor` precedence `NO_COLOR > FORCE_COLOR > stream.isTTY` (Phase 14 — DX-06, DX-07)
- `picocolors@^1.1.1` como 2ª dep prod y única fuente de ANSI; `test/format-isolation.test.js` blinda single-source via grep + LOG-12 extension walker (Phase 14)
- 5 callsites del CLI cableados al helper: `kodo logs` (logger.js shape dual + columnar), `kodo check` (3 ANSI inline → fmt.* via DI), `kodo gsd inspect` (4 secciones + Exit:N), `kodo gsd verify` (verdict color + `plane.comment_body` slice) (Phase 15 — DX-01..05)
- LOG-09 cerrado: `dispatcher.js` literales → `EVENTS.*` con comment-aware grep; `markSessionStatus` cableado en `verify.js#finalize` rama pass (try/catch silencioso preserva D-17) y `stop.js` PRE-`releaseGsdLock` dentro de `if (session.gsd)` (D-08 emit-before-mutation) (Phase 16 — LOG-13..15)
- 3 UATs humanos de Phase 7 automatizados como integration tests: `logs-follow-integration` (subprocess + 3 batches + SIGINT cleanup), `session-start-event` (spawn hook + 6 keys D-10 + fail-loud), `session-of-resolver` (4 escenarios spawnSync con exit codes deterministas) (Phase 17 — UAT-01..03)
- Skill `kodo-orchestrate` migrada a `.claude/skills/kodo-orchestrate/skill.md` como source canonical provider-agnostic (3 tags GSD literales, 4 flujos diagnóstico CLI, mapping `~/.kodo/projects.json`); `src/orchestrator/prompt.md` reducido a fallback degradado (~37 LOC); `stop.js` con `KODO_ROOT` env override + path `.claude/skills/` (Phase 999.1 — D-01..D-17)

### What Worked
- **Helper-as-single-source + isolation tests (Phase 14):** el patrón de v0.4 (`getGsdMode`/`getSessionMode` + grep tests) se replicó como `createFormatter` + `test/format-isolation.test.js`. Atrapó intentos de leak de `picocolors` en otros archivos y bloqueó regresión hacia `src/logger.js`. Coste: ~3 asserts; beneficio: refactor de 5 callsites sin miedo a drift.
- **Golden bytes contract para `--json`:** la decisión de hacer early-return (NO pasar a través con `useColor=false`) garantizó bytes idénticos al output pre-Phase 14 sin depender del helper. Phase 15 mantuvo el contrato sin fricción.
- **Emit-BEFORE-mutation (D-08) en Phase 16:** invertir el orden de `markSessionStatus` + `releaseGsdLock` (emit primero, release después) hizo el test mucho más simple — si el emit falla, el operador ve el intento. Patrón replicable para otras transiciones.
- **Integration tests via spawnSync real (Phase 17):** los 3 UATs se automatizaron con subprocess real (no mock) — `test/logs-follow-integration.test.js` arranca `bin/kodo logs --follow` y observa los exit codes deterministas. Cobertura equivalente a UAT humano sin coste recurrente. Sin sleeps largos (depende del watcher poll de fs.watchFile).
- **Wave parallel + revert-to-spawnSync en Phase 999.1:** el plan revisó la primera versión (que importaba `handleOrchestratorStop` in-process) y volvió al patrón canon de Phase 16-17 (`spawnSync` child contra tmpdir aislado). Ahorró tiempo de debug en runtime.
- **Code-review agents pescaron lo que tests no veían:** `16-REVIEW.md` (8 WR + 4 IN) y CR-01/WR-01/WR-03 en Phase 999.1 — ninguno bloqueante, pero documentados explícitamente como Resolution Log y aplazados/aceptados con rationale. Cross-check con milestone audit confirmó las findings.

### What Was Inefficient
- **`gsd-sdk milestone.complete` sólo registró Phase 999.1 en MILESTONES.md:** el SDK contó `phase_count: 1, plans: 5` porque las fases 14-17 ya tenían `<details>` summary en ROADMAP.md (formato similar al shipped). Hubo que reescribir manualmente la entrada de MILESTONES.md con las 5 fases. Si el SDK leyera el grupo "🚧 IN PROGRESS" del ROADMAP, contaría correctamente.
- **STATE.md sobrescrito con cifras parciales por el SDK:** `milestone.complete` puso `total_phases: 1` reflejando sólo Phase 999.1. Tuvimos que regenerar STATE.md a mano post-archive. El SDK necesita acoplarse mejor a la realidad multi-phase de un milestone.
- **Audit stale al cerrar:** `v0.5-MILESTONE-AUDIT.md` se generó 2026-05-06 con Phase 17 unstarted (`gaps_found`). Phase 17 y 999.1 cerraron días después. El audit nunca se re-corrió, así que el archivo de auditoría que se mueve a `milestones/` refleja un estado intermedio. Mejora: `/gsd-audit-milestone` debería volver a correr automáticamente al cerrar, o el cierre debería invalidar y regenerar.
- **Checkbox drift en REQUIREMENTS.md (DX-01..07):** mismo patrón visto en v0.3/v0.4 — los `[ ]` quedaron sin marcar `[x]` aunque las VERIFICATION.md de Phases 14/15 las marcaban SATISFIED. Se corrigió manualmente al cierre. Sigue siendo deuda del workflow: `requirements mark-complete` por fase no es un hábito sistemático.
- **Phase 14 sin `SECURITY.md`:** `/gsd-secure-phase 14` quedó como recomendación opcional del audit y no se ejecutó. Phase es low-risk presentation-only, pero el artefacto faltante deja una grieta de proceso.

### Patterns Established
- **Factory + bound methods + DI-by-descriptor:** `createFormatter(stream, env?)` devuelve object literal con bound methods, mirror de `src/logger.js#makeNode`. Los callsites pasan `process.stdout`/`process.stderr` en lugar de write fns — el formatter resuelve `isTTY` internamente. Patrón reutilizable para futuros helpers cross-cutting (eventual `createMetrics(stream)` o similar).
- **`--json` bypasea el helper (early-return):** decisión explícita Phase 15 D-08. Más simple y determinista que "pasar a través con useColor=false". Aplicable a cualquier flag de output estructurado en el futuro.
- **`KODO_ROOT` env override (aditivo) en hooks:** Phase 999.1 D-16 introdujo `process.env.KODO_ROOT || join(__dirname, '..', '..')` en `stop.js` para que tests spawnSync apunten a tmpdir aislado sin romper el default. Patrón replicable para cualquier hook con paths absolutos.
- **Skill canonical en `<repo>/.claude/skills/` (NO en `~/.claude/skills/`):** decisión Phase 999.1 D-04..D-06. Source único, versionado con el código. Trade-off: requiere cwd=repo (Constraint añadida). `SKILL-01` (`kodo skill sync`) queda diferido condicional a fricción real.
- **Comment-aware grep tests:** `test/dispatcher-isolation.test.js` con asserts que filtran comentarios D-NN históricos antes de greppear literales. Permite preservar referencias documentales sin romper la guarda.

### Key Lessons
1. **El SDK no es la única fuente de verdad para MILESTONES.md.** `gsd-sdk milestone.complete` sirve como base (archive + audit move + skeleton entry), pero el contenido narrativo y los counts cruzados los tiene que escribir el orquestador a mano. No es bug, es la división del trabajo — pero hay que documentarlo en el workflow.
2. **El audit no debe morir al cerrar el milestone; debe correrse de nuevo.** Un audit `gaps_found` de hace 5 días NO refleja el milestone real al cerrar. O re-corremos `/gsd-audit-milestone` automáticamente al iniciar `/gsd-complete-milestone`, o invalidamos el viejo y exigimos uno fresco.
3. **`spawnSync` child + tmpdir aislado es el patrón canon para tests de hooks.** Phase 16 SC#5 lo estableció, Phase 17 lo reusó (3 tests), Phase 999.1 lo replicó por tercera vez. Tres ejemplos diferentes confirman el patrón: nunca importar el hook in-process; siempre spawnar.
4. **`requirements mark-complete` automatizado YA debería ser parte del verifier o del execute-plan.** Tres milestones (v0.3, v0.4, v0.5) con el mismo bug de checkbox drift — es momento de cerrarlo en herramienta.
5. **Tech debt explícita en Resolution Log > tech debt implícita en backlog.** `16-REVIEW.md` con 8 WR + 4 IN aplazados con rationale firmado es mejor que "lo arreglamos en v0.6" sin papel. El Resolution Log sobrevive al milestone close.
6. **El orchestrator se lanza desde cwd=repo y eso es un contrato operativo, no un bug:** Phase 999.1 sketcheó `kodo skill sync` (SKILL-01) y decidió que la fricción de exigir cwd=repo es menor que la complejidad de sincronizar dos copias. Constraint > código nuevo cuando se puede.

### Cost Observations
- Model mix: executor agents opus (Phase 14/15/16 con worktree, Phase 17 sequential, Phase 999.1 mixed); verifier sonnet; code-reviewer inherit; orchestrator opus
- Phase 14: 3 plans × 1 executor + 1 verifier + 1 validator retroactivo = 5 sessions
- Phase 15: 5 plans × 1 executor + 1 verifier + 1 code-reviewer = 7 sessions (Wave 1 con 4 paralelos en worktrees)
- Phase 16: 3 plans × 1 executor + 1 verifier + 1 code-reviewer = 5 sessions
- Phase 17: 5 plans × 1 executor + 1 verifier + 1 code-reviewer = 7 sessions (sequential, sin worktree)
- Phase 999.1: 5 plans × 1 executor (3 paralelos Wave 1 + 2 Wave 2) + 1 verifier + 1 code-reviewer = 8 sessions
- Milestone total: ~32 agent sessions across 5 phases
- Notable: las fases con worktree Wave parallel (15, 16, 999.1) consumieron ~25% más tokens por sesión que sequential, pero el orchestrator se mantuvo <20% context budget al final del milestone.

---

## Milestone: v0.8 — Consolidación + GSD Provider Reporting

**Shipped:** 2026-05-25
**Phases:** 6 (28-33) | **Plans:** 20 | **Tasks:** ~60
**Audit:** PASSED (re-auditado tras Phase 33; verdict original TECH_DEBT cerrado)

### What Was Built
- Polling/Daemon hardening: TaskItem canónico 11→13 fields (`updated_at`/`created_at` REQUIRED, cierra D-18 leak guard); `kodo polling start --verbose` con `polling.tick.summary` por tick; daemon log file `~/.kodo/logs/polling-YYYY-MM-DD.log` (0o600 + retención 7 días) (Phase 28 — POLL-FIX-01, DAEMON-01/02)
- GSD Provider Reporting: anti-recursión `kodo:gsd-child` (corte pre-lock/resolver/launch), opt-in `workflow.report_to_provider` strict `=== true`, `applyReportingGate` pure idempotente + prosa ES en `prompt.md`, `KODO_LABEL_GSD_CHILD`/`isGsdChild` source-hygiene; cherry-pick de 9 SHAs de rama paralela + 38 tests heredados (Phase 29 — REPORT-01..06)
- SessionRecord lifecycle: `findSession` escanea `state.sessions` + `state.history` (cierra desync ROMAN-132 / CR-01); `markSessionStatus` falsy guard observable + discriminated union return `{ok, reason}` (Phase 30 — LIFE-01/02; HUMAN-UAT 2/2)
- Advisory cleanup: `syncSkill({onConsoleWarn})` DI, `runSkillSyncCli` await cleanup pre-exit, test `launchOrchestrator` spawn real (Phase 31 — ADVISORY-01..03)
- Bookkeeping doble: v0.7 traceability 16/16 + Phase 23 VERIFICATION backfill + nyquist toggle (Phase 32); v0.8 doc-drift reconciliado + 3 VALIDATION.md citation-based (28/30/31) + NYQ-32-NA + surgical fix consumiendo el return de `markSessionStatus` en verify.js/stop.js (Phase 33 — cierra ~14 items del audit)

### What Worked
- **Cherry-pick selectivo + planning regen (Phase 29):** rescatar 9 commits de código de la rama paralela `gsd-provider-reporting` SIN mergear sus `.planning/` (que colisionaban por numeración v0.5) fue la vía limpia. 38 tests heredados entraron verdes. Documentar los SHAs literales en `PENDING-INTEGRATIONS.md` antes de empezar hizo el cherry-pick mecánico.
- **Driver real → fix dirigido (Phase 30):** ROMAN-132 (sesión viva en cmux mientras `state.sessions={}`) dio el caso empírico exacto que justificó el scan de `state.history`. Un bug latente de Phase 19 se cerró con evidencia de producción, no con especulación.
- **Nyquist backfill citation-based (Phase 33 Bloque B):** en vez de re-ejecutar la suite para 3 phases ya verdes, los VALIDATION.md citan la cobertura empírica existente (VERIFICATION.md + tests + HUMAN-UAT). Cero re-trabajo, sign-off de 1/5 → 4/5+1 N/A.
- **Phase de cierre de tech-debt como patrón (32 → 33):** análogo a cómo Phase 32 cerró el drift de v0.7, Phase 33 cerró el de v0.8 en 3 bloques paralelos (doc / nyquist / surgical fix) con `depends_on: []` y cero file overlap. El audit re-corrido confirmó el cierre contra disco.
- **Surgical fix dentro de los try/catch existentes (Phase 33 Bloque C):** consumir el return discriminado de `markSessionStatus` con `log.warn` no introdujo try/catch nuevos ni mutó el contrato de `manager.js` — el fix CONSUME, no muta. Optional chaining defensivo contra mocks.

### What Was Inefficient
- **`gsd-sdk milestone.complete` volvió a contar mal (1 phase / 3 plans):** idéntico al bug documentado en la retro de v0.5 — el SDK leyó `total_phases: 1` de STATE.md (que reflejaba sólo la última phase activa) y extrajo accomplishments sólo de Phase 33. Hubo que reescribir la entrada de MILESTONES.md a mano con las 6 phases. **Dos milestones (v0.5, v0.8) con el mismo bug del SDK — es momento de arreglarlo en herramienta.**
- **Checkbox/frontmatter drift recurrente:** 9/17 REQ-IDs quedaron `[ ]` Pending en REQUIREMENTS.md + 5 SUMMARYs con `requirements_completed: []`, aunque las VERIFICATION.md los marcaban SATISFIED. Mismo patrón que v0.3/v0.4/v0.5/v0.7. Esta vez requirió una phase entera (33 Bloque A) para reconciliar. La deuda de `requirements mark-complete` automatizado sigue abierta tras 5+ milestones.
- **El audit necesitó re-corrida manual:** el audit original (2026-05-21) emitió TECH_DEBT con ~14 items; tras Phase 33 hubo que re-auditar a mano para flipear el verdict a PASSED. Misma lección que v0.5: el audit debería invalidarse/re-correrse automáticamente al cerrar.
- **Nyquist coverage arrancó en 1/5:** sólo Phase 29 generó VALIDATION.md durante la ejecución; las otras 4 quedaron MISSING hasta el backfill de Phase 33. El toggle `nyquist_validation: true` en config no se traduce en un artefacto por-phase automático.

### Patterns Established
- **Discriminated union return CONSUMIDO, no descartado:** `markSessionStatus` retorna `{ok, reason}` y los callers emiten `log.warn('<componente>.<situacion>', {reason, …})` cuando `!result?.ok`. Hace observable el drift en NDJSON sin cambiar la semántica. Patrón replicable para cualquier helper non-throwing con early-return.
- **Anti-recursión = cortar ANTES del lock/resolver/launch:** el filtro `isGsdChild(labels)` actúa al inicio del dispatcher, no después. El único punto seguro para garantizar que una sub-issue del agente jamás recurse, ni con `--force`.
- **Opt-in strict `=== true` (DEFAULT_CONFIG sin la key):** para features que NO deben cambiar el comportamiento por defecto, strict equality + ausencia de la key en defaults evita activación accidental por valores truthy.
- **Cherry-pick + planning regen para integrar ramas paralelas:** cuando una rama tiene código bueno pero `.planning/` colisionante, rescatar SHAs de código + regenerar planning limpio. Documentar SHAs en `PENDING-INTEGRATIONS.md` antes de empezar.

### Key Lessons
1. **El bug del SDK `milestone.complete` (count parcial) es ahora reproducible en 2 milestones — arreglar en herramienta, no a mano cada vez.** Debería leer el grupo de phases del milestone activo del ROADMAP, no `total_phases` de STATE.md.
2. **El checkbox/frontmatter drift es un impuesto recurrente de 5+ milestones.** Costó una phase entera (33-A) esta vez. `requirements mark-complete` debe correr dentro del verifier o execute-plan, no diferirse al milestone close.
3. **Backfill citation-based > re-ejecutar suites verdes.** Para artefactos de validación retroactivos sobre código ya verificado, citar la evidencia existente es honesto y barato. Re-correr tests verdes no añade señal.
4. **Una phase explícita de cierre de tech-debt (análoga a 32/33) es un patrón sano, no un fallo.** Concentra el drift documental + robustez menor en un Tier 1 acotado, con audit re-corrido como gate.
5. **Un driver de producción concreto (ROMAN-132) vale más que N especulaciones.** El fix de `findSession` esperó hasta tener el caso empírico exacto; eso lo hizo dirigido y verificable.

### Cost Observations
- Phases 28-31 ejecutadas con executors en worktree + verifier + code-reviewer; Phases 32-33 Tier 1 doc-only (+ surgical fix en 33-C) más ligeras.
- Phase 33: 3 plans Wave 1 paralelo (`depends_on: []`, cero file overlap) — el patrón de máxima paralelización para cierres de debt independientes.
- Notable: el grueso del coste de v0.8 NO fue feature nuevo sino consolidación (cherry-pick, lifecycle fix, bookkeeping). El milestone confirma que "consolidación" es un tema de milestone legítimo y acotable.

---

## Milestone: v0.9 — kodo TUI sesiones en vivo

**Shipped:** 2026-06-03
**Phases:** 7 (34-39 + cierre 39.1) | **Plans:** 23 | **Tasks:** ~26
**Audit:** `tech_debt` (sin blockers, 16/16 requirements, 47/47 exports wired, 5/5 flujos E2E; deuda Nyquist diferida)

### What Was Built
- Fundación TUI: subcomando `kodo dashboard` (ink@6 + react@19, `React.createElement` sin build step, lazy import), guard non-TTY pre-render, ciclo de vida limpio (q/Ctrl-C/SIGTERM), color-isolation extendida a `src/cli/dashboard/` (Phase 34 — TUI-01..04)
- Datos resilientes: `fetchStatus` puro never-throws (`{ok:false}` colapsa ECONNREFUSED/HTTP-no-ok/JSON-corrupto) + `usePoll`/`runPollLoop` self-scheduling single-flight + backoff 2.5→5→10s + keep-last-good (Phase 35 — TUI-05/06)
- Tabla viva: capa derive PURA React-free (sort DESC estable, selección por identidad `task_id`, filtros `/`+`r:`/`s:` AND anti-ReDoS, `countByStatus`) + render ink columnar con color semántico + zombie + interacción mode-gated (Phase 36 — TUI-07..12)
- Focus cmux: Enter → `cmux select-workspace` fire-and-forget vía `execFile`, guard inverso `alive===false`, errores al footer sin desmontar (Phase 37 — TUI-13/14; UAT manual obligatorio)
- WorkspaceHost provider + ciclo de vida v3: provider intercambiable + estados idle/needs-input/dead/closed + migración `state.json` v2→v3 + `reconcileTick` único escritor de `alive` (Phase 38 — promovido desde backlog 999.2; cierra ROMAN-151/152)
- Paneles auxiliares: overlays `c` (comentarios) y `l` (logs grep best-effort) como tercer `mode:'overlay'`, snapshot congelado, Esc preserva cursor (Phase 39 — TUI-15/16)
- Cierre de gaps: TUI-17 wiring host muerto eliminado, fuente única de `alive`, `statusColor` v3-aware, overlay `supported`, bookkeeping (Phase 39.1 — VERIFICATION 14/14)

### What Worked
- **Separación derive-pura vs render (Phase 36):** toda la lógica de sort/selección/filtros vive en `select.js`/`format.js` React-free y DI-testable; el render ink solo consume. Permitió cubrir las invariantes load-bearing (selección por identidad, anti-ReDoS) con tests puros y atrapar el BLOCKER del cursor antes de shipping.
- **Never-throws en el data layer, no en React (Phase 35 D-07):** poner el invariante no-crash en `fetchStatus` (no en try/catch dispersos por componentes) hizo que JSON corrupto / server caído fueran un estado de datos, no una excepción de render. La TUI nunca crasheó en UAT.
- **UAT manual como gate de primera clase para fases GUI (37/38):** las dos fases de mayor riesgo (focus cmux + estados de proceso en vivo) se cerraron con HUMAN-UAT firmado en TTY real, no con verifier automatizado. Honesto sobre lo que tests sin PTY no pueden cubrir.
- **Promover desde backlog cuando un diagnóstico lo exige (Phase 38):** ROMAN-151/152 (sesiones `Needs input` invisibles en el dashboard) justificó promover 999.2 a fase de milestone con un trigger empírico, no especulativo.
- **Fase de cierre de gaps (39.1) tras el audit:** el audit `gaps_found` (1 blocker + 3 warnings) se saldó con una fase insertada de 5 planes antes de archivar — el mismo patrón sano de v0.8 (32/33).

### What Was Inefficient
- **ROADMAP.md se corrompió a mitad del milestone (bug de tooling):** el commit `4862a97` (creación del plan de Phase 39.1) **sobreescribió `.planning/ROADMAP.md` de 362 → 13 líneas**, dejando solo el fragmento de 39.1. Pasó desapercibido hasta el milestone close, donde hubo que reconstruir el roadmap íntegro desde `fb856af` + reinyectar el detalle real de 39.1 + re-anexar el Backlog. **El tooling de plan-phase no debe tocar ROADMAP.md salvo para el índice de fases.**
- **`gsd-sdk milestone.complete` volvió a contar mal Y extrajo accomplishments basura (3er milestone con el bug):** reportó 8 phases (contó el backlog 999.1) y los `one_liner` extraídos eran notas de desviación (`[Rule 3 - Blocking]…`, `Descubierto durante RED→GREEN:`). Hubo que reescribir la entrada de MILESTONES.md a mano. **Mismo bug que v0.5 y v0.8 — la deuda de herramienta ya es crónica.**
- **Nyquist coverage arrancó/quedó en 2/7:** solo 34/35 generaron VALIDATION.md; 36/37 parciales, 38/39/39.1 ausentes. El toggle `nyquist_validation: true` no produce el artefacto por-phase automáticamente. Se difirió como deuda consciente (la cobertura empírica existe vía VERIFICATION/UAT).
- **VERIFICATION.md formal ausente en 37/38:** las fases UAT-manual no generaron VERIFICATION.md; el cierre se apoyó en UAT/HUMAN-UAT. Funcional, pero deja hueco de artefacto formal.

### Patterns Established
- **Derive-pura React-free + render delgado:** toda la lógica de presentación (sort, selección, filtros, color-como-dato) en módulos sin React, testables con DI; el componente ink solo orquesta. Replicable para cualquier TUI/UI con lógica no trivial.
- **Never-throws en el borde de datos:** la capa de fetch colapsa todo fallo a un discriminante `{ok:false, error}`; el invariante no-crash no se reparte por el árbol de render.
- **Selección por identidad, nunca por índice:** en listas vivas que se reordenan/filtran, rastrear la selección por id de dominio (`task_id`) — el índice de array es un bug latente.
- **Fuente única de estado con un solo escritor (`reconcileTick`):** el dashboard nunca recomputa `alive`/estado; lo lee del único escritor. Phase 39.1 eliminó el override legacy que violaba esto.
- **UAT manual firmado como artefacto de cierre válido** para fases GUI/proceso-en-vivo no automatizables sin PTY.

### Key Lessons
1. **El tooling que escribe `.planning/` necesita guard-rails:** un comando de plan-phase truncó el ROADMAP entero sin que nadie lo notara durante ~6 commits. Cualquier escritura a ROADMAP.md debería ser aditiva sobre el índice, nunca un overwrite total.
2. **El bug de `milestone.complete` (count + accomplishments) es crónico (v0.5, v0.8, v0.9).** Ya no es un incidente, es deuda de herramienta. Debería leer el grupo de phases del milestone desde el ROADMAP y filtrar one-liners que empiecen por `N. [Rule …]`.
3. **Nyquist no es automático pese al toggle.** Tras 2 milestones con la misma observación, o el verifier emite VALIDATION.md por-phase, o se acepta que el backfill es un paso manual de cierre.
4. **El data-layer never-throws es la mejor inversión de robustez de un TUI.** Un solo punto que colapsa fallos > N try/catch en componentes.
5. **Promover desde backlog con un driver de producción concreto funciona** (ROMAN-151/152 → Phase 38), igual que ROMAN-132 → Phase 30 en v0.8.

### Cost Observations
- Phases 34-39 ejecutadas con executors + verifier + code-reviewer; 39.1 fase de cierre de gaps (5 planes, Tier dirigido por el audit).
- Las fases de UI/GUI (37/38) concentraron coste en UAT manual e iteración visual (3 hot-patches post-shipment en Phase 36: alt-screen buffer, selected-row styling, fixture server) — coste inherente a una superficie visual, no a la lógica.
- Notable: +158 tests netos (915 tras Phase 35 → 1073) para una superficie read-only — el grueso fue cobertura de la capa derive pura y de los never-throws, no del render.

---

## Milestone: v0.10 — Higiene y estado real de sesiones

**Shipped:** 2026-06-08
**Phases:** 4 (40-43) | **Plans:** 10 | **Audit:** tech_debt (14/14 reqs, 14/14 integración, 3/3 E2E)

### What Was Built
Cadena `provider_state` end-to-end (cierra el driver ROMAN-150): `getTaskState` opcional Plane+GitHub + enrichment read-only fail-open en `/status` + columna `task`/filtro `ps:` en el dashboard. `kodo gsd doctor` como módulo puro de saneo reusable. Dismiss TUI read-write (tecla `d` reusando doctor) — primera ruptura consciente del invariante v0.9 "TUI read-only", con UAT humano firmado.

### What Worked
- **El dogfooding al cierre fue el mayor generador de valor.** Levantar el dashboard real con sesiones reales destapó 3 bugs que ninguna suite cazó: provider_state `unknown` (la API de Plane no puebla `state_detail` — invisible en tests con fixtures que lo inyectaban), divergencia state/status (deuda v0.9 hecha visible), y reciclado de `workspace_ref` (que requirió datos vivos para verse).
- **Verificación en vivo read-only** (correr `reconcileTick`/`getTaskState` contra `state.json` + cmux reales sin escribir) confirmó cada fix antes de commitear y destapó un SEGUNDO síntoma del reciclado (debounce keyed por ref) que el primer fix no cubría.
- **Separación de capas pagó:** los 3 bugs eran de la capa de datos (Phase 40 / v0.9 Phase 38), no del render de Phase 43 — diagnosticarlo correctamente evitó "arreglar" código correcto.

### What Was Inefficient
- **Tests con fixtures que mienten:** el test de `getTaskState` inyectaba `state_detail` en el work item — exactamente el campo que la API real NO devuelve. El mock ocultó el bug todo el desarrollo de Phase 40. Lección: los fixtures de adapters deben reflejar la forma REAL de la respuesta del proveedor.
- **Razonamiento circular en una explicación** ("no son GSD porque los campos están vacíos"): el usuario lo cazó. Verificar la fuente real (label `kodo:yolo` en Plane) en vez de inferir de la ausencia.
- **Checkboxes de requirements stale** (PSTATE-05/06 en `Pending` pese a estar verificados) y frontmatter `requirements_completed` vacío en summaries de 41/42 — bookkeeping que el audit tuvo que reconciliar.

### Patterns Established
- **Defensa contra identidad recyclable del host:** cuando una clave externa (cmux `workspace:N`) puede reciclarse, NO keyear estado interno por ella — verificar identidad (title↔task_ref) en el match Y keyear el debounce/estado por la identidad única propia (`task_id`).
- **Resolver UUID→definiciones cacheadas** en vez de confiar en `expand` del proveedor: separar la ASIGNACIÓN viva (leída por request) de las DEFINICIONES estables (cacheadas en init).
- **Columna = un solo eje:** `state` (lifecycle), `task` (provider), `status` (outcome del agente) — cada columna un eje no solapado; los placeholders atenuados (`No GSD`, `—`, `?`) distinguen "sin dato" de valores reales.

### Key Lessons
- Un milestone "verificado" por suite verde + VERIFICATION.md no está realmente probado hasta correrlo con datos reales. El dogfooding no es opcional para superficies de observabilidad.
- Los fixtures de integración de proveedores externos son una fuente de falsos verdes si no espejan la respuesta real.

### Cost Observations
- Model mix: predominio opus (sesión interactiva de cierre con dogfooding intensivo).
- Notable: 3 bugs reales encontrados y arreglados en una sola sesión de cierre, todos surgidos del uso real, ninguno de la suite (1213 pass) — la inversión en dogfooding/verificación-en-vivo tuvo el mayor ROI del milestone.

---

## Milestone: v0.11 — Ventana al plan

**Shipped:** 2026-06-10
**Phases:** 4 (44-47) | **Plans:** 5 | **Commits:** 71 | **Audit:** tech_debt (8/8 reqs, 8/8 integración, 2/2 E2E; deuda Nyquist 44/45/46 diferida)

### What Was Built
"La ventana al plan": overlay que muestra el plan de cualquier sesión desde el dashboard. GSD path (`p` → `readPlan` vía `resolvePhase` lee `PLAN.md` de fase) + non-GSD/quick path (`session-start.js` inyecta instrucción de escribir plan ligero a `~/.kodo/plans/<task_id>.md`; `readLightPlan` lo lee como fallback). + pulido de dashboard (columna `phase/mode` condicional, zombie por-fila) + backfill Nyquist citation-based de v0.9/v0.10 (7 VALIDATION.md, Phase 47 doc-only).

### What Worked
- **Decisión de research que evitó construir sobre arena:** el spike previo marcó `TodoWrite` deprecado y los formatos internos de Claude Code (transcript JSONL, `~/.claude/plans/`) como no documentados/frágiles → pivote a "kodo produce activamente su propio artefacto de plan" (`~/.kodo/plans/<task_id>.md`) en vez de olfatear el plan nativo. El feature estrella descansa sobre una ruta kodo-controlada estable, no sobre internals de un tercero.
- **El seam productor↔consumidor (Phase 45 escribe / Phase 46 lee) se verificó byte-a-byte** en el integration check: `join(KODO_DIR,'plans',task_id+'.md')` vs `join(homedir(),'.kodo','plans',taskId+'.md')` colapsan a la misma ruta. Un mismatch ahí habría hecho que el feature mostrara "no plan" silenciosamente para toda sesión non-GSD.
- **Reuso del overlay de Phase 44 para Phase 46** (mismo `mode:'overlay'`, añadiendo solo un fallback en `plan.js`) — Phase 46 fue edición quirúrgica de 3 ficheros, cero greenfield.
- **Cero endpoints nuevos** mantenido en las 4 fases (overlay read-only filesystem en ambos paths).

### What Was Inefficient
- **La deuda Nyquist se reprodujo dentro del mismo milestone que la saldó.** Phase 47 backfilleó la Nyquist de v0.9/v0.10, pero 44/45/46 quedaron con sus propios VALIDATION.md `draft`/non-compliant (stubs de plan-time nunca backfilled). El audit lo destapó: el milestone shippea con la misma clase de deuda que acababa de cerrar. Patrón sistémico: la validation-strategy step crea el stub pero nada fuerza su backfill antes del cierre.
- **Frontmatter `requirements_completed` vacío otra vez** (46-01, 47-01) — misma deuda cosmética que v0.10 (41/42/43-02). Recurrente; el executor no rellena el campo y nadie lo verifica hasta el audit.

### Patterns Established
- **kodo produce su propio artefacto en vez de olfatear el de un tercero:** cuando el formato de un upstream es frágil/no documentado, inyectar una instrucción para que el agente escriba a una ruta kodo-controlada estable es más robusto que parsear internals.
- **Contrato de ruta byte-idéntico entre productor y consumidor en fases separadas** debe verificarse explícitamente (no asumirse) — es el punto de fallo silencioso más probable de un feature cross-phase.

### Key Lessons
- Un milestone que salda deuda Nyquist debe auditar **su propia** cobertura Nyquist antes de cerrar, o reproduce la deuda. El stub `draft` de la validation-strategy step necesita un gate de backfill.
- El audit de milestone (cross-phase integration + E2E) sigue aportando sobre la verificación per-fase: confirmó el seam 45→46 que ninguna VERIFICATION individual cubría.

### Cost Observations
- Model mix: opus (orquestación discuss→plan→execute→verify de las 4 fases + audit) + sonnet (checker/verifier/integration-checker).
- Notable: pipeline `--auto` (discuss→plan→execute→verify) llevó Phase 47 de cero a complete en una sola cadena; el audit de milestone se ejecutó como gate opcional (opción del usuario) antes del cierre y capturó la deuda Nyquist propia.

---

## Milestone: v0.12 — Atajos al gestor y progreso vivo

**Shipped:** 2026-06-15
**Phases:** 5 (48-51 + 50.1) | **Plans:** 10 | **Commits:** 90 | **Audit:** ninguno formal (`/gsd:audit-milestone` no se corrió) — cerrado con deuda reconocida (HUMAN-UAT display 50.1 + XSS latente WR-01)

### What Was Built
Dashboard profundizado en dos direcciones desde la fila de sesión. *Hacia afuera:* tecla `o` abre la tarea (Plane/GitHub) en el navegador (`runOpen` execFile never-throws + allowlist http(s) + argv literal) + fix del bug de browse-URL de Plane (`plane.web_url ?? base_url`). *Hacia adentro:* spike empírico (Phase 49) dictaminó VIABLE capturar el progreso N/M; el dashboard muestra una columna condicional `prog` con `N/M` por sesión GSD leído del bloque `progress:` del STATE.md del worktree (Phase 50 + corrección 50.1). + backfill Nyquist v0.11 (Phase 51).

### What Worked
- **El spike-gate (Phase 49) hizo su trabajo: gobernó si Phase 50 se construía.** El task-state vivo es version-specific; meterlo como fase-research separada antes del display evitó construir a ciegas. Veredicto VIABLE con evidencia de Claude Code 2.1.175.
- **Phase 48 descansó sobre código ya shipped:** el round-trip de `task_url` (`TaskItem.url`, `manager.js` persiste, `GET /status` lo expone) ya existía; el trabajo real fue consumo (un keypress + `open.js` clonado de `focus.js`), no plumbing. La auditoría source-first evitó reconstruir lo que ya estaba.
- **El reuso del display de Phase 50 en 50.1 fue total:** la corrección de fuente (de `~/.claude/tasks/` a STATE.md) cambió solo el enrich; `progCell`/`deriveAnyProgress`/columna se reusaron intactos. Cero greenfield en el repunte.

### What Was Inefficient
- **Phase 50 se construyó sobre una superficie equivocada y hubo que rehacerla en 50.1.** El hook `task-progress.js` leía `~/.claude/tasks/`, que resultó VACÍA en sesiones GSD reales (que usan `Agent`, no `Task*` tools). El gate A2 confirmó el *disparo* del hook pero NO que la superficie tuviera *datos* en el flujo real → una fase entera (50-02 captura) quedó demotada. El spike validó la mecánica, no el contenido end-to-end.
- **El milestone cerró sin audit formal y con el HUMAN-UAT de su feature estrella (display de progreso) diferido.** La verificación visual del progreso vivo requiere TTY + sesión GSD viva, no montable en el momento; se difirió como deuda. Tercer milestone consecutivo (v0.10/v0.11/v0.12) cerrando con deuda de verificación.
- **Drift de frontmatter al cierre:** `48-VERIFICATION.md` quedó `human_needed` pese a tener el UAT APPROVED en `48-03-SUMMARY.md`; el audit-open lo marcó como gap falso. El status no se reconcilió al firmar el UAT.

### Patterns Established
- **Spike-gate como fase separada antes de una feature condicional:** cuando la viabilidad es version-specific y no pre-investigable, un veredicto empírico escrito (VIABLE/INVIABLE) que gobierne si la fase siguiente existe evita construir sobre supuestos.
- **Validar la superficie con DATOS del flujo real, no solo la mecánica:** un gate que confirma "el hook dispara" no basta; debe confirmar "el hook dispara CON los datos esperados en el flujo de producción".

### Key Lessons
- Un spike de viabilidad debe ejercitar el flujo de producción REAL (sesión GSD con `Agent`), no un harness sintético que dispara `Task*` — o validará una superficie que estará vacía en producción. Phase 50→50.1 es el coste de esa brecha.
- Reconciliar el status del frontmatter al firmar el UAT (no dejarlo en `human_needed`) — el audit-open confía en el frontmatter y produce falsos gaps si hay drift.
- El display reusable (columna no-color, derive-flag, keep-last-good) es ahora un mold probado: Phase 43 (provider_state) → Phase 50 → 50.1 lo reusaron con cambios mínimos.

### Cost Observations
- Model mix: opus (orquestación + spike + corrección de fuente 50.1) + sonnet (checker/verifier).
- Notable: el cierre destapó deuda oculta (drift de 48, obsolescencia de 50 por 50.1) que el audit-open numérico no distinguía de trabajo real pendiente — requirió inspección manual para separar ruido (4 items) de señal (UAT 50.1 genuino).

---

## Milestone: v0.13 — kodo bidireccional

**Shipped:** 2026-06-25
**Phases:** 11 (52-62) | **Plans:** 17 | **Commits:** ~235 | **Timeline:** 9 días (2026-06-16 → 06-25)

### What Was Built
El puente inverso `sesión → tarea`: una sesión Claude Code ad-hoc de cmux se promueve a tarea persistente. Arquitectura "una fontanería, tres consumidores" — base determinista 0-token (`createTask` opcional Plane+GitHub + `adoptSession`) reusada por el CLI `kodo adopt`, la tecla `a` del dashboard (vía contrato `HostProvider.listAgentSurfaces()`) y el orquestador. Cierre del milestone (ORCH-02): un derivador LLM one-shot (`claude -p` Haiku, fail-open) propone `{title, description}` a nivel tarea desde la intención de la sesión + memoria del proyecto, antes de shellear `kodo adopt`. Más lifecycle de cierre (`SessionEnd`), liveness, progreso vivo de adoptadas y saldo de deuda v0.12.

### What Worked
- **Ejecución por waves en worktree aislado** (Phase 62): 2 plans disjuntos en paralelo + 1 dependiente; merge limpio sin conflictos. El overhead de worktree pagó porque los plans tocaban archivos disjuntos.
- **La UAT humana en vivo destapó 2 bugs que ningún test automático habría pillado**: título a nivel proyecto (prompt mal orientado) y timeout intermitente (3s de espera de stdin de `claude`). Ambos reproducidos con coordenadas reales y corregidos con red de test.
- **Reproducir el bug con las coordenadas reales** (cwd+sessionId del surface) antes de tocar código evitó adivinar — el diagnóstico fue determinista.

### What Was Inefficient
- El `phase.complete` del SDK no marcó el checkbox del ROADMAP (formato de título largo no matcheó su regex) — requirió corrección manual. Tercer milestone con drift de checkbox/tracking.
- ORCH-01 (Phase 57) se construyó entero antes de que la UAT revelara que su diseño at-adopt era inalcanzable (coordenadas irresolubles); se reubicó en ORCH-02. Una validación de coordenadas más temprana lo habría pillado antes.

### Patterns Established
- **Derivador LLM como módulo DI never-throws aislado**: todo el carril `claude -p` vive en un único `enrich.js` inyectable, preservando el suelo 0-token del núcleo. `child.stdin.end()` para no esperar stdin (execFile ignora `stdio` con callback).
- **Intent del transcript (primer prompt del usuario) como señal primaria de TAREA**, memoria del proyecto como contexto de fondo desambiguador — no al revés.

### Key Lessons
1. Un derivador LLM disparado por tecla debe medir su latencia real contra el timeout ANTES de fijarlo: el RESEARCH midió 8.7-21.9s y puso 25s, pero no contó los +3s de espera de stdin de `claude` → fail-open intermitente. Los overheads del wrapper agéntico (`claude -p` ≠ API directa) son invisibles hasta medirlos en vivo.
2. La UAT humana no es ceremonia: en esta fase fue la única red que pilló los 2 bugs reales (calidad semántica + latencia). Los tests verdes daban falsa confianza.
3. (Recurrente, 4º milestone) El verifier/SDK debería marcar el checkbox del ROADMAP automáticamente — el drift manual es bug de proceso, no descuido.

### Cost Observations
- Model mix: opus (orquestación execute-phase + 2 fixes de UAT + diagnóstico) + sonnet (code-reviewer/verifier).
- Notable: el coste de latencia de la adopción inteligente (~10-20s) es overhead del runtime agéntico de Claude Code, no de Haiku — registrado como deferred candidate (API directa) con su trade-off (gestión de API key).

---

## Milestone: v0.14 — Configuración editable desde el dashboard

**Shipped:** 2026-06-30
**Phases:** 2 (63-64) | **Plans:** 7 | **Sessions:** 1 (cadena autónoma discuss→plan→execute→verify)

### What Was Built
- Editor de configuración en el dashboard (Phase 63): overlay TUI + text-input editable in-house en ink (cursor/backspace) + validadores puros (`config-validate.js`) + escritura local atómica temp+rename (`writeFileAtomic`); edición de model/max_parallel, states, server thresholds, cmux colors.
- Editor de proyectos (Phase 64): `listProjects()` en vivo (1ª fuente async de red surfaced como estado, guard de request-token dedicado `projectsReqRef`), mapear/editar/quitar ruta + sub-editor de módulos (2º hop `listModulesFn`), validación de ruta pre-escritura, degradación never-throws con retry (PROJ-05).
- Base reusable: `writeFileAtomic` compartido por `saveConfig`/`saveProjects`; forma dual `string | {default,modules}` de `projects.json` preservada para `manager.js`/`adopt.js`.

### What Worked
- Risk-graded build order: la fundación (text-input/overlay/validadores/escritura atómica) se construyó y verificó con el carril 100% local de bajo riesgo (config, Phase 63) antes de añadir el carril de mayor riesgo (provider async, Phase 64). Phase 64 reusó la base entera.
- El research detectó dos trampas reales antes de planificar: `listModules` NO está en el contrato `TaskProvider` (solo en `PlaneClient`) → wiring condicional; y el rechazo async de `listProjects` necesita un wrapper discriminado `{ok}` (no fail-open a `[]`) para distinguir "0 proyectos" de "error de red".
- TDD RED→GREEN en cada plan; suite cerró 1639 pass / 0 fail. El plan-checker pilló un `grep` BRE (`\|`) incompatible con BSD/macOS antes de ejecutar.

### What Was Inefficient
- El checkpoint `human-verify` del Plan 64-04 chocó con `--auto`: el editor necesita un provider en vivo + TTY real, que una sesión autónoma no tiene. Se resolvió auto-aprobando solo la finalización de código y difiriendo las validaciones manuales a `/gsd-verify-work` (UAT 4/4 posterior), pero el flujo `--auto` no distingue "checkpoint automatizable" de "checkpoint que requiere recursos externos".
- `phase.complete` y `milestone.complete` tropezaron con el ítem de Backlog `Phase 999.1` (promovido/shipped, no pendiente) → necesitó `--force`; el heurístico cuenta cualquier heading tipo-fase en Backlog como trabajo sin empezar.

### Patterns Established
- **Wrapper never-throws discriminado** (`{ok:true,...}|{ok:false,error}`) en `index.js` como punto de muestreo del fallo async, cubriendo construcción del cliente + llamada de red.
- **Validador con I/O en módulo adyacente** (`path-validate.js`) para no romper el invariante 0-I/O declarado de `config-validate.js`.
- **Honest-auto-checkpoint**: en `--auto`, un checkpoint que requiere recursos no disponibles se finaliza-código + difiere a UAT explícito, nunca se marca "passed" fabricado.

### Key Lessons
1. Cuando un milestone reusa la fundación de su primera fase, planificar la fundación como carril aislado y testeado primero paga: Phase 64 fue casi todo integración, cero re-trabajo de la base.
2. El research que verifica contratos reales (¿está este método en la interfaz?) evita planes que asumen simetría provider-agnostic donde no la hay.
3. Los checkpoints manual-only deben sobrevivir a `--auto` como UAT diferido, no como auto-aprobación silenciosa — la honestidad del estado de verificación es load-bearing.

### Cost Observations
- Model mix: opus (orquestación discuss/plan/execute + researcher + planner + executores) + sonnet (plan-checker + verifier).
- Notable: cadena autónoma completa en una sesión; el único gate humano real fue la UAT con provider en vivo (4/4 pass), correctamente separada del trabajo automatizable.

---

## Milestone: v0.15 — «kodo up» — arranque unificado + onboarding dashboard-first

**Shipped:** 2026-07-03
**Phases:** 4 (65-68) | **Plans:** 14 | **Tasks:** 39

### What Was Built
- `kodo up`: arranque en un comando — daemon compuesto (server+polling) desacoplado en background + dashboard como visor, idempotente (PID-alive + port-probe) y persistente (`detached`+`unref`). `kodo daemon run` foreground supervisable + `kodo stop`/`status --json`; `kodo start` legacy intacto (Pilar 1, UP-01..06).
- Distribución Homebrew: `brew install kodo` + `brew services start kodo` → `kodo daemon run` server-only bajo launchd, degradación limpia never-throws; Windows → foreground (DIST-01..03).
- Onboarding dashboard-first: first-run sin config → dashboard en modo setup sin `exit 1` → editar provider/base_url/slug + API key enmascarada → `config.json` + `.env` 0600, boundary PERSIST-04 intacto; `kodo config` headless converge en los 3 escritores únicos (SETUP-01..05).

### What Worked
- **Build order LOCKED por pilares** (Pilar 1 shippable antes de Pilar 2): el ciclo de vida del daemon estabilizó antes de montar el onboarding encima, sin re-trabajo.
- **Composición sobre reinvención**: la fase 68 (~90% composición) reusó `needsSetup`/`writeEnvVar`/`saveConfig`/modo overlay de fases previas; el integration-checker confirmó 9/9 seams WIRED sin reimplementaciones.
- **Verificar los hallazgos del research contra el código antes de planificar en `--auto`**: destapó que el daemon muere por el webhook secret (no la API key), contradiciendo una premisa LOCKED — corregido con decisión de producto antes de un plan roto.

### What Was Inefficient
- **Drift de tracking al cierre**: un `67-PLAN-SKETCH.md` (borrador con "PLAN" en el nombre) fue contado como un 4º plan por el fallback laxo `/PLAN/i` de `plan-scan.cjs`, marcando la fase 67 como no-verificada (falso negativo) y bloqueando el gate de readiness. Resuelto renombrando el sketch, pero costó una investigación de causa raíz en el cierre.
- **UAT-CHECKLIST sin frontmatter**: el `67-UAT-CHECKLIST.md` sin `status:` disparó un falso "UAT gap" en `audit-open` aunque su ejecución (8/8) estaba registrada en `67-UAT.md`.

### Patterns Established
- **Boundary del secreto con escritor único**: el valor de la API key vive solo en `~/.kodo/.env` (0600) + `process.env`; un único `writeEnvVar` in-proceso (nunca shell-out), verificado por grep de higiene source-level (5 sinks) + UAT runtime (argv/logs/`/status`/perms).
- **`needsSetup()` existsSync-first** como guard anti-falso-negativo (Pitfall 12) reusable para detección de first-run.
- **Daemon desacoplado**: `detached`+`unref` para persistencia, con seams DI-testeables sin procesos/red reales.

### Key Lessons
- **Los artefactos de borrador del planning deben quedar fuera de los globs de conteo**: un nombre con "PLAN" cae en fallbacks laxos y ensucia el tracking del milestone. Convención: nombrar sketches sin "PLAN" (`-SKETCH.md`).
- **En `--auto`, verificar los hallazgos críticos del research contra el código real antes de dejar correr al planner** evita planificar sobre premisas falsas (webhook secret vs API key).
- **Los UAT humanos runtime de un boundary de seguridad no son auto-aprobables** aunque `--auto` esté activo; el GATE MANUAL de máquina limpia se respetó.

### Cost Observations
- Model mix: opus (orquestación + planning + cierre) + sonnet (integration-checker). Sesiones: 1 principal multi-turno (con compactación de contexto).
- Notable: el cierre del milestone consumió esfuerzo desproporcionado en reconciliar drift de tracking (sketch + UAT frontmatter) frente al trabajo de código, que ya estaba verde (suite 1788/0/1).

## Cross-Milestone Trends

### Process Evolution

| Milestone | Plans | Phases | Key Change |
|-----------|-------|--------|------------|
| v0.2 | 10 | 5 | Established TDD + pure helper extraction pattern |
| v0.3 | 25 | 5 | Added CONTEXT/PATTERNS/DISCUSSION-LOG + worktree parallelism + code review gate |
| v0.4 | 11 | 3 | Source-hygiene grep tests anti-drift + sequential-no-worktree para fases test-only |
| v0.5 | 21 | 5 | Helper-as-single-source patrón replicado (createFormatter) + spawnSync child con tmpdir aislado como canon para tests de hooks + skill canonical en `<repo>/.claude/skills/` |
| v0.6 | 13 | 5 | Worktree always-on para TODAS las sesiones + cleanup fail-open con `.dirty` rename + HOOK-01 universal anti-push-fantasma |
| v0.7 | 11 | 5 | 2º adapter (GitHub) validando la promesa provider-agnostic + 3er canal trigger (polling daemon) + cross-provider contract matrix |
| v0.8 | 20 | 6 | Cherry-pick selectivo de rama paralela + planning regen + discriminated union return CONSUMIDO + phase de cierre de tech-debt (32/33) como patrón |
| v0.9 | 23 | 7 | Primera superficie UI (TUI ink/react sin build step): derive-pura React-free + never-throws en data layer + selección por identidad + UAT manual como gate de cierre para fases GUI |
| v0.10 | 10 | 4 | Dogfooding/verificación-en-vivo como gate de cierre (3 bugs reales no cazados por suite) + 1ª ruptura consciente de invariante (TUI read-only → dismiss read-write) con UAT firmado |
| v0.11 | 5 | 4 | kodo produce su propio artefacto (plan ligero) en vez de olfatear internals frágiles de un tercero + verificación byte-a-byte del contrato de ruta cross-phase + audit de milestone como gate opcional pre-cierre |
| v0.12 | 10 | 5 | Spike-gate como fase separada antes de feature condicional + corrección de fuente in-milestone (Phase 50→50.1) cuando la superficie validada por el spike resultó vacía en el flujo real + reconciliación manual de deuda al cierre (drift vs obsoleto vs señal) |
| v0.13 | 17 | 11 | "Una fontanería, tres consumidores" (base determinista 0-token + N consumidores, LLM aislado en un solo carril) + UAT humana en vivo como única red para bugs semánticos/de-latencia + reubicación de requisito (ORCH-01→ORCH-02) cuando la UAT reveló un diseño inalcanzable + fixes post-verificación dentro de la misma fase |

### Cumulative Quality

| Milestone | Tests | LOC (src) | LOC (test) |
|-----------|-------|-----------|------------|
| v0.2 | 122 | 2,782 | 1,868 |
| v0.3 | 366+ | ~5,400 | ~6,280 |
| v0.4 | 415 | ~5,400 | ~7,760 |
| v0.5 | 511+ | ~6,500 | ~9,855 |
| v0.6 | ~688 | ~8,000 | ~13,000 |
| v0.7 | 777 | ~9,500 | ~16,500 |
| v0.8 | 895 | ~10,374 (src+bin) | ~19,297 |
| v0.9 | 1073 | ~12,500 (src+bin, +TUI) | ~23,900 |
| v0.10 | 1213 | — | — |
| v0.11 | 1263 | — | — |
| v0.12 | 1307 | — | — |
| v0.13 | 1543 | — | — |
| v0.14 | 1639 | — | — |

### Top Lessons (Verified Across Milestones)

1. Small plans (1-2 tasks) execute reliably — zero failures across 42+ plans (v0.2 + v0.4 + v0.5 evidence; v0.3 with 25 plans similar pattern)
2. Pure helper extraction + DI > mock.module for Node.js test runner compatibility
3. Source-hygiene grep tests blindan invariantes "DRY hard-enforced" donde un helper es la única fuente legítima — ratifican refactor sin miedo a drift inline (v0.4, v0.5)
4. Sequential-no-worktree gana a parallel-worktree para fases test-only con archivos disjuntos (v0.4) — el overhead de worktree solo paga cuando los plans son largos y/o tocan el mismo árbol
5. `spawnSync` child + tmpdir aislado es el patrón canon para tests de hooks (v0.5 — Phase 16 estableció, Phase 17 y 999.1 reusaron). Nunca importar el hook in-process; siempre spawnar.
6. `requirements mark-complete` automatizado YA debería ser parte del verifier — tres milestones consecutivos (v0.3, v0.4, v0.5) con checkbox drift son señal clara de bug de proceso, no de descuido puntual.
7. El audit no debe morir al cerrar el milestone; debe re-correrse — v0.5 cerró con un audit `gaps_found` de hace 5 días que ya no reflejaba la realidad (v0.5).
