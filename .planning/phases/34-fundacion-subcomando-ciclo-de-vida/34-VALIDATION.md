---
phase: 34
slug: fundacion-subcomando-ciclo-de-vida
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-26
---

# Phase 34 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derivado de RESEARCH.md `## Validation Architecture`. `nyquist_compliant`/`wave_0_complete`
> se marcan `true` al final de la ejecución cuando los tests Wave 0 estén verdes.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in de Node) + `node:assert/strict` |
| **Config file** | none — runner built-in (`npm test` = `node --test $(find test -name '*.test.js' -type f)`) |
| **Quick run command** | `node --test test/dashboard-non-tty.test.js test/dashboard-render.test.js test/format-isolation.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 segundos (quick); suite completa baseline v0.8 = 895 pass + 1 skip |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/dashboard-non-tty.test.js test/dashboard-render.test.js test/format-isolation.test.js`
- **After every plan wave:** Run `npm test` (suite completa debe seguir verde — baseline 895 pass + 1 skip)
- **Before `/gsd:verify-work`:** Full suite verde + UAT manual de TUI-03 (Ctrl-C/SIGTERM en TTY real)
- **Max feedback latency:** ~5 segundos

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 34-01-01 | 01 | 1 | TUI-02, TUI-04 | — | N/A (stack install) | unit | `node -e "<asserts package.json>" && node -e "require('ink');require('react');require('ink-testing-library')"` | ✅ (package.json) | ⬜ pending |
| 34-01-02 | 01 | 1 | TUI-01, TUI-02, TUI-03 | — | Tests rojos por diseño hasta Plan 02 | render + integration | `node --check test/dashboard-non-tty.test.js test/dashboard-render.test.js` | ❌ W0 | ⬜ pending |
| 34-01-03 | 01 | 1 | TUI-04 | — | Cero importadores de `picocolors` bajo `src/cli/dashboard/` (D-12/D-13) | unit (walker estático) | `node --test test/format-isolation.test.js` | ✅ (extender) | ⬜ pending |
| 34-02-01 | 02 | 2 | TUI-02, TUI-03 | T-34-01 / T-34-03 | non-TTY → exit 1 ANTES de render (D-03/D-04); SIGTERM → terminal intacta (D-10) | integration (spawnSync piped) | `node --test test/dashboard-non-tty.test.js` | ❌ W0 | ⬜ pending |
| 34-02-02 | 02 | 2 | TUI-01, TUI-03, TUI-04 | T-34-03 | chrome D-01 monta; `q`→`useApp().exit()` (D-08); Esc NO sale (D-11); cero picocolors (D-12) | render (ink-testing-library) | `node --test test/dashboard-render.test.js && node --test test/format-isolation.test.js` | ❌ W0 | ⬜ pending |
| 34-02-03 | 02 | 2 | TUI-03 | T-34-03 | Terminal intacta tras q / Ctrl-C / SIGTERM en TTY real | manual UAT (checkpoint:human-verify) | — (no automatizable sin PTY real) | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/dashboard-non-tty.test.js` — cubre TUI-02 (spawnSync piped → exit 1 + mensaje canónico D-04). Patrón de `test/version-smoke.test.js`.
- [ ] `test/dashboard-render.test.js` — cubre TUI-01 (chrome D-01) y TUI-03 parcial (`q`→exit con aserción de comportamiento concreta vía `waitUntilExit()`). Requiere `ink-testing-library`.
- [ ] **Extender** `test/format-isolation.test.js` — añadir `describe`/`it` que filtre por path bajo `src/cli/dashboard/` y asierte cero importadores de `picocolors` (D-13). NO modificar las aserciones existentes; reusar `listJsFiles`/`extractImports`.
- [ ] `npm install -D ink-testing-library@^4.0.0` + `ink@^6.8.0` / `react@^19.2.0` en dependencies — necesario antes de los tests de render.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Terminal intacta tras `q` | TUI-03 | El handoff de raw-mode necesita un TTY real; `ink-testing-library` no ejercita la restauración real del terminal | Lanzar `kodo dashboard` en terminal TTY → pulsar `q` → verificar: cursor visible, echo restaurado, scrollback sin corromper |
| Terminal intacta tras Ctrl-C | TUI-03 | Idem — `exitOnCtrlC` de ink solo es observable en TTY real | Lanzar `kodo dashboard` → Ctrl-C → verificar cursor/echo/scrollback intactos |
| Terminal intacta tras SIGTERM | TUI-03 | Handler SIGTERM explícito (D-10); no automatizable sin PTY | Lanzar `kodo dashboard` → `kill <pid>` desde otra terminal → verificar cursor/echo/scrollback intactos |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter (al cerrar ejecución, tests verdes)

**Approval:** pending
