---
phase: 79-sidebar-doctor
fixed_at: 2026-07-23T00:00:00Z
review_path: .planning/phases/79-sidebar-doctor/79-REVIEW.md
iteration: 1
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 79: Informe de Corrección de Code Review

**Fixed at:** 2026-07-23
**Source review:** .planning/phases/79-sidebar-doctor/79-REVIEW.md
**Iteration:** 1

**Resumen:**
- Findings en scope: 1
- Corregidos: 1
- Omitidos: 0

## Issues Corregidos

### WR-01: `execute` emite `add` y luego `ungroup` sobre el MISMO grupo (acciones contradictorias)

**Archivos modificados:** `src/cmux/sidebar-doctor.js`, `test/cmux/sidebar-doctor.test.js`
**Commit:** 433574e
**Fix aplicado:** En `scan`, se computa el set `looseGroupRefs` con los refs de grupo
referidos por `loose_workspace` (destinos de un `add`) y se excluyen esos refs del
cálculo de `empty_group`. Así un grupo transitoriamente vacío (`member_count === 0`)
cuyo nombre normaliza al `expected` de una sesión viva aparece SOLO en `loose_workspace`
(un `add`) y ya no también en `empty_group` (un `ungroup`), eliminando el par de
acciones contradictorias que impedía converger en un único `--fix`.

Se añadió el test de regresión "WR-01: grupo vacío cuyo nombre normaliza al expected
de una sesión viva → SOLO loose_workspace, no empty_group", que fija el escenario
exacto descrito en el review (grupo `Kodo` con `member_count: 0` y sesión viva
`workspace:4` que resuelve por nombre normalizado a `KODO`).

**Verificación:**
- Tier 1: relectura del bloque modificado — fix presente, código intacto.
- Tier 2: `node -c` OK en fuente y test.
- Test dirigido: `node --test test/cmux/sidebar-doctor.test.js` → 22/22 pass (incluye el nuevo caso WR-01).
- Suite completa `npm test` → 2345/2348 pass. Los 2 fallos (`test/hooks/install.test.js`)
  son artefactos del worktree temporal: esos tests filtran comandos que contienen la
  cadena literal `'kodo'` (línea 109), presente en la ruta del repo principal
  `/Users/alex/dev/klab/kodo` pero ausente en la ruta del worktree
  `/private/tmp/sv-79-reviewfix-*`. No tocan `install.js` ni guardan relación con este fix.

---

_Fixed: 2026-07-23_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
