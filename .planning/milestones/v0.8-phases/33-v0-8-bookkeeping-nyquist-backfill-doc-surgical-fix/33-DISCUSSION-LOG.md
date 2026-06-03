# Phase 33: v0.8 Bookkeeping & Nyquist Backfill (Doc + Surgical Fix) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-23
**Phase:** 33-v0-8-bookkeeping-nyquist-backfill-doc-surgical-fix
**Areas discussed:** Surgical fix scope, Nyquist backfill profundidad, Granularidad de plans, Items en scope vs deferred

**Continuity note:** Discussion fue conducida en sesión previa (pre-`/gsd-update` 1.41.2 → 1.42.3). El reinicio post-update preservó las 4 decisiones (D-01..D-04) en contexto del orquestador; la materialización CONTEXT.md + DISCUSSION-LOG se ejecutó tras confirmar con el usuario "Materializar CONTEXT.md ya con las 4 decisiones (recomendado)" en lugar de re-discutir desde cero. Las opciones de cada AskUserQuestion se preservan abajo tal y como se presentaron.

---

## Surgical fix scope (LIFE-02-FOLLOWUP)

**Contexto presentado al usuario:** El audit identificó WARNING LIFE-02 — `src/gsd/verify.js:267` y `src/hooks/stop.js:197` descartan el return discriminado `{ok: false, reason: 'missing-task-id'}` de `markSessionStatus`. La rama `missing-task-id` solo es observable vía `logger.warn` interno. Robustness gap, no breaks runtime hoy porque `task_id` siempre presente. El slug del phase incluye "Surgical Fix" → entrada asumida; pero queda decidir cómo consumen el return.

| Option | Description | Selected |
|--------|-------------|----------|
| Entra — log warn + continue (simétrico) | Ambos callers registran log.warn con {reason} cuando ok=false y proceden. Cero cambio E2E observable; NDJSON registra drift si emerge. Mínima intrusión. Tier 1 razonable. | ✓ |
| Entra — asimétrico (stop=log, verify=throw) | stop.js:197 log+continue (fail-open contract); verify.js:267 throw (gate estricto). Coherente con roles, pero introduce nueva ruta de throw. Tier 2. | |
| Entra — throw en ambos | Fail-loud simétrico. Cambia contract del stop hook (deja de ser fail-open en este sub-caso). Tier 2. | |
| NO entra — diferir a v0.9 y renombrar la phase | Phase 33 queda 100% doc-only. Audit warning queda abierto. Requiere update ROADMAP.md. | |

**User's choice:** Entra — log warn + continue (simétrico) → **D-01** en CONTEXT.md.

**Notes:** Tier 1 extendido (toca `src/` pero es robustness gap puro). Event name normalizado a `markSessionStatus.skipped` siguiendo patrón `<componente>.<situación>` ya en uso (`worktree.cleanup.dirty`, `markSessionStatus.failed`). Optional chaining defensivo (`result?.ok`) por si mocked callers retornan undefined en tests.

---

## Nyquist backfill profundidad

**Contexto presentado al usuario:** El audit reporta nyquist 1/5 — solo Phase 29 tiene VALIDATION.md. Faltan 28/30/31/32. Phase 32 sub-pregunta embebida: ¿VALIDATION.md tiene sentido para una phase doc-only Tier 1 sin código a validar, o queda como ceremonia vacía? Precedente directo: Phase 32 BOOK-02 backfill VERIFICATION Phase 23 fue placeholder estructural citando audit + SUMMARYs sin re-ejecutar tests.

| Option | Description | Selected |
|--------|-------------|----------|
| Placeholder + skip Phase 32 (3 archivos: 28/30/31) | Análogo a BOOK-02 Phase 32. 1 archivo por phase + frontmatter `nyquist_compliant: true` + tabla dimensión→cobertura citando tests existentes + audit. Phase 32 = N/A documentado (Tier 1 doc-only). Sign-off final: 4/5 compliant + 1/5 N/A explícito. | ✓ |
| Placeholder universal (4 archivos: 28/30/31/32) | Misma técnica también para Phase 32 con justificación "doc-only Tier 1 — sin tests funcionales aplicables". Más consistente (5/5) pero el archivo de Phase 32 es ceremonia pura. | |
| Sampling real via /gsd-validate-phase (3-4 archivos) | Spawn gsd-nyquist-auditor por phase con sampling formal. Mucho más trabajo. Justificable si crees que el audit subestimó riesgo, pero el verdict YA es TECH_DEBT con 894 pass — difícilmente emergen gaps reales. | |
| Sampling real solo Phase 30 (placeholder para 28/31/32) | Phase 30 tocó lifecycle real (driver ROMAN-132); las otras menor blast radius. Compromiso rigor/costo. | |

**User's choice:** Placeholder + skip Phase 32 → **D-02** en CONTEXT.md.

**Notes:** Justificación NYQ-32-NA preferentemente en `v0.8-MILESTONE-AUDIT.md` §Nyquist Compliance (opción A, planner decide vs opción B en STATE.md).

---

## Granularidad de plans

**Contexto presentado al usuario:** Tras D-01 + D-02 los 3 bloques quedaron bien definidos (A=doc-drift, B=nyquist, C=surgical-fix). Cada bloque toca archivos disjuntos → cero overlap, Wave 1 paralelo viable independiente de la granularidad. Precedente Phase 32: 3 plans = 1 por BOOK-item, Wave 1 paralelo, ~6 commits. Funcionó limpio.

| Option | Description | Selected |
|--------|-------------|----------|
| 3 plans = 1 por bloque (A/B/C) — réplica de Phase 32 | Plan 33-01 = Bloque A (doc-drift bundle), 33-02 = Bloque B (nyquist), 33-03 = Bloque C (surgical fix). Wave 1 paralelo cero overlap. ~6 commits. Patrón probado. | ✓ |
| 4 plans — separar A en sub-items | 33-01 = BOOK-DRIFT-V8, 33-02 = SUMMARY-FRONTMATTER + ROADMAP-FIX, 33-03 = nyquist, 33-04 = surgical fix. Granularidad mayor; commits más atómicos por REQ-ID. | |
| 2 plans — doc-bundle + surgical-fix | 33-01 = TODO el doc (A+B juntos, ~15 archivos), 33-02 = surgical fix. Mínimo overhead pero plan 33-01 es grande; rollback toca A si algo falla en B. | |
| 5 plans — hyper-atómico (1 por REQ-ID-candidato) | Plan 33-01..05 = BOOK-DRIFT, SUMMARY-FRONTMATTER, NYQ-BACKFILL, ROADMAP-FIX, LIFE-02-FOLLOWUP. Máxima atomicidad, máximo overhead. Over-engineered para cleanup. | |

**User's choice:** 3 plans = 1 por bloque → **D-03** en CONTEXT.md.

**Notes:** Wave 1 paralelo. `depends_on: []` en cada plan frontmatter. Convención commit discriminada por tipo: `docs(33-01)`, `docs(33-02)`, `fix(33-03)`.

---

## Items en scope vs deferred (Bloque A)

**Contexto presentado al usuario:** Dentro del Bloque A hay 3 sub-items con esfuerzo dispar — BOOK-DRIFT-V8 (estructural), SUMMARY-FRONTMATTER (cosmético), ROADMAP-FIX (typo bug). Los cosméticos son baratísimos (~10 líneas totales); diferirlos a otra phase futura crearía overhead de re-roadmap por 10 líneas — overkill. D-06 de Phase 32 fue "scope fijo a items del audit" — todos estos están en el audit. Items NO-incluibles confirmados como out-of-scope: 6 anti-patterns INFO-level Phase 30 (Phase 30 ya los marcó out-of-scope deliberado); edge case `console.warn` nullish coalescing default Phase 31 (decisión consciente del audit).

| Option | Description | Selected |
|--------|-------------|----------|
| Full A: BOOK-DRIFT + SUMMARY-FRONTMATTER + ROADMAP-FIX | Incluye los 3 sub-items en Plan 33-01. ~10 líneas totales. Cero items del audit quedan abiertos. Réplica D-06 Phase 32. | ✓ |
| Solo estructural: BOOK-DRIFT-V8 | Plan 33-01 = solo 9 IDs REQUIREMENTS.md. SUMMARY-FRONTMATTER + ROADMAP-FIX → deferred v0.9. Menos atomicidad pero rollback más claro. | |
| Estructural + ROADMAP-FIX | Plan 33-01 = BOOK-DRIFT + ROADMAP-FIX (ambos tocan archivos en `.planning/` raíz). SUMMARY-FRONTMATTER → deferred. | |
| Full A + también INFO-level anti-patterns | Incluiría 6 anti-patterns Phase 30 + edge case console.warn Phase 31. NO recomendable — scope creep, contradice decisión consciente del audit. | |

**User's choice:** Full A → **D-04** en CONTEXT.md.

**Notes:** Heredó D-06 Phase 32 — scope fijo a items del audit, sin discriminar cosmético vs estructural si está listado.

---

## Claude's Discretion

Áreas donde el usuario delegó al planner (no requieren citación explícita en `must_haves` de los plans, su cumplimiento se observa en la existencia del producto):

- **Convención commits semantic prefix** discriminado por bloque: `docs(33-01)/docs(33-02)/fix(33-03)` (33-03 con `fix` porque toca `src/`).
- **Wave 1 paralelo** encoded en frontmatter de cada plan (`wave: 1`, `depends_on: []`).
- **Tier policy:** Bloque A + B = Tier 1; Bloque C = Tier 1 extendido (toca `src/` pero robustness gap puro). Escalar a Tier 2 si code-review previo al merge lo marca.
- **Template VALIDATION.md** seleccionado por el planner entre `24-VALIDATION.md` v0.7 y `29-VALIDATION.md` v0.8 (el que tenga estructura más cercana a phase shipped no doc-only).
- **NYQ-32-NA ubicación:** opción A (`v0.8-MILESTONE-AUDIT.md` §Nyquist Compliance update) preferida sobre opción B (`STATE.md` nueva sección), pero el planner decide.
- **Plan task granularity dentro de cada bloque** — heurística "1 task por sub-item" pero consolidable si tiene sentido (BOOK-DRIFT-V8 son 9 ediciones en 1 archivo → probablemente 1 task batch edit).
- **Suite delta target:** ≥896 pass post-phase. Plan 33-03 corre solo tests modificados/añadidos, no la suite global como gate funcional.
- **Documentación del cierre v0.8 milestone** (declarar SHIPPABLE) explícitamente FUERA de Phase 33 — pertenece a `/gsd-complete-milestone` post-Phase 33.

## Deferred Ideas

- LIFE-02 caller hardening profundo (reason policy parametrizada, telemetry counters, alerting) → v0.9 si la falla emerge en runtime real.
- 6 anti-patterns INFO-level Phase 30 REVIEW.md (WR-01..04 + IN-03/IN-04) → v0.9 backlog.
- Edge case `console.warn` nullish coalescing default Phase 31 → diferido indefinidamente (decisión consciente del audit).
- Sampling nyquist formal real (vs placeholder) → v0.9+ si se eleva el bar de coverage.
- Update final `v0.8-MILESTONE-AUDIT.md` declarando "all tech debt closed, status: SHIPPABLE" → trabajo de `/gsd-complete-milestone`.

**Scope-creep guard:** Drift items adicionales descubiertos en ejecución y NO listados en `v0.8-MILESTONE-AUDIT.md` → capturar en SUMMARY.md del plan correspondiente, NO meter en Phase 33 sin re-roadmap (heredado D-06 Phase 32).
