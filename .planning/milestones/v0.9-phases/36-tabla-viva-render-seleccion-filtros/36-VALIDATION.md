---
phase: 36
slug: tabla-viva-render-seleccion-filtros
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-27
backfilled: 2026-06-10
---

# Phase 36 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> **Backfill Nyquist 2026-06-10 (Phase 47, NYQ-02):** togglado a compliant citando la
> evidencia empírica preexistente (`36-VERIFICATION.md` passed 6/6 + `36-HUMAN-UAT.md` 3/3).
> Estructura original (Test Infrastructure, Sampling, Wave 0, Manual-Only) preservada intacta.
> **Sin re-ejecutar la suite** — la tabla cita fichero + resultado real (D-03).

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

| Requirement | Plan | Dimensión / Secure Behavior | Test Type | Automated Command | Evidencia citada (`36-VERIFICATION.md` / `36-HUMAN-UAT.md`) | Status |
|-------------|------|-----------------------------|-----------|-------------------|------------------------------------------------------------|--------|
| TUI-07 | 36-01/02 | Columnas `task_ref · repo · phase/mode · status · age` con COLS fijos | unit (frame) | `node --test test/dashboard-table.test.js` | VERIF Truth #1 ✓ VERIFIED (`SessionTable.js:166-175`; test :148-164 verde); HUMAN-UAT #1 layout TTY real passed | ✅ green |
| TUI-08 | 36-01/03 | Selección por identidad `task_id`, sobrevive reorder/refresh (`resolveSelection` puro) | unit | `node --test test/dashboard-select.test.js` | VERIF Truth #2 ✓ VERIFIED (`resolveSelection` select.js:74-80; nav App.js:207-216) | ✅ green |
| TUI-09 | 36-01/02 | Orden estable DESC por `started_at`, tiebreak `task_id` (fix WR-01) | unit | `node --test test/dashboard-select.test.js` | VERIF Truth #3 ✓ VERIFIED (`sortSessions` NaN→0, commit 43e790f; test :115-188) | ✅ green |
| TUI-10 | 36-01/02 | Color `status+alive`; zombie `running (zombie)` distinguible sin color | unit + UAT | `node --test test/dashboard-format.test.js` | VERIF Truth #4 ✓ VERIFIED (`statusColor/statusLabel` format.js:91-110); HUMAN-UAT #2 zombie rojo legible passed | ✅ green |
| TUI-11 | 36-01/02 | Header live + contadores (zombie aparte); vacío "no active sessions" | unit (frame) | `node --test test/dashboard-table.test.js` | VERIF Truth #5 ✓ VERIFIED (`countsLabel` SessionTable.js:61-69; tres ramas D-12; test :177-256) | ✅ green |
| TUI-12 | 36-01/03 | Filtro `/` substring + prefijos `r:`/`s:` (`String.includes`, nunca RegExp); cursor preservado (fix CR-01) | unit + UAT | `node --test test/dashboard-select.test.js test/dashboard-table.test.js` | VERIF Truth #6 + §CR-01 ✓ VERIFIED (`parseFilter/applyFilter` select.js:91-131; guard `sel.taskId != null` commit 8edb871; test regresión :386-434); HUMAN-UAT #3 filtro modal passed | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **Backfill Nyquist (Phase 47):** las 6 dimensiones quedan cubiertas por `36-VERIFICATION.md`
> (passed 6/6 must-haves; suite confirmatoria 957 pass / 0 fail / 1 skip) + `36-HUMAN-UAT.md`
> (3/3 items passed en TTY real, hot-patches 116cb1e + ca61733 validados). Sin re-corrida.

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

- [x] Cada requirement (TUI-07..12) mapeado a ≥1 cita de evidencia real en `36-VERIFICATION.md`
- [x] Sampling continuity: cobertura automatizada verde para las 6 dimensiones
- [x] Wave 0 covers all MISSING references (resuelto — tests escritos durante la ejecución, verde)
- [x] No watch-mode flags
- [x] Feedback latency < 22s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-10 (backfill Phase 47, NYQ-02 — cita `36-VERIFICATION.md` passed 6/6 + `36-HUMAN-UAT.md` 3/3; sin re-ejecutar la suite)
