# Phase 47: Backfill de deuda Nyquist - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 47-backfill-de-deuda-nyquist
**Mode:** `--auto` (Claude auto-selected recommended option per area; no interactive prompts)
**Areas discussed:** Plan granularity, New-vs-Update por fase, Política de citación de evidencia, Forma del update a STATE.md, Disciplina Tier 1 doc-only

---

## Plan granularity

| Option | Description | Selected |
|--------|-------------|----------|
| 1 plan, 3 tasks (v0.10 / v0.9 / STATE.md) | Secuencial; evita contención en STATE.md compartido | ✓ |
| 2 plans split por requirement (NYQ-01 / NYQ-02) | Wave 1 paralelo; colisión en STATE.md compartido | |
| 3 plans (v0.10 / v0.9 / STATE.md) | Overhead innecesario para 7 doc-writes | |

**Auto-selected:** 1 plan, 3 tasks (recommended default).
**Notes:** STATE.md `## Deferred Items` es fichero compartido — plans paralelos colisionarían. Simplicidad-primero (Karpathy Regla 2). Espejo Phase 33 usó 1 plan/bloque; aquí solo existe el equivalente al Bloque B.

---

## New-vs-Update por fase

| Option | Description | Selected |
|--------|-------------|----------|
| 2 UPDATE (36/37) + 5 NEW (38/39/39.1/41/43) | Coincide con clasificación PARTIAL vs MISSING de STATE.md | ✓ |
| 7 NEW (sobrescribir todo) | Perdería contenido de los drafts existentes 36/37 | |

**Auto-selected:** 2 UPDATE + 5 NEW.
**Notes:** 36/37 ya tienen VALIDATION.md (PARTIAL/draft, `nyquist_compliant:false`) — verificado por `ls`. UPDATE in-place togglea el flag + rellena tabla.

---

## Política de citación de evidencia

| Option | Description | Selected |
|--------|-------------|----------|
| Citar VERIFICATION donde exista; UAT donde no (37/38); sin re-ejecutar | Réplica Phase 33 D-02 | ✓ |
| Re-ejecutar la suite para sustentar cada VALIDATION | Out of scope; suite ya verde 1263/1264 | |
| Declarar 37/38 N/A (sin VERIFICATION formal) | Falso: tienen UAT firmado como evidencia | |

**Auto-selected:** Citar evidencia más fuerte por fase; ninguna N/A.
**Notes:** 37/38 cerradas vía UAT (fila `covered-by-UAT` en STATE.md). Todas las 7 → `nyquist_compliant: true`.

---

## Forma del update a STATE.md

| Option | Description | Selected |
|--------|-------------|----------|
| Reconciliar solo las 7 filas nyquist + intro | Deja intactas verification/code/frontmatter | ✓ |
| Eliminar toda la tabla Deferred Items | Borraría deuda distinta aún vigente | |

**Auto-selected:** Reconciliar solo filas nyquist.
**Notes:** Criterio de éxito 3 del ROADMAP exige exactamente esto. WARNING-01 (ciclo ESM) y demás filas siguen vigentes.

---

## Disciplina Tier 1 doc-only

| Option | Description | Selected |
|--------|-------------|----------|
| Tier 1 doc-only — git diff src/ test/ bin/ vacío | Cero código; fast-forward main local sin PR | ✓ |
| Tier 1 extendido con surgical-fix | No aplica: Phase 47 no tiene equivalente al Bloque C de Phase 33 | |

**Auto-selected:** Tier 1 doc-only puro.
**Notes:** A diferencia de Phase 33-03, aquí cero `src/`. 0 tests netos.

---

## Claude's Discretion

- Template VALIDATION.md (40/42-VALIDATION.md como forma más cercana; planner inspecciona).
- Convención de commits (`docs(47-01): ...`, prefijo `docs(` por cero src/).
- Granularidad de tasks dentro del plan.
- Rigor de la tabla dimensión→cobertura (mínimo: cada success criterion ↦ ≥1 cita).

## Deferred Ideas

None — discussion stayed within phase scope. Filas no-nyquist de `## Deferred Items` (verification covered-by-UAT, code WARNING-01, frontmatter cosmético) son deuda distinta, deliberadamente fuera de NYQ-01/02.
