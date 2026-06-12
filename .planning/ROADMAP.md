# Roadmap: kodo

## Milestones

- ✅ **v0.2 Provider Abstraction** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v0.3 GSD Integration + Structured Logging** — Phases 6-10 (shipped 2026-04-22)
- ✅ **v0.4 GSD Quick Mode** — Phases 11-13 (shipped 2026-04-30)
- ✅ **v0.5 CLI Polish & v0.3 Debt Cleanup** — Phases 14-17 + 999.1 (shipped 2026-05-11)
- ✅ **v0.6 Session Isolation & Skill Sync** — Phases 18-22 (shipped 2026-05-13)
- ✅ **v0.7 GitHub Issues Adapter** — Phases 23-27 (shipped 2026-05-14)
- ✅ **v0.8 Consolidación + GSD Provider Reporting** — Phases 28-33 (shipped 2026-05-25)
- ✅ **v0.9 kodo TUI — sesiones en vivo** — Phases 34-39 + 39.1 (shipped 2026-06-03)
- ✅ **v0.10 Higiene y estado real de sesiones** — Phases 40-43 (shipped 2026-06-08)
- ✅ **v0.11 Ventana al plan** — Phases 44-47 (shipped 2026-06-10)
- 🚧 **v0.12 Atajos al gestor y progreso vivo** — Phases 48-51 (in progress)

## Phases

### 🚧 v0.12 Atajos al gestor y progreso vivo (In Progress)

**Milestone Goal:** Profundizar el dashboard en dos direcciones desde la fila de sesión — *hacia afuera* (saltar a la tarea en Plane/GitHub con una tecla) y *hacia adentro* (ver el progreso vivo de la sesión, **condicional** a que un spike empírico confirme que la captura es viable en el Claude Code instalado).

> **⛔ GATE DURO (Phase 49 → Phase 50).** Phase 50 (display de progreso vivo) se ejecuta **SOLO si Phase 49 (spike) devuelve VIABLE.** Si devuelve **INVIABLE — el default esperado según el research** (`Task*` tools bypassean PostToolUse, issue anthropics/claude-code #20243) — Phase 50 se **corta por completo** (sin stub, sin placeholder, sin código muerto): PROG-02/03 se difieren a v2 (ya anticipados como PROG-F1) y el milestone cierra con OPEN-* + NYQ-03 **sin penalización**. La salud del roadmap NO depende de que la mitad condicional aterrice.

- [ ] **Phase 48: Open-in-manager core** — Tecla `o` abre la tarea (Plane/GitHub) en el navegador vía `execFile` never-throws + fix del bug latente de URL de Plane (ships sí o sí)
- [ ] **Phase 49: Live-progress spike (HARD GATE)** — Veredicto empírico VIABLE/INVIABLE sobre capturar task-state vivo en el Claude Code instalado
- [ ] **Phase 50: Live-progress display (CONDICIONAL — solo si Phase 49 = VIABLE)** — Captura + persiste + muestra el avance `N/M` por sesión en el dashboard
- [ ] **Phase 51: Backfill Nyquist v0.11** — `VALIDATION.md` citation-based para Phases 44/45/46 (doc-only Tier 1, independiente)

<details>
<summary>✅ v0.11 Ventana al plan (Phases 44-47) — SHIPPED 2026-06-10</summary>

- [x] Phase 44: Overlay de plan GSD + pulido de dashboard (2/2 plans) — PLAN-01, PLAN-02, TUI-18, TUI-19
- [x] Phase 45: Inyección de plan ligero universal (1/1 plan) — PLAN-03
- [x] Phase 46: Overlay del plan ligero para sesiones quick/non-GSD (1/1 plan) — PLAN-04
- [x] Phase 47: Backfill de deuda Nyquist (1/1 plan) — NYQ-01, NYQ-02

Archivo: `milestones/v0.11-ROADMAP.md` · Requirements: `milestones/v0.11-REQUIREMENTS.md` · Audit: `milestones/v0.11-MILESTONE-AUDIT.md` (status: tech_debt — deuda Nyquist 44/45/46 diferida)
</details>

<details>
<summary>✅ v0.10 Higiene y estado real de sesiones (Phases 40-43) — SHIPPED 2026-06-08</summary>

- [x] Phase 40: Provider State — contrato + providers + enrichment (2/2 plans) — PSTATE-01..04
- [x] Phase 41: Doctor — módulo puro de saneo + CLI (3/3 plans) — DOCTOR-01..04
- [x] Phase 42: Dismiss — TUI read-write + server amplification (3/3 plans) — DISMISS-01..04
- [x] Phase 43: Render — provider_state en el dashboard (2/2 plans) — PSTATE-05, 06

Archivo: `milestones/v0.10-ROADMAP.md` · Requirements: `milestones/v0.10-REQUIREMENTS.md` · Audit: `milestones/v0.10-MILESTONE-AUDIT.md`
</details>

Milestones anteriores (v0.2–v0.9): ver `milestones/v<X.Y>-ROADMAP.md`.

## Phase Details

### Phase 48: Open-in-manager core

**Goal**: El operador salta de una fila del dashboard a la tarea en su gestor (Plane/GitHub) con una sola tecla, sin salir de la TUI. Ships incondicionalmente — es la promesa central del milestone, independiente del spike.
**Depends on**: Nothing (primera fase del milestone; el round-trip de la URL ya está construido en código shipped)
**Requirements**: OPEN-01, OPEN-02, OPEN-03, OPEN-04
**Success Criteria** (what must be TRUE):

  1. El operador pulsa `o` sobre una fila con `task_url` y se abre la tarea en el navegador del sistema (Plane/GitHub); el panel ink permanece montado (cero unmount, cero toggle de alt-screen).
  2. Sobre una fila legacy sin `task_url`, la tecla `o` es un no-op con mensaje de footer claro (`no task URL for this session`) — nunca invoca `open` con argumento falsy/garbage.
  3. Cualquier fallo del launcher (ENOENT / navegador ausente / exit≠0 / throw) se reporta en el footer y nunca crashea React (never-throws end-to-end).
  4. URLs no-`http(s)` (`file://`, `javascript:`, valores con `-` inicial) se rechazan antes de llegar a `execFile`; la URL se pasa como argumento literal, nunca por shell.
  5. En un deploy Plane con web/API separados (`web_url ≠ base_url`), el link abre la web UI viva — no el host de API; el identificador `UNKNOWN-<seq>` se trata como "sin URL" (footer), no como link muerto.

**Plans**: 3 plans (2 waves)
**UI hint**: yes

Plans:
**Wave 1**

- [x] 48-01-PLAN.md — Fix Plane browse-URL bug: optional `plane.web_url` config wired end-to-end (registry -> provider -> normalizer) + UNKNOWN-suppression (OPEN-04)
- [x] 48-02-PLAN.md — `open.js` never-throws launcher (http(s) allowlist, literal argv) + `o` keypress handler + `onOpen` DI wiring (OPEN-01, OPEN-02, OPEN-03)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 48-03-PLAN.md — HUMAN-UAT close: real browser launch + alt-screen survival + legacy no-op + split-deploy URL (mirror Phase 37)

### Phase 49: Live-progress spike (HARD GATE)

**Goal**: Producir un veredicto empírico escrito **VIABLE / INVIABLE** sobre si el task-state vivo de una sesión `claude --worktree` interactiva puede capturarse en la build instalada de Claude Code vía una superficie soportada. Esta fase **ES el research** — espejo de v0.11 Phase 45: empírica, version-specific, no pre-investigable desde docs. Su único deliverable es el veredicto con evidencia, no código de producción.
**Depends on**: Nothing (independiente de Phase 48; debe ejecutarse ANTES de Phase 50)
**Requirements**: PROG-01
**Success Criteria** (what must be TRUE):

  1. Existe un documento de veredicto con un **VIABLE/INVIABLE explícito** y evidencia empírica de la versión de Claude Code instalada (`claude --version`), no inferida de docs.
  2. Cada superficie candidata queda evaluada en orden de preferencia con evidencia: (1) eventos hook `TaskCreated`/`TaskCompleted`, (2) watcher del transcript JSONL, (3) lectura de `~/.claude/tasks/` (último recurso).
  4. **VIABLE solo si las 4 condiciones se demuestran**: la superficie dispara/se lee de hecho en la versión instalada · payload estable para derivar `N/M` · correlación determinista con `task_id` (vía `session_id` → `state.json`) · cero latencia/ruptura de sesión + escritura a un artefacto kodo-controlado (`~/.kodo/...`). Cualquier fallo → INVIABLE.
  5. El veredicto deja una decisión inequívoca para el gate: si INVIABLE (default esperado), Phase 50 se corta y PROG-02/03 se difieren a v2 sin penalización al milestone.

**Plans**: TBD

Plans:

- [ ] 49-01: TBD

### Phase 50: Live-progress display (CONDICIONAL — solo si Phase 49 = VIABLE)

**Goal**: Si y solo si Phase 49 devuelve VIABLE, kodo captura + persiste el progreso de cada sesión a un artefacto kodo-controlado bajo `~/.kodo/` y el dashboard lo muestra (`N/M`). **Si Phase 49 devuelve INVIABLE, esta fase NO se ejecuta** — se corta entera, sin stub ni placeholder; PROG-02/03 → v2 (PROG-F1). El display es barato (espejo del patrón `provider_state` Phase 43); el coste vivía en la captura, que el spike ya resolvió.
**Depends on**: Phase 49 = **VIABLE** (gate duro — esta fase no existe si el verdict es INVIABLE)
**Requirements**: PROG-02, PROG-03
**Success Criteria** (what must be TRUE):

  1. Un hook de captura **separado** (no perturba los golden-bytes HOOK-02 de `session-start.js`) escribe el progreso a `~/.kodo/<artefacto>/<task_id>.json` correlacionado por `task_id`, fire-and-forget, never-throws, sin añadir latencia ni romper la sesión.
  2. El dashboard muestra el progreso por sesión (p. ej. `N/M`) leyendo ese artefacto vía filesystem (mold del overlay de plan ligero), **cero endpoints nuevos** — nunca un re-enrich de `/status`.
  3. Estados degradados honestos: sin todos → `—`; fallo transiente de captura → `?` + keep-last-good; cohortes legacy/`Task*`-tools toleradas (patrón de la columna no-color `provider_state`).

**Plans**: TBD
**UI hint**: yes

Plans:

- [ ] 50-01: TBD

### Phase 51: Backfill Nyquist v0.11

**Goal**: Saldar la deuda Nyquist heredada de v0.11 (Phases 44/45/46 con `VALIDATION.md` en `draft` / `nyquist_compliant: false`, registrada en STATE.md `## Deferred Items`) — citation-based, sin re-ejecutar la suite. Doc-only Tier 1, espejo de v0.11 Phase 47 / v0.8 Phase 33 Bloque B. Independiente de todo el resto del milestone: no bloquea ni es bloqueada.
**Depends on**: Nothing (independiente; puede ir primera o última, en paralelo con Phase 48)
**Requirements**: NYQ-03
**Success Criteria** (what must be TRUE):

  1. Phases 44, 45 y 46 tienen `VALIDATION.md` con `nyquist_compliant: true`, citando la evidencia existente (VERIFICATION.md + integration check + UAT) sin re-ejecutar la suite.
  2. Los stubs `draft` / `nyquist_compliant: false` quedan reemplazados y STATE.md `## Deferred Items` reconciliado.
  3. Invariante Tier 1 respetado: `git diff -- src/ test/ bin/` vacío (cambio puramente documental).

**Plans**: TBD

Plans:

- [ ] 51-01: TBD

## Progress

**Execution Order:**
Phases ejecutan en orden numérico: 48 → 49 → (50 solo si 49=VIABLE) → 51. Phase 51 (doc-only) puede correr en paralelo o último.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 48. Open-in-manager core | v0.12 | 3/3 | Complete   | 2026-06-12 |
| 49. Live-progress spike (HARD GATE) | v0.12 | 0/TBD | Not started | - |
| 50. Live-progress display (conditional) | v0.12 | 0/TBD | Not started (gated on 49=VIABLE) | - |
| 51. Backfill Nyquist v0.11 | v0.12 | 0/TBD | Not started | - |

## Backlog

_Vacío._ La única entrada histórica (Phase 999.1 — "Dismiss de sesiones dead desde el dashboard ink") fue **promovida a Phase 42 y shipped en v0.10** (2026-06-08). Traza de origen completa en `milestones/v0.10-ROADMAP.md`.
