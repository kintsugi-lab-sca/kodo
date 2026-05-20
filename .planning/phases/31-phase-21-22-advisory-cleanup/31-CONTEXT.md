# Phase 31: Phase 21/22 Advisory Cleanup - Context

**Gathered:** 2026-05-20
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 31

<domain>
## Phase Boundary

Cerrar las 3 advisory observations no-bloqueantes que quedaron como tech debt al final de Phase 21 (Skill Sync CLI + Auto-Sync, v0.6). Phase 21 cerró exit-code-correctness y wiring auto-launch; estas advisories son refactor estructural de pureza + observabilidad de cleanup ordering + cobertura de un path que se testeó estructuralmente pero no runtime-real.

Cubierto por esta phase:
- **ADVISORY-01** (cierra Phase 21 WR-04): `syncSkill` acepta callback opcional `onConsoleWarn` para emitir el warning del prune (`src/skill/sync.js#117` `--prune` foreign removal). Default `console.warn` preserva back-compat. Tests pueden capturar warnings sin spy global ni monkey-patch.
- **ADVISORY-02** (cierra Phase 21 WR-05): `runSkillSyncCli` acepta `cleanupFn` opcional como DI dep; cuando se inyecta, se ejecuta `await cleanupFn()` ANTES del return value (= el código de exit que el caller bin/kodo usa para `process.exit`). Tests verifican exit ordering observable (cleanup completa antes de que el caller vea el código).
- **ADVISORY-03** (cierra Phase 21 WR-06): Test `test/launch.test.js` (o nuevo `test/orchestrator/launch.test.js`) reemplaza el patrón mockSpawn estructural por spawn real vía `spawnFn` DI inyectada en `launchOrchestrator`. El spawn ejecuta un `node -e <inline-script>` que simula el lifecycle escribiendo state.json + NDJSON head-line con `session.start` + `transcript_path` populated. Assertions sobre observables post-launch.

Fuera de scope (Phase 31):
- Refactor del módulo `cmux` client (la interface cmux.newWorkspace/setColor/etc. permanece intacta).
- Cambios en `syncSkill` core logic — solo añadir el parámetro opcional. No tocar el SHA-256 drift detection, symlink replace, ni walkFiles.
- Cambios al exit code policy de `runSkillSyncCli` (0/1/2 byte-exact preservado).
- `runSkillSyncCli` llamando `process.exit` internamente — sigue retornando el código, el caller bin/kodo gestiona el exit.
- Refactor del workflow auto-sync en `launchOrchestrator` (D-03 fail-open + skill.sync.auto[.error] events preservados).

Fuera de scope (otras phases v0.8):
- Phase 32 — v0.7 bookkeeping doc-only (REQUIREMENTS traceability + VERIFICATION backfill + nyquist_compliant toggle).
- v0.7 tech debt residual (POLL-FIX-01 + DAEMON-01/02 ya cerrado en Phase 28).

</domain>

<decisions>
## Implementation Decisions

### ADVISORY-01: `syncSkill` onConsoleWarn callback

- **D-01 — Signature shape**: añadir `onConsoleWarn?: (msg: string) => void` al opts object de `syncSkill({source, dest, prune?, onConsoleWarn?})`. Cuando undefined, default = `console.warn`. Cuando provisto, reemplaza completamente la llamada (no se invocan ambos).
- **D-02 — Aplicación**: solo el callsite del `--prune foreign removal` en `src/skill/sync.js#117` necesita el cambio. Es el único `console.warn` directo en el módulo "puro". Otros prints permanecen en CLI (que sí puede tocar stdout/stderr directamente).
- **D-03 — Back-compat**: callers existentes que NO pasan `onConsoleWarn` reciben behavior idéntico (`console.warn` directo) — zero churn en `src/cli/skill-sync.js#43` y `src/orchestrator/launch.js#90` que invocan syncSkill sin opts.onConsoleWarn.

### ADVISORY-02: `runSkillSyncCli` cleanupFn DI

- **D-04 — Ubicación**: `cleanupFn` vive como nuevo DI dep en el `deps` object de `runSkillSyncCli({opts}, deps)`. Sigue el patrón existente (`syncFn`, `writeFn`, `errFn`, `cwdFn`, `formatterFn`).
- **D-05 — Orden**: si `cleanupFn` está provisto, se ejecuta `await deps.cleanupFn()` JUSTO ANTES del `return <exit-code>` en cada salida (tanto `return 0`, `return 1`, `return 2`). Cleanup corre incondicionalmente — incluso en paths de error.
- **D-06 — Test ordering**: el test inyecta un `cleanupFn` que push un timestamp a un array compartido + el caller (el test) push otro timestamp al recibir el código retornado. Assertion: `cleanup_ts < return_ts` por nanos. Permite verificar exit ordering observable sin `process.exit` real.
- **D-07 — process.exit NO se mueve**: `runSkillSyncCli` sigue retornando el número sin invocar `process.exit`. Es responsabilidad de bin/kodo (caller) hacer el exit. La advisory solo asegura que cleanup esté COMPLETO antes de devolver control al caller.
- **D-08 — try/finally semantics**: cleanup en path de error también corre. Patrón:
  ```js
  try { ... return 0; } catch { ... return 1; } finally { if (cleanupFn) await cleanupFn(); }
  ```
  o equivalente estructural — la implementación decide entre try/finally vs cleanup explícito antes de cada return. Test cubre las 3 ramas (ok/error fs/no kodo repo).

### ADVISORY-03: `launchOrchestrator` real-spawn test

- **D-09 — Approach**: inyectar `spawnFn` DI en `launchOrchestrator`. Default `spawnFn` = `child_process.spawn` (zero churn callers existentes). Test inyecta un spawn que ejecuta `node -e '<inline-script>'`.
- **D-10 — Inline script behavior**: el `node -e` script simula el orchestrator lifecycle:
  1. Lee `KODO_DIR` env var (test la setea a tmpHome).
  2. Llama `addSession(taskId, sessionRecord)` con shape canónico (incluye `task_id`, `session_id`, `task_ref`, `workspace_ref`, `provider`, `started_at`, `project_path`, `gsd: false` ó `true`).
  3. Escribe head-line a `~/.kodo/logs/<session-id>.ndjson` con event `session.start` + `task_id` + `timestamp` + `transcript_path` populated (ruta de transcript que puede no existir físicamente — el field es solo metadata).
  4. exit 0.
- **D-11 — Observables post-launch (test asserts)**:
  - `loadState().history` ó `loadState().sessions[taskId]` contains la sesión recién creada (depende de si el script invoca removeSession o no — para test simple, queda en `sessions`).
  - `~/.kodo/logs/<session-id>.ndjson` head-line parseable → JSON.parse retorna objeto con `event: 'session.start'`, `transcript_path` no-vacío, `task_id` matchea.
- **D-12 — cmux mock**: el `cmux.newWorkspace` actual sigue siendo invocado pero el test stubeará cmux client (vía DI o env var como en `test/orchestrator-launch-isolation.test.js`) para no requerir cmux real. El spawn es lo único que pasa a ser "real".
- **D-13 — Ubicación del test**: ampliar `test/launch.test.js` (más natural — ya cubre launchOrchestrator) o crear `test/orchestrator/launch.test.js` nuevo. Decisión menor — research/planner deciden por encaje con tests existentes.
- **D-14 — File location del refactor**: `src/orchestrator/launch.js` actualmente importa cmux directamente y no expone spawnFn. Necesita refactor mínimo: añadir `opts.spawnFn` (default `child_process.spawn`) al signature de `launchOrchestrator(opts)`.

### Cross-cutting

- **D-15 — Plan estructura**: 3 plans paralelos en Wave 1.
  - `31-01-PLAN.md` → ADVISORY-01 (`src/skill/sync.js` + `test/skill-sync.test.js`)
  - `31-02-PLAN.md` → ADVISORY-02 (`src/cli/skill-sync.js` + `test/skill-sync.test.js` — overlap controlado: cada plan toca un describe block diferente)
  - `31-03-PLAN.md` → ADVISORY-03 (`src/orchestrator/launch.js` + `test/launch.test.js`)
  - Files no se solapan entre `src/*` paths. Test file `test/skill-sync.test.js` aparece en plans 31-01 y 31-02 — overlap intencional pero los plans tocan describe blocks distintos. Si executor paralelo causa merge conflicts, fallback es serializar 31-01 + 31-02 dentro de Wave 1 (planner decide).
- **D-16 — Suite floor**: ≥830 pass + 0 fail (ROADMAP SC#4 textual). Baseline real post-Phase-30 = 884 pass. Phase 31 añade ~6-8 tests netos (2-3 por advisory). Esperado post-phase ≥890.
- **D-17 — STATE.md closure**: post-phase, marcar WR-04/05/06 como CERRADOS en el v0.6 deferred section de STATE.md. v0.6 deferred section debe reducir a 0 items (LIFE-01/LIFE-02 ya cerrados en Phase 30).
- **D-18 — Drift v0.6-MILESTONE-AUDIT.md**: ROADMAP SC#4 menciona también `v0.6-MILESTONE-AUDIT.md` como tracker — verificar si existe entry de WR-04/05/06 ahí y cerrarla. Discretionary: si el audit ya cierra el ciclo a nivel de milestone shipped, el tracking se hace solo en STATE.md (single source of truth).

</decisions>

<deferred>
## Noted for Later

Ninguna idea nueva surgida durante discuss. Phase 31 es scope cerrado por SC del ROADMAP — cualquier follow-up estructural sobre skill-sync, launchOrchestrator o test infrastructure que aparezca durante research/execute va al backlog del milestone (v0.9+).

</deferred>

<canonical_refs>
## Canonical References (downstream agents MUST read)

- `.planning/ROADMAP.md` — Phase 31 entry (líneas 69-79), SC#1..SC#4
- `.planning/REQUIREMENTS.md` — ADVISORY-01/02/03 (líneas 33-35) + traceability (líneas 91-93)
- `.planning/STATE.md` — v0.6 Deferred section (líneas 83-87) — destino del closure post-phase
- `.planning/milestones/v0.6-phases/21-skill-sync-cli-auto-sync/21-VERIFICATION.md` — origen WR-04/05/06 (líneas 92-94, 96, 110)
- `.planning/milestones/v0.6-phases/21-skill-sync-cli-auto-sync/21-CONTEXT.md` — contexto histórico Phase 21 (DI patterns establecidos)
- `src/skill/sync.js` — ADVISORY-01 callsite (línea 117 `console.warn` en `--prune` foreign removal)
- `src/cli/skill-sync.js` — ADVISORY-02 callsite (`runSkillSyncCli` async, 4 returns, sin cleanup)
- `src/orchestrator/launch.js` — ADVISORY-03 callsite (`launchOrchestrator` async sin spawnFn DI)
- `test/skill-sync.test.js` — analog DI pattern (syncFn/writeFn/errFn/cwdFn — modelo para cleanupFn/onConsoleWarn)
- `test/launch.test.js` — base para refactor del test launchOrchestrator
- `test/orchestrator-launch-isolation.test.js` — analog HOME-isolation + cmux stub pattern para ADVISORY-03

</canonical_refs>

<code_context>
## Reusable Assets

### DI patterns ya en uso

- `runSkillSyncCli(opts, deps)` define `deps` con 5 fns inyectables — añadir `cleanupFn` encaja byte-exact.
- `runGsdVerifyCli(opts, deps)` (src/cli/gsd-verify.js) usa idéntico patrón — referencia cross-CLI.
- `launchOrchestrator(opts)` hoy solo acepta `logger`. Añadir `opts.spawnFn` extiende el patrón sin breaking change.

### Test infrastructure

- `test/skill-sync.test.js` ya tiene HOME-isolation + tmpdir fixtures. Reusar para tests de ADVISORY-01 y ADVISORY-02.
- `test/orchestrator-launch-isolation.test.js` ya mockea cmux client + KODO_DIR override. Mismo scaffold sirve para ADVISORY-03 con la adición del spawnFn DI.
- `node:test` runner + `node --test` invocation pattern preservado (zero deps externos).

### Idioms relevantes

- Fail-open via NDJSON event (Phase 19 pattern) — preservado en launchOrchestrator auto-sync. NO modificar.
- D-08 SoSoT — `syncSkill` es el único punto de drift detection + sync. CLI y orchestrator invocan idéntico. NO duplicar logic.
- Color isolation (Phase 14 D-07) — `src/skill/sync.js` NO debe importar picocolors. Manteniendo el módulo "puro" (excepto el console.warn ahora callbackable).

### Anti-patterns conocidos

- **No invocar `process.exit` desde dentro de `runSkillSyncCli`** — el caller bin/kodo es el dueño del exit. Phase 31 preserva esta separación.
- **No mockear cmux client con env var** sin antes verificar que el test isolation funciona — `test/orchestrator-launch-isolation.test.js` es el blueprint.
- **No spawnear claude binary real** en tests — siempre stub vía spawnFn DI o tmpdir PATH manipulation.
- **No tocar `walkFiles` / SHA-256 drift logic** — Phase 21 lockó ese comportamiento, ADVISORY-01 solo añade callback opcional al console.warn.

</code_context>

<success_criteria>
- SC#1 ROADMAP byte-exact: `syncSkill({onConsoleWarn})` acepta callback, default console.warn, tests capturan sin monkey-patch.
- SC#2: `runSkillSyncCli` ejecuta `await cleanupFn()` antes del return value, observable en test ordering.
- SC#3: Test `launchOrchestrator` real (no mockSpawn-only) con state.json + NDJSON session.start + transcript_path observables.
- SC#4: Suite global ≥830 pass + 0 fail (real esperado ≥890). v0.6 deferred section de STATE.md reduce a 0 items (3 ✅ CLOSED entries).

</success_criteria>

---

*Generated by /gsd-discuss-phase. CONTEXT.md feeds gsd-phase-researcher + gsd-planner — decisiones tomadas aquí están lockadas para downstream.*
