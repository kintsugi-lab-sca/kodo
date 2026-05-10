# Milestones

## v0.4 GSD Quick Mode (Shipped: 2026-04-29)

**Phases completed:** 3 phases, 11 plans, 11 tasks

**Key accomplishments:**

- buildStopNudgeText refactorizado a switch exhaustivo sobre getSessionMode(session) — sesiones quick reciben "revisión manual" en lugar de `kodo gsd verify`, sin tocar el lock release.
- Cobertura completa de getGsdMode (4 estados) y getSessionMode (4 estados de SessionRecord) en test/labels.test.js — 11 tests nuevos, todos passing, 0 regresiones en suite global (380/381).
- Cobertura completa de `gsd_mode` en `buildSessionFromTask` (4 estados behavior) más source-hygiene anti-inline anti-renombrado en `test/manager.test.js`. 5 tests nuevos (4 behavior + 1 source-hygiene), todos passing al primer intento. 0 regresiones — suite global 385/386 (1 skip pre-existente).
- Cobertura behavior completa de las 3 ramas resolver-específicas del modo quick en `test/dispatcher.test.js`: (1) descarte de `phase_id` en match, (2) tolerancia + continúa al launch en no-match, (3) fail-closed + lock release en roadmap-missing. 3 tests nuevos, todos passing al primer intento. 0 regresiones en suite global (388/389 pass, 1 skip pre-existente).
- Cobertura behavior completa (7 tests) de la rama `mode === 'quick'` de `buildGsdContext` en `src/hooks/session-start.js` (líneas 96-121, Phase 12) más 2 invariants source-hygiene (Phase 13 D-09 anti-inline + D-10 anti-acceso directo) en `test/session-start.test.js`. 9 tests nuevos, todos passing al primer intento. 0 regresiones — suite global 397/398 (1 skip pre-existente).
- Cobertura behavior completa de los dos sitios complementarios que Phase 12 introdujo: (a) `buildStopNudgeText` switch exhaustivo de 3 cases en `src/hooks/stop.js` (5 tests), (b) `buildContextSummary` gsdTag mode-first en `src/orchestrator/launch.js` (6 tests con 3 etiquetas + caso defensivo Phase 12 D-11 + legacy Phase 11 D-08 + mix). Más 6 tests source-hygiene Phase 13 D-09/D-10/D-11 distribuidos entre ambos archivos. 17 tests nuevos (11 behavior + 6 source-hygiene), todos passing al primer intento. 0 regresiones — suite global 414/415 pass, 1 skip pre-existente.

---

## v0.3 GSD Integration + Structured Logging (Shipped: 2026-04-22)

**Delivered:** Un sistema completo para que tareas Plane etiquetadas `kodo:gsd` arranquen sesiones Claude bajo el workflow GSD — bootstrap automático de repos, resolver 1:1 título→fase, gate de verificación con comentarios Plane deterministas, y observabilidad NDJSON end-to-end.

**Phases completed:** 5 phases (6-10), 25 plans, 43 feat/fix commits
**Git range:** `2ecffd6` (2026-04-15) → `ceade7e` (2026-04-22) — 7 días
**LOC:** +2,620 src / +4,410 tests / +23,178 planning = +30,216 total
**Requirements:** 22/22 satisfied (GSD-01..10 + LOG-01..12)

**Key accomplishments:**

- **Structured logging foundation (Phase 6)** — `src/logger.js` factory con NDJSON per-session, 4 niveles + `KODO_LOG_LEVEL`, redactor deep-walk de secretos (JWT/bearer/API keys), pretty-print stderr sin duplicar JSON, y vigilante `kodo check` aislado del logger (LOG-01..04, LOG-08, LOG-12)
- **`kodo logs` CLI + event taxonomy (Phase 7)** — subcomando con filtros `--level` / `--component` / `--event-type`, `--follow` tail via fs.watchFile, resolver `--session-of <plane-task-id>` two-step (state.json → head-line scan), y 7 tipos de evento tipados (session.start/end, state.transition, orchestrator.review, gsd.phase.resolved, gsd.bootstrap, plane.api.call) con helpers + DI logger cableado en 7 consumers (LOG-05..07, LOG-09..11)
- **GSD label plumbing + per-repo lock (Phase 8)** — flag `kodo:gsd` propagado desde dispatcher hasta `Session.gsd`, per-repo file lock con PID liveness + TTL, `buildGsdContext` inyecta `/gsd-plan-phase → /gsd-execute-phase → /gsd-verify-work` al arrancar sesión, y stop hook libera el lock (GSD-01, GSD-04, GSD-10)
- **Phase resolver + bootstrap (Phase 9)** — `src/gsd/roadmap.js` parser (accept `##`/`###` + decimales, reject rangos), `src/gsd/resolver.js` con discriminated union `PhaseVerdict | BootstrapVerdict | ErrorVerdict`, match 1:1 título Plane→heading, brief extraído de `task.description_markdown`, y `kodo gsd inspect <task-id>` CLI dry-run forense (GSD-02, GSD-03, GSD-08, GSD-09)
- **Orchestrator verification gate (Phase 10)** — `src/gsd/verification.js` parser + verdict discriminado pass/soft-fail/hard-fail (zero deps, prototype-pollution defense), `src/gsd/verify.js` orquestación con comentario Plane determinista en español + transición condicional a Review + evento `orchestrator.review`, `kodo gsd verify <session-id>` CLI handler con exit codes deterministas, y integración en prompt/launch/stop del orquestador (GSD-05, GSD-06, GSD-07)
- **Post-audit cleanup (Phase 10 tail)** — añadido `plane.api.call.failed` al catálogo EVENTS (8º tipo) + helper `planeApiCallFailed`, cableado en `verify.js`, y distinguidos EACCES/EMFILE de ENOENT en discovery de VERIFICATION.md (WR-01, WR-02, WR-03 del code review)
- **UAT debt closure (Phase 17, v0.5 milestone)** — los 3 UATs humanos pendientes de Phase 7 (live `--follow` tail, `session.start` con campos D-10, `--session-of` E2E) se automatizaron en `test/logs-follow-integration.test.js`, `test/session-start-event.test.js`, `test/session-of-resolver.test.js`. Cobertura equivalente sin coste humano recurrente. Ver `.planning/phases/17-phase-7-uat-automation/`.

**Known deferred items (accepted as tech debt):**

- INT-MED-01 — `dispatcher.js` usa literales `'gsd.phase.resolved'` y `'gsd.bootstrap'` en vez de `EVENTS.*` (diferido Phase 9, sin impacto runtime)
- INT-LOW-01 — `markSessionStatus` exportado pero sin callsites de producción → `state.transition` nunca se emite (diferido Phase 7 D-06)
- INT-LOW-02 — 07-01-SUMMARY doc-only mismatch `plane_task_id` vs `task_id` en código
- Nyquist validation drafts en Phases 6-8; missing en 9-10 (no bloqueante, aplicar batch retroactivo si procede)
- GSD-07 es instruction-driven via prompt.md (no programmatic pre-load) — diseño intencional

---

## v0.2 Provider Abstraction (Shipped: 2026-04-13)

**Phases completed:** 5 phases, 10 plans, 0 tasks

**Key accomplishments:**

- TaskProvider interface (9 methods) with canonical TaskItem/TriggerEvent shapes — any adapter just implements the contract
- PlaneProvider adapter with normalizer, HMAC-SHA256 verification, and label resolution behind the interface
- Provider registry with factory functions, lazy init, and singleton caching
- All 4 internal consumers (check, stop, manager, session-start) rewired to TaskProvider — zero PlaneClient imports outside adapter
- Central dispatchTrigger + pure handleWebhookRequest extracted from server.js — server is now a slim HTTP shell
- Provider-agnostic config wizard, ensureConfig guard, and orchestrator prompt with {{provider}} placeholders
- 122 tests, 4,650 LOC JavaScript (1,868 LOC tests), 28/28 requirements satisfied

---
