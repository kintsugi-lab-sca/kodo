# Requirements: kodo v0.8 — Consolidación + GSD Provider Reporting

**Defined:** 2026-05-15
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. v0.8 consolida la promesa cerrando tech debt v0.7, integrando reporting opt-in al provider, y resolviendo bugs de lifecycle SessionRecord.

## v1 Requirements (this milestone)

### POLL — Polling/Daemon hardening (cierra v0.7 tech debt)

- [ ] **POLL-FIX-01**: `normalizeIssue` (`src/providers/github/normalize.js`) incluye `updated_at` y `created_at` canónicos en el TaskItem retornado, de modo que `shouldDispatch` evalúa contra timestamps reales (no `undefined`) cuando el caller usa el provider-only path. Test: `test/providers/github/normalize.test.js` aserción de ambos campos presentes; `test/triggers/polling.test.js` añade caso provider-only path que dispara correctamente. Cierra D-18 leak guard de Phase 25.

### DAEMON — Polling daemon DX (cierra v0.7 tech debt)

- [ ] **DAEMON-01**: User puede invocar `kodo polling start --verbose` y ver stdout estructurado por tick (timestamp ISO, repos polled, dispatch decisions, rate-limit remaining). Sin `--verbose`, comportamiento actual (silent/quiet) preservado. Test: integration test spawn real con `--verbose` + assert ≥1 línea por tick.
- [ ] **DAEMON-02**: El daemon escribe stderr/stdout a `~/.kodo/logs/polling-YYYY-MM-DD.log` con rotación diaria (un archivo por día, retención últimos 7 días). User puede inspeccionar crashes pasadas via `cat ~/.kodo/logs/polling-*.log`. Cierra T-26-DIAG silent crash. Test: spawn daemon que crashea intencionalmente + assert logfile contiene stack trace.

### REPORT — GSD Provider Reporting integration (rama paralela `gsd-provider-reporting`)

- [ ] **REPORT-01**: Dispatcher filtra labels `kodo:gsd-child` (anti-recursión). Tareas creadas por el agente como sub-issues NUNCA disparan nuevas sesiones, ni siquiera con `--force`. Cortes ANTES de `parseKodoLabels` / lock acquire / resolver / launch. Test: `test/triggers/dispatcher.test.js` 3 escenarios (label sola, label + `kodo:gsd`, `--force` con label).
- [ ] **REPORT-02**: User puede activar `workflow.report_to_provider: true` en `~/.kodo/config.json`. Helper `isReportToProviderEnabled()` retorna `true` SOLO con strict equality `=== true` (any otro valor → false). DEFAULT_CONFIG NO contiene la key `workflow` (anti-mutation invariant). Test: `test/config.test.js` matriz 5 estados (true, "true", 1, undefined, missing key).
- [ ] **REPORT-03**: `applyReportingGate(prompt, enabled)` (pure function idempotente) inserta/quita la sección "Sub-issue reporting" entre marcadores `<!-- BEGIN reporting -->` / `<!-- END reporting -->` en `src/orchestrator/prompt.md`. Test: SR1..SR6 gating asserts.
- [ ] **REPORT-04**: `src/orchestrator/prompt.md` contiene prosa ES provider-agnostic (vía `{{provider_name}}`) cubriendo: just-in-time creation de sub-issue por phase con label `kodo:gsd-child`, comentarios plan-by-plan en el sub-issue, lifecycle abstracto, append-only (NUNCA `delete-issue`), HARD STEP pre-transición phase, log literal `[kodo:reporting] MCP failure on phase N: <error>`. Test: RC1..RC15 + RA1..RA6 content asserts.
- [ ] **REPORT-05**: `KODO_LABEL_GSD_CHILD = 'kodo:gsd-child'` exportado desde `src/labels.js` + helper `isGsdChild(labels)` con tests source-hygiene anti-inline (cualquier consumer DEBE usar el helper, no comparar string literal).
- [ ] **REPORT-06**: Planning artifacts v0.8 regenerados manualmente (PLAN/SUMMARY/VERIFICATION/VALIDATION) con la numeración de phases v0.8 correspondiente (NO Phase 14-15 de la rama, que colisionaba con v0.5 main). Cherry-pick selectivo aplicado de los 9 commits de código de la rama `gsd-provider-reporting` documentados en `.planning/PENDING-INTEGRATIONS.md`. Suite global verde tras integración (≥819 tests = 777 actual + 38 heredados + 4 nuevos REPORT-01..05 mínimo, ajustar tras phase real).

### LIFE — SessionRecord lifecycle (cierra v0.6 deferred + driver real ROMAN-132)

- [ ] **LIFE-01**: `findSession(sessionId)` (en `src/session/state.js` o equivalente) escanea tanto `state.sessions` (activas) como `state.history` (terminadas) y retorna el SessionRecord encontrado en cualquiera. User puede invocar `kodo gsd verify <session-id>` o `kodo logs --session-of <task-id>` y obtener resultado correcto incluso si la sesión ya pasó por el stop hook. Driver: ROMAN-132 (2026-05-15) confirmó state.json desync — `sessions: {}` mientras la sesión seguía viva en cmux. Resolución parcial: cross-check con `cmux rpc workspace.list` antes de declarar terminada. Cierra CR-01 Phase 19.
- [ ] **LIFE-02**: `markSessionStatus(taskId, status, reason, log)` refactorea su early-return: cuando `task_id` es falsy/missing, en vez de bail-out silencioso emite `log.warn('markSessionStatus: missing task_id', {session_id, status, reason})` y retorna explícitamente con `{ok: false, reason: 'missing-task-id'}`. Misma semántica externa para callers existentes (verify.js#finalize, stop.js); observabilidad mejorada para drift futuro. Test: `test/session/mark-status.test.js` 4 escenarios (task_id presente OK, falsy → warn + return, undefined → warn + return, empty string → warn + return). Cierra WR-07 Phase 22.

### ADVISORY — Phase 21/22 advisory follow-up

- [ ] **ADVISORY-01**: `syncSkill` (en `src/skill-sync.js` o equivalente) acepta callback opcional `onConsoleWarn` inyectable (defaults a `console.warn` para back-compat). Tests pueden capturar warnings sin spy global. Cierra Phase 21 WR-04.
- [ ] **ADVISORY-02**: `runSkillSyncCli` await async cleanup correctamente — no fire-and-forget en el path de salida. Tests verifican exit ordering: cleanup completo ANTES de `process.exit(N)`. Cierra Phase 21 WR-05.
- [ ] **ADVISORY-03**: `launchOrchestrator` test real (no mockSpawn-only): spawn child con stdin canónico + assert observable post-launch (state.json muta, NDJSON evento `session.start` emitido). Cierra Phase 21 WR-06.

### BOOK — Bookkeeping doc-only (cierra v0.7 audit notes)

- [ ] **BOOK-01**: `.planning/milestones/v0.7-REQUIREMENTS.md` traceability table tiene 16/16 IDs marcados `Complete` (no `pending`). Reconciliar GH-01..05, CFG-01, CFG-02, TEST-01. Wire-up funcional ya verificado en v0.7 audit; este es commit doc-only.
- [ ] **BOOK-02**: `.planning/milestones/v0.7-phases/23-githubclient-auth-foundation/VERIFICATION.md` backfill por uniformidad documental (única phase v0.7 sin él). Los 2 SUMMARYs de Phase 23 cubren funcionalmente; backfill es placeholder de cumplimiento estructural.
- [ ] **BOOK-03**: VALIDATION.md de phases 23/25/26/27 toggle `nyquist_compliant: true` (actualmente solo Phase 24 lo tiene). Tests verdes y VALIDATION.md completos ya — flag de sign-off no toggled, sin impacto funcional.

## v2 Requirements (deferidos a v0.9+)

### Adapters TaskProvider adicionales

- **CLICKUP-01**: ClickUp adapter implementando `TaskProvider` 9 métodos
- **LOCAL-01**: Local provider (JSON/Markdown) implementando `TaskProvider`
- **LOCAL-02**: File watcher trigger para provider local

### Channels alternativos

- **WEBHOOK-GH-01**: Webhook GitHub real-time (si latencia 60s polling emerge como restricción)
- **GHE-01**: GitHub Enterprise self-hosted (`base_url` configurable)
- **OAUTH-01**: OAuth GitHub App (vs PAT clásico actual)

### Operacional

- **DOCTOR-01**: `kodo gsd doctor` — scan + dry-run + apply de worktrees huérfanos y sesiones legacy en state.json sin proceso vivo

## Out of Scope

Explícitamente excluidos de v0.8 para preservar el tema "consolidación".

| Feature | Reason |
|---------|--------|
| Adapters nuevos (ClickUp, local) | v0.8 = consolidación; adapters nuevos abren scope feature → v0.9+ |
| Webhook GitHub real-time | Polling 60s default no ha emergido como restricción operativa todavía; defer hasta evidencia |
| GitHub Enterprise / OAuth GitHub App | Sin demanda concreta; PAT actual cubre el use case personal |
| `kodo gsd doctor` | Capability nueva, no tech debt; cabe mejor en v0.9 |
| Dashboard web / multi-tenant / DB | Out of scope perpetuo (PROJECT.md) |
| Retry/backoff genérico en interfaz TaskProvider | Out of scope perpetuo — responsabilidad de cada adapter |

## Traceability

Empty inicialmente. Lo llena `gsd-roadmapper` durante creación de ROADMAP.md.

| Requirement | Phase | Status |
|-------------|-------|--------|
| POLL-FIX-01 | TBD | Pending |
| DAEMON-01 | TBD | Pending |
| DAEMON-02 | TBD | Pending |
| REPORT-01 | TBD | Pending |
| REPORT-02 | TBD | Pending |
| REPORT-03 | TBD | Pending |
| REPORT-04 | TBD | Pending |
| REPORT-05 | TBD | Pending |
| REPORT-06 | TBD | Pending |
| LIFE-01 | TBD | Pending |
| LIFE-02 | TBD | Pending |
| ADVISORY-01 | TBD | Pending |
| ADVISORY-02 | TBD | Pending |
| ADVISORY-03 | TBD | Pending |
| BOOK-01 | TBD | Pending |
| BOOK-02 | TBD | Pending |
| BOOK-03 | TBD | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 0 (TBD por roadmapper)
- Unmapped: 17 ⚠️ (será 0 tras roadmap)

---
*Requirements defined: 2026-05-15*
*Last updated: 2026-05-15 after initial v0.8 definition*
