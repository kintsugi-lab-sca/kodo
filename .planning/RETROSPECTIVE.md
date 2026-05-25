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

### Top Lessons (Verified Across Milestones)

1. Small plans (1-2 tasks) execute reliably — zero failures across 42+ plans (v0.2 + v0.4 + v0.5 evidence; v0.3 with 25 plans similar pattern)
2. Pure helper extraction + DI > mock.module for Node.js test runner compatibility
3. Source-hygiene grep tests blindan invariantes "DRY hard-enforced" donde un helper es la única fuente legítima — ratifican refactor sin miedo a drift inline (v0.4, v0.5)
4. Sequential-no-worktree gana a parallel-worktree para fases test-only con archivos disjuntos (v0.4) — el overhead de worktree solo paga cuando los plans son largos y/o tocan el mismo árbol
5. `spawnSync` child + tmpdir aislado es el patrón canon para tests de hooks (v0.5 — Phase 16 estableció, Phase 17 y 999.1 reusaron). Nunca importar el hook in-process; siempre spawnar.
6. `requirements mark-complete` automatizado YA debería ser parte del verifier — tres milestones consecutivos (v0.3, v0.4, v0.5) con checkbox drift son señal clara de bug de proceso, no de descuido puntual.
7. El audit no debe morir al cerrar el milestone; debe re-correrse — v0.5 cerró con un audit `gaps_found` de hace 5 días que ya no reflejaba la realidad (v0.5).
