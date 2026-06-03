---
phase: 34
slug: fundacion-subcomando-ciclo-de-vida
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
validated: 2026-05-27
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
| 34-01-01 | 01 | 1 | TUI-02, TUI-04 | — | N/A (stack install) | unit | `node --input-type=module -e "await import('ink'); await import('react'); await import('ink-testing-library')"` | ✅ (package.json) | ✅ green |
| 34-01-02 | 01 | 1 | TUI-01, TUI-02, TUI-03 | — | Tests verdes tras Plan 02 (GREEN de TDD) | render + integration | `node --test test/dashboard-non-tty.test.js test/dashboard-render.test.js` | ✅ | ✅ green |
| 34-01-03 | 01 | 1 | TUI-04 | — | Cero importadores de `picocolors` bajo `src/cli/dashboard/` (D-12/D-13) | unit (walker estático) | `node --test test/format-isolation.test.js` | ✅ | ✅ green |
| 34-02-01 | 02 | 2 | TUI-02, TUI-03 | T-34-01 / T-34-03 | non-TTY → exit 1 ANTES de render (D-03/D-04); SIGTERM → terminal intacta (D-10) | integration (spawnSync piped) | `node --test test/dashboard-non-tty.test.js` | ✅ | ✅ green |
| 34-02-02 | 02 | 2 | TUI-01, TUI-03, TUI-04 | T-34-03 | chrome D-01 monta; `q`→`useApp().exit()` (D-08); Esc NO sale (D-11); cero picocolors (D-12) | render (ink-testing-library) | `node --test test/dashboard-render.test.js && node --test test/format-isolation.test.js` | ✅ | ✅ green |
| 34-02-03 | 02 | 2 | TUI-03 | T-34-03 | Terminal intacta tras q / Ctrl-C / SIGTERM en TTY real | manual UAT (checkpoint:human-verify) | — (no automatizable sin PTY real) | N/A | ✅ UAT aprobado |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/dashboard-non-tty.test.js` — cubre TUI-02 (spawnSync piped → exit 1 + mensaje canónico D-04). Patrón de `test/version-smoke.test.js`. **Verde.**
- [x] `test/dashboard-render.test.js` — cubre TUI-01 (chrome D-01) y TUI-03 parcial (`q`→exit vía frame-diff de unmount; `waitUntilExit()` no existe en `ink-testing-library@4`, ajuste Rule-1 de Plan 02). **Verde.**
- [x] **Extender** `test/format-isolation.test.js` — `describe('TUI-04 (D-13)…')` que filtra por path bajo `src/cli/dashboard/` y asierta cero importadores de `picocolors`. Aserciones previas intactas. **Verde.**
- [x] `ink@^6.8.0` / `react@^19.2.0` (deps) + `ink-testing-library@^4.0.0` / `@types/react@^19` (devDeps) instalados y pinneados; `engines.node` intacto.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Terminal intacta tras `q` | TUI-03 | El handoff de raw-mode necesita un TTY real; `ink-testing-library` no ejercita la restauración real del terminal | Lanzar `kodo dashboard` en terminal TTY → pulsar `q` → verificar: cursor visible, echo restaurado, scrollback sin corromper |
| Terminal intacta tras Ctrl-C | TUI-03 | Idem — `exitOnCtrlC` de ink solo es observable en TTY real | Lanzar `kodo dashboard` → Ctrl-C → verificar cursor/echo/scrollback intactos |
| Terminal intacta tras SIGTERM | TUI-03 | Handler SIGTERM explícito (D-10); no automatizable sin PTY | Lanzar `kodo dashboard` → `kill <pid>` desde otra terminal → verificar cursor/echo/scrollback intactos |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s (quick run ~0.5s)
- [x] `nyquist_compliant: true` set in frontmatter (ejecución cerrada, tests verdes)

**Approval:** ✅ validated 2026-05-27 — 4/4 requisitos con verificación automatizada; TUI-03 retiene 3 verificaciones manual-only (restauración de terminal en TTY real, irreducible sin PTY) aprobadas vía UAT.

---

## Validation Audit 2026-05-27

Auditoría retroactiva (State A — VALIDATION.md preexistente de planificación, nunca actualizado tras ejecución). Tests Wave 0 re-ejecutados y verificados verdes; suite completa sin regresiones.

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Requisitos COVERED (automated) | 4/4 (TUI-01..04) |
| Verificaciones manual-only (UAT aprobado) | 3 (restauración terminal TUI-03) |

**Evidencia ejecutada:**
- `node --test test/dashboard-non-tty.test.js test/dashboard-render.test.js test/format-isolation.test.js` → **11 pass / 0 fail**.
- `npm test` (suite completa) → **900 tests / 899 pass / 0 fail / 1 skip** (skip `startup-budget` pre-existente; sin regresiones vs baseline v0.8).
- Archivos de impl en disco: `src/cli/dashboard/index.js`, `src/cli/dashboard/App.js`; subcomando registrado en `src/cli.js:302`.

Sin gaps MISSING → no se invocó `gsd-nyquist-auditor`. No se generaron tests nuevos en esta auditoría.
