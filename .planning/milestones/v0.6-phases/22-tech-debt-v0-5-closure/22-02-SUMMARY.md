---
phase: 22-tech-debt-v0-5-closure
plan: 02
status: complete
date: 2026-05-13
key_files:
  modified:
    - src/logger.js
    - src/cli/format.js
    - test/logger-exports.test.js
    - test/format-isolation.test.js
requirements_addressed:
  - DEBT-04
commits:
  - feat(22-02): retire ANSI_*/COLOR_BY_LEVEL exports (DEBT-04 Phase 15 IN-01)
---

# Plan 22-02 — Phase 15 closure (DEBT-04)

## Outcome

DEBT-04 closed. `src/logger.js` ya no exporta `ANSI_RESET`, `ANSI_GRAY/CYAN/YELLOW`, ni `COLOR_BY_LEVEL`. Las constantes consumidas internamente (`ANSI_RESET` + `ANSI_RED`, línea 303 writeNdjson error path) se mantienen como `const` privadas por defense-in-depth invariante.

## Changes

### src/logger.js (-9 LOC)
- Eliminadas: `ANSI_GRAY`, `ANSI_CYAN`, `ANSI_YELLOW`, `COLOR_BY_LEVEL` (cero consumers post-retiro).
- Convertidas a privadas (`const`, sin `export`): `ANSI_RESET`, `ANSI_RED`.
- Comentario actualizado citando "Phase 22 DEBT-04 retiró COLOR_BY_LEVEL y los exports ANSI_* (Phase 15 IN-01 closed)".

### src/cli/format.js (2 comentarios actualizados)
- L101 JSDoc: ahora cita "mapeo equivalente al logger NDJSON pre-Phase-15, ya no expuesto" (cita por contenido, D-07).
- L159 inline: equivalente actualizado.

### test/logger-exports.test.js (-2 tests, -1 assertion)
- Eliminado `it('exports ANSI_RESET as a string', ...)`.
- Eliminado `it('exports COLOR_BY_LEVEL frozen map with 4 levels', ...)`.
- Eliminada assertion `assert.equal(typeof mod.ANSI_RESET, 'string')` del test `formatLine with useColor=true`.
- Describe label refleja surface restante.

### test/format-isolation.test.js (+1 guard)
- Nuevo describe `DEBT-04 source-hygiene: ANSI exports retired (Phase 15 IN-01 closed via Phase 22)`.
- Asserta `src/logger.js` NO contiene `export const ANSI_` ni `export const COLOR_BY_LEVEL` (regex negativos).

## Verification

- `grep -E '^export\s+const\s+ANSI_' src/logger.js` → 0 matches ✓
- `grep -E '^export\s+const\s+COLOR_BY_LEVEL' src/logger.js` → 0 matches ✓
- `grep -c 'COLOR_BY_LEVEL' src/cli/format.js` → 0 matches ✓
- `grep -c 'pre-Phase-15' src/cli/format.js` → 2 ✓
- `grep -c 'DEBT-04 source-hygiene' test/format-isolation.test.js` → 1 ✓
- Suite global: 613 pass / 0 fail / 1 skip pre-existente (delta neto -1 vs baseline 614, conforme).
- LOG-12 + color isolation invariantes: intactos.

## Decisions honored

- D-05/D-05b/D-05c/D-05d/D-05e (CONTEXT.md): retiro selectivo, guard nuevo, comentarios actualizados.
- D-07/D-07b: cita por contenido (no offset numérico).
- Karpathy reglas 2/3: cambios quirúrgicos, sin refactor adyacente.
