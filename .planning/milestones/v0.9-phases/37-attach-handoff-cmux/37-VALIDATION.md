---
phase: 37
slug: attach-handoff-cmux
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-28
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> **REVISED 2026-05-28** tras hallazgo C-01: el verbo cmux es `select-workspace` (fire-and-forget), no `attach` (handoff TTY). Los tests load-bearing automatizables siguen aplicando con `exec` fake en vez de `spawn` fake.

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

| Wave 0 Test | Plan | Requirement | Test Type | Automated Command | Status |
|-------------|------|-------------|-----------|-------------------|--------|
| `runFocus({ok:true})` con `exec` fake → asserta args literales `['select-workspace', '--workspace', ref]` | TBD | TUI-13 | unit | `node --test test/dashboard/focus.test.js -g "ok path"` | ⬜ pending |
| `runFocus` con `exec` fake que callback `err.code='ENOENT'` → `{ok:false, code:'ENOENT'}` | TBD | TUI-14 | unit | `node --test test/dashboard/focus.test.js -g "ENOENT"` | ⬜ pending |
| `runFocus` con `exec` fake que callback `err.code=7` → `{ok:false, code:'NON_ZERO_EXIT', detail:7}` | TBD | TUI-14 | unit | `node --test test/dashboard/focus.test.js -g "non-zero exit"` | ⬜ pending |
| `runFocus` con `exec` que SÍNCRONAMENTE throws → `{ok:false, code:'SPAWN_ERROR'}` (never-throws contract) | TBD | TUI-14 | unit | `node --test test/dashboard/focus.test.js -g "never throws"` | ⬜ pending |
| App Enter sobre fila `alive:false` → `lastFrame()` contiene `'workspace gone (alive=false) — press any key'` rojo; `onFocus` NUNCA llamado | TBD | TUI-14 | integration | `node --test test/dashboard/app-focus.test.js -g "alive false guard"` | ⬜ pending |
| App con `focusError` seteado + cualquier tecla → `focusError===null`, footer normal restaurado | TBD | TUI-14 | integration | `node --test test/dashboard/app-focus.test.js -g "clear on any input"` | ⬜ pending |
| `test/format-isolation.test.js` extendido (auto) cubre `src/cli/dashboard/focus.js` por color-isolation | (existing) | TUI-13 invariant | unit | `node --test test/format-isolation.test.js` | ✅ (existing walker) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (focus.test.js + app-focus.test.js)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `37-HUMAN-UAT.md` exists con 2 escenarios obligatorios estructurados (D-08)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
