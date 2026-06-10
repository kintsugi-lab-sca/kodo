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
- 🚧 **v0.11 Ventana al plan** — Phases 44-47 (planning 2026-06-09)

_Milestone activo: v0.11. Build order: overlay+polish → inyección plan ligero → overlay plan ligero → nyquist._

## Phases

### v0.11 Ventana al plan (active)

- [ ] **Phase 44: Overlay de plan GSD + pulido de dashboard** - Tecla nueva muestra el `PLAN.md` de la fase GSD; se oculta la columna `phase/mode` sin GSD y se marca el zombie por-fila
- [ ] **Phase 45: Inyección de plan ligero universal** - kodo inyecta (vía `session-start.js`) en sesiones quick y non-GSD la instrucción de escribir un plan corto a una ruta kodo-controlada, correlacionada por `task_id`
- [ ] **Phase 46: Overlay del plan ligero para sesiones quick/non-GSD** - El overlay de plan de Phase 44 lee ese artefacto y lo muestra para sesiones quick/non-GSD con la misma UX
- [ ] **Phase 47: Backfill de deuda Nyquist** - `VALIDATION.md` citation-based para 41/43 (v0.10) y 36/37/38/39/39.1 (v0.9)

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

### Phase 44: Overlay de plan GSD + pulido de dashboard
**Goal**: El operador puede ver el plan GSD de la tarea seleccionada sin salir de la TUI, y el dashboard se pule según el dogfooding de v0.10 (columna `phase/mode` oculta sin GSD, zombie marcado por-fila).
**Depends on**: Nothing (primera fase del milestone; construye sobre el patrón de overlays de v0.9 Phase 39 y la capa derive de Phase 36, ya shipped).
**Requirements**: PLAN-01, PLAN-02, TUI-18, TUI-19
**Success Criteria** (what must be TRUE):
  1. Con una sesión GSD seleccionada, el operador pulsa una tecla dedicada (junto a `c`/`l`) y ve el contenido del/los `PLAN.md` de la fase resuelta, leído de `.planning/phases/<fase>/<N>-NN-PLAN.md` bajo `worktree_path ?? project_path` vía `resolvePhase`.
  2. El overlay distingue por copy los casos sin contenido (tarea no-GSD / sin fase resuelta, fase sin `PLAN.md`, varios `PLAN.md`); ningún error de fichero crashea el panel (lectura never-throws / best-effort) y `Esc` cierra preservando el cursor por `task_id`.
  3. Cuando ninguna sesión activa es GSD, la columna `phase/mode` no se renderiza y su ancho se recupera; reaparece automáticamente al entrar una sesión GSD (derivación pura React-free en `select.js`/`format.js`).
  4. El estado zombie se marca por-fila en la columna `state` (no solo en el contador del header), con color/marca proveniente únicamente de `<Text>` de ink.
**Plans**: 2 plans
- [x] 44-01-PLAN.md — Plan-reading helper (`plan.js`, pure sync never-throws) + `p` overlay wiring (PLAN-01, PLAN-02)
- [x] 44-02-PLAN.md — Dashboard polish: `phase/mode` column hide (TUI-18) + per-row zombie mark (TUI-19)
**UI hint**: yes
**Notes**: Cero endpoints nuevos — el overlay lee el filesystem directamente (como `focus.js` con cmux). Read-only (la única superficie read-write de la TUI sigue siendo el dismiss de v0.10). Color isolation: cero picocolors en `src/cli/dashboard/`. Filtros/búsqueda con `String.includes` anti-ReDoS. Watch: TUI-18/TUI-19 y el overlay tocan `src/cli/dashboard/select.js`/`format.js`/`App.js` — coordinar ediciones compartidas al planificar. Split sequential (44-02 depends_on 44-01): ambos editan `App.js`/`SessionTable.js` y el ciclo ESM App↔SessionTable (WARNING-01) hace inseguro el paralelo.

### Phase 45: Inyección de plan ligero universal
**Goal**: Toda sesión kodo que hoy no produce un `PLAN.md` (quick y non-GSD) emite un artefacto de plan ligero a una ruta kodo-controlada, mediante una instrucción inyectada en `session-start.js`, correlacionada por `task_id` — sin depender de hooks no documentados de Claude Code.
**Depends on**: Nothing de código (extiende `session-start.js`, ya existente; reusa la correlación `findSession`). Conceptualmente habilita Phase 46 (el overlay que lo muestra).
**Requirements**: PLAN-03
**Success Criteria** (what must be TRUE):
  1. En sesiones quick (`/gsd-quick`) y non-GSD, el contexto inyectado por `session-start.js` incluye la instrucción de escribir un plan corto (qué se va a hacer / pasos previstos) a una ruta kodo-controlada y estable, correlacionable con la sesión (`task_id` / `session_id` / `cwd`).
  2. La ruta de persistencia es propia de kodo (NO rutas internas de Claude Code), legible desde el filesystem por el overlay (cero endpoints nuevos en `src/server.js`).
  3. El bloque inyectado preserva los golden-bytes de los bloques existentes (HOOK-02 satisfied-by-construction) — la instrucción nueva se añade sin romper los bloques actuales de `buildSessionContext`/`buildGsdContext`.
**Plans**: 1 plan
- [x] 45-01-PLAN.md — Inyectar instrucción de plan ligero ES (`buildSessionContext`, non-GSD) + EN (rama quick de `buildGsdContext`) con ruta resuelta `~/.kodo/plans/<task_id>.md`; phase/bootstrap byte-idénticas (HOOK-02)
**Notes**: Reemplaza el antiguo spike de captura vía hook (decisión 2026-06-09: enfoque "plan ligero universal" — kodo produce el artefacto **activamente** en vez de olfatear el plan nativo de Claude Code, que el research marcó frágil/version-specific). La ruta y el formato exactos del artefacto se fijan en discuss-phase. Mantiene quick ligero (no fuerza plan/execute/verify). Docs del spike anterior preservados en git (commits `350c43d`/`3750171`) si se necesita el research de hooks.

### Phase 46: Overlay del plan ligero para sesiones quick/non-GSD
**Goal**: El overlay de plan de Phase 44 lee el artefacto de plan ligero (Phase 45) y lo muestra para sesiones quick/non-GSD con la misma UX (snapshot congelado, `Esc` preserva cursor por `task_id`, never-throws) que para sesiones GSD.
**Depends on**: Phase 45 (produce el artefacto), Phase 44 (reusa el overlay `mode:'overlay'`, ya shipped — diseñado para esto, ver 44-CONTEXT.md `<deferred>`).
**Requirements**: PLAN-04
**Success Criteria** (what must be TRUE):
  1. Con una sesión quick/non-GSD seleccionada, el operador pulsa la misma tecla del overlay de plan y ve el plan ligero del artefacto de Phase 45, leído del filesystem como fallback cuando la fila no tiene `phase_id` / `PLAN.md` GSD.
  2. La UX es idéntica a la del overlay GSD: snapshot congelado, copy honesta para los estados sin contenido, `Esc` preserva el cursor por `task_id`, lectura never-throws.
  3. Cero endpoints nuevos en `src/server.js`; el overlay sigue read-only.
**Plans**: 1 plan
- [x] 46-01-PLAN.md — Fallback readLightPlan en `plan.js` (leaf/never-throws/anti-ReDoS) + copy `OVERLAY_PLAN_NO_LIGHT` (App.js/SessionTable.js) + tests DI puros y fix de la regresión de integración (PLAN-04)
**UI hint**: yes
**Notes**: Ya NO es condicional/cuttable (el spike desaparece — ambas fases son entregables reales). El overlay de Phase 44 añade un fallback: si la fila no es GSD (sin `phase_id`), lee el artefacto de plan ligero de Phase 45 en vez del `PLAN.md` de fase. Mismo `mode:'overlay'`, mismo snapshot, misma copy honesta. Edición quirúrgica de 3 ficheros fuente + 2 de test (cero greenfield); 1 plan / 1 wave. Regresión CONFIRMADA: `planStatus({})` hardcodea `task_id:'a'` (overlay test :448) — Task 3 la cierra (Option A: fila sin task_id preserva no-phase puro).

### Phase 47: Backfill de deuda Nyquist
**Goal**: Saldar la deuda Nyquist acumulada con `VALIDATION.md` citation-based, sin re-ejecutar la suite (espejo de v0.8 Phase 33 Bloque B).
**Depends on**: Nothing (pura documentación, independiente de las demás fases; se sitúa al final por convención de bookkeeping).
**Requirements**: NYQ-01, NYQ-02
**Success Criteria** (what must be TRUE):
  1. Phases 41 y 43 (v0.10) tienen `VALIDATION.md` citation-based con `nyquist_compliant: true`, citando la evidencia existente (VERIFICATION.md + tests + UAT) — sin re-ejecutar la suite.
  2. Phases 36, 37, 38, 39 y 39.1 (v0.9) tienen `VALIDATION.md` citation-based con `nyquist_compliant: true` (backfill de las 2 parciales 36/37 + 3 ausentes 38/39/39.1 registradas en STATE.md `## Deferred Items`).
  3. STATE.md `## Deferred Items` refleja la deuda Nyquist como saldada (rows actualizadas de PARTIAL/MISSING a compliant).
**Plans**: TBD
**Notes**: Tier 1 doc-only — `git diff -- src/ test/ bin/` debe quedar vacío. Las fases archivadas viven en `.planning/milestones/v0.10-phases/` (41/43) y `.planning/milestones/v0.9-phases/` (36/37/38/39/39.1). Backfill vía `/gsd:validate-phase <N>`.

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 44. Overlay de plan GSD + pulido | 2/2 | Complete    | 2026-06-09 |
| 45. Inyección de plan ligero universal | 1/1 | Complete    | 2026-06-10 |
| 46. Overlay del plan ligero quick/non-GSD | 1/1 | Complete    | 2026-06-10 |
| 47. Backfill Nyquist | 0/? | Not started | - |

## Backlog

_Vacío._ La única entrada histórica (Phase 999.1 — "Dismiss de sesiones dead desde el dashboard ink") fue **promovida a Phase 42 y shipped en v0.10** (2026-06-08). Traza de origen completa en `milestones/v0.10-ROADMAP.md`.
