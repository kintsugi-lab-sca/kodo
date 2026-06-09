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

_Milestone activo: v0.11. Build order: overlay+polish → spike → captura condicional → nyquist._

## Phases

### v0.11 Ventana al plan (active)

- [ ] **Phase 44: Overlay de plan GSD + pulido de dashboard** - Tecla nueva muestra el `PLAN.md` de la fase GSD; se oculta la columna `phase/mode` sin GSD y se marca el zombie por-fila
- [ ] **Phase 45: Spike — captura de plan no-GSD vía hook** - Determinar empíricamente si las sesiones `--dangerously-skip-permissions` emiten un plan capturable vía hook soportado (gate de Phase 46)
- [ ] **Phase 46: Captura + persistencia de plan no-GSD** *(condicional a Phase 45 — cuttable a v2)* - Si el spike confirma viabilidad, kodo captura/persiste el plan no-GSD y el overlay lo muestra
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
**Plans**: TBD
**UI hint**: yes
**Notes**: Cero endpoints nuevos — el overlay lee el filesystem directamente (como `focus.js` con cmux). Read-only (la única superficie read-write de la TUI sigue siendo el dismiss de v0.10). Color isolation: cero picocolors en `src/cli/dashboard/`. Filtros/búsqueda con `String.includes` anti-ReDoS. Watch: TUI-18/TUI-19 y el overlay tocan `src/cli/dashboard/select.js`/`format.js`/`App.js` — coordinar ediciones compartidas al planificar.

### Phase 45: Spike — captura de plan no-GSD vía hook
**Goal**: Determinar empíricamente, con evidencia, si las sesiones kodo no-GSD/quick (lanzadas con `--dangerously-skip-permissions`) emiten un plan capturable vía un hook SOPORTADO de Claude Code (`PostToolUse` sobre `ExitPlanMode`, o equivalente), dado que kodo ya inyecta `SessionStart`/`Stop`.
**Depends on**: Phase 44 (orden de milestone; no comparte código — es trabajo de investigación/prueba sobre hooks, no sobre el dashboard).
**Requirements**: PLAN-03
**Success Criteria** (what must be TRUE):
  1. Existe un documento de spike que concluye, con evidencia reproducible, si `ExitPlanMode` (u otro evento de hook soportado) dispara en sesiones `--dangerously-skip-permissions` y produce un payload con el plan.
  2. La conclusión es un veredicto binario accionable: VIABLE (con el mecanismo de hook concreto documentado) o INVIABLE (con la evidencia que lo justifica).
  3. Si VIABLE, el documento especifica el contrato de captura propio que Phase 46 implementaría (qué evento, qué payload, dónde persistir, cómo se correlaciona con `task_id`); si INVIABLE, registra la decisión de diferir PLAN-04 a v2 sin bloquear el cierre del milestone.
**Plans**: TBD
**Notes**: Spike puro — no se compromete implementación de producción aquí. NO se parsea el transcript JSONL crudo ni `~/.claude/plans/`/`~/.claude/todos/` (formato no documentado, fuera de scope). El único camino soportado evaluable es el hook. Este veredicto gobierna si Phase 46 se ejecuta o se corta.

### Phase 46: Captura + persistencia de plan no-GSD *(condicional — cuttable a v2)*
**Goal**: Si Phase 45 confirmó viabilidad, kodo captura y persiste el plan de sesiones no-GSD/quick en su propio lado (contrato propio, no parsing de rutas internas frágiles), y el overlay de Phase 44 lo muestra también para esas sesiones.
**Depends on**: Phase 45 (gate duro — esta fase SOLO se ejecuta si el spike concluye VIABLE; si INVIABLE, se difiere a v2 sin penalizar el cierre del milestone), Phase 44 (reusa el overlay de plan).
**Requirements**: PLAN-04
**Success Criteria** (what must be TRUE):
  1. Durante una sesión no-GSD/quick, kodo captura el plan vía el hook soportado identificado en Phase 45 y lo persiste en una fuente propia y estable (no rutas internas de Claude Code), correlacionada por `task_id`.
  2. El overlay de plan de Phase 44 muestra el plan capturado para sesiones no-GSD/quick con la misma UX (snapshot congelado, `Esc` preserva cursor, never-throws) que para sesiones GSD.
  3. La persistencia no introduce endpoints nuevos en `src/server.js` (salvo decisión explícita en discuss-phase) y preserva los invariantes de captura definidos en el spike.
**Plans**: TBD
**UI hint**: yes
**Notes**: FASE CONDICIONAL Y CUTTABLE. Si Phase 45 declara INVIABLE, esta fase NO se planifica/ejecuta: PLAN-04 se mueve a v2 (PLAN-F1/PLAN-F2 ya lo anticipan) y el milestone cierra con Phases 44/45/47. El roadmapper la incluye para que el milestone pueda entregar la captura si el spike sale positivo, sin reescribir el roadmap.

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
| 44. Overlay de plan GSD + pulido | 0/? | Not started | - |
| 45. Spike — captura no-GSD vía hook | 0/? | Not started | - |
| 46. Captura + persistencia (condicional) | 0/? | Not started | - |
| 47. Backfill Nyquist | 0/? | Not started | - |

## Backlog

_Vacío._ La única entrada histórica (Phase 999.1 — "Dismiss de sesiones dead desde el dashboard ink") fue **promovida a Phase 42 y shipped en v0.10** (2026-06-08). Traza de origen completa en `milestones/v0.10-ROADMAP.md`.
