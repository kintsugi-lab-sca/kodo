# Phase 72: Higiene, DX y verdad documental - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-13
**Phase:** 72-higiene-dx-y-verdad-documental
**Mode:** --auto (sin AskUserQuestion; opción recomendada auto-seleccionada por área)
**Areas discussed:** Alcance batch BAJAS, HYG-08 vs README reescrito, Gate HYG-01, Orden SessionEnd (HYG-04), Validación de config (HYG-05)

---

## Alcance del batch de BAJAS (B2/B8 + grab-bag B12)

| Option | Description | Selected |
|--------|-------------|----------|
| REQUIREMENTS gana (B1,B2,B3,B4,B8,B9,B12+M12); B12 → 4 micro-diffs, exceso → deferred | Contrato más reciente (06-jul); no forzar el presupuesto de 1-5 líneas | ✓ |
| PROPUESTA gana (sin B2/B8) | Lista original de la remediación (05-jul) | |
| B12 como un solo diff combinado | Menos commits, más riesgo de exceder presupuesto | |

**[auto] Selected:** REQUIREMENTS como contrato + B12 descompuesto (recommended default)
**Notes:** El researcher debe re-verificar cada file:line contra HEAD (10 días de deriva desde el audit).

---

## HYG-08 con el README ya reescrito (cb98a6d, 10-jul)

| Option | Description | Selected |
|--------|-------------|----------|
| Pasada delta al final de la fase | Verificar checklist HYG-08 contra estado POST-72; tocar solo lo falso | ✓ |
| Reescritura completa de nuevo | Redundante — ya se auditó contra el CLI real el 10-jul | |
| Marcar HYG-08 como hecho sin verificar | HYG-04 cambia comportamiento descrito en README — quedaría stale | |

**[auto] Selected:** Delta al final (recommended default)

---

## Gate del auto-commit (HYG-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Gate en todo el bloque add+commit; skip silencioso con log; var inyectada en launchOrchestrator; pathspec en ambos pasos | Criterio de éxito literal + mínima sorpresa | ✓ |
| Gate solo en el commit | El add seguiría ensuciando el index de sesiones normales | |
| Error si falta la var | Rompería sesiones normales en el repo kodo | |

**[auto] Selected:** Gate completo + skip con log (recommended default)

---

## Orden de efectos en SessionEnd (HYG-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Efectos DESPUÉS del backstop de estado (DELIV-04); never-throws individuales | La transición provider es load-bearing; cosmética al final | ✓ |
| Efectos antes de la transición | Un fallo cmux podría abortar la transición | |
| Todo en paralelo | Orden no determinista, difícil de testear | |

**[auto] Selected:** Efectos tras el backstop (recommended default)
**Notes:** Reparto exacto Stop↔SessionEnd lo mapea el researcher sin romper stop-idempotency.

---

## Validación de config (HYG-05/B7)

| Option | Description | Selected |
|--------|-------------|----------|
| Deep-merge + warn-and-fallback, reutilizando config-validate.js | Coherente con never-throws; el daemon nunca crashea por config parcial | ✓ |
| Rechazo duro al arrancar (crash con error claro) | Mejor DX de arranque, pero rompe la filosofía never-throws del daemon | |
| Solo deep-merge sin validación | Deja pasar valores absurdos (max_parallel:-5) | |

**[auto] Selected:** Warn-and-fallback (recommended default)

---

## Claude's Discretion

- Orden interno y agrupación de planes (batches paralelizables)
- Ubicación exacta del strip `\x1b` en el pipeline del dashboard (HYG-07)
- Wording de los warns NDJSON nuevos

## Deferred Ideas

- B11 (follow.js líneas duplicadas) — no está en HYG-06
- B6/B10 si siguieran abiertos — eran de Ola 1; candidatos a backlog, no a esta fase
