---
phase: 15
slug: cli-polish-wiring
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-05
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

Phase 15 cabea `src/cli/format.js` (Phase 14) en 5 surfaces CLI con cobertura TDD por plan. **No gaps**: todos los requirements DX-01..DX-05 + invariants cross-cutting tienen tests automatizados. Reconstruido retroactivamente desde 5 SUMMARY.md.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (Node.js 20+ built-in test runner) |
| **Config file** | `package.json#scripts.test` (no separate config) |
| **Quick run command** | `node --test test/<focus>.test.js` |
| **Full suite command** | `npm test` (= `node --test test/**/*.test.js`) |
| **Estimated runtime** | ~0.8s (494 tests / 112 suites) |

---

## Sampling Rate

- **After every task commit:** Run focused subset (e.g. `node --test test/logger.test.js`)
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~1s (sub-second feedback, native runner)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-T1 | 01 | 1 | DX-01 | — | `formatLine` shape dual: NO_COLOR golden bytes pre-Phase-14, TTY columnar (8/5/12 widths) con level chips coloreados | unit | `node --test test/logger.test.js` | ✅ | ✅ green |
| 15-01-T2 | 01 | 1 | DX-02 | — | `_resolveUseColor` unifica useColor en logger+reader (NO_COLOR > FORCE_COLOR > stream.isTTY); `--json` bypass byte-a-byte | unit | `node --test test/logger.test.js test/logs-reader.test.js` | ✅ | ✅ green |
| 15-02-T1 | 02 | 1 | DX-05 | — | 3 ANSI inline eliminados; `fmt.yellow/red/ok` via `formatterFn` DI; bytes "✓ All clear" leading symbol per D-10 | unit | `node --test test/check.test.js` | ✅ | ✅ green |
| 15-02-T2 | 02 | 1 | DX-05 (LOG-12) | — | `check.js → format.js` no carga `logger.js` transitivamente (test-graph walker) | source-hygiene | `node --test test/check-isolation.test.js` | ✅ | ✅ green |
| 15-03-T1 | 03 | 1 | DX-03 | — | `renderHuman` 4 secciones literales (`config:`, `fetch:`, `roadmap:`, `match:`) con `fmt.ok('OK')` / `fmt.fail('FAIL')` | unit (TDD RED→GREEN) | `node --test test/gsd-inspect-cli.test.js` | ✅ | ✅ green |
| 15-03-T2 | 03 | 1 | DX-03 (D-13) | — | `Exit: N` línea final byte-coincide con return code; suprimido en `--json`; preservado en error paths | unit | `node --test test/gsd-inspect-cli.test.js` | ✅ | ✅ green |
| 15-04-T1 | 04 | 1 | DX-04 (Pitfall #2) | — | `result.plane.comment_body` expuesto en return shape; markdown determinista byte-equality con string enviado a Plane | integration (TDD) | `node --test test/gsd-verify-integration.test.js` | ✅ | ✅ green |
| 15-04-T2 | 04 | 1 | DX-04 (D-19, Pitfall #6) | — | verdict→3-color (`pass=green/soft=yellow/hard=red`) + summary slice 3 líneas (no re-render); REND1 anti-double-generation | unit (TDD) + source-grep | `node --test test/gsd-verify-cli-handler.test.js` | ✅ | ✅ green |
| 15-05-T1 | 05 | 2 | DX-01..DX-05 (D-07) | — | 5 callsites Phase 15 (`logger.js`, `logs/reader.js`, `check.js`, `cli/gsd-inspect.js`, `cli/gsd-verify.js`) importan `format.js`; 0 leak de `picocolors` fuera de `format.js`+`package.json` | source-hygiene | `node --test test/format-isolation.test.js` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Aggregate:** 9/9 tasks → all green. Suite global Wave 2: 494 pass + 1 skip pre-existente (Phase 14 LOG-12 startup budget Decisión B) / 0 fail / 0 flaky en `npm test` corrida final.

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

Phase 15 reusa el runner `node --test` ya en place desde Phase 1 + el helper `test/helpers/logger-fixtures.js`/`logger-sink.js` + el formatter `src/cli/format.js` (Phase 14). No requirió bootstrap de nueva infraestructura.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual inspection of TTY columnar output (`kodo logs` con stderr real, NO `2>/dev/null`) | DX-01, DX-02 | Render columnar verifica byte-shape + widths fijas, pero el feel visual (level chip color en terminal real, alineación de columnas en pantalla 80 col) no se automatiza | Lanzar `node bin/kodo logs` en terminal interactiva con eventos NDJSON variados; confirmar widths 8·5·12 y colores nivel. Lanzar con `NO_COLOR=1` y confirmar bytes idénticos pre-Phase-14. |
| Visual inspection `kodo gsd inspect <task-id>` 4 secciones | DX-03 | Símbolos `✓`/`✗` en TTY real (`fmt.ok`/`fmt.fail` con OK_SYMBOL/FAIL_SYMBOL) — el byte-shape se valida pero el rendering del símbolo en distintos terminals (iTerm, Terminal.app, tmux) requiere verificación humana | Lanzar `kodo gsd inspect <id>` con verdict pass + verdict fail; confirmar `Exit: 0` o `Exit: 1` última línea legible. |
| Visual inspection `kodo gsd verify <session-id>` colored verdict + summary slice | DX-04 | Mismo argumento — el shape se valida byte-a-byte pero la calidad del feedback humano (colores legibles + slice de 3 líneas que da contexto pass header + bullet) requiere ojo humano | Lanzar `kodo gsd verify <id>` con verification.md pass / soft-fail / hard-fail / missing; confirmar mapping de colores y que summary slice da info útil sin truncar. |

---

## Validation Sign-Off

- [x] All tasks have automated verify (TDD RED→GREEN per plan, source-hygiene guards para invariants estructurales)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (cada plan committea test antes de feat)
- [x] Wave 0 covers all MISSING references (n/a — sin gaps de infraestructura)
- [x] No watch-mode flags (suite corre one-shot, sin `--watch`)
- [x] Feedback latency < 1s (suite global ~0.8s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-05

---

## Cross-references

- **Code review:** `15-REVIEW.md` (status `issues_found` — 0 critical, 2 warnings, 5 info; advisory)
- **Verification:** `15-VERIFICATION.md` (status `passed` — 5/5 must-haves, DX-01..DX-05 accounted for)
- **Security:** `15-SECURITY.md` (status `verified` — `threats_open: 0`, presentation-only)
