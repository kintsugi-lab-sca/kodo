---
gsd_state_version: 1.0
milestone: v0.13
milestone_name: kodo bidireccional
status: "Roadmap created — awaiting `/gsd:plan-phase 52`"
stopped_at: Phase 52 context gathered
last_updated: "2026-06-16T08:05:31.457Z"
last_activity: 2026-06-15 — Roadmap v0.13 creado (7 phases, 13/13 requirements)
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

**Project:** kodo
**Active milestone:** **v0.13 kodo bidireccional** (iniciado 2026-06-15, roadmap creado). Flujo inverso `sesión → tarea`: una sesión Claude Code ad-hoc de cmux se promueve a tarea persistente del gestor. 7 phases (52-58), 13/13 requirements mapeados, 100% cobertura.

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-15 — v0.13 iniciado; Current Milestone: kodo bidireccional).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9 añadió observabilidad en terminal (`kodo dashboard`); v0.10 la promovió a gestión (dismiss); v0.11 abrió la ventana al plan; v0.12 profundizó desde la fila (abrir la tarea + progreso vivo). **v0.13 cierra el puente en la dirección inversa** `sesión → tarea`.

**Current focus:** v0.13 Phase 52 — createTask + contrato + anti-recursión (primera fase del flujo bidireccional)

## Current Position

Phase: Not started (roadmap creado, sin planificar)
Plan: —
Status: Roadmap created — awaiting `/gsd:plan-phase 52`
Last activity: 2026-06-15 — Roadmap v0.13 creado (7 phases, 13/13 requirements)

## Roadmap v0.13 (active)

Build order (research-validated): **createTask + contrato + anti-recursión → fontanería `src/adopt.js` → CLI `kodo adopt` → SPIKE detección cmux (HARD GATE) → tecla dashboard (condicional/cuttable) → orquestador asistido → deuda v0.12 (tail independiente)**. La base determinista 0-token ships antes que cualquier consumidor ("consumers reuse the base, never own it"); la tecla del dashboard queda GATED tras el spike (espejo Phase 49→50 de v0.12). Numeración continua desde Phase 51 → primera fase **Phase 52** (NO reset).

| Phase | Goal | Requirements | Riesgo |
|-------|------|--------------|--------|
| 52. createTask + contrato + anti-recursión | `createTask` opcional typeof-detected Plane+GitHub (FROZEN-at-9 intacto) + anti-recursión shipped junto al método | BIDIR-01, BIDIR-02, BIDIR-06 | bajo (POST plumbing ya existe; espejo `getTaskState` Phase 40) |
| 53. Fontanería `src/adopt.js` | Base determinista 0-token (`adoptSession` + double-adopt guard + atomicidad LOUD + datos sanitizados); inverso exacto de `manager.launchWorkItem` | BIDIR-03, BIDIR-04, BIDIR-05, BIDIR-08 | medio (núcleo reusado por 3 consumidores) |
| 54. CLI `kodo adopt` | Consumidor determinista con workspace/cwd explícito; **ships sí o sí**, independiente del spike | BIDIR-07 | bajo (consumo de la base; espejo `launch <ref>`) |
| 55. SPIKE detección cmux (HARD GATE) | Veredicto empírico VIABLE/INVIABLE sobre detectar sesiones `claude` ad-hoc ausentes de `state.json` | DETECT-01 | n/a (spike — gate; ES el research) |
| 56. Tecla del dashboard *(condicional — cuttable a BIDIR-F1)* | Si VIABLE: tecla `a` descubre + adopta shelleando `kodo adopt`; cero endpoints nuevos | DETECT-02 | medio/alto (sujeto al gate de Phase 55) |
| 57. Orquestador asistido | Título inteligente del contexto real → shellea el mismo `kodo adopt`; consumidor no dueño; paralelizable con 56 | ORCH-01 | bajo (prosa skill + shell-out; LLM solo en el consumidor) |
| 58. Deuda heredada de v0.12 | Hardening XSS WR-01 (`src/server.js`) + cierre HUMAN-UAT diferido Phase 50.1; tail independiente | DEBT-01, DEBT-02 | bajo (independiente del flujo de adopción) |

- **⛔ GATE DURO Phase 55 → 56:** Phase 56 SOLO se planifica/ejecuta si Phase 55 concluye **VIABLE**. Research: cmux detection **empíricamente LOOKS VIABLE** (`list-workspaces`/`list-panels --json` exponen cwd + `resume_binding.kind==="claude"`), pero el gate se mantiene porque la superficie no está docs-pinned y el flujo forward se quemó dos veces en superficies version-specific. Si INVIABLE, DETECT-02 se difiere a **BIDIR-F1** sin penalizar el cierre — el núcleo (BIDIR-*) + CLI + ORCH-01 + deuda ya entregan el milestone.
- **CLI ships sí o sí (Phase 54):** `kodo adopt` toma workspace/cwd explícito → NO depende del spike. Debe existir antes que sus consumidores shell-out (Phase 56 dashboard + Phase 57 orquestador).
- **Anti-recursión (BIDIR-06) ships CON `createTask` en Phase 52,** no como follow-up — es una propiedad de corrección del núcleo (precedente: anti-recursión shipped con el reporting en Phase 29).
- **Phase 58 (deuda) independiente:** DEBT-01 (XSS) + DEBT-02 (HUMAN-UAT 50.1) son schedulables en paralelo / como low-risk tail; ni bloquean ni son bloqueadas por el flujo de adopción.

## Most recent shipped milestone

**v0.12 Atajos al gestor y progreso vivo** — shipped 2026-06-15 (5 phases 48-51 + 50.1 / 10 plans / 90 commits / suite 1307 pass + 1 skip). Cerrado con deuda reconocida (HUMAN-UAT del display 50.1 diferido a TTY real + XSS latente WR-01 en `src/server.js`) → **ambos saldados en Phase 58 de v0.13**. **Sin audit formal de milestone** (`/gsd:audit-milestone` no se corrió antes del cierre). Previo: **v0.11 Ventana al plan** shipped 2026-06-10.

- Roadmap archive: `milestones/v0.12-ROADMAP.md`
- Requirements archive: `milestones/v0.12-REQUIREMENTS.md`
- Phase artifacts: `.planning/phases/` (48-51 + 50.1 — NO archivados a `milestones/v0.12-phases/`, siguen en `phases/`; usar `/gsd:cleanup` para archivar retroactivamente)

## Deferred Items

Items reconocidos y diferidos (ninguno bloqueante). Los 2 items de deuda viva de v0.12 (XSS WR-01 + HUMAN-UAT 50.1) están **agendados en Phase 58 de v0.13** (DEBT-01, DEBT-02). La deuda Nyquist de v0.11 (Phases 44/45/46) quedó saldada en **Phase 51** (NYQ-03, citation-based).

| Categoría | Item | Estado | Diferido en |
|-----------|------|--------|-------------|
| uat | Phase 50.1 (v0.12) `50.1-HUMAN-UAT.md` 3 escenarios + `50.1-VERIFICATION.md` `human_needed` (8/8 must-haves auto-verificados) — display de progreso vivo `N/M`; requiere TTY real con sesión GSD viva | → agendado **Phase 58** (DEBT-02) | v0.12 close |
| security | Phase 48 (v0.12) XSS latente WR-01 — `src/server.js` renderiza `task_url` como `<a href>` sin allowlist `http(s)` (la TUI sí la aplica vía `runOpen`); `javascript:`/`data:` inyectable en el HTML servido | → agendado **Phase 58** (DEBT-01) | v0.12 close |
| nyquist | Phase 44 (v0.11) `44-VALIDATION.md` → status=approved, nyquist_compliant=true (cita 44-VERIFICATION.md passed 10/10) | ✓ saldado Phase 51 (NYQ-03) | v0.11 close |
| nyquist | Phase 45 (v0.11) `45-VALIDATION.md` → status=approved, nyquist_compliant=true (cita 45-VERIFICATION.md passed 7/7) | ✓ saldado Phase 51 (NYQ-03) | v0.11 close |
| nyquist | Phase 46 (v0.11) `46-VALIDATION.md` → status=approved, nyquist_compliant=true (cita 46-VERIFICATION.md passed 6/6 + 46-HUMAN-UAT.md 2/2) | ✓ saldado Phase 51 (NYQ-03) | v0.11 close |
| frontmatter | `requirements_completed: []` vacío en summaries de 46-01 y 47-01 (v0.11) — cobertura verificada por VERIFICATION + integration + traceability | cosmético | v0.11 close |
| verification | Phase 37/38 (v0.9) sin VERIFICATION.md formal — cerradas vía UAT/HUMAN-UAT passed | covered-by-UAT | v0.9 close |
| code | Ciclo de import ESM App.js ↔ SessionTable.js (constantes OVERLAY_*) — resuelto en runtime, suite verde, frágil | WARNING-01 | v0.9 close |

## Accumulated Context

### Decisions (Roadmap v0.13)

- **Numeración continua (NO reset):** v0.13 continúa desde Phase 51 (v0.12) → primera fase es **Phase 52**. El número del spike (Phase 55) flota con la secuencia, no es hardcoded.
- **`createTask` opcional typeof-detected FUERA de los 9 FROZEN (Phase 52):** espejo exacto de `getTaskState` (Phase 40) — el contrato `TaskProvider` sigue FROZEN en 9, el loop de validación de `registry.js` queda intacto, un `it()` capability-gated en la contract matrix espeja el test B8. Primera vez que kodo *crea* tareas (revisa conscientemente el Out of Scope histórico "kodo no crea ni elimina tareas"; **nunca elimina** sigue en pie).
- **Anti-recursión (BIDIR-06) shipped CON `createTask` en Phase 52,** no como follow-up: propiedad de corrección del núcleo (corte espejo `isGsdChild` ANTES de lock/resolver/launch + creación en estado no-trigger). Precedente: anti-recursión shipped con el reporting en Phase 29.
- **Fontanería antes que consumidores (Phase 53 antes de 54/56/57):** "consumers reuse the base, never own it". `src/adopt.js` es módulo top-level provider-agnostic (NO bajo `src/gsd/`), inverso exacto de `manager.launchWorkItem`, determinista 0-token (preserva "solo el orquestador usa LLM"). Siembra la fila vía el `addSession` existente; NO escribe `dead_since`/`last_seen_alive` (preserva "`reconcileTick` único escritor de `alive`").
- **BIDIR-08 (datos sanitizados) en la fontanería (Phase 53), no en el CLI:** el sanitizador (strip rutas absolutas, redacción home dir, nunca embeber transcript) es una propiedad del núcleo que los 3 consumidores reusan — incluido el orquestador (ORCH-01 pasa su título derivado por ese mismo sanitizador).
- **CLI `kodo adopt` ships sí o sí (Phase 54),** independiente del spike: toma workspace/cwd explícito. Debe existir antes que la tecla del dashboard (56) y el orquestador (57), que lo shellean vía `execFile`.
- **DETECT-01 = SPIKE / HARD GATE (Phase 55), DETECT-02 condicional/cuttable (Phase 56):** espejo exacto de Phase 49→50 de v0.12. Research dice que cmux detection **empíricamente LOOKS VIABLE** (`list-workspaces`/`list-panels --json` exponen cwd + `resume_binding.kind==="claude"`, `src/host/cmux.js` ya es el único llamador autorizado), pero el gate se mantiene: superficie no docs-pinned + el flujo forward se quemó dos veces (Phase 50→50.1 `~/.claude/tasks/` vacío; Phase 43 `workspace_ref` reciclado). Si INVIABLE → DETECT-02 difiere a BIDIR-F1 sin penalizar el cierre.
- **ORCH-01 (Phase 57) NO depende del spike → paralelizable con Phase 56:** el orquestador es el único carril con LLM; deriva el título inteligente y shellea `kodo adopt --title "<derived>"` con input explícito. El LLM vive estrictamente en el consumidor, el núcleo sigue 0-token. Cero lógica de negocio nueva en el orquestador (solo prosa del skill `kodo-orchestrate`).
- **DEBT-01 + DEBT-02 plegados en UNA fase tail (58):** ambos independientes del flujo de adopción y entre sí, schedulables en paralelo / como low-risk tail. Granularidad coarse → no se padean en dos fases.
- **Cero endpoints nuevos preservado:** la adopción vive en CLI + acción de dashboard que shellea el CLI vía `execFile` (no `POST /adopt` en `src/server.js`). Invariante "cero endpoints nuevos desde v0.10" intacto.

### Roadmap Evolution

- **v0.13 roadmap creado (2026-06-15):** 7 phases (52-58), numeración continua desde v0.12 (NO reset). Build order createTask+contrato+anti-recursión → fontanería → CLI → SPIKE(gate) → tecla dashboard(condicional) → orquestador → deuda. 13/13 requirements mapeados, 100% cobertura. Phase 56 GATED tras veredicto VIABLE de Phase 55. Backlog Phase 999.1 ("kodo bidireccional") materializado en este milestone.
- **v0.12 roadmap creado (2026-06-11):** 4 phases (48-51). Build order OPEN CORE → SPIKE → DISPLAY CONDICIONAL → NYQUIST.
- **v0.11 roadmap creado (2026-06-09):** 4 phases (44-47). Build order OVERLAY+POLISH → SPIKE → CAPTURA CONDICIONAL → NYQUIST.

### Open Blockers

None.

### Open Questions

Decisiones discuss-phase (no bloquean el roadmap; se resuelven al planificar cada fase):

- **Phase 52:** confirmar el path exacto del endpoint Plane `POST .../work-items/` + el shape del body GitHub Markdown; pin del scope PAT mínimo (`issues:write`/`repo`); el estado "no-trigger" exacto en que se crea la tarea para que `listPendingTasks` no la devuelva (label-aware en Plane vs state inicial en GitHub).
- **Phase 53:** forma exacta del discriminante `{ok:false, code, detail}` (taxonomía de `code`); la regla de sanitización (allowlist vs blocklist) y el alcance de la redacción del home dir; estado inicial "sano" concreto por provider.
- **Phase 55 (spike):** orden empírico de captura de las dos señales cmux; criterio de timebox; pin del fixture JSON de `list-workspaces`/`list-panels` en la build instalada; si cmux expone `--session-id` por workspace.
- **Phase 56 (solo si 55=VIABLE):** descubrimiento on-demand (set-difference por `current_directory`/UUID, NO `workspace_ref`); UX del double-confirm; si la sesión ad-hoc se muestra en un overlay efímero o inline.
- **Phase 58 (LIFE-03) — decisión central:** mapear EMPÍRICAMENTE el baile actual `Stop`↔`reconcileTick`-rescue↔`needs-input` ANTES de mover el cleanup. Hoy `runStopHook` (`stop.js`) hace el cleanup destructivo completo (`removeSession`) en CADA invocación del hook `Stop` (que dispara por turno, sin guard de "fin de sesión"); el dashboard no se vacía porque (a) las sesiones kodo son agénticas single-turn y (b) `reconcileTick` **rescata desde `history`** (`reconcile.js:195-222`, Phase 38 / ROMAN-151/152) las sesiones cuyo `workspace_ref` sigue vivo en cmux. Mover `removeSession` de `Stop` a `SessionEnd` (decisión confirmada por el operador) debe: (1) verificar que `needs-input` sigue visible SIN depender del rescate; (2) decidir si el rescate desde `history` se simplifica o se conserva; (3) mantener `Stop` solo para el estado ligero (`idle`); (4) idempotencia entre los dos hooks. NO es "mover una línea" — es re-coreografiar el lifecycle.

### Critical Invariants to Preserve (cross-milestone, must survive next milestone)

- **TaskProvider contract: 9 obligatorios + getTaskState/createTask opcionales** (canonical en `src/interface.js`): `TASK_PROVIDER_METHODS` FROZEN en 9. **v0.13: `createTask` se añade typeof-detected FUERA de los 9 (espejo `getTaskState`); el loop de validación de `registry.js` queda intacto.**
- **kodo NUNCA elimina tareas:** v0.13 introduce la creación (`createTask`) pero NO el delete — un huérfano de proveedor se resuelve por re-run idempotente (BIDIR-04/05), no por delete.
- **Tokens: vigilante/server 0 tokens; solo el orquestador usa LLM.** **v0.13: la fontanería (`createTask` + `adoptSession`) es determinista 0-token; el LLM vive estrictamente en el consumidor orquestador (ORCH-01).**
- **Cero endpoints nuevos desde v0.10:** **v0.13 lo preserva — la adopción vive en CLI + acción de dashboard que shellea el CLI vía `execFile`, no `POST /adopt`.**
- **`reconcileTick` único escritor de `alive`** (v0.9 Phase 38): **v0.13: `adoptSession` siembra la fila vía `addSession`, NO escribe `dead_since`/`last_seen_alive`.**
- **`execFile` fire-and-forget sin shell** (v0.9 Phase 37): **v0.13: la tecla del dashboard (56) y el orquestador (57) shellean `kodo adopt` con argv literal, nunca shell.**
- **Color isolation** (`picocolors` solo desde `src/cli/format.js`) · **TUI never-throws** (la tecla del dashboard never-throws, panel ink permanece montado) · **Selección por identidad `task_id`** · **TUI read-only salvo dismiss-de-dead** (la adopción shellea el CLI, no escribe desde la TUI) · **Worktree always-on Phase 18** · **LOG-12 guard** · **`--json` byte-determinismo** (DX-06). v0.13 no rompe estos carriles.

## Session Continuity

- **Last session:** 2026-06-16T08:05:31.449Z
- **Stopped at:** Phase 52 context gathered
- **Next action:** `/gsd:plan-phase 52` (createTask + contrato + anti-recursión). Phase 58 (deuda v0.12) puede correr en paralelo en cualquier momento. Phase 56 (tecla dashboard) queda gated tras el veredicto de Phase 55.
- **Files of record:**
  - `.planning/PROJECT.md` (Current Milestone: v0.13 kodo bidireccional)
  - `.planning/ROADMAP.md` (v0.13 activo Phases 52-58; v0.10/v0.11/v0.12 colapsados en archived; backlog 999.1 materializado)
  - `.planning/REQUIREMENTS.md` (v0.13, traceability 13/13 → Phases 52-58)
  - `.planning/research/` (ARCHITECTURE, FEATURES, PITFALLS, STACK — research v0.13 completo; build order en ARCHITECTURE.md §"Suggested Build Order")
  - `.planning/MILESTONES.md` (entrada v0.12 completa)

## Operator Next Steps

- Planificar la primera fase con `/gsd:plan-phase 52`
