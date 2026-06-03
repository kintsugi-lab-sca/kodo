# Phase 29: GSD Provider Reporting Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-20
**Phase:** 29-gsd-provider-reporting-integration
**Mode:** `--auto` (autonomous discuss; Claude selected recommended defaults; no AskUserQuestion prompts emitted)
**Areas discussed:** Cherry-pick scope + orden, Decomposición en plans, Anti-recursión placement, Opt-in config semantics, Reporting gate idempotency, Prosa ES content scope, Source-hygiene location, Planning artifacts regen, Suite baseline reconciliation, Conflict resolution policy

---

## Cherry-pick scope + orden (REPORT-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Apply 9 SHAs en orden cronológico PENDING-INTEGRATIONS.md | Patrón documentado, audit trail explícito | ✓ (recommended) |
| Merge directo de `gsd-provider-reporting` a main | Rechazado en PENDING-INTEGRATIONS.md por colisión .planning/ Phase 14-15 | |
| Squash de los 9 commits en uno solo previo a cherry-pick | Pierde audit trail granular del trabajo de la rama | |

**Auto choice:** Apply 9 SHAs cronológicamente. Documentado en CONTEXT.md D-01.
**Notes:** `5a41d8f → cbd8f9c → e1f82c9 → 7c28c06 → 5feb578 → 38c7a2e → d030547 → 4d67312 → 81c848c`.

---

## Baseline para cherry-pick (REPORT-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Cherry-pick sobre `main` post-Phase-28 (commit `29875d5`) | Baseline más reciente, 806 pass + 1 skip | ✓ (recommended) |
| Rebase del branch `gsd-provider-reporting` sobre main, luego merge | Pierde el branch como audit trail; conflict surface mayor | |
| Cherry-pick sobre un release tag específico (e.g., v0.7) | Antiguo; perdería invariantes Phase 28 POLL-FIX-01 | |

**Auto choice:** Sobre main post-Phase-28. CONTEXT.md D-02.
**Notes:** Branch `gsd-provider-reporting` HEAD `cb28994` se preserva intacto.

---

## Decomposición en plans (REPORT-01..06)

| Option | Description | Selected |
|--------|-------------|----------|
| 2 plans (mirror Phase 14 + Phase 15 del branch) | Coarse; combina anti-recursión + config en un solo plan; combina gate infra + prosa en otro | |
| 4 plans (1 per cluster natural de commits) | Mirrors la organización 14-01/14-02/15-01/15-02 del branch | ✓ (recommended) |
| 5+ plans (split tests + features) | Demasiado fine-grained; tests vienen con cherry-pick mismo commit | |

**Auto choice:** 4 plans. CONTEXT.md D-04.
**Notes:**
- 29-01: REPORT-01 + REPORT-05 (labels + dispatcher filter)
- 29-02: REPORT-02 (config helper)
- 29-03: REPORT-03 (markers + gate helper)
- 29-04: REPORT-04 (prosa ES + content tests)

---

## Verification document strategy

| Option | Description | Selected |
|--------|-------------|----------|
| 1 VERIFICATION.md phase-level único | Patrón Phase 28; cubre los 5 SC ROADMAP en un solo archivo | ✓ (recommended) |
| 1 VERIFICATION.md por plan (4 archivos) | Fine-grained pero duplica trabajo + dispersa SC observables | |
| Sin VERIFICATION.md (delegar a SUMMARYs) | Rompe consistencia v0.8 + dificulta milestone audit final | |

**Auto choice:** 1 phase-level. CONTEXT.md D-05.

---

## Anti-recursión placement (REPORT-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Guard ANTES de `if (!opts.force)` — funciona bajo `--force` | Hard safety: anti-recursión incondicional | ✓ (recommended, hereda branch D-07) |
| Guard DENTRO de `if (!opts.force)` | Rompería bajo `--force` — caso uso real para CLI manual | |
| Guard como middleware separado | Sobre-ingeniería para un solo filtro | |

**Auto choice:** ANTES de `!opts.force`. CONTEXT.md D-06.

---

## Opt-in config semantics (REPORT-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Strict equality `=== true` + optional chaining | Fail-closed contra string/number/JSON corruption | ✓ (recommended, hereda branch D-03) |
| Truthy coercion (`!!config?.workflow?.report_to_provider`) | Acepta `"true"`, `1`, etc. — fail-open por defecto | |
| Schema validation con ajv/zod | Sobre-ingeniería para un solo boolean flag | |

**Auto choice:** Strict equality. CONTEXT.md D-09.

---

## Reporting gate idempotency (REPORT-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Pure function idempotente entre markers + tests SR1..SR6 | Bytes idénticos en doble aplicación; testeable byte-level | ✓ (recommended, hereda branch) |
| Conditional rendering inline en template (Mustache-style) | Acopla gate a engine de templates; menos testeable | |
| Build-time bake del prompt según flag | Imposible — flag es runtime config del operador | |

**Auto choice:** Pure function idempotente. CONTEXT.md D-12/D-14.

---

## Prosa ES content scope (REPORT-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Heredar prosa completa de `d030547` literal (provider-agnostic via `{{provider_name}}`) | Validada por 21 tests RC1..RC15 + RA1..RA6 | ✓ (recommended) |
| Reescribir prosa from scratch para v0.8 | Invalida los 21 tests heredados; trabajo redundante | |
| Prosa minimal (solo bullet list, no narrativa) | Rompe los 21 asserts content RC1..RC15 + RA1..RA6 | |

**Auto choice:** Heredar literal. CONTEXT.md D-15.

---

## Source-hygiene test location (REPORT-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Nuevo archivo `test/labels-hygiene.test.js` (mirror `test/format-isolation.test.js`) | Coherente con patrón Phase 14 + Phase 16 source-hygiene tests | ✓ (recommended) |
| Append a `test/labels.test.js` (donde viven tests de labels) | Mezcla concerns: behavioral tests vs hygiene guard | |
| ESLint rule custom | Sobre-ingeniería; agregar dep eslint solo para un grep | |

**Auto choice:** Nuevo archivo. CONTEXT.md D-17.

---

## Planning artifacts regen scope (REPORT-06)

| Option | Description | Selected |
|--------|-------------|----------|
| PLAN.md antes del cherry-pick + SUMMARY.md después (per plan) | Patrón Phase 28; locks decisiones + refleja landing | ✓ (recommended) |
| PLAN.md y SUMMARY.md en bulk después del cherry-pick completo | Pierde el momentum decisional + dificulta verificación incremental | |
| Copiar literal los PLANs del branch | Numeración Phase 14-15 colisiona con v0.5 main; prosa habla de "rama" no de "integración" | |

**Auto choice:** PLAN antes + SUMMARY después. CONTEXT.md D-19/D-20.

---

## Suite baseline reconciliation (SC#5)

| Option | Description | Selected |
|--------|-------------|----------|
| Target ≥844 (806 Phase 28 actual + 38 heredados); floor ≥818 letra ROADMAP | Refleja baseline real + cumple letra del SC | ✓ (recommended) |
| Target estricto ≥818 (cumple ROADMAP literal, ignora overcumplimiento Phase 28) | Acepta degradación silenciosa si Phase 29 introduce regresiones | |
| Recalcular SC en ROADMAP.md antes de planning | Edita un artifact ya commited de v0.8 setup; ruido | |

**Auto choice:** Target ≥844, floor ≥818. CONTEXT.md D-22.

---

## Conflict resolution policy

| Option | Description | Selected |
|--------|-------------|----------|
| Manual resolution preservando main + nota inline en commit message | Audit trail explícito; cada desvío trazable en SUMMARY.md | ✓ (recommended) |
| `git cherry-pick --strategy=ours` (descarta cambios automáticamente) | Pierde lógica de la rama sin documentar; opaco | |
| Abort + rebuild from scratch para archivos con conflict | Trabajo redundante; pierde audit trail del branch | |

**Auto choice:** Manual con notas. CONTEXT.md D-24/D-25.

---

## Claude's Discretion

- Orden interno de aplicación de SHAs dentro de cada plan (atomicidad commits resultantes)
- Squash vs preservar SHAs originales como commits separados (recomendado: preservar)
- Numeración interna de archivos de tests (drift posible vs branch — `test/dispatcher.test.js` vs `test/triggers/dispatcher.test.js`)
- Sub-task de "cleanup post-merge" como Plan 29-05 si emerge necesidad de reformateo
- Verificación de no-solapamiento entre 38 tests heredados y tests pre-existentes en main

## Deferred Ideas

- Webhook GitHub real-time para sub-issues → v0.9+
- `kodo gsd doctor` para limpiar sub-issues huérfanos → v0.9+
- Tests E2E de MCP (Claude crea sub-issue real) → out of scope (instruction-driven implica fail-open)
- Detección automática de drift entre prompt.md y la prosa heredada → SR1..SR6 es la red de seguridad
- Métrica de uso del flag `workflow.report_to_provider` → defer hasta evidencia de demanda
- Migración automática config v0.2 → v0.8 con workflow block default → RECHAZADO (anti-mutation invariant D-09)
- Validación de sub-issue formato por kodo → instruction-driven implica fail-open; NO añadir validator

---

*Mode: `--auto` — no interactive prompts emitted; all selections are Claude's recommended defaults based on ROADMAP.md SC + PENDING-INTEGRATIONS.md + branch audit + Phase 28 patterns.*
