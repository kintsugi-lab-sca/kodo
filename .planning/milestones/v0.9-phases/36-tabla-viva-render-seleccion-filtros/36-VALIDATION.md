---
phase: 36
slug: tabla-viva-render-seleccion-filtros
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-27
---

# Phase 36 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in test runner (`node --test`) |
| **Config file** | none — `package.json` script globs `test/*.test.js` |
| **Quick run command** | `node --test test/dashboard-*.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~22 seconds (full suite); <1s for dashboard-only |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/dashboard-*.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~22 seconds

---

## Per-Task Verification Map

> Populated by the planner. The two load-bearing behaviors below MUST have automated coverage
> as PURE `resolveSelection` tests (per RESEARCH.md — `ink-testing-library@4` lacks
> `waitUntilExit()`; frame-diffing selection is brittle).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | — | — | TUI-08 | — | selección sigue a `task_id` tras reorder/desaparición (resolveSelection puro) | unit | `node --test test/dashboard-select.test.js` | ❌ W0 | ⬜ pending |
| TBD | — | — | TUI-12 | — | cursor preservado al aplicar/limpiar filtro (resolveSelection puro) | unit | `node --test test/dashboard-select.test.js` | ❌ W0 | ⬜ pending |
| TBD | — | — | TUI-07/09 | — | columnas + orden estable por `started_at` (formato/sort puros + frame) | unit | `node --test test/dashboard-table.test.js` | ❌ W0 | ⬜ pending |
| TBD | — | — | TUI-10 | — | color status+alive + zombie distinguible sin color | unit | `node --test test/dashboard-format.test.js` | ❌ W0 | ⬜ pending |
| TBD | — | — | TUI-11 | — | header live + contadores; vacío "no active sessions" | unit | `node --test test/dashboard-table.test.js` | ❌ W0 | ⬜ pending |
| TBD | — | — | TUI-12 | — | filtros `/` substring + prefijos `r:`/`s:` (applyFilter puro) | unit | `node --test test/dashboard-filter.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/dashboard-select.test.js` — RED tests para `resolveSelection` (TUI-08 + TUI-12, las dos conductas load-bearing puras)
- [ ] `test/dashboard-format.test.js` — RED tests para helpers puros (`formatAge`, `deriveRepo`, `statusColor`) (TUI-07 columnas, TUI-10 color)
- [ ] `test/dashboard-filter.test.js` — RED tests para `applyFilter` (TUI-12 prefijos `r:`/`s:` + substring)
- [ ] `test/dashboard-table.test.js` — RED tests de render ink (`lastFrame()`) para tabla/orden/header/vacíos (TUI-07/09/11), reusando el harness `makeFakeClock`/`injectProps`/`drain` de `dashboard-status-line.test.js`

*El walker `test/format-isolation.test.js` ya cubre `src/cli/dashboard/**` (color-isolation) — no requiere Wave 0 nuevo.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Navegación ↑/↓ fluida + filtro `/` en TTY real con N sesiones vivas | TUI-08, TUI-12 | Interacción de teclado en raw-mode TTY no reproducible de forma fiable en CI headless | Arrancar `kodo dashboard` con server vivo + ≥3 sesiones; mover cursor, abrir filtro con `/`, teclear `r:` / `s:`, `Esc` para cancelar; confirmar que el cursor sigue a la misma sesión |

*Las conductas de selección/orden/color/filtro tienen verificación automatizada vía helpers puros + frames; la UAT manual cubre solo la experiencia de teclado en TTY real.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 22s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
