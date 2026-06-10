---
phase: 37
slug: attach-handoff-cmux
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-28
backfilled: 2026-06-10
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> **REVISED 2026-05-28** tras hallazgo C-01: el verbo cmux es `select-workspace` (fire-and-forget), no `attach` (handoff TTY). Los tests load-bearing automatizables siguen aplicando con `exec` fake en vez de `spawn` fake.
> **Backfill Nyquist 2026-06-10 (Phase 47, NYQ-02):** togglado a compliant. Phase 37 cerró
> **covered-by-UAT** (sin VERIFICATION.md formal — ver fila `verification` en STATE.md): la
> evidencia citada es `37-UAT.md` (status passed, 6/6 goal-backward) + `37-HUMAN-UAT.md`
> (2/2 obligatorios passed en TTY real, firmado por Alex Núñez). **Sin re-ejecutar la suite** (D-03).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (Node ≥20 built-in test runner, same as Phases 34-36) |
| **Config file** | none — `package.json` `test` script invoca `node --test test/` |
| **Quick run command** | `node --test test/dashboard/focus.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5s (focus.test.js + format-isolation walker + App integration tests) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/dashboard/focus.test.js` (quick, ~1s)
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green AND `37-HUMAN-UAT.md` must have 2/2 obligatorios firmados
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

> El planner llena esta tabla con `{N}-XX-YY` task IDs concretos al generar los PLAN.md. Aquí se prefigura el target de cobertura por Wave 0 y por requirement.

| Requirement | Dimensión / Secure Behavior | Test Type | Automated Command | Evidencia citada (`37-UAT.md` / `37-HUMAN-UAT.md`) | Status |
|-------------|-----------------------------|-----------|-------------------|----------------------------------------------------|--------|
| TUI-13 | Focus exitoso: Enter sobre fila alive invoca `cmux select-workspace --workspace <ref>` vía `execFile`, args literales; dashboard intacto | unit + UAT | `node --test test/dashboard/focus.test.js` | `37-UAT.md` test #1 passed (`focus.test.js` 5/5 ok+args); `37-HUMAN-UAT.md` Escenario 1 passed (TTY real 2026-05-29, `workspace:16`, focus GUI visible) | ✅ green |
| TUI-14 | Zombie reject: `alive===false` cortocircuita ANTES de `runFocus`; footer rojo literal `FOCUS_ERR_ZOMBIE`; cmux jamás invocado; clear-on-any-input | unit + integration + UAT | `node --test test/dashboard/focus.test.js test/dashboard/app-focus.test.js` | `37-UAT.md` tests #2/#3 passed (focus 5/5 discriminated union ENOENT/NON_ZERO_EXIT/SPAWN_ERROR; app-focus 3/3); `37-HUMAN-UAT.md` Escenario 2 passed (footer literal byte-stable, guard D-02 confirmado) | ✅ green |
| TUI-13 invariant | NO-PICOCOLORS en `src/cli/dashboard/focus.js`; never-throws; NO-STDIO-INHERIT; alt-screen/SIGINT/SIGTERM intactos | unit (walker) + grep | `node --test test/format-isolation.test.js` | `37-UAT.md` tests #5/#6 passed (`format-isolation` 8/8; grep estructural: alt-screen solo index.js:129/155, SIGTERM Phase 34 intacto) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **Backfill Nyquist (Phase 47):** Phase 37 NO tiene VERIFICATION.md formal (covered-by-UAT,
> fila `verification` en STATE.md). La evidencia equivalente per D-03 es `37-UAT.md`
> (status passed, 6/6: 4 Success Criteria + 2 goal-backward, suite 965 pass / 0 fail / 1 skip)
> y `37-HUMAN-UAT.md` (2/2 obligatorios passed en TTY real, firmado por Alex Núñez,
> commit `98cf8fa`). Ningún requisito declarado N/A. Sin re-corrida de la suite.

---

## Wave 0 Requirements

- [ ] `test/dashboard/focus.test.js` — Wave 0 RED stubs: ok path, ENOENT mapping, NON_ZERO_EXIT mapping, SPAWN_ERROR never-throws, args ordering
- [ ] `test/dashboard/app-focus.test.js` — Wave 0 RED stubs: `alive===false` guard, clear-on-any-input, footer-error rendering
- [ ] No new framework install — `node --test` ya cubierto en `package.json`

*Cross-cutting invariants (must_haves.truths candidates):*
- **NO-PICOCOLORS:** `src/cli/dashboard/focus.js` no importa `picocolors` (cubierto automáticamente por `test/format-isolation.test.js` walker)
- **NEVER-THROWS:** `runFocus` jamás resuelve como rejected promise; siempre `{ok:true}` o `{ok:false, code, detail}`
- **NO-STDIO-INHERIT:** `runFocus` no usa `spawn` con `stdio:'inherit'`; usa `execFile` (verificable por grep sobre la implementación)
- **NO-ALT-SCREEN-MUTATION:** la fase no modifica `\x1b[?1049h/l` toggling en `index.js` (verificable por diff sobre `runDashboard`)
- **NO-SIGNAL-HANDLER-MUTATION:** la fase no instala ni remueve handlers de SIGINT/SIGTERM en `runDashboard` (verificable por diff)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Focus exitoso visible: cmux GUI cambia foco al workspace target tras `select-workspace` | TUI-13 | `ink-testing-library` no observa estado de app desktop macOS | UAT escenario #1 en `37-HUMAN-UAT.md`: lanzar `kodo dashboard` con cmux visible, navegar a fila alive, pulsar Enter, observar en la GUI de cmux que el workspace target queda focuseado |
| Zombie reject sin invocar `cmux` | TUI-14 | Verificación cross-process (`ps aux \| grep cmux` muestra que `execFile` NUNCA corrió). Automatizable parcialmente con `exec` fake count assertion, pero la garantía end-to-end requiere observar el proceso real | UAT escenario #2 en `37-HUMAN-UAT.md`: forzar workspace zombie (matar workspace cmux subyacente), refresh, navegar a fila zombie, Enter, observar footer rojo + verificar con `ps` que no hubo invocación |

---

## Validation Sign-Off

- [x] Cada requirement (TUI-13/14) mapeado a ≥1 cita de evidencia real (UAT — covered-by-UAT, D-03)
- [x] Sampling continuity: cobertura automatizada verde (focus 5/5 + app-focus 3/3 + walker 8/8)
- [x] Wave 0 covers all MISSING references (resuelto — `focus.test.js` + `app-focus.test.js` verde)
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `37-HUMAN-UAT.md` exists con 2 escenarios obligatorios passed (D-08, firmado)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-10 (backfill Phase 47, NYQ-02 — covered-by-UAT: cita `37-UAT.md` passed 6/6 + `37-HUMAN-UAT.md` 2/2 obligatorios firmados; sin re-ejecutar la suite)
