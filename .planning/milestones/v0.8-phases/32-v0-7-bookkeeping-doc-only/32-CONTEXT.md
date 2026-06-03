# Phase 32: v0.7 Bookkeeping (Doc-Only) - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

**Reconciliación documental** de los 3 items de drift identificados en `.planning/v0.7-MILESTONE-AUDIT.md`. **Cero código tocado** — solo metadatos y documentos que ya quedaron funcionalmente verificados en el milestone audit v0.7.

**In scope (audit-fijo):**
- **BOOK-01** — Reconciliar `.planning/milestones/v0.7-REQUIREMENTS.md` traceability table: 8 IDs `pending` → `Complete` (GH-01..05, CFG-01, CFG-02, TEST-01). Wire-up funcional ya verificado en el integration check del audit.
- **BOOK-02** — Backfill `.planning/milestones/v0.7-phases/23-githubclient-auth-foundation/VERIFICATION.md` (única phase v0.7 sin él). Retro-verificación estructural completa contra requirements de Phase 23 usando los 2 SUMMARYs existentes.
- **BOOK-03** — Toggle `nyquist_compliant: true` en frontmatter de VALIDATION.md de phases 23, 25, 26, 27 (única phase v0.7 con el flag toggled = Phase 24).

**Out of scope:**
- Cualquier cambio de código (`src/**`, `test/**`, `bin/**`).
- Re-ejecución de tests (suite verde ya validada en audit).
- Otros drift items no listados en el audit doc.
- Cambios a `.planning/REQUIREMENTS.md` actual más allá del auto-update de status BOOK-01/02/03 al cierre de plans (mecánica estándar del workflow).
- Audit retro de phases anteriores al v0.7.

</domain>

<decisions>
## Implementation Decisions

### VERIFICATION.md backfill content (BOOK-02)
- **D-03:** **Retro-verificación estructural completa**. El `VERIFICATION.md` de Phase 23 debe auditar los 2 SUMMARYs existentes (`23-01-SUMMARY.md`, `23-02-SUMMARY.md`) contra los requirements declarados de Phase 23 (`GH-01..05`, `CFG-01`, `CFG-02`, `TEST-01`) y producir verdicts must-have por requirement. Patrón consistente con phases 24-27 que ya tienen `VERIFICATION.md`.
- **D-04:** **No re-ejecución de tests.** El audit del milestone v0.7 ya validó empíricamente que la suite v0.7 está verde. El backfill cita el audit como evidencia, no re-corre tests.

### Scope discipline
- **D-06:** **Scope fijo a BOOK-01/02/03 exactos del audit.** Cualquier otro drift descubierto durante ejecución va a `<deferred>` para futuras phases — NO se mete en Phase 32 sin re-roadmap. Especialmente: NO auditar phases anteriores al v0.7, NO tocar phases v0.6 o anteriores, NO refactorizar plantillas.

### Claude's Discretion

Las siguientes decisiones son **meta-process / structural** sobre el workflow de planning mismo (no implementables como contratos por-plan). Se documentan aquí por trazabilidad histórica de la discussion, pero no requieren citation explícita en `must_haves` de los plans — su cumplimiento se observa en la existencia de los plans, su YAML frontmatter, los commits del executor, y la política Tier 1 de CLAUDE.md.

- **3 planes, 1 por BOOK-item** (`32-01` BOOK-01, `32-02` BOOK-02, `32-03` BOOK-03) — patrón "1 plan = 1 REQ-ID" heredado de Phase 31. *Encoded by the existence of the 3 PLAN.md files.*
- **Wave 1 = los 3 planes en paralelo**, cero overlap entre BOOK-01/02/03 (toca archivos disjuntos). *Encoded by `wave: 1` + `depends_on: []` in each plan's frontmatter.*
- **1 commit por BOOK-item** (3 commits funcionales + 1 commit por SUMMARY.md ≈ 6 commits). Convención: `docs(32-XX): close BOOK-NN — <one-liner>`. *Process/convention — enforced at commit time by executor, alineada con commit standard ya en uso (Phase 31).*
- **Tier 1** según política CLAUDE.md global (docs, config, fixes de lint) — fast-forward a main local sin PR. *Process/git-policy — enforced at merge time, citada en `<output>` de cada plan.*
- Formato exacto del verdict block dentro de `VERIFICATION.md` Phase 23 (encabezado, bullets, tabla por REQ-ID) — el planner escoge un template consistente con phases 24-27.
- Plan task granularity dentro de cada BOOK-plan — el planner decide si BOOK-01 son 2 tasks (toggle + verify) o 1 task (toggle bulk).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit doc (source of truth)
- `.planning/v0.7-MILESTONE-AUDIT.md` — Documento que identificó los 3 items BOOK como drift no-bloqueante. Contiene la lista exacta de los 8 IDs pending y la justificación de que los flags `nyquist_compliant` quedaron en `false`. Sección `Recommendations` enumera BOOK-01/02/03 como bookkeeping doc-only.

### Targets de modificación BOOK-01
- `.planning/milestones/v0.7-REQUIREMENTS.md` — Traceability table con 16 IDs; reconciliar 8 IDs marcados `pending` → `Complete` (GH-01..05, CFG-01, CFG-02, TEST-01).

### Targets de modificación BOOK-02
- `.planning/milestones/v0.7-phases/23-githubclient-auth-foundation/23-01-SUMMARY.md` — Fuente de evidencia para retro-verify (covers GH-01..03).
- `.planning/milestones/v0.7-phases/23-githubclient-auth-foundation/23-02-SUMMARY.md` — Fuente de evidencia (covers GH-04..05, CFG-01, CFG-02, TEST-01).
- `.planning/milestones/v0.7-phases/23-githubclient-auth-foundation/23-CONTEXT.md` — Decisiones de implementación originales para contexto del verdict.
- `.planning/milestones/v0.7-phases/23-githubclient-auth-foundation/23-VALIDATION.md` — Nyquist coverage existente.

### Targets de modificación BOOK-03
- `.planning/milestones/v0.7-phases/23-githubclient-auth-foundation/23-VALIDATION.md` — Toggle frontmatter `nyquist_compliant: false → true`.
- `.planning/milestones/v0.7-phases/25-polling-trigger-channel/25-VALIDATION.md` — Idem.
- `.planning/milestones/v0.7-phases/26-config-wizard-cli-integration/26-VALIDATION.md` — Idem.
- `.planning/milestones/v0.7-phases/27-cross-provider-contract-matrix/27-VALIDATION.md` — Idem.
- `.planning/milestones/v0.7-phases/24-githubprovider-normalizer-registry/24-VALIDATION.md` — **Referencia/template** (única con `nyquist_compliant: true` ya); usar como modelo del toggle.

### Pattern de phases doc-only relacionadas
- Phase 31 (`.planning/phases/31-phase-21-22-advisory-cleanup/`) — Reciente precedente de phase con N planes paralelos y 1 commit por plan-item. **NO doc-only** (sí tocó código), pero el patrón de granularidad sirve.

### Project-level (siempre aplicable)
- `.planning/PROJECT.md` — Project context (core value v0.7 shipped, v0.8 active).
- `.planning/REQUIREMENTS.md` — Current milestone REQUIREMENTS (BOOK-01/02/03 entries quedan auto-marcadas `Complete` al cerrar plans, mecánica estándar).
- `.planning/STATE.md` — STATE actual (Phase 31 cerrada).
- `./CLAUDE.md` — Project instructions globales (Tier 1 política, etc.).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **VALIDATION.md frontmatter template** — `.planning/milestones/v0.7-phases/24-githubprovider-normalizer-registry/24-VALIDATION.md` muestra el formato canónico con `nyquist_compliant: true`. Los otros 4 VALIDATION.md v0.7 ya tienen toda la estructura; solo el flag está en `false`.
- **VERIFICATION.md template** — Phases 24/25/26/27 v0.7 tienen `VERIFICATION.md` ya escritos; el planner puede inspeccionar el formato más cercano (Phase 24, misma fecha) para el backfill de Phase 23.
- **Traceability table format** — `v0.7-REQUIREMENTS.md` ya tiene la tabla; BOOK-01 es solo cambiar `pending` → `Complete` en 8 celdas, no rediseñar la tabla.

### Established Patterns
- **Frontmatter YAML** — Todas las VALIDATION.md usan YAML frontmatter; el toggle es 1 línea por archivo. Robusto a editores línea-base.
- **SUMMARY → VERIFICATION audit pattern** — Las phases v0.7 con VERIFICATION.md presentan: (a) tabla por REQ-ID con verdict + evidencia, (b) sección `Self-Check: PASSED/FAILED`, (c) lista de must-haves verificados. Backfill de Phase 23 sigue este formato.
- **Doc-only commits** — Convención `docs(<phase>-<plan>):` ya en uso (e.g., `058f540 docs(31): record planning completion`). Compatible con Tier 1.

### Integration Points
- **`gsd-sdk roadmap.update-plan-progress`** — Se invoca por el orchestrator al cierre de cada plan; auto-actualiza STATE.md y `.planning/REQUIREMENTS.md` (status BOOK-01/02/03 → Complete). El planner no necesita lógica especial.
- **Sin impacto en test suite** — Cero archivos `src/**` o `test/**` se tocan. No hay riesgo de regresión; post-merge gate es opcional (no se ejecuta tests nuevos, suite ya verde).

</code_context>

<specifics>
## Specific Ideas

- Re-usar el formato exacto del `VERIFICATION.md` de Phase 24 v0.7 como template para el backfill de Phase 23, ajustando los REQ-IDs y la tabla de evidencia a los SUMMARYs específicos de Phase 23.
- Los 8 IDs que necesitan reconciliación (BOOK-01) son: **GH-01, GH-02, GH-03, GH-04, GH-05, CFG-01, CFG-02, TEST-01**. Verificación 1:1 contra el wire-up confirmado en el audit doc.
- BOOK-03 es literalmente 4 ediciones de 1 línea cada una (`nyquist_compliant: false` → `nyquist_compliant: true`). Podría ser 1 task que toca 4 archivos, no 4 tasks separadas.

</specifics>

<deferred>
## Deferred Ideas

Ninguna — discussion stayed within phase scope (audit-fijo). Scope-creep guard explícito en D-06.

Si durante ejecución surgen items adicionales del audit doc no incluidos en BOOK-01/02/03, se capturan en SUMMARY.md `Deferred` section para potencial nueva phase, **NO se meten en Phase 32**.

</deferred>

---

*Phase: 32-v0.7-bookkeeping-doc-only*
*Context gathered: 2026-05-21*
