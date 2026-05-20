---
phase: 29
slug: gsd-provider-reporting-integration
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-20
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (Node.js native, sin frameworks externos) |
| **Config file** | `package.json` `scripts.test` (defines `node --test test/`) |
| **Quick run command** | `npm test -- test/<file>.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~12 seconds (suite completa Phase 28 baseline: 806 pass + 1 skip) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- test/<touched-file>.test.js` (quick targeted run)
- **After every plan wave:** Run `npm test` (full suite, debe permanecer ≥806 pass + 1 skip durante el desarrollo del plan)
- **After every cherry-pick application:** Run `npm test` (verify zero regressions inmediato — cada SHA es un cambio de estado del codebase)
- **Before `/gsd-verify-work`:** Full suite green con ≥844 pass (target real D-22) o ≥818 pass (floor SC#5 literal)
- **Max feedback latency:** 12 seconds (suite completa)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 29-01-01 | 01 | 0 | REPORT-01, REPORT-05 | T-29-01 anti-recursion bypass | Label `kodo:gsd-child` corta dispatcher ANTES de parseKodoLabels/lock/resolver/launch incluso bajo `--force` | unit | `npm test -- test/labels.test.js` | ✅ existe (Phase 11) | ⬜ pending |
| 29-01-02 | 01 | 0 | REPORT-01 | T-29-01 | Dispatcher guard placement fuera del `!opts.force` branch | unit | `npm test -- test/dispatcher.test.js` | ✅ existe (Phase 8/16) | ⬜ pending |
| 29-01-03 | 01 | 1 | REPORT-05 | — | Source-hygiene: `grep -rE "'kodo:gsd-child'" src/` retorna 0 fuera de `src/labels.js` | source-hygiene | `npm test -- test/labels-hygiene.test.js` | ❌ W0 (new file) | ⬜ pending |
| 29-02-01 | 02 | 0 | REPORT-02 | T-29-02 config opt-in bypass | `isReportToProviderEnabled` retorna `true` SOLO con strict `=== true`; fail-closed contra `"true"`/`1`/missing | unit | `npm test -- test/config.test.js` | ❌ W0 (new file, branch lo crea via e1f82c9) | ⬜ pending |
| 29-02-02 | 02 | 0 | REPORT-02 | — | DEFAULT_CONFIG NO contiene key `workflow` (anti-mutation invariant) | unit | `npm test -- test/config.test.js` (mismo archivo, distinto describe) | ❌ W0 | ⬜ pending |
| 29-03-01 | 03 | 0 | REPORT-03 | — | Wave 0 inspection: verify branch HEAD LG7/LG8 dependency on heading (read-only, decision recorded in SUMMARY draft) | autonomous: false (decision-recording read-only) | `git show gsd-provider-reporting:test/launch.test.js \| grep -Ec "LG[1-8]\|LH[1-3]"` ≥8 | ✅ git native | ⬜ pending |
| 29-03-02 | 03 | 0 | REPORT-03 | T-29-PM markers leak | Markers + heading + placeholder en prompt.md post `## Sesiones GSD` | unit | `npm test -- test/prompt.test.js` | ✅ existe | ⬜ pending |
| 29-03-03 | 03 | 0 | REPORT-03 | T-29-03 gate idempotency | `applyReportingGate(prompt, true)` byte-equal a doble aplicación; con `enabled=false` elimina markers + contenido | unit | `npm test -- test/launch.test.js` (NOT test/orchestrator/launch.test.js — per research) | ❌ W0 (new file, branch lo crea via 38c7a2e) | ⬜ pending |
| 29-03-04 | 03 | 1 | REPORT-03 | T-29-CO composition order | SR1..SR6 gating + LG1..LG8 + LH1..LH3 source-hygiene byte-level | unit | `npm test -- test/launch.test.js test/prompt.test.js` | ❌ W0 | ⬜ pending |
| 29-04-01 | 04 | 0 | REPORT-04 | T-29-04 content drift | Prosa ES contiene los 6 conceptos canónicos + log literals byte-exact + provider-agnostic | unit | `npm test -- test/orchestrator-gsd.test.js` (RC1..RC15 asserts post Task 2) | ❌ W0 (Task 1 escribe prosa; Task 2 carga tests) | ⬜ pending |
| 29-04-02 | 04 | 0 | REPORT-04 | T-29-04 | Anti-leak: RA1..RA6 — prosa stripped con flag=false elimina todo el bloque (kodo:gsd-child / NUNCA / HARD STEP / log literal) | unit | `npm test -- test/orchestrator-gsd.test.js` (RA1..RA6 asserts) | ❌ W0 | ⬜ pending |
| 29-04-03 | 04 | 1 | REPORT-04, REPORT-06 | T-29-COVERAGE | VERIFICATION.md phase-level con 5 SC + REPORT-01..06 traceability + 9 SHAs audit trail | docs + grep | `test -f .planning/phases/29-gsd-provider-reporting-integration/VERIFICATION.md && grep -Ec "5a41d8f\|cbd8f9c\|e1f82c9\|7c28c06\|5feb578\|38c7a2e\|d030547\|4d67312\|81c848c" VERIFICATION.md` ≥9 | ❌ W1 (Task 3 lo crea) | ⬜ pending |
| 29-04-04 | 04 | 1 | REPORT-06 | — | Phase 29 final suite gate: ≥818 pass (floor SC#5) ideally ≥844 (target D-22) | integration | `PASS_COUNT=$(npm test 2>&1 \| grep -E "^# pass" \| grep -oE "[0-9]+" \| head -1); test "$PASS_COUNT" -ge 818` | ✅ npm test native | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Phase 29 Wave 0 expectation: 3 new test files (`test/labels-hygiene.test.js`, `test/config.test.js`, `test/launch.test.js`) — los últimos dos vienen del branch via cherry-pick `e1f82c9` y `38c7a2e`. `test/labels-hygiene.test.js` es net-new escrito en plan 29-01 Task 3.*

*Meta tasks 29-05-01 / 29-05-02 (git audit + suite count) absorbed into 29-04 Task 3 (VERIFICATION.md cherry-pick audit trail) + 29-04 Task 4 (final suite gate). No standalone meta plan needed.*

---

## Wave 0 Requirements

- [x] `test/labels-hygiene.test.js` — new file, source-hygiene walker (REPORT-05). Mirror patron `test/format-isolation.test.js` (Phase 14) + `test/dispatcher-isolation.test.js` (Phase 16). Scheduled in 29-01 Task 3.
- [x] `test/config.test.js` — new file vía cherry-pick `e1f82c9` (REPORT-02 + DEFAULT_CONFIG anti-mutation + source-hygiene multi-archivo). Scheduled in 29-02 Task 1.
- [x] `test/launch.test.js` — new file vía cherry-pick `38c7a2e` (REPORT-03 SR1..SR6 + source hygiene). Per research, path correcto es `test/launch.test.js` (NOT `test/orchestrator/launch.test.js`). Scheduled in 29-03 Task 4.
- [x] (Sin framework install) — `node:test` ya en uso desde Phase 1; cero deps nuevas.

*Existing infrastructure cubre el resto: `test/labels.test.js`, `test/dispatcher.test.js`, `test/prompt.test.js`, `test/orchestrator-gsd.test.js`.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agente Claude crea sub-issue real en provider con label `kodo:gsd-child` | REPORT-04 (downstream observable) | Requiere MCP server live (GitHub/Plane) y agente Claude session real | 1. `kodo orchestrator --provider=github --task-id=<test-id>` con flag `workflow.report_to_provider: true`. 2. Verificar manualmente en GitHub UI que el sub-issue existe con label correcto. 3. Verificar comentario plan-by-plan post phase completion. (No-blocking: fail-open por diseño instruction-driven.) |
| Operador edita manualmente `~/.kodo/config.json` añadiendo `workflow.report_to_provider: true` | REPORT-02 (operator workflow) | DEFAULT_CONFIG no migra automáticamente (D-09 anti-mutation invariant); operador debe editar el JSON a mano | 1. Edit `~/.kodo/config.json` agregando `"workflow": {"report_to_provider": true}`. 2. Run `kodo orchestrator ...` y verificar log `[kodo:reporting] enabled` o equivalente. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (14 tasks mapped; 29-03-01 marked `autonomous: false` as read-only decision-recording)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (verified by per-task map above — each task carries a concrete `npm test -- <file>` or scripted grep)
- [x] Wave 0 covers all MISSING references (`test/labels-hygiene.test.js` + `test/config.test.js` + `test/launch.test.js` all scheduled)
- [x] No watch-mode flags (Node native test runner sin `--watch`)
- [x] Feedback latency < 12s (suite completa)
- [x] `nyquist_compliant: true` set in frontmatter — every implementation task carries `<automated>`; meta git audit + suite count consolidated into 29-04 Task 3 + Task 4

**Approval:** approved 2026-05-20
