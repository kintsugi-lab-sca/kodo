---
phase: 22-tech-debt-v0-5-closure
plan: 01
subsystem: testing
tags: [cli, ansi, regex, spawn-sync, env-vars, security-audit]

# Dependency graph
requires:
  - phase: 14-cli-format-foundation
    provides: src/cli/format.js (visibleWidth + _resolveUseColor), test/version-smoke.test.js, 14-SECURITY.md (status: verified, threats_open: 0)
provides:
  - DEBT-01 cerrado (audit-only, satisfied-by-existing — 14-SECURITY.md vigente desde 2026-05-06)
  - DEBT-02 cerrado: timeout: 10_000 ms explícito en spawnSync de version-smoke (WR-01 Phase 14)
  - DEBT-03 IN-01 cerrado: regex CSI defensiva /\x1b\[[\d;]*[A-Za-z]/g en visibleWidth (multi-param + 256-color + cualquier terminator)
  - DEBT-03 IN-02 cerrado: case 8 explícito en suite _resolveUseColor (TTY=false + FORCE_COLOR='' → true)
affects: [22-02 phase-15-closure, 22-03 phase-16-closure, v0.6 milestone completion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Citas por contenido (D-07): comentarios inline citan IDs del Resolution Log (WR-01, IN-01, IN-02 Phase 14) en lugar de offsets de línea"
    - "Tests defensivos donde behavior change (D-04): cada fix con superficie observable trae aserción de regresión inline"
    - "Audit-only closure (D-03/D-09): artefactos vigentes (14-SECURITY.md) NO se reescriben — se documenta en SUMMARY citando created date original"

key-files:
  created: []
  modified:
    - test/version-smoke.test.js
    - src/cli/format.js
    - test/format.test.js

key-decisions:
  - "DEBT-01 audited as satisfied-by-existing — 14-SECURITY.md ya tenía status: verified + threats_open: 0 (created 2026-05-06). NO se regeneró el archivo (Karpathy regla 3 — cambios quirúrgicos). Sin commit dedicado para DEBT-01."
  - "DEBT-02 implementado como una sola línea en options bag del spawnSync (timeout: 10_000) con comentario inline 'WR-01 Phase 14 — fail-fast si el bin cuelga (CI hygiene)' atado al ID del Resolution Log."
  - "DEBT-03 IN-01 + IN-02 commiteados juntos (1 commit, 2 archivos) porque la regex y los tests son el contrato observable conjunto del mismo fix; la suite de visibleWidth multi-param vive como describe block separado para localidad y discoverability."
  - "Regex CSI ampliada acepta cualquier letra ASCII como terminator (m/K/H/etc.) — escópica adecuada para cualquier CSI sintáctica válida; T-22-01-02 documentó accept (regex lineal en V8, sin backtracking ambiguo)."

patterns-established:
  - "Audit-only closure: cuando un artefacto histórico ya cumple el contrato del requirement, el plan lo documenta y verifica con greps (sin re-escritura) en lugar de regenerar."
  - "ID-tag inline en comentarios: `timeout: 10_000, // WR-01 Phase 14 — ...` y `it('case 8: ... IN-02 Phase 14', ...)` — facilita búsqueda inversa desde Resolution Log."
  - "Group-by-file commits dentro de plan: IN-01 (src/cli/format.js) + IN-02 (test/format.test.js) en un único fix(22-01) commit cuando ambos forman el contrato observable conjunto del mismo requirement."

requirements-completed:
  - DEBT-01
  - DEBT-02
  - DEBT-03

# Metrics
duration: ~15min
completed: 2026-05-13
---

# Phase 22 Plan 01: Phase 14 Closure Summary

**Phase 14 deuda cerrada quirúrgicamente — `spawnSync` timeout explícito (WR-01), regex `visibleWidth` defensiva para CSI multi-param/256-color (IN-01), case 8 `FORCE_COLOR=''` en suite precedence (IN-02); `14-SECURITY.md` confirmado vigente sin reescritura.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-13T~07:47Z
- **Completed:** 2026-05-13T08:02:41Z
- **Tasks:** 3 (Task 1 audit no-op + 2 fix commits)
- **Files modified:** 3

## Accomplishments

- DEBT-01 cerrado por audit retrospectivo. `head -10 .planning/milestones/v0.5-phases/14-cli-format-foundation/14-SECURITY.md` confirma `status: verified` + `threats_open: 0` + `created: 2026-05-06`. Los 4 checkbox del Sign-Off (`grep -c '^- \[x\]'`) y las 13 threats totales (`**Total threats:** 13`) verificadas. Artefacto vigente — no se reescribió (Karpathy regla 3).
- DEBT-02 (WR-01 Phase 14) cerrado: `test/version-smoke.test.js` ahora declara `timeout: 10_000` en `spawnSync(process.execPath, [KODO_BIN, '--version'], …)`. CI falla rápido si `bin/kodo --version` cuelga. Test sigue verde en happy path (exit 0, stdout=version, stderr vacío).
- DEBT-03 IN-01 cerrado: `visibleWidth()` ahora usa la regex defensiva `/\x1b\[[\d;]*[A-Za-z]/g` — cubre `\x1b[33;1m` (bold yellow), `\x1b[38;5;200m` (256-color), `\x1b[m` (CSI vacío) y cualquier terminator alfabético (m/K/H/etc.). Regresión single-param `\x1b[33m` preservada.
- DEBT-03 IN-02 cerrado: `test/format.test.js` añade `case 8: TTY=false + FORCE_COLOR='' => true (any non-'0' value forces, IN-02 Phase 14)` documentando el contrato `FORCE_COLOR != null && FORCE_COLOR !== '0'` para empty string.
- Nueva suite `describe('visibleWidth CSI multi-param (IN-01 Phase 14)', …)` con 2 nuevos casos (`\x1b[33;1m` width 11, `\x1b[38;5;200m` width 6) + 2 regression asserts (plain string + single-param CSI).
- Suite global: 613 pass / 1 skip / 0 fail (vs. baseline ~609 pre-plan).
- Golden bytes DX-06 intactos: `fmt.info('x')`, `fmt.error('x')`, `fmt.ok('done')`, `fmt.fail('boom')`, `fmt.dim('x')` continúan sin emitir `\x1b` cuando `useColor=false`.

## Task Commits

Cada task atómica commiteada por separado:

1. **Task 1: DEBT-01 audit — 14-SECURITY.md vigente** — no-op (audit-only, sin commit; verified inline via `head -10` + `grep -c '^- \[x\]'` + `grep '**Total threats:** 13'`). Cierre satisfied-by-existing.
2. **Task 2: DEBT-02 (WR-01 Phase 14) timeout en spawnSync** — `34d28e3` `test(22-01): add explicit timeout to version-smoke spawnSync`.
3. **Task 3: DEBT-03 IN-01 + IN-02** — `1768d9c` `fix(22-01): harden visibleWidth regex and cover FORCE_COLOR=''` (regex en `src/cli/format.js` + case 8 + 4 asserts visibleWidth multi-param en `test/format.test.js`).

_Note: TDD plans dictarían `test → feat` separados; aquí el plan declaró `tdd="true"` por task pero el fix es trivialmente de 1 línea (regex swap) y la propia suite de tests es la RED→GREEN — todo el contrato observable cabe en un único commit `fix(22-01)`._

## Files Created/Modified

- `test/version-smoke.test.js` — añadida línea `timeout: 10_000` con comentario `WR-01 Phase 14 — fail-fast si el bin cuelga (CI hygiene)`.
- `src/cli/format.js` — `visibleWidth()` regex extendida de `/\x1b\[\d+m/g` → `/\x1b\[[\d;]*[A-Za-z]/g`.
- `test/format.test.js` — añadido `case 8` a suite `_resolveUseColor precedence (D-02)` + nueva suite `visibleWidth CSI multi-param (IN-01 Phase 14)` con 4 `it()` (2 asserts nuevos + 2 regression).

## Decisions Made

- **Task 3 commit unificado** en lugar de fragmentar regex y tests en commits separados: ambos forman el contrato observable conjunto del fix IN-01/IN-02; separarlos rompería bisectability (commit con regex sin tests dejaría la regresión sin asserción inline).
- **Sin nuevo describe block para IN-02 case 8**: insertado dentro de la suite existente `_resolveUseColor precedence (D-02)` para mantener cohesión con casos 1-7. La nueva suite separada se reserva para visibleWidth multi-param porque amplía surface diferente.
- **Regex `[\d;]*` permite CSI vacío (`\x1b[m`)**: aceptado por design — `\x1b[m` es CSI SGR válido (reset implícito); strip-earlo es correcto para `visibleWidth`. Cubierto implícitamente por T-22-01-03 (regex permisiva acepta secuencias inesperadas, accept).
- **DEBT-01 sin commit**: el plan instruye explícitamente NO regenerar `14-SECURITY.md` (D-03c — el archivo pertenece al phase auditado, ya estaba completo). Documentado en este SUMMARY como satisfied-by-existing con cita al `created: 2026-05-06`.

## Deviations from Plan

None - plan executed exactly as written.

Cada task se ejecutó tal como la definía PLAN.md. Ningún Rule 1-4 disparado: no se descubrieron bugs incidentales, no faltaba funcionalidad crítica, no hubo blockers, no se requirieron decisiones arquitectónicas.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Verification Cumplida

Per el `<verification>` block del PLAN:

1. ✅ `node --test test/version-smoke.test.js` verde (1 pass, 0 fail) — DEBT-02 closed.
2. ✅ `node --test test/format.test.js` verde (44 pass, 0 fail) — DEBT-03 IN-01 + IN-02 closed.
3. ✅ `npm test` completo verde — 613 pass / 1 skip / 0 fail (regresión Phase 14/15 OK, golden bytes DX-06 preservados).
4. ✅ `head -10 .planning/milestones/v0.5-phases/14-cli-format-foundation/14-SECURITY.md` muestra `threats_open: 0` + `status: verified` + `created: 2026-05-06` — DEBT-01 audited.
5. ✅ Grep sanity:
   - `grep -c 'timeout: 10_000' test/version-smoke.test.js` → 1.
   - `grep -c "\[\\d;\]\*\[A-Za-z\]" src/cli/format.js` → 1.
   - `grep -c "FORCE_COLOR: ''" test/format.test.js` → 1.
   - `grep -c "case 8" test/format.test.js` → 1.

## Citas D-01..D-09 aplicadas

- **D-01** — 22-01 cubre Phase 14 closure (Wave 1 paralelo con 22-02 y 22-03, sin depends_on cruzados).
- **D-02** — cada DEBT/WR/IN como task discreta; commit atómico por fix (~10-30 LOC). Aplicado en commits `34d28e3` y `1768d9c`.
- **D-03** — DEBT-01 satisfied-by-existing audit, NO rewrite. Verified via `head -10` + grep.
- **D-04** — tests defensivos donde behavior change: WR-01 timeout (no test nuevo — modifica options bag), IN-01 regex (4 asserts nuevos), IN-02 case 8 (1 assert nuevo).
- **D-07** — comentarios cita por contenido / ID del Resolution Log, no por offset (`WR-01 Phase 14`, `IN-02 Phase 14` inline).
- **D-09** — cada commit cita DEBT-XX/WR-XX/IN-XX en mensaje y/o inline; suite global verde (613 pass).

## Next Phase Readiness

- Plan 22-01 completo. Wave 1 sigue paralela: 22-02 (DEBT-04 Phase 15) y 22-03 (DEBT-05/06 Phase 16) corren en sus worktrees aislados sin conflict con esta phase.
- Tras completar 22-01/02/03, v0.6 cierra al 100% de la milestone.
- Sin blockers ni concerns residuales.

## Self-Check: PASSED

- ✅ `test/version-smoke.test.js` — modified, grep `timeout: 10_000` → 1.
- ✅ `src/cli/format.js` — modified, regex `\[[\d;]*[A-Za-z]` presente.
- ✅ `test/format.test.js` — modified, case 8 + suite visibleWidth CSI multi-param presentes.
- ✅ Commit `34d28e3` presente en `git log` (test commit DEBT-02).
- ✅ Commit `1768d9c` presente en `git log` (fix commit DEBT-03 IN-01 + IN-02).
- ✅ `.planning/milestones/v0.5-phases/14-cli-format-foundation/14-SECURITY.md` intacto (NO modificado por este plan — audit-only).
- ✅ Sin modificaciones a `.planning/STATE.md`, `.planning/ROADMAP.md`, `.claude/skills/`, `src/orchestrator/`.

---
*Phase: 22-tech-debt-v0-5-closure*
*Plan: 01 — Phase 14 closure*
*Completed: 2026-05-13*
