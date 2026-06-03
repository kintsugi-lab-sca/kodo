# Phase 32: v0.7 Bookkeeping (Doc-Only) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21
**Phase:** 32-v0.7-bookkeeping-doc-only
**Areas discussed:** Plan granularity, VERIFICATION.md backfill content, Commit strategy, Wave structure, Scope creep guard

---

## Plan granularity (3 ítems BOOK doc-only)

| Option | Description | Selected |
|--------|-------------|----------|
| 3 planes (uno por BOOK-01/02/03) | Mismo patrón que Phase 31. Permite paralelización si Wave 1 mete los 3 (sin overlap de archivos). Trazabilidad 1:1 con REQ-IDs. | ✓ |
| 1 plan único bundled | Doc-only sin tests ni lógica — 3 tasks atomicas en un plan. Más ligero, menos overhead orquestador. | |
| 2 planes (BOOK-01 + BOOK-03 textuales / BOOK-02 backfill) | Agrupa toggles puros (BOOK-01 + BOOK-03) y separa BOOK-02 que genera archivo nuevo. Compromiso intermedio. | |

**User's choice:** 3 planes (uno por BOOK-01/02/03)
**Notes:** Trazabilidad 1:1 con REQ-IDs y commits granulares prevalece sobre overhead orquestador. Patrón ya validado en Phase 31.

---

## Contenido del VERIFICATION.md de Phase 23 (BOOK-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Retro-verificación estructural completa | Auditar SUMMARYs 23-01 y 23-02 contra requirements de Phase 23 (GH-01..05 + CFG-01/02 + TEST-01) y producir VERIFICATION.md con verdicts must-have. Patrón consistente con phases 24-27. | ✓ |
| Stub pointer minimalista | Solo frontmatter + 'VERIFICATION skipped — cubierto funcionalmente por 23-01/02-SUMMARY.md'. Rápido pero menos uniforme. | |
| Stub estructurado con tabla de coverage | Frontmatter + tabla 'REQ-ID → SUMMARY ref' sin re-verificar contra código. Compromiso entre rigor y velocidad. | |

**User's choice:** Retro-verificación estructural completa
**Notes:** Uniformidad documental con phases 24-27 prevalece. Los SUMMARYs de Phase 23 ya son detallados y self-check explícito, el audit dijo "excepcionalmente detallados" — proporciona evidencia ya consolidada para retro-verify sin re-correr tests.

---

## Estrategia de commits

| Option | Description | Selected |
|--------|-------------|----------|
| 1 commit por BOOK-item (3 total) | `docs(32-XX): close BOOK-NN`. Trazabilidad 1:1 con REQ-IDs, alineado con commit standard del proyecto. | ✓ |
| 1 commit bundled por plan | Si elegimos plan único, un commit final agrupado. Más simple pero pierde gravedad por REQ. | |
| Tier 1 fast-forward sin PR | Doc-only — push directo a main sin PR. Coherente con Tier 1 del CLAUDE.md global. | |

**User's choice:** 1 commit por BOOK-item (3 total)
**Notes:** Aplicable independientemente de la integración (fast-forward Tier 1 sigue siendo el mecanismo de merge). Tier 1 fast-forward NO se descartó — es la política de blast-radius, NO mutex con commit granular. Ambos co-existen.

---

## Estructura de waves

| Option | Description | Selected |
|--------|-------------|----------|
| Wave 1 = los 3 planes en paralelo | BOOK-01 toca v0.7-REQUIREMENTS.md, BOOK-02 crea VERIFICATION.md de phase 23, BOOK-03 toca 4 VALIDATION.md (phases 23/25/26/27). Cero overlap — paralelizables. Phase entera en ~10 min. | ✓ |
| Wave 1 = BOOK-01 → Wave 2 = BOOK-02 + BOOK-03 | BOOK-01 primero (reconciliación traceability table es el ancla); luego en paralelo los otros 2. Conservador. | |
| Sequential (3 waves) | Un plan por wave. Más lento pero permite checkpoints intermedios si algo surge. | |

**User's choice:** Wave 1 = los 3 planes en paralelo
**Notes:** Cero overlap de archivos verificado. Worktrees aislados, sin conflictos esperables. ~10 min total estimado.

---

## Scope creep guard

| Option | Description | Selected |
|--------|-------------|----------|
| No, scope es BOOK-01/02/03 exactos del audit | Mantener scope fijo del ROADMAP. Cualquier otro item se difiere o se crea nueva phase si se necesita. | ✓ |
| Sí, hay más items — los menciono ahora | Recoger ahora; pero recordatorio: scope-creep va a deferred-ideas, no se mete a Phase 32 sin re-roadmap. | |

**User's choice:** No, scope es BOOK-01/02/03 exactos del audit
**Notes:** Audit-fijo. Nada extra durante ejecución se mete sin re-roadmap.

---

## Claude's Discretion

- Formato exacto del verdict block dentro de `VERIFICATION.md` Phase 23 (encabezado, bullets, tabla por REQ-ID): planner elige template consistente con phases 24-27.
- Plan task granularity dentro de cada BOOK-plan: planner decide si BOOK-01 son 2 tasks (toggle + verify) o 1 task (toggle bulk de 8 IDs).
- Si conviene incluir un task de "verificación post-cambio" (e.g., grep para confirmar 0 `pending` en v0.7-REQUIREMENTS.md), planner lo decide.

## Deferred Ideas

Ninguna. Discussion stayed within phase scope. Scope-creep guard explícito en CONTEXT.md D-06.
