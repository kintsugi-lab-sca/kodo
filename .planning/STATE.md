---
gsd_state_version: 1.0
milestone: v0.12
milestone_name: Atajos al gestor y progreso vivo
status: planning
stopped_at: Phase 48 context gathered
last_updated: "2026-06-11T15:45:27.699Z"
last_activity: 2026-06-11 — Roadmap v0.12 creado (4 phases, 8/8 requirements mapeados)
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

**Project:** kodo
**Active milestone:** **v0.12 Atajos al gestor y progreso vivo** (planning) — roadmap creado 2026-06-11, 4 phases (48-51), 8/8 requirements mapeados. Previo: **v0.11 Ventana al plan SHIPPED 2026-06-10** (audit `tech_debt`, 8/8 requirements; deuda Nyquist 44/45/46 diferida → se salda en Phase 51).

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-11 — Current Milestone: v0.12 "Atajos al gestor y progreso vivo").

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9 añadió observabilidad en terminal (`kodo dashboard`); v0.10 la promovió a gestión (dismiss); v0.11 abrió la ventana al plan. v0.12 profundiza desde la fila: *hacia afuera* (abrir la tarea en el gestor) y *hacia adentro* (progreso vivo, spike-gated).

**Current focus:** Phase 48 — Open-in-manager core (ready to plan)

## Current Position

Phase: 48 of 51 (Open-in-manager core)
Plan: — (roadmap recién creado, sin plans aún)
Status: Ready to plan
Last activity: 2026-06-11 — Roadmap v0.12 creado (4 phases, 8/8 requirements mapeados)

Progress: [░░░░░░░░░░] 0%

## Roadmap v0.12 (active)

Build order: **OPEN CORE → SPIKE → DISPLAY CONDICIONAL → NYQUIST**. Phase 48 es el core de bajo riesgo (open-in-manager, ~80-90% ya construido en código shipped, ships sí o sí); Phase 49 (spike) gobierna un gate duro sobre Phase 50; Phase 50 (display) es CONDICIONAL Y CUTTABLE; Phase 51 (nyquist backfill) es doc-only e independiente.

| Phase | Goal | Requirements | Riesgo |
|-------|------|--------------|--------|
| 48. Open-in-manager core | Tecla `o` abre la tarea en el navegador vía `execFile` never-throws + fix bug URL Plane (`web_url`) | OPEN-01, OPEN-02, OPEN-03, OPEN-04 | bajo (cierra por HUMAN-UAT, espejo Phase 37) |
| 49. Live-progress spike (HARD GATE) | Veredicto empírico VIABLE/INVIABLE sobre capturar task-state vivo en el Claude Code instalado | PROG-01 | n/a (spike — gate; ES el research) |
| 50. Live-progress display *(condicional — cuttable a v2)* | Si el spike sale VIABLE: captura + persiste + muestra `N/M` por sesión | PROG-02, PROG-03 | medio/alto (sujeto a spike) |
| 51. Backfill Nyquist v0.11 | `VALIDATION.md` citation-based para Phases 44/45/46 | NYQ-03 | bajo (doc-only Tier 1) |

- **⛔ GATE DURO Phase 49 → 50:** Phase 50 SOLO se planifica/ejecuta si Phase 49 concluye **VIABLE**. **INVIABLE es el default esperado** (research: `Task*` tools bypassean PostToolUse, issue anthropics/claude-code #20243). Si INVIABLE, PROG-02/03 se difieren a v2 (PROG-F1 lo anticipa) y el milestone cierra con OPEN-* + NYQ-03 **sin penalización**. El roadmap NO depende de que la mitad condicional aterrice.
- **Phase 48 cierra por HUMAN-UAT:** el side effect de abrir el navegador no es auto-verificable (espejo de Phase 37 `Enter → cmux`). Budget para un HUMAN-UAT obligatorio.
- **Phase 49 ES el research:** empírica, version-specific, no pre-investigable desde docs. Espejo de v0.11 Phase 45. Su deliverable es el veredicto escrito con evidencia, no código de producción. Evalúa en orden: (1) hooks `TaskCreated`/`TaskCompleted`, (2) transcript JSONL watcher, (3) `~/.claude/tasks/` (último recurso).

## Most recent shipped milestone

**v0.11 Ventana al plan** — shipped 2026-06-10 (4 phases 44-47 / 5 plans / 71 commits / suite 1263 pass + 1 skip). Audit `tech_debt` (8/8 requirements, integración cross-phase 8/8 + 2/2 flujos E2E; deuda Nyquist 44/45/46 `draft` diferida → se salda en Phase 51 de v0.12).

- Roadmap archive: `milestones/v0.11-ROADMAP.md`
- Requirements archive: `milestones/v0.11-REQUIREMENTS.md`
- Audit: `milestones/v0.11-MILESTONE-AUDIT.md`
- Phase artifacts: `.planning/milestones/v0.11-phases/` (44-47)

## Deferred Items

Items reconocidos y diferidos (ninguno bloqueante). La deuda Nyquist de v0.11 (Phases 44/45/46) se salda en **Phase 51** (NYQ-03, citation-based). Frontmatter cosmético sin impacto funcional.

| Categoría | Item | Estado | Diferido en |
|-----------|------|--------|-------------|
| nyquist | Phase 44 (v0.11) `44-VALIDATION.md` status=draft, nyquist_compliant=false (stub plan-time) | PARTIAL → Phase 51 (NYQ-03) | v0.11 close |
| nyquist | Phase 45 (v0.11) `45-VALIDATION.md` status=draft, nyquist_compliant=false (stub plan-time) | PARTIAL → Phase 51 (NYQ-03) | v0.11 close |
| nyquist | Phase 46 (v0.11) `46-VALIDATION.md` status=draft, nyquist_compliant=false (stub plan-time) | PARTIAL → Phase 51 (NYQ-03) | v0.11 close |
| frontmatter | `requirements_completed: []` vacío en summaries de 46-01 y 47-01 (v0.11) — cobertura verificada por VERIFICATION + integration + traceability | cosmético | v0.11 close |
| verification | Phase 37/38 (v0.9) sin VERIFICATION.md formal — cerradas vía UAT/HUMAN-UAT passed | covered-by-UAT | v0.9 close |
| code | Ciclo de import ESM App.js ↔ SessionTable.js (constantes OVERLAY_*) — resuelto en runtime, suite verde, frágil | WARNING-01 | v0.9 close |

## Accumulated Context

### Decisions (Roadmap v0.12)

- **Numeración continua (NO reset):** v0.12 continúa desde Phase 47 (v0.11) → primera fase es **Phase 48**. Espejo de cómo cada milestone continúa desde el anterior.
- **OPEN-01..04 plegados en UNA fase (48):** tightly coupled y pequeños (un keypress `o` + `open.js` clonado de `focus.js` + fix bug URL Plane + no-op legacy). El round-trip de la URL ya está construido en código shipped (`TaskItem.url`, `manager.js:48` persiste `task_url`, `GET /status` lo expone). El trabajo real es consumo, no plumbing. Granularidad coarse → fewer cohesive phases.
- **Diseño URL = campo estático de `TaskItem`, NO método opcional `getTaskUrl`:** el patrón `getTaskState` (método opcional typeof-detected) se justifica para estado *vivo*; una URL es inmutable, conocida en normalize-time. El mirror correcto es `worktree_path` (persist-derived-at-launch) — que es exactamente lo que el código YA hace. Contrato `TaskProvider` sigue FROZEN en 9, intacto.
- **PROG-01 (spike) separado de PROG-02/03 (display) en fases distintas (49 vs 50):** el spike gobierna un gate duro. Phase 50 es CONDICIONAL Y CUTTABLE — si el spike sale INVIABLE (default esperado), PROG-02/03 van a v2 (PROG-F1) sin reescribir el roadmap ni penalizar el cierre.
- **PROG-02 + PROG-03 plegados en UNA fase (50):** captura (hook) + display (columna/overlay) son un solo concern condicional; el display es barato (espejo `provider_state` Phase 43), el coste vive en la captura que el spike resuelve. Si VIABLE, una sola fase los entrega.
- **NYQ-03 (Phase 51) doc-only Tier 1, independiente:** `git diff -- src/ test/ bin/` debe quedar vacío; ni bloquea ni es bloqueada. Puede correr en paralelo con Phase 48 o última.
- **Cero endpoints nuevos preservado:** open-in-manager lee `task_url` de la fila ya polleada (como `focus.js` lee `workspace_ref`); el display de progreso (si VIABLE) lee el artefacto `~/.kodo/` vía filesystem (mold del plan ligero), nunca un re-enrich de `/status`.

### Roadmap Evolution

- **v0.12 roadmap creado (2026-06-11):** 4 phases (48-51), numeración continua desde v0.11 (NO reset). Build order OPEN CORE → SPIKE → DISPLAY CONDICIONAL → NYQUIST. 8/8 requirements mapeados. Phase 50 marcada cuttable (gate de Phase 49 = VIABLE).
- **v0.11 roadmap creado (2026-06-09):** 4 phases (44-47). Build order OVERLAY+POLISH → SPIKE → CAPTURA CONDICIONAL → NYQUIST.

### Open Blockers

None.

### Open Questions

Decisiones discuss-phase (no bloquean el roadmap; se resuelven al planificar cada fase):

- **Phase 48:** confirmar la auditoría source-first del round-trip `url`/`task_url` (Pitfall 0 — no reconstruir lo que ya existe); fallback derive-on-read para filas legacy sin `task_url` (helper puro compartido con el normalizer, byte-idéntico); manejo de `win32` (refuse-with-guidance, no `start` shell-out) vs solo macOS.
- **Phase 49 (spike):** orden empírico de las 3 superficies; criterio de timebox; pin del payload schema de `TaskCreated`/`TaskCompleted` en la versión instalada.
- **Phase 50 (solo si 49=VIABLE):** ruta/formato exactos del artefacto `~/.kodo/<...>/<task_id>.json`; columna vs 5º `mode:'overlay'`; instrucción a inyectar en `session-start.js` (si la superficie lo requiere, preservando golden-bytes HOOK-02).

### Critical Invariants to Preserve (cross-milestone, must survive next milestone)

- **TaskProvider contract: 9 obligatorios + getTaskState/listComments opcionales** (canonical en `src/interface.js`): `TASK_PROVIDER_METHODS` FROZEN en 9. **v0.12 NO toca adapters: la URL va como campo de `TaskItem` (no método nuevo).**
- **TaskItem shape canónico de 13 fields** (incl. `url`, v0.8 Phase 28).
- **Cero endpoints nuevos desde v0.10:** **v0.12 lo preserva — open-in-manager lee la fila ya polleada (como `focus.js`); el display de progreso lee el filesystem (`~/.kodo/`, mold del plan ligero), nunca enriquece `/status`.**
- **Color isolation**: `picocolors` solo desde `src/cli/format.js`. **v0.12: `open.js` y el reader de progreso usan `<Text color>` de ink, cero picocolors — cubierto por el walker `format-isolation.test.js`.**
- **TUI never-throws** (v0.9 Phase 35): capa de datos never-throws; ningún throw llega a React. **v0.12: `open.js` es un clon never-throws de `focus.js` (DI `exec` sin default, discriminante `{ok}`); el handler `o` nunca hace `await` desnudo, el panel permanece montado (cero unmount, cero alt-screen toggle).**
- **Selección por identidad `task_id`** (v0.9 Phase 36): **v0.12: `o` lee la fila revalidada por `task_id`; el progreso (si VIABLE) se correlaciona por `task_id`; filtros con `String.includes` anti-ReDoS.**
- **`execFile` fire-and-forget sin shell** (v0.9 Phase 37): **v0.12: `open.js` usa `execFile('open', [url])`, nunca shell; allowlist `http(s)` antes de `execFile` (rechaza `file://`/`javascript:`/flags `-`).**
- **HOOK-02 golden-bytes** (v0.11 Phase 45): **v0.12 Phase 50 (si VIABLE): el hook de captura es SEPARADO, no perturba los bytes de `session-start.js`.**
- **TUI read-only salvo dismiss-de-dead** (v0.10): **v0.12 PRESERVA read-only — open-in-manager y el display de progreso no escriben; la única superficie read-write sigue siendo el dismiss de v0.10.**
- **Worktree always-on Phase 18** · **LOG-12 guard** (`kodo check` no carga `src/logger.js`) · **`--json` byte-determinismo** (DX-06) · **Fuente única de `alive`** (`reconcileTick`, v0.9 Phase 38). v0.12 no toca estos carriles.

## Session Continuity

- **Last session:** 2026-06-11T15:45:27.690Z
- **Stopped at:** Phase 48 context gathered
- **Next action:** `/gsd:plan-phase 48` (Open-in-manager core). Phase 51 (Nyquist backfill, doc-only) puede correr en paralelo. Phase 50 queda gated tras el veredicto de Phase 49.
- **Files of record:**
  - `.planning/PROJECT.md` (Current Milestone: v0.12)
  - `.planning/ROADMAP.md` (v0.12 activo Phases 48-51; v0.10/v0.11 colapsados en archived)
  - `.planning/REQUIREMENTS.md` (v0.12, traceability 8/8 → Phases 48-51)
  - `.planning/research/` (SUMMARY, ARCHITECTURE, PITFALLS — research v0.12 completo)
  - `.planning/MILESTONES.md` (entrada v0.11 completa)

## Operator Next Steps

- Plan the first phase with `/gsd:plan-phase 48`.
